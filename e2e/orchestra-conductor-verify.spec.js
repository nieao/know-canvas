/**
 * Conductor 通路验证 — 纯后端 e2e, 不开浏览器
 *
 * 验 orchestra-conductor (替代独立 dispatcher + hermes-worker) 的整条通路:
 *   inject → dispatcher promote → hermes worker claim → mock done → ResultNode + tokens
 *
 * 不走 chromium, 因此完全规避浏览器端 zustand persist + yjsSync 的 startup race。
 * 浏览器端的真实多人协作 (三人共用 demo-final) 通过手动测试 + start-orchestra.bat 启动验证,
 * 此 spec 只确保 conductor 这条线本身工作。
 */
import { test, expect } from '@playwright/test'

const ROOM = process.env.ORCHESTRA_TEST_ROOM || 'demo-final'
const ORCHESTRA_HTTP = 'http://127.0.0.1:17082'

test('conductor + dispatcher + hermes worker e2e (backend only)', async () => {
  test.setTimeout(30_000)

  const injR = await fetch(`${ORCHESTRA_HTTP}/api/orchestra/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room: ROOM,
      title: `conductor-verify ${new Date().toISOString().slice(11, 19)}`,
      body: 'verify conductor stack',
      assignedTo: 'hermes',
    }),
  })
  const inj = await injR.json()
  expect(inj.ok).toBe(true)
  const taskId = inj.taskId
  console.log(`[inject] ${taskId}`)

  await expect.poll(async () => {
    const r = await fetch(`${ORCHESTRA_HTTP}/api/orchestra/list?room=${ROOM}`)
    const j = await r.json()
    return j.tasks.find(t => t.id === taskId)?.status || null
  }, { timeout: 20_000, intervals: [500] }).toBe('done')

  const r = await fetch(`${ORCHESTRA_HTTP}/api/orchestra/list?room=${ROOM}`)
  const list = await r.json()
  const task = list.tasks.find(x => x.id === taskId)
  const result = list.results.find(x => x.sourceTaskId === taskId)
  console.log('[task]', JSON.stringify({ status: task.status, elapsedMs: task.elapsedMs, tokens: task.tokens }))
  console.log('[result]', JSON.stringify({ id: result?.id, summary: result?.summary }))

  expect(task.status).toBe('done')
  expect(task.claimedBy).toMatch(/^hermes-/)
  expect(task.tokens).toBeTruthy()
  expect(task.tokens.total).toBeGreaterThan(0)
  expect(result).toBeTruthy()
  expect(result.summary).toContain('mock')
})
