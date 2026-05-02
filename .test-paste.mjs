// Playwright 验证粘贴 → 自动建节点 (URL / 文本 / 多 URL)
// 不测文件粘贴 (浏览器安全限制, 需 OS 级模拟)
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
const SHOT = 'E:/claude code/know-canvas/.test-screenshots'
mkdirSync(SHOT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const page = await ctx.newPage()
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
page.on('pageerror', (e) => log(`[pageerror] ${e.message.slice(0, 200)}`))
page.on('console', (m) => { if (m.type() === 'error') log(`[browser err] ${m.text().slice(0, 200)}`) })

const URL_LOCAL = 'http://localhost:5182/?room=paste-test'
let pass = 0
let fail = 0
const result = (name, ok, extra = '') => {
  if (ok) { pass++; log(`✅ ${name} ${extra}`) }
  else { fail++; log(`❌ ${name} ${extra}`) }
}

try {
  log(`访问 ${URL_LOCAL}`)
  await page.goto(URL_LOCAL, { waitUntil: 'networkidle', timeout: 30000 })

  // JoinRoom 拦截
  const nameInput = await page.$('input[type="text"]')
  if (nameInput) {
    await nameInput.fill(`paste-${Date.now().toString(36).slice(-4)}`)
    await page.locator('button', { hasText: '进入' }).first().click()
    await page.waitForTimeout(2000)
  }

  await page.waitForSelector('.react-flow__pane', { timeout: 15000 })
  await page.waitForTimeout(1500)
  const baseline = await page.$$eval('.react-flow__node', (n) => n.length)
  log(`baseline 节点数: ${baseline}`)

  // ===== Test 1: URL 单行 → BookmarkNode =====
  log('--- Test 1: URL 粘贴 → BookmarkNode ---')
  await page.locator('.react-flow__pane').first().click({ position: { x: 400, y: 400 } })
  await page.waitForTimeout(300)
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('https://example.com/article-test')
  })
  // 模拟 Ctrl+V (paste 事件)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add('https://example.com/article-test', 'text/plain')
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  })
  await page.waitForTimeout(1500)
  const afterUrl = await page.$$eval('.react-flow__node', (n) => n.length)
  const bookmarks = await page.locator('.react-flow__node-bookmarkNode').count()
  result('URL 粘贴建 BookmarkNode', afterUrl > baseline && bookmarks > 0,
    `(节点 ${baseline}→${afterUrl}, BookmarkNode=${bookmarks})`)
  await page.screenshot({ path: `${SHOT}/paste-01-url.png`, fullPage: false })

  // ===== Test 2: 多 URL 多行 → 多 BookmarkNode =====
  log('--- Test 2: 多 URL 粘贴 → 多 BookmarkNode ---')
  const before2 = await page.$$eval('.react-flow__node', (n) => n.length)
  await page.locator('.react-flow__pane').first().click({ position: { x: 600, y: 500 } })
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add('https://github.com/anthropics\nhttps://anthropic.com\nhttps://claude.ai', 'text/plain')
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  })
  await page.waitForTimeout(2000)
  const after2 = await page.$$eval('.react-flow__node', (n) => n.length)
  result('3 URL 粘贴建 3 节点', after2 - before2 === 3, `(+${after2 - before2} 节点)`)
  await page.screenshot({ path: `${SHOT}/paste-02-multi-url.png`, fullPage: false })

  // ===== Test 3: 纯文本 → NoteNode =====
  log('--- Test 3: 纯文本粘贴 → NoteNode ---')
  const before3 = await page.$$eval('.react-flow__node', (n) => n.length)
  const noteCountBefore = await page.locator('.react-flow__node-noteNode').count()
  await page.locator('.react-flow__pane').first().click({ position: { x: 800, y: 600 } })
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add('这是一段从外部复制过来的笔记内容\n第二行也算这条笔记', 'text/plain')
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  })
  await page.waitForTimeout(1500)
  const after3 = await page.$$eval('.react-flow__node', (n) => n.length)
  const noteCountAfter = await page.locator('.react-flow__node-noteNode').count()
  result('纯文本粘贴建 NoteNode', after3 > before3 && noteCountAfter > noteCountBefore,
    `(节点 ${before3}→${after3}, NoteNode ${noteCountBefore}→${noteCountAfter})`)
  await page.screenshot({ path: `${SHOT}/paste-03-text.png`, fullPage: false })

  // ===== Test 4: 在 INPUT 焦点时粘贴 → 不拦截 =====
  log('--- Test 4: INPUT 焦点粘贴 → 不应拦截 ---')
  const before4 = await page.$$eval('.react-flow__node', (n) => n.length)
  // 找 Aletheia 输入框
  const aletheiaInput = await page.$('input[placeholder*="一句话"]')
  if (aletheiaInput) {
    await aletheiaInput.click()
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.items.add('https://should-not-create-node.com', 'text/plain')
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    })
    await page.waitForTimeout(1000)
    const after4 = await page.$$eval('.react-flow__node', (n) => n.length)
    result('INPUT 焦点粘贴不建节点', after4 === before4, `(节点 ${before4}→${after4} 不变)`)
  } else {
    log('⚠ 跳过 Test 4 (没找到 Aletheia 输入框)')
  }

  log('---')
  log(`通过 ${pass}, 失败 ${fail}`)
  log(`截图: ${SHOT}/paste-{01,02,03}-*.png`)
  process.exitCode = fail === 0 ? 0 : 1
} catch (e) {
  log(`❌ 异常 ${e.message}`)
  try { await page.screenshot({ path: `${SHOT}/paste-99-error.png`, fullPage: true }) } catch {}
  process.exitCode = 2
} finally {
  await browser.close()
}
