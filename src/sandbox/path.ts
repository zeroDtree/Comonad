import { isAbsolute, relative, resolve, basename } from 'node:path'

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathEscapeError'
  }
}

export function resolveInside(root: string, input: string): string {
  const base = resolve(root)
  const target = resolve(base, input)
  const rel = relative(base, target)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return target
  throw new PathEscapeError(`Path escapes workspace: ${input}`)
}

export function resolvePlanFile(planDir: string, filename: string): string {
  const name = basename(filename)
  if (!name || name === '.' || name === '..') {
    throw new PathEscapeError(`Invalid plan filename: ${filename}`)
  }
  return resolveInside(planDir, name)
}

export function planDirFor(policy: { workingDirectory: string; planDirectory: string }, sessionId: string): string {
  return resolve(policy.workingDirectory, policy.planDirectory, sessionId)
}

export function isDeniedRead(workspace: string, target: string, patterns: string[]): boolean {
  const rel = relative(resolve(workspace), resolve(target))
  if (rel.startsWith('..') || isAbsolute(rel)) return false
  const name = basename(target)
  return patterns.some((pattern) => {
    if (pattern === '.env') return rel === '.env'
    if (pattern === '**/.env') return name === '.env'
    return rel === pattern || name === pattern
  })
}

export function assertReadable(workspace: string, target: string, patterns: string[]) {
  if (isDeniedRead(workspace, target, patterns)) {
    throw new PathEscapeError(`Reading ${target} is denied`)
  }
}
