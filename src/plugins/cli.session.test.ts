import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from 'cordis'
import { describe, expect, it } from 'vitest'
import type { SessionPolicy } from '../domain/types.ts'
import Sessions, { type Session } from '../services/sessions.ts'
import { cliSessionId, command } from './cli.ts'

const policy: SessionPolicy = {
  workMode: 'ro',
  approval: 'manual',
  network: false,
  workingDirectory: '',
  commandTimeout: 30,
  planDirectory: '.agent/plans',
  denyReadPaths: [],
  model: '',
  temperature: 1,
  maxTokens: 8192,
}

describe('cliSessionId', () => {
  it('names a session with the start time', () => {
    const id = cliSessionId(new Date(2026, 8, 26, 11, 2, 8, 829))
    expect(id).toBe('cli-2026-09-26@11h02m08s829ms')
  })
})

describe('session file ids', () => {
  it('stores a SillyTavern chat id without spaces', async () => {
    const { root, ctx, dir } = await openSessions()
    const chatId = 'Assistant - 2026-09-26@11h21m37s831ms'
    const created = ctx.sessions.create(policy, chatId)
    expect(created.id).toBe('Assistant-2026-09-26@11h21m37s831ms')
    expect(ctx.sessions.get(chatId)?.id).toBe(created.id)
    expect(existsSync(join(dir, `${created.id}.json`))).toBe(true)
    expect(existsSync(join(dir, `${chatId}.json`))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })
})

describe('save and load', () => {
  it('copies a chat under a new name and refuses an existing id', async () => {
    const { root, ctx } = await openSessions()
    const current = ctx.sessions.create(policy, 'current')
    current.title = 'hello'
    current.transcript = [{ role: 'user', content: 'hello' }]
    current.turnIndex = 1
    current.cursor = cursor()
    ctx.sessions.persist(current)
    const taken = ctx.sessions.create(policy, 'taken')
    taken.transcript = [{ role: 'user', content: 'keep' }]
    ctx.sessions.persist(taken)

    const refused = command(ctx, current, '!save taken')
    expect(refused.text).toBe('session taken already exists')
    expect(refused.session).toBeUndefined()
    expect(ctx.sessions.get('taken')?.transcript).toEqual([{ role: 'user', content: 'keep' }])
    expect(command(ctx, current, '!save ../no').text).toBe('session ../no is invalid')

    const saved = command(ctx, current, '!save notes')
    expect(saved).toEqual({ text: 'saved notes' })
    const copy = ctx.sessions.get('notes')
    expect(copy?.transcript).toEqual(current.transcript)
    expect(copy?.title).toBe('hello')
    expect(copy?.turnIndex).toBe(1)
    expect(copy?.cursor).toBeNull()
    expect(ctx.sessions.get('current')?.transcript).toEqual(current.transcript)
    rmSync(root, { recursive: true, force: true })
  })

  it('continues the loaded transcript and deletes an empty session', async () => {
    const { root, ctx, dir } = await openSessions()
    const empty = ctx.sessions.create(policy, 'cli-empty')
    const notes = ctx.sessions.create(policy, 'notes')
    notes.title = 'notes'
    notes.transcript = [
      { role: 'user', content: 'from notes' },
      { role: 'assistant', content: 'ok' },
    ]
    notes.cursor = cursor()
    ctx.sessions.persist(notes)

    const missing = command(ctx, empty, '!load missing')
    expect(missing.session).toBeUndefined()
    expect(missing.text).toContain('cli-empty  New thread')
    expect(missing.text).toContain('notes  notes')
    expect(existsSync(join(dir, 'cli-empty.json'))).toBe(true)

    const loaded = command(ctx, empty, '!load notes')
    expect(loaded.session?.id).toBe('notes')
    expect(loaded.session?.transcript).toEqual(notes.transcript)
    expect(loaded.session?.cursor).toBeNull()
    expect(ctx.sessions.get('cli-empty')).toBeUndefined()
    expect(existsSync(join(dir, 'cli-empty.json'))).toBe(false)
    expect(existsSync(join(dir, 'notes.json'))).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps the current file when it already has messages', async () => {
    const { root, ctx, dir } = await openSessions()
    const current = ctx.sessions.create(policy, 'current')
    current.transcript = [{ role: 'user', content: 'stay' }]
    ctx.sessions.persist(current)
    ctx.sessions.create(policy, 'notes')
    const loaded = command(ctx, current, '!load notes')
    expect(loaded.session?.id).toBe('notes')
    expect(existsSync(join(dir, 'current.json'))).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })
})

function cursor(): NonNullable<Session['cursor']> {
  return { node: 'ask', value: undefined, payload: null, step: 1, state: {} as NonNullable<Session['cursor']>['state'] }
}

async function openSessions() {
  const root = mkdtempSync(join(tmpdir(), 'comonad-cli-'))
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
  return { root, ctx, dir: join(root, 'data', 'sessions') }
}
