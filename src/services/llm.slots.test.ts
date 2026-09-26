import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ToolSlots } from './llm.ts'

describe('ToolSlots', () => {
  it('keeps a reused wire index on the call that already owns it', () => {
    const slots = new ToolSlots()
    const first = slots.resolve({ index: 0, id: 'a' })
    const firstArgs = slots.resolve({ index: 0 })
    const second = slots.resolve({ index: 0, id: 'b' })
    const secondArgs = slots.resolve({ index: 0 })
    const firstAgain = slots.resolve({ index: 0, id: 'a' })

    expect(first).toEqual({ emitIndex: 0, id: 'a' })
    expect(firstArgs).toEqual({ emitIndex: 0, id: 'a' })
    expect(second).toEqual({ emitIndex: 1, id: 'b' })
    expect(secondArgs).toEqual({ emitIndex: 1, id: 'b' })
    expect(firstAgain).toEqual({ emitIndex: 0, id: 'a' })
  })
})

describe('trace tool parts', () => {
  const source = readFileSync(new URL('../../extension/index.js', import.meta.url), 'utf8')
  const start = source.indexOf('function toolKey')
  const end = source.indexOf('function traceTexts')
  const { addToolDelta, addToolResult } = new Function(`${source.slice(start, end)}; return { addToolDelta, addToolResult }`)() as {
    addToolDelta: (trace: Trace, data: Delta) => void
    addToolResult: (trace: Trace, data: { id?: string; name?: string; content?: string }) => void
  }

  it('keeps later calls behind earlier ones when index 0 is reused', () => {
    const trace: Trace = { parts: [], tools: {} }
    const turn = new ToolSlots()
    stream(trace, turn, [
      { index: 0, id: 'a', name: 'list_dir', arguments: '{"path":"."}' },
      { index: 0, id: 'b', name: 'read_file', arguments: '{"path":"Readme.md"}' },
    ])
    addToolResult(trace, { id: 'a', name: 'list_dir', content: 'dir' })
    addToolResult(trace, { id: 'b', name: 'read_file', content: 'readme' })

    const next = new ToolSlots()
    stream(trace, next, [
      { index: 0, id: 'c', name: 'write_file', arguments: '{"path":"scratch.md"}' },
    ])
    addToolResult(trace, { id: 'c', name: 'write_file', content: 'wrote' })

    expect(trace.parts.map((part) => part.name)).toEqual(['list_dir', 'read_file', 'write_file'])
    expect(trace.parts.map((part) => part.result)).toEqual(['dir', 'readme', 'wrote'])
  })

  function stream(trace: Trace, slots: ToolSlots, calls: Delta[]) {
    for (const call of calls) {
      const slot = slots.resolve(call)
      addToolDelta(trace, { index: slot.emitIndex, id: slot.id, name: call.name, arguments: call.arguments })
    }
  }
})

interface Delta {
  index: number
  id?: string
  name?: string
  arguments?: string
}

interface Trace {
  parts: { name: string; result?: string }[]
  tools: Record<string, unknown>
}
