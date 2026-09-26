import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConnection } from './connection.ts'

function user(secrets: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'comonad-secrets-'))
  writeFileSync(join(root, 'secrets.json'), JSON.stringify(secrets))
  return root
}

describe('resolveConnection', () => {
  it('reads the active SillyTavern secret for a custom endpoint', () => {
    const root = user({
      api_key_custom: [
        { id: 'old', value: 'stale', active: false },
        { id: 'now', value: 'live-key', active: true },
      ],
    })
    expect(resolveConnection(root, {
      source: 'custom',
      customUrl: 'https://example/v1/chat/completions',
      model: 'demo',
    })).toEqual({ base: 'https://example/v1', key: 'live-key', model: 'demo' })
  })

  it('uses the reverse proxy and its password', () => {
    const root = user({ api_key_openai: [{ value: 'official', active: true }] })
    expect(resolveConnection(root, {
      source: 'openai',
      reverseProxy: 'https://proxy.example/v1/',
      proxyPassword: 'proxy-key',
    })).toEqual({ base: 'https://proxy.example/v1', key: 'proxy-key', model: '' })
  })

  it('rejects a source that is not a chat-completions API', () => {
    expect(() => resolveConnection(user({}), { source: 'claude' })).toThrow(/not an OpenAI-compatible/)
  })
})
