/**
 * Orchestra Worker 基类 — Y.Doc client + observe + CAS 抢锁 + lease 心跳
 *
 * 让画布的 Y.Doc 成为多 agent 的共享黑板。任意 agent worker 继承这个基类，
 * 实现 run(node) 方法即可参与画布上的工作。
 *
 * 用法:
 *   const { OrchestraWorker } = require('./orchestra-base')
 *   class MyWorker extends OrchestraWorker {
 *     async run(node) { ... return { ok: true, result: '...' } }
 *   }
 *   new MyWorker({ name: 'my-agent', room: 'demo-room' }).start()
 *
 * 设计参见 docs/orchestra-blackboard-spec.md
 */

const Y = require('yjs')
const { WebsocketProvider } = require('y-websocket')
const WS = require('ws')

const DEFAULT_LEASE_MS = 5 * 60 * 1000      // 5 分钟
const HEARTBEAT_MS = 30 * 1000              // 30 秒续 lease
const SETTLE_MS = 100                       // CAS 二段确认延迟

class OrchestraWorker {
  /**
   * @param {object} opts
   * @param {string} opts.name - agent 名 (匹配 node.data.assignedTo)
   * @param {string} opts.room - 房间 ID
   * @param {string} [opts.wsUrl='ws://127.0.0.1:1234']
   * @param {number} [opts.leaseMs=300000]
   * @param {string} [opts.workerId] - 多副本时区分; 默认 name + 随机
   * @param {boolean} [opts.dryRun=false] - 不真跑, 只打印; debug 用
   */
  constructor(opts) {
    if (!opts?.name) throw new Error('OrchestraWorker: name 必填')
    if (!opts?.room) throw new Error('OrchestraWorker: room 必填')
    this.name = opts.name
    this.room = opts.room
    this.wsUrl = opts.wsUrl || process.env.ORCHESTRA_WS_URL || 'ws://127.0.0.1:1234'
    this.leaseMs = opts.leaseMs || DEFAULT_LEASE_MS
    this.workerId = opts.workerId || `${opts.name}-${Math.random().toString(36).slice(2, 8)}`
    this.dryRun = !!opts.dryRun

    this.ydoc = new Y.Doc()
    this.provider = null
    this.nodesMap = null
    this._observer = null
    this._heartbeats = new Map()  // nodeId → setInterval handle
    this._running = new Set()      // 正在跑的 nodeId 防重入
    this._stopped = false
  }

  log(...args) {
    console.log(`[orchestra:${this.name}:${this.workerId}]`, ...args)
  }

  warn(...args) {
    console.warn(`[orchestra:${this.name}:${this.workerId}]`, ...args)
  }

  /** 子类必须实现 — 真正干活的方法
   * @param {{id: string, data: object, position: object}} node
   * @returns {Promise<{ok: boolean, result?: any, error?: string, summary?: string}>}
   */
  async run(node) {
    throw new Error(`${this.name}: 未实现 run() — 子类必须重写`)
  }

  start() {
    this.log(`connecting to ${this.wsUrl} room=${this.room}`)
    this.provider = new WebsocketProvider(this.wsUrl, this.room, this.ydoc, {
      WebSocketPolyfill: WS,
      connect: true,
    })
    this.nodesMap = this.ydoc.getMap('nodes')

    // awareness 标记自己 (画布上能看见 worker 在线)
    this.provider.awareness.setLocalStateField('user', {
      name: `agent:${this.name}`,
      color: '#7c9eb2',
      isAgent: true,
      workerId: this.workerId,
    })

    this.provider.on('status', (e) => {
      this.log('status:', e.status)
    })

    this._observer = () => this._scan()
    this.nodesMap.observeDeep(this._observer)

    // 启动后立刻 scan 一次 (可能错过早就到位的 task)
    setTimeout(() => this._scan(), 500)

    this.log('started')
    return this
  }

  stop() {
    if (this._stopped) return
    this._stopped = true
    for (const h of this._heartbeats.values()) clearInterval(h)
    this._heartbeats.clear()
    if (this._observer && this.nodesMap) this.nodesMap.unobserveDeep(this._observer)
    if (this.provider) {
      try { this.provider.destroy() } catch (_e) {}
    }
    this.log('stopped')
  }

  _scan() {
    if (this._stopped) return
    for (const [nodeId, node] of this.nodesMap.entries()) {
      this._maybeClaim(nodeId, node)
    }
  }

  /** 检查是否符合"我可以抢"的条件, 是则进入 CAS 抢锁 */
  async _maybeClaim(nodeId, node) {
    if (this._running.has(nodeId)) return
    if (!node || typeof node !== 'object') return
    const data = node.data
    if (!data) return
    if (node.type !== 'taskNode') return
    // 排查时打开: ORCHESTRA_DEBUG_CLAIM=1 dump 每个 TaskNode 的 mode/assignee/status
    if (process.env.ORCHESTRA_DEBUG_CLAIM === '1') {
      this.log(`[debug] task ${nodeId}: agentMode=${data.agentMode} assignedTo=${data.assignedTo} status=${data.status} title=${(data.title || '').slice(0, 30)}`)
    }
    if (data.agentMode !== 'auto') return
    if (data.assignedTo !== this.name) return
    if (data.status !== 'pending') return

    const ok = await this._tryClaim(nodeId)
    if (!ok) return

    this._running.add(nodeId)
    this._startHeartbeat(nodeId)
    this._executeAndFinalize(nodeId).catch((err) => {
      this.warn(`run() crashed for ${nodeId}:`, err.message)
      this._finalize(nodeId, { ok: false, error: err.message })
    })
  }

  /** §5 CAS 抢锁: transact set + 100ms 二段确认 */
  async _tryClaim(nodeId) {
    let claimed = false
    this.ydoc.transact(() => {
      const fresh = this.nodesMap.get(nodeId)
      if (!fresh?.data) return
      if (fresh.data.status !== 'pending') return
      if (fresh.data.assignedTo !== this.name) return
      const now = Date.now()
      this.nodesMap.set(nodeId, {
        ...fresh,
        data: {
          ...fresh.data,
          status: 'running',
          claimedBy: this.workerId,
          claimedAt: new Date(now).toISOString(),
          claimedAtMs: now,
          leaseExpiresAt: new Date(now + this.leaseMs).toISOString(),
          progress: { phase: 'starting', elapsedMs: 0, updatedAt: now },
        },
      })
      claimed = true
    }, 'orchestra-worker-claim')

    if (!claimed) return false
    await sleep(SETTLE_MS)
    const settled = this.nodesMap.get(nodeId)
    if (settled?.data?.claimedBy !== this.workerId) {
      this.warn(`lost claim race on ${nodeId} to ${settled?.data?.claimedBy}`)
      return false
    }
    this.log(`claimed ${nodeId}`)  // 不印 title 避 Windows cmd GBK 渲染乱码
    return true
  }

  _startHeartbeat(nodeId) {
    if (this._heartbeats.has(nodeId)) return
    const h = setInterval(() => {
      const fresh = this.nodesMap.get(nodeId)
      if (fresh?.data?.claimedBy !== this.workerId || fresh?.data?.status !== 'running') {
        clearInterval(h)
        this._heartbeats.delete(nodeId)
        return
      }
      this.ydoc.transact(() => {
        const f2 = this.nodesMap.get(nodeId)
        if (f2?.data?.claimedBy !== this.workerId) return
        this.nodesMap.set(nodeId, {
          ...f2,
          data: {
            ...f2.data,
            leaseExpiresAt: new Date(Date.now() + this.leaseMs).toISOString(),
          },
        })
      }, 'orchestra-worker-heartbeat')
    }, HEARTBEAT_MS)
    this._heartbeats.set(nodeId, h)
  }

  _stopHeartbeat(nodeId) {
    const h = this._heartbeats.get(nodeId)
    if (h) clearInterval(h)
    this._heartbeats.delete(nodeId)
  }

  async _executeAndFinalize(nodeId) {
    const node = this.nodesMap.get(nodeId)
    if (!node) return

    if (this.dryRun) {
      this.log(`[dry] would run ${nodeId}`)
      await sleep(2000)
      this._finalize(nodeId, { ok: true, summary: 'dry-run ok' })
      return
    }

    let outcome
    try {
      // 给 run() 注入一个 reportProgress 回调供 worker 实时写状态到画布
      const reportProgress = (p) => this._writeProgress(nodeId, p)
      outcome = await this.run(node, { reportProgress })
      if (!outcome || typeof outcome !== 'object') {
        outcome = { ok: false, error: 'run() 返回非法 (要 {ok, result?, error?})' }
      }
    } catch (e) {
      outcome = { ok: false, error: e?.message || String(e) }
    }
    this._finalize(nodeId, outcome)
  }

  /** worker 内部调用: 把进度信息实时写到 TaskNode.data.progress
   * @param {string} nodeId
   * @param {{phase?: string, hermesStatus?: string, events?: number, etaMs?: number, tokens?: object, [k:string]: any}} patch
   */
  _writeProgress(nodeId, patch) {
    this.ydoc.transact(() => {
      const fresh = this.nodesMap.get(nodeId)
      if (!fresh?.data) return
      if (fresh.data.claimedBy !== this.workerId) return  // 已被他人接管, 不写
      const claimedAtMs = fresh.data.claimedAtMs || Date.parse(fresh.data.claimedAt || 0) || Date.now()
      const now = Date.now()
      const next = {
        ...(fresh.data.progress || {}),
        ...patch,
        elapsedMs: now - claimedAtMs,
        updatedAt: now,
      }
      this.nodesMap.set(nodeId, {
        ...fresh,
        data: { ...fresh.data, progress: next },
      })
    }, 'orchestra-worker-progress')
  }

  _finalize(nodeId, outcome) {
    this._stopHeartbeat(nodeId)
    this._running.delete(nodeId)
    this.ydoc.transact(() => {
      const fresh = this.nodesMap.get(nodeId)
      if (!fresh?.data) return
      // 只在仍是自己的 lease 下写; 若已被回收别覆盖
      if (fresh.data.claimedBy && fresh.data.claimedBy !== this.workerId) {
        this.warn(`finalize skipped: ${nodeId} no longer mine (claimedBy=${fresh.data.claimedBy})`)
        return
      }
      const finishedAtMs = Date.now()
      const claimedAtMs = fresh.data.claimedAtMs || Date.parse(fresh.data.claimedAt || 0) || finishedAtMs
      this.nodesMap.set(nodeId, {
        ...fresh,
        data: {
          ...fresh.data,
          status: outcome.ok ? 'done' : 'failed',
          result: outcome.result ?? fresh.data.result,
          summary: outcome.summary ?? fresh.data.summary,
          error: outcome.ok ? null : (outcome.error || 'unknown error'),
          finishedAt: new Date(finishedAtMs).toISOString(),
          finishedAtMs,
          totalElapsedMs: finishedAtMs - claimedAtMs,
          tokens: outcome.tokens || fresh.data.tokens || null,
          // 释放 lease 字段, 但保留 claimedBy/claimedAt 作为审计
          leaseExpiresAt: null,
          progress: { ...(fresh.data.progress || {}), phase: 'done', updatedAt: finishedAtMs, elapsedMs: finishedAtMs - claimedAtMs },
        },
      })
    }, 'orchestra-worker-finalize')

    // 自动建 ResultNode + edge (如果 outcome 有 result/summary)
    if (outcome.ok && (outcome.result || outcome.summary)) {
      this._createResultNode(nodeId, outcome)
    }

    this.log(`finalized ${nodeId} ok=${outcome.ok}`)
  }

  /** 自动建一个 ResultNode 接到 TaskNode 下方
   *
   *  Schema 兼容性: ResultNode UI 期望 snake_case (source_task_id, source_title, result, ...)
   *  并把 result 当字符串渲染。这里 result 若是对象会 JSON.stringify。
   *  同时保留 camelCase 镜像字段 (sourceTaskId/producedBy/summary) 给 orchestra-http 列表用。
   */
  _createResultNode(taskNodeId, outcome) {
    const taskNode = this.nodesMap.get(taskNodeId)
    if (!taskNode) return
    const resultId = `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const pos = taskNode.position || { x: 0, y: 0 }
    const finishedAt = new Date().toISOString()
    const resultText = (outcome.result == null)
      ? (outcome.summary || '')
      : (typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result, null, 2))
    const result = {
      id: resultId,
      type: 'resultNode',
      position: { x: pos.x, y: (pos.y || 0) + 200 },
      data: {
        // ResultNode UI 字段 (snake_case)
        source_task_id: taskNodeId,
        source_title: taskNode.data.title || '',
        task_id: taskNode.data.task_id || '',
        assignee: this.name,
        finished_at: finishedAt,
        result: resultText,
        // camelCase 镜像 (orchestra-http 列表 / 调试用)
        sourceTaskId: taskNodeId,
        producedBy: this.name,
        summary: outcome.summary || '',
        createdAt: finishedAt,
      },
    }
    this.ydoc.transact(() => {
      this.nodesMap.set(resultId, result)
      const edges = this.ydoc.getMap('edges')
      const edgeId = `e-${taskNodeId}-${resultId}`
      edges.set(edgeId, {
        id: edgeId,
        source: taskNodeId,
        target: resultId,
        type: 'default',
        animated: false,
        data: { producedBy: this.name },
      })
    }, 'orchestra-worker-create-result')
    this.log(`created result node ${resultId}`)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = { OrchestraWorker, sleep }
