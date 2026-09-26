import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface SessionRepo {
  dir: string
  work: string
}

export async function openSession(cwd: string, chatId: string): Promise<SessionRepo> {
  const work = resolve(cwd)
  const dir = join(sessionRoot(), sessionKey(chatId), createHash('sha256').update(work).digest('hex').slice(0, 16))
  await mkdir(dir, { recursive: true })
  const repo = { dir, work }
  const inside = await git(repo, ['rev-parse', '--is-inside-work-tree'])
  if (inside.stdout.trim() === 'true') return repo
  const init = await git(repo, ['init'])
  if (init.code !== 0) throw new Error(init.stderr || 'could not init session git')
  await git(repo, ['config', 'user.email', 'comonad@localhost'])
  await git(repo, ['config', 'user.name', 'comonad'])
  const added = await git(repo, ['add', '-A'])
  if (added.code !== 0) throw new Error(added.stderr || 'could not snapshot workspace')
  const committed = await git(repo, ['commit', '--allow-empty', '-m', 'baseline'])
  if (committed.code !== 0) throw new Error(committed.stderr || 'could not commit baseline')
  return repo
}

export function git(repo: SessionRepo, args: string[], index?: string): Promise<{ code: number | null, stdout: string, stderr: string }> {
  return gitInput(repo, args, '', index)
}

export function gitInput(repo: SessionRepo, args: string[], input: string, index?: string): Promise<{ code: number | null, stdout: string, stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('git', args, {
      cwd: repo.work,
      env: {
        ...process.env,
        GIT_DIR: repo.dir,
        GIT_WORK_TREE: repo.work,
        ...(index ? { GIT_INDEX_FILE: index } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => child.kill(), 8000)
    child.on('error', () => {
      clearTimeout(timer)
      resolvePromise({ code: 1, stdout: '', stderr: '' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
    child.stdin.end(input)
  })
}

function sessionRoot(): string {
  return join(process.env.COMONAD_HOME || homedir(), '.comonad', 'sessions')
}

function sessionKey(chatId: string): string {
  if (/^[A-Za-z0-9._-]{1,80}$/.test(chatId)) return chatId
  return createHash('sha256').update(chatId).digest('hex').slice(0, 32)
}
