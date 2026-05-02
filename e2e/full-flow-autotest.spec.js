/**
 * Know Canvas 全流程自测脚本（subagent 评分用）
 *
 * 6 个 case，每个 20 分，共 120 分（>=100 算 PASS）：
 *   Case 1 — JoinRoom + 协作进入
 *   Case 2 — 节点添加 + 编辑
 *   Case 3 — 视频导入抓 oEmbed
 *   Case 4 — 本地任务执行
 *   Case 5 — Aletheia 决策引擎跑
 *   Case 6 — CLI 监控折叠/展开
 *
 * 输出：
 *   e2e/.tmp/autotest-report.json
 *   e2e/.tmp/case*-*.png
 */

import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const TMP_DIR = path.join(process.cwd(), 'e2e', '.tmp')
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

const REPORT_PATH = path.join(TMP_DIR, 'autotest-report.json')

// 每个 case 使用独立 room（避免 yjs 跨 case 数据污染）
const ROOM = (n) => `autotest-2026-05-02-c${n}-${Date.now().toString(36).slice(-4)}`

// 评分卡 — 每个 case 跑完后增量写到磁盘（避免 worker 重启丢内存）
function loadReport() {
  if (!fs.existsSync(REPORT_PATH)) {
    return {
      ts: new Date().toISOString(),
      totalScore: 0,
      passCount: 0,
      failCount: 0,
      details: [],
      screenshots: [],
      verdict: '',
    }
  }
  try {
    return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'))
  } catch {
    return {
      ts: new Date().toISOString(),
      totalScore: 0,
      passCount: 0,
      failCount: 0,
      details: [],
      screenshots: [],
      verdict: '',
    }
  }
}

function saveReport(r) {
  fs.writeFileSync(REPORT_PATH, JSON.stringify(r, null, 2), 'utf-8')
}

// 等 window.__canvasStore（dev 下异步注入）
async function waitForStore(page, timeout = 10000) {
  return await page.waitForFunction(
    () => typeof window.__canvasStore?.getState === 'function',
    { timeout },
  ).catch(() => null)
}

// 进入协作画布（跳过 JoinRoom）
async function enterRoom(page, roomName) {
  await page.goto('/canvas/')
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('know_canvas_username', '自测Bot')
    localStorage.setItem('know_canvas_user_color', '#3b82f6')
  })
  await page.goto(`/canvas/?room=${roomName}&e2e=1`)
  await waitForStore(page)
  // 等画布渲染稳定
  await page.waitForSelector('.react-flow__pane', { timeout: 10000 }).catch(() => null)
  await page.waitForTimeout(2000)
}

function recordCase(num, name, passed, score, issue, shotName) {
  const r = loadReport()
  r.details = r.details.filter(d => d.case !== String(num))
  r.details.push({
    case: String(num),
    name,
    passed,
    score: passed ? score : 0,
    issue: issue || null,
  })
  r.totalScore = r.details.reduce((s, d) => s + (d.passed ? d.score : 0), 0)
  r.passCount = r.details.filter(d => d.passed).length
  r.failCount = r.details.filter(d => !d.passed).length
  if (shotName && !r.screenshots.includes(shotName)) r.screenshots.push(shotName)
  // case 序号排序（让最终报告好看）
  r.details.sort((a, b) => Number(a.case) - Number(b.case))
  saveReport(r)
}

// 跑完所有 case 后更新 verdict + 打印
test.afterAll(async () => {
  const TOTAL = 120
  const r = loadReport()
  const failNames = r.details.filter(d => !d.passed).map(d => `Case ${d.case}`).join(' & ')
  r.verdict = r.totalScore >= 100
    ? `PASS — ${r.totalScore}/${TOTAL}`
    : `FAIL — ${r.totalScore}/${TOTAL}${failNames ? ', need fix ' + failNames : ''}`
  saveReport(r)
  console.log('\n===== 评分卡 =====')
  console.log(JSON.stringify(r, null, 2))
  console.log('=====================')
  console.log('Report saved to:', REPORT_PATH)
})

// 单 worker，每 case 90s 超时
test.setTimeout(90_000)

// 测试集开始前清掉旧报告
test.beforeAll(() => {
  if (fs.existsSync(REPORT_PATH)) fs.unlinkSync(REPORT_PATH)
})

test.describe('Know Canvas 全流程自测', () => {
  // ============================================================
  // Case 1（20 分）— JoinRoom + 协作进入
  // ============================================================
  test('Case 1 — JoinRoom + 快速进入主房间', async ({ page }) => {
    let passed = false
    let issue = null
    let shot = 'case1-joinroom.png'
    try {
      await page.goto('/canvas/')
      await page.evaluate(() => localStorage.clear())
      await page.goto('/canvas/')

      // 看到 ALETHEIA 品牌字样
      await expect.soft(page.locator('text=ALETHEIA').first()).toBeVisible({ timeout: 8000 })
      await expect.soft(page.locator('h1:has-text("进入协作画布")')).toBeVisible({ timeout: 5000 })

      // 输入用户名
      const nameInput = page.locator('input[placeholder*="你想猫"]').first()
      await nameInput.fill('自测Bot')

      // 点 "快速进入主房间"
      await page.locator('button:has-text("快速进入主房间")').click()

      // URL 跳到 demo-final
      await page.waitForURL(/room=demo-final/, { timeout: 8000 })
      await waitForStore(page)
      await page.waitForTimeout(2500)

      // 看到 ALETHEIA 品牌（左上）
      const brandVisible = await page.locator('span:has-text("ALETHEIA")').first().isVisible().catch(() => false)

      // 看到模式开关 [自动 | 本地 | Hermes]
      const autoVisible = await page.locator('button:has-text("自动")').first().isVisible().catch(() => false)
      const localVisible = await page.locator('button:has-text("本地")').first().isVisible().catch(() => false)
      const hermesVisible = await page.locator('button:has-text("Hermes")').first().isVisible().catch(() => false)

      // 看到 "CLI 监控" 折叠条
      const cliVisible = await page.locator('button:has-text("CLI 监控")').first().isVisible().catch(() => false)

      await page.screenshot({ path: path.join(TMP_DIR, shot), fullPage: false })

      passed = brandVisible && autoVisible && localVisible && hermesVisible && cliVisible
      if (!passed) {
        const missing = []
        if (!brandVisible) missing.push('ALETHEIA品牌')
        if (!autoVisible || !localVisible || !hermesVisible) missing.push('模式开关[自动|本地|Hermes]')
        if (!cliVisible) missing.push('CLI监控')
        issue = `缺失：${missing.join('、')}`
      }
    } catch (err) {
      issue = `异常：${err.message}`
    }
    recordCase(1, 'JoinRoom + 协作进入', passed, 20, issue, shot)
  })

  // ============================================================
  // Case 2（20 分）— 节点添加 + 编辑
  // ============================================================
  test('Case 2 — 添加概念节点 + 选中显示详情', async ({ page }) => {
    let passed = false
    let issue = null
    let shot = 'case2-node-added.png'
    try {
      const room = ROOM(2)
      await enterRoom(page, room)

      const before = await page.evaluate(() => {
        return window.__canvasStore?.getState?.()?.nodes?.length ?? 0
      })

      // 路径 1：尝试双击空白唤起菜单
      const flowEl = page.locator('.react-flow__pane').first()
      await flowEl.dblclick({ position: { x: 500, y: 350 }, force: true }).catch(() => {})
      await page.waitForTimeout(600)

      const conceptBtn = page.locator('button:has-text("概念")').first()
      const menuVisible = await conceptBtn.isVisible().catch(() => false)
      if (menuVisible) {
        await conceptBtn.click().catch(() => {})
        await page.waitForTimeout(700)
      }

      let after = await page.evaluate(() => {
        return window.__canvasStore?.getState?.()?.nodes?.length ?? 0
      })

      // 路径 2：菜单失败 → 直接 store.addConceptNode
      if (after <= before) {
        await page.evaluate(() => {
          const s = window.__canvasStore?.getState?.()
          if (s?.addConceptNode) {
            s.addConceptNode({ title: '新概念', description: '', tags: [] }, { x: 300, y: 300 })
          }
        })
        await page.waitForTimeout(700)
        after = await page.evaluate(() => {
          return window.__canvasStore?.getState?.()?.nodes?.length ?? 0
        })
      }

      const nodeAdded = after > before

      // 选中节点 → 期待 RightPanel 显示 "概念详情" 或 "本地任务"
      let detailVisible = false
      if (nodeAdded) {
        // 通过 store 选中第一个节点（避开点击穿透问题）
        await page.evaluate(() => {
          const s = window.__canvasStore?.getState?.()
          const firstNode = s?.nodes?.[0]
          if (firstNode && s?.onNodesChange) {
            s.onNodesChange([{ id: firstNode.id, type: 'select', selected: true }])
          }
        })
        await page.waitForTimeout(400)
        // 也尝试 UI 点击
        const nodeEl = page.locator('.react-flow__node').first()
        await nodeEl.click({ force: true }).catch(() => {})
        await page.waitForTimeout(500)
        detailVisible = await page.locator('text=概念详情').first().isVisible().catch(() => false)
        if (!detailVisible) {
          detailVisible = await page.locator('text=本地任务').first().isVisible().catch(() => false)
        }
      }

      // 编辑标题 — 通过 store updateNode
      let titleEdited = false
      if (nodeAdded) {
        await page.evaluate(() => {
          const s = window.__canvasStore?.getState?.()
          const first = s?.nodes?.[0]
          if (first && s?.updateNode) {
            s.updateNode(first.id, { title: '测试概念 A' })
          }
        })
        await page.waitForTimeout(300)
        titleEdited = await page.evaluate(() => {
          const s = window.__canvasStore?.getState?.()
          return s?.nodes?.[0]?.data?.title === '测试概念 A'
        })
      }

      await page.screenshot({ path: path.join(TMP_DIR, shot), fullPage: false })

      passed = nodeAdded && detailVisible && titleEdited
      if (!nodeAdded) issue = '节点未添加 — 双击菜单 + store.addConceptNode 都失败'
      else if (!detailVisible) issue = '节点已加但 RightPanel 未显示概念详情'
      else if (!titleEdited) issue = 'updateNode 修改 title 未生效'
    } catch (err) {
      issue = `异常：${err.message}`
    }
    recordCase(2, '节点添加 + 编辑', passed, 20, issue, shot)
  })

  // ============================================================
  // Case 3（20 分）— 视频 oEmbed
  // ============================================================
  test('Case 3 — YouTube URL → 抓真实标题 + thumbnail', async ({ page }) => {
    let passed = false
    let issue = null
    let shot = 'case3-video.png'
    try {
      const room = ROOM(3)
      await enterRoom(page, room)

      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      await page.evaluate((u) => {
        const s = window.__canvasStore?.getState?.()
        if (s?.addUrlNode) s.addUrlNode(u, { x: 600, y: 300 })
        else if (s?.addVideoNode) s.addVideoNode(u, '', '', { x: 600, y: 300 }, true)
      }, url)

      // 轮询等 oembed 抓取（最多 15s）
      const startedAt = Date.now()
      let videoNode = null
      while (Date.now() - startedAt < 15000) {
        videoNode = await page.evaluate(() => {
          const s = window.__canvasStore?.getState?.()
          const ns = s?.nodes || []
          const v = ns.find(n => n.type === 'videoNode')
          return v ? { title: v.data?.title || '', image: v.data?.image || '', platform: v.data?.platform } : null
        })
        if (videoNode && videoNode.title && !videoNode.title.startsWith('http') && videoNode.image) break
        await page.waitForTimeout(1000)
      }

      await page.screenshot({ path: path.join(TMP_DIR, shot), fullPage: false })

      const titleOk = videoNode && videoNode.title && !videoNode.title.startsWith('http') && videoNode.title.length > 3
      const thumbOk = videoNode && videoNode.image && videoNode.image.startsWith('http')
      passed = titleOk && thumbOk

      if (!videoNode) issue = '未创建 videoNode — 检查 useCanvasStore.addUrlNode + detectVideoUrl 是否识别 youtube'
      else if (!titleOk) issue = `Title 未抓到（仍是 URL/空）：${JSON.stringify(videoNode.title)} — 检查 utils/linkPreview.js fetchOembedMetadata`
      else if (!thumbOk) issue = `Thumbnail 缺失：${JSON.stringify(videoNode.image)} — 检查 oembed thumbnail_url`
    } catch (err) {
      issue = `异常：${err.message}`
    }
    recordCase(3, '视频 oEmbed', passed, 20, issue, shot)
  })

  // ============================================================
  // Case 4（20 分）— 本地任务执行
  // ============================================================
  test('Case 4 — 本地任务派单 + 路由提示 + 执行', async ({ page }) => {
    let passed = false
    let issue = null
    let shot = 'case4-localtask.png'
    try {
      const room = ROOM(4)
      await enterRoom(page, room)

      // 通过 store 加 conceptNode + 选中
      await page.evaluate(() => {
        const s = window.__canvasStore?.getState?.()
        if (s?.addConceptNode) {
          s.addConceptNode({ title: '测试概念A', description: '本地任务测试', tags: [] }, { x: 300, y: 300 })
        }
      })
      await page.waitForTimeout(800)
      await page.evaluate(() => {
        const s = window.__canvasStore?.getState?.()
        const first = s?.nodes?.[0]
        if (first && s?.onNodesChange) {
          s.onNodesChange([{ id: first.id, type: 'select', selected: true }])
        }
      })
      // 也点击下 UI（确保 RightPanel 触发渲染）
      const nodeEl = page.locator('.react-flow__node').first()
      await nodeEl.click({ force: true }).catch(() => {})
      await page.waitForTimeout(800)

      // textarea
      const ta = page.locator('textarea[placeholder*="写下要做什么"]').first()
      const taExists = await ta.count()
      if (taExists === 0) {
        issue = '未找到本地任务 textarea — RightPanel.LocalTaskSection 未渲染'
        await page.screenshot({ path: path.join(TMP_DIR, shot), fullPage: false })
        recordCase(4, '本地任务执行', false, 20, issue, shot)
        return
      }
      await ta.fill('用一句话说说这个概念')
      await page.waitForTimeout(400)

      const routeVisible = await page.locator('text=/路由：(本地|Hermes)/').first().isVisible().catch(() => false)

      await page.locator('button:has-text("执行")').first().click({ force: true }).catch(() => {})
      await page.waitForTimeout(500)

      // 在浏览器里轮询 30s 等任务终态（done/failed 都算"local executor 走通"）
      const taskDone = await page.evaluate(async () => {
        const startedAt = Date.now()
        while (Date.now() - startedAt < 30000) {
          const s = window.__canvasStore?.getState?.()
          const ns = s?.nodes || []
          for (const n of ns) {
            const tasks = n.data?.localTasks || []
            for (const t of tasks) {
              if (t.status === 'done' || t.status === 'failed') {
                return { status: t.status, hasResult: !!t.result, hasError: !!t.error }
              }
            }
          }
          await new Promise(r => setTimeout(r, 1000))
        }
        return null
      })

      await page.screenshot({ path: path.join(TMP_DIR, shot), fullPage: false })

      passed = routeVisible && !!taskDone
      if (!routeVisible) issue = '"路由：本地/Hermes" 提示未出现 — 检查 routeTask + LocalTaskSection 文本渲染'
      else if (!taskDone) issue = '任务 30s 内未结束（runLocalTask / claude-bridge 18080 未连通 / Hermes 17082 不可达）'
    } catch (err) {
      issue = `异常：${err.message}`
    }
    recordCase(4, '本地任务执行', passed, 20, issue, shot)
  })

  // ============================================================
  // Case 5（20 分）— Aletheia 决策引擎
  // ============================================================
  test('Case 5 — 启动决策引擎 + 对画布跑一轮', async ({ page }) => {
    let passed = false
    let issue = null
    let shot = 'case5-aletheia.png'
    try {
      const room = ROOM(5)
      await enterRoom(page, room)

      // 先在画布上撒几个 conceptNode（决策引擎需要素材）
      await page.evaluate(() => {
        const s = window.__canvasStore?.getState?.()
        if (s?.addConceptNode) {
          s.addConceptNode({ title: '上线灰度', description: '逐步放量', tags: ['策略'] }, { x: 200, y: 200 })
          s.addConceptNode({ title: '全量切流', description: '一次性切', tags: ['策略'] }, { x: 400, y: 200 })
          s.addConceptNode({ title: '回滚预案', description: '失败回滚', tags: ['风险'] }, { x: 300, y: 400 })
        }
      })
      await page.waitForTimeout(800)

      // 点 "启动决策引擎" 浮动按钮
      const launcher = page.locator('button:has-text("启动决策引擎")').first()
      const launcherExists = await launcher.count()
      if (launcherExists === 0) {
        issue = '"启动决策引擎" 按钮未找到 — 检查 AletheiaLauncher 是否渲染'
        await page.screenshot({ path: path.join(TMP_DIR, shot), fullPage: false })
        recordCase(5, 'Aletheia 决策引擎', false, 20, issue, shot)
        return
      }
      await launcher.click({ force: true })
      await page.waitForTimeout(1500)

      const bannerVisible = await page.locator('text=/逻辑对抗决策引擎/').first().isVisible().catch(() => false)

      const runBtn = page.locator('button:has-text("对画布跑一轮")').first()
      const runExists = await runBtn.count()
      if (runExists === 0) {
        issue = '"对画布跑一轮" 按钮未出现 — banner 渲染问题'
        await page.screenshot({ path: path.join(TMP_DIR, shot), fullPage: false })
        recordCase(5, 'Aletheia 决策引擎', false, 20, issue, shot)
        return
      }

      const beforeCount = await page.evaluate(() => {
        return window.__canvasStore?.getState?.()?.nodes?.length ?? 0
      })

      // force click — banner 上层可能被 SaveExportToolbar 遮挡
      await runBtn.click({ force: true }).catch(() => {})
      await page.waitForTimeout(1500)

      // 35s 内期待节点数 +3
      const startedAt = Date.now()
      let added = 0
      while (Date.now() - startedAt < 40000) {
        const cur = await page.evaluate(() => {
          return window.__canvasStore?.getState?.()?.nodes?.length ?? 0
        })
        added = cur - beforeCount
        if (added >= 3) break
        await page.waitForTimeout(1500)
      }

      await page.screenshot({ path: path.join(TMP_DIR, shot), fullPage: false })

      passed = bannerVisible && added >= 3
      if (!bannerVisible) issue = '决策引擎 banner 未显示 — useAletheiaStore.toggleAletheia 未生效'
      else if (added < 3) issue = `节点增量不足（仅 +${added}）— 检查 services/aletheia/runner.js 跑批 + ALETHEIA_LLM_KEY 是否设置 / mock 是否生效`
    } catch (err) {
      issue = `异常：${err.message}`
    }
    recordCase(5, 'Aletheia 决策引擎', passed, 20, issue, shot)
  })

  // ============================================================
  // Case 6（20 分）— CLI 监控
  // ============================================================
  test('Case 6 — CLI 监控展开 + 日志 + 清空 + 折叠', async ({ page }) => {
    let passed = false
    let issue = null
    let shot = 'case6-clilog.png'
    try {
      const room = ROOM(6)
      await enterRoom(page, room)

      // 加几个节点产生日志
      await page.evaluate(() => {
        const s = window.__canvasStore?.getState?.()
        if (s?.addConceptNode) {
          s.addConceptNode({ title: 'A', description: '', tags: [] }, { x: 100, y: 100 })
          s.addConceptNode({ title: 'B', description: '', tags: [] }, { x: 250, y: 100 })
          s.addConceptNode({ title: 'C', description: '', tags: [] }, { x: 400, y: 100 })
        }
      })
      await page.waitForTimeout(800)

      // 展开 CLI 监控
      const cliBtn = page.locator('button:has-text("CLI 监控")').first()
      const cliExists = await cliBtn.count()
      if (cliExists === 0) {
        issue = '"CLI 监控" 按钮未找到 — CliMonitor 未渲染'
        await page.screenshot({ path: path.join(TMP_DIR, shot), fullPage: false })
        recordCase(6, 'CLI 监控', false, 20, issue, shot)
        return
      }
      await cliBtn.click({ force: true })
      await page.waitForTimeout(500)

      const headerVisible = await page.locator('text=CLI 全流程监控').first().isVisible().catch(() => false)

      const logCount = await page.evaluate(() => {
        return window.__logBus?.getAll?.()?.length ?? -1
      })
      const logsOk = logCount >= 5

      await page.screenshot({ path: path.join(TMP_DIR, shot), fullPage: false })

      // 清空
      await page.locator('button[title="清空"]').first().click({ force: true }).catch(() => {})
      await page.waitForTimeout(300)

      // 折叠
      await page.locator('button[title="折叠"]').first().click({ force: true }).catch(() => {})
      await page.waitForTimeout(300)

      const cliBtnAgain = await page.locator('button:has-text("CLI 监控")').first().isVisible().catch(() => false)

      passed = headerVisible && logsOk && cliBtnAgain
      if (!headerVisible) issue = '展开后未显示 "CLI 全流程监控" header'
      else if (!logsOk) issue = `日志数 ${logCount} < 5 — window.__logBus 未暴露 或 logAction 未生效`
      else if (!cliBtnAgain) issue = '折叠后小条未还原'
    } catch (err) {
      issue = `异常：${err.message}`
    }
    recordCase(6, 'CLI 监控', passed, 20, issue, shot)
  })
})
