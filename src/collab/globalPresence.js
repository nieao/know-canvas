/**
 * 全局协作者 presence — 跨房间看见所有在线同伴 + 一键跳到他们的频道
 *
 * 设计:
 *   - 单独连一个固定的 yjs room "kc-global-presence-v1" (WS 服务器同源 /yws)
 *   - 这个 room 不存任何数据 (Y.Doc 是空的), 只用 awareness 广播:
 *       { user: { name, color }, currentRoom, lastSeenAt }
 *   - 主房间切换时 (navigateToRoom) 整个页面 reload, presence 自动重新广播
 *   - 用户列表: 排除自己 + 排除 30s 内没心跳的 (掉线)
 *
 * 不重复造轮子: 复用 yjsClient 的 DEFAULT_WS_URL 同源拼接逻辑
 */

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const GLOBAL_ROOM = 'kc-global-presence-v1'
const STALE_MS = 60 * 1000 // 60s 没心跳视为掉线

let _doc = null
let _provider = null
let _heartbeat = null

function defaultWsUrl() {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:1234'
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${proto}//${window.location.host}/yws`
  }
  return 'ws://127.0.0.1:1234'
}

/**
 * 启动全局 presence — 在主房间 startSync 后调
 * @param {{ user: {name, color}, currentRoom: string, wsUrl?: string }} opts
 */
export function startGlobalPresence(opts = {}) {
  const { user, currentRoom, wsUrl } = opts
  if (_provider) {
    // 已启动, 只更新 awareness
    updateGlobalPresence(currentRoom)
    return _provider
  }
  _doc = new Y.Doc()
  _provider = new WebsocketProvider(wsUrl || defaultWsUrl(), GLOBAL_ROOM, _doc, { connect: true })
  const local = {
    user: user || { name: 'anonymous', color: '#888' },
    currentRoom: currentRoom || '',
    lastSeenAt: Date.now(),
  }
  _provider.awareness.setLocalState(local)

  // 心跳: 每 20s 更新 lastSeenAt 让其他人知道还活着
  _heartbeat = setInterval(() => {
    if (!_provider) return
    const cur = _provider.awareness.getLocalState() || {}
    _provider.awareness.setLocalState({ ...cur, lastSeenAt: Date.now() })
  }, 20 * 1000)

  return _provider
}

/** 更新自己的当前频道 (切换房间时调) */
export function updateGlobalPresence(currentRoom) {
  if (!_provider) return
  const cur = _provider.awareness.getLocalState() || {}
  _provider.awareness.setLocalState({ ...cur, currentRoom: currentRoom || '', lastSeenAt: Date.now() })
}

/** 停止 — 用户退出协作时调 */
export function stopGlobalPresence() {
  if (_heartbeat) {
    clearInterval(_heartbeat)
    _heartbeat = null
  }
  if (_provider) {
    try { _provider.destroy() } catch {}
    _provider = null
  }
  if (_doc) {
    try { _doc.destroy() } catch {}
    _doc = null
  }
}

/** 拿当前所有同伴 (排除自己 + 排除掉线) */
export function getGlobalPeers() {
  if (!_provider) return []
  const out = []
  const now = Date.now()
  _provider.awareness.getStates().forEach((state, clientId) => {
    if (clientId === _provider.awareness.clientID) return
    if (!state || !state.user) return
    if (!state.currentRoom) return
    if (state.lastSeenAt && now - state.lastSeenAt > STALE_MS) return
    out.push({
      clientId,
      name: state.user.name || 'anonymous',
      color: state.user.color || '#888',
      currentRoom: state.currentRoom,
      lastSeenAt: state.lastSeenAt || 0,
    })
  })
  return out
}

/** 订阅 awareness 变化 — 返回 unsubscribe */
export function onGlobalPresenceChange(handler) {
  if (!_provider) return () => {}
  const listener = () => handler(getGlobalPeers())
  _provider.awareness.on('change', listener)
  return () => {
    try { _provider.awareness.off('change', listener) } catch {}
  }
}
