import type { Capability, GateDecision, SessionPolicy, ToolCall, ToolSpec, WorkMode } from './types.ts'

export const MODE_CAPS: Record<WorkMode, ReadonlySet<Capability>> = {
  ro: new Set(['ro', 'shell_ro']),
  sw: new Set(['ro', 'rw', 'shell_ro']),
  aw: new Set(['ro', 'rw', 'shell_ro', 'shell_rw']),
  pl: new Set(['ro', 'shell_ro', 'rw_plan']),
}

const AUTO_APPROVE: ReadonlySet<Capability> = new Set(['ro', 'shell_ro'])
const AUTO_REJECT: ReadonlySet<Capability> = new Set(['rw', 'shell_rw', 'rw_plan'])

export function capabilityAllowed(capability: Capability, mode: WorkMode): boolean {
  return MODE_CAPS[mode].has(capability)
}

export interface GateResult {
  decision: GateDecision
  reason: string
}

export function gateTools(
  calls: ToolCall[],
  lookup: (name: string) => ToolSpec | undefined,
  policy: SessionPolicy,
): GateResult {
  for (const call of calls) {
    const tool = lookup(call.name)
    if (!tool) return { decision: 'reject', reason: `unknown tool: ${call.name}` }
    if (!capabilityAllowed(tool.capability, policy.workMode)) {
      return {
        decision: 'reject',
        reason: `tool ${call.name} capability ${tool.capability} is not allowed in mode ${policy.workMode}`,
      }
    }
    if (tool.needsNetwork && !policy.network) {
      return {
        decision: 'reject',
        reason: `tool ${call.name} requires network but network is disabled`,
      }
    }
  }

  switch (policy.approval) {
    case 'manual':
      return { decision: 'confirm', reason: 'manual approval' }
    case 'universal_reject':
      return { decision: 'reject', reason: 'universal reject' }
    case 'universal_accept':
      return { decision: 'allow', reason: 'universal accept' }
    case 'blacklist_reject': {
      const blocked = calls.find((call) => {
        const capability = lookup(call.name)?.capability
        return capability !== undefined && AUTO_REJECT.has(capability)
      })
      if (blocked) return { decision: 'reject', reason: `blacklist reject: ${blocked.name}` }
      return { decision: 'confirm', reason: 'blacklist requires confirmation' }
    }
    case 'whitelist_accept': {
      const pending = calls.find((call) => {
        const capability = lookup(call.name)?.capability
        return capability === undefined || !AUTO_APPROVE.has(capability)
      })
      if (pending) return { decision: 'confirm', reason: `whitelist requires confirmation: ${pending.name}` }
      return { decision: 'allow', reason: 'whitelist accept' }
    }
  }
}
