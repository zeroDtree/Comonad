import { Context, Service } from 'cordis'
import { capabilityAllowed } from '../domain/policy.ts'
import { hasWorkspace, type Capability, type SessionPolicy, type ToolHost, type ToolSpec } from '../domain/types.ts'

export interface ToolCatalogEntry {
  name: string
  description: string
  capability: Capability
  needsNetwork: boolean
  needsWorkspace: boolean
}

export class Tools extends Service {
  static inject = []

  private specs = new Map<string, ToolSpec>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  add(spec: ToolSpec) {
    this.specs.set(spec.name, spec)
  }

  remove(name: string) {
    this.specs.delete(name)
  }

  get(name: string): ToolSpec | undefined {
    return this.specs.get(name)
  }

  catalog(): ToolCatalogEntry[] {
    return [...this.specs.values()]
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        capability: tool.capability,
        needsNetwork: tool.needsNetwork,
        needsWorkspace: Boolean(tool.needsWorkspace),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  visible(policy: SessionPolicy): ToolSpec[] {
    return [...this.specs.values()].filter((tool) => {
      if (!capabilityAllowed(tool.capability, policy.workMode)) return false
      if (tool.needsNetwork && !policy.network) return false
      if (tool.needsWorkspace && !hasWorkspace(policy)) return false
      return true
    })
  }

  async invoke(name: string, args: unknown, host: ToolHost): Promise<string> {
    const tool = this.specs.get(name)
    if (!tool) return `Error: unknown tool ${name}`
    if (!capabilityAllowed(tool.capability, host.policy.workMode)) {
      return `Error: tool ${name} is not allowed in mode ${host.policy.workMode}`
    }
    if (tool.needsNetwork && !host.policy.network) {
      return `Error: tool ${name} requires network`
    }
    if (tool.needsWorkspace && !hasWorkspace(host.policy)) {
      return 'Error: no working directory'
    }
    try {
      return await tool.execute(args, host)
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export default Tools
