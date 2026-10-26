import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('安装包在没有 node_modules 的目录也能加载 index.js', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ws-docs-load-'))
  try {
    for (const entry of ['index.js', 'package.json', 'lib', 'grammars']) {
      cpSync(join(root, entry), join(dir, entry), { recursive: true })
    }
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import('./index.js').then(m => console.log(m.name))"], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '' },
    })
    assert.equal(result.status, 0, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`)
    assert.match(result.stdout, /dsh-workspace-docs/)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
