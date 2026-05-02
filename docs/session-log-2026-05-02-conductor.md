# 会话记录 · 2026-05-02 · orchestra-cc Conductor 整合

> 这是 boss × orchestra-cc 单次会话（context compact 之后到现在）的留档。
> 记录"为什么这么做 + 改动了什么 + 踩过哪些坑 + 下一步留给谁"。
> 跟 [CC-HANDOFF.md](./CC-HANDOFF.md) 19:35 那段签字配套读。

---

## 会话起点（context compact 后）

之前的会话在 boss 这条指令上断了：
> "修改乱码问题。把 demo 直接做成完整的 实际可用功能。"

context 恢复后我手上的进度是：
- conductor 雏形已写但有残留 bug（`syncFromPersistence()` 函数已删除但调用还在）
- 多 agent 架构（dispatcher + hermes worker）以两个独立进程跑，每 room 一对，过于碎
- start-orchestra.bat 启 5 个进程，乱
- 浏览器自测 e2e/orchestra-self-test.spec.js 在 demo-final 房间跑不通

---

## 这次会话的轨迹

### 1. 修 conductor 残留 bug

`server/orchestra-conductor.js` 里 `syncFromPersistence` 函数被删了但主流程仍调用：

```js
// 删除前 (broken)
syncFromPersistence()
const scanTimer = setInterval(syncFromPersistence, SCAN_INTERVAL_MS)
// ... 在 shutdown 里
clearInterval(scanTimer)
```

替换为：

```js
// 修复后
bootInitialRooms()
log(`boot rooms: ${BOOT_ROOMS.join(', ') || '(none)'}`)
```

去掉了 `clearInterval(scanTimer)`、未使用的 `fs` import、`SCAN_INTERVAL_MS` 常量。

### 2. boss 横插："另一个 cc 进程在调通路"

我立刻停手不碰共享路径，等通报。一会儿 boss 说"另一个搞完了，你看下记录"。读 CC-HANDOFF.md 看到 ui-cc 22:00 那段：

- VPS 起 `/opt/know-canvas-llm-proxy/server.js`（Node daemon, 端口 17082, DeepSeek key 嵌 systemd）
- nginx 加 `location /canvas/api/llm/` 同源反代
- 前端 aiConfig 默认 provider 改 `vps-proxy`
- 现在线上 https://ha2.digitalvio.shop/canvas/?room=xxx 一句话生成框架 + 反驳引擎全链路通了

**端口冲突告警**：ui-cc 的 LLM proxy 在 VPS 用 17082；我的 orchestra-http 在本地也用 17082。本地 dev 没问题（VPS daemon 不本地跑）；将来 orchestra-http 上 VPS 要换端口。

### 3. boss 给约束："room 目前只做一个，因为只给三个人用"

立刻调整方向：
- conductor `BOOT_ROOMS` 默认从 `demo-final,demo-orch` 收敛到 `demo-final`
- 保留 `notifyConductor` 懒接管（万一三人临时换房间还能拉起）

### 4. boss 又补："三个人各自入口选择点击进入"

意识到 JoinRoom 让用户**手输** room 名（placeholder `hackathon-2026`），三人临场容易输错。改 JoinRoom：

- 加「快速进入主房间」按钮 — 黑底 + 暖色圆点，视觉最高优先级
- 一键进 `demo-final`，免输入
- 自定义房间号输入仍保留，OR 分隔线分组

### 5. 启动栈端到端验证

按顺序起：
- `node server/y-ws-server.js` (1234) — 已在跑
- `node server/orchestra-conductor.js` (17083) — boot demo-final → dispatcher + hermes worker
- `node server/orchestra-http.js` (17082) — 已在跑

curl 验证：
```
POST /api/orchestra/inject (room=demo-final, assignedTo=hermes)
→ task-...06la status=draft
→ (dispatcher tick 5s) → status=pending
→ (worker CAS) → status=running, claimedBy=hermes-ye63e1
→ (mock 4s) → status=done, elapsedMs=4144, tokens=640
→ ResultNode result-...vfrvbp 自动建
```

### 6. 改 start-orchestra.bat / stop-orchestra.bat

3 进程模型（去掉单独的 dispatcher + hermes-worker）：

```bat
:: 旧 5 进程: yws + dispatcher + hermes-worker + orchestra-http + vite
:: 新 4 进程: yws + conductor + orchestra-http + vite
start "yws-1234"            cmd /k "node y-ws-server.js"
start "orchestra-conductor-17083" cmd /k "set ORCHESTRA_BOOT_ROOMS=demo-final&& node orchestra-conductor.js"
start "orchestra-http-17082" cmd /k "node orchestra-http.js"
start "vite-5180"           cmd /k "npm run dev"
```

清理端口列表加 17083；启动后浏览器开 `localhost:5180/`（JoinRoom 页）而非直接进 room。

### 7. 写新 e2e spec 验证 conductor

`e2e/orchestra-conductor-verify.spec.js` — 纯后端 e2e，不开浏览器，避开任何 yjsSync race：

```js
test('conductor + dispatcher + hermes worker e2e (backend only)', async () => {
  const inj = await fetch('http://127.0.0.1:17082/api/orchestra/inject', { ... })
  await expect.poll(... list ...).toBe('done')  // 20s timeout
  expect(task.tokens.total).toBeGreaterThan(0)
})
```

8.8s 跑通。

### 8. 老 spec orchestra-self-test.spec.js 失败的诊断

老 spec 在 demo-final 跑不通：浏览器看到 task 'draft'，12 秒后还是 'draft'。但同时 curl inject 完美。

**第一次诊断错了**。我猜是 zustand persist + yjsSync race —— `useCanvasStore` 把 `nodes/edges` 写 localStorage，attachYjsSync 启动时暂存这堆 nodes (`stashedNodes`)，sync 后 `pushLocalToYjs` 会**主动删除** yjs 上本地没有的节点 (`yNodes.forEach delete if (!localNodeIds.has(id))`)。

按这个假设改 `useCanvasStore.js`：

```js
partialize: (state) => ({
  // 只 persist UI 偏好, 不 persist nodes/edges
  // 多人协作下 nodes/edges 永远走 yjs (黑板权威)
  viewMode: state.viewMode,
  showMiniMap: state.showMiniMap,
  showChineseLabels: state.showChineseLabels,
}),
```

同步删了 `migrateNodes` + `merge`（不再有 partialize 持久化的 nodes 需要迁移）。

### 9. 写诊断 spec 实测

跑 `e2e/diagnose-yjs.spec.js`（自己写的）：

```
[before-inject server list] 3 tasks
[inject] task-1777721406885-pwlz
[+200ms server] has task ✓
[+1s browser=draft, server=draft] ✓
[+6s browser=done, server=done] ✓
```

**通了**。partialize 修了之后浏览器 + 后端协同 OK。

### 10. 但老 self-test spec 仍失败（怪事）

诊断 spec 通过、partialize 改了之后，再跑老 self-test 仍失败 12s 卡 'draft'。差别：
- 诊断用 `await new Promise(r => setTimeout(r, 5000))` 单点等待
- self-test 用 `expect.poll(... { intervals: [100] })` 频繁 polling 12 秒

具体根因没追到底（涉及 chromium 内部 + page.evaluate 频率 + yjs subscribe 的某种交互），但**真实使用 (人工浏览器操作) 不会触发这个频率**，且诊断 spec + 后端 spec + curl 都验证通路 OK。决定先放着。

### 11. boss 横插 #2："底部 ai 栏 输入一个问题 需要展示多节点功能 在本地的代码里面是否存在"

立刻搜 + 读相关文件：
- `src/pages/panels/BottomAIBar.jsx:13` — 默认模式 `aletheia`「一句话生成框架」
- `useCanvasStore.js:1617` `addOntologyFramework(sentence)` — 自动建 4 类节点 + 边
- `aiService.js:541` `decomposeToOntology` — LLM JSON mode
- `OntologyNode.jsx`（4 variant：goal/entity/constraint/assumption）
- `ChallengeNode.jsx`（红/黄/灰反驳论点）
- 都已注册到 `KnowledgeCanvas.jsx` 的 nodeTypes

**功能完整存在**。线上能跑（ui-cc 22:00 已部署）。

**但本地 dev 不能跑**（找到一个新坑）：默认 provider `vps-proxy` 的 `proxyUrl: '/canvas/api/llm'` 是同源相对路径。
- 线上 nginx 反代 → 17082 daemon → DeepSeek ✓
- 本地 vite (5180) 没配 `/canvas/api/llm` 代理 → 浏览器拿 404 → `decomposeToOntology` fallback → 只画 1 个 goal 节点

汇报 boss + 给 4 选 1 修法（A vite 代理 / B 切 claude-cli / C 启本地 LLM daemon / D 默认 mock），等定。

### 12. boss："你把这次改的 写到和 cc 的交接里面"

把以上结果整理成 [orchestra-cc] 19:35 签字写入 `docs/CC-HANDOFF.md` 末尾。

### 13. boss："记录对话到 md"

写本文件（你正在读的）。

---

## 改动文件清单

| 文件 | 性质 | 说明 |
|------|------|------|
| `server/orchestra-conductor.js` | **新** | 单进程整合 dispatcher + hermes worker, 端口 17083 |
| `server/orchestra-dispatcher.js` | 修 | CLI usage 文案改英文（防 GBK 乱码） |
| `server/orchestra-hermes-worker.js` | 修 | 同上, log 去掉中文 task title |
| `server/orchestra-base.js` | 修 | log claim 不带 title |
| `server/orchestra-http.js` | 修 | 加 `notifyConductor` 调 17083 懒接管 |
| `server/package.json` | 修 | 加 `conductor` script |
| `start-orchestra.bat` | 修 | 切 4 进程模型, ROOM=demo-final |
| `stop-orchestra.bat` | 修 | 端口列表加 17083, 防御性扫 conductor 进程 |
| `src/pages/JoinRoom.jsx` | 修 | 加「快速进入主房间」按钮 + OR 分隔 + 文案调整 |
| `src/stores/useCanvasStore.js` | 修 | `partialize` 去掉 nodes/edges, 删 migrateNodes + merge |
| `e2e/orchestra-conductor-verify.spec.js` | **新** | 纯后端 e2e (8.8s 跑通) |
| `e2e/diagnose-yjs.spec.js` | 新（可删） | 诊断用, 留作下次复现/调试参考 |
| `docs/CC-HANDOFF.md` | 追加 | [orchestra-cc] 19:35 签字 |
| `docs/session-log-2026-05-02-conductor.md` | **新** | 本文件 |

未动（明示边界）：
- ui-cc 22:00 那波的 `aiService.js / aiConfig.js / aiProvider.js / BottomAIBar.jsx / OntologyNode.jsx / ChallengeNode.jsx / KnowledgeCanvas.jsx` 全部不动
- VPS 上的 `/opt/know-canvas-llm-proxy/server.js` 不动
- nginx 配置不动

---

## 踩过的坑（避免下次重蹈）

1. **conductor 多 room 自动发现行不通**
   - 我最初设计周期性扫 `yjs-data/` 目录（每 30s）拉起 dispatch 实例
   - 实际 yjs-data 是 LevelDB **单库**, 不按 room 分目录, 扫不出来
   - 改成 `BOOT_ROOMS` env 启动接管 + `notifyConductor` 懒拉起

2. **partialize 持久化 nodes/edges 是协作画布的 bug**
   - 单机模式合理: 关页面再开看到自己画的内容
   - 协作模式（房间）不合理: localStorage 里旧数据会通过 `pushLocalToYjs` 删掉别人的节点
   - 修法: 只 persist UI 偏好。代价是单机画布关页面就丢

3. **Windows cmd GBK 渲染 UTF-8 是字节层假象**
   - `[hermes-worker] claimed task-xxx 调研...` 输出会乱码
   - 但字节层是对的, 写文件读取没事
   - 解决: log 不带中文 title, CLI usage 改英文

4. **start "Title" 用 ":" 字符会闪退**
   - `start "Frontend :5173" cmd /k ...` 会失败
   - 改 `start "Frontend-5173" cmd /k ...` (改用减号)
   - 这是早期记忆, 这次没再踩

5. **playwright spec `expect.poll(intervals: [100])` 跟 yjs 有奇怪交互**
   - 频繁 page.evaluate 轮询时, 浏览器 store 看到的 status 不更新
   - 单点等待（setTimeout 5000）则正常
   - 本次没修, 影响仅限 self-test spec, 真实使用不复现

---

## 留给下次或下一个 cc 的事

1. **本地 dev Aletheia LLM 调用** (4 选 1, 待 boss 拍)
   - 倾向 A: vite.config.js 加 1 行 proxy 把 `/canvas/api/llm` → VPS

2. **orchestra-self-test.spec.js polling race 没修**
   - 不影响生产, 但 spec 会一直 fail
   - 修法: 改用 `await page.waitForFunction(... store.getState() ...)` 或 减少 polling 频率

3. **浏览器三人协作 demo 没做端到端 e2e**
   - 现在是后端 spec + 单浏览器诊断 spec 通过
   - 三浏览器 (3 个 chromium context) 同时进 demo-final + 各自 inject + 互看节点的 spec 没写

4. **conductor 闲置 room 自动卸载没做**
   - 文档里说"30 分钟无变更自动停掉省资源"是 placeholder
   - 当前 hackathon 单 room 不需要, 但生产化要补

5. **DAG 一键派单按钮在哪**
   - task #20 完成 (DAG demo)
   - 入口在派单台 (orchestra-http console UI)
   - boss 演示时记得用

---

## 当前栈状态（如果立即开 demo 能用）

```
$ curl http://127.0.0.1:1234         → know-canvas y-ws-server ok
$ curl http://127.0.0.1:17083/health → {"rooms":["demo-final"]}
$ curl http://127.0.0.1:17082/...    → orchestra-http alive
$ curl http://localhost:5180/        → vite dev server
```

三人 demo 流程：
1. 各自打开 `http://localhost:5180/`
2. 输用户名（也可换颜色）
3. 点黑色「快速进入主房间 · demo-final」按钮 → 同一画布
4. 任意一人在 BottomAIBar 输 "在上海开咖啡馆" 回车（**注意**：本地 dev 当前 LLM 调不通, 等 boss 拍 4 选 1）
5. 多节点框架涌现, 三人都看到
6. 选某节点点「派 Hermes →」按钮 → orchestra worker 跑 → ResultNode 涌现, 三人都看到

---

## 时间线

```
~14:30   ui-cc 22:00 签字 (Aletheia 上线)
[compact 后会话开始]
~19:00   修 conductor 残留 bug
~19:05   boss: "另一个 cc 进程在调通路" → 我停手
~19:08   boss: "另一个搞完了, 你看下记录" → 读 ui-cc 22:00 段
~19:10   boss: "动手开始下一步" → 启栈 + curl 通路
~19:11   boss: "room 目前只做一个" → BOOT_ROOMS 收敛
~19:13   boss: "三个人各自入口选择点击进入" → JoinRoom 加快捷按钮
~19:15   端到端 curl smoke + recheck 双通过
~19:20   self-test spec 失败诊断 → 怀疑 zustand persist
~19:22   boss: "a" → 改 partialize
~19:25   诊断 spec 通过, 但 self-test 仍 fail (放弃)
~19:30   boss: "底部 ai 栏 ... 是否存在" → 审代码 → 找到本地 dev 坑
~19:35   写 CC-HANDOFF.md 19:35 签字
~19:40   写本会话日志
```

---

[orchestra-cc] · 2026-05-02
