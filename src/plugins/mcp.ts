import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Context, Service } from 'cordis'
import { z } from 'zod'
import type { Capability } from '../domain/types.ts'

const CapabilitySchema = z.enum(['ro', 'rw', 'rw_plan', 'shell_ro', 'shell_rw'])

export const McpServerConfig = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  enabled: z.boolean().optional(),
  defaultCapability: CapabilitySchema.default('ro'),
  defaultNeedsNetwork: z.boolean().default(false),
  tools: z.record(z.object({
    capability: CapabilitySchema.optional(),
    needsNetwork: z.boolean().optional(),
  })).optional(),
})

const Config = z.preprocess((value) => value ?? {}, z.object({
  servers: z.array(McpServerConfig).default([]),
}))

export type McpServer = z.infer<typeof McpServerConfig>
type ServerConfig = McpServer

export class Mcp extends Service {
  static inject = ['tools', 'settings']
  static Config = Config

  private servers: ServerConfig[] = []
  private generation = 0
  private dispose: () => Promise<void> = async () => {}

  constructor(ctx: Context, config: z.infer<typeof Config>) {
    super(ctx, 'mcp')
    this.rebind(ctx.settings.doc.mcp ?? config.servers)
    ctx.on('settings/mcp', (servers) => this.rebind(servers))
  }

  current(): ServerConfig[] {
    return this.servers
  }

  rebind(servers: ServerConfig[]) {
    const generation = ++this.generation
    const previous = this.dispose
    this.servers = servers.map((server) => ({ ...server }))
    this.dispose = async () => {}
    void previous().finally(() => {
      if (generation !== this.generation) return
      this.dispose = connectAll(this.ctx, this.servers)
    })
  }
}

function connectAll(ctx: Context, servers: ServerConfig[]): () => Promise<void> {
  const stops = servers.map((server) => connect(ctx, server))
  return async () => {
    await Promise.all(stops.map((stop) => stop()))
  }
}

function connect(ctx: Context, server: ServerConfig): () => Promise<void> {
  if (server.enabled === false) return async () => {}
  const client = new Client({ name: 'comonad', version: '0.1.0' })
  const names: string[] = []
  let closed = false
  const ready = (async () => {
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
      const listed = await client.listTools()
      if (closed) return
      for (const tool of listed.tools) {
        const override = server.tools?.[tool.name]
        const capability = (override?.capability ?? server.defaultCapability) as Capability
        const needsNetwork = override?.needsNetwork ?? server.defaultNeedsNetwork
        const name = `${server.name}__${tool.name}`
        names.push(name)
        ctx.tools.add({
          name,
          description: tool.description ?? tool.name,
          parameters: (tool.inputSchema as Record<string, unknown> | undefined) ?? { type: 'object', properties: {} },
          capability,
          needsNetwork,
          async execute(args) {
            const result = await client.callTool({ name: tool.name, arguments: asRecord(args) })
            return JSON.stringify(result.content ?? result)
          },
        })
      }
    } catch (error) {
      ctx.logger.warn('mcp server %s skipped: %s', server.name, error instanceof Error ? error.message : error)
    }
  })()
  return async () => {
    closed = true
    await ready.catch(() => {})
    for (const name of names) ctx.tools.remove(name)
    await client.close().catch(() => {})
  }
}

function asRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>
  return {}
}

export default Mcp
