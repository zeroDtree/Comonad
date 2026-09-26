import { GraphConfigError, type GraphsConfig, type NodeConfig } from './runtime.ts'

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/

export const DEFAULT_GRAPH_SOURCE = `flowchart TD
  %% start: llm
  llm["llm.complete"] -->|route: agent.after-llm| reject["agent.reject"]
  llm -->|route: agent.after-llm| confirm["agent.confirm"]
  llm -->|route: agent.after-llm| tools["agent.tools"]
  llm -->|route: agent.after-llm| End
  reject --> llm
  confirm -->|route: agent.after-confirm| tools
  confirm -->|route: agent.after-confirm| reject
  tools --> llm
`

interface DraftNode {
  use?: string
  graph?: string
  enter?: string
  leave?: string
  kind?: 'next' | 'route' | 'soft'
  next?: string
  route?: string
  targets: string[]
  choices: { id: string; description: string }[]
}

interface DraftGraph {
  name: string
  nodes: Map<string, DraftNode>
  start?: string
  soft: Map<string, string>
}

export function parseGraphSource(text: string): GraphsConfig {
  const graphs: DraftGraph[] = []
  let current: DraftGraph | null = null
  let pendingName: string | undefined
  let defaultName: string | undefined

  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) {
      const directive = readDirective(line)
      if (!directive) continue
      if (directive.kind === 'graph') {
        if (pendingName) throw new GraphConfigError('%% graph: name')
        pendingName = directive.value
        continue
      }
      if (directive.kind === 'default') {
        if (defaultName && defaultName !== directive.value) throw new GraphConfigError('%% default is already set')
        defaultName = directive.value
        continue
      }
      if (!current) throw new GraphConfigError(`flowchart TD is required before %% ${directive.kind}`)
      if (directive.kind === 'start') {
        if (current.start && current.start !== directive.value) throw new GraphConfigError(`graph ${current.name} already has a start`)
        current.start = directive.value
        continue
      }
      const previous = current.soft.get(directive.value)
      if (previous !== undefined && previous !== directive.instruct) {
        throw new GraphConfigError(`%% soft ${directive.value} is already set`)
      }
      current.soft.set(directive.value, directive.instruct ?? '')
      continue
    }
    const flow = line.match(/^flowchart\s+(TD|TB|LR|RL|BT)\s*$/i)
    if (flow) {
      const name = pendingName ?? (graphs.length === 0 ? 'agent' : undefined)
      pendingName = undefined
      if (!name) throw new GraphConfigError('name this graph with %% graph: id')
      if (graphs.some((graph) => graph.name === name)) throw new GraphConfigError(`duplicate graph ${name}`)
      current = { name, nodes: new Map(), soft: new Map() }
      graphs.push(current)
      continue
    }
    if (!current) throw new GraphConfigError('flowchart TD is required')
    const arrows = line.split('-->').length - 1
    if (arrows > 1) throw new GraphConfigError('one edge per line')
    if (arrows === 0) throw new GraphConfigError('expected an edge')
    readEdge(current, line)
  }

  if (graphs.length === 0) throw new GraphConfigError('flowchart TD is required')
  if (pendingName) throw new GraphConfigError('%% graph: name')
  const fallback = graphs.length === 1 ? graphs[0]!.name : graphs.some((graph) => graph.name === 'agent') ? 'agent' : undefined
  const selected = defaultName ?? fallback
  if (!selected || !graphs.some((graph) => graph.name === selected)) {
    throw new GraphConfigError(defaultName ? `unknown graph ${defaultName}` : 'add %% default: name')
  }

  return {
    default: selected,
    graphs: Object.fromEntries(graphs.map((graph) => [graph.name, finishGraph(graph)])),
  }
}

function readDirective(line: string): { kind: 'graph' | 'default' | 'start'; value: string; instruct?: string } | { kind: 'soft'; value: string; instruct: string } | null {
  const known = line.match(/^%%\s*(graph|default|start|soft)\b(.*)$/)
  if (!known) return null
  const kind = known[1] as 'graph' | 'default' | 'start' | 'soft'
  const rest = known[2] ?? ''
  if (kind === 'soft') {
    const match = rest.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\S.*)$/)
    if (!match) throw new GraphConfigError('%% soft id: instruct')
    return { kind, value: match[1]!, instruct: match[2]!.trim() }
  }
  const match = rest.match(/^:\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/)
  if (!match) throw new GraphConfigError(`%% ${kind}: ${kind === 'default' ? 'name' : kind === 'graph' ? 'name' : 'id'}`)
  return { kind, value: match[1]! }
}

function readEdge(graph: DraftGraph, line: string) {
  const arrow = line.indexOf('-->')
  const left = readNode(line.slice(0, arrow).trim())
  if (left.rest) throw new GraphConfigError(`unexpected text after ${left.id}`)
  if (left.id === 'End') throw new GraphConfigError('End is not a node')
  let rightText = line.slice(arrow + 3).trim()
  let label: string | undefined
  if (rightText.startsWith('|')) {
    const close = rightText.indexOf('|', 1)
    if (close < 0) throw new GraphConfigError('unclosed edge label')
    label = rightText.slice(1, close).trim()
    if (!label) throw new GraphConfigError('edge label must start with route: or soft:')
    rightText = rightText.slice(close + 1).trim()
  }
  const right = readNode(rightText)
  if (right.rest) throw new GraphConfigError(`unexpected text after ${right.id}`)
  const source = touch(graph, left.id, left.label)
  touch(graph, right.id, right.label)
  const target = right.id === 'End' ? 'end' : right.id
  connect(source, left.id, target, label)
}

function readNode(input: string): { id: string; label?: string; rest: string } {
  const match = input.match(/^([A-Za-z_][A-Za-z0-9_]*)/)
  if (!match?.[1]) throw new GraphConfigError('expected a node id')
  const id = match[1]
  let rest = input.slice(id.length)
  if (!rest.startsWith('[')) return { id, rest: rest.trim() }
  let label = ''
  if (rest.startsWith('["')) {
    const end = rest.indexOf('"]', 2)
    if (end < 0) throw new GraphConfigError('unclosed node label')
    label = rest.slice(2, end)
    rest = rest.slice(end + 2)
  } else if (rest.startsWith("['")) {
    const end = rest.indexOf("']", 2)
    if (end < 0) throw new GraphConfigError('unclosed node label')
    label = rest.slice(2, end)
    rest = rest.slice(end + 2)
  } else {
    const end = rest.indexOf(']')
    if (end < 0) throw new GraphConfigError('unclosed node label')
    label = rest.slice(1, end).trim()
    rest = rest.slice(end + 1)
  }
  return { id, label, rest: rest.trim() }
}

function touch(graph: DraftGraph, id: string, label?: string): DraftNode | undefined {
  if (id === 'end') throw new GraphConfigError('use End instead of end')
  if (id === 'End') {
    if (label !== undefined) throw new GraphConfigError('End has no implementation')
    return undefined
  }
  let node = graph.nodes.get(id)
  if (!node) {
    node = { targets: [], choices: [] }
    graph.nodes.set(id, node)
  }
  if (label !== undefined) applyLabel(node, id, label)
  return node
}

function applyLabel(node: DraftNode, id: string, label: string) {
  const call = label.match(/^graph\.call\s+(\S+)\s+(\S+)\s+(\S+)$/)
  if (label === 'graph.call' || label.startsWith('graph.call ')) {
    if (!call || !IDENT.test(call[1]!) || !NAME.test(call[2]!) || !NAME.test(call[3]!)) {
      throw new GraphConfigError('graph.call needs a graph, enter, and leave')
    }
    assign(node, id, { use: 'graph.call', graph: call[1], enter: call[2], leave: call[3] })
    return
  }
  if (!NAME.test(label)) throw new GraphConfigError(`invalid implementation ${label}`)
  assign(node, id, { use: label })
}

function assign(node: DraftNode, id: string, next: Pick<DraftNode, 'use' | 'graph' | 'enter' | 'leave'>) {
  const conflict = (node.use && node.use !== next.use)
    || (node.graph && node.graph !== next.graph)
    || (node.enter && node.enter !== next.enter)
    || (node.leave && node.leave !== next.leave)
  if (conflict) throw new GraphConfigError(`node ${id} has two implementations`)
  node.use = next.use
  node.graph = next.graph
  node.enter = next.enter
  node.leave = next.leave
}

function connect(node: DraftNode | undefined, id: string, target: string, label?: string) {
  if (!node) return
  const kind = classify(label)
  if (node.kind && node.kind !== kind.kind) throw new GraphConfigError(`node ${id} has two exit kinds`)
  node.kind = kind.kind
  if (kind.kind === 'next') {
    if (node.next) throw new GraphConfigError(`node ${id} has two next edges`)
    node.next = target
    return
  }
  if (kind.kind === 'route') {
    if (node.route && node.route !== kind.name) throw new GraphConfigError(`node ${id} route edges must share one route name`)
    if (node.targets.includes(target)) throw new GraphConfigError(`node ${id} already points at ${target}`)
    node.route = kind.name
    node.targets.push(target)
    return
  }
  if (node.choices.some((choice) => choice.id === target)) throw new GraphConfigError(`node ${id} already points at ${target}`)
  node.choices.push({ id: target, description: kind.description })
}

function classify(label?: string): { kind: 'next' } | { kind: 'route'; name: string } | { kind: 'soft'; description: string } {
  if (label === undefined) return { kind: 'next' }
  if (label.startsWith('route:')) {
    const name = label.slice('route:'.length).trim()
    if (!NAME.test(name)) throw new GraphConfigError(`invalid route ${name || label}`)
    return { kind: 'route', name }
  }
  if (label.startsWith('soft:')) {
    const description = label.slice('soft:'.length).trim()
    if (!description) throw new GraphConfigError('soft edge needs a description')
    return { kind: 'soft', description }
  }
  throw new GraphConfigError('edge label must start with route: or soft:')
}

function finishGraph(graph: DraftGraph): GraphsConfig['graphs'][string] {
  if (graph.nodes.size === 0) throw new GraphConfigError('flowchart has no nodes')
  const nodes: Record<string, NodeConfig> = {}
  const incoming = new Map<string, number>()
  for (const id of graph.nodes.keys()) incoming.set(id, 0)
  for (const node of graph.nodes.values()) {
    for (const target of exits(node)) {
      if (target !== 'end') incoming.set(target, (incoming.get(target) ?? 0) + 1)
    }
  }
  for (const [id, node] of graph.nodes) {
    if (!node.kind) throw new GraphConfigError(`node ${id} needs an outgoing edge`)
    const instruct = graph.soft.get(id)
    if (node.kind === 'soft' && !instruct) throw new GraphConfigError(`node ${id} needs %% soft ${id}: instruct`)
    if (instruct !== undefined && node.kind !== 'soft') throw new GraphConfigError(`%% soft ${id} needs soft edges`)
    const config: NodeConfig = { use: node.use ?? id }
    if (node.graph) {
      config.graph = node.graph
      config.enter = node.enter
      config.leave = node.leave
    }
    if (node.kind === 'next') config.next = node.next
    if (node.kind === 'route') {
      config.route = node.route
      config.targets = [...node.targets]
    }
    if (node.kind === 'soft') config.soft = { instruct: instruct!, choices: node.choices }
    nodes[id] = config
  }
  for (const [id, instruct] of graph.soft) {
    if (!graph.nodes.has(id)) throw new GraphConfigError(`%% soft ${id} needs soft edges`)
    if (!instruct.trim()) throw new GraphConfigError(`node ${id} needs %% soft ${id}: instruct`)
  }
  const open = [...graph.nodes.keys()].filter((id) => incoming.get(id) === 0)
  let start = graph.start
  if (start) {
    if (!graph.nodes.has(start)) throw new GraphConfigError(`unknown node ${start}`)
  } else if (open.length === 1) {
    start = open[0]
  } else if (open.length === 0) {
    throw new GraphConfigError(`graph ${graph.name} has no start; add %% start: id`)
  } else {
    throw new GraphConfigError(`graph ${graph.name} has more than one start (${open.join(', ')}); add %% start: id`)
  }
  return { start: start!, nodes }
}

function exits(node: DraftNode): string[] {
  if (node.kind === 'next' && node.next) return [node.next]
  if (node.kind === 'route') return node.targets
  if (node.kind === 'soft') return node.choices.map((choice) => choice.id)
  return []
}
