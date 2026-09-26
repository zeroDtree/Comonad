import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { Context } from 'cordis'
import { z } from 'zod'
import { objectSchema, type ToolSpec } from '../domain/types.ts'
import { planDirFor, resolvePlanFile } from '../sandbox/path.ts'

function publish(ctx: Context, spec: ToolSpec) {
  ctx.effect(() => {
    ctx.tools.add(spec)
    return () => ctx.tools.remove(spec.name)
  })
}

export default function planPlugin(ctx: Context) {
  publish(ctx, {
    name: 'list_plans',
    description: 'List plan files for this session.',
    capability: 'rw_plan',
    needsNetwork: false,
    needsWorkspace: true,
    parameters: objectSchema({}),
    async execute(_args, host) {
      const dir = planDirFor(host.policy, host.sessionId)
      await mkdir(dir, { recursive: true })
      const names = await readdir(dir)
      return names.join('\n') || '(no plans)'
    },
  })
  publish(ctx, {
    name: 'read_plan',
    description: 'Read a plan file by its basename.',
    capability: 'rw_plan',
    needsNetwork: false,
    needsWorkspace: true,
    parameters: objectSchema({ name: { type: 'string' } }, ['name']),
    async execute(args, host) {
      const { name } = z.object({ name: z.string() }).parse(args)
      return readFile(resolvePlanFile(planDirFor(host.policy, host.sessionId), name), 'utf8')
    },
  })
  publish(ctx, {
    name: 'write_plan',
    description: 'Write a plan file by its basename.',
    capability: 'rw_plan',
    needsNetwork: false,
    needsWorkspace: true,
    parameters: objectSchema({ name: { type: 'string' }, content: { type: 'string' } }, ['name', 'content']),
    async execute(args, host) {
      const { name, content } = z.object({ name: z.string(), content: z.string() }).parse(args)
      const dir = planDirFor(host.policy, host.sessionId)
      await mkdir(dir, { recursive: true })
      const target = resolvePlanFile(dir, name)
      await writeFile(target, content)
      return `wrote ${name}`
    },
  })
}

planPlugin.inject = ['tools']
