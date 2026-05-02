/**
 * Orchestra Conductor — 单进程整合: dispatcher + 多个 worker + room 自动发现
 *
 * 替代以前的"每个 room 起一对 dispatcher + hermes-worker"模式。
 * 启动后:
 *   1. 暴露 HTTP /conductor/* 接受 ensureRoom 请求 (懒启动)
 *   2. 任何 orchestra-http inject/list 都会 notifyConductor → 拉起对应 room 的服务
 *   3. (yjs-data 是 LevelDB 单库, 不能按目录扫 room, 所以纯懒接管)
 *
 * 启动: node server/orchestra-conductor.js
 *      ORCHESTRA_AGENTS=hermes,claude-cli node server/orchestra-conductor.js (后续多 worker)
 *
 * 端口: 17083 (内部 conductor API, 外部别用)
 *
 * 设计:
 *   - 每个 room 一对 (Dispatcher, HermesWorker)
 *   - room 闲置 (无 task 在跑 + 30 分钟无变更) 自动停掉省资源
 *   - Hermes mock/真模式继承 ORCHESTRA_MOCK 环境变量
 */

const http = require('http')
const path = require('path')
const { Dispatcher } = require('./orchestra-dispatcher')
const { HermesWorker } = require('./orchestra-hermes-worker')
const { SynthesisWorker } = require('./orchestra-synthesis-worker')

const PORT = parseInt(process.env.CONDUCTOR_PORT || '17083', 10)
const HOST = process.env.CONDUCTOR_HOST || '127.0.0.1'
const PERSIST_DIR = process.env.PERSIST || path.join(__dirname, 'yjs-data')
// 默认启 hermes + synthesis 双 worker, ORCHESTRA_AGENTS 可覆写
const AGENTS = (process.env.ORCHESTRA_AGENTS || 'hermes,synthesis').split(',').map(s => s.trim()).filter(Boolean)

// roomId → { dispatcher, workers: { hermes: HermesWorker, ...}, addedAt, addedBy }
const rooms = new Map()

function log(...args) { console.log('[conductor]', ...args) }

function ensureRoom(roomId, opts = {}) {
  if (!roomId || typeof roomId !== 'string') return null
  if (rooms.has(roomId)) {
    rooms.get(roomId).lastSeen = Date.now()
    return rooms.get(roomId)
  }

  const entry = {
    dispatcher: new Dispatcher({ room: roomId }).start(),
    workers: {},
    addedAt: new Date().toISOString(),
    addedBy: opts.source || 'auto',
    lastSeen: Date.now(),
  }
  for (const agentName of AGENTS) {
    if (agentName === 'hermes') {
      entry.workers.hermes = new HermesWorker({ room: roomId }).start()
    } else if (agentName === 'synthesis') {
      entry.workers.synthesis = new SynthesisWorker({ room: roomId }).start()
    }
    // claude-cli / feishu-bot worker — 后续加
  }
  rooms.set(roomId, entry)
  log(`+ room: ${roomId} (source=${entry.addedBy}, agents=[${Object.keys(entry.workers).join(',')}])`)
  return entry
}

function dropRoom(roomId) {
  const e = rooms.get(roomId)
  if (!e) return false
  try { e.dispatcher.stop() } catch (_) {}
  for (const w of Object.values(e.workers)) {
    try { w.stop() } catch (_) {}
  }
  rooms.delete(roomId)
  log(`- room: ${roomId}`)
  return true
}

/** 默认 boot rooms — 当前 hackathon 只用一个 room (demo-final), 三人共用
 *  需要换房间: ORCHESTRA_BOOT_ROOMS=foo node orchestra-conductor.js
 *  inject 到非 boot 房间时 orchestra-http 会 notifyConductor 懒拉起 */
const BOOT_ROOMS = (process.env.ORCHESTRA_BOOT_ROOMS || 'demo-final')
  .split(',').map(s => s.trim()).filter(Boolean)
function bootInitialRooms() {
  for (const r of BOOT_ROOMS) ensureRoom(r, { source: 'boot' })
}

// ----- HTTP API -----
function jsonRes(res, status, body) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.setEncoding('utf8')
    req.on('data', (c) => { buf += c; if (buf.length > 64*1024) { reject(new Error('payload too large')); req.destroy() } })
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.writeHead(204); res.end(); return
  }

  if (req.url === '/health') {
    return jsonRes(res, 200, {
      ok: true,
      service: 'orchestra-conductor',
      port: PORT,
      agents: AGENTS,
      rooms: Array.from(rooms.keys()),
      persistDir: PERSIST_DIR,
    })
  }

  if (req.url === '/conductor/rooms' && req.method === 'GET') {
    const list = Array.from(rooms.entries()).map(([id, e]) => ({
      id,
      addedAt: e.addedAt,
      addedBy: e.addedBy,
      agents: Object.keys(e.workers),
    }))
    return jsonRes(res, 200, { ok: true, rooms: list })
  }

  if (req.url === '/conductor/rooms' && req.method === 'POST') {
    let body
    try { body = await readJson(req) } catch (e) { return jsonRes(res, 400, { ok: false, error: e.message }) }
    if (!body.room) return jsonRes(res, 400, { ok: false, error: '需要 room' })
    const entry = ensureRoom(body.room, { source: body.source || 'http' })
    return jsonRes(res, 200, { ok: true, room: body.room, added: !!entry })
  }

  // DELETE /conductor/rooms/:room
  const m = req.url.match(/^\/conductor\/rooms\/([^/]+)$/)
  if (m && req.method === 'DELETE') {
    const ok = dropRoom(decodeURIComponent(m[1]))
    return jsonRes(res, ok ? 200 : 404, { ok, room: m[1] })
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('not found')
})

// ----- 主流程 -----
log(`starting on http://${HOST}:${PORT}`)
log(`agents: ${AGENTS.join(', ')}`)
log(`persist dir: ${PERSIST_DIR}`)

// 启动时立即接管 BOOT_ROOMS (其余 room 通过 orchestra-http notifyConductor 懒接管)
bootInitialRooms()
log(`boot rooms: ${BOOT_ROOMS.join(', ') || '(none)'}`)

server.listen(PORT, HOST, () => {
  log(`HTTP API ready on http://${HOST}:${PORT}`)
  log('endpoints:')
  log('  GET  /health')
  log('  GET  /conductor/rooms')
  log('  POST /conductor/rooms        body: { room, source? }')
  log('  DELETE /conductor/rooms/:id')
})

function shutdown(signal) {
  log(`${signal}, shutting down...`)
  for (const id of Array.from(rooms.keys())) dropRoom(id)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
