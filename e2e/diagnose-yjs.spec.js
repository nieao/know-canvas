import { test, expect } from '@playwright/test'

test('诊断 spec inject 时 yjs 实际状态', async ({ page }) => {
  test.setTimeout(60_000)

  await page.goto('http://localhost:5180/')
  await page.evaluate(() => {
    localStorage.setItem('know_canvas_username', 'self-test')
    localStorage.setItem('know_canvas_user_color', '#3b82f6')
  })
  await page.goto(`http://localhost:5180/?room=demo-final`)
  await expect(page.locator('h2:has-text("知识管理")')).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(2500)

  const before = await page.evaluate(() => {
    const s = window.__canvasStore
    const state = s?.getState()
    return {
      nodeCount: state?.nodes?.length ?? -1,
      taskNodes: state?.nodes?.filter(n => n.type === 'taskNode').map(n => ({ id: n.id, status: n.data?.status })) || [],
    }
  })
  console.log('[before-inject store state]', JSON.stringify(before, null, 2))

  // server-side list before inject
  const listBefore = await fetch('http://127.0.0.1:17082/api/orchestra/list?room=demo-final').then(r => r.json())
  console.log('[before-inject server list]', listBefore.tasks.length, 'tasks')

  const inj = await fetch('http://127.0.0.1:17082/api/orchestra/inject', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: 'demo-final', title: 'diag', body: 'd', assignedTo: 'hermes' }),
  }).then(r => r.json())
  const taskId = inj.taskId
  console.log('[inject]', taskId)

  // 立刻看 server side
  await new Promise(r => setTimeout(r, 200))
  const listAfter1 = await fetch('http://127.0.0.1:17082/api/orchestra/list?room=demo-final').then(r => r.json())
  console.log('[+200ms server]', listAfter1.tasks.find(t => t.id === taskId) ? 'has task' : 'NO task')

  await new Promise(r => setTimeout(r, 800))
  const browser1 = await page.evaluate((id) => {
    const s = window.__canvasStore
    return s?.getState().nodes.find(n => n.id === id)?.data?.status || null
  }, taskId)
  console.log('[+1s browser]', browser1)
  const listAfter2 = await fetch('http://127.0.0.1:17082/api/orchestra/list?room=demo-final').then(r => r.json())
  console.log('[+1s server]', listAfter2.tasks.find(t => t.id === taskId)?.status || 'NO task')

  await new Promise(r => setTimeout(r, 5000))
  const browser2 = await page.evaluate((id) => {
    const s = window.__canvasStore
    return s?.getState().nodes.find(n => n.id === id)?.data?.status || null
  }, taskId)
  console.log('[+6s browser]', browser2)
  const listAfter3 = await fetch('http://127.0.0.1:17082/api/orchestra/list?room=demo-final').then(r => r.json())
  console.log('[+6s server]', listAfter3.tasks.find(t => t.id === taskId)?.status || 'NO task')

  await new Promise(r => setTimeout(r, 8000))
  const listAfter4 = await fetch('http://127.0.0.1:17082/api/orchestra/list?room=demo-final').then(r => r.json())
  console.log('[+14s server]', listAfter4.tasks.find(t => t.id === taskId)?.status || 'NO task')
})
