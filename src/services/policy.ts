import { resolve } from 'node:path'
import { Context, Service } from 'cordis'
import { z } from 'zod'
import { gateTools } from '../domain/policy.ts'
import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '../domain/generation.ts'
import type { Approval, SessionPolicy, WorkMode } from '../domain/types.ts'
import type { Tools } from './tools.ts'

const Config = z.preprocess((value) => value ?? {}, z.object({
  workMode: z.enum(['ro', 'sw', 'aw', 'pl']).default('ro'),
  approval: z.enum([
    'manual',
    'universal_reject',
    'blacklist_reject',
    'whitelist_accept',
    'universal_accept',
  ]).default('manual'),
  network: z.boolean().default(false),
  workingDirectory: z.string().default(''),
  commandTimeout: z.number().int().positive().default(30),
  planDirectory: z.string().default('.agent/plans'),
  denyReadPaths: z.array(z.string()).default(['.env', '**/.env']),
  temperature: z.number().default(DEFAULT_TEMPERATURE),
  maxTokens: z.number().int().positive().default(DEFAULT_MAX_TOKENS),
}))

export class Policy extends Service {
  static inject = ['tools']
  static Config = Config

  config: z.infer<typeof Config>

  constructor(ctx: Context, config: z.infer<typeof Config>) {
    super(ctx, 'policy')
    this.config = config
    ctx.on('agent/tool-decision', (state) => {
      const tools = ctx.tools as Tools
      const gate = gateTools(state.toolCalls, (name) => tools.get(name), state.policy)
      state.gateReason = gate.reason
      if (!state.interactive && gate.decision === 'confirm') {
        state.gateReason = `${gate.reason}; non-interactive sessions cannot confirm`
        return 'reject'
      }
      return gate.decision
    })
  }

  snapshot(): SessionPolicy {
    const directory = this.config.workingDirectory.trim()
    return {
      workMode: this.config.workMode as WorkMode,
      approval: this.config.approval as Approval,
      network: this.config.network,
      workingDirectory: directory ? resolve(directory) : '',
      commandTimeout: this.config.commandTimeout,
      planDirectory: this.config.planDirectory,
      denyReadPaths: [...this.config.denyReadPaths],
      model: '',
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    }
  }
}

export default Policy
