/**
 * Hermes 中转代理 — 浏览器 → 本进程 → Hermes Kanban API
 *
 * 启动: node server/hermes-proxy.js
 * 端口: 17081 (默认)
 *
 * 作用:
 *   1. 凭据保管 — HERMES_USER/HERMES_PASS 走 process.env, 浏览器看不到
 *   2. 反爬绕过 — 浏览器 fetch 不让设 User-Agent, 这里能设
 *   3. CORS 白名单 — 只允许本机 know-canvas 访问
 *
 * API:
 *   GET  /health                          → { ok, hermes_reachable, gateway_running }
 *   POST /api/canvas/dispatch             → 创建一个 Hermes task
 *   GET  /api/canvas/task/:id             → 查 task 状态
 *   GET  /api/canvas/task/:id/log         → 查 task 日志
 *
 * Hermes API schema 已踩过的坑见 docs/INTEGRATION-NOTES.md.
 */

const http = require('http')
const url = require('url')

const PORT = parseInt(process.env.HERMES_PROXY_PORT || '17081', 10)
const HOST = process.env.HERMES_PROXY_HOST || '127.0.0.1'

const HERMES_BASE = (process.env.HERMES_BASE || 'https://ha2.digitalvio.shop').replace(/\/$/, '')
const HERMES_USER = process.env.HERMES_USER || ''
const HERMES_PASS = process.env.HERMES_PASS || ''
const HERMES_UA = process.env.HERMES_UA || 'Mozilla/5.0 (compatible; know-canvas-proxy/0.1)'

// CORS 白名单 — 仅本机 + 同一 VPS 子路径
const EXTRA_ORIGINS = (process.env.HERMES_PROXY_ALLOW_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)

function isAllowedOrigin(origin) {
  if (!origin) return true
  if (origin === 'null') return true
  if (origin.startsWith('http://localhost')) return true
  if (origin.startsWith('http://127.0.0.1')) return true
  if (origin.startsWith('https://localhost')) return true
  if (origin === 'https://ha2.digitalvio.shop') return true  // VPS subpath 部署
  return EXTRA_ORIGINS.includes(origin)
}

function setCors(req, res) {
  const origin = req.headers.origin
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }
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

/** 调 Hermes API, 自动加 Basic Auth + UA */
async function hermesCall(method, path, body = null) {
  if (!HERMES_USER || !HERMES_PASS) {
    throw new Error('HERMES_USER / HERMES_PASS 未配置 (请检查 .env / 环境变量)')
  }
  const auth = 'Basic ' + Buffer.from(`${HERMES_USER}:${HERMES_PASS}`).toString('base64')
  const headers = {
    'User-Agent': HERMES_UA,
    'Authorization': auth,
    'Accept': 'application/json',
  }
  let payload = undefined
  if (body !== null) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const resp = await fetch(`${HERMES_BASE}${path}`, { method, headers, body: payload })
  const text = await resp.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: resp.status, ok: resp.ok, data }
}

const server = http.createServer(async (req, res) => {
  setCors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const parsed = url.parse(req.url, true)
  const pathname = parsed.pathname

  // ----- /health -----
  if (pathname === '/health' && req.method === 'GET') {
    let reach = false
    let gateway = null
    let version = null
    let err = null
    try {
      const r = await hermesCall('GET', '/api/status')
      reach = r.ok
      if (r.ok && typeof r.data === 'object') {
        version = r.data.version
        gateway = r.data.gateway_running ?? r.data?.gateway?.running
      }
    } catch (e) { err = e.message }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      ok: true,
      service: 'know-canvas-hermes-proxy',
      port: PORT,
      hermes_base: HERMES_BASE,
      hermes_reachable: reach,
      hermes_version: version,
      gateway_running: gateway,
      err,
    }))
    return
  }

  // ----- POST /api/canvas/dispatch -----
  // body: { title, body, assignee?, priority? (1-5), max_runtime_seconds? }
  if (pathname === '/api/canvas/dispatch' && req.method === 'POST') {
    try {
      const b = await readJsonBody(req)
      if (!b.title || typeof b.title !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: '缺少 title' }))
        return
      }
      const idem = b.idempotency_key || `know-canvas-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const taskBody = {
        title: b.title,
        body: b.body || '',
        priority: typeof b.priority === 'number' ? b.priority : 3,
        workspace_kind: 'scratch',
        idempotency_key: idem,
        max_runtime_seconds: b.max_runtime_seconds || 600,
      }
      if (b.assignee) taskBody.assignee = b.assignee

      const r = await hermesCall('POST', '/api/plugins/kanban/tasks', taskBody)
      // Hermes POST 也嵌套在 .task — 解一层让前端简单
      const flat = (r.ok && typeof r.data === 'object' && r.data?.task) ? r.data.task : r.data
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: r.ok, status: r.status, task: flat }))
    } catch (e) {
      console.error('[hermes-proxy] dispatch err:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ----- GET /api/canvas/task/:id -----
  let m = pathname && pathname.match(/^\/api\/canvas\/task\/([^/]+)$/)
  if (m && req.method === 'GET') {
    try {
      const r = await hermesCall('GET', `/api/plugins/kanban/tasks/${encodeURIComponent(m[1])}`)
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' })
      // Hermes 单 task 响应嵌套在 .task — 解一层让前端简单
      const flat = (r.ok && typeof r.data === 'object' && r.data.task) ? r.data.task : r.data
      res.end(JSON.stringify({ ok: r.ok, status: r.status, task: flat }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ----- GET /api/canvas/task/:id/log -----
  m = pathname && pathname.match(/^\/api\/canvas\/task\/([^/]+)\/log$/)
  if (m && req.method === 'GET') {
    try {
      const r = await hermesCall('GET', `/api/plugins/kanban/tasks/${encodeURIComponent(m[1])}/log`)
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: r.ok, status: r.status, log: r.data }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not Found\n')
})

server.listen(PORT, HOST, () => {
  console.log(`[hermes-proxy] listening on http://${HOST}:${PORT}`)
  console.log(`[hermes-proxy] hermes base: ${HERMES_BASE}`)
  console.log(`[hermes-proxy] auth: ${HERMES_USER ? '(set)' : '(MISSING — set HERMES_USER/PASS in env)'}`)
})

function shutdown(signal) {
  console.log(`\n[hermes-proxy] ${signal}, shutting down...`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
