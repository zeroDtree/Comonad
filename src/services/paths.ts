import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from 'cordis'

export class Paths extends Service {
  static inject = []

  readonly root: string

  constructor(ctx: Context) {
    super(ctx, 'paths')
    this.root = packageRoot()
  }
}

export default Paths

function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (true) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }
      if (parsed.name === 'comonad') return dir
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error('comonad package root not found')
    dir = parent
  }
}
