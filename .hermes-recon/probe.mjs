#!/usr/bin/env node
// Hermes 接口探测器 — 把所有可能的对接面 (REST / MCP / SSE / WS / CLI) 各探一次
// 每个端点的状态码、响应头、body、报错全部写到 .hermes-recon/probe-<timestamp>.log
// 用法: node .hermes-recon/probe.mjs [base_url]
//   base_url 默认 https://ha2.digitalvio.shop, 可传 http://localhost:9119 (本地 hermes)

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const RECON_DIR = 'E:/claude code/know-canvas/.hermes-recon'
mkdirSync(RECON_DIR, { recursive: true })

const BASE = (process.argv[2] || 'https://ha2.digitalvio.shop').replace(/\/$/, '')
const USER = process.env.HERMES_USER || 'hermes'
const PASS = process.env.HERMES_PASS || 'bdegDr5w4GfIqwEFH5+ZYMYK'
const UA = 'Mozilla/5.0 (compatible; know-canvas-recon/0.1)'

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const LOG = join(RECON_DIR, `probe-${ts}.log`)
const SUMMARY = join(RECON_DIR, `probe-${ts}-summary.json`)

const lines = []
const results = []
const log = (m) => { console.log(m); lines.push(m) }

const ENDPOINTS = [
  // === REST 已知 (验证基线) ===
  { group: 'REST 基线', method: 'GET', path: '/api/status', auth: true, expect: 200, note: '系统状态' },
  { group: 'REST 基线', method: 'GET', path: '/api/plugins/kanban/board', auth: true, expect: 200, note: '看板' },
  { group: 'REST 基线', method: 'GET', path: '/api/plugins/kanban/stats', auth: true, expect: 200, note: '统计' },
  { group: 'REST 基线', method: 'GET', path: '/api/plugins/kanban/assignees', auth: true, expect: 200, note: '可派 worker' },

  // === Profile / Skills (token-protected, 预期 401/403) ===
  { group: 'token-protected', method: 'GET', path: '/api/profiles', auth: true, note: 'profile 列表' },
  { group: 'token-protected', method: 'GET', path: '/api/skills', auth: true, note: 'skill 列表' },

  // === MCP 探测 ===
  { group: 'MCP', method: 'GET', path: '/mcp', auth: true, note: 'MCP 根' },
  { group: 'MCP', method: 'GET', path: '/api/mcp', auth: true, note: 'MCP API' },
  { group: 'MCP', method: 'GET', path: '/api/mcp/server', auth: true, note: 'MCP server' },
  { group: 'MCP', method: 'GET', path: '/api/mcp/tools', auth: true, note: 'MCP tools' },
  { group: 'MCP', method: 'POST', path: '/mcp/sse', auth: true, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, note: 'MCP SSE 探' },
  { group: 'MCP', method: 'POST', path: '/api/mcp/jsonrpc', auth: true, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, note: 'JSON-RPC 探' },

  // === SSE / WebSocket / 流式 ===
  { group: '流式', method: 'GET', path: '/api/events', auth: true, note: 'SSE 事件流' },
  { group: '流式', method: 'GET', path: '/api/stream', auth: true, note: '流' },
  { group: '流式', method: 'GET', path: '/sse', auth: true, note: 'SSE 根' },
  { group: '流式', method: 'GET', path: '/api/plugins/kanban/events', auth: true, note: 'kanban 事件流' },

  // === OpenAPI / 文档 ===
  { group: '文档', method: 'GET', path: '/openapi.json', auth: false, note: 'OpenAPI 规范' },
  { group: '文档', method: 'GET', path: '/api/openapi.json', auth: false, note: 'OpenAPI 备选' },
  { group: '文档', method: 'GET', path: '/docs', auth: false, note: 'Swagger UI' },
  { group: '文档', method: 'GET', path: '/api/docs', auth: false, note: 'Swagger 备选' },
  { group: '文档', method: 'GET', path: '/redoc', auth: false, note: 'ReDoc' },

  // === CLI / Hermes 自带工具入口 ===
  { group: 'CLI 接口', method: 'GET', path: '/api/cli', auth: true, note: 'CLI hint' },
  { group: 'CLI 接口', method: 'GET', path: '/api/version', auth: true, note: '版本' },
  { group: 'CLI 接口', method: 'GET', path: '/api/info', auth: true, note: '信息' },

  // === Plugin 列表 / 扩展点 ===
  { group: 'Plugin', method: 'GET', path: '/api/plugins', auth: true, note: '所有 plugin' },
  { group: 'Plugin', method: 'GET', path: '/api/plugins/list', auth: true, note: 'plugin 列表' },
]

function basicAuth() {
  return 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')
}

async function probe(ep) {
  const url = `${BASE}${ep.path}`
  const headers = { 'User-Agent': UA, 'Accept': 'application/json, text/event-stream, */*' }
  if (ep.auth) headers['Authorization'] = basicAuth()
  if (ep.body) headers['Content-Type'] = 'application/json'

  const startMs = Date.now()
  const result = {
    group: ep.group, method: ep.method, path: ep.path, note: ep.note,
    status: null, ok: false, ms: 0, contentType: null, bodyPreview: '',
    err: null, headers: {},
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort('timeout 8s'), 8000)
    const resp = await fetch(url, {
      method: ep.method,
      headers,
      body: ep.body ? JSON.stringify(ep.body) : undefined,
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    result.status = resp.status
    result.ok = resp.ok
    result.contentType = resp.headers.get('content-type') || ''
    // 收点关键 header
    for (const h of ['x-powered-by', 'server', 'access-control-allow-origin', 'mcp-session-id']) {
      const v = resp.headers.get(h)
      if (v) result.headers[h] = v
    }
    const text = await resp.text()
    result.bodyPreview = text.slice(0, 500)
    if (text.length > 500) result.bodyPreview += `\n  ... (+${text.length - 500} bytes)`
  } catch (e) {
    result.err = e.message || String(e)
  }
  result.ms = Date.now() - startMs
  return result
}

log(`============================================================`)
log(`Hermes 接口探测  ${new Date().toISOString()}`)
log(`Base:  ${BASE}`)
log(`Auth:  ${USER}:****`)
log(`UA:    ${UA}`)
log(`日志:  ${LOG}`)
log(`============================================================\n`)

let groupNow = ''
for (const ep of ENDPOINTS) {
  if (ep.group !== groupNow) {
    groupNow = ep.group
    log(`\n--- ${groupNow} ---`)
  }
  const r = await probe(ep)
  results.push(r)
  const tag = r.err ? `ERR(${r.err})` : `${r.status}`
  const okMark = r.err ? '❌' : (r.ok ? '✅' : (r.status === 401 || r.status === 403 ? '🔒' : '⚠'))
  log(`${okMark} ${ep.method.padEnd(4)} ${ep.path.padEnd(40)} ${tag.padEnd(20)} ${ep.note}`)
  if (r.contentType) log(`   content-type: ${r.contentType}`)
  if (Object.keys(r.headers).length) log(`   headers: ${JSON.stringify(r.headers)}`)
  if (r.bodyPreview && r.bodyPreview.length < 250) log(`   body: ${r.bodyPreview.replace(/\n/g, ' ')}`)
  else if (r.bodyPreview) log(`   body[${r.bodyPreview.length}b]: ${r.bodyPreview.slice(0, 200).replace(/\n/g, ' ')}...`)
}

// 汇总
const summary = {
  base: BASE, ts, total: results.length,
  ok: results.filter(r => r.ok).length,
  forbidden: results.filter(r => r.status === 401 || r.status === 403).length,
  notFound: results.filter(r => r.status === 404).length,
  errors: results.filter(r => r.err).length,
  byGroup: {},
}
for (const r of results) {
  summary.byGroup[r.group] ||= { ok: 0, forbidden: 0, notFound: 0, errors: 0, total: 0 }
  summary.byGroup[r.group].total++
  if (r.ok) summary.byGroup[r.group].ok++
  else if (r.status === 401 || r.status === 403) summary.byGroup[r.group].forbidden++
  else if (r.status === 404) summary.byGroup[r.group].notFound++
  else if (r.err) summary.byGroup[r.group].errors++
}

log(`\n============================================================`)
log(`总计 ${summary.total}: ✅${summary.ok}  🔒${summary.forbidden}  ⚠404=${summary.notFound}  ❌err=${summary.errors}`)
log(`分组:`)
for (const [g, s] of Object.entries(summary.byGroup)) {
  log(`  ${g.padEnd(20)}  ✅${s.ok}/${s.total}  🔒${s.forbidden}  ⚠404=${s.notFound}  ❌${s.errors}`)
}
log(`详细日志: ${LOG}`)
log(`JSON 汇总: ${SUMMARY}`)

writeFileSync(LOG, lines.join('\n') + '\n', 'utf8')
writeFileSync(SUMMARY, JSON.stringify({ summary, results }, null, 2), 'utf8')
