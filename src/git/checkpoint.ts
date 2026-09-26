import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git, openSession } from './session.ts'

export async function captureCheckpoint(cwd: string, chatId: string, id: string): Promise<void> {
  const repo = await openSession(cwd, chatId)
  const record = join(repo.dir, 'comonad-checkpoints', `${checkpointId(id)}.json`)
  if (await exists(record)) return
  const index = join(repo.dir, `checkpoint-${checkpointId(id)}`)
  const empty = await git(repo, ['read-tree', '--empty'], index)
  if (empty.code !== 0) throw new Error(empty.stderr || 'could not snapshot workspace')
  const added = await git(repo, ['add', '-A'], index)
  if (added.code !== 0) throw new Error(added.stderr || 'could not snapshot workspace')
  const tree = await git(repo, ['write-tree'], index)
  if (tree.code !== 0 || !tree.stdout.trim()) throw new Error(tree.stderr || 'could not snapshot workspace')
  const commit = await git(repo, ['commit-tree', tree.stdout.trim(), '-m', checkpointId(id)])
  if (commit.code !== 0 || !commit.stdout.trim()) throw new Error(commit.stderr || 'could not snapshot workspace')
  const directory = join(repo.dir, 'comonad-checkpoints')
  await mkdir(directory, { recursive: true })
  await writeFile(record, JSON.stringify({ commit: commit.stdout.trim() }))
  await unlink(index).catch(() => undefined)
}

export async function revertCheckpoint(cwd: string, chatId: string, id: string): Promise<void> {
  const repo = await openSession(cwd, chatId)
  const stored = JSON.parse(await readFile(join(repo.dir, 'comonad-checkpoints', `${checkpointId(id)}.json`), 'utf8')) as { commit?: string }
  const commit = stored.commit ?? ''
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('bad checkpoint')
  const reset = await git(repo, ['read-tree', '-u', '--reset', commit])
  if (reset.code !== 0) throw new Error(reset.stderr || 'could not restore workspace')
  const cleaned = await git(repo, ['clean', '-fd'])
  if (cleaned.code !== 0) throw new Error(cleaned.stderr || 'could not restore workspace')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function checkpointId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('bad checkpoint')
  return id
}
