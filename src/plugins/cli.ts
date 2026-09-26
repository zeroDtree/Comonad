import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { Context } from 'cordis'
import type { Approval, ToolCall, WorkMode } from '../domain/types.ts'
import { appMode } from '../mode.ts'
import { safeSessionId, type Session } from '../services/sessions.ts'

const MODES = new Set<WorkMode>(['ro', 'sw', 'aw', 'pl'])
const APPROVALS = new Set<Approval>([
  'manual',
  'universal_reject',
  'blacklist_reject',
  'whitelist_accept',
  'universal_accept',
])

export default function cliPlugin(ctx: Context) {
  const mode = appMode()
  if (mode !== 'cli') return
  ctx.effect(() => {
    let closed = false
    const task = ctx.graphs.ready.then(() => {
      if (!closed) return repl(ctx)
    })
    return () => {
      closed = true
      return task.then(() => {})
    }
  })
}

cliPlugin.inject = ['agent', 'graphs', 'sessions', 'policy', 'llm']

export function cliSessionId(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}@${pad(now.getHours())}h${pad(now.getMinutes())}m${pad(now.getSeconds())}s${String(now.getMilliseconds()).padStart(3, '0')}ms`
  return `cli - ${stamp}`
}

async function repl(ctx: Context) {
  let session = ctx.sessions.create(ctx.policy.snapshot(), cliSessionId())
  const rl = createInterface({ input: stdin, output: stdout })
  stdout.write(`comonad  model=${ctx.llm.model}  ${statusLine(session)}\n`)
  stdout.write(`session  ${session.id}\n`)
  stdout.write('Commands: !help !mode !network !approval !save !load !exit\n')
  const page = new Page()
  const stopTokens = ctx.on('llm/token', (sessionId, text) => {
    if (sessionId === session.id) page.write('text', text)
  })
  const stopReasoning = ctx.on('llm/reasoning', (sessionId, text) => {
    if (sessionId === session.id) page.write('thought', text)
  })
  const stopDeltas = ctx.on('llm/tool-delta', (sessionId, index, delta) => {
    if (sessionId !== session.id) return
    page.tool(index, `${delta.name ?? ''}${delta.arguments ?? ''}`)
  })
  const stopTools = ctx.on('agent/tool-start', (sessionId) => {
    if (sessionId === session.id) page.break()
  })
  try {
    while (true) {
      const line = (await rl.question('> ')).trim()
      if (!line) continue
      if (line === '!exit') break
      if (line.startsWith('!')) {
        const result = command(ctx, session, line)
        if (result.session) session = result.session
        stdout.write(`${result.text}\n`)
        continue
      }
      page.reset()
      stdout.write('\n')
      let result = await ctx.agent.runTurn({
        sessionId: session.id,
        text: line,
        messages: [...session.transcript, { role: 'user', content: line }],
        interactive: true,
      })
      while (result.status === 'suspended') {
        const calls = Array.isArray(result.payload) ? result.payload as ToolCall[] : []
        for (const call of calls) stdout.write(`\nconfirm ${call.name} ${call.arguments}\n`)
        const answer = (await rl.question('Allow these tools? [y/N] ')).trim().toLowerCase()
        result = await ctx.agent.resume(session.id, answer === 'y' || answer === 'yes')
      }
      if (!result.message?.content) stdout.write('(no assistant text)\n')
      stdout.write('\n')
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'AbortError') throw error
  } finally {
    stopTokens()
    stopReasoning()
    stopDeltas()
    stopTools()
    rl.close()
  }
}

const MODE_HELP = `ro  read files, and a shell that cannot write
sw  also create and edit workspace files
aw  also a shell that can write in the workspace
pl  read files, a read-only shell, and plan files`

const APPROVAL_HELP = `manual             ask before every call
universal_reject   reject every call
blacklist_reject   reject writes, ask for the rest
whitelist_accept   run read-only calls, ask for the rest
universal_accept   run every call the mode allows`

const HELP = `!help                         show this
!mode ro|sw|aw|pl             work mode
!network on|off               network for tools that need it
!approval <policy>            what to do after a call is allowed
!save [name]                  write this chat, or copy it under a name
!load [id]                    list chats, or continue one
!exit                         leave

${MODE_HELP}

${APPROVAL_HELP}`

function statusLine(session: { policy: { workMode: string, network: boolean, approval: string } }): string {
  return `mode=${session.policy.workMode}  network=${session.policy.network ? 'on' : 'off'}  approval=${session.policy.approval}`
}

function asking(value: string): boolean {
  return value === '' || value === 'help' || value === '--help' || value === '-h'
}

export interface CommandResult {
  text: string
  session?: Session
}

export function command(ctx: Context, session: Session, line: string): CommandResult {
  const [name, ...rest] = line.slice(1).trim().split(/\s+/)
  const value = rest.join(' ')
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    return { text: `${statusLine(session)}\n${HELP}` }
  }
  if (name === 'mode') {
    if (asking(value)) return { text: `mode=${session.policy.workMode}\n${MODE_HELP}` }
    if (MODES.has(value as WorkMode)) {
      session.policy.workMode = value as WorkMode
      ctx.sessions.persist(session)
      return { text: `mode=${value}` }
    }
  }
  if (name === 'network') {
    if (asking(value)) return { text: `network=${session.policy.network ? 'on' : 'off'}\n!network on|off` }
    if (value === 'on' || value === 'off') {
      session.policy.network = value === 'on'
      ctx.sessions.persist(session)
      return { text: `network=${value}` }
    }
  }
  if (name === 'approval') {
    if (asking(value)) return { text: `approval=${session.policy.approval}\n${APPROVAL_HELP}` }
    if (APPROVALS.has(value as Approval)) {
      session.policy.approval = value as Approval
      ctx.sessions.persist(session)
      return { text: `approval=${value}` }
    }
  }
  if (name === 'save') return save(ctx, session, value)
  if (name === 'load') return load(ctx, session, value)
  return { text: `unknown command\n${HELP}` }
}

function save(ctx: Context, session: Session, name: string): CommandResult {
  if (!name) {
    ctx.sessions.persist(session)
    return { text: `saved ${session.id}` }
  }
  if (!safeSessionId(name) || ctx.sessions.get(name)) {
    const reason = safeSessionId(name) ? 'already exists' : 'is invalid'
    return { text: `session ${name} ${reason}` }
  }
  const copy = ctx.sessions.copy(session, name)
  return { text: `saved ${copy.id}` }
}

function load(ctx: Context, session: Session, id: string): CommandResult {
  if (!id) return { text: sessionList(ctx) }
  const next = ctx.sessions.get(id)
  if (!next) return { text: sessionList(ctx) }
  if (next.cursor) {
    ctx.sessions.clearCursor(next.id)
    ctx.sessions.persist(next)
  }
  if (session.transcript.length === 0 && session.id !== next.id) ctx.sessions.remove(session.id)
  return { text: `loaded ${next.id}\n${next.title}`, session: next }
}

function sessionList(ctx: Context): string {
  const lines = ctx.sessions.list().map((item) => `${item.id}  ${item.title}`)
  return lines.length ? lines.join('\n') : 'no sessions'
}

type Block = 'thought' | 'text' | 'tool'

class Page {
  private block: Block | null = null
  private readonly tools = new Set<number>()

  reset() {
    this.block = null
    this.tools.clear()
  }

  write(block: 'thought' | 'text', text: string) {
    if (!text) return
    if (this.block !== block) {
      const title = block === 'thought' ? 'Thought\n' : ''
      stdout.write(this.block === null ? title : `\n\n${title}`)
      this.block = block
    }
    stdout.write(text)
  }

  tool(index: number, text: string) {
    if (!text) return
    if (!this.tools.has(index)) {
      this.tools.add(index)
      stdout.write(this.block === null ? `→ ${text}` : `\n→ ${text}`)
      this.block = 'tool'
      return
    }
    stdout.write(text)
  }

  break() {
    if (this.block === null) return
    stdout.write('\n')
    this.block = null
  }
}
