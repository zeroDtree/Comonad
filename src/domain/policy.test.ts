import { describe, expect, it } from 'vitest'
import { capabilityAllowed, gateTools } from './policy.ts'
import type { SessionPolicy, ToolSpec } from './types.ts'

function tool(name: string, capability: ToolSpec['capability'], needsNetwork = false): ToolSpec {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    capability,
    needsNetwork,
    async execute() {
      return ''
    },
  }
}

function policy(patch: Partial<SessionPolicy> = {}): SessionPolicy {
  return {
    workMode: 'ro',
    approval: 'manual',
    network: false,
    workingDirectory: '/tmp/work',
    commandTimeout: 30,
    planDirectory: '.agent/plans',
    denyReadPaths: ['.env'],
    model: '',
    temperature: 1,
    maxTokens: 8192,
    ...patch,
  }
}

const catalog = new Map<string, ToolSpec>([
  ['read_file', tool('read_file', 'ro')],
  ['write_file', tool('write_file', 'rw')],
  ['run_shell', tool('run_shell', 'shell_rw')],
  ['search', tool('search', 'ro', true)],
])

describe('capability matrix', () => {
  it('allows read and readonly shell in ro mode', () => {
    expect(capabilityAllowed('ro', 'ro')).toBe(true)
    expect(capabilityAllowed('shell_ro', 'ro')).toBe(true)
    expect(capabilityAllowed('rw', 'ro')).toBe(false)
    expect(capabilityAllowed('rw_plan', 'pl')).toBe(true)
    expect(capabilityAllowed('rw', 'pl')).toBe(false)
    expect(capabilityAllowed('shell_rw', 'aw')).toBe(true)
  })
})

describe('gateTools', () => {
  const lookup = (name: string) => catalog.get(name)

  it('rejects an unknown tool before approval', () => {
    const result = gateTools([{ id: '1', name: 'missing', arguments: '{}' }], lookup, policy({ approval: 'universal_accept' }))
    expect(result.decision).toBe('reject')
    expect(result.reason).toMatch(/unknown tool/)
  })

  it('rejects a capability the work mode does not allow', () => {
    const result = gateTools([{ id: '1', name: 'write_file', arguments: '{}' }], lookup, policy())
    expect(result.decision).toBe('reject')
    expect(result.reason).toMatch(/not allowed in mode ro/)
  })

  it('rejects network tools while the network switch is off', () => {
    const result = gateTools([{ id: '1', name: 'search', arguments: '{}' }], lookup, policy({ approval: 'universal_accept' }))
    expect(result.decision).toBe('reject')
    expect(result.reason).toMatch(/network/)
  })

  it('confirms manual approval and accepts a readonly whitelist', () => {
    expect(gateTools([{ id: '1', name: 'read_file', arguments: '{}' }], lookup, policy()).decision).toBe('confirm')
    expect(gateTools(
      [{ id: '1', name: 'read_file', arguments: '{}' }],
      lookup,
      policy({ approval: 'whitelist_accept' }),
    ).decision).toBe('allow')
  })

  it('rejects blacklisted capabilities and confirms the rest', () => {
    expect(gateTools(
      [{ id: '1', name: 'write_file', arguments: '{}' }],
      lookup,
      policy({ workMode: 'aw', approval: 'blacklist_reject' }),
    ).decision).toBe('reject')
    expect(gateTools(
      [{ id: '1', name: 'read_file', arguments: '{}' }],
      lookup,
      policy({ approval: 'blacklist_reject' }),
    ).decision).toBe('confirm')
  })
})
