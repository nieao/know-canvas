# Orchestra Runbook — 实现记录与上手指南

> 写于 2026-05-02 18:22 by [orchestra-cc]
> 配套设计文档：[`orchestra-blackboard-spec.md`](./orchestra-blackboard-spec.md)
> 配套协作记录：[`CC-HANDOFF.md`](./CC-HANDOFF.md)

把画布从"知识图谱协作工具"升级为**多 agent 协作黑板**。Y.Doc 不只是前端同步，它是 dispatcher / worker / 浏览器 / 飞书 bot 的共享内存。

---

## 1. 已实现的能力

### 1.1 后端组件（全新增 / 不碰 ui-cc 边界）

| 文件 | 行数 | 职责 |
|------|------|------|
| `server/orchestra-base.js` | 220 | OrchestraWorker 基类 — observe + CAS 抢锁 + lease 心跳 |
| `server/orchestra-dispatcher.js` | 145 | 调度器 — ready-set 计算 + lease 超时回收 |
| `server/orchestra-hermes-worker.js` | 110 | Hermes worker（mock + 真 API 双模式） |
| `server/orchestra-http.js` | 280 | 派单台 HTTP API + 极简 console UI（端口 17082） |
| `server/orchestra-e2e-test.js` | 145 | 单 worker 端到端测试 |
| `server/orchestra-race-test.js` | 145 | 3 副本 CAS 竞态测试 |

### 1.2 启动器

- `start-orchestra.bat` — 守护壳一键起 5 服务（yws + dispatcher + hermes-worker + orchestra-http + vite）+ 自动开 2 浏览器
- `stop-orchestra.bat` — 端口清理 + node 进程扫描清理

### 1.3 文档

- `docs/orchestra-blackboard-spec.md` — 16 节完整设计 spec
- `docs/orchestra-runbook.md` — 本文档
- `docs/CC-HANDOFF.md` — 多 cc 协作签字（已追加 [orchestra-cc] 入场 + 完工）

### 1.4 兼容性保证

**与现有 manual TaskNode 流完全解耦**：
- 现有"浏览器点'派给 Hermes'按钮 → fetch hermes-proxy:17081"流不动
- 新加可选字段 `data.agentMode='auto' | 'manual'`（默认 manual）
- 只有 `agentMode === 'auto'` 的节点 orchestra 才接
- 零回归风险

---

## 2. 已验证的合约

| 测试 | 命令 | 验证 |
|------|------|------|
| 单 worker 端到端 | `cd server && npm run orchestra:e2e` | draft → running → done + 自动建 ResultNode + edge |
| CAS 竞态（3 副本抢 5 task） | `cd server && npm run orchestra:race` | 全部 done，每 task 恰好 1 个 ResultNode（不双跑） |
| 真实浏览器视角 | `npx playwright test e2e/orchestra-real-run.spec.js` | 浏览器看到 TaskNode → 流转 done → ResultNode |

最后一项是关键："真实运行"——HTTP 注入 → Yjs 同步 → dispatcher → worker → 浏览器实时看到。**不是 mock 测试，是真启动栈跑**。

---

## 3. 上手 — 一键启动

```bat
start-orchestra.bat
```

会自动：
1. 杀端口 1234 / 17082 / 5180 旧进程
2. 起 y-ws-server (1234) + dispatcher + hermes-worker + orchestra-http (17082) + vite (5180)
3. 自动打开浏览器：画布 + 派单台

默认 room 是 `demo-orch`。

### 3.1 操作流

1. 浏览器画布 tab：填用户名 → 自动进入 `demo-orch` 房间
2. 浏览器派单台 tab：填标题 + 描述 + 选 agent → 点"注入到画布"
3. 画布 tab **实时**看到 TaskNode 出现 → 4 秒后 → status='done' + ResultNode 涌现连线

每一次都是真的写 Y.Doc → 真的经过 dispatcher 推进 → 真的被 worker 抢锁跑。多个浏览器进同房间会同时看到。

---

## 4. 上手 — 手动启动（不用 BAT）

如果不想双击 BAT，5 个终端：

```bash
# T1: yjs sync (foundational)
cd server && npm run yws

# T2: dispatcher
cd server && node orchestra-dispatcher.js demo-orch

# T3: hermes worker (默认 mock; 真调 Hermes 需 set HERMES_USER/HERMES_PASS)
cd server && node orchestra-hermes-worker.js demo-orch

# T4: HTTP 派单台
cd server && npm run orchestra:http

# T5: vite 前端
npm run dev
```

然后：
- 画布：http://localhost:5180/?room=demo-orch
- 派单台：http://localhost:17082/

---

## 5. 关键 API

### 5.1 注入 auto task（curl）

```bash
curl -X POST http://localhost:17082/api/orchestra/inject \
  -H "Content-Type: application/json" \
  -d '{
    "room": "demo-orch",
    "title": "调研 3 个开源画布工具",
    "body": "列出 tldraw / excalidraw / know-canvas 的差异点",
    "assignedTo": "hermes"
  }'
```

返回 `{ ok: true, taskId: "task-...", node: {...} }`。

### 5.2 列任务状态（轮询）

```bash
curl "http://localhost:17082/api/orchestra/list?room=demo-orch"
```

返回 `{ tasks: [...], results: [...] }`。

### 5.3 节点 schema（写入 Y.Doc 的样子）

```js
// TaskNode.data
{
  title: string,
  body: string,
  status: 'draft' | 'pending' | 'running' | 'done' | 'failed',
  agentMode: 'auto' | 'manual',         // 新加, 默认 manual
  assignedTo: 'hermes' | 'claude-cli' | 'feishu-bot' | 'human:nieao' | null,
  claimedBy: string | null,             // worker 实例 ID
  claimedAt: ISO timestamp | null,
  leaseExpiresAt: ISO timestamp | null, // 5 分钟续约
  finishedAt: ISO timestamp | null,
  error: string | null,
}
```

```js
// ResultNode.data (双 schema 兼容)
{
  // ResultNode UI 期望 (snake_case)
  source_task_id, source_title, task_id, assignee, finished_at, result,
  // orchestra-http 列表 / 调试镜像 (camelCase)
  sourceTaskId, producedBy, summary, createdAt,
}
```

---

## 6. 已踩坑沉淀（避免重蹈）

### 6.1 room 隔离 — dispatcher / worker 一对一

每个 dispatcher / worker 进程**只 connect 一个 room**。注入到别的 room 没人推进。

如果要服务多 room：起多个进程，或扩 dispatcher 接受多 room CLI 参数（已支持：`node orchestra-dispatcher.js room1 room2 room3`）。

### 6.2 ResultNode schema 错配

ResultNode UI 期望 `data.result` 是字符串 + snake_case 字段名。早期 worker 写 `result` 为对象会让 React 报 "Objects are not valid as a React child"，整个画布 ErrorBoundary。

修复：worker 端 `_createResultNode` 自动 `JSON.stringify(result)` + 双写 snake_case/camelCase。已在 `orchestra-base.js` 内联。

### 6.3 LevelDB 持久化会带回坏数据

y-ws-server 的 `setPersistence` 把每个 room 的 Y.Doc 持久化到 `server/yjs-data/<roomId>/`。一旦某个 room 写过坏 schema 节点（譬如上面的 6.2 bug），后续浏览器再进该 room **仍会**加载到坏节点 → ErrorBoundary。

清理方式：
```bash
# 停 y-ws-server, 然后:
rm -rf server/yjs-data/demo-orchestra/   # 清单个房间
# 或全清:
rm -rf server/yjs-data/
# 重启 y-ws-server
```

或换房间名（如 `demo-orch-v2`）回避。

### 6.4 Vite IPv4/v6 dual-stack

`http://localhost:5180/` 和 `http://[::1]:5180/` 通，但 `http://127.0.0.1:5180/` 在某些 Windows 配置下不通。Playwright 配置用 `localhost`。

### 6.5 Yjs 中间态可能被合并掉

`pending` 这个中间态（dispatcher promote → worker claim 之间 < 1ms）在 Yjs 网络层可能被合并成一帧 update，浏览器 / 远端 client 看到的是 `draft → running` 直接跳。

不是 bug。dispatcher 的 promote 行为日志能验证它确实发生了，浏览器看不见就是看不见。e2e 测试不要断言 pending 中间态。

### 6.6 Windows cmd 中文显示乱码 ≠ 数据乱

PowerShell / cmd 用 GBK 渲染从 stdout 来的 UTF-8 字节，会显示乱码。但 Y.Doc 里存的字节是真 UTF-8，浏览器 / 其它 client 读出来正常。**不要被假象误导去"修"它**。

---

## 7. 多 cc 协作记录

| 角色 | 我做的 | ui-cc 做的 |
|------|--------|----------|
| 文件 | server/orchestra-* (全新增), docs/orchestra-* (新增), start/stop-orchestra.bat | KnowledgeCanvas 双击 / BottomAIBar Aletheia 框架生成 + 派分支 |
| 数据流 | 后端 Y.Doc client + agent 抢锁 + 写结果 | 前端 UI + 创建 manual 任务流 |
| 边界 | 不碰 src/components/canvas/, src/pages/panels/, useCanvasStore 的 dispatchTaskNode | 不动 server/orchestra-* |

CC-HANDOFF 上有 [orchestra-cc] 完工签字 + 释放锁。

---

## 8. 下一步选项

按优先级：

1. **真接 Hermes API**
   - 需要 `HERMES_USER` / `HERMES_PASS` 环境变量
   - worker 默认 mock，set 凭据后会自动切真模式
   - hermes-proxy:17081 现有 manual 流可作 schema 参考
   - 估时：30 分钟（凭据私聊 + 重启 worker）

2. **claude-cli worker**
   - 继承 OrchestraWorker，`run(node)` 里 spawn 本机 `claude` subprocess
   - 复用 `server/claude-bridge.js` 的 spawn 逻辑
   - 估时：1-2 小时
   - 价值：让画布上 `assignedTo='claude-cli'` 的任务用本机零成本 LLM 跑

3. **飞书 bot worker**
   - 双向：飞书消息 → 写画布；画布动作 → 推飞书群
   - 同一个 OrchestraWorker 子类即可（observeDeep 推飞书 + run() 处理飞书来的派单）
   - 估时：半天
   - 见前面"飞书 bot 也能控制画布"对话

4. **TaskNode UI 加 agentMode 切换**
   - ui-cc 边界。我等他们方便时加，或者下次见面直接谈。
   - 当前用 `orchestra-http` 派单台代偿。

5. **生产部署**
   - 把 dispatcher + hermes-worker + orchestra-http 加进 `deploy/` 的 systemd unit
   - 同 VPS 跟 y-ws-server / hermes-proxy 一起跑

---

## 9. 当前活栈快照（写本文档时）

| 服务 | 运行状态 | 数据 |
|------|----------|------|
| y-ws-server (1234) | ✓ persist=true | yjs-data/{demo-orchestra, demo-orch-v2, e2e-real-...} |
| orchestra-dispatcher | ✓ 监听 demo-orch-v2 | — |
| orchestra-hermes-worker | ✓ MOCK，监听 demo-orch-v2 | — |
| orchestra-http (17082) | ✓ | rooms_connected=[demo-orchestra, e2e-real-..., demo-orch-v2] |
| vite (5180) | ✓ | — |

`demo-orchestra` 房间留了 2 个早期 bug 期间产生的坏 ResultNode（result 字段是 object），进该房间会 ErrorBoundary。建议清持久化或换 room 名。`demo-orch-v2` / `demo-orch` 干净。

---

## 10. 文件清单（本次新增）

```
docs/
  orchestra-blackboard-spec.md      # 16 节设计 spec
  orchestra-runbook.md              # 本文档

server/
  orchestra-base.js                 # 220 行 — Worker 基类
  orchestra-dispatcher.js           # 145 行 — 调度器
  orchestra-hermes-worker.js        # 110 行 — Hermes worker (mock+真双模式)
  orchestra-http.js                 # 280 行 — HTTP 派单台 + console
  orchestra-e2e-test.js             # 145 行 — 端到端测试
  orchestra-race-test.js            # 145 行 — 竞态测试
  package.json                      # 加 4 个 npm script

e2e/
  orchestra-real-run.spec.js        # Playwright 真实浏览器视角验证

start-orchestra.bat                 # 一键启动
stop-orchestra.bat                  # 一键停
```

无 src/ 改动（避开 ui-cc 边界）。
