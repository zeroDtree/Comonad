import { describe, expect, it } from 'vitest'
import { compileGraphs, GraphConfigError, runGraph, type GraphRegistry, type GraphsConfig } from './runtime.ts'

interface Box {
  trace: string[]
  n: number
  answer?: unknown
  calls: number
}

function registry(partial: Partial<GraphRegistry<Box>> = {}): GraphRegistry<Box> {
  return {
    nodes: partial.nodes ?? new Map(),
    routes: partial.routes ?? new Map(),
    enters: partial.enters ?? new Map(),
    leaves: partial.leaves ?? new Map(),
  }
}

function box(): Box {
  return { trace: [], n: 0, calls: 0 }
}

describe('graph runtime', () => {
  it('stops a hard cycle at maxSteps', async () => {
    const nodes = new Map<string, GraphRegistry<Box>['nodes'] extends Map<string, infer V> ? V : never>()
    nodes.set('loop', async (state) => {
      state.trace.push('loop')
      return state
    })
    const compiled = compileGraphs({
      default: 'main',
      graphs: { main: { start: 'loop', maxSteps: 2, nodes: { loop: { use: 'loop', next: 'loop' } } } },
    }, registry({ nodes }))
    await expect(runGraph(compiled.get('main')!, box())).rejects.toThrow(/maxSteps \(2\)/)
  })

  it('rejects a soft route id that was not declared', async () => {
    const nodes = new Map<string, (state: Box) => Promise<Box>>()
    nodes.set('pick', async (state) => state)
    const compiled = compileGraphs({
      default: 'main',
      graphs: {
        main: {
          start: 'pick',
          nodes: {
            pick: { use: 'pick', soft: { instruct: 'choose', choices: [{ id: 'end', description: 'stop' }] } },
          },
        },
      },
    }, registry({ nodes }))
    await expect(runGraph(compiled.get('main')!, box(), {
      choose: async () => 'missing',
    })).rejects.toThrow(/undeclared id: missing/)
  })

  it('accepts a declared soft route and stops', async () => {
    const nodes = new Map<string, (state: Box) => Promise<Box>>()
    nodes.set('pick', async (state) => {
      state.trace.push('pick')
      return state
    })
    const compiled = compileGraphs({
      default: 'main',
      graphs: {
        main: {
          start: 'pick',
          nodes: {
            pick: { use: 'pick', soft: { instruct: 'choose', choices: [{ id: 'end', description: 'stop' }] } },
          },
        },
      },
    }, registry({ nodes }))
    const outcome = await runGraph(compiled.get('main')!, box(), { choose: async () => 'end' })
    expect(outcome.status).toBe('done')
    expect(outcome.state.trace).toEqual(['pick'])
  })

  it('maps state into a subgraph and back out', async () => {
    const nodes = new Map<string, (state: Box) => Promise<Box>>()
    nodes.set('run', async (state) => state)
    nodes.set('inc', async (state) => ({ ...state, n: state.n + 1, trace: [...state.trace, 'inc'] }))
    const enters = new Map<string, (parent: Box) => unknown>([['in', (parent) => ({ ...parent })]])
    const leaves = new Map<string, (child: unknown, parent: Box) => Box>([
      ['out', (child, parent) => ({ ...parent, n: (child as Box).n, trace: [...parent.trace, ...(child as Box).trace] })],
    ])
    const compiled = compileGraphs({
      default: 'parent',
      graphs: {
        parent: {
          start: 'run',
          nodes: { run: { use: 'graph.call', graph: 'child', enter: 'in', leave: 'out', next: 'end' } },
        },
        child: { start: 'inc', nodes: { inc: { use: 'inc', next: 'end' } } },
      },
    }, registry({ nodes, enters, leaves }))
    const outcome = await runGraph(compiled.get('parent')!, box())
    expect(outcome.status).toBe('done')
    expect(outcome.state.n).toBe(1)
    expect(outcome.state.trace).toEqual(['inc'])
  })

  it('rejects a subgraph cycle and a nested call past the depth limit', async () => {
    const nodes = new Map<string, (state: Box) => Promise<Box>>()
    nodes.set('run', async (state) => state)
    nodes.set('inc', async (state) => state)
    const enters = new Map<string, (parent: Box) => unknown>([['in', (parent) => parent]])
    const leaves = new Map<string, (child: unknown, parent: Box) => Box>([['out', (_child, parent) => parent]])
    const cyclic: GraphsConfig = {
      default: 'a',
      graphs: {
        a: { start: 'run', nodes: { run: { use: 'graph.call', graph: 'b', enter: 'in', leave: 'out', next: 'end' } } },
        b: { start: 'run', nodes: { run: { use: 'graph.call', graph: 'a', enter: 'in', leave: 'out', next: 'end' } } },
      },
    }
    expect(() => compileGraphs(cyclic, registry({ nodes, enters, leaves }))).toThrow(GraphConfigError)

    const nested = compileGraphs({
      default: 'parent',
      graphs: {
        parent: { start: 'run', nodes: { run: { use: 'graph.call', graph: 'child', enter: 'in', leave: 'out', next: 'end' } } },
        child: { start: 'inc', nodes: { inc: { use: 'inc', next: 'end' } } },
      },
    }, registry({ nodes, enters, leaves }))
    await expect(runGraph(nested.get('parent')!, box(), { maxDepth: 0 })).rejects.toThrow(/depth limit/)
  })

  it('resumes the suspended node with the supplied answer', async () => {
    const nodes = new Map<string, (state: Box, rt: import('./runtime.ts').GraphRuntime) => Promise<Box>>()
    nodes.set('ask', async (state, runtime) => {
      state.calls += 1
      if (!runtime.resuming) runtime.suspend('please')
      return { ...state, answer: runtime.resume }
    })
    const compiled = compileGraphs({
      default: 'main',
      graphs: { main: { start: 'ask', nodes: { ask: { use: 'ask', next: 'end' } } } },
    }, registry({ nodes }))
    const first = await runGraph(compiled.get('main')!, box())
    expect(first.status).toBe('suspended')
    if (first.status !== 'suspended') return
    expect(first.payload).toBe('please')
    expect(first.state.calls).toBe(1)
    const second = await runGraph(compiled.get('main')!, first.state, {
      resume: { node: first.node, value: true, payload: first.payload, step: first.step },
    })
    expect(second.status).toBe('done')
    expect(second.state.answer).toBe(true)
    expect(second.state.calls).toBe(2)
  })

  it('returns before the first node when the signal is already aborted', async () => {
    const nodes = new Map<string, (state: Box) => Promise<Box>>()
    nodes.set('inc', async (state) => ({ ...state, calls: state.calls + 1 }))
    const compiled = compileGraphs({
      default: 'main',
      graphs: { main: { start: 'inc', nodes: { inc: { use: 'inc', next: 'end' } } } },
    }, registry({ nodes }))
    const controller = new AbortController()
    controller.abort()
    const outcome = await runGraph(compiled.get('main')!, box(), { signal: controller.signal })
    expect(outcome.status).toBe('done')
    expect(outcome.state.calls).toBe(0)
    expect(outcome.step).toBe(0)
  })

  it('stops after the aborted node and skips the next one', async () => {
    const nodes = new Map<string, (state: Box, runtime: import('./runtime.ts').GraphRuntime) => Promise<Box>>()
    const controller = new AbortController()
    nodes.set('first', async (state, runtime) => {
      controller.abort()
      if (runtime.signal.aborted) {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      }
      return { ...state, calls: state.calls + 1 }
    })
    nodes.set('second', async (state) => ({ ...state, calls: state.calls + 10 }))
    const compiled = compileGraphs({
      default: 'main',
      graphs: {
        main: {
          start: 'first',
          nodes: {
            first: { use: 'first', next: 'second' },
            second: { use: 'second', next: 'end' },
          },
        },
      },
    }, registry({ nodes }))
    const outcome = await runGraph(compiled.get('main')!, box(), { signal: controller.signal })
    expect(outcome.status).toBe('done')
    expect(outcome.state.calls).toBe(0)
  })

  it('fails when a node implementation name is missing', () => {
    expect(() => compileGraphs({
      default: 'main',
      graphs: { main: { start: 'a', nodes: { a: { use: 'missing', next: 'end' } } } },
    }, registry())).toThrow(/unknown node implementation missing/)
  })
})
