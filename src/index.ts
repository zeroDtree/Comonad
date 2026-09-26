#!/usr/bin/env node
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import { pathToFileURL } from 'node:url'

const ctx = new Context()
const base = pathToFileURL(process.cwd())
ctx.baseUrl = base.href.endsWith('/') ? base.href : `${base.href}/`

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@cordisjs/plugin-include',
  config: { path: './cordis.yml' },
})
await ctx.loader.await()
ctx.graphs.ensureCompiled()
