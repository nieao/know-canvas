/**
 * Know Canvas CLI Bridge — 反向调用入口（Hermes Agent → Know Canvas）
 *
 * 启动: node server/canvas-cli-bridge.mjs
 * 端口: 17082 (默认, 避开 1234 yws / 17080 llm-proxy / 17081 hermes-proxy / 18080 claude-bridge)
 *
 * 架构：
 *   外部调用方 (Hermes / CLI / 任何 HTTP 客户端)
 *        │
 *        │ POST /api/submit  {prompt, mode, room, callback_url?}
 *        ▼
 *   ┌─────────────────────┐
 *   │ canvas-cli-bridge   │  ← 用 yjs + y-websocket Node 客户端连 ws://127.0.0.1:1234/{room}
 *   │  - 管理 ydoc/provider │  ← 同 room 复用同一连接, 引用计数管理
 *   │  - 注入 htmlPageNode  │  ← 在 yjs nodes map 里 push 一个 pending 节点
 *   │  - watcher 监听状态  │  ← observe nodes map 的状态变更
 *   │  - callback 推回去    │  ← node 状态变化时 POST 到 callback_url (3 次退避重试)
 *   └─────────────────────┘
 *        │
 *        ▼
 *   y-ws-server (Yjs 黑板) ← 画布前端任意 tab 看到 pending 节点 → 跑 _runHtmlAnswer →
 *                            done/failed 写回 yjs → 本 daemon watcher 触发 callback
 *
 * 关键设计：
 *   - 节点状态权威 = Yjs 黑板, 本 daemon 只是 watcher + 注入器, 不是 task queue
 *   - 必须先 observe 再 push, 不然丢首条事件 (race condition)
 *   - callback POST 失败退避重试 3 次 (5s/15s/30s)
 *
 * 详细 callback 协议见 docs/HERMES-CALLBACK.md
 */

import http from 'node:http'
import { URL } from 'node:url'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

// ───── 配置 ─────
const PORT = parseInt(process.env.PORT || '17082', 10)
const HOST = process.env.HOST || '127.0.0.1'
const YWS_URL = process.env.YWS_URL || 'ws://127.0.0.1:1234'
const DEFAULT_ROOM = process.env.ROOM || 'demo-railway'
const VERSION = '0.1.0'

console.log(`[cli-bridge] 启动 canvas-cli-bridge v${VERSION}`)
console.log(`[cli-bridge] 监听 ${HOST}:${PORT}`)
console.log(`[cli-bridge] yws 连接目标 ${YWS_URL}`)
console.log(`[cli-bridge] 默认 room ${DEFAULT_ROOM}`)

// ───── 房间 (ydoc/provider) 管理 + 引用计数 ─────
//
// 同一 room 多次 submit 复用同一个 ydoc/provider,
// refCount 是"当前 room 内仍在监听的 watcher 数"。
// refCount 归零 + 闲置 5 分钟后关 provider, 释放资源。
const rooms = new Map()  // room -> { ydoc, provider, nodesMap, refCount, idleTimer, observers: Set<fn> }

function getRoom(room) {
  let r = rooms.get(room)
  if (r) {
    if (r.idleTimer) { clearTimeout(r.idleTimer); r.idleTimer = null }
    return r
  }
  console.log(`[cli-bridge] [${room}] 首次访问, 建立 ydoc + provider`)
  const ydoc = new Y.Doc()
  const provider = new WebsocketProvider(YWS_URL, room, ydoc, {
    connect: true,
    WebSocketPolyfill: WebSocket,
  })
  provider.on('status', (e) => {
    console.log(`[cli-bridge] [${room}] yws status:`, e.status)
  })
  provider.on('connection-error', (err) => {
    console.warn(`[cli-bridge] [${room}] yws connection-error:`, err?.message || err)
  })
  const nodesMap = ydoc.getMap('nodes')

  // 单一 dispatch 监听器: 每次 nodes map 变更, 通知本 room 内所有 watcher
  const observers = new Set()
  nodesMap.observe((event) => {
    for (const fn of observers) {
      try { fn(event) } catch (err) { console.error(`[cli-bridge] [${room}] observer err:`, err) }
    }
  })

  r = { ydoc, provider, nodesMap, refCount: 0, idleTimer: null, observers, room }
  rooms.set(room, r)
  return r
}

function releaseRoom(r) {
  // refCount 归零, 5 分钟后真关 (避免 submit 高频时反复建立连接)
  if (r.refCount > 0) return
  if (r.idleTimer) return
  r.idleTimer = setTimeout(() => {
    if (r.refCount > 0) return  // 期间又有 watcher 加入了, 取消
    console.log(`[cli-bridge] [${r.room}] 闲置 5 分钟, 关闭 provider`)
    try { r.provider.destroy() } catch (e) { console.warn(e) }
    try { r.ydoc.destroy() } catch (e) { console.warn(e) }
    rooms.delete(r.room)
  }, 5 * 60 * 1000)
}

// ───── 等 provider sync (拿到 yws 全量快照) ─────
async function waitForSync(provider, timeoutMs = 3000) {
  if (provider.synced) return true
  return new Promise((resolve) => {
    let done = false
    const t = setTimeout(() => { if (!done) { done = true; resolve(false) } }, timeoutMs)
    provider.once('sync', () => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve(true)
    })
  })
}

// ───── HTTP utils ─────
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      buf += chunk
      if (buf.length > 1024 * 1024) {
        reject(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(buf || '{}')) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

// ───── callback 推送 (退避重试 3 次) ─────
const RETRY_DELAYS_MS = [5000, 15000, 30000]

async function postCallback(callbackUrl, callbackToken, payload, attempt = 0) {
  if (!callbackUrl) return
  try {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' }
    if (callbackToken) headers['X-Canvas-Token'] = callbackToken
    const resp = await fetch(callbackUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }
    console.log(`[cli-bridge] callback OK ${callbackUrl} status=${payload.status} node=${payload.node_id}`)
  } catch (err) {
    if (attempt >= RETRY_DELAYS_MS.length) {
      console.error(`[cli-bridge] callback FINAL FAIL ${callbackUrl} (${err.message}) — 放弃`)
      return
    }
    const delay = RETRY_DELAYS_MS[attempt]
    console.warn(`[cli-bridge] callback 失败 ${callbackUrl}: ${err.message}, ${delay}ms 后重试 (${attempt + 1}/${RETRY_DELAYS_MS.length})`)
    setTimeout(() => postCallback(callbackUrl, callbackToken, payload, attempt + 1), delay)
  }
}

// ───── 核心: 创建节点 + 启动 watcher ─────
//
// race 关键: observer 必须 *先于* nodesMap.set 注册, 否则首条 'pending' 事件丢失。
async function submitTask({ prompt, mode = 'meta', room, callback_url, callback_token }) {
  const r = getRoom(room)
  // 先等 sync, 拿到房间当前快照 (但即使没 sync 也可以推, yws 收到后会广播)
  await waitForSync(r.provider, 3000)

  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  const nodeId = `htmlpage-${ts}-${rand}`

  // 默认任务清单 (跟 store.askAndCreateHtmlNode 保持一致)
  const tasksMeta = [
    { label: '解析输入意图', status: 'pending' },
    { label: '推理 5 维度元认知', status: 'pending' },
    { label: '渲染 HTML 页面', status: 'pending' },
  ]
  const tasksHermes = [
    { label: '派单到 Hermes', status: 'pending' },
    { label: '等待 worker 接手', status: 'pending' },
    { label: '抓取结果包装 HTML', status: 'pending' },
  ]
  const tasks = mode === 'hermes' ? tasksHermes : tasksMeta

  // 简单网格定位 (跟前端 getNextGridPosition 不一致也无所谓 — 前端 ReactFlow 会按 yjs 数据布局)
  // 这里用 (200 + ((count*240) % 1200), 200 + Math.floor(count*240/1200)*240)
  const count = r.nodesMap.size
  const col = count % 5
  const row = Math.floor(count / 5)
  const pos = { x: 200 + col * 240, y: 200 + row * 240 }

  const node = {
    id: nodeId,
    type: 'htmlPageNode',
    position: pos,
    data: {
      prompt,
      mode,
      taskStatus: 'pending',  // 注意: 前端 askAndCreate 用的是 'running', 但反向链路用 'pending'
                               // 让前端能区分"外部派来未启动"和"自己启动了"
      html: '',
      error: '',
      tasks,
      created_at: ts,
      source: 'canvas-cli-bridge',  // 标记派单来源, 前端可据此决定要不要自动开 _runHtmlAnswer
    },
    width: null,
    height: null,
    parentNode: null,
    extent: null,
    hidden: false,
    draggable: true,
    selectable: true,
    style: null,
  }

  // ★ 关键: 必须先注册 observer 再 push, 否则丢首条事件
  let lastStatus = null
  r.refCount++

  const observer = (event) => {
    // 只关心本 nodeId 的 key
    if (!event.keysChanged.has(nodeId)) return
    const cur = r.nodesMap.get(nodeId)
    if (!cur) {
      // 节点被删了, watcher 退出
      finish('failed', { error: '节点被删除' })
      return
    }
    const status = cur.data?.taskStatus
    if (status === lastStatus) return
    const prev = lastStatus
    lastStatus = status

    // 边沿触发: pending→running, running→done, *→failed
    if (
      (prev === null && status === 'pending') ||
      (prev === 'pending' && status === 'running') ||
      (status === 'done' && prev !== 'done') ||
      (status === 'failed' && prev !== 'failed')
    ) {
      const payload = {
        node_id: nodeId,
        status,
        prompt: cur.data?.prompt || prompt,
        mode: cur.data?.mode || mode,
        room,
      }
      if (status === 'done') payload.html = cur.data?.html || ''
      if (status === 'failed') payload.error = cur.data?.error || ''
      postCallback(callback_url, callback_token, payload).catch(() => {})
    }

    if (status === 'done' || status === 'failed') {
      finish(status)
    }
  }

  function finish(_finalStatus) {
    r.observers.delete(observer)
    r.refCount = Math.max(0, r.refCount - 1)
    if (r.refCount === 0) releaseRoom(r)
  }

  r.observers.add(observer)

  // 现在推 — observer 已经注册, 不会丢事件
  r.ydoc.transact(() => {
    r.nodesMap.set(nodeId, node)
  }, 'cli-bridge')

  // 立即推一条 pending callback (可选 — 前端没看到节点也算 pending)
  postCallback(callback_url, callback_token, {
    node_id: nodeId,
    status: 'pending',
    prompt,
    mode,
    room,
  }).catch(() => {})

  return { node_id: nodeId, room }
}

// ───── 查询节点状态 ─────
function getNodeStatus(room, nodeId) {
  const r = getRoom(room)
  // 不增加 refCount — 这只是一次性查询
  const cur = r.nodesMap.get(nodeId)
  // 如果 room 是首次访问且没数据, 等一下 sync
  if (!cur) {
    return { exists: false }
  }
  return {
    exists: true,
    status: cur.data?.taskStatus || 'unknown',
    prompt: cur.data?.prompt || '',
    mode: cur.data?.mode || '',
    html: cur.data?.html || '',
    error: cur.data?.error || '',
    tasks: cur.data?.tasks || [],
  }
}

// ───── HTTP 路由 ─────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = u.pathname

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Canvas-Token')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  try {
    // ── /health ──
    if (pathname === '/health' && req.method === 'GET') {
      let watcherCount = 0
      for (const r of rooms.values()) watcherCount += r.refCount
      sendJson(res, 200, {
        ok: true,
        service: 'know-canvas-cli-bridge',
        version: VERSION,
        port: PORT,
        yws_url: YWS_URL,
        room_count: rooms.size,
        watcher_count: watcherCount,
        rooms: [...rooms.keys()],
      })
      return
    }

    // ── POST /api/submit ──
    if (pathname === '/api/submit' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const prompt = String(body.prompt || '').trim()
      if (!prompt) {
        sendJson(res, 400, { ok: false, error: '缺少 prompt' })
        return
      }
      const mode = body.mode === 'hermes' ? 'hermes' : 'meta'
      const room = String(body.room || DEFAULT_ROOM).trim()
      const callback_url = body.callback_url || null
      const callback_token = body.callback_token || null

      const { node_id } = await submitTask({ prompt, mode, room, callback_url, callback_token })
      const watchUrl = `https://ha2.digitalvio.shop/canvas/?room=${encodeURIComponent(room)}&focus=${encodeURIComponent(node_id)}`
      sendJson(res, 200, {
        ok: true,
        node_id,
        room,
        mode,
        watch_url: watchUrl,
      })
      return
    }

    // ── GET /api/status/:nodeId?room=... ──
    const m = pathname.match(/^\/api\/status\/([^/]+)$/)
    if (m && req.method === 'GET') {
      const nodeId = decodeURIComponent(m[1])
      const room = u.searchParams.get('room') || DEFAULT_ROOM
      const r = getRoom(room)
      // 如果 room 刚启用, 需要等 sync 才能看到已有节点
      await waitForSync(r.provider, 2000)
      const info = getNodeStatus(room, nodeId)
      if (!info.exists) {
        sendJson(res, 404, { ok: false, node_id: nodeId, room, error: 'node not found' })
        return
      }
      sendJson(res, 200, {
        ok: true,
        node_id: nodeId,
        room,
        status: info.status,
        prompt: info.prompt,
        mode: info.mode,
        html: info.html,
        error: info.error,
        tasks: info.tasks,
      })
      return
    }

    // ── GET /api/watch/:room (SSE 流式订阅, 给 know-canvas tail 用) ──
    const mw = pathname.match(/^\/api\/watch\/([^/]+)$/)
    if (mw && req.method === 'GET') {
      const room = decodeURIComponent(mw[1])
      const r = getRoom(room)
      r.refCount++
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      res.write(`event: hello\ndata: ${JSON.stringify({ room, ts: Date.now() })}\n\n`)

      const observer = (event) => {
        for (const key of event.keysChanged) {
          const cur = r.nodesMap.get(key)
          if (!cur || cur.type !== 'htmlPageNode') continue
          const data = {
            node_id: key,
            status: cur.data?.taskStatus,
            prompt: cur.data?.prompt,
            mode: cur.data?.mode,
            ts: Date.now(),
          }
          res.write(`event: change\ndata: ${JSON.stringify(data)}\n\n`)
        }
      }
      r.observers.add(observer)

      // 心跳
      const heartbeat = setInterval(() => {
        try { res.write(`: keepalive ${Date.now()}\n\n`) } catch (e) { /* ignore */ }
      }, 25000)

      const cleanup = () => {
        clearInterval(heartbeat)
        r.observers.delete(observer)
        r.refCount = Math.max(0, r.refCount - 1)
        if (r.refCount === 0) releaseRoom(r)
      }
      req.on('close', cleanup)
      req.on('error', cleanup)
      return
    }

    sendJson(res, 404, { ok: false, error: 'not found', path: pathname })
  } catch (err) {
    console.error('[cli-bridge] 请求处理异常:', err)
    sendJson(res, 500, { ok: false, error: err?.message || String(err) })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[cli-bridge] HTTP listening on http://${HOST}:${PORT}`)
})

// ───── 优雅退出 ─────
function shutdown(signal) {
  console.log(`\n[cli-bridge] ${signal} 收到, 关闭中...`)
  server.close(() => {
    for (const r of rooms.values()) {
      try { r.provider.destroy() } catch (e) { /* ignore */ }
      try { r.ydoc.destroy() } catch (e) { /* ignore */ }
    }
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5000)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
