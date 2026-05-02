/**
 * Orchestra 真实运行验证（不是 mock 测试，是真启动栈跑）
 *
 * 前提：start-orchestra.bat 已跑（或本测试外手工起了 yws + dispatcher + worker + http + vite）。
 *
 * 验证：
 *   1. 浏览器进 /?room=demo-orchestra-e2e（无关用之前 demo-orchestra）
 *   2. 通过 orchestra-http 注入 auto task
 *   3. 浏览器画布通过 Yjs 同步收到该节点
 *   4. dispatcher promote → worker claim → done
 *   5. 浏览器看到 status='done' 且 ResultNode 出现
 */

import { test, expect } from '@playwright/test'

// 必须用 dispatcher + worker 已在监听的 room
const ROOM = process.env.ORCHESTRA_TEST_ROOM || 'demo-orch-v2'
const TASK_TITLE = `playwright 真跑 ${Date.now()}`

// 通过 orchestra-http 注入任务
async function inject({ room, title, body, assignedTo }) {
  const r = await fetch('http://127.0.0.1:17082/api/orchestra/inject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, title, body, assignedTo }),
  })
  return r.json()
}

test('真跑：注入 auto task → 浏览器画布看到 done + ResultNode', async ({ page }) => {
  test.setTimeout(40_000)

  // 1. 进 join 页设置用户名
  await page.goto('http://localhost:5180/')
  await page.evaluate(() => {
    localStorage.setItem('know_canvas_username', 'orchestra-tester')
    localStorage.setItem('know_canvas_user_color', '#3b82f6')
  })
  await page.goto(`http://localhost:5180/?room=${ROOM}`)
  await expect(page.locator('h2:has-text("知识管理")')).toBeVisible({ timeout: 10000 })

  // 等 yjs sync 起来 (canvasStore 暴露 + provider 连上)
  await expect.poll(
    () => page.evaluate(() => !!window.__canvasStore),
    { timeout: 5000, message: 'window.__canvasStore 没暴露 (DEV 模式没生效?)' },
  ).toBe(true)
  // 给 yjs provider 1.5s 完成 sync 握手
  await page.waitForTimeout(1500)

  // 2. 注入 task
  const inj = await inject({
    room: ROOM,
    title: TASK_TITLE,
    body: '由 playwright 真跑',
    assignedTo: 'hermes',
  })
  expect(inj.ok).toBe(true)
  const taskId = inj.taskId
  console.log(`[real-run] injected ${taskId} into room ${ROOM}`)

  // 3. 浏览器画布要能看到这个节点
  let lastDump = null
  await expect.poll(
    async () => {
      const dump = await page.evaluate((id) => {
        const store = window.__canvasStore
        if (!store) return { storeReady: false }
        const state = store.getState()
        const found = state.nodes.find(n => n.id === id) || null
        return {
          storeReady: true,
          totalNodes: state.nodes.length,
          allIds: state.nodes.map(n => n.id),
          foundTask: !!found,
          foundStatus: found?.data?.status,
        }
      }, taskId)
      lastDump = dump
      return dump.foundTask
    },
    { timeout: 12000, intervals: [500], message: () => `浏览器没看到注入的 TaskNode. 最后 dump: ${JSON.stringify(lastDump)}` },
  ).toBe(true)
  console.log('[real-run] browser saw TaskNode, dump:', JSON.stringify(lastDump))

  // 4. 等 dispatcher promote + worker claim + 跑完 (mock 4s) + 同步 (~1s)
  // 总最多等 25s
  await expect.poll(
    async () => page.evaluate((id) => {
      const store = window.__canvasStore
      if (!store) return null
      const n = store.getState().nodes.find(nd => nd.id === id)
      return n?.data?.status || null
    }, taskId),
    { timeout: 25_000, intervals: [500, 1000], message: 'TaskNode 没流转到 done' },
  ).toBe('done')
  console.log('[real-run] browser saw status=done')

  // 5. ResultNode 应该自动建出来了
  const resultExists = await page.evaluate((src) => {
    const store = window.__canvasStore
    if (!store) return false
    return store.getState().nodes.some(n => n.type === 'resultNode' && n.data?.sourceTaskId === src)
  }, taskId)
  expect(resultExists).toBe(true)
  console.log('[real-run] browser saw ResultNode')

  // 6. 截图作为视觉证据
  await page.screenshot({ path: 'e2e-real-run.png', fullPage: true })
  console.log('[real-run] PASS · screenshot saved to e2e-real-run.png')
})
