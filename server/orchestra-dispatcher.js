/**
 * Orchestra Dispatcher — 调度器
 *
 * 单进程, 同时连接多个 room (默认从 ORCHESTRA_ROOMS 环境变量读, 逗号分隔)。
 *
 * 三件事:
 *   1. ready-set 计算: 把 agentMode='auto' && status='draft' 且 deps OK 的推到 status='pending'
 *   2. lease 超时回收: status='running' 且 leaseExpiresAt < now 的强制回 'pending'
 *   3. 简单环检测: 占位, 当前未实现 (P1)
 *
 * 启动:
 *   ORCHESTRA_ROOMS=demo-room,team-a npm run dispatcher
 *   或 node orchestra-dispatcher.js demo-room
 *
 * 设计参见 docs/orchestra-blackboard-spec.md §7
 */

const Y = require('yjs')
const { WebsocketProvider } = require('y-websocket')
const WS = require('ws')

const TICK_MS = 5 * 1000  // 每 5 秒扫一遍 (lease 超时 5 分钟, 5s 粒度足够)

class Dispatcher {
  /**
   * @param {object} opts
   * @param {string} opts.room
   * @param {string} [opts.wsUrl='ws://127.0.0.1:1234']
   */
  constructor(opts) {
    this.room = opts.room
    this.wsUrl = opts.wsUrl || process.env.ORCHESTRA_WS_URL || 'ws://127.0.0.1:1234'
    this.ydoc = new Y.Doc()
    this.provider = null
    this.nodesMap = null
    this.edgesMap = null
    this._timer = null
  }

  log(...args) {
    console.log(`[dispatcher:${this.room}]`, ...args)
  }

  start() {
    this.log(`connecting to ${this.wsUrl}`)
    this.provider = new WebsocketProvider(this.wsUrl, this.room, this.ydoc, {
      WebSocketPolyfill: WS,
      connect: true,
    })
    this.nodesMap = this.ydoc.getMap('nodes')
    this.edgesMap = this.ydoc.getMap('edges')

    this.provider.awareness.setLocalStateField('user', {
      name: 'dispatcher',
      color: '#aaaaaa',
      isAgent: true,
      isDispatcher: true,
    })

    this.provider.on('status', (e) => this.log('status:', e.status))

    this._timer = setInterval(() => this._tick(), TICK_MS)
    setTimeout(() => this._tick(), 1000)  // 启动后即扫一次
    this.log('started')
    return this
  }

  stop() {
    if (this._timer) clearInterval(this._timer)
    this._timer = null
    if (this.provider) {
      try { this.provider.destroy() } catch (_e) {}
    }
    this.log('stopped')
  }

  _tick() {
    try {
      this._reapExpiredLeases()
      this._promoteReady()
    } catch (e) {
      this.log('tick error:', e.message)
    }
  }

  /** §6 lease 超时回收 */
  _reapExpiredLeases() {
    const now = Date.now()
    const reaped = []
    this.ydoc.transact(() => {
      for (const [id, node] of this.nodesMap.entries()) {
        if (node?.type !== 'taskNode') continue
        const data = node.data
        if (!data) continue
        if (data.status !== 'running') continue
        const expires = data.leaseExpiresAt ? Date.parse(data.leaseExpiresAt) : null
        if (!expires || expires > now) continue
        // lease 过期了, reset
        this.nodesMap.set(id, {
          ...node,
          data: {
            ...data,
            status: 'pending',
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
            error: `lease expired at ${data.leaseExpiresAt} (was ${data.claimedBy})`,
          },
        })
        reaped.push(id)
      }
    }, 'dispatcher-reap-leases')
    if (reaped.length) this.log(`reaped ${reaped.length} expired lease(s):`, reaped)
  }

  /** §7 ready-set 计算: draft && agentMode=auto && deps done → pending */
  _promoteReady() {
    const promoted = []
    this.ydoc.transact(() => {
      // 先建 incoming-edge 索引: targetId → [sourceId]
      const incoming = new Map()
      for (const edge of this.edgesMap.values()) {
        if (!edge?.target || !edge?.source) continue
        if (!incoming.has(edge.target)) incoming.set(edge.target, [])
        incoming.get(edge.target).push(edge.source)
      }

      for (const [id, node] of this.nodesMap.entries()) {
        if (node?.type !== 'taskNode') continue
        const data = node.data
        if (!data) continue
        if (data.status !== 'draft') continue
        if (data.agentMode !== 'auto') continue
        if (!data.assignedTo) continue  // 没指定 worker, 没法跑

        // 检查所有上游 task 都 done
        const upstream = incoming.get(id) || []
        const allDone = upstream.every((srcId) => {
          const src = this.nodesMap.get(srcId)
          if (!src) return true                    // 上游不存在等同 done
          if (src.type !== 'taskNode') return true  // 非 task 节点不当依赖看
          return src.data?.status === 'done'
        })
        if (!allDone) continue

        this.nodesMap.set(id, {
          ...node,
          data: {
            ...data,
            status: 'pending',
            promotedAt: new Date().toISOString(),
          },
        })
        promoted.push(id)
      }
    }, 'dispatcher-promote-ready')
    if (promoted.length) this.log(`promoted ${promoted.length} to pending:`, promoted)
  }
}

// CLI 启动
if (require.main === module) {
  const roomsRaw = process.argv.slice(2).join(',') || process.env.ORCHESTRA_ROOMS || ''
  const rooms = roomsRaw.split(',').map((s) => s.trim()).filter(Boolean)
  if (rooms.length === 0) {
    console.error('Usage: node orchestra-dispatcher.js <room> [<room2> ...]')
    console.error('   or: ORCHESTRA_ROOMS=demo-room,team-a node orchestra-dispatcher.js')
    process.exit(1)
  }
  const dispatchers = rooms.map((room) => new Dispatcher({ room }).start())

  function shutdown(signal) {
    console.log(`\n[dispatcher] ${signal}, shutting down...`)
    dispatchers.forEach((d) => d.stop())
    setTimeout(() => process.exit(0), 500)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

module.exports = { Dispatcher }
