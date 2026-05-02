// 只测 promote: 在已有 OntologyNode 上点击"派 Hermes →" → 验证 TaskNode 进 yjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
page.on('pageerror', (e) => log(`[pageerror] ${e.message.slice(0, 200)}`))
page.on('console', (m) => {
  const t = m.type()
  if (t === 'error' || t === 'warn') log(`[browser ${t}] ${m.text().slice(0, 200)}`)
})

try {
  await page.goto(`https://ha2.digitalvio.shop/canvas/?room=demo-final&nc=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })
  const ni = await page.$('input[type="text"]')
  if (ni) { await ni.fill(`promote-${Date.now().toString(36).slice(-4)}`); await page.locator('button', { hasText: '进入' }).first().click(); await page.waitForTimeout(2000) }
  await page.waitForSelector('.react-flow__pane', { timeout: 15000 })
  await page.waitForTimeout(2500)

  // 精确 selector: 只在 ontologyNode 内找按钮
  const ontoBtn = page.locator('.react-flow__node-ontologyNode button:has-text("派 Hermes →")').first()
  const count = await page.locator('.react-flow__node-ontologyNode button:has-text("派 Hermes →")').count()
  log(`OntologyNode 内 "派 Hermes →" 按钮数: ${count}`)
  if (count === 0) throw new Error('没找到 OntologyNode 上的派 Hermes 按钮')

  const tasksBefore = await page.locator('.react-flow__node-taskNode').count()
  await ontoBtn.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await ontoBtn.click()
  log(`点击 OntologyNode "派 Hermes →" (TaskNode before=${tasksBefore})`)
  await page.waitForTimeout(2500)
  const tasksAfter = await page.locator('.react-flow__node-taskNode').count()
  log(`点击后 DOM TaskNode=${tasksAfter}`)

  // 取最新 TaskNode 的完整 innerText
  const all = await page.locator('.react-flow__node-taskNode').allInnerTexts()
  log(`所有 TaskNode 文本:`)
  all.forEach((t, i) => log(`  [${i}] ${t.replace(/\n/g, ' | ').slice(0, 150)}`))

  // 等 yjs 同步 + conductor 接管 + DeepSeek 完成
  log(`等 conductor 抢锁 + 跑完 DeepSeek (最多 60s)...`)
  let resultsBefore = await page.locator('.react-flow__node-resultNode').count()
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000)
    const r = await page.locator('.react-flow__node-resultNode').count()
    if (r > resultsBefore) {
      log(`✅ ResultNode 涌现 (耗时 ${(i + 1) * 2}s)`)
      const text = await page.locator('.react-flow__node-resultNode').last().innerText()
      log(`ResultNode 文本: ${text.slice(0, 200)}`)
      break
    }
    if (i % 5 === 4) {
      const taskTexts = await page.locator('.react-flow__node-taskNode').allInnerTexts()
      log(`  ${(i + 1) * 2}s: 最新 TaskNode: ${(taskTexts[taskTexts.length - 1] || '').slice(0, 80)}`)
    }
  }

  process.exitCode = (await page.locator('.react-flow__node-resultNode').count()) > resultsBefore ? 0 : 1
} catch (e) {
  log(`❌ ${e.message}`)
  process.exitCode = 2
} finally {
  await browser.close()
}
