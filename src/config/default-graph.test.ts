import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { DEFAULT_GRAPH_SOURCE, parseGraphSource } from '../graph/mermaid.ts'
import { compileGraphs, runGraph, type GraphRegistry, type GraphsConfig } from '../graph/runtime.ts'

interface Trace {
  visits: string[]
  phase: number
}

function loadDefault(): GraphsConfig {
  const entries = parse(readFileSync('cordis.yml', 'utf8')) as { id: string; config?: { maxSteps?: number; graphs?: unknown } }[]
  const graphs = entries.find((entry) => entry.id === 'graphs')
  if (graphs?.config?.maxSteps !== 32 || graphs.config.graphs) {
    throw new Error('cordis.yml graphs config should only set maxSteps: 32')
  }
  return parseGraphSource(DEFAULT_GRAPH_SOURCE)
}

function stubs(route: () => string): GraphRegistry<Trace> {
  const visit = (name: string) => async (state: Trace) => {
    state.visits.push(name)
    return state
  }
  return {
    nodes: new Map([
      ['llm.complete', visit('llm')],
      ['agent.reject', visit('reject')],
      ['agent.confirm', visit('confirm')],
      ['agent.tools', visit('tools')],
    ]),
    routes: new Map([
      ['agent.after-llm', route],
      ['agent.after-confirm', () => 'end'],
    ]),
    enters: new Map(),
    leaves: new Map(),
  }
}

describe('default agent graph config', () => {
  it('compiles the built-in agent diagram', () => {
    const config = loadDefault()
    expect(config.default).toBe('agent')
    expect(compileGraphs(config, stubs(() => 'end')).get('agent')?.start).toBe('llm')
  })

  it('follows next edges from the config, including a rewritten edge', async () => {
    const config = loadDefault()
    let calls = 0
    const compiled = compileGraphs(config, stubs(() => calls++ === 0 ? 'reject' : 'end'))
    const first = await runGraph(compiled.get('agent')!, { visits: [], phase: 0 })
    expect(first.state.visits).toEqual(['llm', 'reject', 'llm'])

    const rewritten: GraphsConfig = structuredClone(config)
    rewritten.graphs.agent!.nodes.reject!.next = 'end'
    calls = 0
    const once = await runGraph(compileGraphs(rewritten, stubs(() => calls++ === 0 ? 'reject' : 'end')).get('agent')!, { visits: [], phase: 0 })
    expect(once.state.visits).toEqual(['llm', 'reject'])
  })

  it('fails startup compilation when a configured name is missing', () => {
    const config = loadDefault()
    config.graphs.agent!.nodes.llm!.use = 'missing'
    expect(() => compileGraphs(config, stubs(() => 'end'))).toThrow(/unknown node implementation missing/)
  })
})
