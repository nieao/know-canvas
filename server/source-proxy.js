/**
 * Source Proxy — 外部源中转服务 (飞书 / 得到 / Notion)
 *
 * 浏览器调用 /canvas/api/source/* (vite dev proxy / Caddy 反代到 17090),
 * 这里 spawn 用户已装的本地 CLI 拿数据 (零 API key 配置, 复用 lark-cli auth)
 * 或直接用 HTTP API (Notion 用 NOTION_TOKEN env var).
 *
 * 端点:
 *   GET  /health
 *   POST /feishu/search  { query, pageSize? }       → { ok, results: [{title, summary, url, token, owner, updateTime}] }
 *   POST /feishu/fetch   { docUrl }                  → { ok, data: { title, content, ... } }
 *   POST /notion/search  { query, pageSize? }        → { ok, results: [{title, url, id, lastEditedTime}] }
 *   POST /notion/fetch   { pageUrl | pageId }        → { ok, data: { title, content, blocks } }
 *   POST /feishu/fetch-meta { docUrl }               → { ok, data: { title?, remoteUpdatedAt, platform } }
 *   POST /notion/fetch-meta { pageUrl | pageId }     → { ok, data: { title?, remoteUpdatedAt, platform } }
 *   (fetch-meta 仅返回 update_time, 不拉正文 — 给 source-watch-sync 用; 详见 docs/source-watch-sync-spec.md)
 *
 * (得到 待 #9 后续加 — 需 getnote-cli)
 *
 * 启动: npm run sourceproxy   (port 17090)
 *       PORT=17090 node server/source-proxy.js
 *
 * 依赖: Node 18+ (内置 fetch / 不引外部依赖)
 *       lark-cli 已 auth (lark-cli auth login --as user)
 *       NOTION_TOKEN env var (从 ~/.claude/notion_config.json 拿)
 */

const http = require('http')
const { spawn } = require('child_process')

const PORT = parseInt(process.env.SOURCE_PROXY_PORT || '17090', 10)
const HOST = process.env.SOURCE_PROXY_HOST || '127.0.0.1'
const TIMEOUT_MS = parseInt(process.env.SOURCE_PROXY_TIMEOUT_MS || '20000', 10)
const LARK_BIN = process.env.LARK_CLI || (process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli')
const NOTION_TOKEN = process.env.NOTION_TOKEN || ''
const NOTION_VERSION = '2022-06-28'

function log(...args) {
  console.log('[source-proxy]', new Date().toISOString().slice(11, 19), ...args)
}

// === 轻量 fetch-meta 缓存 — 防 source-watch 高频拉拍服务端 ===
// 飞书 fetch-meta 比较贵 (要走 search 退化), 缓存 30s; Notion last_edited_time 也短缓存避免连点
// 容量 200, LRU 淘汰. 仅缓存成功结果, 失败不进缓存
const META_CACHE_TTL_MS = 30 * 1000
const META_CACHE_MAX = 200
const _metaCache = new Map() // key → { val, ts }
function metaCacheGet(key) {
  const hit = _metaCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.ts > META_CACHE_TTL_MS) {
    _metaCache.delete(key)
    return null
  }
  // LRU touch — 重新插入移到末尾
  _metaCache.delete(key)
  _metaCache.set(key, hit)
  return hit.val
}
function metaCacheSet(key, val) {
  if (_metaCache.size >= META_CACHE_MAX) {
    // 删最老 (Map 迭代序 = 插入序)
    const first = _metaCache.keys().next().value
    if (first) _metaCache.delete(first)
  }
  _metaCache.set(key, { val, ts: Date.now() })
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

// ─────────────────────────────────────────────────────────────────────────────
// Notion adapter — 直接 HTTP (无需 CLI), 用 NOTION_TOKEN 做 Bearer 认证
// ─────────────────────────────────────────────────────────────────────────────

// 从 URL 抽 32 char id (notion 页面 url: https://notion.so/{slug}-{32hex} 或 /{32hex})
function extractNotionId(input) {
  const s = String(input || '').trim()
  if (!s) return ''
  // 已经是 UUID 形式
  const uuidMatch = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  if (uuidMatch) return uuidMatch[0].toLowerCase()
  // 32 hex 紧凑形式
  const hexMatch = s.match(/([0-9a-f]{32})(?:[?#&]|$)/i)
  if (hexMatch) {
    const h = hexMatch[1].toLowerCase()
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
  }
  return ''
}

async function notionFetch(path, init = {}) {
  if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN 未配置 — 设环境变量 NOTION_TOKEN=ntn_...')
  const resp = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`notion ${resp.status}: ${txt.slice(0, 300)}`)
  }
  return resp.json()
}

// 取 page 的 plain title (从各种可能的 property)
function extractNotionTitle(page) {
  if (!page) return ''
  // database 页面: properties 里找 type='title' 的
  const props = page.properties || {}
  for (const k of Object.keys(props)) {
    const p = props[k]
    if (p?.type === 'title' && Array.isArray(p.title)) {
      return p.title.map((t) => t.plain_text || '').join('').trim()
    }
  }
  // 普通页面也可能有 title 在 properties.title
  return ''
}

// rich_text[] → 纯文本
function richToText(rt) {
  if (!Array.isArray(rt)) return ''
  return rt.map((t) => t.plain_text || '').join('')
}

// markdown-ish 文本 → Notion blocks (反向: 推送时用)
// 支持: # / ## / ### / - / 1. / > / ``` / 普通段落
function textToNotionBlocks(text) {
  if (!text) return []
  const blocks = []
  const lines = String(text).split(/\r?\n/)
  let inCode = false
  let codeBuf = []
  let codeLang = ''
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    // code fence
    if (line.startsWith('```')) {
      if (inCode) {
        blocks.push({
          object: 'block', type: 'code',
          code: { rich_text: [{ type: 'text', text: { content: codeBuf.join('\n').slice(0, 1900) } }], language: codeLang || 'plain text' },
        })
        inCode = false; codeBuf = []; codeLang = ''
      } else {
        inCode = true; codeLang = line.slice(3).trim().toLowerCase()
      }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    if (!line.trim()) continue
    // heading
    let m
    if ((m = line.match(/^(#{1,3})\s+(.+)$/))) {
      const level = m[1].length
      blocks.push({
        object: 'block', type: `heading_${level}`,
        [`heading_${level}`]: { rich_text: [{ type: 'text', text: { content: m[2].slice(0, 1900) } }] },
      })
      continue
    }
    if ((m = line.match(/^[-*]\s+(.+)$/))) {
      blocks.push({
        object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: m[1].slice(0, 1900) } }] },
      })
      continue
    }
    if ((m = line.match(/^\d+\.\s+(.+)$/))) {
      blocks.push({
        object: 'block', type: 'numbered_list_item',
        numbered_list_item: { rich_text: [{ type: 'text', text: { content: m[1].slice(0, 1900) } }] },
      })
      continue
    }
    if ((m = line.match(/^>\s+(.+)$/))) {
      blocks.push({
        object: 'block', type: 'quote',
        quote: { rich_text: [{ type: 'text', text: { content: m[1].slice(0, 1900) } }] },
      })
      continue
    }
    if (line.trim() === '---') {
      blocks.push({ object: 'block', type: 'divider', divider: {} })
      continue
    }
    // 默认: paragraph
    blocks.push({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: line.slice(0, 1900) } }] },
    })
  }
  // Notion API 一次最多 100 个 children
  return blocks.slice(0, 100)
}

// 拿数据库的 title 属性名 (不同库可能叫 Name / Title / 标题)
async function getNotionTitlePropName(databaseId) {
  const db = await notionFetch(`/databases/${databaseId}`)
  const props = db.properties || {}
  for (const k of Object.keys(props)) {
    if (props[k]?.type === 'title') return k
  }
  throw new Error(`数据库 ${databaseId} 没找到 title 属性`)
}

// blocks → markdown-like 文本 (支持 paragraph / heading / list / quote / code / divider)
function blocksToMarkdown(blocks) {
  if (!Array.isArray(blocks)) return ''
  const lines = []
  for (const b of blocks) {
    const t = b.type
    const d = b[t] || {}
    const txt = richToText(d.rich_text || d.text || [])
    switch (t) {
      case 'paragraph': lines.push(txt); break
      case 'heading_1': lines.push(`# ${txt}`); break
      case 'heading_2': lines.push(`## ${txt}`); break
      case 'heading_3': lines.push(`### ${txt}`); break
      case 'bulleted_list_item': lines.push(`- ${txt}`); break
      case 'numbered_list_item': lines.push(`1. ${txt}`); break
      case 'quote': lines.push(`> ${txt}`); break
      case 'code': lines.push('```' + (d.language || '') + '\n' + txt + '\n```'); break
      case 'divider': lines.push('---'); break
      case 'to_do': lines.push(`- [${d.checked ? 'x' : ' '}] ${txt}`); break
      case 'callout': lines.push(`> 💡 ${txt}`); break
      default: if (txt) lines.push(txt)
    }
  }
  return lines.join('\n\n')
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

    // ── /notion/search ──
    if (method === 'POST' && url.pathname === '/notion/search') {
      const body = await readJsonBody(req)
      const query = String(body.query || '').trim()
      if (!query) { sendJson(res, 400, { ok: false, error: 'query 不能为空' }); return }
      const pageSize = Math.min(Math.max(parseInt(body.pageSize, 10) || 10, 1), 20)
      log(`notion/search query="${query}" pageSize=${pageSize}`)
      const raw = await notionFetch('/search', {
        method: 'POST',
        body: JSON.stringify({
          query,
          page_size: pageSize,
          filter: { property: 'object', value: 'page' },
          sort: { direction: 'descending', timestamp: 'last_edited_time' },
        }),
      })
      const results = (raw.results || []).map((p) => ({
        id: p.id,
        title: extractNotionTitle(p) || '(无标题)',
        url: p.url || `https://www.notion.so/${(p.id || '').replace(/-/g, '')}`,
        lastEditedTime: p.last_edited_time || '',
        createdTime: p.created_time || '',
        objectType: p.object || 'page',
      })).filter((r) => r.id)
      sendJson(res, 200, { ok: true, results, total: results.length })
      return
    }

    // ── /notion/push ── 节点 → 创建一个 Notion 数据库页面
    //   入参: { databaseId, title, content (markdown-ish), sourceUrl? }
    //   响应: { ok, pageId, pageUrl }
    if (method === 'POST' && url.pathname === '/notion/push') {
      const body = await readJsonBody(req)
      const databaseId = String(body.databaseId || '').trim()
      const title = String(body.title || '').trim().slice(0, 200) || '(无标题)'
      const content = String(body.content || '')
      const sourceUrl = String(body.sourceUrl || '').trim()
      if (!databaseId) { sendJson(res, 400, { ok: false, error: 'databaseId 不能为空' }); return }
      log(`notion/push db=${databaseId.slice(0, 8)} title="${title.slice(0, 30)}" len=${content.length}`)
      const titleProp = await getNotionTitlePropName(databaseId)
      const properties = {
        [titleProp]: { title: [{ type: 'text', text: { content: title } }] },
      }
      const blocks = textToNotionBlocks(content)
      // 顶部加一个回链 paragraph (如果有 sourceUrl)
      if (sourceUrl) {
        blocks.unshift({
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [
            { type: 'text', text: { content: '↩ 来源: ' } },
            { type: 'text', text: { content: sourceUrl, link: { url: sourceUrl } } },
          ] },
        })
      }
      const created = await notionFetch('/pages', {
        method: 'POST',
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties,
          children: blocks.slice(0, 100),
        }),
      })
      sendJson(res, 200, {
        ok: true,
        pageId: created.id,
        pageUrl: created.url || '',
      })
      return
    }

    // ── /notion/fetch ──
    if (method === 'POST' && url.pathname === '/notion/fetch') {
      const body = await readJsonBody(req)
      const input = String(body.pageUrl || body.pageId || '').trim()
      if (!input) { sendJson(res, 400, { ok: false, error: 'pageUrl/pageId 不能为空' }); return }
      const pageId = extractNotionId(input)
      if (!pageId) { sendJson(res, 400, { ok: false, error: '无法从 URL 解析 page id (32 hex 或 UUID 格式)' }); return }
      log(`notion/fetch pageId="${pageId}"`)
      const [page, blocks] = await Promise.all([
        notionFetch(`/pages/${pageId}`),
        notionFetch(`/blocks/${pageId}/children?page_size=100`),
      ])
      const title = extractNotionTitle(page) || '(无标题)'
      const content = blocksToMarkdown(blocks.results || [])
      sendJson(res, 200, {
        ok: true,
        data: {
          title,
          content,
          pageId,
          url: page.url || '',
          lastEditedTime: page.last_edited_time || '',
        },
      })
      return
    }

    // ── /feishu/fetch-meta ── 仅取 update_time, 不拉正文 (source-watch 用)
    //   飞书没单 doc 查 update_time 的 OpenAPI, 退化用 search by 短关键词 (从 URL token 抽前 8 字符做 query)
    //   失败时退到 fetch (整篇拉) 拿 raw.update_time, 但代价大 — 用 LRU 30s 缓存平摊
    if (method === 'POST' && url.pathname === '/feishu/fetch-meta') {
      const body = await readJsonBody(req)
      const docUrl = String(body.docUrl || '').trim()
      if (!docUrl) { sendJson(res, 400, { ok: false, error: 'docUrl 不能为空' }); return }
      const cacheKey = `feishu:meta:${docUrl}`
      const cached = metaCacheGet(cacheKey)
      if (cached) { sendJson(res, 200, { ok: true, data: cached, cached: true }); return }
      log(`feishu/fetch-meta docUrl="${docUrl}" (cache miss)`)
      let remoteUpdatedAt = ''
      let title = ''
      // 策略 1: 从 URL 抽 token, 用 token 当 search query 命中自己
      const tokenMatch = docUrl.match(/\/([a-zA-Z0-9]{16,})(?:[?#]|$)/)
      const token = tokenMatch ? tokenMatch[1] : ''
      try {
        if (token) {
          const raw = await runLark(['docs', '+search', '--query', token, '--page-size', '5', '--format', 'json'])
          const list = raw?.data?.results || []
          // 找 result_meta.token === token 或 url === docUrl
          const hit = list.find((r) => {
            const mt = r.result_meta || {}
            return mt.token === token || (mt.url && mt.url.indexOf(token) >= 0)
          })
          if (hit) {
            remoteUpdatedAt = hit.result_meta?.update_time_iso || ''
            title = String(hit.title_highlighted || '').replace(/<\/?h>/g, '').trim()
          }
        }
        // 策略 2 fallback: 走 fetch 整篇 (贵, 但确保有 update_time)
        if (!remoteUpdatedAt) {
          const raw2 = await runLark(['docs', '+fetch', '--doc', docUrl, '--format', 'json'])
          const d = raw2?.data || {}
          remoteUpdatedAt = d.update_time_iso || d.update_time || d.updated_at || d.lastEditedTime || ''
          if (!title) title = d.title || d.name || ''
        }
        const data = { title, remoteUpdatedAt, platform: 'feishu' }
        if (remoteUpdatedAt) metaCacheSet(cacheKey, data)
        sendJson(res, 200, { ok: true, data })
      } catch (e) {
        sendJson(res, 200, { ok: false, error: `feishu fetch-meta 失败: ${e?.message || e}` })
      }
      return
    }

    // ── /notion/fetch-meta ── GET /pages/{id} 取 last_edited_time, 不拉 children blocks
    //   单次调用 ~80ms, 短缓存 (10s) 防连点
    if (method === 'POST' && url.pathname === '/notion/fetch-meta') {
      const body = await readJsonBody(req)
      const input = String(body.pageUrl || body.pageId || '').trim()
      if (!input) { sendJson(res, 400, { ok: false, error: 'pageUrl/pageId 不能为空' }); return }
      const pageId = extractNotionId(input)
      if (!pageId) { sendJson(res, 400, { ok: false, error: '无法从 URL 解析 page id' }); return }
      const cacheKey = `notion:meta:${pageId}`
      const cached = metaCacheGet(cacheKey)
      if (cached) { sendJson(res, 200, { ok: true, data: cached, cached: true }); return }
      log(`notion/fetch-meta pageId="${pageId}" (cache miss)`)
      try {
        const page = await notionFetch(`/pages/${pageId}`)
        const data = {
          title: extractNotionTitle(page) || '',
          remoteUpdatedAt: page.last_edited_time || '',
          platform: 'notion',
          pageId,
        }
        if (data.remoteUpdatedAt) metaCacheSet(cacheKey, data)
        sendJson(res, 200, { ok: true, data })
      } catch (e) {
        sendJson(res, 200, { ok: false, error: `notion fetch-meta 失败: ${e?.message || e}` })
      }
      return
    }

    sendJson(res, 404, { ok: false, error: `unknown route: ${method} ${url.pathname}` })
  } catch (e) {
    log('error:', e?.message || e)
    sendJson(res, 500, { ok: false, error: e?.message || String(e) })
  }
})

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}`)
  log(`endpoints: GET /health  POST /feishu/search|fetch|fetch-meta  POST /notion/search|fetch|fetch-meta|push`)
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
