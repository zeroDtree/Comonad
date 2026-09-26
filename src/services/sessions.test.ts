import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from 'cordis'
import { describe, expect, it } from 'vitest'
import Sessions, { readSessionFiles, threadTitle, writeSessionFile, type Session } from './sessions.ts'

describe('threadTitle', () => {
  it('uses the first line and clips long text', () => {
    expect(threadTitle('\n  fix the parser\nmore')).toBe('fix the parser')
    expect(threadTitle('x'.repeat(90)).endsWith('…')).toBe(true)
    expect(threadTitle('x'.repeat(90)).length).toBe(80)
  })
})

describe('session files', () => {
  it('round-trips a session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'comonad-sessions-'))
    const session: Session = {
      id: 'thread-1',
      title: 'Hello',
      updatedAt: 1,
      policy: {
        workMode: 'ro',
        approval: 'manual',
        network: false,
        workingDirectory: '/tmp',
        commandTimeout: 30,
        planDirectory: '.agent/plans',
        denyReadPaths: ['.env'],
        model: '',
        temperature: 1,
        maxTokens: 8192,
      },
      transcript: [{ role: 'user', content: 'Hello' }],
      turnIndex: 1,
      cursor: null,
    }
    writeSessionFile(dir, session)
    expect(readSessionFiles(dir)).toEqual([session])
    const legacyFile = {
      ...session,
      id: 'old',
      lore: { stickyUntil: { old: 1 }, cooldownUntil: {} },
      timed: { sticky: {}, cooldown: {} },
      policy: {
        workMode: 'ro',
        approval: 'manual',
        network: false,
        workingDirectory: '/tmp',
        commandTimeout: 30,
        planDirectory: '.agent/plans',
        denyReadPaths: [],
      },
    }
    writeFileSync(join(dir, 'old.json'), JSON.stringify(legacyFile))
    const legacy = readSessionFiles(dir).find((item) => item.id === 'old')
    expect(legacy?.policy).toMatchObject({ model: '', temperature: 1, maxTokens: 8192 })
    expect(legacy && 'lore' in legacy).toBe(false)
    expect(legacy && 'timed' in legacy).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('clears the working directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'comonad-sessions-'))
    const ctx = new Context()
    await ctx.plugin(class extends Service {
      static inject = []
      root: string
      constructor(context: Context, directory: string) {
        super(context, 'paths')
        this.root = directory
      }
    }, root)
    await ctx.plugin(Sessions)
    const created = ctx.sessions.create({
      workMode: 'ro',
      approval: 'manual',
      network: false,
      workingDirectory: '/tmp/work',
      commandTimeout: 30,
      planDirectory: '.agent/plans',
      denyReadPaths: [],
      model: 'demo',
      temperature: 0.2,
      maxTokens: 1024,
    }, 'thread-clear')
    expect(created.transcript).toEqual([])
    const cleared = ctx.sessions.patch(created.id, { workingDirectory: '' })
    expect(cleared.policy.workingDirectory).toBe('')
    const tuned = ctx.sessions.patch(created.id, { model: 'other', temperature: 0.4 })
    expect(tuned.policy).toMatchObject({ model: 'other', temperature: 0.4 })
    rmSync(root, { recursive: true, force: true })
  })
})
