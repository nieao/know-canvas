# Know Canvas — 外部源插件接口规范

> **版本**: v0.1 (Draft)
> **状态**: 设计中, MVP 1-2 天可落地
> **作者**: 你想猫 (架构策划)
> **关联文件**: `server/source-proxy.js` · `src/stores/useCanvasStore.js` · `src/pages/panels/LeftPanel.jsx`

---

## TL;DR (5 行)

1. **协议**: 每个插件就是一个 `manifest.json` + 一个 `adapter.mjs`, 实现统一的 `search/fetch/push/watch` 四类 capability, IO schema 跟现有飞书/Notion 完全一致 (`{ ok, results | data, error }`).
2. **加载**: 选 **方案 A** — 复用现有 `source-proxy.js` daemon, 启动时扫 `plugins/*/` 目录动态 `import()` adapter, 注册到 `/canvas/api/source/<pluginId>/<capability>`. 不开新进程, 不要单独沙箱.
3. **配置**: 沿用 env var (`<PLUGIN_ID>_TOKEN`) + `~/.know-canvas/plugins.json` 双层, 由 daemon 注入 adapter, 浏览器永远拿不到密钥.
4. **store 抽象**: 引入 `searchSource(pluginId, q)` / `importSource(pluginId, url)` / `pushSource(pluginId, nodeId, opts)` 三个通用 action; 现有 `searchFeishu` 等保留为 1 行 thin wrapper, 100% 向后兼容.
5. **UI**: LeftPanel 改成 `plugins.map(p => <SourceCard plugin={p} />)`, 卡片 schema 来自 manifest. MVP 阶段先支持 `search` + `url` 两种 mode (现有飞书/Notion 都是这俩), 复杂字段后续 v0.2 加 configSchema.

> 不追求完美 (沙箱 / OAuth dance / hot reload 全都先不做), 追求 **第三方写一个 100 行的 Hacker News 插件能在 1 天内挂上去**.

---

## 0. 设计原则

| 原则 | 含义 |
|---|---|
| **零破坏** | 现有 feishu/notion 路由 + store action + UI 卡片**全保留**. 新规范是叠加层, 旧代码 1 行不改也能继续跑. |
| **薄约定** | manifest 字段尽量少 (8 个核心字段), schema 跟现有 IO 形状对齐, 不发明新名词. |
| **本地优先** | 插件代码跑在用户本机 daemon 里, 凭据从 env / 本地配置文件读, 永远不上传云端. |
| **TypeScript 可选** | 插件作者可以写 `.mjs` 纯 JS, 也可以写 `.ts` 编译产物. 不强制构建工具链. |
| **MVP 先行** | 沙箱、OAuth flow、watch capability、hot reload 全部 v0.2+, MVP 只做 search/fetch/push. |

---

## 1. 插件协议

### 1.1 目录结构

```
plugins/
  hackernews/
    manifest.json
    adapter.mjs
    icon.svg              (可选)
    README.md             (可选)
  rss/
    manifest.json
    adapter.mjs
  feishu/                 ← 把内置的搬过来, 也走插件协议 (dogfooding)
    manifest.json
    adapter.mjs
  notion/
    manifest.json
    adapter.mjs
```

**约定**:
- 目录名 = `pluginId` (小写, kebab-case, 不能含 `/` `..` `.`)
- 每个目录必须有 `manifest.json` + `adapter.mjs`
- daemon 启动时扫描 `plugins/*/manifest.json`, 全部加载

### 1.2 manifest.json schema

```json
{
  "$schema": "https://know-canvas.dev/schema/source-plugin/v1.json",
  "id": "hackernews",
  "name": "Hacker News",
  "version": "0.1.0",
  "author": "your-handle",
  "icon": "icon.svg",
  "sourceType": "web",
  "capabilities": ["search", "fetch"],
  "ui": {
    "label": "Hacker News",
    "description": "Top stories + URL fetch",
    "modes": ["search", "url"],
    "searchPlaceholder": "搜 HN 标题 / 评论...",
    "urlPlaceholder": "news.ycombinator.com/item?id=..."
  },
  "configSchema": {
    "apiKey": {
      "type": "string",
      "required": false,
      "envVar": "HACKERNEWS_API_KEY",
      "description": "可选, 不填走匿名 API"
    }
  }
}
```

**字段说明**:

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `id` | ✓ | string | 全局唯一, kebab-case, 跟目录名一致 |
| `name` | ✓ | string | 人类可读名 (UI 卡片标题用) |
| `version` | ✓ | semver | 自管, 不强制语义化, 仅日志展示 |
| `author` | | string | 作者 handle / GitHub ID |
| `icon` | | string | 相对路径, SVG/PNG, 32x32 推荐. daemon `/canvas/api/source/<id>/icon` 透出 |
| `sourceType` | ✓ | enum | `web` / `kb` / `social` / `feed` / `note` / `custom` — 仅做 UI 分组用 |
| `capabilities` | ✓ | string[] | 子集 of `["search","fetch","push","watch"]`, 见 §1.3 |
| `ui.label` | | string | 默认取 `name`, 卡片头编号后那段文字 |
| `ui.description` | | string | mode 切换栏下方提示语 |
| `ui.modes` | ✓ | string[] | 子集 of `["search","url"]`, 决定卡片显示哪些 mode 按钮. MVP 只支持这俩 |
| `ui.searchPlaceholder` | | string | search input 的 placeholder |
| `ui.urlPlaceholder` | | string | url input 的 placeholder |
| `configSchema` | | object | 各字段一个 `{ type, required, envVar, description }`, MVP 只读 envVar |

**枚举: sourceType** (UI 用 emoji + 颜色分组, 非强约束)

| 值 | 用例 | 默认图标 |
|---|---|---|
| `kb` | 知识库 (Notion / Obsidian / Logseq / 飞书) | 📚 |
| `web` | 网页内容 (HN / Reddit / Medium / 任意 URL) | 🌐 |
| `social` | 社交 (Twitter/X / 微博 / B 站评论) | 💬 |
| `feed` | RSS / Atom / JSON Feed | 📡 |
| `note` | 个人笔记 (得到 / 微信收藏) | 📝 |
| `custom` | 兜底 | 🔌 |

### 1.3 capabilities 枚举

| 值 | 含义 | 对应 endpoint | MVP |
|---|---|---|---|
| `search` | 关键字搜索, 返回结果列表 (供用户点击导入) | `POST /<id>/search` | ✓ |
| `fetch` | 给定 URL/ID, 取完整内容 (创建画布节点) | `POST /<id>/fetch` | ✓ |
| `push` | 把画布节点推送到该源 (反向同步, 如 Notion 创建页) | `POST /<id>/push` | ✓ |
| `watch` | 长连接订阅源更新 (RSS poll / Webhook), v0.2+ | `WS /<id>/watch` | ✗ |

### 1.4 adapter.mjs 接口

```typescript
// types/source-plugin.d.ts
export interface PluginContext {
  /** manifest.json 解析结果 */
  manifest: PluginManifest;
  /** 从 env / plugins.json 合并后的运行时配置 */
  config: Record<string, string>;
  /** 结构化日志 (写到 daemon stdout, 带 [pluginId] 前缀) */
  log: (...args: unknown[]) => void;
  /** 仅供插件用的 fetch (后续 v0.2 注入超时/UA/限流) */
  fetch: typeof globalThis.fetch;
}

export interface SearchInput {
  query: string;
  pageSize?: number;  // 1~50, 默认 10
}

export interface SearchResult {
  title: string;          // 必填, 列表展示主文本
  summary?: string;       // 副文本, ≤ 200 字
  url: string;            // 必填, 唯一标识 + 后续 fetch 入参
  id?: string;            // 内部 ID (Notion pageId 之类), 可选
  meta?: Record<string, unknown>;  // 自由字段, 给前端展示用 (作者/更新时间/类型)
}

export interface FetchInput {
  url?: string;
  id?: string;
}

export interface FetchResult {
  title: string;
  content: string;        // markdown-ish 文本
  url?: string;
  meta?: Record<string, unknown>;
}

export interface PushInput {
  /** 节点的标题 + 正文, 由 store 在客户端拼好 */
  title: string;
  content: string;
  sourceUrl?: string;
  /** 可选: 插件特定参数 (Notion 的 databaseId 之类) */
  options?: Record<string, unknown>;
}

export interface PushResult {
  externalId: string;     // 推送后远端的唯一 ID
  externalUrl?: string;   // 浏览器可打开的 URL
  meta?: Record<string, unknown>;
}

export interface SourcePlugin {
  search?: (ctx: PluginContext, input: SearchInput) => Promise<{ results: SearchResult[]; total?: number }>;
  fetch?:  (ctx: PluginContext, input: FetchInput)  => Promise<{ data: FetchResult }>;
  push?:   (ctx: PluginContext, input: PushInput)   => Promise<PushResult>;
}

/** adapter.mjs 必须 default-export 一个 SourcePlugin 实例 */
export default plugin satisfies SourcePlugin;
```

### 1.5 标准响应包络

所有 endpoint 统一形状, 跟现有飞书/Notion 100% 一致:

**成功**:
```json
{ "ok": true, "results": [...], "total": 12 }   // search
{ "ok": true, "data": {...} }                    // fetch
{ "ok": true, "externalId": "abc", "externalUrl": "..." }  // push
```

**失败**:
```json
{ "ok": false, "error": "human-readable message", "code": "PLUGIN_ERROR" }
```

**code 枚举** (前端可用做错误展示模板):

| code | HTTP | 含义 |
|---|---|---|
| `BAD_REQUEST` | 400 | 入参缺字段/格式错 |
| `UNAUTHORIZED` | 401 | 配置缺 token |
| `NOT_FOUND` | 404 | 路由未注册 / 资源不存在 |
| `CAPABILITY_NOT_SUPPORTED` | 405 | 插件未声明该 capability |
| `RATE_LIMITED` | 429 | 第三方 API 限流 |
| `PLUGIN_ERROR` | 500 | adapter 抛错 (默认) |
| `TIMEOUT` | 504 | adapter 超过 20s |

---

## 2. 插件加载机制

### 2.1 三方案对比

| | A. 同进程动态 import | B. 子 daemon 一进程一插件 | C. Edge function 风格 |
|---|---|---|---|
| **隔离** | 无 (插件错可能拖死 daemon) | 强 (每个插件独立崩) | 中 (独立 worker) |
| **资源** | 极轻 (1 个进程) | 重 (N+1 进程, N 个端口) | 中 (主进程 + worker pool) |
| **冷启动** | 0ms | 500-2000ms / 插件 | 50-200ms |
| **配置复杂度** | 低 (只读 manifest) | 高 (端口分配 + 健康检查 + 注册中心) | 中 (worker_threads 通信) |
| **部署** | 用户拷文件夹即可 | 需写启动器 | 中 |
| **MVP 友好** | ✓ | ✗ | △ |
| **可演进性** | 可后续加 worker pool | 已经太重 | 已经接近终态 |

### 2.2 推荐: 方案 A (同进程动态 import) + 后期演进路径

**理由**:
- know-canvas 是单机本地工具 (用户在自己电脑跑), 不是 SaaS, 不需要租户隔离.
- 插件作者大多写正常 fetch + JSON 转换, 不会做危险操作 (CPU 密集 / fork).
- daemon 已经有超时 (20s) + 1MB body 上限, 出现问题可见.
- v0.2 想要隔离时, **零破坏地**升级到 worker_threads 即可 (adapter 接口不变).

**MVP 不做**:
- 沙箱 (vm2 / isolated-vm) — 装包重, 兼容性差, 收益低
- 资源配额 (CPU / 内存) — Node 层面做不干净
- 网络白名单 — 让插件作者自律

### 2.3 加载流程

```
[daemon start]
  ↓
读 PLUGINS_DIR (默认 ./plugins, 可 env 覆盖)
  ↓
glob plugins/*/manifest.json
  ↓
for each manifest:
  1. 校验 schema (必填字段 / capabilities 合法 / id 不重复)
  2. 合并 config (env > ~/.know-canvas/plugins.json[id] > manifest.configSchema 默认值)
  3. import('./plugins/<id>/adapter.mjs')
  4. 校验 capabilities 与 adapter 导出函数对应 (search 声明了就必须有 search 函数)
  5. 构造 PluginContext, 注册到 router map
  ↓
启动 HTTP server
  ↓
请求 /canvas/api/source/<pluginId>/<capability>
  ↓
查 router → 执行 adapter[capability](ctx, input)
  ↓
catch 错误 → 包装成标准 error envelope
```

### 2.4 路由分发 (替换现有 hardcode 的 if-else)

```js
// server/source-proxy.js (重构后核心片段)
const plugins = await loadPlugins(PLUGINS_DIR)  // Map<id, { manifest, adapter, ctx }>

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // GET /plugins → manifest 列表 (UI 启动时拉)
  if (url.pathname === '/plugins') {
    return sendJson(res, 200, {
      ok: true,
      plugins: [...plugins.values()].map(p => ({
        ...p.manifest,
        // 不暴露 config 值 (密钥), 只告诉前端字段名
        configKeys: Object.keys(p.manifest.configSchema || {}),
      })),
    })
  }

  // GET /plugins/<id>/icon → 透出图标
  const iconMatch = url.pathname.match(/^\/plugins\/([^/]+)\/icon$/)
  if (iconMatch) { /* 读 plugins/<id>/<icon path> 返回 */ }

  // POST /<pluginId>/<capability>
  const capMatch = url.pathname.match(/^\/([a-z0-9-]+)\/(search|fetch|push)$/)
  if (capMatch && req.method === 'POST') {
    const [, pluginId, capability] = capMatch
    const plugin = plugins.get(pluginId)
    if (!plugin) return errJson(res, 404, 'NOT_FOUND', `unknown plugin: ${pluginId}`)
    if (!plugin.manifest.capabilities.includes(capability)) {
      return errJson(res, 405, 'CAPABILITY_NOT_SUPPORTED', `${pluginId} 未声明 ${capability}`)
    }
    if (typeof plugin.adapter[capability] !== 'function') {
      return errJson(res, 500, 'PLUGIN_ERROR', `${pluginId} 的 adapter 缺 ${capability} 函数`)
    }
    const body = await readJsonBody(req)
    try {
      const result = await withTimeout(
        plugin.adapter[capability](plugin.ctx, body),
        TIMEOUT_MS
      )
      return sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      plugin.ctx.log('error:', e?.message)
      return errJson(res, 500, 'PLUGIN_ERROR', e?.message || String(e))
    }
  }

  return errJson(res, 404, 'NOT_FOUND', `unknown route: ${req.method} ${url.pathname}`)
})
```

---

## 3. 沙箱与安全 (MVP 不做, 列出未来路径)

### 3.1 当前威胁模型

- **攻击者**: 第三方插件作者
- **资产**: 用户本机 (env vars, 文件系统, 内网)
- **缓解**: 用户**主动**安装插件 = 信任声明, 类比 npm package / VS Code extension

### 3.2 MVP 阶段的最小防护 (零开发成本)

| 风险 | 缓解 |
|---|---|
| 死循环卡死 daemon | adapter 调用统一 wrap `Promise.race` 20s 超时 |
| 大输出爆内存 | 响应体 > 5MB 时 daemon 截断 + 报警 (header `X-Truncated: true`) |
| fetch 打内网 | 暂不限, 文档警告作者 "勿读 169.254.x / 127.x" |
| env 泄漏 | adapter 拿到的 `ctx.config` 是经过 manifest.configSchema **白名单过滤**后的子集, 不能 `process.env.AWS_SECRET_KEY` 偷其他变量 (实现: 用 `Object.freeze` + 不传 process) |
| 网络密钥外发 | 不防 (信任声明) |

**实施小细节**:
```js
// adapter 加载时, 用 worker-like 包装替换全局 process (MVP 简化版)
const ctx = {
  manifest,
  config: Object.freeze(filterByConfigSchema(env, manifest.configSchema)),
  log: (...args) => console.log(`[${id}]`, ...args),
  fetch: globalThis.fetch,  // v0.2 包装超时 + UA + 内网拦截
}
```

### 3.3 v0.2+ 升级路径 (按优先级)

1. **worker_threads 隔离** (1 天) — adapter 跑独立线程, 主线程崩不死, 通过 message channel 通信
2. **fetch 包装** (0.5 天) — 注入默认 UA `know-canvas-plugin/<id>/<version>`, 内网地址直接 reject, 单插件并发 ≤ 5
3. **签名校验** (1 天) — manifest 加 `signature` 字段, daemon 用公钥验, 防被替换
4. **SES / vm2** — 不推荐, 维护成本太高

---

## 4. 配置存储

### 4.1 三层合并 (优先级从高到低)

```
1. 环境变量             ← 最高 (CI/部署友好)
   process.env[manifest.configSchema[key].envVar]

2. ~/.know-canvas/plugins.json   ← 用户本地
   { "hackernews": { "apiKey": "..." }, "notion": { "token": "ntn_..." } }

3. manifest.configSchema[key].default  ← 兜底
```

### 4.2 plugins.json 示例

```json
{
  "hackernews": {
    "apiKey": ""
  },
  "notion": {
    "token": "ntn_xxx",
    "defaultDatabase": "9f6bbdc391484e7f85bf92cde6a74fe6"
  },
  "rss": {
    "feeds": ["https://news.ycombinator.com/rss"]
  }
}
```

### 4.3 浏览器永远拿不到密钥

- daemon 永远不在 HTTP 响应里返回 `config` 完整对象
- `GET /plugins` 只返回 `configKeys: ["apiKey"]`, 不返回值
- 前端要展示"已配置 ✓ / 未配置 ✗"用 `GET /plugins/<id>/health`, 由 adapter 自检 (见 §6.2)

### 4.4 复用 NOTION_TOKEN 兼容

Notion 插件的 manifest:
```json
{
  "id": "notion",
  "configSchema": {
    "token": {
      "envVar": "NOTION_TOKEN",
      "required": true
    }
  }
}
```

→ 老用户的 `NOTION_TOKEN` env 自动被读到 `ctx.config.token`, 零迁移成本.

---

## 5. Store 侧抽象

### 5.1 通用 actions (新增)

加到 `useCanvasStore.js` 任意位置 (建议挨着现有 searchFeishu):

```js
// ──────────────────────────────────────────────────────────────────
// 通用源插件 API — 走 source-proxy 的 manifest 驱动路由
//   兼容现有 searchFeishu / searchNotion (它们重构成 1 行 wrapper)
// ──────────────────────────────────────────────────────────────────
searchSource: async (pluginId, query, pageSize = 10) => {
  const q = String(query || '').trim()
  if (!q) throw new Error(`searchSource(${pluginId}): query 为空`)
  const resp = await fetch(`/canvas/api/source/${pluginId}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ query: q, pageSize }),
  })
  const json = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))
  if (!json.ok) throw new Error(json.error || `${pluginId} search 失败`)
  return { results: json.results || [], total: json.total || 0 }
},

importSource: async (pluginId, urlOrId, position = null) => {
  const input = String(urlOrId || '').trim()
  if (!input) throw new Error(`importSource(${pluginId}): url 为空`)

  const resp = await fetch(`/canvas/api/source/${pluginId}/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ url: input, id: input }),  // adapter 自己挑 url 还是 id
  })
  const json = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))
  if (!json.ok) throw new Error(json.error || `${pluginId} fetch 失败`)

  const data = json.data || {}
  const title = data.title || input
  const content = String(data.content || '').replace(/\s+/g, ' ').trim()
  const summary = content.slice(0, 240) + (content.length > 240 ? '...' : '')

  const { addBookmarkNode } = get()
  const nodeId = addBookmarkNode(data.url || input, title, summary, '', '', position, false)
  set((state) => {
    const n = state.nodes.find((x) => x.id === nodeId)
    if (n) {
      n.data = n.data || {}
      n.data.sourceMeta = {
        platform: pluginId,           // ← 关键: 不再 hardcode 'feishu' / 'notion'
        originalUrl: data.url || input,
        importedAt: Date.now(),
        fullContent: content,
      }
    }
  })
  return { nodeId, title, contentLength: content.length }
},

pushSource: async (pluginId, nodeId, opts = {}) => {
  const { nodes } = get()
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error(`pushSource: 节点 ${nodeId} 不存在`)

  const title = String(node.data?.label || node.data?.title || node.data?.text || `节点 ${nodeId}`).slice(0, 200)
  const content = collectNodeContent(node, nodes, opts.includeChildren !== false)  // 抽出现有 pushNodeToNotion 的拼接逻辑
  const sourceUrl = node.data?.sourceMeta?.originalUrl || node.data?.url || ''

  const resp = await fetch(`/canvas/api/source/${pluginId}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ title, content, sourceUrl, options: opts.pluginOptions || {} }),
  })
  const json = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))
  if (!json.ok) throw new Error(json.error || `${pluginId} push 失败`)

  set((state) => {
    const n = state.nodes.find((x) => x.id === nodeId)
    if (n) {
      n.data = n.data || {}
      n.data.publishedTo = n.data.publishedTo || []
      n.data.publishedTo.push({
        platform: pluginId,
        externalId: json.externalId,
        externalUrl: json.externalUrl,
        pushedAt: Date.now(),
      })
    }
  })
  return { externalId: json.externalId, externalUrl: json.externalUrl }
},

// 新增: 列出已加载插件 (UI 启动时调一次, 缓存到 store.plugins)
loadPlugins: async () => {
  const resp = await fetch('/canvas/api/source/plugins')
  const json = await resp.json().catch(() => ({ ok: false }))
  if (!json.ok) throw new Error('加载插件列表失败')
  set((state) => { state.plugins = json.plugins || [] })
  return json.plugins || []
},
```

### 5.2 现有 actions 退化为 thin wrapper (向后兼容保证)

```js
// 旧代码 100% 不改, 内部转发到通用 action
searchFeishu: async (q, pageSize) => get().searchSource('feishu', q, pageSize),
importFromFeishuUrl: async (url, pos) => get().importSource('feishu', url, pos),
searchNotion: async (q, pageSize) => get().searchSource('notion', q, pageSize),
importFromNotionUrl: async (url, pos) => get().importSource('notion', url, pos),
pushNodeToNotion: async (nodeId, opts = {}) => get().pushSource('notion', nodeId, {
  pluginOptions: { databaseId: opts.databaseId || '9f6bbdc391484e7f85bf92cde6a74fe6' },
  includeChildren: opts.includeChildren,
}),
```

→ LeftPanel 一行代码不改, 现有迁移完成.

---

## 6. UI 注册 (manifest 驱动)

### 6.1 LeftPanel 重构方向

**当前** (硬编码两节, ~440 行重复模板):
```jsx
{/* 04 / 飞书文档 */}
<div>... feishuMode / feishuQuery / feishuResults ...</div>
{/* 05 / Notion */}
<div>... notionMode / notionQuery / notionResults ...</div>
```

**目标**:
```jsx
{plugins.map((p, idx) => (
  <SourceCard
    key={p.id}
    plugin={p}                  // 来自 store.plugins, 含 manifest 全字段
    sectionNumber={String(4 + idx).padStart(2, '0')}  // "04" / "05" / "06" ...
  />
))}
```

### 6.2 SourceCard 组件 (新建 `src/components/source/SourceCard.jsx`)

封装 LeftPanel 现有的 search/url 双模式 UI, 入参全靠 manifest:

```jsx
function SourceCard({ plugin, sectionNumber }) {
  const store = useCanvasStore()
  const [mode, setMode] = useState(plugin.ui.modes[0])  // 默认第一个 mode
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const r = await store.searchSource(plugin.id, query.trim(), 10)
      setResults(r.results)
    } catch (e) {
      alert(`${plugin.name} 搜索失败:\n${e.message}`)
    } finally { setLoading(false) }
  }

  const handleImport = async (urlOverride) => {
    const target = (urlOverride || url).trim()
    if (!target) return
    setLoading(true)
    try {
      await store.importSource(plugin.id, target)
      if (!urlOverride) setUrl('')
    } catch (e) {
      alert(`${plugin.name} 导入失败:\n${e.message}`)
    } finally { setLoading(false) }
  }

  return (
    <div>
      <SourceCardHeader
        sectionNumber={sectionNumber}
        label={plugin.ui.label}
        icon={`/canvas/api/source/plugins/${plugin.id}/icon`}
        modes={plugin.ui.modes}
        currentMode={mode}
        onModeChange={setMode}
      />
      {mode === 'search' && (
        <SearchPane
          placeholder={plugin.ui.searchPlaceholder}
          query={query} onQueryChange={setQuery}
          loading={loading}
          results={results}
          onSearch={handleSearch}
          onImport={handleImport}
        />
      )}
      {mode === 'url' && (
        <UrlPane
          placeholder={plugin.ui.urlPlaceholder}
          url={url} onUrlChange={setUrl}
          loading={loading}
          onImport={() => handleImport()}
        />
      )}
      <div className="hint">{plugin.ui.description}</div>
    </div>
  )
}
```

### 6.3 健康指示 (可选)

每个卡片右上角加一个圆点, 显示插件配置/连通状态:
- 🟢 已配置 + 可达 (启动时 `GET /plugins/<id>/health` 通了)
- 🟡 已配置 + 不可达 (网络错 / token 过期)
- ⚫ 未配置 (configSchema 必填项缺)

健康检查走插件可选 export:
```js
// adapter.mjs
export default {
  async health(ctx) {
    if (!ctx.config.token) return { ok: false, reason: 'NOTION_TOKEN 未配置' }
    return { ok: true }
  },
  // ...search/fetch/push
}
```

### 6.4 currentMode 持久化

把每个插件的 `mode` 选择存到 `localStorage.knowCanvas.pluginUiState`:
```json
{ "feishu": { "mode": "search" }, "notion": { "mode": "url" } }
```
避免用户每次刷新都回到默认 mode (现有飞书代码也没做, 这是顺带优化).

---

## 7. MVP 三步落地 (1-2 天)

### Day 1: daemon 层

#### Step 1 — 重构 source-proxy.js 支持插件加载 (4h)

1. 把 daemon 拆成两个文件:
   - `server/source-proxy.js` — 路由分发 + 入口 (200 行)
   - `server/plugin-loader.js` — manifest 扫描 + adapter 动态 import (100 行)
2. 新增 `GET /plugins` 列出所有插件
3. 新增通用路由 `POST /<pluginId>/<capability>`
4. **保留**旧路由 `/feishu/*` `/notion/*` (兜底, 后面 Step 2 删除)

#### Step 2 — 把现有 feishu/notion 重写成插件 (3h)

1. 新建 `plugins/feishu/manifest.json` + `adapter.mjs` (从 source-proxy.js 抽 lark-cli 调用)
2. 新建 `plugins/notion/manifest.json` + `adapter.mjs` (从 source-proxy.js 抽 notionFetch)
3. 删除 source-proxy.js 里的硬编码路由
4. **测试**: 现有 LeftPanel 仍然能搜飞书 + 导入 Notion (零代码改动)

### Day 2: store + UI 层

#### Step 3 — store 通用 action + UI 重构 (5h)

1. `useCanvasStore.js` 加 `searchSource` / `importSource` / `pushSource` / `loadPlugins`
2. 现有 5 个 action (`searchFeishu` 等) 改成 1 行 wrapper
3. App 启动时调 `store.loadPlugins()` 把 manifest 列表存进 state
4. 抽 `SourceCard` 组件, LeftPanel 删除硬编码两节, 改成 `plugins.map`
5. **验收**: 飞书 + Notion 卡片视觉/行为完全一致

#### Step 4 (附赠) — 写示例 Hacker News 插件 (1h)

见 §8, 100 行内能跑.

### 关键不做项 (MVP 砍掉)

- ❌ 沙箱 / vm2
- ❌ OAuth flow (得到 / Twitter 这类需要的, 让插件作者自己 CLI 登录)
- ❌ watch capability + websocket
- ❌ configSchema 全字段 UI (只读 envVar)
- ❌ 插件市场 / 搜索 / 一键安装
- ❌ 插件签名校验
- ❌ hot reload (改插件需重启 daemon)

---

## 8. 示例插件: Hacker News Top 30

### `plugins/hackernews/manifest.json`

```json
{
  "id": "hackernews",
  "name": "Hacker News",
  "version": "0.1.0",
  "author": "know-canvas-team",
  "icon": "icon.svg",
  "sourceType": "web",
  "capabilities": ["search", "fetch"],
  "ui": {
    "label": "Hacker News",
    "description": "搜 HN 标题 / 粘 item URL 导入讨论",
    "modes": ["search", "url"],
    "searchPlaceholder": "搜 HN top / new (Algolia)",
    "urlPlaceholder": "news.ycombinator.com/item?id=..."
  },
  "configSchema": {}
}
```

### `plugins/hackernews/adapter.mjs` (98 行, 含注释)

```js
// Hacker News 插件 — 用 Algolia HN Search API + 官方 Firebase API
// 不需要 token, 完全匿名

const ALGOLIA = 'https://hn.algolia.com/api/v1'
const FIREBASE = 'https://hacker-news.firebaseio.com/v0'

// 从 URL 抽 item id (https://news.ycombinator.com/item?id=12345)
function extractItemId(input) {
  const m = String(input).match(/[?&]id=(\d+)/) || String(input).match(/^(\d+)$/)
  return m ? m[1] : null
}

// 拉一个 item + 它的所有顶层评论, 拼成 markdown
async function fetchItemWithComments(ctx, itemId) {
  const item = await ctx.fetch(`${FIREBASE}/item/${itemId}.json`).then(r => r.json())
  if (!item) throw new Error(`HN item ${itemId} 不存在`)

  const lines = [
    `# ${item.title || '(no title)'}`,
    '',
    `**by**: ${item.by} · **score**: ${item.score || 0} · **comments**: ${item.descendants || 0}`,
    item.url ? `**link**: ${item.url}` : '',
    '',
  ]

  if (item.text) {
    lines.push(item.text.replace(/<[^>]+>/g, ''))  // 简单去 HTML
    lines.push('')
  }

  // 拉前 10 条顶层评论
  const kids = (item.kids || []).slice(0, 10)
  if (kids.length > 0) {
    lines.push('## 顶层评论 (前 10)')
    lines.push('')
    const comments = await Promise.all(
      kids.map(kid => ctx.fetch(`${FIREBASE}/item/${kid}.json`).then(r => r.json()).catch(() => null))
    )
    for (const c of comments.filter(Boolean)) {
      if (c.deleted || c.dead) continue
      lines.push(`> **${c.by}**: ${(c.text || '').replace(/<[^>]+>/g, '').slice(0, 500)}`)
      lines.push('')
    }
  }

  return {
    title: item.title || `HN item ${itemId}`,
    content: lines.join('\n'),
    url: `https://news.ycombinator.com/item?id=${itemId}`,
    meta: { score: item.score, by: item.by, time: item.time },
  }
}

export default {
  async search(ctx, { query, pageSize = 10 }) {
    const url = `${ALGOLIA}/search?query=${encodeURIComponent(query)}&hitsPerPage=${pageSize}&tags=story`
    const json = await ctx.fetch(url).then(r => r.json())
    const results = (json.hits || []).map(h => ({
      title: h.title || '(no title)',
      summary: `by ${h.author} · ${h.points} points · ${h.num_comments || 0} comments`,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      id: h.objectID,
      meta: { points: h.points, author: h.author, createdAt: h.created_at },
    }))
    return { results, total: json.nbHits || results.length }
  },

  async fetch(ctx, { url, id }) {
    const itemId = id || extractItemId(url)
    if (!itemId) throw new Error('无法从 URL 解析 item id')
    ctx.log(`fetch item ${itemId}`)
    const data = await fetchItemWithComments(ctx, itemId)
    return { data }
  },
}
```

**测试**:
```bash
# 启动 daemon (会自动加载 plugins/hackernews/)
SOURCE_PROXY_PORT=17090 node server/source-proxy.js

# 搜
curl -X POST http://127.0.0.1:17090/hackernews/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"claude","pageSize":5}'

# 导入
curl -X POST http://127.0.0.1:17090/hackernews/fetch \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://news.ycombinator.com/item?id=42000000"}'
```

启动后 LeftPanel 会自动多出"06 / Hacker News"卡片, 零前端改动.

---

## 9. 与现有架构对照表

| 现有 | 新规范 | 迁移成本 |
|---|---|---|
| `server/source-proxy.js` 硬编码 `/feishu/search` | `plugins/feishu/adapter.mjs` 实现 `search()` | 抽函数, 1h |
| `compactFeishuResults()` 在 daemon 里 | 同, 但移到 adapter 内部 | 0 |
| `searchFeishu` action | `searchSource('feishu', q)` + 1 行 wrapper | 5 分钟 |
| `n.data.sourceMeta.platform = 'feishu'` (hardcode) | `platform: pluginId` (动态) | 0 (向后兼容, 旧节点 platform='feishu' 仍然认) |
| LeftPanel 04/05 节硬编码 | `<SourceCard plugin={p} />` | 抽组件, 3h |
| `process.env.NOTION_TOKEN` | `manifest.configSchema.token.envVar = 'NOTION_TOKEN'` | 配置文件 1 行 |
| 节点 `n.data.publishedTo[].pageId` | `n.data.publishedTo[].externalId` (旧节点保留 pageId, 渲染时 `externalId \|\| pageId`) | 5 分钟兼容代码 |

**没有 breaking change**.

---

## 10. 开放问题 / v0.2 待定

| 问题 | 当前态度 |
|---|---|
| 插件如何分发? (npm? GitHub release? CLI 安装?) | MVP 不管, 用户手动 git clone 进 plugins/ |
| 多插件读同一份 OAuth (Google Drive / Sheets 共享 google-token)? | v0.2 引入 `sharedConfig` 概念 |
| 插件 UI 字段 (Notion 的 databaseId 选择器) 怎么扩展? | v0.2 加 `manifest.ui.pushOptions.fields`, 渲染表单组件 |
| 插件能否上 client side (浏览器内运行, 无需 daemon)? | v0.3 探索 (限 fetch 无 CORS 的 source) |
| watch capability (RSS 轮询自动出新节点)? | v0.2 加 `WS /<id>/watch`, daemon 长连接, store side 用 zustand subscribe |
| Hermes 那种"跨节点派单"算不算插件? | 不算, 它是 task orchestration, 不是 source. 但 `push` capability 可以借此模式实现"节点 → Hermes 任务" |

---

## 附录 A: 与现有 docs 的关系

| 文档 | 关系 |
|---|---|
| `docs/INTEGRATION-NOTES.md` | Hermes API 踩坑 — 跟本规范无关 (Hermes 不算 source plugin) |
| `docs/hermes-integration-spec.md` | TaskNode 派单 — 独立体系, 但未来 hermes 也可包成 push capability |
| `docs/canvas-export-spec.md` | 画布导出 — 反向, 跟本规范的 `push` capability 互补 |
| `docs/CC-HANDOFF.md` | 多 cc 协作 — 实施本规范时要遵循 |

## 附录 B: 实施清单 (复制到 .plan/task.md)

```markdown
# 目标
让第三方写一个 Hacker News 插件能在 1 小时内挂到 know-canvas, 飞书/Notion 零破坏迁移.

## 阶段 1: daemon 层 [待开始]
- [ ] 创建 server/plugin-loader.js (manifest 扫描 + import)
- [ ] 重构 server/source-proxy.js 路由分发
- [ ] 新增 GET /plugins 端点
- [ ] 添加 timeout / error envelope wrapper
- [ ] 单测: 加载 mock plugin, 验证路由分发

## 阶段 2: 内置插件迁移 [待开始]
- [ ] 创建 plugins/feishu/{manifest.json, adapter.mjs}
- [ ] 创建 plugins/notion/{manifest.json, adapter.mjs}
- [ ] 删除 source-proxy.js 里的硬编码路由
- [ ] 回归测试: LeftPanel 飞书搜索/Notion 导入/推送都正常

## 阶段 3: store + UI [待开始]
- [ ] useCanvasStore 加 searchSource/importSource/pushSource/loadPlugins
- [ ] 5 个旧 action 改成 thin wrapper
- [ ] 创建 src/components/source/SourceCard.jsx
- [ ] LeftPanel 删除 04/05 硬编码节, 改成 plugins.map
- [ ] App 启动时调 loadPlugins()

## 阶段 4: 示例插件 [待开始]
- [ ] 创建 plugins/hackernews/{manifest.json, adapter.mjs}
- [ ] 启动 daemon, 验证 LeftPanel 自动出 06 节
- [ ] 文档示例放进 README

## 关键决策
| 决策 | 选项 | 理由 |
|---|---|---|
| 加载方式 | 同进程 import | MVP 友好, 后续可升 worker_threads |
| 沙箱 | 不做 | 单机本地工具, 信任声明即可 |
| OAuth | 不做 | 让插件用本地 CLI |

## 已知风险
- 插件作者写死循环 → 20s timeout 兜底
- 插件互相覆盖 ctx → ctx 用 Object.freeze
- manifest 字段冲突 → schema 校验, 启动时报错
```

---

**文档结束** · v0.1 草稿 · 你想猫 · 2026-05-04
