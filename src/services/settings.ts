import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Context, Service } from 'cordis'
import { z } from 'zod'
import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '../domain/generation.ts'
import type { Approval, WorkMode } from '../domain/types.ts'
import { McpServerConfig } from '../plugins/mcp.ts'
import type { ToolCatalogEntry } from './tools.ts'

const WorkModeSchema = z.enum(['ro', 'sw', 'aw', 'pl'])
const TraceFormSchema = z.enum(['rendered', 'token', 'raw'])
const ApprovalSchema = z.enum([
  'manual',
  'universal_reject',
  'blacklist_reject',
  'whitelist_accept',
  'universal_accept',
])

const Defaults = z.object({
  workMode: WorkModeSchema,
  approval: ApprovalSchema,
  display: TraceFormSchema,
  context: TraceFormSchema,
  network: z.boolean(),
  workingDirectory: z.string(),
  commandTimeout: z.number().int().positive(),
  planDirectory: z.string(),
  denyReadPaths: z.array(z.string()),
  temperature: z.number(),
  maxTokens: z.number().int().positive(),
})

export interface SettingsDocument {
  locale: 'zh' | 'en'
  api: { base: string; key: string }
  llm: { model: string; maxTokens: number; temperature: number }
  defaults: z.infer<typeof Defaults>
  mcp: z.infer<typeof McpServerConfig>[] | null
  graph: { maxSteps: number; source: string }
}

const FileShape = z.object({
  locale: z.enum(['zh', 'en']).optional(),
  api: z.object({ base: z.string().optional(), key: z.string().optional() }).optional(),
  llm: z.object({
    model: z.string().min(1).optional(),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().optional(),
  }).optional(),
  defaults: Defaults.partial().optional(),
  mcp: z.array(McpServerConfig).nullable().optional(),
  graph: z.object({
    maxSteps: z.number().int().positive().optional(),
    source: z.string().optional(),
  }).optional(),
})

export { FileShape as SettingsPatchSchema }
export type SettingsPatch = z.infer<typeof FileShape>

export interface SettingsView {
  locale: 'zh' | 'en'
  api: { base: string; keySet: boolean; keyHint: string }
  llm: SettingsDocument['llm']
  defaults: SettingsDocument['defaults']
  mcp: z.infer<typeof McpServerConfig>[]
  graph: SettingsDocument['graph'] & { nodes: string[]; routes: string[] }
  tools: ToolCatalogEntry[]
}

export function maskKey(key: string): { keySet: boolean; keyHint: string } {
  if (!key) return { keySet: false, keyHint: '' }
  return { keySet: true, keyHint: key.slice(-4) }
}

export function mergeUpdate(current: SettingsDocument, patch: SettingsPatch): SettingsDocument {
  const next: SettingsDocument = {
    ...current,
    api: { ...current.api },
    llm: { ...current.llm },
    defaults: { ...current.defaults, denyReadPaths: [...current.defaults.denyReadPaths] },
    graph: { ...current.graph },
    mcp: current.mcp ? current.mcp.map((server) => ({ ...server })) : null,
  }
  if (patch.locale) next.locale = patch.locale
  if (patch.api?.base !== undefined) next.api.base = patch.api.base.trim()
  if (patch.api?.key) next.api.key = patch.api.key
  if (patch.llm?.model) next.llm.model = patch.llm.model
  if (patch.llm?.maxTokens) next.llm.maxTokens = patch.llm.maxTokens
  if (patch.llm?.temperature !== undefined) next.llm.temperature = patch.llm.temperature
  if (patch.defaults) {
    next.defaults = {
      ...next.defaults,
      ...patch.defaults,
      denyReadPaths: patch.defaults.denyReadPaths ?? next.defaults.denyReadPaths,
    }
  }
  if (patch.mcp !== undefined) next.mcp = patch.mcp
  if (patch.graph?.maxSteps) next.graph.maxSteps = patch.graph.maxSteps
  if (patch.graph?.source !== undefined) next.graph.source = patch.graph.source
  return next
}

export function loadDocument(saved: unknown, seed: SettingsDocument, env: NodeJS.ProcessEnv): SettingsDocument {
  const file = saved == null ? {} : FileShape.parse(saved)
  const next = mergeUpdate(seed, file)
  if (!file.api?.base && env.LLM_API_BASE) next.api.base = env.LLM_API_BASE
  if (!file.api?.key && env.LLM_API_KEY) next.api.key = env.LLM_API_KEY
  if (file.defaults?.temperature === undefined) next.defaults.temperature = next.llm.temperature
  if (file.defaults?.maxTokens === undefined) next.defaults.maxTokens = next.llm.maxTokens
  if (next.graph.source.includes('prompt.assemble')) next.graph.source = seed.graph.source
  return next
}

export class Settings extends Service {
  static inject = ['paths', 'llm', 'policy', 'graphs', 'tools']

  doc: SettingsDocument
  private readonly file: string

  constructor(ctx: Context) {
    super(ctx, 'settings')
    this.file = join(ctx.paths.root, 'data', 'settings.json')
    this.doc = loadDocument(readJson(this.file), seedFrom(ctx), process.env)
    this.apply()
  }

  view(): SettingsView {
    return {
      locale: this.doc.locale,
      api: { base: this.doc.api.base, ...maskKey(this.doc.api.key) },
      llm: this.doc.llm,
      defaults: this.doc.defaults,
      mcp: this.doc.mcp ?? [],
      graph: {
        maxSteps: this.doc.graph.maxSteps,
        source: this.doc.graph.source,
        ...this.ctx.graphs.symbols(),
      },
      tools: this.ctx.tools.catalog(),
    }
  }

  async update(patch: SettingsPatch): Promise<SettingsView> {
    const parsed = FileShape.parse(patch)
    this.doc = mergeUpdate(this.doc, parsed)
    this.apply()
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.doc))
    if (Array.isArray(this.doc.mcp) && Array.isArray(patch.mcp)) this.ctx.emit('settings/mcp', this.doc.mcp)
    return this.view()
  }

  private apply() {
    const doc = this.doc
    this.ctx.graphs.replace(doc.graph.source, doc.graph.maxSteps)
    this.ctx.llm.config.model = doc.llm.model
    this.ctx.llm.config.maxTokens = doc.llm.maxTokens
    this.ctx.llm.config.temperature = doc.llm.temperature
    this.ctx.llm.setCredentials(doc.api.base, doc.api.key)
    this.ctx.policy.config.workMode = doc.defaults.workMode
    this.ctx.policy.config.approval = doc.defaults.approval
    this.ctx.policy.config.network = doc.defaults.network
    this.ctx.policy.config.workingDirectory = doc.defaults.workingDirectory
    this.ctx.policy.config.commandTimeout = doc.defaults.commandTimeout
    this.ctx.policy.config.planDirectory = doc.defaults.planDirectory
    this.ctx.policy.config.denyReadPaths = [...doc.defaults.denyReadPaths]
    this.ctx.policy.config.temperature = doc.defaults.temperature
    this.ctx.policy.config.maxTokens = doc.defaults.maxTokens
  }
}

function seedFrom(ctx: Context): SettingsDocument {
  const policy = ctx.policy.config
  return {
    locale: 'en',
    api: { base: '', key: '' },
    llm: {
      model: ctx.llm.config.model,
      maxTokens: ctx.llm.config.maxTokens,
      temperature: ctx.llm.config.temperature,
    },
    defaults: {
      workMode: policy.workMode as WorkMode,
      approval: policy.approval as Approval,
      display: 'rendered',
      context: 'rendered',
      network: policy.network,
      workingDirectory: policy.workingDirectory,
      commandTimeout: policy.commandTimeout,
      planDirectory: policy.planDirectory,
      denyReadPaths: [...policy.denyReadPaths],
      temperature: policy.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: policy.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
    mcp: null,
    graph: { maxSteps: ctx.graphs.currentMaxSteps(), source: ctx.graphs.currentSource() },
  }
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

export default Settings
