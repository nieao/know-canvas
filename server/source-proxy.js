/**
 * Source Proxy — 外部源中转服务 (飞书 / 得到 / Notion)
 *
 * 浏览器调用 /canvas/api/source/* (vite dev proxy / nginx 反代到 17090),
 * 这里 spawn 用户已装的本地 CLI 拿数据 (零 API key 配置, 复用 lark-cli auth).
 *
 * 端点:
 *   GET  /health
 *   POST /feishu/search  { query, pageSize? }       → { ok, results: [{title, summary, url, token, owner, updateTime}] }
 *   POST /feishu/fetch   { docUrl }                  → { ok, data: { title, content, ... } }
 *
 * (得到 / Notion 待 #9 #10 加)
 *
 * 启动: npm run sourceproxy   (port 17090)
 *       PORT=17090 node server/source-proxy.js
 *
 * 依赖: Node 18+ (内置 fetch/Express 替代用 http 模块自己写, 不引外部依赖)
 *       lark-cli 已 auth (用户已经 lark-cli auth login --as user)
 */

const http = require('http')
const { spawn } = require('child_process')

const PORT = parseInt(process.env.SOURCE_PROXY_PORT || '17090', 10)
const TIMEOUT_MS = parseInt(process.env.SOURCE_PROXY_TIMEOUT_MS || '20000', 10)
const LARK_BIN = process.env.LARK_CLI || (process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli')

function log(...args) {
  console.log('[source-proxy]', new Date().toISOString().slice(11, 19), ...args)
}

// Windows 下 spawn .cmd 必须经 cmd.exe /c (Node 18+ 安全策略)
function spawnLark(args) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/c', LARK_BIN, ...args], { windowsHide: true })
  }
  return spawn(LARK_BIN, args, { windowsHide: true })
}

// 跑 lark-cli, stdout 收集成 JSON 返回. 超时/非 0 退出抛错
function runLark(args) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const proc = spawnLark(args)
    const timer = setTimeout(() => {
      try { proc.kill() } catch {}
      reject(new Error(`lark-cli 超时 (${TIMEOUT_MS}ms): lark-cli ${args.join(' ')}`))
    }, TIMEOUT_MS)

    proc.stdout.on('data', (b) => { stdout += b.toString('utf8') })
    proc.stderr.on('data', (b) => { stderr += b.toString('utf8') })
    proc.on('error', (e) => { clearTimeout(timer); reject(e) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`lark-cli exit ${code}: ${stderr.slice(0, 400) || stdout.slice(0, 400)}`))
        return
      }
      try {
        const json = JSON.parse(stdout)
        resolve(json)
      } catch (e) {
        reject(new Error(`lark-cli 输出非 JSON: ${stdout.slice(0, 400)}`))
      }
    })
  })
}

// 读 request body (JSON), 限 1MB 防 DoS
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > 1024 * 1024) { req.destroy(); reject(new Error('body too large')); return }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) }
      catch (e) { reject(new Error('invalid JSON body: ' + e.message)) }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    // 允许浏览器直接调用 (vite dev proxy 之外的 fallback)
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(json)
}

// === 飞书 search → 把 lark-cli 原始结构压扁成对前端友好的 [{title, summary, url, ...}] ===
function compactFeishuResults(raw) {
  const list = raw?.data?.results || []
  return list.map((r) => {
    const meta = r.result_meta || {}
    // 标题 / 摘要含 <h>...</h> 高亮标签, 转成纯文本
    const stripH = (s) => String(s || '').replace(/<\/?h>/g, '')
    return {
      title: stripH(r.title_highlighted),
      summary: stripH(r.summary_highlighted).slice(0, 200),
      url: meta.url || '',
      token: meta.token || '',
      docType: meta.doc_types || '',
      entityType: r.entity_type || '',
      owner: meta.owner_name || '',
      updateTime: meta.update_time_iso || '',
    }
  }).filter((r) => r.title && r.url)
}

// === 飞书 fetch → 简化成 {title, content (markdown), tokens} ===
function compactFeishuFetch(raw) {
  const d = raw?.data || {}
  return {
    title: d.title || d.name || '',
    content: d.content || d.markdown || d.text || '',
    raw: d, // 保留原始, 给后续插件用
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const method = req.method

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  try {
    // ── /health ──
    if (method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, service: 'source-proxy', port: PORT, larkBin: LARK_BIN })
      return
    }

    // ── /feishu/search ──
    if (method === 'POST' && url.pathname === '/feishu/search') {
      const body = await readJsonBody(req)
      const query = String(body.query || '').trim()
      if (!query) { sendJson(res, 400, { ok: false, error: 'query 不能为空' }); return }
      const pageSize = Math.min(Math.max(parseInt(body.pageSize, 10) || 10, 1), 20)
      log(`feishu/search query="${query}" pageSize=${pageSize}`)
      const raw = await runLark(['docs', '+search', '--query', query, '--page-size', String(pageSize), '--format', 'json'])
      const results = compactFeishuResults(raw)
      sendJson(res, 200, { ok: true, results, total: raw?.data?.total || results.length })
      return
    }

    // ── /feishu/fetch ──
    if (method === 'POST' && url.pathname === '/feishu/fetch') {
      const body = await readJsonBody(req)
      const docUrl = String(body.docUrl || '').trim()
      if (!docUrl) { sendJson(res, 400, { ok: false, error: 'docUrl 不能为空' }); return }
      log(`feishu/fetch docUrl="${docUrl}"`)
      const raw = await runLark(['docs', '+fetch', '--doc', docUrl, '--format', 'json'])
      const data = compactFeishuFetch(raw)
      sendJson(res, 200, { ok: true, data })
      return
    }

    sendJson(res, 404, { ok: false, error: `unknown route: ${method} ${url.pathname}` })
  } catch (e) {
    log('error:', e?.message || e)
    sendJson(res, 500, { ok: false, error: e?.message || String(e) })
  }
})

server.listen(PORT, () => {
  log(`listening on http://0.0.0.0:${PORT}`)
  log(`endpoints: GET /health  POST /feishu/search  POST /feishu/fetch`)
  log(`lark-cli: ${LARK_BIN}`)
})

server.on('error', (e) => {
  log('server error:', e?.message || e)
  if (e.code === 'EADDRINUSE') {
    log(`port ${PORT} 被占用. 设 SOURCE_PROXY_PORT 换端口`)
    process.exit(1)
  }
})

// 优雅退出
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`收到 ${sig}, 关闭服务器`)
    server.close(() => process.exit(0))
  })
}
