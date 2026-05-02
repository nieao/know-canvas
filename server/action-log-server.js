/**
 * Action Log Server — 用户行为日志收集服务
 *
 * 接收前端 LeftPanel / RightPanel 的用户动作，按天追加写入 logs/actions-YYYYMMDD.jsonl
 * 启动: node server/action-log-server.js
 * 端口: 18091（默认，ACTION_LOG_PORT 环境变量可覆盖）
 *
 * API:
 *   GET  /health        → { ok: true, service: 'action-log', logFile }
 *   POST /log           → 追加 jsonl，body: { name, payload, room, user, ts? }
 *   GET  /tail?n=50     → 返回当天最近 N 行
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const url = require('url')

const PORT = parseInt(process.env.ACTION_LOG_PORT || '18091', 10)
const HOST = process.env.ACTION_LOG_HOST || '127.0.0.1'
const LOG_DIR = path.join(process.cwd(), 'logs')
fs.mkdirSync(LOG_DIR, { recursive: true })

/** 当天 jsonl 文件路径 */
function todayLogFile() {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return path.join(LOG_DIR, `actions-${stamp}.jsonl`)
}

/** CORS：允许 localhost / 127.0.0.1 / file:// / 同源 */
function setCors(req, res) {
  const origin = req.headers.origin
  let allow = '*'
  if (origin === 'null') allow = 'null'
  else if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin)) allow = origin
  res.setHeader('Access-Control-Allow-Origin', allow)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.setEncoding('utf8')
    req.on('data', (c) => { buf += c; if (buf.length > 1024 * 1024) { reject(new Error('payload too large')); req.destroy() } })
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  setCors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  const parsed = url.parse(req.url, true)
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }

  if (parsed.pathname === '/health' && req.method === 'GET') {
    return send(200, { ok: true, service: 'action-log', logFile: path.relative(process.cwd(), todayLogFile()).replace(/\\/g, '/') })
  }

  if (parsed.pathname === '/log' && req.method === 'POST') {
    try {
      const { name, payload, room, user, ts } = (await readJsonBody(req)) || {}
      if (!name || typeof name !== 'string') return send(400, { ok: false, error: '缺少 name 字段' })
      const record = { ts: ts || new Date().toISOString(), name, room: room || '', user: user || '', payload: payload || {} }
      fs.appendFileSync(todayLogFile(), JSON.stringify(record) + '\n', 'utf8')
      return send(200, { ok: true })
    } catch (err) {
      console.error('[action-log] /log 写入失败:', err.message)
      return send(500, { ok: false, error: err.message })
    }
  }

  if (parsed.pathname === '/tail' && req.method === 'GET') {
    try {
      const n = Math.min(parseInt(parsed.query.n || '50', 10) || 50, 1000)
      const file = todayLogFile()
      const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n) : []
      return send(200, { ok: true, count: lines.length, lines: lines.map((l) => { try { return JSON.parse(l) } catch { return { raw: l } } }) })
    } catch (err) {
      return send(500, { ok: false, error: err.message })
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not Found\n')
})

server.listen(PORT, HOST, () => {
  console.log(`[action-log] 监听 http://${HOST}:${PORT}`)
  console.log(`[action-log] 当天日志: ${path.relative(process.cwd(), todayLogFile())}`)
  console.log('[action-log] GET  /health   POST /log   GET /tail?n=50')
})

function shutdown(signal) {
  console.log(`\n[action-log] 收到 ${signal}，正在关闭...`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
