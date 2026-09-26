import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = resolve(root, 'extension/vendor')
mkdirSync(vendor, { recursive: true })
copyFileSync(resolve(root, 'node_modules/katex/dist/katex.mjs'), resolve(vendor, 'katex.js'))
const ascii = readFileSync(resolve(root, 'node_modules/asciimath-to-latex/build/index.js'), 'utf8')
  .replace(/\r?\n\/\/# sourceMappingURL=.*$/, '')
writeFileSync(resolve(vendor, 'asciimath.js'), `const exports = {}\n${ascii}\nexport default exports.default\n`)
