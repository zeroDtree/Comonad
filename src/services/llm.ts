import { Context, Service } from 'cordis'
import { z } from 'zod'
import type { Message, ToolCall, ToolSpec } from '../domain/types.ts'
import type { SoftRequest } from '../graph/runtime.ts'

const Config = z.preprocess((value) => value ?? {}, z.object({
  model: z.string().default('deepseek-v4-pro'),
  maxTokens: z.number().int().positive().default(8192),
  temperature: z.number().default(1),
}))

interface Completion {
  message: Message
  toolCalls: ToolCall[]
}

export class Llm extends Service {
  static inject = []
  static Config = Config

  config: z.infer<typeof Config>

  apiBase = process.env.LLM_API_BASE ?? ''
  apiKey = process.env.LLM_API_KEY ?? ''
  private readonly sessions = new Map<string, { base: string, key: string }>()

  constructor(ctx: Context, config: z.infer<typeof Config>) {
    super(ctx, 'llm')
    this.config = config
  }

  setCredentials(base: string, key: string) {
    this.apiBase = base
    this.apiKey = key
  }

  bind(sessionId: string, base: string, key: string) {
    this.sessions.set(sessionId, { base, key })
  }

  get model(): string {
    return this.config.model
  }

  async complete(
    messages: Message[],
    tools: ToolSpec[],
    sessionId: string,
    generation: { model: string; sampling?: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<Completion> {
    const toolCalls = new Map<number, ToolCall>()
    const slots = new ToolSlots()
    let content = ''
    let reasoning = ''
    await this.stream(messages, tools, true, generation, (chunk) => {
      if (chunk.reasoning) {
        reasoning += chunk.reasoning
        this.ctx.emit('llm/reasoning', sessionId, chunk.reasoning)
      }
      if (chunk.content) {
        content += chunk.content
        this.ctx.emit('llm/token', sessionId, chunk.content)
      }
      if (chunk.toolCall) {
        const slot = slots.resolve(chunk.toolCall)
        const current = toolCalls.get(slot.emitIndex) ?? { id: '', name: '', arguments: '' }
        if (slot.id) current.id = slot.id
        current.name += chunk.toolCall.name ?? ''
        current.arguments += chunk.toolCall.arguments ?? ''
        toolCalls.set(slot.emitIndex, current)
        if (chunk.toolCall.name || chunk.toolCall.arguments) {
          this.ctx.emit('llm/tool-delta', sessionId, slot.emitIndex, {
            id: slot.id || undefined,
            name: chunk.toolCall.name,
            arguments: chunk.toolCall.arguments,
          })
        }
      }
    }, undefined, signal, sessionId)
    const stopped = signal?.aborted === true
    const calls = stopped ? [] : [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call], index) => ({ ...call, id: call.id || `call_${index}` }))
    return {
      toolCalls: calls,
      message: {
        role: 'assistant',
        content,
        reasoning: reasoning || undefined,
        toolCalls: calls.length ? calls : undefined,
      },
    }
  }

  async choose(request: SoftRequest, signal?: AbortSignal): Promise<string> {
    const ids = request.choices.map((choice) => choice.id)
    const instruction = [
      request.instruct,
      'Choose exactly one id and return JSON {"id":"..."} .',
      ...request.choices.map((choice) => `- ${choice.id}: ${choice.description}`),
    ].join('\n')
    let content = ''
    await this.stream([
      { role: 'system', content: instruction },
      { role: 'user', content: 'Choose the next node.' },
    ], [], false, { model: this.config.model }, (chunk) => {
      content += chunk.content ?? ''
    }, {
      type: 'json_schema',
      json_schema: {
        name: 'route',
        strict: true,
        schema: {
          type: 'object',
          properties: { id: { type: 'string', enum: ids } },
          required: ['id'],
          additionalProperties: false,
        },
      },
    }, signal)
    if (signal?.aborted) {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    }
    const match = content.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? content) as { id?: string }
    if (!parsed.id) throw new Error('soft route returned no id')
    return parsed.id
  }

  private async stream(
    messages: Message[],
    tools: ToolSpec[],
    streaming: boolean,
    generation: { model: string; sampling?: Record<string, unknown> },
    onChunk: (chunk: StreamChunk) => void,
    responseFormat?: unknown,
    signal?: AbortSignal,
    sessionId = '',
  ) {
    const bound = this.sessions.get(sessionId)
    const apiBase = bound?.base || this.apiBase
    const apiKey = bound?.key || this.apiKey
    if (!apiBase || !apiKey) throw new Error('missing_api')
    if (signal?.aborted) return
    const sampling = generation.sampling
    const body: Record<string, unknown> = {
      model: generation.model || this.config.model,
      messages: messages.map(toOpenAI),
      stream: streaming,
      ...(sampling
        ? sampling
        : { temperature: this.config.temperature, max_tokens: this.config.maxTokens }),
    }
    if (tools.length) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }))
    }
    if (responseFormat) body.response_format = responseFormat
    let response: Response
    try {
      response = await fetch(`${apiBase.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (signal?.aborted) return
      throw error
    }
    if (!response.ok) throw new Error(`LLM request failed (${response.status}): ${await response.text()}`)
    if (!streaming) {
      const json = await response.json() as { choices?: { message?: { content?: string } }[] }
      onChunk({ content: json.choices?.[0]?.message?.content ?? '' })
      return
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('LLM response had no body')
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (!signal?.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const data = line.trim().replace(/^data:\s*/, '')
          if (!data || data === '[DONE]' || !line.trim().startsWith('data:')) continue
          const json = JSON.parse(data) as StreamEvent
          const delta = json.choices?.[0]?.delta
          if (!delta) continue
          const calls = delta.tool_calls ?? []
          if (calls.length === 0) {
            onChunk({
              content: delta.content ?? undefined,
              reasoning: delta.reasoning_content ?? undefined,
            })
            continue
          }
          calls.forEach((call, offset) => {
            onChunk({
              content: offset === 0 ? delta.content ?? undefined : undefined,
              reasoning: offset === 0 ? delta.reasoning_content ?? undefined : undefined,
              toolCall: {
                index: call.index ?? offset,
                id: call.id,
                name: call.function?.name,
                arguments: call.function?.arguments,
              },
            })
          })
        }
      }
    } catch (error) {
      if (signal?.aborted) return
      throw error
    } finally {
      reader.releaseLock()
    }
  }
}

interface StreamChunk {
  content?: string
  reasoning?: string
  toolCall?: { index: number; id?: string; name?: string; arguments?: string }
}

interface StreamEvent {
  choices?: {
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
    }
  }[]
}

export class ToolSlots {
  private next = 0
  private readonly byId = new Map<string, number>()
  private readonly byWire = new Map<number, { id: string; emitIndex: number }>()

  resolve(call: { index: number; id?: string }): { emitIndex: number; id: string } {
    if (call.id && this.byId.has(call.id)) return { emitIndex: this.byId.get(call.id) ?? 0, id: call.id }
    const wire = this.byWire.get(call.index)
    if (call.id && wire?.id && wire.id !== call.id) {
      const emitIndex = this.next++
      this.byId.set(call.id, emitIndex)
      this.byWire.set(call.index, { id: call.id, emitIndex })
      return { emitIndex, id: call.id }
    }
    if (wire) {
      if (call.id && !wire.id) {
        wire.id = call.id
        this.byId.set(call.id, wire.emitIndex)
      }
      return { emitIndex: wire.emitIndex, id: wire.id }
    }
    const emitIndex = this.next++
    const id = call.id ?? ''
    if (id) this.byId.set(id, emitIndex)
    this.byWire.set(call.index, { id, emitIndex })
    return { emitIndex, id }
  }
}

function toOpenAI(message: Message) {
  if (message.role === 'tool') return { role: 'tool', content: message.content, tool_call_id: message.toolCallId }
  if (message.role === 'assistant') {
    const body: Record<string, unknown> = { role: 'assistant', content: message.content || null }
    if (message.reasoning) body.reasoning_content = message.reasoning
    if (message.toolCalls?.length) {
      body.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      }))
    }
    return body
  }
  return { role: message.role, content: message.content }
}

export default Llm
