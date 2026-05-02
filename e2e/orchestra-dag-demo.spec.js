/**
 * Orchestra DAG Demo — 真浏览器视角看 6 节点 DAG 炸开
 *
 * 截 3 张图作证据:
 *   1. dag-01-injected.png    一键注入完, 画布上 6 节点 + 5 边 (全 draft)
 *   2. dag-02-mid.png         root + 部分子节点已 running / done
 *   3. dag-03-done.png        所有 6 完成 + 6 ResultNode 涌现
 */

import { test, expect } from '@playwright/test'
import path from 'path'

const ROOM = process.env.ORCHESTRA_TEST_ROOM || 'demo-orch-v2'
const SHOTS = 'e2e-orchestra-shots'

test('DAG 一键派 6 节点链 → 画布炸开 → 全 done', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1600, height: 1000 })

  await page.goto('http://localhost:5180/')
  await page.evaluate(() => {
    localStorage.setItem('know_canvas_username', 'dag-demo')
    localStorage.setItem('know_canvas_user_color', '#c8a882')
  })
  await page.goto(`http://localhost:5180/?room=${ROOM}`)
  await expect(page.locator('h2:has-text("知识管理")')).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(2000) // yjs sync

  // 记下当前节点数, 派 chain 后看新增 6
  const before = await page.evaluate(() => window.__canvasStore.getState().nodes.length)
  console.log(`[dag] before=${before}`)

  // 一键派 chain
  const inj = await fetch('http://127.0.0.1:17082/api/orchestra/inject-chain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: ROOM, assignedTo: 'hermes', theme: 'DAG demo' }),
  }).then(r => r.json())
  expect(inj.ok).toBe(true)
  expect(inj.taskIds.length).toBe(6)
  console.log(`[dag] injected ${inj.taskIds.length} tasks`)

  const taskIds = inj.taskIds

  // 等浏览器同步到所有 6 节点
  await expect.poll(
    () => page.evaluate((ids) => {
      const s = window.__canvasStore.getState()
      return ids.every(id => s.nodes.some(n => n.id === id))
    }, taskIds),
    { timeout: 8000, intervals: [200] },
  ).toBe(true)
  console.log('[dag] browser saw all 6')
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(SHOTS, 'dag-01-injected.png'), fullPage: false })

  // 等到至少 root + 1 个子任务跑完 (中段截图)
  await expect.poll(
    () => page.evaluate((ids) => {
      const s = window.__canvasStore.getState()
      return ids.filter(id => s.nodes.find(n => n.id === id)?.data?.status === 'done').length >= 1
    }, taskIds),
    { timeout: 20_000, intervals: [200] },
  ).toBe(true)
  await page.screenshot({ path: path.join(SHOTS, 'dag-02-mid.png'), fullPage: false })
  console.log('[dag] mid screenshot')

  // 等所有 6 done
  await expect.poll(
    () => page.evaluate((ids) => {
      const s = window.__canvasStore.getState()
      return ids.every(id => s.nodes.find(n => n.id === id)?.data?.status === 'done')
    }, taskIds),
    { timeout: 30_000, intervals: [500] },
  ).toBe(true)
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(SHOTS, 'dag-03-done.png'), fullPage: false })
  console.log('[dag] all 6 done')

  // 验证:
  // 1. ResultNode 数量 = 6 (这次产生的)
  // 2. 每条 chain edge 都在
  const summary = await page.evaluate((ids) => {
    const s = window.__canvasStore.getState()
    const results = s.nodes.filter(n => n.type === 'resultNode' && ids.includes(n.data?.source_task_id))
    const chainEdges = s.edges.filter(e => e.data?.kind === 'chain-dep')
    return {
      taskCount: ids.length,
      doneCount: ids.filter(id => s.nodes.find(n => n.id === id)?.data?.status === 'done').length,
      resultsForChain: results.length,
      chainDepEdges: chainEdges.length,
    }
  }, taskIds)
  console.log('[dag] summary:', JSON.stringify(summary))
  expect(summary.doneCount).toBe(6)
  expect(summary.resultsForChain).toBe(6)
  expect(summary.chainDepEdges).toBeGreaterThanOrEqual(5) // 房间可能累积历史 chain
})
