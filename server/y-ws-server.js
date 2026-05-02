/**
 * Know Canvas — Yjs WebSocket 同步服务器
 *
 * 启动: node server/y-ws-server.js
 *      node server/y-ws-server.js --port 1234 --host 0.0.0.0 --persist ./yjs-data
 *
 * 设计:
 *  - 内置 y-websocket 提供的 setupWSConnection（自动处理 sync / awareness 协议）
 *  - 房间隔离: 客户端连 ws://host:port/<room>，y-websocket 按 URL path 区分 doc
 *  - LevelDB 持久化（默认 ./yjs-data/）：服务器重启不丢画布
 *  - Token 鉴权: 设 KNOW_CANVAS_TOKEN 环境变量启用，客户端用 ?token= 参数
 *  - 优雅退出 SIGINT/SIGTERM
 */

const http = require('http')
const path = require('path')
const fs = require('fs')

// 解析参数
const args = process.argv.slice(2)
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback
}

const HOST = getArg('--host', process.env.HOST || '0.0.0.0')
const PORT = parseInt(getArg('--port', process.env.PORT || '1234'), 10)
const PERSIST_DIR = getArg('--persist', process.env.PERSIST || path.join(__dirname, 'yjs-data'))
const AUTH_TOKEN = (process.env.KNOW_CANVAS_TOKEN || '').trim()

// 依赖加载（兼容多种安装方式）
const WebSocket = require('ws')
let setupWSConnection
try {
  // y-websocket 1.x 提供 bin/utils.js
  setupWSConnection = require('y-websocket/bin/utils').setupWSConnection
} catch (e) {
  console.error('[y-ws] 无法加载 y-websocket/bin/utils:', e.message)
  console.error('请运行: cd server && npm install')
  process.exit(1)
}

// LevelDB 持久化（可选）
let persistence = null
try {
  if (PERSIST_DIR) {
    fs.mkdirSync(PERSIST_DIR, { recursive: true })
    const { LeveldbPersistence } = require('y-leveldb')
    persistence = new LeveldbPersistence(PERSIST_DIR)
    // 接入 y-websocket 的 setPersistence 钩子
    const { setPersistence } = require('y-websocket/bin/utils')
    setPersistence({
      bindState: async (docName, ydoc) => {
        const persistedYdoc = await persistence.getYDoc(docName)
        const newUpdates = require('yjs').encodeStateAsUpdate(ydoc)
        persistence.storeUpdate(docName, newUpdates)
        require('yjs').applyUpdate(ydoc, require('yjs').encodeStateAsUpdate(persistedYdoc))
        ydoc.on('update', update => persistence.storeUpdate(docName, update))
      },
      writeState: async () => Promise.resolve(),
    })
    console.log(`[y-ws] persistence enabled at ${PERSIST_DIR}`)
  }
} catch (e) {
  console.warn('[y-ws] 持久化未启用（缺 y-leveldb 或不可用）:', e.message)
  console.warn('  提示: cd server && npm install y-leveldb 可启用持久化')
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      service: 'know-canvas-yjs-sync',
      port: PORT,
      persist: !!persistence,
      auth: !!AUTH_TOKEN,
    }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('know-canvas y-ws-server ok\n')
})

const wss = new WebSocket.Server({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  // Token 鉴权
  if (AUTH_TOKEN) {
    try {
      const url = new URL(request.url, 'http://localhost')
      const token = url.searchParams.get('token') || request.headers['x-know-canvas-token']
      if (token !== AUTH_TOKEN) {
        console.warn('[y-ws] unauthorized:', url.pathname)
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
    } catch (e) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    setupWSConnection(ws, request, { gc: true })
  })
})

wss.on('connection', (conn, req) => {
  const url = new URL(req.url, 'http://localhost')
  console.log(`[y-ws] client connected: ${url.pathname}`)
})

server.listen(PORT, HOST, () => {
  console.log(`[y-ws] listening on ws://${HOST}:${PORT}`)
  if (AUTH_TOKEN) console.log('[y-ws] token auth: enabled')
})

// 优雅退出
function shutdown(signal) {
  console.log(`\n[y-ws] ${signal}, shutting down...`)
  wss.close()
  server.close(() => {
    if (persistence) persistence.destroy?.()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5000)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
