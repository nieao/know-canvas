# 集成笔记 — Hermes API 已踩坑沉淀

> **写给**: [ui-cc] (将来加 server/hermes-proxy.js 时)
> **作者**: [meta-cc] 2026-05-02
> **来源**: `metahermes/smoke_test.py` 实测 (4/4 通过) + `metahermes/hermes_pack/install.py` 实跑

---

## TL;DR — 写 hermes-proxy 前必看的 3 个坑

我跑了 5 轮 smoke test 才把这 3 个坑找全。你直接用下面的 schema, 一次写对。

### 坑 1: `priority` 是 int (1~5), 不是 string

```js
// ❌ 这样写 422 int_parsing
{ title: '...', priority: 'low' }

// ✅ 必须 int
{ title: '...', priority: 3 }   // 3 = 中等, 1 = 最高, 5 = 最低
```

### 坑 2: `POST /api/plugins/kanban/tasks` 不带尾斜杠

```js
// ❌ 带尾斜杠会落到 SPA fallback /{full_path} 返回 HTML, 你以为成功了 (200) 但其实没创建
fetch(`${BASE}/api/plugins/kanban/tasks/`, { method: 'POST', body: ... })

// ✅ 不带尾斜杠
fetch(`${BASE}/api/plugins/kanban/tasks`, { method: 'POST', body: ... })

// 注意: GET /api/plugins/kanban/tasks/{id} 是带尾斜杠 + id 的 (因为有路径参数)
fetch(`${BASE}/api/plugins/kanban/tasks/${taskId}`)
```

### 坑 3: 响应嵌套在 `body.task`, 不是 `body` 顶层

```js
// ❌ 这样取不到
const resp = await fetch(`${BASE}/api/plugins/kanban/tasks/${id}`).then(r => r.json())
console.log(resp.title)  // undefined

// ✅ 嵌套一层
console.log(resp.task.title)
console.log(resp.task.status)
console.log(resp.task.priority)
```

POST 创建时也类似 — 返回结构是 `{ id: 't_xxx', title, ..., assignee, status, ... }` (不嵌套, 直接顶层), 但 GET 单个 task 返回 `{ task: { id, ... } }`. 不一致, 需要分别处理.

**字段命名**: id 字段就是 `id` (前缀 `t_` 8 位 hex), 不是 `task_id` / `taskId` / `uuid`.

---

## token-protected endpoints (你绕不过去)

这些端点用 Basic Auth 不够, 需要 SPA 内的 ephemeral token (浏览器从 dashboard 登录后注入), 你拿不到:

- `GET /api/profiles` — 列 profile 名字
- `GET /api/skills` — 列 skill
- `PUT /api/profiles/{name}/soul` — 改 soul
- `POST /api/cron/jobs` — 创建 cron (新发现, 之前文档没标)
- `GET /api/env/reveal` — 看环境变量

**对你的影响**:
- hermes-proxy 不能在 know-canvas UI 里"列出所有可派 profile" — 需要让用户手动填 `assignee` 字符串
- 不能在 know-canvas UI 里改 worker SOUL — 留给 boss 在 dashboard 自己改
- 不能装 cron — 同上

---

## 必带的 HTTP 头 (反爬)

Hermes Nginx 前置反爬中间件会拒绝默认 fetch UA (返回 403). 任何对 Hermes 的请求**都必须带**:

```js
const HERMES_UA = 'Mozilla/5.0 (compatible; know-canvas/0.1; +https://github.com/nieao/know-canvas)'

fetch(`${BASE}/api/...`, {
  headers: {
    'User-Agent': HERMES_UA,         // 反爬关键, 缺则 403
    'Authorization': 'Basic ' + btoa(`${user}:${pass}`),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  // ...
})
```

> 注意: 浏览器原生 fetch 在某些情况下会拒绝设 `User-Agent` header (安全限制). 如果遇到这种情况, 走 server-side hermes-proxy (Node 后端) 中转, 浏览器→Node→Hermes, Node 那层就能自由设 UA.

---

## 已验证可用的 endpoint 速查

| Method | Path | 用途 | 备注 |
|--------|------|------|------|
| GET | `/api/status` | 系统状态 | 看 `gateway_running` 是否 True |
| GET | `/api/plugins/kanban/board` | 看板 (6 列状态机) | 列名: triage/todo/ready/running/blocked/done |
| GET | `/api/plugins/kanban/stats` | 任务统计 | |
| GET | `/api/plugins/kanban/assignees` | 可派的 worker 列表 | 当前为空 [], 等 lichang333 加 profile |
| **POST** | **`/api/plugins/kanban/tasks`** | **创建任务 (核心入口)** | **不带尾斜杠!** |
| GET | `/api/plugins/kanban/tasks/{id}` | 查单个任务 | 响应嵌套在 `task` 字段 |
| PATCH | `/api/plugins/kanban/tasks/{id}` | 改任务 | |
| GET | `/api/plugins/kanban/tasks/{id}/log` | 看任务执行日志 | gateway 起来后才有内容 |
| POST | `/api/plugins/kanban/tasks/{id}/comments` | 加评论 | |
| POST | `/api/plugins/kanban/dispatch` | 触发派单 | `?dry_run=true&max=N` 可预演 |

---

## 创建任务的完整范本 (复制即用)

```js
async function createHermesTask({ title, body, assignee = null, priority = 3 }) {
  const HERMES_BASE = process.env.HERMES_BASE || 'https://ha2.digitalvio.shop'
  const HERMES_USER = process.env.HERMES_USER
  const HERMES_PASS = process.env.HERMES_PASS

  const idempotency_key = `know-canvas-${crypto.randomUUID().slice(0, 12)}`

  const resp = await fetch(`${HERMES_BASE}/api/plugins/kanban/tasks`, {  // ← 不带尾斜杠
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; know-canvas/0.1)',
      'Authorization': 'Basic ' + Buffer.from(`${HERMES_USER}:${HERMES_PASS}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      body,                    // 任务描述 (markdown)
      assignee,                // null 或 worker profile name (例如 'railway-data-analyst')
      priority,                // ← int, 1~5
      workspace_kind: 'scratch',
      idempotency_key,         // ← 必传, 防止重试时重复创建
      max_runtime_seconds: 600,
    }),
  })

  if (!resp.ok) {
    throw new Error(`Hermes ${resp.status}: ${await resp.text()}`)
  }
  return await resp.json()  // { id: 't_xxx', title, status: 'ready', ... }
}
```

---

## 我已验证的 server/ 启动 (今天 14:50)

| 文件 | 起得来吗 | health endpoint |
|------|---------|----------------|
| `server/y-ws-server.js` | ✅ (1234 端口) | `{ok:true, service:'know-canvas-yjs-sync', port:1234, persist:true, auth:false}` |
| `server/claude-bridge.js` | ✅ (18080 端口) | `{ok:true, hasClaude:true, defaultModel:'claude-sonnet-4-5-20250514'}` |
| `server/hermes-proxy.js` | ❌ 还没建 | (你将来加, 用上面的 schema) |

启动命令 (来自 server/package.json):
```bash
cd server
npm install              # 已装好, node_modules 14M
npm run yws              # 起 y-ws-server (端口 1234)
npm run bridge           # 起 claude-bridge (端口 18080)
```

DeprecationWarning 提示 (Node 24): `url.parse()` 和 `spawn shell:true` 都是可改进点, 不是阻塞. 黑客松不用动, 后续再优化.

---

## demo 当天的 Hermes 角色分工 (建议)

为了不踩坑, demo 当天 Hermes 调用走两条独立路径:

### 路径 A: metahermes 这边演真实装载 (已验证)
- 跑 `python -m metahermes.hermes_pack.install`
- 浏览器看 https://ha2.digitalvio.shop/kanban
- 看到 [metahermes 装载] Skill 元任务进 backlog

### 路径 B: know-canvas 这边演协作 (你的 P0 范围)
- 浏览器开 know-canvas (本地 5180 或部署后的 /canvas/)
- 演 3 人同时画图 (yjsClient + Awareness)
- 演 AI 助手 (claude-cli-bridge)
- **不需要真派 Hermes** — 在 boss GO 签字之前 TaskNode 是暂缓的

如果 demo 当天 boss 临时说 "演个真派单!", 走应急方案:
1. 浏览器手工 `fetch('/api/plugins/kanban/tasks', ...)` (用上面的范本)
2. 或者切到 metahermes 这边的命令行演

---

## 我没动你 (server/ + src/collab/) 的代码

我看了下面这些文件但**没改一行**, 仅记笔记给你将来加新功能时参考:

- `server/y-ws-server.js` — 起得来, token auth + LevelDB 持久化都对
- `server/claude-bridge.js` — 起得来, claude CLI 检测正常
- `server/package.json` — deps 完整 (yjs/y-websocket/y-leveldb/ws)

如果将来加 hermes-proxy.js, 建议:
1. `server/package.json` 不用加新 dep — fetch 是 Node 18+ 内置
2. 跟 y-ws-server.js 用一样的风格 (token auth + CORS + graceful shutdown)
3. **凭据保管**: 走 process.env (HERMES_USER/HERMES_PASS), 不要让浏览器知道 — 这点你已经在 P0-PLAN 里讲过了

---

## 联系

任何 Hermes API 行为跟我这份笔记不一致, 跑一次 `python E:/claude\ code/黑客松\ 5-1/metahermes/smoke_test.py` 立刻验真伪 — smoke test 是黄金 ground truth.
