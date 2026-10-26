// 代码图概览：把 codegraph 的“解析 → 建图 → 概览”算法做成 workspace-docs 的一个只读块。
//
// 边界（与 dsh-workspace-docs 的定位一致）：
// - 只做增量索引与概览渲染，不注册工具、不做编辑、不做跨项目查询；
// - 索引在后台队列里跑，首次未就绪时渲染只返回一句“索引中”，文件清单照常显示；
// - 存储是派生数据，schema 版本不匹配直接重建；项目库损坏不影响宿主。
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { gitHead, indexProject, isStale } from './codegraph/indexer.ts'
import { LANGUAGES, bundledGrammarDir, grammarPath, type GrammarPaths } from './codegraph/languages.ts'
import { projectOverview, type ProjectOverview } from './codegraph/query.ts'
import { createIndexQueue } from './codegraph/queue.ts'
import { openGraph, readProjectMeta, type Graph, type ProjectMeta } from './codegraph/store.ts'
import { parseFile } from './codegraph/tree-sitter.ts'

export interface CodeOverviewOptions {
  readonly enabled?: boolean
  /** Each list's cap. Default 8. */
  readonly limit?: number
  /** Directory names the docs half already ignores; the graph walk must agree. */
  readonly ignored?: readonly string[]
}

export interface RenderedOverview {
  readonly text: string
  /** True when `text` is a graph overview (callers may then compact their file list). */
  readonly graph: boolean
}

/** 索引未就绪时给模型的一句话；不冒充“没有代码”。 */
const INDEXING_NOTE = '代码图索引中（首次约 10–20 秒，后台运行）——先按下面的文件清单看，下一轮会补上入口候选与核心符号。'

/** DSH home；与官方 resolveDshHome 同序，但不引入额外 peer 依赖。 */
function dshHome(): string {
  const env = process.env.DSH_HOME
  return env !== undefined && env !== '' ? env : join(homedir(), '.dsh')
}

/** 每个工作区一个库，路径由 cwd 的 sha256 决定，调用方无法指定。 */
export function graphFileFor(root: string): string {
  const key = createHash('sha256').update(root).digest('hex').slice(0, 32)
  return join(dshHome(), 'storages', 'dsh-workspace-docs', 'projects', key, 'graph.db')
}

function grammarPaths(): GrammarPaths {
  return {
    bundledDir: bundledGrammarDir(),
    downloadDir: join(dshHome(), 'storages', 'dsh-workspace-docs', 'grammars'),
  }
}

const EMPTY_FILE = { symbols: [], calls: [], imports: [], heritage: [], typeRefs: [], exports: [], hasError: false, unsupported: 'missing' as const }

async function parseSource(source: string, path: string, languageId: string) {
  const language = LANGUAGES.find(entry => entry.id === languageId)
  if (language === undefined) return EMPTY_FILE
  const grammar = grammarPath(language, grammarPaths())
  if (grammar === undefined) return EMPTY_FILE
  return await parseFile(grammar, join(bundledGrammarDir(), 'web-tree-sitter.wasm'), source, path, languageId)
}

/**
 * 直接给一个目录建图并返回概览（测试与排障用）。
 * @param root - 要索引的目录。
 * @param graphFile - 库文件路径；测试会传临时目录。
 */
export async function indexDirectory(
  root: string,
  graphFile: string,
  skipDir?: (name: string) => boolean,
): Promise<ProjectOverview> {
  const graph = openGraph(graphFile)
  try {
    await indexProject(graph, root, parseSource, Date.now, undefined, skipDir)
    return projectOverview(graph, 20)
  } finally {
    try { graph.close() } catch { /* already closed */ }
  }
}

/** 概览块：中文、无工具名、每条都带证据（路径/行号/引用数）。 */
export function renderOverviewBlock(
  overview: ProjectOverview | undefined,
  state: 'current' | 'stale',
  meta: ProjectMeta | undefined,
  limit = 8,
): string {
  if (overview === undefined || overview.files === 0) return ''
  const languages = overview.byLanguage.slice(0, 3).map(entry => `${entry.lang} ${String(entry.files)}`).join('、')
  const flags = [
    state === 'stale' ? '索引落后于工作区，后台更新中' : '',
    meta?.truncated === true ? '文件数超过索引上限，图不完整' : '',
    overview.truncated ? '列表已截断' : '',
  ].filter(Boolean)
  const lines = [
    `## 代码图概览（自动生成）`,
    `- 规模：${String(overview.files)} 文件 / ${String(overview.symbols)} 符号 / ${String(overview.edges)} 条边${languages === '' ? '' : `；${languages}`}${flags.length === 0 ? '' : `（${flags.join('；')}）`}`,
  ]
  const budget = Math.min(limit, Math.max(3, Math.round(Math.log10(Math.max(overview.files, 1)) * 3)))
  const entries = overview.entryCandidates.slice(0, budget)
  if (entries.length > 0) {
    lines.push('- 入口候选（没有任何文件 import 它，通常从这里开始读）：')
    for (const entry of entries) lines.push(`  - ${entry.path}${entry.symbol === undefined ? '' : ` · 从 ${entry.symbol.kind} ${entry.symbol.name} 开始`}`)
  }
  const hubs = overview.hubs.slice(0, Math.min(budget, 6))
  if (hubs.length > 0) {
    lines.push('- 核心符号（被引用最多，先读这些建立词汇）：')
    for (const hub of hubs) lines.push(`  - ${hub.symbol.kind} ${hub.symbol.name} · ${hub.symbol.path}:${String(hub.symbol.line)} · ${String(hub.references)} 处引用`)
  }
  return lines.join('\n')
}

/**
 * 供根 index.js 使用的只读概览器。
 *
 * `render()` 必须同步返回：未就绪时只触发一次后台请求，并给一句话；
 * 已就绪时读库渲染。索引过程中的旧概览会继续展示并标注“后台更新中”。
 */
export function createCodeOverview(options: CodeOverviewOptions = {}) {
  const enabled = options.enabled !== false
  const limit = options.limit ?? 8
  const ignored = new Set((options.ignored ?? []).map(entry => entry.toLowerCase()))
  const skipDir = (name: string): boolean => name.startsWith('_') || ignored.has(name.toLowerCase())
  const graphs = new Map<string, Graph>()
  const lastGood = new Map<string, string>()
  const lastHeadCheck = new Map<string, number>()

  function graphFor(cwd: string): Graph {
    const existing = graphs.get(cwd)
    if (existing !== undefined) return existing
    const opened = openGraph(graphFileFor(cwd))
    graphs.set(cwd, opened)
    queue.adopt(cwd, readProjectMeta(opened.db))
    return opened
  }

  const queue = createIndexQueue(async (cwd) => indexProject(graphFor(cwd), cwd, parseSource, Date.now, undefined, skipDir))

  /** 每 30 秒看一眼 HEAD：变了就把旧图标脏并在后台重建。 */
  function checkFreshness(cwd: string): void {
    const now = Date.now()
    if (now - (lastHeadCheck.get(cwd) ?? 0) < 30_000) return
    lastHeadCheck.set(cwd, now)
    void gitHead(cwd).then((head) => {
      const meta = readProjectMeta(graphFor(cwd).db)
      if (isStale(meta, head)) {
        queue.markStale(cwd)
        void queue.request(cwd).catch(() => { /* recorded on the queue */ })
      }
    }).catch(() => { /* no git / unreadable: keep the current graph */ })
  }

  return {
    render(cwd: string): RenderedOverview {
      if (!enabled || typeof cwd !== 'string' || cwd === '') return { text: '', graph: false }
      const status = queue.status(cwd)
      if (status === undefined) {
        void queue.request(cwd).catch(() => { /* recorded on the queue */ })
        return { text: INDEXING_NOTE, graph: false }
      }
      if (status.state === 'indexing' || status.state === 'unindexed') {
        const previous = lastGood.get(cwd)
        return previous === undefined
          ? { text: INDEXING_NOTE, graph: false }
          : { text: `${previous}\n（后台更新中）`, graph: true }
      }
      if (status.state === 'failed') {
        return { text: `代码图索引未完成：${status.failure ?? '未知错误'}；下面的文件清单仍然可用。`, graph: false }
      }
      try {
        const graph = graphFor(cwd)
        const meta = readProjectMeta(graph.db)
        const overview = projectOverview(graph, limit)
        const text = renderOverviewBlock(overview, status.state === 'stale' ? 'stale' : 'current', meta, limit)
        if (text === '') return { text: '', graph: false }
        lastGood.set(cwd, text)
        checkFreshness(cwd)
        return { text, graph: true }
      } catch {
        return { text: '', graph: false }
      }
    },
    dispose(): void {
      try { queue.dispose() } catch { /* already disposed */ }
      for (const graph of graphs.values()) { try { graph.close() } catch { /* already closed */ } }
      graphs.clear()
      lastGood.clear()
      lastHeadCheck.clear()
    },
  }
}

export type CodeOverview = ReturnType<typeof createCodeOverview>
