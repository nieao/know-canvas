# 外部源 Watch 增量同步设计 (Source Watch Sync Spec)

> **状态**: MVP 实现中 (Phase 1: 单向 polling, 远端→画布)
> **关联任务**: #11 — 外部源 watch 增量同步
> **关联文件**:
> - `server/source-proxy.js` (新增 `/feishu/fetch-meta` + `/notion/fetch-meta`)
> - `src/stores/useCanvasStore.js` (新增 `checkSourceUpdates` + `syncNodeFromSource` action)
> - `src/components/canvas/BookmarkNode.jsx` (新增同步状态角标)
> - `src/pages/panels/SaveExportToolbar.jsx` (新增 "🔄 检查外部源更新" 按钮)
> **作者**: Claude (你想猫 dispatched) · 2026-05-04
> **接力**: 后续做反向同步 (画布→远端) 时, 请读 §6 反向同步与 §7 冲突处理

---

## 0. 一句话目标

> 用户在画布上看到从飞书/Notion 导入的 BookmarkNode, 当**原始文档被改了**, 节点上自动出现 "有新版本" 角标, 一键同步覆盖本地内容; 默认**不主动**改写画布, 把决定权留给用户.

---

## 1. 现状回顾 (Why this spec)

当前 `importFromFeishuUrl` / `importFromNotionUrl` 的行为是**一次性快照**:
- 用户点击 "导入" → 调 `/feishu/fetch` 或 `/notion/fetch` 拉全文 → 创建 BookmarkNode
- 节点 `data.sourceMeta` 写入 `{ platform, originalUrl, importedAt, fullContent, pageId? }`
- 之后**永不**回头看原始文档. 原文档变了, 画布保持冷冻状态.

这条已知 gap 在 `docs/INTEGRATION-NOTES.md` 里也提到过 — 用户多次反馈 "导入完就死了, 没有 watch 同步".

---

## 2. 数据模型扩展

### 2.1 节点 `data.sourceMeta` 字段补充

| 字段 | 类型 | 说明 | 何时写入 |
|------|------|------|---------|
| `platform` | `'feishu' \| 'notion'` | 已有 | import 时 |
| `originalUrl` | string | 已有 | import 时 |
| `importedAt` | number (ts) | 已有 | import 时 |
| `fullContent` | string | 已有 | import + 同步时 |
| `pageId` | string (notion) | 已有 | import 时 |
| **`remoteUpdatedAt`** | string (ISO) \| number (ts) | 远端最近修改时间 (用作版本对比 key) | import + 每次 fetch-meta |
| **`remoteContentHash`** | string (sha-256 前 12 位) | 远端 fullContent 的 hash. fetch-meta 不返回内容时不更新 | import + 每次 fetch (full) |
| **`lastCheckedAt`** | number (ts) | 上次 poll 检查时间 (不论是否有更新) | 每次 checkSourceUpdates |
| **`lastSyncedAt`** | number (ts) | 用户上次确认同步覆盖的时间 | 用户点 "同步" 后 |
| **`localEditedAt`** | number (ts) | 用户在画布上手动改了 label/description 后写入 (用于检测本地 dirty) | 用户编辑节点时 |
| **`syncStatus`** | enum | `'idle'` / `'checking'` / `'updated-available'` / `'synced'` / `'conflict'` / `'error'` | 状态机驱动 |
| **`syncError`** | string \| null | 失败时的错误消息 (一句话) | 失败时 |

**为什么用 `remoteUpdatedAt` 而非纯 hash?**
- 飞书 search API 返回 `update_time_iso`, fetch-meta 可以**只**拿这个字段不拉全文 (轻量, 一次 ~50ms vs 全文 ~2s)
- Notion `last_edited_time` 同理 (单次 GET `/pages/{id}` ~80ms)
- hash 仅用于**全文 fetch 时**的内容 fingerprint, 帮助探测 "外部时间戳变了但内容没变" (Notion 的常见 noise: 改了一次属性也会更新 last_edited_time)

### 2.2 全局 polling 状态 (新增 store 字段)

```js
// useCanvasStore
sourceWatch: {
  enabled: true,           // 全局开关 (默认开)
  mode: 'manual',          // 'manual' = 仅手动按钮触发; 'auto' = 后台 polling (MVP 不实现 auto)
  intervalMs: 60_000,      // poll 周期 (默认 60s, 见 §8 节流)
  lastRunAt: 0,            // 上次全量 check 时间
  inFlight: false,         // 防并发标志
  lastReport: null,        // { total, checked, updated, errors, durationMs }
}
```

仅持久化 `enabled` + `mode`, 其他运行时字段不入 localStorage.

---

## 3. 变更检测策略 (核心选型)

### 3.1 三种方案对比

| 方案 | 实时性 | 实现成本 | 服务端依赖 | 飞书可行 | Notion 可行 |
|------|--------|---------|----------|---------|-----------|
| **A. 客户端 polling** | 中 (秒级) | 低 | 无 (复用 source-proxy) | ✅ search API 带 update_time | ✅ pages GET 带 last_edited_time |
| **B. 服务端 daemon 长轮询** | 中 (秒级) | 中 (要新进程 + 状态存储) | 要新 daemon | 同 A | 同 A |
| **C. Webhook 订阅** | 高 (秒以下) | 高 (要 OAuth + 公网 callback) | 要公网 endpoint | ⚠️ 飞书自定义机器人 webhook 不覆盖 docs 编辑事件 | ⚠️ Notion API 不开放 generic webhook (仅企业版 connector) |

### 3.2 选型决策: **A (客户端 polling) 作为 MVP**

**理由**:
1. 零新依赖, 复用已有 `source-proxy.js` 中转层
2. 多人协作场景下 (Yjs 黑板共享 nodes), polling 由**任一**客户端触发后**所有人**都能看到 syncStatus 变化 (yjs 同步)
3. 后续要升级到 B (server daemon) 时, 把 `checkSourceUpdates` 的 fetch-meta 调用从浏览器搬到 daemon 即可, 接口不变
4. C 的 webhook 在飞书/Notion 都不成熟, 黑客松不投入

**保留扩展点**: `sourceWatch.mode = 'auto'` 字段为后续做后台 polling 留位 (但 MVP 不实现自动定时, 避免没人关注时浪费 quota).

---

## 4. fetch-meta 端点设计 (服务端)

### 4.1 `POST /feishu/fetch-meta`

**入参**: `{ docUrl: string }`

**出参**:
```json
{
  "ok": true,
  "data": {
    "title": "可选, 不强求",
    "remoteUpdatedAt": "2026-05-04T08:23:00Z",
    "platform": "feishu"
  }
}
```

**实现策略**:
- 飞书没有提供"按 URL/token 单查 update_time"的 OpenAPI (lark-cli 也没有)
- **退路**: 用 `lark-cli docs +search --query <doc title>` 取 result_meta.update_time_iso
- 如果搜索没命中 (标题改了 / 关键词不匹配), 退化到调 full `/feishu/fetch` 拿全文
- 返回时把 `remoteUpdatedAt` 拍上去, 调用方比对

**优化**: 单次 fetch-meta 缓存 30s (服务端内存 LRU, 5 分钟过期), 防止用户连点按钮拍服务端.

### 4.2 `POST /notion/fetch-meta`

**入参**: `{ pageUrl?: string, pageId?: string }`

**出参**: 同上

**实现策略**:
- Notion 有原生支持: `GET /pages/{pageId}` 返回 `last_edited_time` (无需拉 children blocks)
- 一次调用 ~80ms, 比 full fetch 快 ~25 倍
- **不缓存** (Notion API 本身就快)

### 4.3 通用约定

- 网络/认证错误: 返回 `{ ok: false, error: '具体一句话' }` (status 200, 让调用方按 ok 字段路由)
- 超时: 复用现有 `TIMEOUT_MS = 20s`, 但 fetch-meta 应在 5s 内完成, 否则视为异常

---

## 5. 客户端流程 (`checkSourceUpdates`)

### 5.1 触发时机

1. 用户点击 SaveExportToolbar 的 "🔄 检查外部源更新" 按钮 (MVP 唯一入口)
2. 后续可加: 页面 visibility 变 `visible` 时 (从后台标签切回前台), 间隔 > 5min 自动触发一次
3. `sourceWatch.mode = 'auto'` 时, setInterval 周期触发 (MVP 不开)

### 5.2 算法

```
checkSourceUpdates():
  if sourceWatch.inFlight: return  // 防并发
  set inFlight = true
  try:
    targets = nodes.filter(n => n.data?.sourceMeta?.platform in ['feishu', 'notion'])
    报告 = { total: targets.length, checked: 0, updated: 0, errors: 0 }

    并发度=3 (避免一次拍太狠)
    for batch in chunks(targets, 3):
      await Promise.all(batch.map(async (node) => {
        try:
          meta = await fetchMetaForNode(node)  // 调 /feishu/fetch-meta 或 /notion/fetch-meta
          updateNodeMeta(node.id, {
            lastCheckedAt: now(),
            remoteUpdatedAt: meta.remoteUpdatedAt,
          })
          if (newer(meta.remoteUpdatedAt, node.data.sourceMeta.remoteUpdatedAt
              || node.data.sourceMeta.importedAt)):
            updateNodeMeta(node.id, { syncStatus: 'updated-available' })
            报告.updated++
          report.checked++
        except (err):
          updateNodeMeta(node.id, { syncStatus: 'error', syncError: err.message })
          报告.errors++
      }))
      // 批次间 200ms 间隔 (节流)
      await sleep(200)

    set lastRunAt = now(), lastReport = 报告
  finally:
    set inFlight = false
```

**newer 比较**: 字符串 ISO 时间直接 `>` 比较 (字典序在 ISO 8601 下等价于时间序), 数字 ts 用 `>`. 类型不一致先标准化为 ts.

### 5.3 单节点同步 `syncNodeFromSource(nodeId)`

用户在节点角标上点 "同步" → 触发:

```
syncNodeFromSource(nodeId):
  node = findNode(nodeId)
  meta = node.data.sourceMeta
  if !meta.platform: throw

  // 检测本地脏 (用户手改过 label / description)
  if (meta.localEditedAt && meta.localEditedAt > (meta.lastSyncedAt || meta.importedAt)):
    return { needsConfirm: true, reason: 'local-edits-detected' }
    // → UI 弹确认: "本地改过, 是否覆盖?" (last-write-wins 默认外部赢, 见 §7)

  // 拉全文 (复用现有 /feishu/fetch 或 /notion/fetch)
  data = await fetchFullForNode(node)

  // 更新节点 — 仅覆盖 title/description/fullContent, 保留 position/edges/children/marked/category 等用户加工
  updateNode(nodeId, {
    title: data.title,
    description: data.content.slice(0, 240) + ...,
    sourceMeta: {
      ...meta,
      fullContent: data.content,
      remoteUpdatedAt: data.lastEditedTime || nowISO(),
      remoteContentHash: sha12(data.content),
      lastSyncedAt: now(),
      syncStatus: 'synced',
      syncError: null,
    },
  })
  // 'synced' 状态 3s 后自动转回 'idle' (UI 角标淡出)
```

---

## 6. 反向同步 (画布 → 远端) — Phase 2, 不在 MVP

**思路记录** (留给下一个 cc):
1. Notion 简单: `PATCH /pages/{pageId}` + `PATCH /blocks/{id}` 重建 children. 已有 `pushNodeToNotion` 创建逻辑可复用大部分 markdown→blocks 转换
2. 飞书复杂: lark-cli 有 `docs +update` 但只能追加/覆盖, 不能替换 block. 退路: 整篇删了重建
3. **冲突仍是核心问题**: 双向同步必须配 vector clock 或类似 Lamport timestamp; 否则两边各改一次会有一方静默丢失
4. **建议**: Phase 2 先只支持 Notion 反向, 飞书继续单向; UI 上加 "推送本地更改到 Notion" 按钮 (要求节点 publishedTo 数组里有 Notion 记录)

---

## 7. 冲突处理

### 7.1 冲突场景

A. 用户改了画布节点的 label/description (写入 `localEditedAt`)
B. 同时原文档也被改了 (`remoteUpdatedAt > lastSyncedAt`)
→ 此时点击同步: **冲突**

### 7.2 处理策略 (MVP)

**默认: 远端赢 (remote-wins) + 用户确认**

```
syncNodeFromSource:
  if (localEditedAt > lastSyncedAt && remoteUpdatedAt > lastSyncedAt):
    // 双方都改过 — 标 syncStatus = 'conflict'
    // UI 弹: "原文档和本地都被修改过. 同步将覆盖本地修改, 是否继续?"
    // [取消] [覆盖] [仅查看 diff (Phase 2)]
```

**理由**:
- 用户的"导入"心智模型是"以远端为准, 画布是工作副本", 远端赢符合期望
- merge 在 markdown/富文本场景需要 OT/CRDT, 黑客松不做
- 后续可以提供 "diff 视图" (Phase 2): 把远端 vs 本地 fullContent 用 diff-match-patch 显示

### 7.3 局部修改的特殊处理

- `position` (节点位置) — 永远保留本地
- `parentNode` / `extent` — 永远保留本地 (group 关系)
- `marked` / `markColor` / `category` / `tags` — 永远保留本地 (用户的标注)
- `children` (画布上挂的子节点) — 永远保留本地 (用户加工的派生信息)
- `title` / `description` / `sourceMeta.fullContent` — 远端覆盖

---

## 8. 节流与频率控制

### 8.1 多层节流

| 层级 | 控制 | 数值 |
|------|------|------|
| 单节点 fetch-meta | 服务端 LRU 缓存 (飞书) / 客户端最近调用记录 | 30s 内重复请求直接返回缓存 |
| `checkSourceUpdates` 全局 | `sourceWatch.inFlight` 标志位 | 一次只能跑一遍 |
| 用户连点按钮 | 按钮 disabled 直到完成 | UI 禁用 |
| 后台 auto poll (Phase 2) | 用户活跃 → 30s 周期; 闲置 (5min 无操作) → 10min 周期 | 自适应 |
| 单批并发 | Promise.all 分批 | 3 节点一批, 批间 200ms |

### 8.2 用户活跃度检测 (Phase 2 自动 poll 用)

```js
let lastActiveTs = Date.now()
window.addEventListener('mousemove', () => { lastActiveTs = Date.now() })
window.addEventListener('keydown', () => { lastActiveTs = Date.now() })

function getPollInterval() {
  const idle = Date.now() - lastActiveTs
  if (idle < 5 * 60_000) return 30_000   // 活跃: 30s
  return 10 * 60_000                       // 闲置: 10min
}
```

MVP 不实现, 仅记录设计.

---

## 9. UI 提示

### 9.1 节点角标 (BookmarkNode 渲染层)

| syncStatus | 角标位置 | 视觉 | 交互 |
|-----------|---------|------|------|
| `'idle'` (默认) | 不显示 | — | — |
| `'checking'` | 右上, 6px 圆点 | 暖色脉动 (`#c8a882` 0.6s) | 不可点 |
| `'updated-available'` | 右上, 12px 蓝色三角箭头 | 蓝色 `#3b82f6` + 0.4 opacity 呼吸 | 点击 → `syncNodeFromSource(id)` |
| `'synced'` | 右上, 绿色 ✓ | 绿色 `#22c55e`, 3s 后淡出 | 不可点 |
| `'conflict'` | 右上, 12px 橙色 ⚠ | 橙色 `#f59e0b` | 点击 → 弹冲突确认 modal |
| `'error'` | 右上, 12px 红色 ! | 红色 `#ef4444` | hover 显示 syncError 内容 |

**实现位置**: `BookmarkNode` 组件右上角 (现在的 "链接" type 标签在左上, 新角标加在右上, 不冲突).

**约定 z-index**: 角标 z=20, 高于 ColorAccentBar 但低于 selected ring.

### 9.2 工具栏按钮 (SaveExportToolbar)

新增按钮: **"🔄 外部源"** (放在排序按钮和设置按钮之间)

- 默认显示: 暖色刷新 icon + 文案 "外部源"
- hover tooltip: "检查飞书/Notion 导入的节点是否有更新"
- 点击 → 调 `checkSourceUpdates`
- 运行中: icon 旋转 + 文案变 "检查中..."
- 完成后 3s 显示报告: "检查 N · 更新 M · 错误 K" (无更新时显示 "已是最新")

**集成进设置菜单备选**: 也可以放进 ⚙ 设置下拉里 (节省顶部空间), MVP 选择"独立按钮"以提高可发现性.

### 9.3 节点详情面板 (RightPanel) 信息卡

不在 MVP 范围, 但留 hook:
- 选中 BookmarkNode 时, RightPanel 显示 sourceMeta 面板
- 字段: 平台 / 原文 URL / 导入时间 / 上次同步 / 远端最新 / 同步按钮 / 反向推送按钮 (Phase 2)

---

## 10. MVP 实现范围 (Phase 1)

### ✅ 实现

- 服务端 `/feishu/fetch-meta` + `/notion/fetch-meta` 端点
- 客户端 `checkSourceUpdates()` action + `syncNodeFromSource(id)` action
- BookmarkNode 角标 (`updated-available` + `checking` + `synced` + `error`, 暂不做 conflict modal — `localEditedAt` 字段先埋上不读)
- SaveExportToolbar "🔄 外部源" 按钮
- 在 `useCanvasStore` 持久化 `sourceWatch.enabled`

### ❌ 不实现 (留 Phase 2)

- 反向同步 (画布 → 远端)
- 自动后台 polling (`mode: 'auto'`)
- 冲突处理 modal (字段已埋, 但 UI 暂不弹)
- diff 视图
- Webhook 订阅
- 服务端 daemon 化

---

## 11. 测试清单 (集成 know-canvas-self-check)

| 场景 | 预期 |
|------|-----|
| 导入飞书文档 → 立即点检查 | syncStatus 保持 idle (本地导入时间 ≥ 远端时间) |
| 导入飞书文档 → 飞书改文档 → 等 60s → 点检查 | 节点角标变蓝色三角 |
| 角标蓝色三角 → 点击 | 节点 title/description/fullContent 被覆盖, 角标变绿 ✓ 后淡出 |
| Notion 同上 | 同上 |
| fetch-meta 失败 (网络断) | 节点角标变红 !, hover 显示错误 |
| 已有 100 个 BookmarkNode | 检查不阻塞 UI, 分批 3 个一批进行 |
| 用户连点按钮 5 次 | 按钮被 disabled, 只跑一次 |
| 非飞书/Notion BookmarkNode (普通网页) | 跳过, 不计入 total |

---

## 12. 已知限制 / 后续清单

1. **飞书 fetch-meta 退化**: 没找到比 search 更轻量的 metadata API, 极端情况下要拉全文 — 但缓存 30s 缓解
2. **Notion last_edited_time 不准**: 改属性也会更新, 可能出现"假阳性更新提示". Phase 2 用 `remoteContentHash` 二次确认
3. **多人协作 race**: 两个用户同时点检查, syncStatus 会被双写到 yjs. Yjs 自身的 LWW 会处理, 但报告数字可能略偏 — 可接受
4. **大节点全文 fetch 拉不动**: 飞书超大文档 (>100k 字) fetch 会超时. 复用现有 20s 超时, 失败标 error
5. **离线**: 没网时全部标 error, 等下次有网再点检查 — 符合预期

---

## 13. 部署影响

- 服务端: `server/source-proxy.js` 加 2 个路由, 兼容原有路由 → push main 后 60s VPS 自动 pull, 重启 source-proxy 服务
- 客户端: `useCanvasStore.js` + `BookmarkNode.jsx` + `SaveExportToolbar.jsx` 改动, 走 vite build → 用户刷新页面即可
- 数据兼容: 旧 BookmarkNode 没有新字段, 第一次检查会自动补 `lastCheckedAt`/`remoteUpdatedAt`, 不破坏

---

## 14. 引用 / 参考

- 飞书 docs API: `lark-cli docs +search` / `lark-cli docs +fetch` (沿用 source-proxy 现有封装)
- Notion API: `GET /pages/{id}` 取 `last_edited_time` (官方文档: <https://developers.notion.com/reference/retrieve-a-page>)
- Yjs LWW 处理 syncStatus 共写: <https://docs.yjs.dev/api/shared-types/y.map>
- 设计风格: 角标颜色对齐建筑极简 token 表 (`docs/INTEGRATION-NOTES.md` §3.2)

---

**End of spec.**
