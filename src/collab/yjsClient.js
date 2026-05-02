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
