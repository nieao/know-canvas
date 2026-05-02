/**
 * 前端 action 日志：发送到 action-log-server
 * 环境感知：dev http://127.0.0.1:18091, prod 同源 /canvas/api/log
 * 失败静默（不打扰用户）
 */
import { getRoomFromUrl, getUsername } from '../collab/session'
import { pushLog } from './logBus'

const ACTION_LOG_URL = (() => {
  if (typeof window === 'undefined') return ''
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  return isLocal ? 'http://127.0.0.1:18091/log' : '/canvas/api/log'
})()

let _failOnce = false  // 失败一次后不再重试，避免狂刷 console

/**
 * 记录一个用户动作
 * @param {string} name - 动作名（'leftpanel.addSource' / 'rightpanel.editField' 等）
 * @param {object} [payload] - 任意 payload，会被 JSON.stringify
 */
export function logAction(name, payload = {}) {
  // 1. 推到前端 logBus（CliMonitor 实时显示, 永远不会失败）
  pushLog({ level: 'info', source: 'action', msg: name, data: payload })

  // 2. POST 到后端 action-log-server 持久化（失败一次后停止）
  if (_failOnce || !ACTION_LOG_URL) return
  try {
    const body = JSON.stringify({
      name,
      payload,
      room: getRoomFromUrl(),
      user: getUsername(),
      ts: new Date().toISOString(),
    })
    fetch(ACTION_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      _failOnce = true
      pushLog({ level: 'warn', source: 'net', msg: 'action-log-server 不可达, 后端持久化已停, 前端 logBus 仍工作' })
    })
  } catch (_e) {
    _failOnce = true
  }
}
