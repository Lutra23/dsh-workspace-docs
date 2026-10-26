# dsh-workspace-docs

会话首轮自动扫描当前工作区，把**顶层文件夹名与各文件夹内的文档文件清单**注入上下文，让 agent 接项目任务时先读 README、更新日志与工程记录，而不是上来就 `glob` / `grep` 盲搜。

## 解决什么问题

新会话的第一条消息里只有规则、工具说明和工作目录路径，agent 对工作区里有什么文件**一无所知**。它不知道有没有 README、更新日志、设计笔记，于是只能靠搜索边搜边猜，费轮次又容易漏掉真正该读的文档。

这个插件在每个会话第一次思考前扫一遍目录（只看一两层，绝不递归），把清单直接摆到模型面前。

## 注入样子

```
<system-reminder>
当前工作区文件概览（由 dsh-workspace-docs 自动生成，只列了文件名，未读内容）：
工作目录：C:\...\default-workspace

顶层文件夹（8 个）：
- dev-plugins/
- installed-plugins/
...

顶层文档（优先读）：
- 木马调查报告.md
...

各文件夹内的文档文件（优先读）：
  - dev-plugins/dsh-github-sync/：README.md
  - dev-plugins/nova-preset/：nova-prompt.md、README.md
...

当前工作区文件概览（由 dsh-workspace-docs 自动生成，只列文件名，未读内容）：
工作目录：C:\...\default-workspace

顶层文件夹（8 个）：
- dev-plugins/
- installed-plugins/
...

顶层文档（优先读）：
- 木马调查报告.md
...

各文件夹内的文档文件（优先读）：
  - dev-plugins/dsh-github-sync/：README.md
  - dev-plugins/nova-preset/：nova-prompt.md、README.md
...

接项目任务时，先按上面的文档清单读 README、更新日志与工程记录，再决定是否搜索代码；
清单没覆盖到目标时再用 glob/grep 定位。
```

## 扫描规则

- **只列文件名，不读内容。** 读内容由模型自己用 `read` 决定，插件不替它判断哪个重要。
- **顶层列一层**；若某个目录本身是「容器」（内部还有子目录），再下探第二层找文档，覆盖「工作区顶层放着多个项目文件夹」的常见布局。最深两层，不递归。
- **噪音目录自动排除**：`node_modules`、`.git`、`dist`、`build`、`coverage` 等固定名单，加上 `_` 开头与 `.` 开头的目录（`_scratch`、`_archive`、`.dsh-xxx` 这类临时与工具目录）。
- **文档识别**：扩展名 `.md` / `.txt` / `.markdown` / `.rst` / `.adoc`，或文件名含 `readme`、`changelog`、`changes`、`history`、`notes`、`todo`、`license`、`contributing`。
- **文档排序**：README 优先，其次 CHANGELOG，再次 ARCHITECTURE / DESIGN，最后其余 `.md`，避免零散日志挤掉主力文档。
- **超出上限时明确告知**：顶层超过 `maxTopLevel` 条会输出「还有 N 项未列出，需要时用 glob 或 pwsh 自行查看」，把补看动作交回模型，插件不猜项目结构。
- **每次请求都检测目录变化**：记录所有被列过的目录的 mtime，没变就复用上次结果（约 0.5ms），有增删改名才重新扫盘（约 8-10ms），清单不会在会话中途变旧。
- **拿不到会话工作目录时不注入**，避免把无关目录清单塞进别的 agent 的 prompt；文件系统读取失败也不阻断会话。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxTopLevel` | `50` | 顶层最多列出多少条（目录优先占名额，剩余给文件）；超出部分只报数量 |
| `maxDocsPerDir` | `12` | 每个子目录最多列多少份文档；同时限制容器目录下最多扫多少个子目录 |
| `maxBytes` | `4000` | 渲染后注入文本的字节上限，超出按 UTF-8 边界截断 |
| `order` | `130` | 运行时上下文的排序位置；官方 `WORKING_DIRECTORY` 是 100，本插件排在它之后 |
| `ignored` | 见源码 `DEFAULT_IGNORED` | 额外排除的目录名（不区分大小写）；`_` 与 `.` 前缀规则始终生效 |

```yaml
- id: workspace-docs
  name: dsh-workspace-docs
  config:
    maxTopLevel: 50
    maxDocsPerDir: 12
    maxBytes: 4000
```

## 依赖

零外部依赖，只用 `node:crypto` 与 `node:path`。**不 import 任何 `@deepseek-ai/*` 包**——工作区没有顶层 `node_modules`，一旦 import DSH 内部包会在加载时解析失败。消息对象按 `@deepseek-ai/dsh-llm` 的 `createUserMessage` 产出结构手写（uuid + 深度冻结）。

插件注入的服务：`sessionProjections`、`workingDirectory`；通过 `ctx.get('fs')` 取文件系统提供方。

## 安装

```powershell
# 1. 部署到 installed-plugins
node dev-plugins/deploy-to-installed.mjs dsh-workspace-docs

# 2. profile package.json 加依赖与 bundle
#    "dsh-workspace-docs": "link:.../installed-plugins/dsh-workspace-docs"
#    bundles 里追加 "dsh-workspace-docs"

# 3. 建 junction
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-workspace-docs" "<...>\installed-plugins\dsh-workspace-docs"

# 4. profile 的 cordis.patch.yml 追加插件行（见上方配置示例）
```

改完重载 profile 或重启 DSH，新会话即生效。

## 已知限制

- 只扫两层，更深的嵌套（如 monorepo 里 `packages/a/src/docs`）不会自动列出，需要模型自己用 `glob` 补。
- 容器目录下最多扫 `maxDocsPerDir` 个子目录，项目极多时会截断，此时依赖「未列出」提示让模型自行补看。
- 只在会话首个 `agent/pre-step` 注入一次；同一会话中途切换工作目录不会重新扫描。
- 不监视文件变化，新建的 README 要等下一个新会话才出现在清单里。

## 版本历史

### 0.3.0 — 2026-10-26 10:37
- 缓存策略改为**按请求做变更检测**：记录所有被列目录的 mtime，未变则复用（约 0.5ms），有增删改名才重扫（约 8-10ms），会话中途新建的目录与文档能立即反映到清单里。
- 移除固定 TTL 方案，避免「改了但还没到刷新时间」的空窗。

### 0.2.0 — 2026-10-25 23:54
- 注入通道从 `agent/pre-step` 的 user 消息改为 `ctx.systemPrompt.section()`，清单直接进入 system prompt，不再占用对话历史、不会被 compaction 摘要掉。
- 通过 `inject: ['systemPrompt', 'workingDirectory']` 获取 prompt 注册表与工作目录服务。
- section 的 `text` 为同步求值：`systemPrompt.assemble()` 同步调用 `text`，返回 Promise 会被当成文本，因此扫描改为同步 `readdirSync` 并按目录缓存。
- 拿不到会话工作目录时回落到 `workingDirectory.defaultDirectory`，再回落到 `process.cwd()`，避免整节为空。

### 0.1.0 — 2026-10-25 21:34
- 首个版本：会话首轮自动扫描工作区，注入顶层文件夹清单与文档文件列表。
- 支持两层下探，识别「工作区顶层放多个项目文件夹」的布局。
- 自动排除 `_` / `.` 前缀与常见构建、依赖目录。
- 文档按 README → CHANGELOG → ARCHITECTURE → 其余优先级排序。
- 顶层超出 `maxTopLevel` 时输出剩余数量提示，引导模型自行补看。
- 注入体积受 `maxBytes` 限制并按 UTF-8 边界截断。
