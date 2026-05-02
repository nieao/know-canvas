/**
 * Orchestra 自测 — 浏览器视角全链路 + 关键帧截图
 *
 * 前提: yws + dispatcher + worker (mock, room=demo-orch-v2) + orchestra-http + vite 都在跑
 *
 * 截 4 张图作证据:
 *   1. canvas-empty.png       入房间空状态
 *   2. canvas-task-draft.png  注入 task 后, 浏览器看到 draft
 *   3. canvas-task-running.png worker claimed, status running
 *   4. canvas-task-done.png   完成 + ResultNode 涌现
 */

import { test, expect } from '@playwright/test'
import path from 'path'

const ROOM = process.env.ORCHESTRA_TEST_ROOM || 'demo-orch-v2'
const SHOTS = 'e2e-orchestra-shots'

async function inject({ room, title, body, assignedTo }) {
  const r = await fetch('http://127.0.0.1:17082/api/orchestra/inject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, title, body, assignedTo }),
  })
  return r.json()
}

test('浏览器自测全链路 + 关键帧截图', async ({ page }) => {
  test.setTimeout(45_000)

  // 1) 入房间
  await page.goto('http://localhost:5180/')
  await page.evaluate(() => {
    localStorage.setItem('know_canvas_username', 'self-test')
    localStorage.setItem('know_canvas_user_color', '#3b82f6')
  })
  await page.goto(`http://localhost:5180/?room=${ROOM}`)
  await expect(page.locator('h2:has-text("知识管理")')).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(2000) // yjs sync 完
  await page.screenshot({ path: path.join(SHOTS, '01-canvas-empty.png'), fullPage: false })
  console.log('[shot] 01-canvas-empty')

  // 2) 注入
  const inj = await inject({
    room: ROOM,
    title: `自测 ${new Date().toLocaleTimeString()}`,
    body: 'orchestra 自测任务',
    assignedTo: 'hermes',
  })
  expect(inj.ok).toBe(true)
  const taskId = inj.taskId
  console.log(`[inject] ${taskId}`)

  // 3) 等浏览器看到 draft (一闪即过, 抓住时机)
  await expect.poll(
    () => page.evaluate((id) => {
      const s = window.__canvasStore
      return s?.getState().nodes.find(n => n.id === id)?.data?.status || null
    }, taskId),
    { timeout: 5000, intervals: [150] },
  ).toBeTruthy()
  // 立刻截图(此时可能已经从 draft 跳到 running, 都行)
  const earlyStatus = await page.evaluate((id) => {
    const s = window.__canvasStore
    return s?.getState().nodes.find(n => n.id === id)?.data?.status
  }, taskId)
  await page.screenshot({ path: path.join(SHOTS, `02-canvas-task-${earlyStatus}.png`), fullPage: false })
  console.log(`[shot] 02-canvas-task-${earlyStatus}`)

  // 4) 等 running (尽量在这个点截一张)
  if (earlyStatus !== 'running') {
    await expect.poll(
      () => page.evaluate((id) => {
        const s = window.__canvasStore
        return s?.getState().nodes.find(n => n.id === id)?.data?.status || null
      }, taskId),
      { timeout: 12_000, intervals: [100] },
    ).toBe('running')
    await page.screenshot({ path: path.join(SHOTS, '03-canvas-task-running.png'), fullPage: false })
    console.log('[shot] 03-canvas-task-running')
  }

  // 5) 等 done + ResultNode
  await expect.poll(
    () => page.evaluate((id) => {
      const s = window.__canvasStore
      return s?.getState().nodes.find(n => n.id === id)?.data?.status || null
    }, taskId),
    { timeout: 15_000, intervals: [200] },
  ).toBe('done')

  const resultExists = await page.evaluate((src) => {
    const s = window.__canvasStore
    return s?.getState().nodes.some(n => n.type === 'resultNode' && n.data?.source_task_id === src)
  }, taskId)
  expect(resultExists).toBe(true)

  // 等画布动画稳定
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(SHOTS, '04-canvas-task-done.png'), fullPage: false })
  console.log('[shot] 04-canvas-task-done')

  // 6) 验整体状态
  const final = await page.evaluate((id) => {
    const s = window.__canvasStore
    const state = s.getState()
    const task = state.nodes.find(n => n.id === id)
    const result = state.nodes.find(n => n.type === 'resultNode' && n.data?.source_task_id === id)
    const edge = state.edges.find(e => e.source === id && e.target === result?.id)
    return {
      taskStatus: task?.data?.status,
      taskClaimedBy: task?.data?.claimedBy,
      resultSummary: result?.data?.summary,
      resultPreview: typeof result?.data?.result === 'string' ? result.data.result.slice(0, 100) : null,
      edgeExists: !!edge,
      totalNodes: state.nodes.length,
      totalEdges: state.edges.length,
    }
  }, taskId)
  console.log('[final]', JSON.stringify(final, null, 2))
  expect(final.taskStatus).toBe('done')
  expect(final.edgeExists).toBe(true)
})
