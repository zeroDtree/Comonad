import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { Context } from 'cordis'
import { z } from 'zod'
import { objectSchema, type ToolHost, type ToolSpec } from '../domain/types.ts'
import { assertReadable, isDeniedRead, PathEscapeError, resolveInside } from '../sandbox/path.ts'

function publish(ctx: Context, spec: ToolSpec) {
  ctx.effect(() => {
    ctx.tools.add(spec)
    return () => ctx.tools.remove(spec.name)
  })
}

async function walk(root: string, dir: string, visit: (file: string) => Promise<void>) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(root, path, visit)
    else if (entry.isFile()) await visit(path)
  }
}

export default function fsPlugin(ctx: Context) {
  publish(ctx, {
    name: 'list_dir',
    description: 'List files and directories inside the workspace.',
    capability: 'ro',
    needsNetwork: false,
    needsWorkspace: true,
    parameters: objectSchema({ path: { type: 'string', description: 'Directory relative to the workspace.' } }, ['path']),
    async execute(args, host) {
      const { path } = z.object({ path: z.string() }).parse(args)
      const target = readable(host, path)
      const entries = await readdir(target, { withFileTypes: true })
      return entries.map((entry) => `${entry.isDirectory() ? 'dir' : 'file'}\t${entry.name}`).join('\n') || '(empty)'
    },
  })

  publish(ctx, {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the workspace.',
    capability: 'ro',
    needsNetwork: false,
    needsWorkspace: true,
    parameters: objectSchema({ path: { type: 'string' } }, ['path']),
    async execute(args, host) {
      const { path } = z.object({ path: z.string() }).parse(args)
      const text = await readFile(readable(host, path), 'utf8')
      return text.length > 20_000 ? `${text.slice(0, 20_000)}\n[...truncated]` : text
    },
  })

  publish(ctx, {
    name: 'grep_files',
    description: 'Search workspace files with a regular expression.',
    capability: 'ro',
    needsNetwork: false,
    needsWorkspace: true,
    parameters: objectSchema({
      pattern: { type: 'string' },
      path: { type: 'string' },
    }, ['pattern']),
    async execute(args, host) {
      const { pattern, path = '.' } = z.object({ pattern: z.string(), path: z.string().optional() }).parse(args)
      const regex = new RegExp(pattern, 'i')
      const root = readable(host, path)
      const hits: string[] = []
      const info = await stat(root)
      const files: string[] = []
      if (info.isDirectory()) await walk(host.policy.workingDirectory, root, async (file) => { files.push(file) })
      else files.push(root)
      for (const file of files) {
        if (hits.length >= 200) break
        let text = ''
        try {
          text = await readFile(file, 'utf8')
        } catch {
          continue
        }
        text.split('\n').forEach((line, index) => {
          if (hits.length < 200 && regex.test(line)) {
            hits.push(`${relative(host.policy.workingDirectory, file)}:${index + 1}:${line}`)
          }
        })
      }
      return hits.join('\n') || '(no matches)'
    },
  })

  publish(ctx, {
    name: 'write_file',
    description: 'Create or replace a UTF-8 file inside the workspace.',
    capability: 'rw',
    needsNetwork: false,
    needsWorkspace: true,
    parameters: objectSchema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
    async execute(args, host) {
      const { path, content } = z.object({ path: z.string(), content: z.string() }).parse(args)
      const target = writable(host, path)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, content)
      return `wrote ${path}`
    },
  })

  publish(ctx, {
    name: 'apply_patch',
    description: 'Replace the first occurrence of old text in a workspace file.',
    capability: 'rw',
    needsNetwork: false,
    needsWorkspace: true,
    parameters: objectSchema({
      path: { type: 'string' },
      old: { type: 'string' },
      new: { type: 'string' },
    }, ['path', 'old', 'new']),
    async execute(args, host) {
      const { path, old, replacement } = z.object({
        path: z.string(),
        old: z.string(),
        new: z.string(),
      }).transform((value) => ({ ...value, replacement: value.new })).parse(args)
      const target = writable(host, path)
      const text = await readFile(target, 'utf8')
      if (!text.includes(old)) return `Error: old text was not found in ${path}`
      await writeFile(target, text.replace(old, replacement))
      return `patched ${path}`
    },
  })
}

fsPlugin.inject = ['tools']

function readable(host: ToolHost, path: string): string {
  const target = resolveInside(host.policy.workingDirectory, path)
  assertReadable(host.policy.workingDirectory, target, host.policy.denyReadPaths)
  return target
}

function writable(host: ToolHost, path: string): string {
  const target = resolveInside(host.policy.workingDirectory, path)
  if (isDeniedRead(host.policy.workingDirectory, target, host.policy.denyReadPaths)) {
    throw new PathEscapeError(`Writing ${target} is denied`)
  }
  return target
}
