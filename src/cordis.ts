import { Context, Service } from 'cordis'
import type { AgentState, GateDecision, ToolCall } from './domain/types.ts'
import type { Agent } from './services/agent.ts'
import type { Graphs } from './services/graphs.ts'
import type { Llm } from './services/llm.ts'
import type { Paths } from './services/paths.ts'
import type { Policy } from './services/policy.ts'
import type { Sandbox } from './services/sandbox.ts'
import type { Sessions } from './services/sessions.ts'
import type { Settings } from './services/settings.ts'
import type { Tools } from './services/tools.ts'
import type { Mcp, McpServer } from './plugins/mcp.ts'

declare module 'cordis' {
  interface Context {
    paths: Paths
    policy: Policy
    sessions: Sessions
    sandbox: Sandbox
    tools: Tools
    llm: Llm
    graphs: Graphs
    agent: Agent
    settings: Settings
    mcp: Mcp
  }

  interface Events {
    'agent/tool-decision'(state: AgentState): GateDecision | void
    'agent/tool-start'(sessionId: string, call: ToolCall): void
    'agent/tool-result'(sessionId: string, call: ToolCall, content: string): void
    'llm/token'(sessionId: string, text: string): void
    'llm/reasoning'(sessionId: string, text: string): void
    'llm/tool-delta'(sessionId: string, index: number, delta: { id?: string; name?: string; arguments?: string }): void
    'settings/mcp'(servers: McpServer[]): void
  }
}

void Context
void Service
