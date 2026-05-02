/**
 * Orchestra Hermes Worker — 抢"assignedTo='hermes'"的 TaskNode, 调 Hermes Kanban API 跑
 *
 * 启动:
 *   node orchestra-hermes-worker.js demo-room
 *   ORCHESTRA_ROOMS=demo-room node orchestra-hermes-worker.js
 *   ORCHESTRA_MOCK=1 node orchestra-hermes-worker.js demo-room    # 不真调 Hermes, 4s 后回 done
 *
 * 模式:
 *   - mock=1 (默认 if HERMES_USER 没设): 仅模拟, 不调真 Hermes API
 *   - mock=0: 真调 Hermes Kanban API, 走 idempotency_key 防重
 *
 * 设计参见 docs/orchestra-blackboard-spec.md §9
 */

const { OrchestraWorker, sleep } = require('./orchestra-base')
const { parseHermesLog, parseHermesSessionMeta } = require('./lib/hermes-log-parser')

const HERMES_BASE = (process.env.HERMES_BASE || 'https://ha2.digitalvio.shop').replace(/\/$/, '')
const HERMES_USER = process.env.HERMES_USER || ''
const HERMES_PASS = process.env.HERMES_PASS || ''
const HERMES_UA = process.env.HERMES_UA || 'Mozilla/5.0 (compatible; know-canvas-orchestra/0.1)'
const FORCE_MOCK = process.env.ORCHESTRA_MOCK === '1' || (!HERMES_USER && !HERMES_PASS)

const POLL_INTERVAL_MS = 5000
const POLL_MAX_TRIES = 120  // 5s × 120 = 10 分钟封顶 (lease 是 5 分钟会续约)

/** 从 Hermes task response 找 token 字段
 *  Hermes API 不一定固定字段名, 这里做兼容查找:
 *    task.metrics.{input_tokens, output_tokens, total_tokens}
 *    task.usage.{prompt, completion, total}
 *    task.events[].usage  (累积所有 LLM 调用)
 *  找不到就 null.
 */
function extractTokens(task) {
  if (!task || typeof task !== 'object') return null
  // 直接 metrics
  const m = task.metrics || task.usage
  if (m && typeof m === 'object') {
    const input = m.input_tokens ?? m.prompt_tokens ?? m.prompt ?? m.input ?? null
    const output = m.output_tokens ?? m.completion_tokens ?? m.completion ?? m.output ?? null
    const total = m.total_tokens ?? m.total ?? (input != null && output != null ? input + output : null)
    if (input != null || output != null || total != null) {
      return { input, output, total, model: task.model || m.model || null }
    }
  }
  // events 累积
  if (Array.isArray(task.events)) {
    let input = 0, output = 0, model = null
    let any = false
    for (const ev of task.events) {
      const u = ev?.usage || ev?.metrics || ev?.metadata?.usage
      if (!u) continue
      any = true
      input += Number(u.input_tokens ?? u.prompt_tokens ?? 0) || 0
      output += Number(u.output_tokens ?? u.completion_tokens ?? 0) || 0
      model = model || u.model || ev?.model
    }
    if (any) return { input, output, total: input + output, model }
  }
  return null
}

async function hermesCall(method, path, body = null) {
  const auth = 'Basic ' + Buffer.from(`${HERMES_USER}:${HERMES_PASS}`).toString('base64')
  const headers = {
    'User-Agent': HERMES_UA,
    'Authorization': auth,
    'Accept': 'application/json',
  }
  let payload
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

class HermesWorker extends OrchestraWorker {
  constructor(opts) {
    super({ name: 'hermes', ...opts })
    this.mock = FORCE_MOCK
    if (this.mock) this.log('MOCK mode (not calling real Hermes)')
  }

  async run(node, ctx = {}) {
    if (this.mock) return this._runMock(node, ctx)
    return this._runReal(node, ctx)
  }

  async _runMock(node, { reportProgress } = {}) {
    this.log(`[mock] running ${node.id}`)
    const ETA_MS = 4000
    reportProgress?.({ phase: 'mock-running', etaMs: ETA_MS, hermesStatus: 'mock' })
    // 4 秒里每秒推一次进度
    for (let i = 0; i < 4; i++) {
      await sleep(1000)
      reportProgress?.({ phase: 'mock-running', etaMs: ETA_MS - (i + 1) * 1000, hermesStatus: 'mock' })
    }
    return {
      ok: true,
      summary: `[mock] hermes 已模拟完成: ${node.data.title || ''}`,
      result: {
        mock: true,
        title: node.data.title,
        body: node.data.body,
        finishedAt: new Date().toISOString(),
      },
      // mock 假 token 数 — 让 UI 能渲染
      tokens: { input: 256, output: 384, total: 640, model: 'mock-claude-opus' },
    }
  }

  async _runReal(node, { reportProgress } = {}) {
    const idem = `orchestra-${node.id}-v${node.data.rev || 1}`
    const taskBody = {
      title: node.data.title || '(untitled task from canvas)',
      body: node.data.body || '',
      priority: typeof node.data.priority === 'number' ? node.data.priority : 3,
      workspace_kind: 'scratch',
      idempotency_key: idem,
      max_runtime_seconds: node.data.max_runtime_seconds || 600,
    }
    if (node.data.hermesAssignee) taskBody.assignee = node.data.hermesAssignee

    reportProgress?.({ phase: 'creating', hermesStatus: null })
    this.log(`creating hermes task for ${node.id} (idem=${idem})`)
    const created = await hermesCall('POST', '/api/plugins/kanban/tasks', taskBody)
    if (!created.ok) {
      return { ok: false, error: `hermes create failed: ${created.status} ${JSON.stringify(created.data).slice(0, 200)}` }
    }
    const taskId = created.data?.task?.id || created.data?.id
    if (!taskId) return { ok: false, error: 'hermes 返回缺 task.id' }

    this.log(`hermes task created: ${taskId}, polling...`)
    reportProgress?.({ phase: 'polling', hermesStatus: 'ready', hermesTaskId: taskId, etaMs: 120_000 })

    // 立刻 trigger 一次 dispatch — ready→running 时间从 ~5s 降到 ~200ms
    hermesCall('POST', '/api/plugins/kanban/dispatch', {}).catch((e) => {
      this.warn(`dispatch trigger 失败 (容错): ${e.message}`)
    })

    for (let i = 0; i < POLL_MAX_TRIES; i++) {
      await sleep(POLL_INTERVAL_MS)
      const r = await hermesCall('GET', `/api/plugins/kanban/tasks/${taskId}`)
      if (!r.ok) {
        this.warn(`poll failed (${r.status}), retrying`)
        continue
      }
      const t = r.data?.task || r.data
      const status = t?.status
      const events = Array.isArray(t?.events) ? t.events.length : null
      // 实时累积的 token (Hermes 在 events 或 metrics 上若有就抓)
      const tokens = extractTokens(t)
      reportProgress?.({
        phase: status === 'running' ? 'running' : status,
        hermesStatus: status,
        hermesTaskId: taskId,
        events,
        tokens,
      })

      if (['done', 'completed', 'success'].includes(status)) {
        // task.result 在 hermes 里基本永远是 null, worker 真正输出在 task log 里.
        // 拉一次 log + parse 出最后一个 ⚕ Hermes ─...╯ 块, 这是 worker 的最终回答.
        let workerOutput = null
        let sessionMeta = {}
        try {
          const lr = await hermesCall('GET', `/api/plugins/kanban/tasks/${taskId}/log`)
          if (lr.ok && lr.data?.content) {
            workerOutput = parseHermesLog(lr.data.content)
            sessionMeta = parseHermesSessionMeta(lr.data.content)
            this.log(`worker 输出长度=${workerOutput?.length || 0}, session=${sessionMeta.sessionId || 'n/a'}`)
          } else {
            this.warn(`拉 log 失败 ${lr.status}, 用 fallback`)
          }
        } catch (e) {
          this.warn(`拉 log 异常: ${e.message}`)
        }

        // 给 ResultNode 直接渲染字符串 (base._createResultNode 看 outcome.result 类型 —
        // 字符串就直接写, 对象会 JSON.stringify 害用户看一坨 JSON).
        // 优先级: parse 出的 worker 输出 > task.result > task.summary > 占位
        const finalText = workerOutput
          || (typeof t?.result === 'string' ? t.result : null)
          || t?.summary
          || `(hermes task ${taskId} 完成, 但没拉到输出文本)`
        return {
          ok: true,
          summary: workerOutput?.slice(0, 80) || t?.summary || `hermes task ${taskId} 完成`,
          result: finalText,
          tokens,
          // 元信息塞到 outcome 顶层 (base 暂不消费, 留作日后扩展)
          meta: {
            hermes_task_id: taskId,
            session: sessionMeta,
            events,
          },
        }
      }
      if (['failed', 'cancelled', 'error'].includes(status)) {
        return { ok: false, error: `hermes task ${taskId} status=${status}`, tokens }
      }
    }
    return { ok: false, error: `polling timed out after ${POLL_MAX_TRIES} tries (~${POLL_MAX_TRIES * POLL_INTERVAL_MS / 1000}s)` }
  }
}

if (require.main === module) {
  const roomsRaw = process.argv.slice(2).join(',') || process.env.ORCHESTRA_ROOMS || ''
  const rooms = roomsRaw.split(',').map((s) => s.trim()).filter(Boolean)
  if (rooms.length === 0) {
    console.error('Usage: node orchestra-hermes-worker.js <room> [<room2> ...]')
    console.error('   or: ORCHESTRA_ROOMS=demo-room node orchestra-hermes-worker.js')
    process.exit(1)
  }
  const workers = rooms.map((room) => new HermesWorker({ room }).start())

  function shutdown(signal) {
    console.log(`\n[hermes-worker] ${signal}, shutting down...`)
    workers.forEach((w) => w.stop())
    setTimeout(() => process.exit(0), 500)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

module.exports = { HermesWorker }
