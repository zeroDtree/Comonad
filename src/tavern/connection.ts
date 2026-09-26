import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface TavernConnection {
  source?: string
  reverseProxy?: string
  proxyPassword?: string
  customUrl?: string
  model?: string
  siliconflowEndpoint?: string
  minimaxEndpoint?: string
  zaiEndpoint?: string
}

interface Source {
  secret: string
  base: string | ((input: TavernConnection) => string)
  proxy?: boolean
}

const SOURCES: Record<string, Source> = {
  openai: { secret: 'api_key_openai', base: 'https://api.openai.com/v1', proxy: true },
  openrouter: { secret: 'api_key_openrouter', base: 'https://openrouter.ai/api/v1' },
  custom: { secret: 'api_key_custom', base: '' },
  mistralai: { secret: 'api_key_mistralai', base: 'https://api.mistral.ai/v1', proxy: true },
  deepseek: { secret: 'api_key_deepseek', base: 'https://api.deepseek.com', proxy: true },
  xai: { secret: 'api_key_xai', base: 'https://api.x.ai/v1', proxy: true },
  groq: { secret: 'api_key_groq', base: 'https://api.groq.com/openai/v1' },
  moonshot: { secret: 'api_key_moonshot', base: 'https://api.moonshot.ai/v1', proxy: true },
  aimlapi: { secret: 'api_key_aimlapi', base: 'https://api.aimlapi.com/v1' },
  chutes: { secret: 'api_key_chutes', base: 'https://llm.chutes.ai/v1' },
  electronhub: { secret: 'api_key_electronhub', base: 'https://api.electronhub.ai/v1' },
  nanogpt: { secret: 'api_key_nanogpt', base: 'https://nano-gpt.com/api/v1' },
  fireworks: { secret: 'api_key_fireworks', base: 'https://api.fireworks.ai/inference/v1' },
  perplexity: { secret: 'api_key_perplexity', base: 'https://api.perplexity.ai' },
  siliconflow: {
    secret: 'api_key_siliconflow',
    base: (input) => input.siliconflowEndpoint === 'cn' ? 'https://api.siliconflow.cn/v1' : 'https://api.siliconflow.com/v1',
  },
  minimax: {
    secret: 'api_key_minimax',
    base: (input) => input.minimaxEndpoint === 'cn' ? 'https://api.minimaxi.com/v1' : 'https://api.minimax.io/v1',
  },
  zai: {
    secret: 'api_key_zai',
    base: (input) => input.zaiEndpoint === 'coding' ? 'https://api.z.ai/api/coding/paas/v4' : 'https://api.z.ai/api/paas/v4',
    proxy: true,
  },
}

export function resolveConnection(userRoot: string, input: TavernConnection): { base: string, key: string, model: string } {
  const source = input.source ?? ''
  const spec = SOURCES[source]
  if (!spec) throw new Error(`SillyTavern source "${source || 'unset'}" is not an OpenAI-compatible chat API`)
  const secret = readSecret(userRoot, spec.secret)
  const configured = typeof spec.base === 'function' ? spec.base(input) : spec.base
  let base = configured
  let key = secret
  if (source === 'custom') {
    if (!input.customUrl?.trim()) throw new Error('SillyTavern custom API URL is empty')
    base = chatBase(input.customUrl)
    key = secret || input.proxyPassword || ''
  } else if (spec.proxy && input.reverseProxy?.trim()) {
    base = chatBase(input.reverseProxy)
    key = input.proxyPassword || secret
  }
  if (!base) throw new Error('SillyTavern API URL is empty')
  if (!key) throw new Error('SillyTavern API key is empty')
  return { base, key, model: input.model?.trim() ?? '' }
}

export function readSecret(userRoot: string, key: string): string {
  const file = join(userRoot, 'secrets.json')
  if (!existsSync(file)) return ''
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { value?: string, active?: boolean }[]>
  const list = parsed[key]
  if (!Array.isArray(list) || list.length === 0) return ''
  const active = list.find((item) => item.active) ?? list[0]
  return typeof active?.value === 'string' ? active.value : ''
}

function chatBase(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}
