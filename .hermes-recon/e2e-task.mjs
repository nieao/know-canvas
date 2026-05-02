// 端到端跑通测试: 直接 POST 一个 task → 立刻 dispatch → 轮询直到 done/failed/timeout
// 每步状态写到 .hermes-recon/e2e-<ts>.log + .hermes-recon/e2e-<ts>.ndjson
// 用法: node .hermes-recon/e2e-task.mjs [assignee] [title]

import { writeFileSync, appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const RECON = 'E:/claude code/know-canvas/.hermes-recon'
mkdirSync(RECON, { recursive: true })
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const LOG = join(RECON, `e2e-${ts}.log`)
const NDJSON = join(RECON, `e2e-${ts}.ndjson`)

const BASE = 'https://ha2.digitalvio.shop'
const USER = process.env.HERMES_USER || 'hermes'
const PASS = process.env.HERMES_PASS || 'bdegDr5w4GfIqwEFH5+ZYMYK'
const UA = 'Mozilla/5.0 (compatible; know-canvas-e2e/0.1)'
const ASSIGNEE = process.argv[2] || 'default'
const TITLE = process.argv[3] || 'e2e-' + ts.slice(11)

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')
const lines = []
const log = (m) => {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${m}`
  console.log(line); lines.push(line)
}
const flush = () => writeFileSync(LOG, lines.join('\n') + '\n', 'utf8')
const ndjson = (obj) => appendFileSync(NDJSON, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n', 'utf8')

async function call(method, path, body) {
  const start = Date.now()
  const headers = { 'User-Agent': UA, 'Authorization': auth, 'Accept': 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'
  let resp, text
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort('timeout'), 15000)
    resp = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal })
    clearTimeout(t)
    text = await resp.text()
  } catch (e) {
    const err = { method, path, ms: Date.now() - start, err: e.message }
    ndjson({ kind: 'fetch_err', ...err })
    log(`❌ ${method} ${path} ERR ${e.message}`)
    return { ok: false, err: e.message }
  }
  let data
  try { data = JSON.parse(text) } catch { data = text }
  const ms = Date.now() - start
  ndjson({ kind: 'fetch', method, path, status: resp.status, ms, body: data })
  return { ok: resp.ok, status: resp.status, data, ms }
}

log(`====== Hermes E2E 跑通测试 ======`)
log(`Base:     ${BASE}`)
log(`Assignee: ${ASSIGNEE}`)
log(`Title:    ${TITLE}`)
log(`日志:     ${LOG}`)
log(`NDJSON:   ${NDJSON}`)
log(``)

// step 0: 健康检查 + assignees 列表
log(`--- step 0: pre-check ---`)
const health = await call('GET', '/api/status')
log(`status: ${health.status} ${health.ok ? '✅' : '❌'} (${health.ms}ms)`)
if (health.ok) log(`  hermes_version=${health.data?.version}, gateway_running=${health.data?.gateway_running}, gateway_pid=${health.data?.gateway_pid}`)
const ass = await call('GET', '/api/plugins/kanban/assignees')
log(`assignees: ${ass.status} ${ass.ok ? '✅' : '❌'}`)
const assNames = (ass.data?.assignees || []).map(a => a.name)
log(`  workers: ${assNames.join(', ')}`)
if (!assNames.includes(ASSIGNEE)) {
  log(`❌ assignee '${ASSIGNEE}' 不在 worker 列表里, 终止`)
  flush()
  process.exit(1)
}

// step 1: 创建 task
log(``)
log(`--- step 1: 创建 task ---`)
const idem = `e2e-${ts}-${Math.random().toString(36).slice(2, 8)}`
const taskBody = {
  title: TITLE,
  body: '请回复一句话 "OK 我收到了, 这是 e2e 测试". 完成后请用 kanban_done 工具标记 task 状态.',
  assignee: ASSIGNEE,
  priority: 3,
  workspace_kind: 'scratch',
  idempotency_key: idem,
  max_runtime_seconds: 180,
}
log(`POST body: ${JSON.stringify(taskBody)}`)
const created = await call('POST', '/api/plugins/kanban/tasks', taskBody)
if (!created.ok) {
  log(`❌ 创建失败 ${created.status}: ${JSON.stringify(created.data).slice(0, 300)}`)
  flush()
  process.exit(2)
}
const taskId = created.data?.id || created.data?.task?.id
log(`✅ 创建成功 task_id=${taskId} (耗时 ${created.ms}ms)`)
log(`  返回: ${JSON.stringify(created.data).slice(0, 200)}`)

// step 2: 立刻 trigger dispatch
log(``)
log(`--- step 2: 主动 trigger dispatch ---`)
const disp = await call('POST', '/api/plugins/kanban/dispatch', {})
log(`dispatch: ${disp.status} ${disp.ok ? '✅' : '❌'}`)
if (disp.ok) {
  log(`  promoted=${disp.data?.promoted}, spawned=${JSON.stringify(disp.data?.spawned)}, skipped=${disp.data?.skipped_unassigned?.length || 0}`)
}

// step 3: 轮询
log(``)
log(`--- step 3: 轮询 task 状态 (1.5s × 最多 120 次 = 3 分钟) ---`)
let lastStatus = null
let finalStatus = null
let finalTask = null
const startPoll = Date.now()
for (let i = 0; i < 120; i++) {
  await new Promise(r => setTimeout(r, 1500))
  const r = await call('GET', `/api/plugins/kanban/tasks/${taskId}`)
  if (!r.ok) {
    log(`  poll #${i + 1} 失败 ${r.status}`)
    continue
  }
  const t = r.data?.task || r.data
  const status = t?.status
  if (status !== lastStatus) {
    const elapsed = ((Date.now() - startPoll) / 1000).toFixed(1)
    log(`  +${elapsed}s 状态变化: ${lastStatus || '(init)'} → ${status}`)
    lastStatus = status
  }
  if (status === 'done' || status === 'failed' || status === 'cancelled') {
    finalStatus = status
    finalTask = t
    break
  }
}

log(``)
log(`--- step 4: 最终结果 ---`)
if (!finalStatus) {
  log(`❌ TIMEOUT: 3 分钟内 task 没进入终态, 最后状态=${lastStatus}`)
  // 拉一次 log 看 worker 在干什么
  const tlog = await call('GET', `/api/plugins/kanban/tasks/${taskId}/log`)
  log(`task log (${tlog.status}):`)
  log(JSON.stringify(tlog.data, null, 2).slice(0, 2000))
  flush()
  process.exit(3)
}
log(`final status: ${finalStatus}`)
log(`耗时: ${((Date.now() - startPoll) / 1000).toFixed(1)}s`)
log(`完整 task: ${JSON.stringify(finalTask, null, 2).slice(0, 2000)}`)

// 拉 log
const tlog = await call('GET', `/api/plugins/kanban/tasks/${taskId}/log`)
log(``)
log(`task log (${tlog.status}):`)
log(JSON.stringify(tlog.data, null, 2).slice(0, 3000))

flush()
log(``)
log(finalStatus === 'done' ? `✅ E2E 通了!` : `⚠ task 进了 ${finalStatus}, 看 log 诊断`)
process.exit(finalStatus === 'done' ? 0 : 4)
