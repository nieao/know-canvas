// 补充探测: webhook / cron / kanban 高级端点 + 真假识别 (区分真 200 vs SPA fallback)
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const RECON_DIR = 'E:/claude code/know-canvas/.hermes-recon'
mkdirSync(RECON_DIR, { recursive: true })
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const LOG = join(RECON_DIR, `probe-extra-${ts}.log`)

const BASE = 'https://ha2.digitalvio.shop'
const USER = 'hermes'
const PASS = 'bdegDr5w4GfIqwEFH5+ZYMYK'
const UA = 'Mozilla/5.0 (compatible; know-canvas-recon/0.1)'
const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')

const lines = []
const log = (m) => { console.log(m); lines.push(m) }

const PATHS = [
  // 真假鉴别: SPA fallback vs 真 API
  '/api/plugins/kanban/assignees',          // 已知真 API
  '/api/plugins/kanban/webhooks',            // 探: 是否有 webhook
  '/api/plugins/kanban/callbacks',           // 探
  '/api/plugins/kanban/dispatch',            // 探: 派单
  '/api/plugins/kanban/tasks?limit=3',       // 探: 列任务
  '/api/cron/jobs',                          // 探: cron
  '/api/webhooks',                           // 探: 全局 webhook
  '/api/notifications/subscriptions',        // 探: 推送订阅
  '/api/plugins/kanban/board/stream',        // 探: 看板 stream
  '/.well-known/mcp',                        // MCP discover
  '/.well-known/openid-configuration',       // OIDC
  '/api/auth/token',                         // token endpoint
  '/api/me',                                 // 当前用户
]

log(`Hermes 补充探测  ${new Date().toISOString()}`)
log(`Base: ${BASE}\n`)

for (const path of PATHS) {
  const url = `${BASE}${path}`
  let r
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort('timeout'), 6000)
    r = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, 'Authorization': auth, 'Accept': 'application/json' },
      signal: ctrl.signal,
    })
    clearTimeout(t)
  } catch (e) {
    log(`❌ GET ${path.padEnd(45)} ERR ${e.message}`)
    continue
  }
  const ct = r.headers.get('content-type') || ''
  const text = await r.text()
  // 鉴别 SPA fallback: 200 + text/html + 包含 <!doctype html>
  const isSpaFallback = r.status === 200 && /<!doctype html>/i.test(text)
  // 鉴别真 API: JSON 响应
  const isJson = /application\/json/i.test(ct)

  let mark
  if (r.status === 401 || r.status === 403) mark = '🔒'
  else if (isSpaFallback) mark = '👻'  // 假 200, SPA fallback
  else if (r.status === 404) mark = '⚠'
  else if (r.status === 405) mark = '↪️'  // method not allowed (端点存在但不能 GET)
  else if (r.ok && isJson) mark = '✅'
  else mark = '❔'

  log(`${mark} GET ${path.padEnd(45)} ${String(r.status).padEnd(5)} ${ct.slice(0, 30)}`)
  if (isJson || (!isSpaFallback && text.length < 300)) {
    log(`   body: ${text.slice(0, 280).replace(/\n/g, ' ')}`)
  }
}

// 看 dispatch 是不是 POST
log(`\n--- POST 探测 ---`)
const postPaths = ['/api/plugins/kanban/dispatch', '/api/plugins/kanban/dispatch?dry_run=true&max=1']
for (const p of postPaths) {
  try {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort('timeout'), 6000)
    const r = await fetch(`${BASE}${p}`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Authorization': auth, 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctrl.signal,
    })
    const ct = r.headers.get('content-type') || ''
    const text = await r.text()
    log(`POST ${p.padEnd(50)} ${r.status} ${ct.slice(0, 30)}`)
    log(`   body: ${text.slice(0, 280).replace(/\n/g, ' ')}`)
  } catch (e) {
    log(`POST ${p.padEnd(50)} ERR ${e.message}`)
  }
}

writeFileSync(LOG, lines.join('\n') + '\n', 'utf8')
log(`\n日志: ${LOG}`)
