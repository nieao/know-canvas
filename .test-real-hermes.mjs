// 端到端测试: 浏览器 → Aletheia → 派 Hermes → conductor → 真 Hermes worker → DeepSeek → ResultNode
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
const SHOT = 'E:/claude code/know-canvas/.test-screenshots'
mkdirSync(SHOT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
page.on('pageerror', (e) => log(`[pageerror] ${e.message.slice(0, 150)}`))
page.on('console', (m) => { if (m.type() === 'error') log(`[browser err] ${m.text().slice(0, 150)}`) })

try {
  // 用独立 room 不污染 demo-final, 但需要 conductor 接管这个 room
  // (conductor 是懒启动, 但不 invoke 时不会自动接管 — 用 demo-final 保证 conductor 在听)
  // cache-bust 用独立 room 避免 yjs LevelDB 旧数据污染 + ?nc=ts 强制不缓存 JS
  const URL = `https://ha2.digitalvio.shop/canvas/?room=demo-final&nc=${Date.now()}`
  log(`访问 ${URL}`)
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })

  // JoinRoom 拦截
  const nameInput = await page.$('input[type="text"]')
  if (nameInput) {
    await nameInput.fill(`real-hermes-${Date.now().toString(36).slice(-4)}`)
    await page.locator('button', { hasText: '进入' }).first().click()
    await page.waitForTimeout(3000)
  }

  await page.waitForSelector('.react-flow__pane', { timeout: 15000 })
  await page.waitForTimeout(2000)
  const nodesBefore = await page.$$eval('.react-flow__node', (n) => n.length)
  log(`baseline 节点数: ${nodesBefore}`)

  // 输入一个简短目标 (LLM 输出短, 测试快)
  const aletheiaInput = await page.$('input[placeholder*="一句话"]')
  await aletheiaInput.fill('给我一个写 Hello World 的 Python 例子')
  log('提交 Aletheia 输入')
  await aletheiaInput.press('Enter')

  // 等节点涌现
  let nodesAfterAletheia = nodesBefore
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000)
    nodesAfterAletheia = await page.$$eval('.react-flow__node', (n) => n.length)
    if (nodesAfterAletheia > nodesBefore) {
      log(`✅ Aletheia 涌现 ${nodesAfterAletheia - nodesBefore} 节点 (耗时 ${(i + 1) * 2}s)`)
      break
    }
  }
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SHOT}/real-01-aletheia-done.png`, fullPage: false })

  // 找一个 ENTITY 节点的"派 Hermes →"按钮 (定位到刚生成的最右下节点)
  const ontoButtons = await page.locator('button:has-text("派 Hermes")').all()
  log(`找到 ${ontoButtons.length} 个"派 Hermes"按钮`)
  if (ontoButtons.length === 0) throw new Error('没找到任何派 Hermes 按钮')

  // 取最后一个 (最新涌现的节点) 来点
  const targetBtn = ontoButtons[ontoButtons.length - 1]
  await targetBtn.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await targetBtn.click()
  log('🎯 点击"派 Hermes →"按钮')
  const tasksBefore = await page.locator('.react-flow__node-taskNode').count()
  const resultsBefore = await page.locator('.react-flow__node-resultNode').count()
  log(`派单前: TaskNode=${tasksBefore}, ResultNode=${resultsBefore}`)

  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SHOT}/real-02-task-created.png`, fullPage: false })

  // 在浏览器里直接读 yjs nodes map, 看派单后是不是真的写到 yjs 了
  // 不依赖 window.store — 翻页面能拿到的 ydoc 实例
  const debug = await page.evaluate(() => {
    // yjsClient 模块 export 了 getDoc/getNodesMap, 我们没法直接 import,
    // 但 react-flow 在画布上, 所有可见节点的 data 都在 zustand 里 — DOM 反推
    const taskEls = [...document.querySelectorAll('.react-flow__node-taskNode')]
    const lastEl = taskEls[taskEls.length - 1]
    const text = lastEl?.innerText?.slice(0, 250) || '(no taskNode in dom)'
    // 找 ws 实例
    const wsList = []
    for (const k of Object.keys(window)) {
      try {
        const v = window[k]
        if (v && typeof v === 'object' && v.url && (v.url.includes('ws://') || v.url.includes('wss://'))) {
          wsList.push({ key: k, url: v.url, readyState: v.readyState })
        }
      } catch {}
    }
    return {
      url: window.location.href,
      domTaskNodeCount: taskEls.length,
      latestTaskDomText: text,
      wsList,
    }
  })
  log(`url: ${debug.url}`)
  log(`DOM TaskNode 数: ${debug.domTaskNodeCount}`)
  log(`最新 TaskNode DOM 文本: ${debug.latestTaskDomText.slice(0, 200)}`)
  log(`window 上的 WS: ${JSON.stringify(debug.wsList)}`)

  // 等 conductor 抢锁 → Hermes 真 task → DeepSeek → ResultNode (预计 15-60s)
  log('⏳ 等 orchestra → Hermes 真 worker → DeepSeek 返回 → ResultNode 涌现 (最多 90s)')
  let resultsAfter = resultsBefore
  let lastStatusReport = 0
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(2000)
    resultsAfter = await page.locator('.react-flow__node-resultNode').count()
    if (resultsAfter > resultsBefore) {
      log(`✅ ResultNode 涌现 (耗时 ${(i + 1) * 2}s)`)
      break
    }
    // 每 10s 报一下 TaskNode 状态文本
    if (i - lastStatusReport >= 5) {
      lastStatusReport = i
      const taskTexts = await page.locator('.react-flow__node-taskNode').allTextContents()
      const latest = taskTexts[taskTexts.length - 1]?.slice(0, 80) || '(no task)'
      log(`  ${(i + 1) * 2}s: 最新 TaskNode 文本: ${latest}`)
    }
  }

  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SHOT}/real-03-result-emerged.png`, fullPage: true })

  // 报告
  const finalTasks = await page.locator('.react-flow__node-taskNode').count()
  const finalResults = await page.locator('.react-flow__node-resultNode').count()
  const success = finalResults > resultsBefore

  log('---')
  log(`部署 SHA (curl): ${(await fetch('https://ha2.digitalvio.shop/canvas/.deploy-marker').then(r => r.text())).trim()}`)
  log(`Aletheia 涌现节点: ${nodesAfterAletheia - nodesBefore}`)
  log(`派 Hermes 后: TaskNode +${finalTasks - tasksBefore}, ResultNode +${finalResults - resultsBefore}`)
  log(`总判: ${success ? '✅ 真 Hermes 链路通!' : '❌ ResultNode 没涌现, 看截图诊断'}`)
  log(`截图: ${SHOT}/real-{01,02,03}-*.png`)

  process.exitCode = success ? 0 : 1
} catch (e) {
  log(`❌ ${e.message}`)
  try { await page.screenshot({ path: `${SHOT}/real-99-error.png`, fullPage: true }) } catch {}
  process.exitCode = 2
} finally {
  await browser.close()
}
