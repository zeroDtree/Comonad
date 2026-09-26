export interface SoftChoice {
  id: string
  description: string
}

export interface SoftRequest {
  instruct: string
  choices: SoftChoice[]
  state: unknown
}

export interface GraphRuntime {
  resuming: boolean
  resume: unknown
  suspendedPayload: unknown
  depth: number
  maxDepth: number
  signal: AbortSignal
  suspend(payload: unknown): never
  choose(request: SoftRequest): Promise<string>
}

export type NodeFn<S> = (state: S, runtime: GraphRuntime) => Promise<S>
export type RouteFn<S> = (state: S, runtime: GraphRuntime) => string | Promise<string>
export type EnterFn<S> = (parent: S) => unknown
export type LeaveFn<S> = (child: unknown, parent: S) => S

export interface NodeConfig {
  use: string
  next?: string
  route?: string
  targets?: string[]
  soft?: { instruct: string; choices: SoftChoice[] }
  graph?: string
  enter?: string
  leave?: string
}

export interface GraphConfig {
  start: string
  maxSteps?: number
  nodes: Record<string, NodeConfig>
}

export interface GraphsConfig {
  default: string
  graphs: Record<string, GraphConfig>
}

export interface GraphRegistry<S> {
  nodes: Map<string, NodeFn<S>>
  routes: Map<string, RouteFn<S>>
  enters: Map<string, EnterFn<S>>
  leaves: Map<string, LeaveFn<S>>
}

export interface CompiledNode<S> {
  run: NodeFn<S>
  exit(state: S, runtime: GraphRuntime): Promise<string>
}

export interface CompiledGraph<S> {
  id: string
  start: string
  maxSteps: number
  nodes: Map<string, CompiledNode<S>>
}

export type CompiledGraphs<S> = Map<string, CompiledGraph<S>>

export interface Suspended<S> {
  status: 'suspended'
  node: string
  state: S
  payload: unknown
  step: number
  depth: number
}

export interface Finished<S> {
  status: 'done'
  state: S
  step: number
}

export type Outcome<S> = Finished<S> | Suspended<S>

export interface ResumeCursor {
  node: string
  value: unknown
  payload: unknown
  step: number
}

export interface RunOptions {
  maxSteps?: number
  maxDepth?: number
  depth?: number
  choose?: GraphRuntime['choose']
  resume?: ResumeCursor
  signal?: AbortSignal
}

export const DEFAULT_MAX_STEPS = 32
export const DEFAULT_MAX_DEPTH = 8

export class GraphConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphConfigError'
  }
}

export class SuspendSignal {
  constructor(public payload: unknown) {}
}

const END = 'end'

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

function exitCount(node: NodeConfig): number {
  return [node.next, node.route, node.soft].filter((value) => value !== undefined).length
}

function assertTarget(graphId: string, nodeId: string, target: string, nodes: Record<string, NodeConfig>) {
  if (target === END) return
  if (!nodes[target]) {
    throw new GraphConfigError(`graph ${graphId} node ${nodeId} points at unknown node ${target}`)
  }
}

function walkSubgraphs(config: GraphsConfig, id: string, stack: string[]) {
  if (stack.includes(id)) {
    throw new GraphConfigError(`subgraph cycle: ${[...stack, id].join(' -> ')}`)
  }
  const graph = config.graphs[id]
  if (!graph) throw new GraphConfigError(`unknown graph ${id}`)
  for (const node of Object.values(graph.nodes)) {
    if (node.use === 'graph.call' && node.graph) walkSubgraphs(config, node.graph, [...stack, id])
  }
}

export function compileGraphs<S>(config: GraphsConfig, registry: GraphRegistry<S>): CompiledGraphs<S> {
  if (!config.graphs[config.default]) {
    throw new GraphConfigError(`default graph ${config.default} is not defined`)
  }
  for (const id of Object.keys(config.graphs)) walkSubgraphs(config, id, [])

  const compiled: CompiledGraphs<S> = new Map()
  for (const [id, graph] of Object.entries(config.graphs)) {
    if (!graph.nodes[graph.start]) {
      throw new GraphConfigError(`graph ${id} starts at unknown node ${graph.start}`)
    }
    compiled.set(id, {
      id,
      start: graph.start,
      maxSteps: graph.maxSteps ?? DEFAULT_MAX_STEPS,
      nodes: new Map(),
    })
  }

  for (const [id, graph] of Object.entries(config.graphs)) {
    const target = compiled.get(id)!
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (nodeId === END) throw new GraphConfigError(`graph ${id} uses reserved node id end`)
      if (exitCount(node) !== 1) {
        throw new GraphConfigError(`graph ${id} node ${nodeId} must have exactly one of next, route, or soft`)
      }
      target.nodes.set(nodeId, compileNode(config, registry, compiled, id, nodeId, node, graph.nodes))
    }
  }
  return compiled
}

function compileNode<S>(
  config: GraphsConfig,
  registry: GraphRegistry<S>,
  compiled: CompiledGraphs<S>,
  graphId: string,
  nodeId: string,
  node: NodeConfig,
  siblings: Record<string, NodeConfig>,
): CompiledNode<S> {
  const exit = compileExit(registry, graphId, nodeId, node, siblings)
  if (node.use === 'graph.call') {
    if (!node.graph || !node.enter || !node.leave) {
      throw new GraphConfigError(`graph ${graphId} node ${nodeId} graph.call requires graph, enter, and leave`)
    }
    const child = compiled.get(node.graph)
    if (!child) throw new GraphConfigError(`graph ${graphId} node ${nodeId} calls unknown graph ${node.graph}`)
    const enter = registry.enters.get(node.enter)
    const leave = registry.leaves.get(node.leave)
    if (!enter) throw new GraphConfigError(`graph ${graphId} node ${nodeId}: unknown enter ${node.enter}`)
    if (!leave) throw new GraphConfigError(`graph ${graphId} node ${nodeId}: unknown leave ${node.leave}`)
    return {
      async run(parent, runtime) {
        const payload = runtime.suspendedPayload as { kind?: string; child?: Suspended<unknown> } | undefined
        const nested = runtime.resuming && payload?.kind === 'subgraph' ? payload.child : undefined
        const outcome = await runGraph(child as CompiledGraph<unknown>, nested ? nested.state : enter(parent), {
          depth: runtime.depth + 1,
          maxDepth: runtime.maxDepth,
          choose: runtime.choose,
          signal: runtime.signal,
          resume: nested
            ? { node: nested.node, value: runtime.resume, payload: nested.payload, step: nested.step }
            : undefined,
        })
        if (outcome.status === 'suspended') runtime.suspend({ kind: 'subgraph', child: outcome })
        return leave(outcome.state, parent)
      },
      exit,
    }
  }

  const implementation = registry.nodes.get(node.use)
  if (!implementation) {
    throw new GraphConfigError(`graph ${graphId} node ${nodeId}: unknown node implementation ${node.use}`)
  }
  return { run: implementation, exit }
}

function compileExit<S>(
  registry: GraphRegistry<S>,
  graphId: string,
  nodeId: string,
  node: NodeConfig,
  siblings: Record<string, NodeConfig>,
): CompiledNode<S>['exit'] {
  if (node.next !== undefined) {
    assertTarget(graphId, nodeId, node.next, siblings)
    const next = node.next
    return async () => next
  }
  if (node.route !== undefined) {
    const route = registry.routes.get(node.route)
    if (!route) throw new GraphConfigError(`graph ${graphId} node ${nodeId}: unknown route ${node.route}`)
    const name = node.route
    const allowed = node.targets
    if (allowed) {
      for (const target of allowed) assertTarget(graphId, nodeId, target, siblings)
    }
    return async (state, runtime) => {
      const target = await route(state, runtime)
      if (target !== END && !siblings[target]) {
        throw new GraphConfigError(`route ${name} returned unknown node ${target}`)
      }
      if (allowed && !allowed.includes(target)) {
        throw new GraphConfigError(`route ${name} returned undeclared node ${target}`)
      }
      return target
    }
  }
  const soft = node.soft!
  if (soft.choices.length === 0) {
    throw new GraphConfigError(`graph ${graphId} node ${nodeId} soft route has no choices`)
  }
  for (const choice of soft.choices) {
    if (choice.id !== END && !siblings[choice.id]) {
      throw new GraphConfigError(`graph ${graphId} node ${nodeId} soft choice ${choice.id} is not a node or end`)
    }
  }
  const allowed = new Set(soft.choices.map((choice) => choice.id))
  return async (state, runtime) => {
    const picked = await runtime.choose({ instruct: soft.instruct, choices: soft.choices, state })
    if (!allowed.has(picked)) throw new GraphConfigError(`soft route rejected undeclared id: ${picked}`)
    return picked
  }
}

export async function runGraph<S>(graph: CompiledGraph<S>, state: S, options: RunOptions = {}): Promise<Outcome<S>> {
  const maxSteps = options.maxSteps ?? graph.maxSteps
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const depth = options.depth ?? 0
  if (depth > maxDepth) throw new GraphConfigError(`graph depth limit (${maxDepth})`)
  let step = options.resume?.step ?? 0
  let current = options.resume?.node ?? graph.start
  let pending = options.resume

  const signal = options.signal ?? new AbortController().signal
  while (current !== END) {
    if (signal.aborted) return { status: 'done', state, step }
    if (step >= maxSteps) throw new GraphConfigError(`graph exceeded maxSteps (${maxSteps})`)
    const node = graph.nodes.get(current)
    if (!node) throw new GraphConfigError(`unknown node ${current}`)
    const resuming = pending?.node === current
    const runtime: GraphRuntime = {
      resuming,
      resume: resuming ? pending?.value : undefined,
      suspendedPayload: resuming ? pending?.payload : undefined,
      depth,
      maxDepth,
      signal,
      suspend(payload: unknown): never {
        throw new SuspendSignal(payload)
      },
      choose: options.choose ?? (async () => {
        throw new GraphConfigError('soft route requires a chooser')
      }),
    }
    pending = undefined
    try {
      state = await node.run(state, runtime)
    } catch (error) {
      if (error instanceof SuspendSignal) {
        return { status: 'suspended', node: current, state, payload: error.payload, step, depth }
      }
      if (isAbort(error, signal)) return { status: 'done', state, step }
      throw error
    }
    step += 1
    try {
      current = await node.exit(state, runtime)
    } catch (error) {
      if (isAbort(error, signal)) return { status: 'done', state, step }
      throw error
    }
  }
  return { status: 'done', state, step }
}
