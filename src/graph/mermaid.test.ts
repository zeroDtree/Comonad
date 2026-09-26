import { describe, expect, it } from 'vitest'
import { compileGraphs, runGraph, type GraphRegistry } from './runtime.ts'
import { DEFAULT_GRAPH_SOURCE, parseGraphSource } from './mermaid.ts'

function stubs(route: () => string): GraphRegistry<{ visits: string[] }> {
  const visit = (name: string) => async (state: { visits: string[] }) => {
    state.visits.push(name)
    return state
  }
  return {
    nodes: new Map([
      ['prompt.assemble', visit('assemble')],
      ['llm.complete', visit('llm')],
      ['agent.reject', visit('reject')],
      ['agent.confirm', visit('confirm')],
      ['agent.tools', visit('tools')],
    ]),
    routes: new Map([
      ['agent.after-llm', route],
      ['agent.after-confirm', () => 'tools'],
    ]),
    enters: new Map(),
    leaves: new Map(),
  }
}

describe('mermaid graph source', () => {
  it('parses the built-in agent diagram', () => {
    const config = parseGraphSource(DEFAULT_GRAPH_SOURCE)
    expect(config.default).toBe('agent')
    expect(config.graphs.agent).toEqual({
      start: 'llm',
      nodes: {
        llm: { use: 'llm.complete', route: 'agent.after-llm', targets: ['reject', 'confirm', 'tools', 'end'] },
        reject: { use: 'agent.reject', next: 'llm' },
        confirm: { use: 'agent.confirm', route: 'agent.after-confirm', targets: ['tools', 'reject'] },
        tools: { use: 'agent.tools', next: 'llm' },
      },
    })
  })

  it('rejects the reserved id end and a chain of edges', () => {
    expect(() => parseGraphSource('flowchart TD\n  a["prompt.assemble"] --> end\n')).toThrow(/use End instead of end/)
    expect(() => parseGraphSource('flowchart TD\n  a --> b --> End\n')).toThrow(/one edge per line/)
    expect(() => parseGraphSource('flowchart TD\n  not an edge\n')).toThrow(/expected an edge/)
    expect(() => parseGraphSource('flowchart TD\n  a["prompt.assemble"] --> End["stop"]\n')).toThrow(/End has no implementation/)
  })

  it('requires one exit kind and a soft instruct', () => {
    const mixed = `flowchart TD
  ask["planner.ask"] --> edit["plan.write"]
  ask -->|soft: write| End
  edit --> End
`
    expect(() => parseGraphSource(mixed)).toThrow(/two exit kinds/)
    const soft = `flowchart TD
  ask["planner.ask"] -->|soft: write| End
`
    expect(() => parseGraphSource(soft)).toThrow(/%% soft ask: instruct/)
    const instruct = `flowchart TD
  %% soft ask: pick
  ask["planner.ask"] --> End
`
    expect(() => parseGraphSource(instruct)).toThrow(/%% soft ask needs soft edges/)
  })

  it('reads a subgraph call, a named default, and an explicit start', () => {
    const text = `%% graph: child
flowchart LR
  run["echo"] --> End

%% default: agent
%% graph: agent
flowchart TD
  %% start: nested
  other["prompt.assemble"] --> End
  nested["graph.call child enter leave"] --> End
`
    const config = parseGraphSource(text)
    expect(config.default).toBe('agent')
    expect(config.graphs.child?.nodes.run).toEqual({ use: 'echo', next: 'end' })
    expect(config.graphs.agent?.start).toBe('nested')
    expect(config.graphs.agent?.nodes.nested).toEqual({
      use: 'graph.call',
      graph: 'child',
      enter: 'enter',
      leave: 'leave',
      next: 'end',
    })
  })

  it('reads soft choices and the instruct comment', () => {
    const text = `flowchart TD
  %% soft ask: 选择下一步
  ask["planner.ask"] -->|soft: 写补丁| edit["plan.write"]
  ask -->|soft: 停| End
  edit --> End
`
    const config = parseGraphSource(text)
    expect(config.graphs.agent?.start).toBe('ask')
    expect(config.graphs.agent?.nodes.ask).toEqual({
      use: 'planner.ask',
      soft: {
        instruct: '选择下一步',
        choices: [
          { id: 'edit', description: '写补丁' },
          { id: 'end', description: '停' },
        ],
      },
    })
  })

  it('keeps a route inside the drawn targets', async () => {
    const text = `flowchart TD
  assemble["prompt.assemble"] --> llm["llm.complete"]
  llm -->|route: agent.after-llm| End
  llm -->|route: agent.after-llm| reject["agent.reject"]
  reject --> End
`
    const compiled = compileGraphs(parseGraphSource(text), stubs(() => 'assemble'))
    await expect(runGraph(compiled.get('agent')!, { visits: [] })).rejects.toThrow(/returned undeclared node assemble/)
    const allowed = compileGraphs(parseGraphSource(text), stubs(() => 'reject'))
    const done = await runGraph(allowed.get('agent')!, { visits: [] })
    expect(done.state.visits).toEqual(['assemble', 'llm', 'reject'])
  })
})
