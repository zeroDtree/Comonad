import { describe, expect, it } from 'vitest'
import { loadDocument, maskKey, mergeUpdate, type SettingsDocument } from './settings.ts'

const seed: SettingsDocument = {
  locale: 'en',
  api: { base: '', key: '' },
  llm: { model: 'demo', maxTokens: 100, temperature: 1 },
  defaults: {
    workMode: 'ro',
    approval: 'manual',
    display: 'rendered',
    context: 'rendered',
    network: false,
    workingDirectory: '.',
    commandTimeout: 30,
    planDirectory: '.agent/plans',
    denyReadPaths: ['.env'],
    temperature: 1,
    maxTokens: 8192,
  },
  mcp: null,
  graph: { maxSteps: 32, source: '' },
}

describe('settings', () => {
  it('masks a secret and leaves an empty key unmarked', () => {
    expect(maskKey('sk-abcdef')).toEqual({ keySet: true, keyHint: 'cdef' })
    expect(maskKey('')).toEqual({ keySet: false, keyHint: '' })
  })

  it('keeps the stored key when a patch omits it', () => {
    const current = { ...seed, api: { base: 'https://old/v1', key: 'secret' } }
    const next = mergeUpdate(current, { api: { base: 'https://new/v1' }, llm: { temperature: 0 } })
    expect(next.api).toEqual({ base: 'https://new/v1', key: 'secret' })
    expect(next.llm.temperature).toBe(0)
    expect(next.llm.model).toBe('demo')
  })

  it('lets a saved file win over the environment', () => {
    const doc = loadDocument(
      { api: { base: 'https://saved/v1', key: 'saved-key' }, locale: 'zh' },
      seed,
      { LLM_API_BASE: 'https://env/v1', LLM_API_KEY: 'env-key' },
    )
    expect(doc.api).toEqual({ base: 'https://saved/v1', key: 'saved-key' })
    expect(doc.locale).toBe('zh')
  })

  it('saves display and context, and fills them when a file omits them', () => {
    const next = mergeUpdate(seed, { defaults: { display: 'token', context: 'raw' } })
    expect(next.defaults.display).toBe('token')
    expect(next.defaults.context).toBe('raw')
    expect(next.defaults.workMode).toBe('ro')
    const kept = loadDocument({ defaults: { workMode: 'sw' } }, seed, {})
    expect(kept.defaults.workMode).toBe('sw')
    expect(kept.defaults.display).toBe('rendered')
    expect(kept.defaults.context).toBe('rendered')
  })

  it('keeps the graph source when a patch only changes max steps', () => {
    const source = 'flowchart TD\n  a --> End\n'
    const next = mergeUpdate({ ...seed, graph: { maxSteps: 32, source } }, { graph: { maxSteps: 8 } })
    expect(next.graph).toEqual({ maxSteps: 8, source })
  })

  it('fills api fields from the environment when the file is absent', () => {
    const doc = loadDocument(undefined, seed, { LLM_API_BASE: 'https://env/v1', LLM_API_KEY: 'env-key' })
    expect(doc.api).toEqual({ base: 'https://env/v1', key: 'env-key' })
  })
})
