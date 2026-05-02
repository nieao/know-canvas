/**
 * Aletheia Synthesis Worker — 测试 mock 逻辑
 *
 * 验证目标:
 *   - SynthesisWorker.run() 在 mock 模式下能正确返回 actionPlan / healthScore / tokens
 *   - 进度回调 reportProgress 被多次触发, etaMs 有合理倒数
 *   - source 节点查找逻辑生效 (从 mock nodesMap 拿到 proposers/refuters)
 *
 * 实现路线说明:
 *   原本想走 orchestra-http POST /api/orchestra/inject 流程, 但当前 orchestra-http
 *   inject 接口默认创建 type=taskNode, 不支持 synthesisNode (已知 gap)。
 *   待 orchestra-http 增加 type 字段后, 启用文件底部 skipped 的真集成 spec。
 *
 *   现阶段直接 import SynthesisWorker, new 一个实例, 跑 worker.run(mockNode), 测纯逻辑。
 *
 * 跑法:
 *   npx playwright test e2e/aletheia-synthesis.spec.js
 */

import { test, expect } from '@playwright/test'

// 直接 import worker (这是 Node CommonJS 模块, playwright 跑 ESM spec 用 require 拿)
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { SynthesisWorker } = require('../server/orchestra-synthesis-worker.js')

/**
 * 构造一个 mock 的 yjs nodesMap — 只需要 .get(id) 接口
 * 真实 SynthesisWorker 在 _collectSources 里只调用 this.nodesMap.get(pid)
 */
function buildMockNodesMap(entries) {
  const map = new Map(entries)
  return {
    get: (id) => map.get(id),
  }
}

test.describe('SynthesisWorker (mock 模式)', () => {
  test('run() 应输出包含 actionPlan + healthScore + tokens 的合成结果', async () => {
    test.setTimeout(20_000)

    // 1. 构造一个 SynthesisWorker (强制 mock — 因为没设 ALETHEIA_LLM_KEY)
    //    不调 .start() — 不连真 yjs ws, 直接调 run()
    const worker = new SynthesisWorker({ room: 'unit-test-room' })
    // 注入 mock nodesMap, 让 _collectSources 能找到 source 节点
    worker.nodesMap = buildMockNodesMap([
      ['p-1', { type: 'ontologyNode', data: { title: '提议 A: 上线灰度' } }],
      ['p-2', { type: 'ontologyNode', data: { title: '提议 B: 全量切流' } }],
      ['r-1', { type: 'challengeNode', data: { title: '反驳 1: 缺乏回滚预案' } }],
    ])

    // 2. 构造一个 mock synthesisNode (worker.run 拿 node.data 上的 source ids)
    const mockNode = {
      id: 'syn-test-1',
      type: 'synthesisNode',
      position: { x: 0, y: 0 },
      data: {
        sourceProposerIds: ['p-1', 'p-2'],
        sourceRefuterIds: ['r-1'],
        agentMode: 'auto',
        assignedTo: 'synthesis',
        status: 'pending',
      },
    }

    // 3. 收集进度回调, 验证至少触发了 1 次且带 etaMs
    const progressEvents = []
    const reportProgress = (p) => progressEvents.push(p)

    // 4. 跑 worker.run
    const t0 = Date.now()
    const outcome = await worker.run(mockNode, { reportProgress })
    const elapsed = Date.now() - t0

    // 5. 断言基础结构
    expect(outcome).toBeTruthy()
    expect(outcome.ok).toBe(true)
    expect(outcome.summary).toContain('已综合')
    expect(outcome.summary).toContain('2')  // 2 提议
    expect(outcome.summary).toContain('1')  // 1 反驳

    // 6. 断言 result 字段
    expect(outcome.result).toBeTruthy()
    expect(typeof outcome.result.actionPlan).toBe('string')
    expect(outcome.result.actionPlan).toContain('综合行动方案')  // mock 里固定有此关键字
    expect(outcome.result.actionPlan).toContain('提议 A')        // source 提议被引用
    expect(outcome.result.actionPlan).toContain('反驳 1')        // source 反驳被引用
    expect(typeof outcome.result.healthScore).toBe('number')
    expect(outcome.result.healthScore).toBeGreaterThanOrEqual(60)
    expect(outcome.result.healthScore).toBeLessThanOrEqual(95)
    expect(outcome.result.sourceProposerCount).toBe(2)
    expect(outcome.result.sourceRefuterCount).toBe(1)

    // 7. 断言 tokens 字段
    expect(outcome.tokens).toBeTruthy()
    expect(typeof outcome.tokens.input).toBe('number')
    expect(typeof outcome.tokens.output).toBe('number')
    expect(typeof outcome.tokens.total).toBe('number')
    expect(outcome.tokens.model).toBe('mock-synthesis')

    // 8. 断言耗时落在 mock 设定的 3-5 秒区间 (允许 ±500ms 误差)
    expect(elapsed).toBeGreaterThanOrEqual(2500)
    expect(elapsed).toBeLessThanOrEqual(5500)

    // 9. 断言进度事件至少触发了几次, 且 etaMs 在递减
    expect(progressEvents.length).toBeGreaterThanOrEqual(2)
    expect(progressEvents[0].phase).toBe('synthesizing')
    expect(typeof progressEvents[0].etaMs).toBe('number')
    // 第一次的 etaMs 应大于最后一次 (倒数 / 单调非增)
    const firstEta = progressEvents[0].etaMs
    const lastEta = progressEvents[progressEvents.length - 1].etaMs
    expect(firstEta).toBeGreaterThanOrEqual(lastEta)
  })

  test('run() 在 source 列表为空时仍能正常返回', async () => {
    test.setTimeout(20_000)

    const worker = new SynthesisWorker({ room: 'unit-test-room' })
    worker.nodesMap = buildMockNodesMap([])

    const mockNode = {
      id: 'syn-test-empty',
      type: 'synthesisNode',
      position: { x: 0, y: 0 },
      data: {
        sourceProposerIds: [],
        sourceRefuterIds: [],
        agentMode: 'auto',
        assignedTo: 'synthesis',
        status: 'pending',
      },
    }

    const outcome = await worker.run(mockNode, { reportProgress: () => {} })

    expect(outcome.ok).toBe(true)
    expect(outcome.result.sourceProposerCount).toBe(0)
    expect(outcome.result.sourceRefuterCount).toBe(0)
    expect(outcome.result.actionPlan).toContain('(无提议节点)')
    expect(outcome.result.actionPlan).toContain('(无反驳节点)')
  })
})

/**
 * TODO — 真实集成 spec (orchestra-http 支持 type 字段后启用)
 *
 * 当 orchestra-http POST /api/orchestra/inject 的 body 支持 { type: 'synthesisNode',
 * data: { sourceProposerIds, sourceRefuterIds, ... } } 时, 启用本块。
 *
 * 当前 inject 默认建 taskNode, 注入 synthesisNode 会导致 worker 永远不认领 → 测试超时。
 */
test.describe.skip('SynthesisWorker (orchestra-http 真集成 — 待 inject 支持 type 字段)', () => {
  const ROOM = process.env.ORCHESTRA_TEST_ROOM || 'demo-final'

  test('inject synthesisNode → 等 task done → 验 result.actionPlan + tokens', async () => {
    test.setTimeout(25_000)

    // 1. inject (假设 orchestra-http 已支持 type + data 直传)
    const injectResp = await fetch('http://127.0.0.1:17082/api/orchestra/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: ROOM,
        type: 'synthesisNode',                    // 当前 orchestra-http 还不支持
        title: 'aletheia synthesis e2e',
        body: '由 playwright 注入',
        assignedTo: 'synthesis',
        agentMode: 'auto',
        data: {
          sourceProposerIds: [],
          sourceRefuterIds: [],
        },
      }),
    })
    const inj = await injectResp.json()
    expect(inj.ok).toBe(true)
    const nodeId = inj.taskId || inj.nodeId

    // 2. 轮询 list 接口, expect.poll 等到 status=done (20s 上限)
    await expect.poll(async () => {
      const r = await fetch(`http://127.0.0.1:17082/api/orchestra/list?room=${ROOM}`)
      const j = await r.json()
      const node = (j.nodes || []).find((n) => n.id === nodeId)
      return node?.data?.status
    }, { timeout: 20_000, intervals: [500, 1000, 2000] }).toBe('done')

    // 3. 验 result 结构
    const finalResp = await fetch(`http://127.0.0.1:17082/api/orchestra/list?room=${ROOM}`)
    const finalJson = await finalResp.json()
    const finalNode = (finalJson.nodes || []).find((n) => n.id === nodeId)
    expect(finalNode.data.tokens).toBeTruthy()
    expect(finalNode.data.tokens.total).toBeGreaterThan(0)
    expect(finalNode.data.result).toBeTruthy()
    expect(finalNode.data.result.actionPlan).toContain('综合行动方案')
  })
})
