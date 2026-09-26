import { isAbsolute } from 'node:path'
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import type { AgentState } from '../domain/types.ts'
import { Policy } from './policy.ts'
import { Tools } from './tools.ts'

const policyConfig = {
  workMode: 'ro' as const,
  approval: 'manual' as const,
  network: false,
  workingDirectory: '.',
  commandTimeout: 30,
  planDirectory: '.agent/plans',
  denyReadPaths: ['.env'],
  temperature: 1,
  maxTokens: 8192,
}

function state(patch: Partial<AgentState>): AgentState {
  return {
    sessionId: 's',
    interactive: true,
    userText: 'hi',
    turnIndex: 0,
    transcript: [],
    messages: [],
    toolCalls: [{ id: '1', name: 'read_file', arguments: '{}' }],
    gateReason: '',
    confirmed: null,
    policy: {
      ...policyConfig,
      workingDirectory: '/tmp/work',
      model: '',
      temperature: 1,
      maxTokens: 8192,
    },
    ...patch,
  }
}

describe('policy service', () => {
  it('bails tool decisions from the session policy', async () => {
    const ctx = new Context()
    await ctx.plugin(Tools)
    await ctx.plugin(Policy, policyConfig)
    ctx.tools.add({
      name: 'read_file',
      description: 'read',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      capability: 'ro',
      needsNetwork: false,
      async execute() { return '' },
    })
    ctx.tools.add({
      name: 'write_file',
      description: 'write',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      capability: 'rw',
      needsNetwork: false,
      async execute() { return '' },
    })

    expect(ctx.bail('agent/tool-decision', state({}))).toBe('confirm')
    expect(ctx.bail('agent/tool-decision', state({
      toolCalls: [{ id: '1', name: 'write_file', arguments: '{}' }],
    }))).toBe('reject')
    expect(ctx.bail('agent/tool-decision', state({ interactive: false }))).toBe('reject')
  })

  it('keeps an empty working directory and resolves a real one', async () => {
    const empty = new Context()
    await empty.plugin(Tools)
    await empty.plugin(Policy, { ...policyConfig, workingDirectory: '' })
    expect(empty.policy.snapshot()).toMatchObject({ workingDirectory: '', model: '' })

    const rooted = new Context()
    await rooted.plugin(Tools)
    await rooted.plugin(Policy, { ...policyConfig, workingDirectory: 'src' })
    const directory = rooted.policy.snapshot().workingDirectory
    expect(isAbsolute(directory)).toBe(true)
    expect(directory.endsWith('/src')).toBe(true)
  })

  it('hides workspace tools when the session has no directory', async () => {
    const ctx = new Context()
    await ctx.plugin(Tools)
    const spec = {
      description: 'tool',
      parameters: { type: 'object' as const, properties: {}, additionalProperties: false as const },
      needsNetwork: false,
      async execute() { return 'ran' },
    }
    ctx.tools.add({ ...spec, name: 'read_file', capability: 'ro', needsWorkspace: true })
    ctx.tools.add({ ...spec, name: 'search_knowledge', capability: 'ro', needsNetwork: true })
    const policy = { ...policyConfig, workingDirectory: '', network: true, model: '' }
    expect(ctx.tools.visible(policy).map((tool) => tool.name)).toEqual(['search_knowledge'])
    await expect(ctx.tools.invoke('read_file', {}, { sessionId: 's', policy })).resolves.toBe('Error: no working directory')
  })
})
