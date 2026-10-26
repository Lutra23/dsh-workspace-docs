import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexDirectory, renderOverviewBlock, createCodeOverview } from '../lib/overview.js'

const fake = {
  files: 42, symbols: 180, edges: 300, truncated: false,
  byLanguage: [{ lang: 'typescript', files: 30 }, { lang: 'python', files: 12 }],
  entryCandidates: [{ path: 'src/cli.ts', symbol: { kind: 'function', name: 'main' } }],
  hubs: [{ symbol: { kind: 'class', name: 'Store', path: 'src/store.ts', line: 12 }, references: 9 }],
}

test('概览块带规模/入口/核心符号，且不出现 codegraph 工具名', () => {
  const text = renderOverviewBlock(fake, 'current', undefined, 8)
  assert.match(text, /42 文件/)
  assert.match(text, /src\/cli\.ts/)
  assert.match(text, /Store/)
  assert.doesNotMatch(text, /codegraph_/)
})

test('stale/truncated 状态会写进概览', () => {
  const text = renderOverviewBlock(fake, 'stale', { truncated: true }, 8)
  assert.match(text, /后台更新中/)
  assert.match(text, /图不完整/)
})

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-docs-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/a.ts'), 'export function alpha(x: number) { return x + 1 }\n')
  writeFileSync(join(root, 'src/b.ts'), "import { alpha } from './a.ts'\nexport function beta() { return alpha(1) }\n")
  writeFileSync(join(root, 'src/c.ts'), 'export function gamma() { return 0 }\n')
  return root
}

test('真实解析：入口候选与核心符号来自 tree-sitter 图', async () => {
  const root = fixture()
  try {
    const overview = await indexDirectory(root, join(root, 'graph.db'))
    assert.ok(overview.files >= 3, `files=${overview.files}`)
    assert.ok(overview.symbols >= 3, `symbols=${overview.symbols}`)
    assert.ok(overview.entryCandidates.some(entry => entry.path.endsWith('c.ts')), JSON.stringify(overview.entryCandidates))
    assert.ok(overview.hubs.some(hub => hub.symbol.name === 'alpha'), JSON.stringify(overview.hubs))
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('createCodeOverview：首轮给索引提示，完成后给出图概览', async () => {
  const root = fixture()
  const provider = createCodeOverview({ limit: 6 })
  try {
    const first = provider.render(root)
    assert.equal(first.graph, false)
    assert.match(first.text, /索引中/)
    let ready
    for (let i = 0; i < 100 && ready === undefined; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
      const next = provider.render(root)
      if (next.graph) ready = next
    }
    assert.ok(ready, '索引应在 10 秒内完成')
    assert.match(ready.text, /入口候选/)
  } finally {
    provider.dispose()
  }
})

test('apply 注入：首轮给清单+索引提示，完成后给概览+文档', async () => {
  const { apply } = await import('../index.js')
  const root = fixture()
  let captured
  const ctx = {
    systemPrompt: { context: (options) => { captured = options } },
    workingDirectory: { get: () => root },
    logger: () => ({ info() {}, warn() {} }),
    effect: (fn) => { fn() },
  }
  apply(ctx, { maxBytes: 4000, graph: true })
  const session = {}
  const first = captured.text({ agent: { session } })
  assert.match(first, /索引中/)
  let ready
  for (let i = 0; i < 100 && ready === undefined; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 100))
    const text = captured.text({ agent: { session } })
    if (text.includes('代码图概览')) ready = text
  }
  assert.ok(ready, '10 秒内应出现代码图概览')
  assert.match(ready, /入口候选/)
  assert.match(ready, /文档与目录/)
})
