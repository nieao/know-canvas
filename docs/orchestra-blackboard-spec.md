# Orchestra: 画布即多 agent 黑板（Blackboard）

> Yjs Y.Doc 不只是"前端同步用的状态"，它本身就是 agent 共享内存。任何能 connect y-websocket 的 Node 进程，都是这块画布的一等公民 worker。

---

## 1. 核心思想

传统多 agent 框架（CrewAI / AutoGen / LangGraph）都给 agent 一个**集中 orchestrator**，agent 之间通过 message bus 协调。

我们的形态不同：

| 角色 | 做什么 | 通信方式 |
|------|-------|---------|
| **画布（Y.Doc）** | 共享黑板 — 所有 task / status / 关系都写在这里 | Yjs CRDT |
| **dispatcher** | 看黑板，决定哪些 task 现在 ready；超时回收 lease | Y.Doc observe + transact |
| **agent worker** | 看到自己名下的 ready task 就抢锁开干 | Y.Doc observe + transact |
| **人** | 在画布上画/拖/改任意节点 | React Flow + Yjs |

**关键洞察**：人和 agent 操作同一个 Y.Doc，行为模式完全一致。人在画布上拖一条边（加依赖）→ agent 立刻照新拓扑工作。这是中心化 orchestrator 给不了的"人在 loop 里"。

---

## 2. 与现有 manual 流的关系

现在 TaskNode 已经有 manual 流：

```
浏览器 click "派给 Hermes" → fetch hermes-proxy:17081 → Hermes API → polling → 更新 TaskNode
```

这条流**完全保留**。orchestra 是**旁路新增**：

```
任何人改画布让 TaskNode.agentMode='auto' → dispatcher 在 Y.Doc 看到 → 写"ready"标记
                                                    ↓
agent worker 看到自己的 ready task → CAS 抢锁 → 跑 → 写结果回 Y.Doc → 浏览器同步
```

切换由 `data.agentMode` 字段决定（默认 `'manual'`）。零回归风险。

---

## 3. 节点 schema 扩展

现有 `TaskNode.data` 不动，新增以下 **可选** 字段：

| 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|
| `agentMode` | `'manual'` \| `'auto'` | `'manual'` | auto 时由 orchestra 自动调度 |
| `assignedTo` | string \| null | null | agent 名（`'hermes'` / `'claude-cli'` / `'feishu-bot'` / `'human:nieao'`）|
| `claimedAt` | ISO timestamp \| null | null | 抢锁时间，用于 lease 超时回收 |
| `claimedBy` | string \| null | null | 抢到锁的 worker 实例 ID（同名 agent 多副本时区分）|
| `leaseExpiresAt` | ISO timestamp \| null | null | lease 到期时间，过期 dispatcher 把 status 改回 'pending' |
| `inputs` | string[] | [] | 上游节点 ID 列表（暂未启用，预留依赖图）|

`status` 沿用现有 `TASK_NODE_STATUS`：

```
draft → dispatching → pending → running → done | failed
```

orchestra 增加一个虚拟态 `'pending'` 表示"已 ready 但还没被 worker 抢"。

---

## 4. 状态机（auto 模式）

```
draft
  │  (人填完 title + assignedTo, 或 dispatcher 看到 agentMode='auto' && deps OK)
  ▼
pending
  │  (worker A 抢锁: CAS-set status='running', claimedBy=A, claimedAt=now, leaseExpiresAt=now+lease)
  ▼
running
  │  (worker A 跑完，写结果 + status='done')        │ (lease 超时, dispatcher 改回 pending)
  ▼                                                ▼
done                                             pending  (允许另一 worker 重抢)

任意状态 → failed (worker 显式标记 + 写 error 到 data.error)
```

**幂等性**：worker 任务必须做幂等（重抢可能再跑一次）。Hermes 调用走 `idempotency_key`。

---

## 5. CAS 抢锁协议

Y.Doc 的 transact 只在**当前 client 进程内**原子，跨 client 仍可能两个 worker 同时通过判断后 set。所以需要二段验证：

```js
// in worker
function tryClaim(nodeId) {
  let claimed = false
  ydoc.transact(() => {
    const fresh = nodesMap.get(nodeId)
    if (!fresh) return
    if (fresh.data.status !== 'pending') return  // 别人抢走了或已 running/done
    if (fresh.data.assignedTo !== MY_NAME) return  // 不归我
    nodesMap.set(nodeId, {
      ...fresh,
      data: {
        ...fresh.data,
        status: 'running',
        claimedBy: WORKER_ID,
        claimedAt: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString(),
      },
    })
    claimed = true
  })

  if (!claimed) return false

  // 二段确认: 100ms 后再读, 看 claimedBy 是不是我 (CRDT 收敛后的真值)
  await sleep(100)
  const settled = nodesMap.get(nodeId)
  if (settled?.data?.claimedBy !== WORKER_ID) {
    // 双跑了, 我退让
    return false
  }
  return true
}
```

**双跑窗口**：100ms 内两个 worker 都通过 transact 都 set 自己 — Yjs 收敛后只有一个 `claimedBy`（last-write-wins on Map.set）。落败方退出，胜出方继续。坏情况：100ms 内的工作量被白做一次（agent 端无副作用 / 已幂等就 OK）。

---

## 6. lease 心跳与回收

worker 在执行期间每 30s 续 lease：

```js
setInterval(() => {
  if (!isRunning) return
  ydoc.transact(() => {
    const fresh = nodesMap.get(nodeId)
    if (fresh?.data?.claimedBy !== WORKER_ID) return // 已被回收别瞎写
    nodesMap.set(nodeId, {
      ...fresh,
      data: { ...fresh.data, leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString() },
    })
  })
}, 30_000)
```

dispatcher 每 10s 扫一遍所有 `status='running'` 的节点，`leaseExpiresAt < now` 的强制 reset 到 `pending`，并清空 `claimedBy/claimedAt/leaseExpiresAt`。

---

## 7. 调度器职责（dispatcher）

只做三件事：

1. **ready-set 计算**：scan nodesMap，找 `agentMode='auto' && status='draft' && (deps all done)`，把 status 改为 `'pending'`
2. **lease 超时回收**：上面 §6 的 reset
3. **环检测**（防 agent 互相派单死循环）：当一条边 from A.outputs to B.inputs 但 B 的 outputs 又指向 A 时，把 A.B 双方设为 `failed` 并写 error

dispatcher 不做"派给谁" — 那是节点 `assignedTo` 字段决定的（人或上游 agent 写）。

---

## 8. agent 命名规范

- `hermes` — Hermes Kanban worker
- `claude-cli` — 调本地 claude CLI
- `feishu-bot` — 飞书机器人
- `human:<username>` — 派给具体的人（agent 跳过；人在画布上手动改 status）

worker 启动时声明自己叫什么，只接 `assignedTo` 等于自己名的任务。

---

## 9. 与已有 hermes-proxy 的关系

`server/hermes-proxy.js` 是 HTTP 代理，给浏览器 manual 派单用 — **保留不动**。

`server/orchestra-hermes-worker.js` 是 Y.Doc client + Hermes 调用合体：
- import hermes-proxy.js 里的 `hermesCall` 函数（重构出来共用）
- 不走 HTTP 中转，直接调 Hermes API
- 完成后把结果写 Y.Doc，浏览器同步看到

**两条流复用 hermesCall 一份代码**，避免 schema 漂移。

---

## 10. 多 agent 创建 agent 的护栏

防止 agent 自我繁殖爆炸：

- **agent 不能写 status='draft'** 的新节点（draft 只能由人或专门的"分支 agent"创建）
- agent 只能 ：
  - 改自己 owned 节点的 status / data / outputs
  - 创建 type='resultNode' 的结果节点 + 一条 edge 接到自己的 TaskNode
- 违规写入由 dispatcher 检测 + 回滚

最小可演示阶段，agent 行为白名单：`status update only` + `create resultNode + edge`。

---

## 11. demo 场景（黑客松级）

人在画布上画：

```
[ConceptNode: 营销主题]
       │
       ▼
[TaskNode: 调研 5 个竞品]
agentMode: 'auto'
assignedTo: 'hermes'
       │
       ▼
[TaskNode: 总结成对比表]
agentMode: 'auto'
assignedTo: 'claude-cli'
       │
       ▼
[ResultNode: 待 agent 填]
```

启动 dispatcher + hermes worker + claude-cli worker：

1. 5 秒内"调研 5 个竞品"被 hermes worker 抢锁，status → running
2. 30 秒后 hermes 完成，写 ResultNode，status → done
3. dispatcher 看到下游"总结对比表"deps OK，把它从 draft 推到 pending
4. claude-cli worker 抢锁，2 分钟跑完，写最终 ResultNode

**全程三人浏览器同步看到节点变色、进度条流动、ResultNode 涌现**。

---

## 12. 失败模式与诊断

| 现象 | 可能原因 | 排查 |
|------|--------|------|
| 节点卡 pending 超过 1 分钟 | 没有匹配 assignedTo 的 worker 在线 | 看 server 日志，启动对应 worker |
| 节点 running 不动 | worker 卡死 / 网络断 | 等 lease 超时（5 分钟）自动回 pending |
| 双跑（结果出现两次） | CAS 二段确认失败但都跑了 | 检查 worker 端是否幂等；查 idempotency_key |
| dispatcher 不推 ready | agent 看到的 status 还在 draft 不是 auto | 检查 `data.agentMode === 'auto'` 是否真的写进 Y.Doc |

dispatcher 自己也写一份运行日志到 `nodesMap.get('__dispatcher_log__')`（一个不渲染的特殊节点 ID），浏览器可以开开发者工具看。

---

## 13. 不在范围内（明确切割）

- ❌ Cron / 定时触发 — 用户启动是手动的
- ❌ 流水线编辑器（visual programming） — 边只是 dependency hint，不传数据
- ❌ 跨房间任务 — 每个 room 是独立的 Y.Doc，agent 只能服务它当前 connect 的 room
- ❌ 鉴权细分 — agent 跟用户在同一房间，写权限相同（黑客松简化；P1 加 ACL）

---

## 14. P0 实现清单（本次会话目标）

- [x] 写 spec（本文档）
- [x] `server/orchestra-base.js` — Y.Doc client 基类
- [x] `server/orchestra-dispatcher.js` — 调度器
- [x] `server/orchestra-hermes-worker.js` — Hermes worker（mock 完成，真 API 路径已写但未连真凭据）
- [x] `server/package.json` 加 `dispatcher` / `worker:hermes` / `orchestra:e2e` / `orchestra:race` script
- [x] 端到端 mock demo (`npm run orchestra:e2e`) — draft → running → done + 自动建 ResultNode
- [x] CAS 抢锁竞态测试 (`npm run orchestra:race`) — 3 worker 抢 5 task 不双跑

## 15. 启动 demo 的最小操作

```bash
# 终端 1: y-ws-server (1234)
cd server && npm run yws

# 终端 2: dispatcher
cd server && node orchestra-dispatcher.js demo-room

# 终端 3: hermes worker (默认 mock; 真调 Hermes 需 set HERMES_USER/HERMES_PASS)
cd server && node orchestra-hermes-worker.js demo-room

# 浏览器: 进入 ?room=demo-room, 双击空白加 TaskNode,
# 改 data.agentMode='auto' + data.assignedTo='hermes', dispatcher 5s 内 promote, worker 抢锁跑
```

## 16. 验证命令

```bash
cd server
npm run orchestra:e2e   # 单 worker 端到端: draft → done + ResultNode
npm run orchestra:race  # 3 副本抢 5 task: 不双跑
```

P1（黑客松后）:
- claude-cli worker (复用 server/claude-bridge.js 或直接 spawn)
- 飞书 bot worker (听飞书消息 → 写画布 / 监听画布 → 推飞书群)
- 真接 Hermes API (设 HERMES_USER/HERMES_PASS, 关掉 ORCHESTRA_MOCK)
- 节点 outputs 字段做"上游 result 注入下游 prompt"的数据流
- 环检测 + 黑名单 (防 agent 互相派单死循环)
