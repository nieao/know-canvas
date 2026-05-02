# 本地任务 + 路由器 + 三模式开关 — 元认知拆派计划

> **目标**：在画布节点详情面板挂"本地任务"，用户写 prompt → 自动路由（简单走本地 callLLM，复杂走 Hermes），用户也可强制切换模式。
> **截止**：2026-05-03 22:00 黑客松提交前
> **共享原则**：每个 agent 只动自己的文件，接口签名锁死，互不踩。

---

## Spine

```
用户在 RightPanel 节点详情写 prompt
   ↓
点"执行"
   ↓
TaskRouter.routeTask({text, mode}) → { target: 'local' | 'hermes', reason }
   ↓
target === 'local'
   → useCanvasStore.addLocalTask(nodeId, prompt)
   → LocalTaskExecutor.run(taskId, prompt)
   → callLLM(active provider) → result
   → useCanvasStore.updateLocalTaskStatus(nodeId, taskId, { status: 'done', result })
target === 'hermes'
   → 走现有 orchestra inject 流程（hermes-proxy）
```

---

## Agent A — TaskRouter（src/services/taskRouter.js）

**职责**：纯函数判断 prompt 走本地还是 Hermes。无副作用。

**API（锁死）**：
```js
/**
 * 路由判断
 * @param {object} args
 * @param {string} args.text - 用户 prompt
 * @param {'auto'|'local'|'hermes'} args.mode - 全局模式
 * @returns {{ target: 'local'|'hermes', reason: string, score: number }}
 *   - target: 实际走哪条路
 *   - reason: 给用户看的中文理由
 *   - score: 复杂度分数（0-100，仅 auto 模式有意义）
 */
export function routeTask({ text, mode })
```

**判断规则（auto 模式）**：
- 复杂度分 +20: 含关键词「对比/方案对比/全方位/产业链/调研/分阶段/拆解/规划」
- 复杂度分 +15: 含关键词「分析/研究/评估/优化」
- 复杂度分 +20: 文本 > 200 字符
- 复杂度分 +10: 含 3+ 个动词/句号
- 复杂度分 +20: 含「步骤/逻辑/结构」
- score >= 50 → hermes，否则 local

**强制模式**：
- mode === 'local' → 直接 target='local'，reason='用户强制本地'
- mode === 'hermes' → 直接 target='hermes'，reason='用户强制 Hermes'

---

## Agent B — LocalTaskExecutor（src/services/localTaskExecutor.js）

**职责**：执行本地任务，调 callLLM（aiProvider.js 里的 active provider），管理状态机。

**API（锁死）**：
```js
/**
 * 执行本地任务
 * @param {object} args
 * @param {string} args.nodeId - 任务挂在哪个节点
 * @param {string} args.taskId - 任务 ID（store 已分配）
 * @param {string} args.prompt - 用户 prompt
 * @param {string} [args.system] - 可选 system prompt
 * @param {function} args.onUpdate - (patch) => void，把状态变化回写 store
 * @returns {Promise<void>}
 */
export async function runLocalTask({ nodeId, taskId, prompt, system, onUpdate })
```

**状态机**：
- onUpdate({ status: 'running', startedAt: now })
- 调 callLLM(...)
- 成功：onUpdate({ status: 'done', result, finishedAt: now, durationMs })
- 失败：onUpdate({ status: 'failed', error: err.message, finishedAt: now })
- 超时（120s）：onUpdate({ status: 'failed', error: 'timeout 120s' })

**实现**：
- 引入 `import { callLLM } from './aiProvider'`
- `system` 默认 'You are a helpful assistant. 用中文回复，简洁直接。'
- 用 Promise.race + setTimeout 实现超时

---

## Agent C — useCanvasStore 数据模型扩展（src/stores/useCanvasStore.js）

**职责**：在已有 store 上扩展三段：模式 + 任务数据 + 任务操作。

**节点 data 新增字段**：
```js
node.data.localTasks = [
  {
    id: 'ltask-<uuid>',
    prompt: '...',
    status: 'pending' | 'running' | 'done' | 'failed',
    result: '...' | null,
    error: '...' | null,
    target: 'local' | 'hermes',  // 路由判断结果
    routerReason: '...',
    createdAt: ts,
    startedAt: ts,
    finishedAt: ts,
    durationMs: 0,
  }
]
```

**新增 store 字段**：
```js
taskMode: 'auto' | 'local' | 'hermes',   // 默认 'auto'，存 localStorage
```

**新增 actions（锁死签名）**：
```js
// 切换全局模式（写 localStorage）
setTaskMode: (mode) => void

// 在节点上添加任务（status='pending'，返回 taskId）
addLocalTask: (nodeId, { prompt, target, routerReason }) => string

// 更新任务字段（patch merge）
updateLocalTaskStatus: (nodeId, taskId, patch) => void

// 删除任务
removeLocalTask: (nodeId, taskId) => void
```

**localStorage**：
- key: `know_canvas_task_mode`
- 在 store 初始化时读取，setTaskMode 时写入

**partialize**：把 `taskMode` 也加入 persist（已有 viewMode/showMiniMap/showChineseLabels）。

---

## Agent D — UI（src/components/panels/RightPanel.jsx + src/collab/CollabHeader.jsx）

**职责 1（RightPanel 本地任务区）**：在节点详情面板底部加一块新区域。

**UI 结构**：
```
┌─ 本地任务 ─────────────────┐
│ [textarea: 写下要做什么...]   │
│                              │
│ 路由：本地 · 短 prompt 走本机模型 │  ← 实时调 routeTask 展示
│                              │
│ [执行] [清空]                 │
├──────────────────────────────┤
│ 历史 (3)                      │
│  ✓ 2 分钟前 · 本地 · 12s     │
│     prompt: ...              │
│     result: ...              │
│  ⏵ 5 分钟前 · 本地 · 进行中   │
│  ✗ 10 分钟前 · 失败          │
└──────────────────────────────┘
```

**实现**：
- 引入 `import { routeTask } from '../../services/taskRouter'`
- 引入 `import { runLocalTask } from '../../services/localTaskExecutor'`
- 从 useCanvasStore 拿 taskMode + addLocalTask + updateLocalTaskStatus + removeLocalTask
- 实时调 routeTask({ text: prompt, mode: taskMode }) 显示路由提示
- 点"执行"：addLocalTask 拿 taskId → 如果 target=='local' 直接调 runLocalTask；如果 target=='hermes' 走现有 orchestra inject API（fetch /api/orchestra/inject）

**职责 2（CollabHeader 模式开关）**：在 CollabHeader 加三段式 segmented control。

**UI**：
```
模式: [自动] [本地] [Hermes]
```
- 选中态用 var(--warm) 高亮
- 点击调 setTaskMode

---

## Agent E — 集成 + 验证 + commit/push

**职责**：
1. 检查 4 个 agent 输出，修接口不一致
2. KnowledgeGraph.jsx 把 store action 传给 RightPanel（本身是 useCanvasStore() 解构，应当无新增）
3. dev server 跑通：
   - 启 vite
   - 在画布选个节点 → 详情面板看到"本地任务"区
   - 写 "写一句话" → 看到路由提示"本地"
   - 点执行 → status=running → done → 看到 result
   - 切到"纯 Hermes" → 同样 prompt → 路由提示"Hermes" → 执行后看到 TaskNode 出现在画布
4. 单房间多人验证 yjs 同步：另开浏览器看到任务结果同步
5. commit 5 个原子 commit，push main，VPS 60-75s 自动部署

---

---

## ⚠ 方向调整（boss 2026-05-02 21:00 追加）

> "单个生成AI跑出的那个多节点系统，每个独立节点的Hermes调度，删掉一下，我这边已经有了决策系统来统一控制系统的逻辑。每个节点列出当前节点所要完成的任务的清单列表，和这个节点牵扯到的 agent 或 skill。"

**含义**：
- 节点级"派给 Hermes / Auto / Manual 切换 / assignedTo / hermesAssignee 选择"全部从 UI 上删掉
- 节点改成"任务清单 + 关联 agent/skill 标签"展示器
- 真正的调度由 **决策层**（RightPanel 路由器 + 三模式开关）统一接管
- 后端 orchestra 整套保留（不动），useCanvasStore.dispatchTaskNode action 也保留供决策层调用

---

## Agent F — TaskNode UI 重构（src/components/canvas/TaskNode.jsx）

**职责**：把 TaskNode 从"自带 Hermes 派单按钮的独立单元"改成"任务清单 + agent/skill 标签展示器"。

**删除**：
- AGENT_OPTIONS 数组
- agentMode toggle 按钮（AUTO/MANUAL）
- onDispatch + dispatchTaskNode 调用
- 派给 Hermes 按钮
- assignedTo / hermesAssignee / assignee 输入控件
- DISPATCHING / PENDING 状态显示（简化状态机）

**保留**：
- 状态机（draft / running / done / failed）
- ColorAccentBar 顶部状态色
- 标题 input + 描述 textarea（draft 可编辑）
- Handle (top/bottom)
- 错误信息显示
- running 状态进度条动画

**新增**：
1. **任务清单（checklist）UI**：
   ```
   ◎ 调研 X 行业现状
   ◉ 整理对比矩阵 (已完成)
   ◎ 输出建议方案
   [+ 添加项]
   ```
   每项 click 切换 done，[x] 删除项
2. **关联 agent / skill 标签**：
   ```
   AGENTS: [hermes] [aletheia]
   SKILLS: [onto-parser] [antithesis-engine]
   ```
   draft 状态可编辑（点 + 弹小输入框），其他状态只读

**新数据结构**（addTaskNode 默认 data）：
```js
{
  title: '',
  body: '',
  status: 'draft',
  checklist: [],          // [{ id, text, done }]
  relatedAgents: [],      // ['hermes', 'aletheia', 'claude-cli']
  relatedSkills: [],      // ['onto-parser', 'antithesis-engine']
  // 删除: agentMode, assignedTo, hermesAssignee, assignee, claimedBy
}
```

**布局规则**：
- 卡片宽度提到 280（多了一行清单）
- 清单项最多展示 5 条，超出"还有 N 项..."折叠
- agent/skill 标签横排，超出换行

---

## 文件锁（更新）

| Agent | 拥有的文件 | 修改的文件 |
|-------|-----------|-----------|
| A | src/services/taskRouter.js（新建） | — |
| B | src/services/localTaskExecutor.js（新建） | — |
| C | — | src/stores/useCanvasStore.js（追加 actions + 改 addTaskNode 默认 data） |
| D | — | src/components/panels/RightPanel.jsx（追加 区块）+ src/collab/CollabHeader.jsx（追加 模式开关） |
| **F** | — | **src/components/canvas/TaskNode.jsx（整体重构）** |
| E | — | （只读其他 + 跑测试 + 提交） |

---

## Agent C 调整范围（增）

除原有 setTaskMode / addLocalTask / updateLocalTaskStatus / removeLocalTask 之外，新增：

```js
// 改 addTaskNode 默认 data，增加 checklist/relatedAgents/relatedSkills，删除 agentMode/assignedTo/hermesAssignee/assignee
addTaskNode: (position) => taskNodeId

// 任务清单操作
addChecklistItem: (nodeId, text) => itemId
toggleChecklistItem: (nodeId, itemId) => void
removeChecklistItem: (nodeId, itemId) => void

// 关联 agent / skill
setRelatedAgents: (nodeId, agents: string[]) => void
setRelatedSkills: (nodeId, skills: string[]) => void
```

每个 agent 完成自己的事就退出。E 在 A-D 全部完成后启动。

---

## 接口契约总结（不可变）

| 模块 | 导出 | 签名 |
|------|------|------|
| taskRouter | routeTask | `({text, mode}) => {target, reason, score}` |
| localTaskExecutor | runLocalTask | `({nodeId, taskId, prompt, system, onUpdate}) => Promise<void>` |
| useCanvasStore | setTaskMode | `(mode) => void` |
| useCanvasStore | addLocalTask | `(nodeId, {prompt, target, routerReason}) => taskId:string` |
| useCanvasStore | updateLocalTaskStatus | `(nodeId, taskId, patch) => void` |
| useCanvasStore | removeLocalTask | `(nodeId, taskId) => void` |
| useCanvasStore | taskMode | `'auto' \| 'local' \| 'hermes'` |
