# Know Canvas × Hermes 集成改造规范 v0.1

> **目标**: 把 know-canvas 从纯前端单机画布改造为**多人实时协作 + AI 任务执行**的云端产品, 跟 Hermes Agent (`ha2.digitalvio.shop`) + metahermes (`E:\claude code\黑客松 5-1\metahermes`) 形成完整三件套。
>
> **本文档面向**: 另一个 cc 进程 (实施方) + 你想猫 (产品方) + 黑客松团队评委。
>
> **状态**: 草案 — 等"你想猫 + 实施方 cc"双签字后冻结再动手。

---

## 0. 部署形态 (新约束 — boss 2026-05-02 14:30 追加)

> 原 spec 假设走 Cloudflare Workers + Durable Objects 独立部署。
> **新约束**: know-canvas 要部署到 `ha2.digitalvio.shop` 同一台 VPS (Hermes 已经装在上面)。
>
> `[ui-cc]` 写 P0-PLAN 必须先回答: 选 A / B / C / 还是先用 D 临时方案?

| 方案 | 形态 | 优 | 劣 |
|---|---|---|---|
| **A. 同机子路径** | `https://ha2.digitalvio.shop/canvas/` (Nginx 反代到本地 :5180) | 同源 = 无 CORS, 凭据走 Nginx 层共用, 部署简单 | 跟 Hermes 共享 Nginx 配置 |
| **B. 同机子域名** | `https://canvas.digitalvio.shop/` (新 A 记录 + 独立 server block) | 路径干净, 跟 Hermes 解耦, 独立 SSL | 需新 SSL 证书 + DNS 改动 |
| **C. 同 VPS 完全独立** | 同 B + 独立 daemon | 故障隔离最干净 | 部署最重 |
| **D. 临时本地 (P0 fallback)** | `http://localhost:5180` 开发, demo 在评委电脑跑 | 0 部署成本 | 多人协作不可能, P0 demo 只能一台机 |

**对原 spec 的影响**:
- 走 A/B/C 时, **可以不用 Cloudflare Workers** (本机 Node + ws + sqlite 即可); §3 Worker API 仍 valid, 但实现栈改 Node
- 凭据保管: A 方案下浏览器走 Nginx Basic Auth, 不需要 Worker 中转; B/C 方案下凭据仍要在 Node 后端
- Yjs sync server: 用纯 Node `y-websocket-server` 替代 Cloudflare DO, 同样能用
- R2 → 本地 sqlite + 文件 (不依赖云存储)

**`[ui-cc]` P0 推荐路径**: D (本地直连真 Hermes) 黑客松 demo 用 → P1 升 A 或 B (boss 决定后)。

---

## 1. 三件套全景

```
┌──────────────────────────────────────────────────────────┐
│  know-canvas (本仓库, 改造对象)                           │
│  React 19 + React Flow 11 + Zustand 5 + Yjs (新增)       │
│  - 现有 8 节点 + 8 关系 + 4 布局 (不动)                  │
│  - 新增 TaskNode / ResultNode (本规范定义)                │
│  - 现有 Zustand store 渐进迁到 Yjs CRDT (不破坏单机模式) │
└──────────────────────┬───────────────────────────────────┘
                       │ Yjs over WebSocket (sync)
                       │ + REST: POST /api/dispatch
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Cloudflare Workers + Durable Objects + R2 (新仓库 / 子目录)│
│  - 每个 canvas/{id} = 1 个 DO 实例 (天然隔离 sync server) │
│  - 跑 Yjs sync server (用 y-durableobjects 库)           │
│  - REST API: 派任务 / 查状态                              │
│  - 持久化: R2 存 canvas 历史快照, D1 存 task 元数据        │
│  - 调 Hermes Kanban API (复用 metahermes/hermes_bridge)  │
└──────────────────────┬───────────────────────────────────┘
                       │ Basic Auth + JSON
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Hermes Agent v0.12.0 @ ha2.digitalvio.shop              │
│  + metahermes/hermes_pack (装载的 Skill / Profile / Cron) │
└──────────────────────────────────────────────────────────┘
```

**职责切分**:
- **know-canvas (前端)**: UI + 本地交互 + Yjs 客户端
- **Worker (后端)**: 多人 sync 中转 + Hermes 派单代理 + 凭据保管 (HERMES_PASS 不暴露给浏览器)
- **Hermes**: AI 执行
- **metahermes**: 提供 hermes_bridge Python 包 (Worker 调它的 API 转译; 或直接用 TypeScript 重写一份 thin client)

---

## 2. 新数据结构

### 2.1 TaskNode (新节点类型)

```typescript
// src/types/TaskNode.ts (新建)

export type TaskStatus =
  | "draft"     // 还没派出, 用户在画布上编辑
  | "ready"     // 已派出, 等 Hermes worker 接
  | "running"   // worker 正在跑
  | "blocked"   // 卡住 (合规违规 / 超时 / 异常)
  | "done"      // 完成, 有 result_node_id
  | "cancelled" // 用户撤回

export interface TaskNodeData {
  // === 用户编辑字段 ===
  title: string;                   // 任务标题 (required)
  body: string;                    // 任务描述 (markdown)
  assignee: string | null;         // Hermes 上的 profile 名, e.g. "railway-data-analyst"
  skills: string[];                // 期望 worker 启用的 Skill 名 (可选)
  priority: 0 | 1 | 2 | 3;         // 0=normal, 3=urgent
  max_runtime_seconds: number;     // 默认 600

  // === 系统字段 (Worker 写入, 前端只读) ===
  status: TaskStatus;
  hermes_task_id: string | null;   // Hermes 那边的 task_id (e.g. "t_c4c3f009")
  dispatched_at: number | null;    // Unix timestamp ms
  started_at: number | null;
  completed_at: number | null;
  result_node_id: string | null;   // 完成后, 自动新建的 ResultNode 的 id
  error_message: string | null;    // blocked / cancelled 时的原因
  worker_log_tail: string;         // 实时日志末尾, Worker 通过 WS 推
  events: TaskEvent[];             // 关键事件流 (created / dispatched / running / done)
}

export interface TaskEvent {
  type: "created" | "dispatched" | "running" | "log" | "done" | "blocked" | "cancelled";
  ts: number;          // ms
  payload?: Record<string, unknown>;
}
```

**Zustand action 约定** (在 `useCanvasStore` 加):

```typescript
// 用户操作: 创建草稿
addTaskNode(position: XYPosition, init: Partial<TaskNodeData>): string  // 返回 nodeId

// 用户操作: 编辑后派出
dispatchTask(nodeId: string): Promise<void>
  // → 发 POST /api/canvas/:canvasId/dispatch { node_id }
  // → status: draft → ready

// Worker 推回 (通过 Yjs / WS): 状态变化
applyTaskUpdate(nodeId: string, patch: Partial<TaskNodeData>): void

// Worker 推回: 任务完成, 新建 ResultNode + 自动连线
spawnResultNode(taskNodeId: string, result: ResultNodeData): string
```

### 2.2 ResultNode (新节点类型)

```typescript
// src/types/ResultNode.ts (新建)

export interface ResultNodeData {
  task_node_id: string;            // 反向引用 TaskNode
  hermes_task_id: string;          // 同上
  produced_at: number;
  body: string;                    // Hermes 的 result.result 字段 (markdown)
  evidence: {
    skill_used: string[];          // 实际触发的 Skill
    log_chars: number;
    elapsed_s: number;
    profile: string;               // 哪个 worker profile 跑的
    [k: string]: unknown;
  };
}
```

**自动行为**:
- ResultNode 创建后, 立即自动 `addEdge(taskNodeId, resultNodeId, { type: "顺序" })`
- 位置: TaskNode 右侧 320px + 同 y
- 视觉: 比 ConceptNode 更窄, 顶部有暖色细线 (`border-top: 2px solid var(--warm)`), 内容默认折叠, 点开看 markdown

### 2.3 Worker 端 Schema (D1 表)

```sql
-- worker/schema.sql

CREATE TABLE canvas (
  id TEXT PRIMARY KEY,           -- nanoid
  owner_id TEXT NOT NULL,        -- 创建者 (后续接 auth)
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  yjs_snapshot_url TEXT          -- R2 路径, 最新 Yjs doc 快照
);

CREATE TABLE task (
  id TEXT PRIMARY KEY,           -- 跟 know-canvas 那边的 nodeId 一致
  canvas_id TEXT NOT NULL,
  hermes_task_id TEXT,           -- 跟 Hermes kanban 任务 id 一致 (允许 NULL: 还没 dispatch 时)
  status TEXT NOT NULL,
  assignee TEXT,
  payload_json TEXT NOT NULL,    -- 完整 TaskNodeData 序列化
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (canvas_id) REFERENCES canvas(id)
);

CREATE INDEX idx_task_canvas ON task(canvas_id);
CREATE INDEX idx_task_hermes ON task(hermes_task_id);
CREATE INDEX idx_task_status ON task(status);
```

---

## 3. Worker API (Cloudflare)

### 3.1 REST 端点

| Method | Path | 鉴权 | 作用 |
|---|---|---|---|
| POST | `/api/canvas` | session | 新建画布, 返回 `{ canvas_id }` |
| GET | `/api/canvas/:id` | session | 拉画布元数据 + 最新 snapshot URL |
| GET | `/api/canvas/:id/yjs` | session | WebSocket upgrade: Yjs sync 通道 (协议: `y-protocols`) |
| POST | `/api/canvas/:id/dispatch` | session | 把某个 TaskNode 派给 Hermes |
| GET | `/api/canvas/:id/tasks` | session | 列出本画布所有 task + 状态 (供 UI 总览) |
| POST | `/api/canvas/:id/tasks/:tid/cancel` | session | 取消任务 (PATCH Hermes task = blocked) |
| GET | `/api/canvas/:id/events` | session | WebSocket: 推 task 状态变化 (跟 Yjs 通道分开, 防数据混杂) |

### 3.2 dispatch 端点详细 schema

```typescript
// POST /api/canvas/:canvas_id/dispatch
// Request:
{
  "node_id": "tn_xxxxxxxx",      // know-canvas 那边的 TaskNode id
  "title": "...",                // 透传, Worker 用于 Hermes title
  "body": "...",                 // 透传
  "assignee": "railway-data-analyst",
  "skills": ["railway-incident-triage"],
  "priority": 1,
  "max_runtime_seconds": 600,
  "idempotency_key": "tn_xxxxxxxx-v1"  // 防止重派
}

// Response (200):
{
  "ok": true,
  "hermes_task_id": "t_c4c3f009",
  "dispatched_at": 1777693116000,
  "ws_subscribe_topic": "canvas:abc123:task:tn_xxxxxxxx"  // 客户端订阅这个 topic 拿后续推送
}

// Response (4xx):
{
  "ok": false,
  "error": "missing_assignee" | "hermes_unreachable" | "rate_limited",
  "detail": "..."
}
```

### 3.3 WebSocket 事件 (`/api/canvas/:id/events`)

服务端推:

```typescript
// 任务状态变化
{
  "type": "task:status_changed",
  "node_id": "tn_xxxxxxxx",
  "from": "ready",
  "to": "running",
  "ts": 1777693200000,
  "snapshot": { /* 完整最新 TaskNodeData */ }
}

// 实时日志增量
{
  "type": "task:log_append",
  "node_id": "tn_xxxxxxxx",
  "lines": ["[12:34] worker started", "[12:35] using railway-incident-triage skill"],
  "ts": 1777693250000
}

// 任务完成 — 客户端收到后, 立即在画布 spawn ResultNode
{
  "type": "task:completed",
  "node_id": "tn_xxxxxxxx",
  "result_node": {
    "id": "rn_yyyyyyyy",        // 服务端预生成 id, 确保多客户端看到的是同一个 ResultNode
    "data": { /* ResultNodeData */ }
  },
  "ts": 1777693400000
}

// 任务卡住
{
  "type": "task:blocked",
  "node_id": "tn_xxxxxxxx",
  "error": "max_runtime exceeded",
  "ts": 1777693500000
}
```

### 3.4 Worker 内部: 调 Hermes 的实现

```typescript
// worker/src/hermes.ts

export class HermesClient {
  constructor(private user: string, private pass: string, private base: string) {}

  async createTask(payload: { ... }) {
    const auth = "Basic " + btoa(`${this.user}:${this.pass}`);
    const resp = await fetch(`${this.base}/api/plugins/kanban/tasks`, {
      method: "POST",
      headers: {
        "Authorization": auth,
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Mozilla/5.0 (compatible; metahermes-worker/0.1)"
        // ↑ 关键: Hermes 反爬中间件会拒 fetch 默认 UA, 必须自定义
        // 来源: metahermes/hermes_bridge/hermes_kanban.py 已踩过同样坑
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`hermes ${resp.status}: ${await resp.text()}`);
    return await resp.json();
  }

  async getTask(taskId: string) { /* ... */ }
  async dispatch(opts: { dry_run?: boolean; max?: number } = {}) { /* ... */ }
}
```

### 3.5 Worker 部署约定

```
worker/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              ← 入口, 路由分发
│   ├── canvas-do.ts          ← Durable Object: CanvasRoom
│   ├── yjs-handler.ts        ← Yjs sync 协议处理
│   ├── hermes.ts             ← Hermes Client
│   ├── poller.ts             ← DO Alarm: 每 3s 轮询 in-flight task 状态
│   └── schemas.ts            ← Zod schema (跟 know-canvas/types 共享)
├── schema.sql                ← D1 表结构
└── README.md                 ← 部署 + 环境变量 + scripts
```

环境变量 (`wrangler.toml` secrets):
- `HERMES_USER`, `HERMES_PASS`, `HERMES_BASE` — Worker 保管, 不暴露给前端
- `SESSION_SECRET` — 签 session cookie

---

## 4. Yjs 集成方案 (核心难点)

### 4.1 渐进式迁移策略

**不拆现有 Zustand store**, 而是给它加一个"sync layer":

```typescript
// src/stores/yjsSync.ts (新建)

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useCanvasStore } from './useCanvasStore';

export function attachYjsSync(canvasId: string, wsUrl: string) {
  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(wsUrl, canvasId, ydoc);

  const ynodes = ydoc.getMap('nodes');     // nodeId → node JSON
  const yedges = ydoc.getMap('edges');     // edgeId → edge JSON

  // Zustand → Yjs (本地操作 → 推到所有人)
  useCanvasStore.subscribe(state => state.nodes, (nodes) => {
    ydoc.transact(() => {
      // diff 当前 ynodes 和 nodes, apply 差异
      // (用 immer 思路, 只 apply 变化部分, 不全量覆盖)
    }, 'local');
  });

  // Yjs → Zustand (远程操作 → 更新本地)
  ynodes.observe(event => {
    if (event.transaction.origin === 'local') return;  // 自己刚 push 的不回应
    useCanvasStore.setState(state => {
      // 把 ynodes 的变化 apply 到 state.nodes
    });
  });

  return { ydoc, provider, dispose: () => provider.destroy() };
}
```

**关键点**:
- Yjs Map 跟 Zustand state 双向 sync, 但用 `origin` 区分谁触发的, 防死循环
- TaskNode 的 `status` / `hermes_task_id` / `events` 也走 Yjs (这样多人都看到任务进度), Worker 推送的事件直接写 Yjs
- 单机模式仍然能用: 不调 `attachYjsSync` 时, useCanvasStore 完全本地工作 (向后兼容)

### 4.2 React Flow 适配

现有的 `KnowledgeCanvas.jsx` 用 `useCanvasStore` 读 nodes/edges, **不需要改**。
React Flow 11 不依赖 Yjs, 它只看 props.nodes/edges, sync 层通过 store 中转就行。

唯一注意: 拖动节点时 Zustand 会高频写入 (60fps), 必须 throttle 才推 Yjs (e.g. 100ms 一次), 不然 WS 会被打爆。

```typescript
// 拖动节点的 onChange 加 throttle
import { throttle } from 'lodash-es';
const throttledSync = throttle(syncToYjs, 100);
```

---

## 5. 改造文件清单

### 5.1 know-canvas 这一侧

| 文件 | 动作 | 估时 |
|---|---|---|
| `src/types/TaskNode.ts` | **新建** | 30 min |
| `src/types/ResultNode.ts` | **新建** | 15 min |
| `src/components/canvas/TaskNode.jsx` | **新建** (照 ConceptNode 风格 + 状态徽章 + dispatch 按钮) | 2 h |
| `src/components/canvas/ResultNode.jsx` | **新建** (折叠式, 暖色顶线) | 1.5 h |
| `src/components/canvas/KnowledgeCanvas.jsx` | **改** (nodeTypes 注册新两种) | 30 min |
| `src/stores/useCanvasStore.js` | **改** (加 addTaskNode / dispatchTask / applyTaskUpdate / spawnResultNode) | 2 h |
| `src/stores/yjsSync.ts` | **新建** (Yjs ↔ Zustand 双向 sync) | 4 h |
| `src/services/hermesSync.ts` | **新建** (订阅 Worker WS event channel, 调 applyTaskUpdate / spawnResultNode) | 2 h |
| `src/services/aiService.js` | **轻改** (现有的可以复用部分, 加 dispatchTask 高层封装) | 1 h |
| `src/pages/KnowledgeGraph.jsx` | **改** (启动时 attachYjsSync, 接 hermesSync) | 1 h |
| `src/pages/panels/RightPanel.jsx` | **改** (TaskNode 选中时, 显示 dispatch 表单 + 实时 log) | 2 h |
| `src/pages/panels/BottomAIBar.jsx` | **改** (新增 "派给 Hermes" 按钮, 把选中 ConceptNode 转 TaskNode) | 1 h |
| `e2e/hermes-flow.spec.js` | **新建** (端到端: 创建 TaskNode → mock dispatch → ResultNode 出现) | 2 h |
| `package.json` | **改** (加 yjs / y-websocket / lodash-es / nanoid) | 5 min |

**小计 know-canvas 侧**: ~20 h

### 5.2 Worker 这一侧 (新仓库或子目录)

| 文件 | 动作 | 估时 |
|---|---|---|
| `worker/wrangler.toml` | **新建** | 30 min |
| `worker/src/index.ts` | **新建** (路由 + auth) | 1 h |
| `worker/src/canvas-do.ts` | **新建** (Durable Object, Yjs sync 主体) | 4 h |
| `worker/src/yjs-handler.ts` | **新建** (用 `y-protocols` 处理 sync/awareness 消息) | 3 h |
| `worker/src/hermes.ts` | **新建** (HermesClient, 移植自 `metahermes/hermes_bridge/hermes_kanban.py`) | 2 h |
| `worker/src/poller.ts` | **新建** (DO Alarm 每 3s 轮询, 推 task 状态变化到 WS) | 2 h |
| `worker/src/schemas.ts` | **新建** (Zod schema, 跟 know-canvas/types 共享) | 1 h |
| `worker/schema.sql` | **新建** | 30 min |
| `worker/README.md` | **新建** (部署步骤) | 30 min |

**小计 Worker 侧**: ~14 h

**总工作量估算**: 34 h, 黑客松剩 25 h **不够 100% 完工**, 但够做 P0 (单机改 TaskNode + 单实例 dispatch 不上 Cloudflare) → 演示能跑, P1 留作黑客松后。

---

## 6. P0/P1/P2 推荐节奏 (黑客松剩 ~25h)

### P0 — 必做 (6-8h, 演示门面)

> **目标**: 黑客松能 demo "在画布上拖一个 TaskNode, 点 dispatch, 看到 Hermes 真在跑, 结果回到画布"。

1. `src/types/TaskNode.ts` + `src/types/ResultNode.ts`
2. `src/components/canvas/TaskNode.jsx` + `ResultNode.jsx`
3. `src/stores/useCanvasStore.js` 加 actions
4. **本地直连 Hermes** (跳过 Worker, 浏览器 fetch 直接调 Hermes Kanban API): 凭据先放 `.env.local` (vite 环境变量), 黑客松内部 demo 不暴露
5. `src/services/hermesSync.ts` 用 `setInterval` 轮询 (跳过 WS, 简化)
6. `src/pages/KnowledgeGraph.jsx` + `RightPanel.jsx` 接入

**deliver**: 单机 know-canvas + 真 Hermes, 评委能在 demo 时看到完整 task 生命周期。

### P1 — 强化 (10-14h, 上云 + 多人)

7. Cloudflare Worker 骨架 (canvas-do + yjs-handler)
8. Yjs 集成到 know-canvas (`yjsSync.ts`)
9. WS 事件通道 (Worker 推 task 状态)
10. 凭据从前端搬到 Worker (安全)

**deliver**: 三人浏览器同时改画布 + 派任务 + 结果回流, 部署在 `canvas.<your-domain>.workers.dev`

### P2 — 彩蛋 (剩余时间)

11. 画布"画"出 SKILL.md 反向导出 (从节点拓扑生成 Skill, 装回 Hermes)
12. 接得到笔记 / 飞书做"知识源" (新节点类型: NoteSourceNode)
13. e2e 测试

---

## 7. 跟 metahermes 的接口约定

**复用方式**:
- **不直接 import** `metahermes/hermes_bridge` Python 包 (Worker 是 TypeScript)
- **重写 thin TypeScript client**, 但**严格遵循**它的同名接口 (create_task, dispatch, wait_for_task, get_task_log)
- 共享 idempotency_key 命名约定: `<source>-<canvasid>-<nodeid>-v<rev>` (避免重派)
- 所有踩坑教训复用: User-Agent 必须自定义 (Hermes 反爬中间件), Basic Auth 头, Content-Type 必带 charset=utf-8

**hermes_pack 装载**:
- Worker 启动时 (或定时) **不**自动装载 hermes_pack 的 Skill — 由 lichang333 手动跑 `python -m metahermes.hermes_pack.install`
- Worker 只**消费**已经装好的 Skill (在 dispatch 时通过 `skills: [...]` 字段告诉 Hermes 启用哪些)
- Profile 创建也是手动 (Hermes Dashboard 上点), Worker 创建任务时只引用 assignee 名

---

## 8. 验收标准 (实施 cc 完工的判定)

### P0 验收 (黑客松必须达到)

- [ ] 在 know-canvas 双击空白处, 弹出"新建任务"对话框, 可选 assignee + skills
- [ ] 创建后画布出现 TaskNode, 状态 = `draft`, 头部有暖色"未派出"徽章
- [ ] 点 TaskNode 的 "派给 Hermes" 按钮, 状态变 `ready`, 徽章变蓝色 + 转圈动画
- [ ] 几秒后状态变 `running` (因为 Hermes 真接到了)
- [ ] 任务完成后, 自动在右侧出现 ResultNode + 一根连线, ResultNode 头部暖色细线
- [ ] 双击 ResultNode 展开, 看到 markdown 渲染的 Hermes 输出
- [ ] 整个过程在 Hermes Dashboard `https://ha2.digitalvio.shop/` 的 kanban 页能看到对应任务

### P1 验收

- [ ] 部署到 Cloudflare Workers, 域名访问能跑
- [ ] 两个浏览器同一个 canvasId 打开, 一个改另一个 0.5s 内看到
- [ ] HERMES_PASS 不在前端代码 / 网络请求里出现
- [ ] WS 断线重连不丢数据 (Yjs 自带)

### 视觉规范

**严格遵循** `~/.claude/CLAUDE.md` 的"建筑极简唯美" 设计系统:
- 暖色 `#c8a882` 仅用于强调元素 (徽章、连线、按钮 hover)
- 节点边框 `1px solid #e8e8e8`, hover 变暖色
- 衬线标题 `Noto Serif SC`, 无衬线正文 `Noto Sans SC`
- 8px 倍数间距
- 不用框线字符 / 装饰 emoji

---

## 9. 实施 cc 应当先做的事 (handoff 第一步)

1. **读** 本文档 + `know-canvas/CLAUDE.md` + `know-canvas/README.md`
2. **看** `metahermes/hermes_bridge/hermes_kanban.py` (理解 Hermes API 真实形态 + 已踩坑)
3. **建分支** `feat/hermes-integration` (不直接改 main)
4. **写一份你的 P0 实施计划** 到 `know-canvas/docs/P0-PLAN-cc<你的标识>.md`, 包含:
   - 你打算先做哪 3 个文件
   - 你不打算用本文档的哪些设计选择 + 为什么
   - 你需要"你想猫" 决策的开放问题
5. **不动手写代码**, 等"你想猫"在该 P0-PLAN 文件末尾签字 (写"GO" 一行) 才开始
6. **每完成一个文件, 在 `know-canvas/docs/CC-HANDOFF.md` 末尾追加一条**, 格式见该文件

---

## 10. 开放问题 (等你想猫拍)

- [ ] **canvasId 怎么生成 + 怎么分享给团队成员**? URL 直接 `?id=xxx` 还是登录后的 dashboard 列表?
- [ ] **要不要 auth**? 黑客松 demo 可以无 auth (anyone-with-link), 后续再加
- [ ] **TaskNode 的 assignee 字段**, 想不想做"实时拉 Hermes profile 列表" 的下拉? 受限于 token-protected, 可能只能手填
- [ ] **同一画布是否允许同时多个 TaskNode 派出**? 或者要排队?
- [ ] **Yjs 的画布数据要不要持久化**? 如果丢失, 团队工作就没了 — Worker R2 定期 snapshot 是必须的
- [ ] **域名**? `canvas.nieao.dev` / `canvas.digitalvio.shop` / Cloudflare 默认 `*.workers.dev`?

---

## 11. 黑客松交付的最终形态 (理想状态)

```
评委打开 https://canvas.<domain>/?id=demo-railway

→ 看到画布上已经有几个节点 (轨交场景的预设)
→ 评委拖一个 TaskNode 进来: "1 号线 X 区段信号告警, 帮我分级"
→ assignee 选 "railway-data-analyst"
→ 点 dispatch
→ 几秒后画布上的 TaskNode 状态变 running
→ 同时在 https://ha2.digitalvio.shop/ 能看到 kanban 上有这个任务
→ ~30 秒后 (因为 Hermes 真在调 LLM), TaskNode 旁边自动长出 ResultNode
→ 双击 ResultNode, 看到 markdown 渲染的:
   - 事件分级: III (较大)
   - 判定依据: ...
   - 首步动作: [3 条具体的, 含责任岗位 + 时限]
   - 信息上报清单
   - 关联系统检查
   ← 注意: 这个输出格式是 hermes_pack/skills/railway-incident-triage/SKILL.md 强制的!
   ← Hermes 自己不知道轨交规范, 是因为我们装了 Skill, 它才会这样输出

→ 评委明白了: "这就是 hermes_pack 的力量, 行业知识沉淀进去, 就一直在了"
```

---

## 文档元数据

- 起草: 2026-05-02 by metahermes cc 进程
- 状态: 草案, 等签字
- 联系: 通过 `know-canvas/docs/CC-HANDOFF.md` 异步沟通
- 引用文档:
  - `metahermes/METAHERMES.md`
  - `metahermes/hermes_pack/README.md`
  - `~/.claude/CLAUDE.md` (设计风格 + 编码规范)
