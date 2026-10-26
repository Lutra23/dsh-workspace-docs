#!/usr/bin/env node
// Bundle the code-graph half (src/overview.ts + vendored src/codegraph/*) into
// lib/overview.js. The docs half stays in the hand-written root index.js.
import { build } from 'esbuild'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

rmSync(join(root, 'lib'), { recursive: true, force: true })
mkdirSync(join(root, 'lib'), { recursive: true })

await build({
  entryPoints: [join(root, 'src/overview.ts')],
  outfile: join(root, 'lib/overview.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  logLevel: 'info',
})
