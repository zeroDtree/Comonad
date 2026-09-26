import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import { pathToFileURL } from 'node:url'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { Message, ToolCall } from './domain/types.ts'
import { keepChange, readWorkspaceFile, undoChange, workspaceDiff, writeWorkspaceFile } from './git/diff.ts'
import { captureCheckpoint, revertCheckpoint } from './git/checkpoint.ts'
import { SettingsPatchSchema } from './services/settings.ts'
import { resolveConnection, type TavernConnection } from './tavern/connection.ts'

const PolicyInput = z.object({
  workMode: z.enum(['ro', 'sw', 'aw', 'pl']).optional(),
  approval: z.enum([
    'manual',
    'universal_reject',
    'blacklist_reject',
    'whitelist_accept',
    'universal_accept',
  ]).optional(),
  network: z.boolean().optional(),
  workingDirectory: z.string().optional(),
  commandTimeout: z.number().int().positive().optional(),
  planDirectory: z.string().optional(),
  denyReadPaths: z.array(z.string()).optional(),
}).optional()

const TurnBody = z.object({
  chatId: z.string().min(1),
  text: z.string().optional(),
  messages: z.array(z.object({
    role: z.string(),
    content: z.unknown().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      arguments: z.string().optional(),
      function: z.object({
        name: z.string().optional(),
        arguments: z.string().optional(),
      }).optional(),
    })).optional(),
  })),
  policy: PolicyInput,
  connection: z.object({
    source: z.string().optional(),
    reverseProxy: z.string().optional(),
    proxyPassword: z.string().optional(),
    customUrl: z.string().optional(),
    model: z.string().optional(),
    siliconflowEndpoint: z.string().optional(),
    minimaxEndpoint: z.string().optional(),
    zaiEndpoint: z.string().optional(),
  }).optional(),
  checkpoint: z.string().optional(),
  checkpointAction: z.enum(['capture', 'restore', 'keep']).optional(),
  sampling: z.record(z.string(), z.unknown()).optional(),
})

const ResumeBody = z.object({
  chatId: z.string().min(1),
  allow: z.boolean(),
})

const StopBody = z.object({
  chatId: z.string().min(1),
})

const ReviewBody = z.object({
  chatId: z.string().min(1),
  path: z.string().min(1),
  directory: z.string().optional(),
  hunk: z.number().int().nonnegative().optional(),
})

const FileBody = z.object({
  path: z.string().min(1),
  directory: z.string().optional(),
  text: z.string(),
})

const RevertBody = z.object({
  chatId: z.string().min(1),
  directory: z.string().min(1),
  checkpoint: z.string().min(1),
})

interface Reply {
  setHeader(name: string, value: string): void
  flushHeaders(): void
  flush?(): void
  write(chunk: string): void
  end(): void
  status(code: number): { json(body: unknown): void }
}

interface Request {
  body?: unknown
  query?: Record<string, unknown>
  user?: { directories?: { root?: string } }
}

interface Router {
  post(path: string, handler: (req: Request, res: Reply) => void): void
  get(path: string, handler: (req: Request, res: Reply) => void): void
  delete(path: string, handler: (req: Request, res: Reply) => void): void
}

let ctx: Context | null = null

export const info = {
  id: 'comonad',
  name: 'Comonad',
  description: 'Runs the agent tool loop on prompts SillyTavern has already assembled.',
}

export async function init(router: Router): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const context = new Context()
  const base = pathToFileURL(root)
  context.baseUrl = base.href.endsWith('/') ? base.href : `${base.href}/`
  await context.plugin(Loader)
  await context.loader.create({
    name: '@cordisjs/plugin-include',
    config: { path: './cordis.yml' },
  })
  await context.loader.await()
  context.graphs.ensureCompiled()
  ctx = context

  router.post('/turn', (req, res) => {
    const body = TurnBody.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: 'invalid turn' })
      return
    }
    const messages = toMessages(body.data.messages)
    const linked = linkConnection(context, req, body.data.chatId, body.data.connection)
    if (linked) {
      res.status(400).json({ error: linked })
      return
    }
    const directory = body.data.policy?.workingDirectory || ''
    const action = body.data.checkpointAction ?? 'capture'
    void (async () => {
      if (body.data.checkpoint && directory && action !== 'keep') {
        try {
          if (action === 'restore') await restoreCheckpoint(directory, body.data.chatId, body.data.checkpoint)
          else await captureCheckpoint(directory, body.data.chatId, body.data.checkpoint)
        } catch (error) {
          res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
          return
        }
      }
      void handle(res, body.data.chatId, () => context.agent.runTurn({
        sessionId: body.data.chatId,
        text: body.data.text ?? lastUserText(messages),
        messages,
        policy: {
          ...body.data.policy,
          model: body.data.connection?.model,
        },
        sampling: body.data.sampling,
        interactive: true,
      }))
    })()
  })
  router.post('/resume', (req, res) => {
    const body = ResumeBody.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: 'invalid resume' })
      return
    }
    void handle(res, body.data.chatId, () => context.agent.resume(body.data.chatId, body.data.allow))
  })
  router.post('/stop', (req, res) => {
    const body = StopBody.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: 'invalid stop' })
      return
    }
    res.status(200).json({ stopped: context.agent.stop(body.data.chatId) })
  })
  router.get('/settings', (_req, res) => {
    const current = ctx
    if (!current) {
      res.status(503).json({ error: 'plugin is stopped' })
      return
    }
    res.status(200).json(current.settings.view())
  })
  router.post('/settings', (req, res) => {
    const body = SettingsPatchSchema.safeParse(req.body)
    const current = ctx
    if (!body.success || !current) {
      res.status(400).json({ error: 'invalid settings' })
      return
    }
    void current.settings.update(body.data).then((view) => {
      res.status(200).json(view)
    }).catch((error: unknown) => {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    })
  })
  router.get('/browse', (req, res) => {
    const requested = typeof req.query?.path === 'string' ? req.query.path : ''
    void listDirectories(requested).then((body) => {
      res.status(200).json(body)
    }).catch((error: unknown) => {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    })
  })
  router.get('/diff', (req, res) => {
    const directory = workspaceOf(context, req)
    const chatId = typeof req.query?.chatId === 'string' ? req.query.chatId : ''
    void workspaceDiff(directory, chatId).then((diff) => {
      res.status(200).json({
        available: diff.available,
        files: diff.files.map(({ patch: _patch, ...file }) => file),
      })
    }).catch((error: unknown) => {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    })
  })
  router.post('/diff/keep', (req, res) => review(req, res, keepChange))
  router.post('/diff/undo', (req, res) => review(req, res, undoChange))
  router.post('/revert', (req, res) => {
    const body = RevertBody.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: 'invalid revert' })
      return
    }
    void revertCheckpoint(body.data.directory, body.data.chatId, body.data.checkpoint).then(() => {
      res.status(200).json({ ok: true })
    }).catch((error: unknown) => {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    })
  })
  router.get('/file', (req, res) => {
    const directory = workspaceOf(context, req)
    const path = typeof req.query?.file === 'string' ? req.query.file : ''
    void readWorkspaceFile(directory, path).then((text) => {
      res.status(200).json({ text })
    }).catch((error: unknown) => {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    })
  })
  router.post('/file', (req, res) => {
    const body = FileBody.safeParse(req.body)
    const current = ctx
    if (!body.success || !current) {
      res.status(400).json({ error: 'invalid file' })
      return
    }
    const directory = body.data.directory || workspaceOf(current, req)
    void writeWorkspaceFile(directory, body.data.path, body.data.text).then(() => {
      res.status(200).json({ ok: true })
    }).catch((error: unknown) => {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    })
  })
}

function workspaceOf(context: Context, req: Request): string {
  const chatId = typeof req.query?.chatId === 'string' ? req.query.chatId : ''
  const requested = typeof req.query?.path === 'string' ? req.query.path : ''
  const session = chatId ? context.sessions.get(chatId) : undefined
  return requested || session?.policy.workingDirectory || context.policy.config.workingDirectory
}

function review(req: Request, res: Reply, action: (cwd: string, chatId: string, file: string, hunk?: number) => Promise<void>): void {
  const body = ReviewBody.safeParse(req.body)
  const current = ctx
  if (!body.success || !current) {
    res.status(400).json({ error: 'invalid review' })
    return
  }
  const directory = body.data.directory || workspaceOf(current, req)
  void action(directory, body.data.chatId, body.data.path, body.data.hunk).then(() => {
    res.status(200).json({ ok: true })
  }).catch((error: unknown) => {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  })
}

function linkConnection(context: Context, req: Request, sessionId: string, connection: TavernConnection | undefined): string | undefined {
  if (!connection?.source) return undefined
  const root = req.user?.directories?.root
  if (!root) return 'SillyTavern user is not available'
  try {
    const resolved = resolveConnection(root, connection)
    context.llm.bind(sessionId, resolved.base, resolved.key)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export async function listDirectories(requested: string): Promise<{ path: string, parent: string | null, directories: string[] }> {
  const path = resolve(requested.trim() || homedir())
  const info = await stat(path)
  if (!info.isDirectory()) throw new Error('not a directory')
  const entries = await readdir(path, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  const parent = dirname(path)
  return { path, parent: parent === path ? null : parent, directories }
}

export async function exit(): Promise<void> {
  const current = ctx
  ctx = null
  if (current) await current.fiber.dispose()
}

export function toMessages(raw: z.infer<typeof TurnBody>['messages']): Message[] {
  const messages: Message[] = []
  for (const item of raw) {
    if (item.role !== 'system' && item.role !== 'user' && item.role !== 'assistant' && item.role !== 'tool') continue
    const toolCalls = item.tool_calls?.flatMap((call): ToolCall[] => {
      const name = call.function?.name || call.name
      if (!name) return []
      return [{
        id: call.id || name,
        name,
        arguments: call.function?.arguments || call.arguments || '',
      }]
    })
    messages.push({
      role: item.role,
      content: textContent(item.content),
      toolCallId: item.tool_call_id,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
    })
  }
  return messages
}

async function restoreCheckpoint(cwd: string, chatId: string, id: string): Promise<void> {
  try {
    await revertCheckpoint(cwd, chatId, id)
  } catch (error) {
    if (missingCheckpoint(error)) return
    throw error
  }
}

function missingCheckpoint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT'
}

function lastUserText(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') return message.content
  }
  return ''
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    if (part && typeof part === 'object' && 'text' in part) return String((part as { text: unknown }).text)
    return ''
  }).filter(Boolean).join('\n')
}

async function handle(res: Reply, sessionId: string, run: () => Promise<{ status: 'done' | 'suspended'; message: Message | null; payload?: unknown }>) {
  const agent = ctx
  if (!agent) {
    res.status(503).json({ error: 'plugin is stopped' })
    return
  }
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.flushHeaders()
  const stops = [
    agent.on('llm/token', (id, text) => {
      if (id === sessionId) write(res, 'token', { text })
    }),
    agent.on('llm/reasoning', (id, text) => {
      if (id === sessionId) write(res, 'reasoning', { text })
    }),
    agent.on('llm/tool-delta', (id, index, delta) => {
      if (id === sessionId) write(res, 'tool-delta', { index, id: delta.id, name: delta.name, arguments: delta.arguments })
    }),
    agent.on('agent/tool-start', (id, call) => {
      if (id === sessionId) write(res, 'tool', { name: call.name })
    }),
    agent.on('agent/tool-result', (id, call, content) => {
      if (id === sessionId) write(res, 'tool-result', { id: call.id, name: call.name, content })
    }),
  ]
  try {
    const result = await run()
    write(res, result.status, {
      status: result.status,
      content: result.message?.content ?? '',
      calls: result.status === 'suspended' ? result.payload ?? [] : undefined,
    })
  } catch (error) {
    write(res, 'error', { message: error instanceof Error ? error.message : String(error) })
  } finally {
    for (const stop of stops) stop()
    res.end()
  }
}

function write(res: Reply, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.flush?.()
}

export default { init, exit, info }
