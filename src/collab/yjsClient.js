/**
 * Yjs 客户端封装 — Know Canvas 协作版
 *
 * 设计：
 * - 单例 Y.Doc + WebsocketProvider，整个画布共享一份
 * - 房间 ID 来自 URL `?room=xxx`，用户名来自 localStorage
 * - 启动失败（ws 服务器没起）不抛异常，provider 会后台无限重连
 * - Yjs 数据结构：
 *     ydoc.getMap('nodes')  → nodeId → React Flow node JSON
 *     ydoc.getMap('edges')  → edgeId → React Flow edge JSON
 *     awareness             → { user: { name, color }, cursor: {x,y}, selectedNodeIds: [] }
 */

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

// 默认 ws 地址：开发用 localhost；生产由部署文档拼到同源 wss://<host>/yws
const DEFAULT_WS_URL = (() => {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:1234'
  // 同源策略：如果页面是 https 就用 wss，反之 ws
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // 同机部署时走 /yws 子路径反代到本地 1234
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${proto}//${window.location.host}/yws`
  }
  return 'ws://127.0.0.1:1234'
})()

let _doc = null
let _provider = null
let _room = null

export function getDoc() {
  if (!_doc) _doc = new Y.Doc()
  return _doc
}

export function getNodesMap() {
  return getDoc().getMap('nodes')
}

export function getEdgesMap() {
  return getDoc().getMap('edges')
}

export function getMetaMap() {
  return getDoc().getMap('meta')
}

export function getProvider() {
  return _provider
}

export function getRoom() {
  return _room
}

/**
 * 启动 Yjs sync
 * @param {string} roomId - 房间 ID（建议 URL ?room= 来）
 * @param {object} opts
 * @param {string} [opts.wsUrl]
 * @param {{name:string,color:string}} [opts.user]
 */
export function startSync(roomId, opts = {}) {
  if (!roomId) throw new Error('startSync 需要 roomId')
  if (_provider && _room === roomId) return _provider

  // 切换房间：销毁旧的
  if (_provider) {
    try { _provider.destroy() } catch (_e) {}
    _provider = null
  }

  _room = roomId
  const wsUrl = opts.wsUrl || DEFAULT_WS_URL
  _provider = new WebsocketProvider(wsUrl, roomId, getDoc(), { connect: true })

  _provider.on('status', (e) => {
    console.log('[yjs] status:', e.status, '@', wsUrl, 'room:', roomId)
  })
  _provider.on('connection-error', (err) => {
    console.warn('[yjs] connection-error:', err?.message || err)
  })

  if (opts.user) setLocalUser(opts.user)
  return _provider
}

export function stopSync() {
  if (_provider) {
    try { _provider.destroy() } catch (_e) {}
    _provider = null
    _room = null
  }
}

export function getAwareness() {
  return _provider ? _provider.awareness : null
}

export function setLocalUser(user) {
  const aw = getAwareness()
  if (aw) aw.setLocalStateField('user', user)
}

export function setLocalCursor(cursor) {
  const aw = getAwareness()
  if (aw) aw.setLocalStateField('cursor', cursor)
}

export function setLocalSelection(nodeIds) {
  const aw = getAwareness()
  if (aw) aw.setLocalStateField('selectedNodeIds', nodeIds)
}

// 临时态：本地刚拖完一个节点 — 广播给其他客户端做"呼吸 + 气泡"
// 字段 3 秒后自动清空，避免 awareness 留垃圾
let _movedNodeTimer = null
export function setLocalMovedNode(nodeId) {
  const aw = getAwareness()
  if (!aw) return
  if (!nodeId) {
    aw.setLocalStateField('movedNode', null)
    return
  }
  aw.setLocalStateField('movedNode', { nodeId, ts: Date.now() })
  if (_movedNodeTimer) clearTimeout(_movedNodeTimer)
  _movedNodeTimer = setTimeout(() => {
    const aw2 = getAwareness()
    if (aw2) aw2.setLocalStateField('movedNode', null)
  }, 3500)
}

/** 读取本地 awareness 用户态，给节点工厂注入 createdBy 用 */
export function getLocalUser() {
  const aw = getAwareness()
  if (!aw) return null
  const state = aw.getLocalState()
  return state?.user || null
}

export function getRemoteStates() {
  const aw = getAwareness()
  if (!aw) return []
  const states = []
  aw.getStates().forEach((state, clientId) => {
    if (clientId === aw.clientID) return
    if (state) states.push({ clientId, ...state })
  })
  return states
}

export function onAwarenessChange(handler) {
  const aw = getAwareness()
  if (!aw) return () => {}
  const listener = () => handler(getRemoteStates())
  aw.on('change', listener)
  return () => aw.off('change', listener)
}

// ─────────────────────────────────────────────────────────────────────────────
// UndoManager — Ctrl+Z / Ctrl+Y 撤销重做
// 只跟踪 origin === 'local' 的本地修改 (yjsSync.js 推本地变更时用 ORIGIN_LOCAL)
// 远端用户的更改不会被本地 undo 误回滚
// ─────────────────────────────────────────────────────────────────────────────
let _undoManager = null

export function getUndoManager() {
  if (_undoManager) return _undoManager
  const yNodes = getNodesMap()
  const yEdges = getEdgesMap()
  _undoManager = new Y.UndoManager([yNodes, yEdges], {
    trackedOrigins: new Set(['local']),
    captureTimeout: 500,  // 500ms 内的连续操作 (拖动节点 60fps) 聚合成一个 undo 单位
  })
  return _undoManager
}

export function undo() {
  const um = getUndoManager()
  if (um.canUndo()) um.undo()
}

export function redo() {
  const um = getUndoManager()
  if (um.canRedo()) um.redo()
}

export function canUndo() {
  return getUndoManager().canUndo()
}

export function canRedo() {
  return getUndoManager().canRedo()
}
