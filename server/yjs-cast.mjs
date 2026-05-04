/**
 * server 端 yjs 写入 — 让 source-proxy daemon 能往 canvas room 写节点
 *
 * 用途:
 *   - 飞书 bot 收到群消息 → 写节点 (/canvas/cast)
 *   - 未来其他 webhook 接入也复用
 *
 * 实现:
 *   - 临时 yjs Doc + WebsocketProvider 连到 ws://127.0.0.1:1234/<room>
 *   - 等 sync 拉到房间已有内容 (避免覆盖)
 *   - 写 node + edge 到 yjs maps
 *   - 短暂 sleep 让更新冒到对端 (没 ack 机制)
 *   - 销毁 provider/doc
 *
 * 跟前端 castToRoom 同设计 (yjsClient.js castToRoom), 但跑在 Node 进程里.
 */

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

// y-websocket 在 Node 里需要手动注入 ws polyfill
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket
}

const DEFAULT_WS = process.env.YJS_WS_URL || 'ws://127.0.0.1:1234'

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 把若干节点写入指定 room
 *
 * @param {Object} payload
 * @param {string} payload.room — 目标 room
 * @param {Array} payload.nodes — React Flow node 数组 (id 必须自己生成或留空让我们生成)
 * @param {Array} [payload.edges] — 可选 edges
 * @param {Object} [opts]
 * @param {string} [opts.wsUrl]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ writtenNodes: string[], writtenEdges: string[] }>}
 */
export async function castNodesToRoom({ room, nodes = [], edges = [] }, opts = {}) {
  if (!room) throw new Error('castNodesToRoom: room 必填')
  if (nodes.length === 0 && edges.length === 0) {
    return { writtenNodes: [], writtenEdges: [] }
  }
  const wsUrl = opts.wsUrl || DEFAULT_WS
  const timeoutMs = opts.timeoutMs || 8000

  // 给没 id 的节点/边生成 id
  for (const n of nodes) if (!n.id) n.id = newId('n')
  for (const e of edges) if (!e.id) e.id = newId('e')

  const doc = new Y.Doc()
  const provider = new WebsocketProvider(wsUrl, room, doc, {
    connect: true,
    WebSocketPolyfill: WebSocket,
  })

  try {
    await new Promise((resolve, reject) => {
      let done = false
      const timer = setTimeout(() => {
        if (done) return
        done = true
        reject(new Error(`yjs-cast: 连接 ${wsUrl} ${room} 超时 ${timeoutMs}ms`))
      }, timeoutMs)
      provider.once('synced', () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      })
    })

    const yNodes = doc.getMap('nodes')
    const yEdges = doc.getMap('edges')
    doc.transact(() => {
      for (const n of nodes) yNodes.set(n.id, n)
      for (const e of edges) yEdges.set(e.id, e)
    }, 'feishu-bot')

    // 给 ws 一点时间把更新广播出去
    await new Promise((r) => setTimeout(r, 600))

    return {
      writtenNodes: nodes.map((n) => n.id),
      writtenEdges: edges.map((e) => e.id),
    }
  } finally {
    try { provider.disconnect() } catch {}
    try { provider.destroy() } catch {}
    try { doc.destroy() } catch {}
  }
}

/**
 * 快捷: 建一个文本节点
 */
export async function castTextNode({ room, text, attribution }, opts = {}) {
  const id = newId('text')
  const node = {
    id,
    type: 'noteNode', // 笔记节点 (有 content 字段渲染)
    position: { x: Math.random() * 400 + 200, y: Math.random() * 300 + 200 },
    data: {
      title: '飞书 · ' + (attribution?.name || '匿名'),
      content: String(text || '').slice(0, 2000),
      createdBy: attribution || { name: 'feishu-bot', via: 'feishu-bot' },
      createdAt: Date.now(),
      source: 'feishu-bot',
    },
  }
  const r = await castNodesToRoom({ room, nodes: [node] }, opts)
  return { ...r, nodeId: id }
}

/**
 * 写一条 aletheia-prompt 到 inbox map (前端订阅会自动 fire 元认知 5 步)
 *
 * 写到 ydoc.getMap('aletheia-inbox') 里, 不在 nodes/edges 上
 *   key = `inbox_{ts}_{rand}`, value = { id, text, attribution, ts, status:'pending', targetClient:null }
 *
 * 同时返回当前 awareness peers 数量, 让 bot 能告诉用户"在线 N 人"
 */
export async function castAletheiaPrompt({ room, text, attribution }, opts = {}) {
  if (!room) throw new Error('castAletheiaPrompt: room 必填')
  if (!text) throw new Error('castAletheiaPrompt: text 必填')

  const wsUrl = opts.wsUrl || DEFAULT_WS
  const timeoutMs = opts.timeoutMs || 8000

  const id = newId('inbox')
  const item = {
    id,
    text: String(text).slice(0, 4000),
    attribution: attribution || { name: 'feishu-bot', via: 'feishu-bot' },
    ts: Date.now(),
    status: 'pending',
  }

  const doc = new Y.Doc()
  const provider = new WebsocketProvider(wsUrl, room, doc, {
    connect: true,
    WebSocketPolyfill: WebSocket,
  })

  try {
    await new Promise((resolve, reject) => {
      let done = false
      const timer = setTimeout(() => {
        if (done) return
        done = true
        reject(new Error(`yjs-cast: 连接 ${wsUrl} ${room} 超时 ${timeoutMs}ms`))
      }, timeoutMs)
      provider.once('synced', () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      })
    })

    // 数当前在线 peers (不含我们自己这个临时 client)
    const states = provider.awareness.getStates()
    const selfId = doc.clientID
    let peers = 0
    states.forEach((_state, clientId) => { if (clientId !== selfId) peers += 1 })

    const yInbox = doc.getMap('aletheia-inbox')
    doc.transact(() => {
      yInbox.set(id, item)
    }, 'feishu-bot-aletheia-prompt')

    await new Promise((r) => setTimeout(r, 600))

    return { id, room, peers }
  } finally {
    try { provider.disconnect() } catch {}
    try { provider.destroy() } catch {}
    try { doc.destroy() } catch {}
  }
}

/**
 * 快捷: 建一个链接节点 (可选 title/summary 由调用方提供)
 */
export async function castBookmarkNode({ room, url, title, summary, attribution }, opts = {}) {
  const id = newId('bookmark')
  const node = {
    id,
    type: 'bookmarkNode',
    position: { x: Math.random() * 400 + 200, y: Math.random() * 300 + 200 },
    data: {
      title: title || url,
      url,
      summary: String(summary || '').slice(0, 800),
      createdBy: attribution || { name: 'feishu-bot', via: 'feishu-bot' },
      createdAt: Date.now(),
      source: 'feishu-bot',
    },
  }
  const r = await castNodesToRoom({ room, nodes: [node] }, opts)
  return { ...r, nodeId: id }
}
