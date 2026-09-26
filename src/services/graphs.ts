import { Context, Service } from 'cordis'
import { z } from 'zod'
import type { AgentState, Message } from '../domain/types.ts'
import { DEFAULT_GRAPH_SOURCE, parseGraphSource } from '../graph/mermaid.ts'
import {
  compileGraphs,
  GraphConfigError,
  runGraph,
  type CompiledGraphs,
  type EnterFn,
  type GraphRegistry,
  type GraphsConfig,
  type LeaveFn,
  type NodeFn,
  type Outcome,
  type RouteFn,
  type RunOptions,
} from '../graph/runtime.ts'

const Config = z.preprocess((value) => value ?? {}, z.object({
  maxSteps: z.number().int().positive().optional(),
  source: z.string().optional(),
}))

export class Graphs extends Service {
  static inject = ['llm', 'tools', 'policy']
  static Config = Config

  config: GraphsConfig
  readonly ready: Promise<void>
  private nodes = new Map<string, NodeFn<AgentState>>()
  private routes = new Map<string, RouteFn<AgentState>>()
  private enters = new Map<string, EnterFn<AgentState>>()
  private leaves = new Map<string, LeaveFn<AgentState>>()
  private source: string
  private compiled: CompiledGraphs<AgentState> | null = null
  private dirty = true
  private settled = false
  private resolveReady!: () => void
  private rejectReady!: (error: unknown) => void

  constructor(ctx: Context, file: z.infer<typeof Config>) {
    super(ctx, 'graphs')
    this.source = file.source?.trim() ? file.source : DEFAULT_GRAPH_SOURCE
    this.config = parseGraphSource(this.source)
    if (file.maxSteps) {
      const graph = this.config.graphs[this.config.default]
      if (graph) graph.maxSteps = file.maxSteps
    }
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.ready.catch(() => {})
    this.registerBuiltins()
    this.ensureCompiled()
  }

  addNode(name: string, fn: NodeFn<AgentState>) {
    this.nodes.set(name, fn)
    this.dirty = true
  }

  removeNode(name: string) {
    this.nodes.delete(name)
    this.dirty = true
  }

  addRoute(name: string, fn: RouteFn<AgentState>) {
    this.routes.set(name, fn)
    this.dirty = true
  }

  removeRoute(name: string) {
    this.routes.delete(name)
    this.dirty = true
  }

  addEnter(name: string, fn: EnterFn<AgentState>) {
    this.enters.set(name, fn)
    this.dirty = true
  }

  removeEnter(name: string) {
    this.enters.delete(name)
    this.dirty = true
  }

  addLeave(name: string, fn: LeaveFn<AgentState>) {
    this.leaves.set(name, fn)
    this.dirty = true
  }

  removeLeave(name: string) {
    this.leaves.delete(name)
    this.dirty = true
  }

  currentSource(): string {
    return this.source
  }

  currentMaxSteps(): number {
    return this.config.graphs[this.config.default]?.maxSteps ?? 32
  }

  symbols(): { nodes: string[]; routes: string[] } {
    return {
      nodes: [...this.nodes.keys()].sort(),
      routes: [...this.routes.keys()].sort(),
    }
  }

  replace(source: string, maxSteps: number) {
    const next = parseGraphSource(source)
    const graph = next.graphs[next.default]
    if (!graph) throw new GraphConfigError(`unknown graph ${next.default}`)
    graph.maxSteps = maxSteps
    const previous = {
      config: this.config,
      source: this.source,
      dirty: this.dirty,
      compiled: this.compiled,
    }
    this.config = next
    this.source = source
    this.dirty = true
    try {
      this.ensureCompiled()
    } catch (error) {
      this.config = previous.config
      this.source = previous.source
      this.dirty = previous.dirty
      this.compiled = previous.compiled
      throw error
    }
  }

  setMaxSteps(maxSteps: number) {
    const graph = this.config.graphs[this.config.default]
    if (!graph) return
    graph.maxSteps = maxSteps
    this.dirty = true
  }

  ensureCompiled(): CompiledGraphs<AgentState> {
    try {
      if (!this.compiled || this.dirty) {
        const registry: GraphRegistry<AgentState> = {
          nodes: this.nodes,
          routes: this.routes,
          enters: this.enters,
          leaves: this.leaves,
        }
        this.compiled = compileGraphs(this.config, registry)
        this.dirty = false
      }
      if (!this.settled) {
        this.settled = true
        this.resolveReady()
      }
      return this.compiled
    } catch (error) {
      if (!this.settled) {
        this.settled = true
        this.rejectReady(error)
      }
      throw error
    }
  }

  run(id: string, state: AgentState, options: RunOptions = {}): Promise<Outcome<AgentState>> {
    const graph = this.ensureCompiled().get(id)
    if (!graph) throw new Error(`unknown graph ${id}`)
    return runGraph(graph, state, { ...options, choose: (request) => this.ctx.llm.choose(request, options.signal) })
  }

  private registerBuiltins() {
    const ctx = this.ctx
    this.addNode('llm.complete', async (state, runtime) => {
      const result = await ctx.llm.complete(state.messages, ctx.tools.visible(state.policy), state.sessionId, {
        model: state.policy.model.trim() || ctx.llm.model,
        sampling: state.sampling,
      }, runtime.signal)
      if (!result.message.content && !result.message.reasoning && result.toolCalls.length === 0) {
        return { ...state, toolCalls: [] }
      }
      return {
        ...state,
        toolCalls: result.toolCalls,
        messages: [...state.messages, result.message],
        transcript: [...state.transcript, result.message],
      }
    })
    this.addNode('agent.reject', async (state) => {
      const rejected = toolMessages(state, `Rejected: ${state.gateReason || 'policy'}`)
      return { ...state, toolCalls: [], messages: [...state.messages, ...rejected], transcript: [...state.transcript, ...rejected] }
    })
    this.addNode('agent.confirm', async (state, runtime) => {
      if (!runtime.resuming) runtime.suspend(state.toolCalls)
      return { ...state, confirmed: runtime.resume === true }
    })
    this.addNode('agent.tools', async (state) => {
      const host = { sessionId: state.sessionId, policy: state.policy }
      const results: Message[] = []
      for (const call of state.toolCalls) {
        ctx.emit('agent/tool-start', state.sessionId, call)
        let args: unknown = {}
        try {
          args = call.arguments ? JSON.parse(call.arguments) as unknown : {}
        } catch {
          args = {}
        }
        const content = await ctx.tools.invoke(call.name, args, host)
        ctx.emit('agent/tool-result', state.sessionId, call, content)
        results.push({ role: 'tool', toolCallId: call.id, content })
      }
      return {
        ...state,
        toolCalls: [],
        messages: [...state.messages, ...results],
        transcript: [...state.transcript, ...results],
      }
    })
    this.addRoute('agent.after-llm', (state) => {
      if (state.toolCalls.length === 0) return 'end'
      const decision = ctx.bail('agent/tool-decision', state) ?? 'confirm'
      if (decision === 'allow') return 'tools'
      if (decision === 'reject' || !state.interactive) return 'reject'
      return 'confirm'
    })
    this.addRoute('agent.after-confirm', (state) => state.confirmed ? 'tools' : 'reject')
  }
}

function toolMessages(state: AgentState, content: string): Message[] {
  return state.toolCalls.map((call) => ({ role: 'tool', toolCallId: call.id, content }))
}

export default Graphs
