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
 * @param {string} projectId
 * @returns {{ ok: boolean, project?: Object, reason?: string }}
 */
export function loadProjectToCanvas(projectId) {
  const project = useProjectLibraryStore.getState().getProject(projectId)
  if (!project) return { ok: false, reason: 'not-found' }
  const snap = project.snapshot || { nodes: [], edges: [] }
  try {
    useCanvasStore.getState().importCanvasData(snap.nodes || [], snap.edges || [])
  } catch (err) {
    return { ok: false, reason: 'import-failed', error: String(err?.message || err) }
  }
  // 通知画布做 fitView (复用元认知完成事件)
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('project-library:loaded', {
        detail: { id: projectId, title: project.title },
      }))
    } catch {}
  }
  return { ok: true, project }
}
