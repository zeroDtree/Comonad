import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CLI and the SillyTavern plugin share one turn', () => {
  const cli = readFileSync(new URL('./cli.ts', import.meta.url), 'utf8')
  const plugin = readFileSync(new URL('../plugin.ts', import.meta.url), 'utf8')

  it('sends every turn through ctx.agent and does not assemble prompts itself', () => {
    expect(cli).toContain('ctx.agent.runTurn')
    expect(plugin).toContain('context.agent.runTurn')
    for (const source of [cli, plugin]) {
      expect(source).not.toMatch(/assemblePreset|runBooks|prompt\.assemble/)
    }
    expect(cli).toContain('ctx.agent.resume')
    expect(plugin).toContain('interactive: true')
    expect(cli).toContain('interactive: true')
  })
})
