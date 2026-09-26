import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSbpl } from './sbpl.ts'
import { isDeniedRead, resolveInside, resolvePlanFile } from './path.ts'

describe('workspace paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'comonad-path-'))

  it('rejects paths that leave the workspace', () => {
    expect(resolveInside(root, 'notes/a.txt').startsWith(root)).toBe(true)
    expect(() => resolveInside(root, '../outside')).toThrow(/escapes workspace/)
    expect(() => resolveInside(root, '/etc/passwd')).toThrow(/escapes workspace/)
  })

  it('keeps plan files inside the plan directory by basename', () => {
    const plan = join(root, 'plans')
    expect(resolvePlanFile(plan, 'note.md').startsWith(plan)).toBe(true)
    expect(resolvePlanFile(plan, '../note.md').endsWith('/note.md')).toBe(true)
    expect(() => resolvePlanFile(plan, '..')).toThrow(/Invalid plan filename/)
  })

  it('denies .env reads from the configured patterns', () => {
    expect(isDeniedRead(root, join(root, '.env'), ['.env', '**/.env'])).toBe(true)
    expect(isDeniedRead(root, join(root, 'pkg', '.env'), ['**/.env'])).toBe(true)
    expect(isDeniedRead(root, join(root, 'pkg', '.env'), ['.env'])).toBe(false)
    expect(isDeniedRead(root, join(root, 'readme.md'), ['.env', '**/.env'])).toBe(false)
  })
})

describe('sbpl', () => {
  it('denies network and writes in a readonly profile', () => {
    const text = buildSbpl({
      readonly: true,
      readPaths: ['/work'],
      writePaths: [],
      denyReadPaths: ['/work/.env'],
    }, { enabled: false })
    expect(text).toContain('(deny network*)')
    expect(text).toContain('(deny file-write*)')
    expect(text).toContain('(deny file-read* (subpath "/work/.env"))')
  })
})
