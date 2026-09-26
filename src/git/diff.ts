import { readFile, unlink, writeFile } from 'node:fs/promises'
import { git, gitInput, openSession } from './session.ts'

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'meta'
  text: string
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  additions: number
  deletions: number
  untracked: boolean
  hunks: DiffHunk[]
  patch: string
}

export interface WorkspaceDiff {
  available: boolean
  files: DiffFile[]
}

export function parseUnified(text: string): DiffFile[] {
  const parts = text.split(/^diff --git /m).map((part) => part.trim()).filter(Boolean)
  return parts.flatMap((part) => {
    const patch = `diff --git ${part}\n`
    const lines = patch.split('\n')
    const header = lines[0] ?? ''
    const match = header.match(/^diff --git a\/(.+) b\/(.+)$/)
    const path = unquote(match?.[2] ?? '')
    if (!path) return []
    const untracked = lines.some((line) => line === '--- /dev/null' || line.startsWith('new file mode'))
    const raw: DiffHunk[] = []
    let current: DiffHunk | null = null
    for (const line of lines) {
      if (line.startsWith('@@')) {
        current = { header: line, lines: [] }
        raw.push(current)
        continue
      }
      if (!current || line === '') continue
      if (line.startsWith('+')) current.lines.push({ type: 'add', text: line.slice(1) })
      else if (line.startsWith('-')) current.lines.push({ type: 'del', text: line.slice(1) })
      else if (line.startsWith(' ')) current.lines.push({ type: 'ctx', text: line.slice(1) })
      else if (line.startsWith('\\')) current.lines.push({ type: 'meta', text: line })
    }
    const hunks = raw.flatMap(splitHunk)
    const additions = hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.type === 'add').length, 0)
    const deletions = hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.type === 'del').length, 0)
    return [{ path, additions, deletions, untracked, hunks, patch }]
  })
}

export async function workspaceDiff(cwd: string, chatId: string): Promise<WorkspaceDiff> {
  if (!cwd.trim() || !chatId.trim()) return { available: false, files: [] }
  const repo = await openSession(cwd, chatId)
  const [unstaged, untracked] = await Promise.all([
    git(repo, ['diff', '--no-ext-diff']),
    git(repo, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const created = await Promise.all(untracked.stdout.split('\0').filter(Boolean).map((file) => git(repo, ['diff', '--no-index', '--no-ext-diff', '--', '/dev/null', file])))
  const files = [...parseUnified(unstaged.stdout), ...created.flatMap((item) => parseUnified(item.stdout))]
  return { available: true, files }
}

export async function keepChange(cwd: string, chatId: string, file: string, hunk?: number): Promise<void> {
  const repo = await openSession(cwd, chatId)
  const target = await pendingFile(cwd, chatId, file)
  if (hunk === undefined) {
    const added = await git(repo, ['add', '--', target.path])
    if (added.code !== 0) throw new Error('git add failed')
    return
  }
  const applied = await gitInput(repo, ['apply', '--cached'], hunkPatch(target, hunk))
  if (applied.code !== 0) throw new Error(applied.stderr || 'could not keep this hunk')
}

export async function undoChange(cwd: string, chatId: string, file: string, hunk?: number): Promise<void> {
  const repo = await openSession(cwd, chatId)
  const target = await pendingFile(cwd, chatId, file)
  if (hunk === undefined) {
    if (target.untracked) {
      await unlink(safeJoin(cwd, target.path))
      return
    }
    const restored = await git(repo, ['checkout', '--', target.path])
    if (restored.code !== 0) throw new Error('git checkout failed')
    return
  }
  const applied = await gitInput(repo, ['apply', '--reverse'], hunkPatch(target, hunk))
  if (applied.code !== 0) throw new Error(applied.stderr || 'could not undo this hunk')
}

async function pendingFile(cwd: string, chatId: string, file: string): Promise<DiffFile> {
  const path = relativePath(file)
  const diff = await workspaceDiff(cwd, chatId)
  const found = diff.files.find((item) => item.path === path)
  if (!found) throw new Error('file is not pending review')
  return found
}

function hunkPatch(file: DiffFile, index: number): string {
  const hunk = file.hunks[index]
  if (!hunk) throw new Error('hunk is missing')
  const lines = file.patch.split('\n')
  const cut = lines.findIndex((line) => line.startsWith('@@'))
  const head = (cut === -1 ? lines : lines.slice(0, cut)).filter((line) => line !== '')
  const body = [hunk.header, ...hunk.lines.map((line) => line.type === 'meta' ? line.text : `${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.text}`)]
  return `${head.join('\n')}\n${body.join('\n')}\n`
}

export async function readWorkspaceFile(cwd: string, file: string): Promise<string> {
  return readFile(safeJoin(cwd, relativePath(file)), 'utf8')
}

export async function writeWorkspaceFile(cwd: string, file: string, text: string): Promise<void> {
  await writeFile(safeJoin(cwd, relativePath(file)), text)
}

function relativePath(file: string): string {
  if (!file || file.includes('\0') || file.startsWith('/') || file.split(/[/\\]/).includes('..')) throw new Error('bad path')
  return file
}

function safeJoin(cwd: string, file: string): string {
  return `${cwd.replace(/\/$/, '')}/${relativePath(file)}`
}

function splitHunk(hunk: DiffHunk): DiffHunk[] {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(hunk.header)
  let oldLine = Number(match?.[1] ?? 1)
  let newLine = Number(match?.[3] ?? 1)
  const blocks: DiffHunk[] = []
  let pending: DiffLine | null = null
  let pendingOld = oldLine
  let pendingNew = newLine
  let block: DiffLine[] | null = null
  let blockOld = oldLine
  let blockNew = newLine
  const emit = (trailing: DiffLine | null) => {
    if (!block) return
    const lines = trailing ? [...block, trailing] : [...block]
    const oldCount = lines.filter((line) => line.type === 'ctx' || line.type === 'del').length
    const newCount = lines.filter((line) => line.type === 'ctx' || line.type === 'add').length
    blocks.push({ header: `@@ -${blockOld},${oldCount} +${blockNew},${newCount} @@`, lines })
    block = null
  }
  for (const line of hunk.lines) {
    if (line.type === 'meta') {
      if (block) block.push(line)
      else if (blocks.length) blocks[blocks.length - 1]?.lines.push(line)
      continue
    }
    if (line.type === 'ctx') {
      if (block) emit(line)
      pending = line
      pendingOld = oldLine
      pendingNew = newLine
      oldLine += 1
      newLine += 1
      continue
    }
    if (!block) {
      block = pending ? [pending] : []
      blockOld = pending ? pendingOld : oldLine
      blockNew = pending ? pendingNew : newLine
    }
    block.push(line)
    if (line.type === 'del') oldLine += 1
    else newLine += 1
  }
  emit(null)
  return blocks
}

function unquote(path: string): string {
  if (path.startsWith('"') && path.endsWith('"')) {
    try { return JSON.parse(path) as string } catch { return path }
  }
  return path
}

