/**
 * projectLibraryActions — 项目库的业务级动作
 *
 * 1) saveCurrentCanvasAsProject(...)  — 把当前画布导出为快照写入项目库
 *    由元认知 5 步完成 / Aletheia cycle done 时自动调
 *
 * 2) loadProjectToCanvas(projectId)   — 把项目快照复现到当前画布
 *    由 ProjectLibraryPanel 点"载入"卡片时调
 */

import useCanvasStore from '../stores/useCanvasStore'
import useCostMeterStore from '../stores/useCostMeterStore'
import useProjectLibraryStore from '../stores/useProjectLibraryStore'

/**
 * 把当前画布作为一个新项目保存
 *
 * @param {Object} args
 * @param {string} args.title          — 项目标题
 * @param {string} [args.summary]      — 一句话描述
 * @param {number} [args.healthScore]  — Aletheia 时传
 * @param {number} [args.totalCostCny] — 可选, 不传时按 taskId 自动取
 * @param {Object} [args.totalTokens]  — 可选, { input, output }
 * @param {string} [args.taskId]       — 用于从 useCostMeterStore.getCostByTaskId 拉成本
 * @param {string} [args.source]       — 'meta-cognitive' | 'aletheia' | 'manual'
 * @param {string[]} [args.tags]
 * @returns {string} project id
 */
export function saveCurrentCanvasAsProject({
  title,
  summary = '',
  healthScore,
  totalCostCny,
  totalTokens,
  taskId,
  source = 'manual',
  tags,
} = {}) {
  // 1. 取画布快照
  const canvas = useCanvasStore.getState()
  const snapshot = typeof canvas.exportCanvasData === 'function'
    ? canvas.exportCanvasData()
    : { nodes: canvas.nodes || [], edges: canvas.edges || [] }

  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : []
  const edges = Array.isArray(snapshot.edges) ? snapshot.edges : []

  // 2. 如果有 taskId, 从成本表查这个任务的累计费用 + tokens
  let costCny = totalCostCny
  let tokens = totalTokens
  if (taskId && typeof useCostMeterStore.getState === 'function') {
    try {
      const cost = useCostMeterStore.getState().getCostByTaskId(taskId)
      if (cost?.total) {
        if (typeof costCny !== 'number') costCny = cost.total.costCny
        if (!tokens) {
          const t = cost.total.tokens
          tokens = t ? (Number(t.input || 0) + Number(t.output || 0)) : 0
        }
      }
    } catch {
      // 静默 — 成本不是必需字段
    }
  }

  const stats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
  }
  if (typeof healthScore === 'number') stats.healthScore = healthScore
  if (typeof costCny === 'number') stats.totalCostCny = costCny
  if (typeof tokens === 'number') stats.totalTokens = tokens

  // 3. 写入项目库
  const id = useProjectLibraryStore.getState().saveProject({
    title: title || '未命名项目',
    summary,
    snapshot: { nodes, edges },
    stats,
    tags,
    source,
  })

  // 4. 广播事件 — 让 UI 入口闪烁/Toast 等扩展点接管
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('project-library:saved', {
        detail: { id, title, source },
      }))
    } catch {}
  }

  return id
}

/**
 * 把项目库里的项目复现到当前画布
 *
 * - snapshot.kind === 'aletheiaProject' → 走回放动画 (按节点创建顺序逐个揭示)
 * - 其他 → 一次性 import (默认行为, 兼容老 snapshot)
 *
 * @param {string} projectId
 * @returns {{ ok: boolean, project?: Object, reason?: string, replayed?: boolean }}
 */
export function loadProjectToCanvas(projectId) {
  const project = useProjectLibraryStore.getState().getProject(projectId)
  if (!project) return { ok: false, reason: 'not-found' }
  const snap = project.snapshot || { nodes: [], edges: [] }

  // ALETHEIA 项目 → 回放模式
  if (snap.kind === 'aletheiaProject') {
    replayAletheiaProject(snap).catch((err) => console.error('[replayAletheiaProject] 失败:', err))
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('project-library:replaying', {
          detail: { id: projectId, title: project.title },
        }))
      } catch {}
    }
    return { ok: true, project, replayed: true }
  }

  // 默认: 一次性 import
  try {
    useCanvasStore.getState().importCanvasData(snap.nodes || [], snap.edges || [])
  } catch (err) {
    return { ok: false, reason: 'import-failed', error: String(err?.message || err) }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('project-library:loaded', {
        detail: { id: projectId, title: project.title },
      }))
    } catch {}
  }
  return { ok: true, project }
}

/**
 * 回放一个 aletheiaProject snapshot — 按 root → tasks → agents 顺序逐步揭示
 *
 * 节奏:
 *   - root 立刻出 (含 6 stage timeline 但停在 CONTEXT)
 *   - 1s 后 stage→DECOMPOSE, 同时把 task 节点逐个 push (每 0.3s 一个)
 *   - 然后 stage→EMERGE, agent 节点逐个 push (每 0.4s 一个)
 *   - 然后 stage→TOPOLOGY/EXECUTE 快进到 done, 显示 verdict
 *
 * 边的策略: 等所有相关源/目标节点都已出现后, 一次性 push 边 (避免边孤儿)
 */
async function replayAletheiaProject(snap) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const canvas = useCanvasStore.getState()
  const { nodes: existingNodes } = canvas
  const allNodes = Array.isArray(snap.nodes) ? snap.nodes : []
  const allEdges = Array.isArray(snap.edges) ? snap.edges : []

  // 找到 root 节点 (variant=goal 或 type=ontologyNode 且第一个)
  const rootNode = allNodes.find((n) => n.type === 'ontologyNode' && n.data?.variant === 'goal') || allNodes[0]
  if (!rootNode) return

  // 防 id 冲突: 回放时所有节点 id 加 -replay-{ts} 后缀
  const ts = Date.now()
  const idMap = new Map()
  const remap = (id) => {
    if (!idMap.has(id)) idMap.set(id, `${id}-replay-${ts}`)
    return idMap.get(id)
  }
  const cloneNode = (n) => ({
    ...JSON.parse(JSON.stringify(n)),
    id: remap(n.id),
  })
  const cloneEdge = (e) => ({
    ...JSON.parse(JSON.stringify(e)),
    id: `${e.id}-replay-${ts}`,
    source: remap(e.source),
    target: remap(e.target),
  })

  // 给 root 一个新位置 (不要覆盖现有项目根) — 用 getNextGridPosition
  const newRootPos = canvas.getNextGridPosition()
  const offsetX = newRootPos.x - rootNode.position.x
  const offsetY = newRootPos.y - rootNode.position.y
  const offsetNode = (n) => {
    const cloned = cloneNode(n)
    cloned.position = { x: cloned.position.x + offsetX, y: cloned.position.y + offsetY }
    return cloned
  }

  // 1. 立刻 push root (但 stage 重置回 CONTEXT, 制造"刚开始"错觉)
  const rootClone = offsetNode(rootNode)
  rootClone.data = {
    ...(rootClone.data || {}),
    projectStage: 'CONTEXT',
    projectStatus: 'running',
    decision: null,    // 先抹掉, 后面再恢复
    libraryId: null,   // 新一份, 不复用旧 lib id
  }
  useCanvasStore.setState((state) => { state.nodes.push(rootClone) })

  // 2. 1s 后 → DECOMPOSE + 逐个 push task 节点
  await sleep(1000)
  useCanvasStore.setState((state) => {
    const r = state.nodes.find((n) => n.id === rootClone.id)
    if (r) r.data.projectStage = 'DECOMPOSE'
  })
  const taskNodes = allNodes.filter((n) => n.type === 'ontologyNode' && n.data?.variant === 'entity' && n.id.startsWith('task-'))
  for (const t of taskNodes) {
    await sleep(300)
    const clone = offsetNode(t)
    useCanvasStore.setState((state) => { state.nodes.push(clone) })
  }
  // root → task 边
  const rootTaskEdges = allEdges.filter((e) => e.source === rootNode.id && taskNodes.some((t) => t.id === e.target))
  if (rootTaskEdges.length) {
    await sleep(200)
    useCanvasStore.setState((state) => {
      rootTaskEdges.forEach((e) => state.edges.push(cloneEdge(e)))
    })
  }

  // 3. → EMERGE + 逐个 push agent 节点
  await sleep(800)
  useCanvasStore.setState((state) => {
    const r = state.nodes.find((n) => n.id === rootClone.id)
    if (r) r.data.projectStage = 'EMERGE'
  })
  const agentNodes = allNodes.filter((n) => n.type === 'agentRoleNode')
  for (const a of agentNodes) {
    await sleep(400)
    const clone = offsetNode(a)
    // agent 状态从 pending 开始
    clone.data = { ...clone.data, status: 'pending' }
    useCanvasStore.setState((state) => { state.nodes.push(clone) })
  }
  // task → agent 边
  const taskAgentEdges = allEdges.filter((e) => taskNodes.some((t) => t.id === e.source) && agentNodes.some((a) => a.id === e.target))
  if (taskAgentEdges.length) {
    await sleep(200)
    useCanvasStore.setState((state) => {
      taskAgentEdges.forEach((e) => state.edges.push(cloneEdge(e)))
    })
  }

  // 4. → TOPOLOGY (push 剩余依赖边) + agent 串行 done
  await sleep(800)
  useCanvasStore.setState((state) => {
    const r = state.nodes.find((n) => n.id === rootClone.id)
    if (r) r.data.projectStage = 'TOPOLOGY'
  })
  const remainingEdges = allEdges.filter((e) => !rootTaskEdges.includes(e) && !taskAgentEdges.includes(e))
  useCanvasStore.setState((state) => {
    remainingEdges.forEach((e) => state.edges.push(cloneEdge(e)))
  })

  // 5. EXECUTE — agent 状态依次 running → done
  await sleep(800)
  useCanvasStore.setState((state) => {
    const r = state.nodes.find((n) => n.id === rootClone.id)
    if (r) r.data.projectStage = 'EXECUTE'
  })
  for (const a of agentNodes) {
    const remappedId = remap(a.id)
    useCanvasStore.setState((state) => {
      const n = state.nodes.find((x) => x.id === remappedId)
      if (n) n.data.status = 'running'
    })
    await sleep(800)
    useCanvasStore.setState((state) => {
      const n = state.nodes.find((x) => x.id === remappedId)
      if (n) {
        n.data.status = a.data?.status || 'done'
        n.data.output_summary = a.data?.output_summary
      }
    })
  }

  // 6. REFLECT — 写回 decision
  await sleep(600)
  useCanvasStore.setState((state) => {
    const r = state.nodes.find((n) => n.id === rootClone.id)
    if (r) {
      r.data.projectStage = 'REFLECT'
      r.data.projectStatus = 'done'
      r.data.decision = snap.decision
    }
  })

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('project-library:replay-done', {
        detail: { rootId: rootClone.id },
      }))
    } catch {}
  }
}
