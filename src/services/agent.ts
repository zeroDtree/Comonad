import { Context, Service } from 'cordis'
import { hasWorkspace, type AgentState, type Message, type SessionPolicy } from '../domain/types.ts'
import type { Outcome } from '../graph/runtime.ts'
import { threadTitle, type Session } from './sessions.ts'

export interface TurnRequest {
  sessionId?: string
  text: string
  messages: Message[]
  policy?: Partial<SessionPolicy>
  sampling?: Record<string, unknown>
  interactive: boolean
}

export interface TurnResult {
  status: 'done' | 'suspended'
  sessionId: string
  message: Message | null
  messages: Message[]
  payload?: unknown
}

export class Agent extends Service {
  static inject = ['graphs', 'sessions', 'policy']

  private stops = new Map<string, AbortController>()

  constructor(ctx: Context) {
    super(ctx, 'agent')
  }

  stop(sessionId: string): boolean {
    const controller = this.stops.get(sessionId)
    if (!controller || controller.signal.aborted) return false
    controller.abort()
    return true
  }

  async runTurn(input: TurnRequest): Promise<TurnResult> {
    let session = input.sessionId ? this.ctx.sessions.get(input.sessionId) : undefined
    if (!session) session = this.ctx.sessions.create(this.ctx.policy.snapshot(), input.sessionId)
    if (session.cursor) throw new Error('session is suspended; resume it instead of starting a new turn')
    if (input.policy) this.ctx.sessions.patch(session.id, input.policy)
    if (session.title === 'New thread') session.title = threadTitle(input.text)
    const transcript = input.messages.map((message) => ({ ...message }))
    const state: AgentState = {
      sessionId: session.id,
      interactive: input.interactive,
      userText: input.text,
      turnIndex: session.turnIndex,
      transcript,
      messages: withWorkspaceNote(transcript, session.policy),
      toolCalls: [],
      gateReason: '',
      confirmed: null,
      policy: session.policy,
      sampling: input.sampling,
    }
    return this.execute(session, (signal) => this.ctx.graphs.run(this.ctx.graphs.config.default, state, { signal }))
  }

  async resume(sessionId: string, value: unknown): Promise<TurnResult> {
    const session = this.ctx.sessions.require(sessionId)
    const cursor = session.cursor
    if (!cursor) throw new Error('session is not suspended')
    return this.execute(session, (signal) => this.ctx.graphs.run(this.ctx.graphs.config.default, cursor.state, {
      resume: { node: cursor.node, value, payload: cursor.payload, step: cursor.step },
      signal,
    }))
  }

  private async execute(session: Session, run: (signal: AbortSignal) => Promise<Outcome<AgentState>>): Promise<TurnResult> {
    const controller = new AbortController()
    this.stops.set(session.id, controller)
    try {
      return this.finish(session, await run(controller.signal))
    } finally {
      this.stops.delete(session.id)
    }
  }

  private finish(session: Session, outcome: Outcome<AgentState>): TurnResult {
    session.transcript = outcome.state.transcript
    session.policy = outcome.state.policy
    if (outcome.status === 'suspended') {
      this.ctx.sessions.remember(session.id, outcome)
      this.ctx.sessions.persist(session)
      return {
        status: 'suspended',
        sessionId: session.id,
        message: lastAssistant(outcome.state.transcript),
        messages: outcome.state.messages,
        payload: outcome.payload,
      }
    }
    this.ctx.sessions.clearCursor(session.id)
    session.turnIndex += 1
    this.ctx.sessions.persist(session)
    return {
      status: 'done',
      sessionId: session.id,
      message: lastAssistant(outcome.state.transcript),
      messages: outcome.state.messages,
    }
  }
}

function withWorkspaceNote(messages: Message[], policy: SessionPolicy): Message[] {
  if (hasWorkspace(policy)) return messages
  return [{
    role: 'system',
    content: 'This session has no working directory. You cannot read or edit files or run commands.',
  }, ...messages]
}

function lastAssistant(messages: Message[]): Message | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant') return message
  }
  return null
}

export default Agent
