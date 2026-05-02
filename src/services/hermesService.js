/**
 * Hermes Service — 前端调用 hermes-proxy 的薄封装
 *
 * 设计:
 *   - 不直接调 Hermes (浏览器没法设 UA + 凭据不能暴露)
 *   - 走本机 server/hermes-proxy.js 中转
 *   - 提供 dispatchTask / getTask / pollTask 三个核心 API
 *
 * 配置: VITE_HERMES_PROXY_URL (默认 http://127.0.0.1:17081)
 */

const PROXY_URL = (import.meta.env.VITE_HERMES_PROXY_URL || 'http://127.0.0.1:17081').replace(/\/$/, '')

/** Hermes 任务状态映射 — kanban 6 列 → 画布 4 状态 */
export const HERMES_STATUS = {
  TRIAGE: 'triage',
  TODO: 'todo',
  READY: 'ready',
  RUNNING: 'running',
  BLOCKED: 'blocked',
  DONE: 'done',
}

/** 画布侧 TaskNode 的状态 (跟 Hermes 不一一对应, 简化) */
export const TASK_NODE_STATUS = {
  DRAFT: 'draft',         // 还没派
  DISPATCHING: 'dispatching',  // 调 dispatch 中
  PENDING: 'pending',     // Hermes 上 ready / triage / todo
  RUNNING: 'running',     // Hermes 上 running
  DONE: 'done',           // Hermes 上 done
  FAILED: 'failed',       // Hermes 报错 / blocked
}

/** 把 Hermes 状态映射到 TaskNode 状态 */
export function mapHermesStatus(hermesStatus) {
  if (!hermesStatus) return TASK_NODE_STATUS.PENDING
  switch (hermesStatus) {
    case HERMES_STATUS.RUNNING: return TASK_NODE_STATUS.RUNNING
    case HERMES_STATUS.DONE: return TASK_NODE_STATUS.DONE
    case HERMES_STATUS.BLOCKED: return TASK_NODE_STATUS.FAILED
    default: return TASK_NODE_STATUS.PENDING
  }
}

/** proxy /health — 一次性看 Hermes 通不通, 凭据对不对 */
export async function healthCheck() {
  try {
    const r = await fetch(`${PROXY_URL}/health`, { method: 'GET' })
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` }
    return await r.json()
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/** 派一个 task 给 Hermes — 返回 { ok, task: {id, ...} } */
export async function dispatchTask({ title, body, assignee = null, priority = 3, max_runtime_seconds = 600 }) {
  if (!title) throw new Error('dispatchTask: 缺少 title')
  const r = await fetch(`${PROXY_URL}/api/canvas/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, assignee, priority, max_runtime_seconds }),
  })
  const data = await r.json()
  if (!data.ok) {
    throw new Error(`dispatchTask: ${data.error || `HTTP ${r.status}`}`)
  }
  return data.task   // { id: 't_xxx', title, status: 'ready', ... }
}

/** 查单个 task 状态 */
export async function getTask(taskId) {
  const r = await fetch(`${PROXY_URL}/api/canvas/task/${encodeURIComponent(taskId)}`)
  const data = await r.json()
  if (!data.ok) throw new Error(`getTask: ${data.error || `HTTP ${r.status}`}`)
  return data.task
}

/** 查 task 日志 (gateway 起来后才有内容) */
export async function getTaskLog(taskId) {
  const r = await fetch(`${PROXY_URL}/api/canvas/task/${encodeURIComponent(taskId)}/log`)
  const data = await r.json()
  if (!data.ok) throw new Error(`getTaskLog: ${data.error || `HTTP ${r.status}`}`)
  return data.log
}

/**
 * 轮询 task, 每 intervalMs 拉一次, 直到 status 变成 done/blocked 或超时
 *
 * @param {string} taskId
 * @param {object} options
 * @param {number} options.intervalMs 轮询间隔 (默认 3000)
 * @param {number} options.maxMs 最长等待 (默认 600000 = 10min)
 * @param {(task) => void} options.onUpdate 每次拉到新 task 时回调
 * @returns {Promise<{task, timedOut}>} task = 最后一次拉到的; timedOut = 是否超时
 */
export async function pollTask(taskId, { intervalMs = 3000, maxMs = 600000, onUpdate } = {}) {
  const start = Date.now()
  let task = null
  while (Date.now() - start < maxMs) {
    try {
      task = await getTask(taskId)
      if (onUpdate) onUpdate(task)
      if (task && (task.status === HERMES_STATUS.DONE || task.status === HERMES_STATUS.BLOCKED)) {
        return { task, timedOut: false }
      }
    } catch (e) {
      console.warn('[hermesService] pollTask err (continue):', e.message)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return { task, timedOut: true }
}
