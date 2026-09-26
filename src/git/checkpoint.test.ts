import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captureCheckpoint, revertCheckpoint } from './checkpoint.ts'
import { workspaceDiff } from './diff.ts'

const id = '11111111-1111-4111-8111-111111111111'
const again = '22222222-2222-4222-8222-222222222222'
const chat = 'checkpoint-chat'
process.env.COMONAD_HOME = mkdtempSync(join(tmpdir(), 'comonad-home-'))

describe('checkpoints', () => {
  it('restores the workspace to the snapshot and drops files created later', async () => {
    const root = mkdtempSync(join(tmpdir(), 'comonad-checkpoint-'))
    writeFileSync(join(root, 'note.txt'), 'note\n')
    await workspaceDiff(root, chat)
    writeFileSync(join(root, 'note.txt'), 'edited\n')
    await captureCheckpoint(root, chat, id)
    writeFileSync(join(root, 'note.txt'), 'later\n')
    writeFileSync(join(root, 'extra.txt'), 'new\n')
    await revertCheckpoint(root, chat, id)
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('edited\n')
    expect(() => readFileSync(join(root, 'extra.txt'), 'utf8')).toThrow()
    expect(existsSync(join(root, '.git'))).toBe(false)
  })

  it('keeps the first snapshot when the same checkpoint is captured again', async () => {
    const root = mkdtempSync(join(tmpdir(), 'comonad-checkpoint-'))
    writeFileSync(join(root, 'note.txt'), 'first\n')
    await workspaceDiff(root, chat)
    await captureCheckpoint(root, chat, again)
    writeFileSync(join(root, 'note.txt'), 'second\n')
    await captureCheckpoint(root, chat, again)
    await revertCheckpoint(root, chat, again)
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('first\n')
  })
})
