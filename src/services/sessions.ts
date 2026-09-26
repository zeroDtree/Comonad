import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context, Service } from 'cordis'
import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '../domain/generation.ts'
import type { AgentState, Message, SessionPolicy } from '../domain/types.ts'
import type { ResumeCursor, Suspended } from '../graph/runtime.ts'

export interface Session {
  id: string
  title: string
  updatedAt: number
  policy: SessionPolicy
  transcript: Message[]
  turnIndex: number
  cursor: (ResumeCursor & { state: AgentState; payload: unknown }) | null
}

export type PolicyPatch = Partial<SessionPolicy>

export function safeSessionId(id: string): boolean {
  if (id.length < 1 || id.length > 240) return false
  return !id.includes('/') && !id.includes('\\') && !id.includes('\0') && !id.includes('..')
}

export function sessionFileId(id: string): string {
  return id.replace(/\s+/g, '')
}

function normalizePolicy(policy: SessionPolicy): SessionPolicy {
  const raw = policy as Partial<SessionPolicy>
  return {
    workMode: policy.workMode,
    approval: policy.approval,
    network: policy.network,
    workingDirectory: policy.workingDirectory ?? '',
    commandTimeout: policy.commandTimeout,
    planDirectory: policy.planDirectory,
    denyReadPaths: policy.denyReadPaths ?? [],
    model: typeof raw.model === 'string' ? raw.model : '',
    temperature: typeof raw.temperature === 'number' && Number.isFinite(raw.temperature) ? raw.temperature : DEFAULT_TEMPERATURE,
    maxTokens: typeof raw.maxTokens === 'number' && Number.isInteger(raw.maxTokens) && raw.maxTokens > 0 ? raw.maxTokens : DEFAULT_MAX_TOKENS,
  }
}

function normalize(session: Session & { lore?: unknown; timed?: unknown }): Session {
  const policy = normalizePolicy(session.policy)
  const { lore: _lore, timed: _timed, ...rest } = session
  return {
    ...rest,
    title: session.title || 'New thread',
    updatedAt: session.updatedAt || 0,
    policy,
    transcript: session.transcript ?? [],
    turnIndex: session.turnIndex ?? 0,
    cursor: session.cursor?.state
      ? { ...session.cursor, state: normalizeState(session.cursor.state) }
      : session.cursor ?? null,
  }
}

export function threadTitle(text: string): string {
  const line = text.split('\n').map((part) => part.trim()).find(Boolean) ?? 'New thread'
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

export function readSessionFiles(dir: string): Session[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const sessions: Session[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      sessions.push(normalize(JSON.parse(readFileSync(join(dir, name), 'utf8')) as Session))
    } catch {
      continue
    }
  }
  return sessions
}

export function writeSessionFile(dir: string, session: Session) {
  if (!safeSessionId(session.id)) throw new Error(`invalid session id ${session.id}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${session.id}.json`), JSON.stringify(session))
}

export class Sessions extends Service {
  static inject = ['paths']

  private sessions = new Map<string, Session>()
  private dir: string

  constructor(ctx: Context) {
    super(ctx, 'sessions')
    this.dir = join(ctx.paths.root, 'data', 'sessions')
    for (const session of readSessionFiles(this.dir)) {
      if (safeSessionId(session.id)) this.sessions.set(session.id, session)
    }
  }

  create(policy: SessionPolicy, id: string = randomUUID()): Session {
    const idOnDisk = sessionFileId(id)
    const session: Session = {
      id: idOnDisk,
      title: 'New thread',
      updatedAt: Date.now(),
      policy: structuredClone(policy),
      transcript: [],
      turnIndex: 0,
      cursor: null,
    }
    this.sessions.set(idOnDisk, session)
    this.persist(session)
    return session
  }

  get(id: string): Session | undefined {
    return this.sessions.get(sessionFileId(id))
  }

  require(id: string): Session {
    const idOnDisk = sessionFileId(id)
    const session = this.sessions.get(idOnDisk)
    if (!session) throw new Error(`unknown session ${idOnDisk}`)
    return session
  }

  patch(id: string, patch: PolicyPatch): Session {
    const session = this.require(id)
    if (patch.workMode) session.policy.workMode = patch.workMode
    if (patch.approval) session.policy.approval = patch.approval
    if (patch.network !== undefined) session.policy.network = patch.network
    if (patch.workingDirectory !== undefined) session.policy.workingDirectory = patch.workingDirectory
    if (patch.commandTimeout) session.policy.commandTimeout = patch.commandTimeout
    if (patch.planDirectory !== undefined) session.policy.planDirectory = patch.planDirectory
    if (patch.denyReadPaths !== undefined) session.policy.denyReadPaths = [...patch.denyReadPaths]
    if (patch.model !== undefined) session.policy.model = patch.model
    if (patch.temperature !== undefined) session.policy.temperature = patch.temperature
    if (patch.maxTokens) session.policy.maxTokens = patch.maxTokens
    session.updatedAt = Date.now()
    this.persist(session)
    return session
  }

  persist(session: Session) {
    session.updatedAt = Date.now()
    writeSessionFile(this.dir, session)
  }

  remember(id: string, suspended: Suspended<AgentState>) {
    const session = this.require(id)
    session.cursor = {
      node: suspended.node,
      value: undefined,
      payload: suspended.payload,
      step: suspended.step,
      state: suspended.state,
    }
  }

  clearCursor(id: string) {
    const session = this.get(id)
    if (session) session.cursor = null
  }

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  copy(source: Session, id: string): Session {
    const idOnDisk = sessionFileId(id)
    if (!safeSessionId(idOnDisk)) throw new Error(`invalid session id ${idOnDisk}`)
    if (this.sessions.has(idOnDisk)) throw new Error(`session ${idOnDisk} already exists`)
    const session = structuredClone(source)
    session.id = idOnDisk
    session.cursor = null
    this.sessions.set(idOnDisk, session)
    this.persist(session)
    return session
  }

  remove(id: string) {
    const idOnDisk = sessionFileId(id)
    if (!this.sessions.delete(idOnDisk)) return
    try {
      unlinkSync(join(this.dir, `${idOnDisk}.json`))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

function normalizeState(state: AgentState & { lore?: unknown; timed?: unknown }): AgentState {
  const { lore: _lore, timed: _timed, ...rest } = state
  return {
    ...rest,
    policy: normalizePolicy(state.policy),
  }
}

export default Sessions
