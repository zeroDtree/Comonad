export type WorkMode = 'ro' | 'sw' | 'aw' | 'pl'

export type Approval =
  | 'manual'
  | 'universal_reject'
  | 'blacklist_reject'
  | 'whitelist_accept'
  | 'universal_accept'

export type Capability = 'ro' | 'rw' | 'rw_plan' | 'shell_ro' | 'shell_rw'

export type GateDecision = 'allow' | 'confirm' | 'reject'

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  reasoning?: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}

export function hasWorkspace(policy: { workingDirectory: string }): boolean {
  return policy.workingDirectory.trim() !== ''
}

export interface SessionPolicy {
  workMode: WorkMode
  approval: Approval
  network: boolean
  workingDirectory: string
  commandTimeout: number
  planDirectory: string
  denyReadPaths: string[]
  model: string
  temperature: number
  maxTokens: number
}

export interface AgentState {
  sessionId: string
  interactive: boolean
  userText: string
  turnIndex: number
  transcript: Message[]
  messages: Message[]
  toolCalls: ToolCall[]
  gateReason: string
  confirmed: boolean | null
  policy: SessionPolicy
  sampling?: Record<string, unknown>
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  capability: Capability
  needsNetwork: boolean
  needsWorkspace?: boolean
  execute(args: unknown, host: ToolHost): Promise<string>
}

export interface ToolHost {
  sessionId: string
  policy: SessionPolicy
}

export interface JsonSchema {
  [key: string]: unknown
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties: false
}

export function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}
