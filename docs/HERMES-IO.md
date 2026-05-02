# Hermes ⇄ know-canvas 双向 IO 对接梳理

> **目的**: boss 想从 Hermes 端 + 画布端两边同时入手, 把输入(派单)和输出(回流结果)都解决.
> **写于**: 2026-05-02 by [ui-cc]
> **依据**: `.hermes-recon/probe-*.log` 实测 26 + 13 个端点
> **配套**: [INTEGRATION-NOTES.md](./INTEGRATION-NOTES.md) (REST API 字段细节) + [HERMES-BOOTSTRAP-FOR-LICHANG.md](./HERMES-BOOTSTRAP-FOR-LICHANG.md) (lichang 那边的配置)

---

## TL;DR — 一张图看懂现状

```
┌─────────────────┐    ① 创建 task         ┌──────────────────────┐
│   know-canvas   │ ─────POST kanban/tasks─→│  Hermes Dashboard    │
│   (浏览器画布)   │                         │  (ha2.digitalvio.shop)│
│                 │ ←──── ② 轮询 GET task───│  ↓ ④ dispatch 派给    │
└─────────────────┘                         │     worker (default)  │
       ↑ ③ ResultNode                      │  ↓ ⑤ DeepSeek          │
       └──────── orchestra conductor ──────│  ↓ ⑥ 写回 task done    │
                  (server, port 17083)     └──────────────────────┘

✅ 通: ①②③ 走 conductor 中转 (现网 work)
✅ 通: ④⑤⑥ 在 lichang 那边 (default profile + DeepSeek key, 已配)
⚠ 差: 实时性靠轮询 (1.5s × N), 没 webhook/SSE 推
⚠ 差: ⑥→① 之间靠 conductor 主动拉, 不是 hermes 主动推
```

---

## 一、对接面全表 (探测出来的真相)

26 + 13 个端点全部探测过, `.hermes-recon/probe-*.log` 有原始 dump. 下面是按"输入 / 输出 / 配置 / 死路"分类的归纳:

### ✅ 输入路径 (画布 → Hermes) — 已 work

| 端点 | 用途 | 调用方 | 状态 |
|------|------|-------|------|
| `POST /api/plugins/kanban/tasks` | 创建 task | conductor / hermes-proxy | ✅ Basic Auth 即可 |
| `POST /api/plugins/kanban/dispatch` | 主动 trigger 派单 | (新发现, 未用) | ✅ Basic Auth 即可 |
| `POST /api/plugins/kanban/tasks/:id/comments` | 加评论 | (未用) | ✅ |
| `PATCH /api/plugins/kanban/tasks/:id` | 改 task | (未用) | ✅ |

**关键 schema** (踩过坑别再踩):
- `priority` 必须 `int` 不是 string (1=最高 5=最低)
- POST 路径**不带尾斜杠** (带尾斜杠会 SPA fallback 假 200)
- `assignee` 字段必须填 worker profile 名, 否则 dispatcher `skipped_unassigned`
- 必带 `User-Agent` 自定义 header (反爬)
- 必带 `idempotency_key` (防重试)

### ✅ 输出路径 (Hermes → 画布) — 只能轮询

| 端点 | 用途 | 调用方 | 状态 |
|------|------|-------|------|
| `GET /api/plugins/kanban/tasks/:id` | 查单个 task 状态 | conductor 轮询 | ✅ 嵌套 `.task` |
| `GET /api/plugins/kanban/tasks/:id/log` | 查 task log | (未用) | ✅ |
| `GET /api/plugins/kanban/board` | 看板 6 列状态机 | (未用) | ✅ |
| `GET /api/plugins/kanban/stats` | 任务统计 | (未用) | ✅ |
| `GET /api/plugins/kanban/assignees` | 列可派 worker | (新, 应纳入 UI) | ✅ |

**当前 assignees 实测**:
```json
{"assignees":[
  {"name":"default","on_disk":false,"counts":{"done":2}},
  {"name":"hermes","on_disk":false,"counts":{"done":1}},
  {"name":"metahermes-smoke-fake","on_disk":false,"counts":{"done":1}}
]}
```
→ lichang 已经把 `default` profile 配通了, 之前 HERMES-BOOTSTRAP-FOR-LICHANG.md 的"已配好"是真的.

### 🔒 token-protected (Basic Auth 不够, 需 SPA ephemeral token)

| 端点 | 我们能用吗 |
|------|----------|
| `GET /api/profiles` | ❌ 浏览器代码拿不到 token, 列 profile 必须用 `/api/plugins/kanban/assignees` 替代 |
| `GET /api/skills` | ❌ |
| `GET /api/cron/jobs` | ❌ 想加定时派单只能 boss 在 dashboard 手配 |
| `POST /api/cron/jobs` | ❌ 同上 |
| `GET /api/me` | ❌ |
| `GET /api/auth/token` | ❌ |
| `GET /api/webhooks` | ❌ 想注册 webhook 也只能 boss 在 dashboard 配 |
| `GET /api/notifications/subscriptions` | ❌ |

**对画布的影响**: 画布永远拿不到 ephemeral token (除非 boss 手动 export 然后我们写代码读). 涉及 token 的功能就让 boss 在 hermes dashboard 手配, **不要试图自动化**.

### 👻 SPA fallback 假 200 (不是真端点)

下面这些响应 200 + `text/html` + `<!doctype html>` — 是 nginx fallback 到 SPA `index.html`, 不是真端点:
- `/sse` — 没有 SSE 入口
- `/api/plugins/kanban/events` — 没有 kanban 事件流
- `/api/plugins/kanban/board/stream` — 没有看板 stream
- `/api/plugins/kanban/webhooks` — 没有 kanban 级 webhook
- `/.well-known/mcp` — 没有 MCP discovery
- `/api/plugins/list` — 没有这个端点

**坑**: 直接 `if (resp.ok)` 不够, 必须再判 `content-type` 是 `application/json` 才算真端点存在.

### ❌ MCP / WebSocket 完全没有

- `/mcp`, `/api/mcp`, `/api/mcp/server`, `/api/mcp/tools`: 401 (端点存在但没暴露)
- `/api/mcp/jsonrpc`: 401
- 没有任何 WebSocket 端点 (只有 yjs 自己的 ws://localhost:1234, 跟 hermes 无关)

→ **结论**: 当前 hermes 部署没有 MCP server. 想接 MCP 必须等 lichang 在 hermes 配置里启 MCP plugin (如果有), 或者画布这边自己写一个 MCP server 包装 REST.

### ❌ OpenAPI / Swagger 对外封闭

- `/openapi.json`, `/docs`, `/redoc`: nginx 401 (内部可达, 对外被拦)
- 想拿 schema 让 boss 在 dashboard 浏览器里 `fetch('/openapi.json').then(r => r.json())`, 然后 export 给我们

---

## 二、推荐对接逻辑 (双向)

### 输入: 画布 → Hermes (已通, 维持)

```
画布 OntologyNode "派 Hermes →" 按钮
  ↓ promoteOntologyToTask() 设置 agentMode=auto, hermesAssignee='default'
  ↓ Y.Doc 写入新 TaskNode
  ↓
conductor (server/conductor.js) 在 demo-final 房间监听
  ↓ CAS 抢锁
  ↓ POST /api/plugins/kanban/tasks  (assignee=default, priority=3)
  ↓
Hermes 写入 ready 列
  ↓ dispatcher (gateway PID 13823) 每 5s 扫一次
  ↓ 拉起 default profile worker → DeepSeek
  ↓ worker 完成后写 task.status=done
```

**唯一不稳的环节**: dispatcher 5s 间隔. 如果想加速, 在 conductor 创建完 task 后**主动** `POST /api/plugins/kanban/dispatch` 一次, 立刻触发派单, 省 0~5s.

**改动建议** (3 行代码):
```js
// orchestra-hermes-worker.js, line 131 后插一行:
const created = await hermesCall('POST', '/api/plugins/kanban/tasks', taskBody)
if (!created.ok) { ... }

// 立刻 trigger 一次派单, 把 ready → running 时间从 5s 降到 ~200ms
hermesCall('POST', '/api/plugins/kanban/dispatch', {}).catch(() => {/* 容错 */})
```

### 输出: Hermes → 画布 (轮询为主, 无替代)

**当前**: conductor `POLL_INTERVAL_MS=1500ms × POLL_MAX_TRIES=N` 轮询 `/api/plugins/kanban/tasks/:id` 直到 status=done.

**没有替代的原因**:
- ❌ Webhook: hermes 配置在 token-protected 端点, 画布代码注册不了
- ❌ SSE: 没有公开端点
- ❌ WebSocket: 没有
- ❌ MCP push: 没启 MCP server

**优化方案** (按工作量排):

| 方案 | 工作量 | 收益 |
|------|-------|------|
| A. 把 POLL_INTERVAL 从 1.5s → 800ms | 5 分钟 | 减半延迟 |
| B. 创建后立刻 dispatch (上面 §输入 已写) | 10 分钟 | -5s 启动延迟 |
| C. 新建 task 后第一次 poll 改 200ms (其后退避到 1.5s) | 30 分钟 | 短 task 几乎实时 |
| D. 让 boss 在 hermes dashboard 配 webhook 推到我们的 server/hermes-callback.js | 2h + boss 手配 | 真实时, 但 boss 工作量大 |

**当前推荐**: A + B + C, 不做 D. 黑客松 demo 看不出 1s 内的差异.

---

## 三、连接失败时的 log 落点

按照 boss "我连接失败就返回报错信息, 要写一下每一步错误的 log 文件":

### 探测器 (manual 跑)
```bash
node .hermes-recon/probe.mjs           # 26 个端点, 写 .hermes-recon/probe-<ts>.log + summary.json
node .hermes-recon/probe-extra.mjs     # 13 个补充端点
```

### server 运行时报错落点

| 服务 | 错误 log 位置 |
|------|--------------|
| `server/hermes-proxy.js` | stderr, 用 `node ... 2> .hermes-recon/proxy-err.log` 重定向 |
| `server/orchestra-hermes-worker.js` (conductor 调它) | conductor stdout/stderr → systemd journal: `journalctl -u know-canvas-conductor -f` |
| 浏览器 fetch 失败 | DevTools console + `network` 面板 |

**新建议**: 给 hermes-proxy 加 `--log-file <path>` 参数, 把每次 hermesCall 的 `{method, path, status, ms, errMsg}` 写一行 NDJSON, 出问题时 `grep ERROR proxy.log` 一秒定位. 我可以做, 30 分钟工作量, 要不要做让 boss 决定.

---

## 四、boss 那边可以做什么 (Hermes 端入手)

按"双向同时推"原则, 列 boss 在 hermes dashboard / SSH 上能干的事:

### 立刻能做 (5 分钟)
1. 浏览器登录 https://ha2.digitalvio.shop , F12 打开 DevTools
2. Network 面板看 dashboard 里点"任务列表"时实际 fetch 哪个端点 + 带哪些 header (我们能看到 ephemeral token 是什么形态, 决定能否抠出来用)
3. 在 Console 面板跑:
   ```js
   fetch('/openapi.json').then(r => r.json()).then(j => console.log(JSON.stringify(j).slice(0, 5000)))
   ```
   把 OpenAPI schema 截图或 copy 给我 → 我能精准列出所有真实存在的端点

### 中等 (30 分钟, 需要找 lichang)
4. 让 lichang 看 hermes 配置里有没有 `mcp:` 段 / `webhook:` 段 — 如果有, 启用一下, 我们就有第二条对接路
5. 让 lichang 在 default profile 的 SOUL.md 加一行 `完成 task 后必须调用 kanban_done 工具标记 task 状态` — 这是上一个 session 没收尾的事

### 不要做 (token-protected 自动化)
- 不要试图让画布去拿 ephemeral token (浏览器跨域 + token 不暴露)
- 不要试图让画布写 cron / webhook (要 token)

---

## 五、画布端可以做什么 (我入手)

### 立刻能做 (今天剩余时间)
- [ ] 给 conductor 加"创建后立刻 POST dispatch"那 1 行 — -5s 启动延迟
- [ ] hermes-proxy 加 `--log-file` 参数, 每次调用一条 NDJSON
- [ ] 画布 UI 列 assignee 下拉框: 从 `/api/plugins/kanban/assignees` 拉真实 worker 列表, 用户能选 `default` / `hermes` / 其他 (不再只能填默认)

### 中期 (黑客松后)
- [ ] 写一个 `server/hermes-callback.js` 接受 webhook (等 boss 在 dashboard 配 webhook URL 后启用)
- [ ] 自己包一个 MCP server 把 hermes REST 暴露成 MCP tools (给其他 AI agent 用)

---

## 六、附录: 探测脚本说明

### `.hermes-recon/probe.mjs`
- 26 端点全量扫
- 输出: `probe-<ts>.log` (人读) + `probe-<ts>-summary.json` (机器读)
- 状态码标记:
  - ✅ 200 + JSON
  - 🔒 401/403 (token-protected)
  - 👻 200 + HTML (SPA fallback, 假 200)
  - ⚠ 404
  - ❌ 网络错误 / timeout

### `.hermes-recon/probe-extra.mjs`
- 13 个补充端点 + POST 探测
- 区分了真假 200 (引入 👻 标记)

### 用法
```bash
cd "E:/claude code/know-canvas"
HERMES_USER=hermes HERMES_PASS=bdegDr5w4GfIqwEFH5+ZYMYK node .hermes-recon/probe.mjs
# 或者直接默认凭据
node .hermes-recon/probe.mjs
node .hermes-recon/probe.mjs http://localhost:9119  # 探本地 hermes
```

---

## 七、版本

| 时间 | 谁 | 改了什么 |
|------|-----|---------|
| 2026-05-02 | ui-cc | 初版, 26+13 端点实测落地 |
