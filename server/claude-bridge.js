/**
 * Claude CLI 本地桥
 *
 * 让前端浏览器通过 HTTP 调用本机的 claude CLI（用户自己的订阅）。
 * 启动: node server/claude-bridge.js
 * 端口: 18080（默认）
 *
 * API:
 *   GET  /health                 → { ok: true, hasClaude: bool }
 *   POST /chat
 *     body: { system?, prompt, model? }
 *     resp: { ok, text } 或 { ok: false, error }
 *
 * 重要：此服务**只应在用户本机**运行，不要部署到公网。
 *      它直接调用 `claude` CLI，等于给请求方完整的本地账号权限。
 *
 * CORS: 允许 localhost / 127.0.0.1 / file:// + 自定义域名（CLAUDE_BRIDGE_ALLOW_ORIGINS）
 */

const http = require('http')
const { spawn } = require('child_process')
const url = require('url')

const PORT = parseInt(process.env.CLAUDE_BRIDGE_PORT || '18080', 10)
const HOST = process.env.CLAUDE_BRIDGE_HOST || '127.0.0.1'
const DEFAULT_MODEL = process.env.CLAUDE_BRIDGE_MODEL || 'claude-sonnet-4-5-20250514'
const TIMEOUT_MS = parseInt(process.env.CLAUDE_BRIDGE_TIMEOUT || '120000', 10)

// 允许的 origin 白名单（同源协议下浏览器才能调）
const EXTRA_ORIGINS = (process.env.CLAUDE_BRIDGE_ALLOW_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)

function isAllowedOrigin(origin) {
  if (!origin) return true  // 同站请求
  if (origin === 'null') return true  // file://
  if (origin.startsWith('http://localhost')) return true
  if (origin.startsWith('http://127.0.0.1')) return true
  if (origin.startsWith('https://localhost')) return true
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
      if (buf.length > 4 * 1024 * 1024) {
        reject(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(buf || '{}')) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

/** 调用 claude CLI 子进程，返回文本输出 */
function callClaude({ system, prompt, model }) {
  return new Promise((resolve, reject) => {
    const m = model || DEFAULT_MODEL
    const args = ['-p', '--model', m, '--output-format', 'text']
    if (system) args.push('--system-prompt', system)

    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // Windows 上 claude 是 .cmd
    })

    let stdout = ''
    let stderr = ''
    let timer = null

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(new Error(`spawn claude 失败: ${err.message}（请确认 claude CLI 已安装且在 PATH）`))
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`claude CLI 退出码 ${code}: ${stderr.slice(-500)}`))
      }
    })

    timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`claude CLI 超时 ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    if (prompt) child.stdin.write(prompt)
    child.stdin.end()
  })
}

/** 检测 claude CLI 是否可用 */
function checkClaudeAvailable() {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    let ok = false
    child.on('error', () => resolve(false))
    child.on('exit', (code) => resolve(code === 0))
    setTimeout(() => {
      try { child.kill() } catch (_e) {}
      if (!ok) resolve(false)
    }, 5000)
  })
}

const server = http.createServer(async (req, res) => {
  setCors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const parsed = url.parse(req.url, true)
  const pathname = parsed.pathname

  if (pathname === '/health' && req.method === 'GET') {
    const hasClaude = await checkClaudeAvailable()
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, service: 'claude-cli-bridge', hasClaude, defaultModel: DEFAULT_MODEL }))
    return
  }

  if (pathname === '/chat' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req)
      const { system, prompt, model } = body
      if (!prompt || typeof prompt !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: '缺少 prompt 字段' }))
        return
      }
      const text = await callClaude({ system, prompt, model })
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, text }))
    } catch (err) {
      console.error('[claude-bridge] /chat 失败:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: err.message }))
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not Found\n')
})

server.listen(PORT, HOST, () => {
  console.log(`[claude-bridge] listening on http://${HOST}:${PORT}`)
  console.log(`[claude-bridge] default model: ${DEFAULT_MODEL}`)
  console.log('[claude-bridge] /health        健康检查')
  console.log('[claude-bridge] POST /chat     调用 claude CLI')
})

function shutdown(signal) {
  console.log(`\n[claude-bridge] ${signal}, shutting down...`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
