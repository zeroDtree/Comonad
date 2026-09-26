import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captureCheckpoint, revertCheckpoint } from './checkpoint.ts'
import { keepChange, parseUnified, undoChange, workspaceDiff } from './diff.ts'

const chat = 'chat'
const checkpoint = '11111111-1111-4111-8111-111111111111'
process.env.COMONAD_HOME = mkdtempSync(join(tmpdir(), 'comonad-home-'))

describe('workspace diff', () => {
  it('splits one hunk into a block per change, including green-only lines', () => {
    const [file] = parseUnified(`diff --git a/f.go b/f.go
--- a/f.go
+++ b/f.go
@@ -1,6 +1,8 @@
 line1
+green1
 line2
 line3
+green2
 line4
`)
    expect(file?.hunks).toHaveLength(2)
    expect(file?.hunks[1]?.lines.filter((line) => line.type === 'add').map((line) => line.text)).toEqual(['green2'])
    expect(file?.hunks[1]?.lines.some((line) => line.text === 'green1')).toBe(false)
  })

  it('includes an untracked file as a review hunk', async () => {
    const root = plain()
    await workspaceDiff(root, chat)
    writeFileSync(join(root, 'random.txt'), '690217483\n')
    const diff = await workspaceDiff(root, chat)
    expect(diff.available).toBe(true)
    expect(diff.files.map((file) => file.path)).toEqual(['random.txt'])
    expect(diff.files[0]?.additions).toBe(1)
    expect(diff.files[0]?.hunks[0]?.lines.some((line) => line.text.includes('690217483'))).toBe(true)
  })

  it('keeps a change without staging it in the repository', async () => {
    const root = repo()
    writeFileSync(join(root, 'note.txt'), 'note\n')
    execFileSync('git', ['add', '--', 'note.txt'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'note'], { cwd: root })
    await workspaceDiff(root, chat)
    writeFileSync(join(root, 'note.txt'), 'changed\n')
    writeFileSync(join(root, 'random.txt'), '690217483\n')
    const before = status(root)
    await keepChange(root, chat, 'random.txt')
    await keepChange(root, chat, 'note.txt')
    expect(status(root)).toBe(before)
    expect((await workspaceDiff(root, chat)).files).toEqual([])
  })

  it('undoes a pending untracked file by deleting it', async () => {
    const root = plain()
    await workspaceDiff(root, chat)
    writeFileSync(join(root, 'random.txt'), '690217483\n')
    await undoChange(root, chat, 'random.txt')
    expect(existsSync(join(root, 'random.txt'))).toBe(false)
  })

  it('reviews a directory that is not a git repository', async () => {
    const root = plain()
    await workspaceDiff(root, chat)
    writeFileSync(join(root, 'note.txt'), 'a\n')
    expect((await workspaceDiff(root, chat)).files.map((file) => file.path)).toEqual(['note.txt'])
    await keepChange(root, chat, 'note.txt')
    expect(existsSync(join(root, '.git'))).toBe(false)
    expect((await workspaceDiff(root, chat)).files).toEqual([])
    writeFileSync(join(root, 'note.txt'), 'b\n')
    await captureCheckpoint(root, chat, checkpoint)
    writeFileSync(join(root, 'note.txt'), 'c\n')
    writeFileSync(join(root, 'extra.txt'), 'new\n')
    await revertCheckpoint(root, chat, checkpoint)
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('b\n')
    expect(existsSync(join(root, 'extra.txt'))).toBe(false)
    expect(existsSync(join(root, '.git'))).toBe(false)
  })

  it('does not ask git when there is no working directory', async () => {
    await expect(workspaceDiff('', chat)).resolves.toEqual({ available: false, files: [] })
    await expect(workspaceDiff('   ', chat)).resolves.toEqual({ available: false, files: [] })
  })
})

function plain(): string {
  return mkdtempSync(join(tmpdir(), 'comonad-plain-'))
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'comonad-diff-'))
  execFileSync('git', ['init'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
  return root
}

function status(root: string): string {
  return execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })
}
