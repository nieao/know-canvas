/**
 * Orchestra Synthesis Worker — 抢 type=synthesisNode + assignedTo='synthesis' 的节点, 综合提议+反驳
 *
 * 启动:
 *   node orchestra-synthesis-worker.js demo-room
 *   ORCHESTRA_ROOMS=demo-room node orchestra-synthesis-worker.js
 *   ORCHESTRA_MOCK=1 node orchestra-synthesis-worker.js demo-room    # 强制 mock 模式
 *
 * 模式:
 *   - mock 模式 (默认): 等 3-5 秒, 从 yjs nodesMap 拉 source 节点, 输出固定结构的合成结果
 *   - 真模式: 暂不实现 (后端没有 LLM key, 真综合走前端浏览器内 LLM 调用)
 *
 * 注意:
 *   基类 OrchestraWorker._maybeClaim 默认只认 type=taskNode, 这里需要重写以放行 synthesisNode。
 *   设计参见 .plan/aletheia-team.md (Agent E)
 */

const { OrchestraWorker, sleep } = require('./orchestra-base')

// 默认开 mock — 后端没有 LLM key, 不强制设置环境变量也能跑
const FORCE_MOCK = process.env.ORCHESTRA_MOCK === '1' || !process.env.ALETHEIA_LLM_KEY

class SynthesisWorker extends OrchestraWorker {
  constructor(opts) {
    super({ name: 'synthesis', ...opts })
    this.mock = FORCE_MOCK
    if (this.mock) this.log('MOCK mode (后端无 LLM key, 走 mock 综合)')
  }

  /**
   * 重写认领条件: 只认 type=synthesisNode + assignedTo=synthesis + agentMode=auto + status=pending
   * 基类原版只认 taskNode, 我们需要放行 synthesisNode 这种新类型
   */
  async _maybeClaim(nodeId, node) {
    if (this._running.has(nodeId)) return
    if (!node || typeof node !== 'object') return
    const data = node.data
    if (!data) return
    if (node.type !== 'synthesisNode') return
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

  /**
   * 真正干活的方法
   * @param {{id: string, type: string, data: object, position: object}} node
   * @param {{reportProgress: Function}} ctx
   */
  async run(node, { reportProgress } = {}) {
    if (this.mock) return this._runMock(node, { reportProgress })
    // 留个口子, 后续接真 LLM 时替换
    return this._runMock(node, { reportProgress })
  }

  /** 拉 source 节点(提议+反驳)的简略信息 */
  _collectSources(node) {
    const data = node.data || {}
    const proposerIds = Array.isArray(data.sourceProposerIds) ? data.sourceProposerIds : []
    const refuterIds = Array.isArray(data.sourceRefuterIds) ? data.sourceRefuterIds : []
    const proposers = []
    const refuters = []
    for (const pid of proposerIds) {
      const n = this.nodesMap?.get(pid)
      if (n?.data) proposers.push({ id: pid, title: n.data.title || n.data.label || '(未命名提议)' })
    }
    for (const rid of refuterIds) {
      const n = this.nodesMap?.get(rid)
      if (n?.data) refuters.push({ id: rid, title: n.data.title || n.data.label || '(未命名反驳)' })
    }
    return { proposers, refuters, proposerIds, refuterIds }
  }

  /** mock 综合: 3-5 秒内分阶段推进度, 输出 actionPlan + healthScore + tokens */
  async _runMock(node, { reportProgress } = {}) {
    this.log(`[mock] synthesizing ${node.id}`)
    const { proposers, refuters } = this._collectSources(node)
    const totalMs = 3000 + Math.floor(Math.random() * 2000)  // 3-5s 随机
    const start = Date.now()

    // 阶段 1: synthesizing 起步
    reportProgress?.({ phase: 'synthesizing', etaMs: totalMs })

    // 在总时长内每秒推一次进度, 让前端能看到 ETA 倒数
    while (true) {
      const elapsed = Date.now() - start
      const remaining = totalMs - elapsed
      if (remaining <= 0) break
      await sleep(Math.min(1000, remaining))
      reportProgress?.({
        phase: 'synthesizing',
        etaMs: Math.max(0, totalMs - (Date.now() - start)),
      })
    }

    // 拼一个简单的 markdown 行动方案
    const proposerList = proposers.length
      ? proposers.map((p, i) => `${i + 1}. ${p.title}`).join('\n')
      : '(无提议节点)'
    const refuterList = refuters.length
      ? refuters.map((r, i) => `${i + 1}. ${r.title}`).join('\n')
      : '(无反驳节点)'

    const actionPlan = [
      '## 综合行动方案 (mock)',
      '',
      '### 提议来源',
      proposerList,
      '',
      '### 反驳来源',
      refuterList,
      '',
      '### 收敛建议',
      '- 在保留核心提议价值的前提下, 吸收主要反驳关切',
      '- 设定 1-2 个可验证的下一步行动',
      '- 预留回滚条件, 避免不可逆决策',
    ].join('\n')

    // mock healthScore 简单算法: 80 + (提议-反驳)*2, clamp 到 [60, 95]
    const rawScore = 80 + (proposers.length - refuters.length) * 2
    const healthScore = Math.max(60, Math.min(95, rawScore))

    return {
      ok: true,
      summary: `已综合 ${proposers.length} 提议 + ${refuters.length} 反驳`,
      result: {
        actionPlan,
        healthScore,
        sourceProposerCount: proposers.length,
        sourceRefuterCount: refuters.length,
        finishedAt: new Date().toISOString(),
      },
      tokens: {
        input: 200,
        output: 500,
        total: 700,
        model: 'mock-synthesis',
      },
    }
  }
}

// CLI 入口 — 模仿 hermes-worker 的写法
if (require.main === module) {
  const roomsRaw = process.argv.slice(2).join(',') || process.env.ORCHESTRA_ROOMS || ''
  const rooms = roomsRaw.split(',').map((s) => s.trim()).filter(Boolean)
  if (rooms.length === 0) {
    console.error('Usage: node orchestra-synthesis-worker.js <room> [<room2> ...]')
    console.error('   or: ORCHESTRA_ROOMS=demo-room node orchestra-synthesis-worker.js')
    process.exit(1)
  }
  const workers = rooms.map((room) => new SynthesisWorker({ room }).start())

  function shutdown(signal) {
    console.log(`\n[synthesis-worker] ${signal}, shutting down...`)
    workers.forEach((w) => w.stop())
    setTimeout(() => process.exit(0), 500)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

module.exports = { SynthesisWorker }
