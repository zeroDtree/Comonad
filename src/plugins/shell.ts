import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from 'cordis'
import { z } from 'zod'
import { objectSchema, type ToolHost, type ToolSpec } from '../domain/types.ts'
import { formatResult } from '../sandbox/run.ts'
import { shellProfile } from '../sandbox/sbpl.ts'

function publish(ctx: Context, spec: ToolSpec) {
  ctx.effect(() => {
    ctx.tools.add(spec)
    return () => ctx.tools.remove(spec.name)
  })
}

async function run(ctx: Context, host: ToolHost, command: string, writable: boolean): Promise<string> {
  const workspace = host.policy.workingDirectory
  const profile = shellProfile(workspace, writable, deniedFiles(workspace, host.policy.denyReadPaths))
  const result = await ctx.sandbox.run(
    ['/bin/sh', '-c', command],
    profile,
    { enabled: host.policy.network },
    workspace,
    host.policy.commandTimeout,
  )
  return formatResult(result)
}

export default function shellPlugin(ctx: Context) {
  publish(ctx, {
    name: 'run_shell_readonly',
    description: 'Run a shell command in a read-only sandbox of the workspace.',
    capability: 'shell_ro',
    needsNetwork: false,
    needsWorkspace: true,
    parameters: objectSchema({ command: { type: 'string' } }, ['command']),
    execute(args, host) {
      const { command } = z.object({ command: z.string() }).parse(args)
      return run(ctx, host, command, false)
    },
  })
  publish(ctx, {
    name: 'run_shell',
    description: 'Run a shell command in a sandbox that can write inside the workspace.',
    capability: 'shell_rw',
    needsNetwork: false,
    needsWorkspace: true,
    parameters: objectSchema({ command: { type: 'string' } }, ['command']),
    execute(args, host) {
      const { command } = z.object({ command: z.string() }).parse(args)
      return run(ctx, host, command, true)
    },
  })
}

shellPlugin.inject = ['tools', 'sandbox']

function deniedFiles(workspace: string, patterns: string[]): string[] {
  const found = new Set<string>()
  const direct = join(workspace, '.env')
  if (patterns.includes('.env') && existsSync(direct)) found.add(direct)
  if (patterns.includes('**/.env')) collectEnv(workspace, found, 0)
  return [...found]
}

function collectEnv(dir: string, found: Set<string>, depth: number) {
  if (depth > 4) return
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue
    const path = join(dir, name)
    if (name === '.env') found.add(path)
    else if (statSync(path).isDirectory()) collectEnv(path, found, depth + 1)
  }
}
