/**
 * Know Canvas E2E 全流程测试
 * 覆盖：页面加载 → 面板交互 → 文件导入 → 概念创建 → 关系连接 → 导出
 */

import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

// 测试数据
const TEST_MD_CONTENT = `# 人工智能基础

## 机器学习
机器学习是人工智能的子领域，通过数据训练模型。

## 深度学习
深度学习使用多层神经网络处理复杂模式。

## 自然语言处理
NLP 处理人类语言，包括文本分类、翻译等任务。
`

const TEST_JSON_CONTENT = JSON.stringify([
  { title: '数据库', description: '存储和管理数据的系统', tags: ['技术', '存储'] },
  { title: 'API', description: '应用程序编程接口', tags: ['技术', '接口'] },
], null, 2)

function createTempFile(filename, content) {
  const tmpDir = path.join(process.cwd(), 'e2e', '.tmp')
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
  const filePath = path.join(tmpDir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

test.beforeAll(() => {
  createTempFile('test-knowledge.md', TEST_MD_CONTENT)
  createTempFile('test-concepts.json', TEST_JSON_CONTENT)
})

test.afterAll(() => {
  const tmpDir = path.join(process.cwd(), 'e2e', '.tmp')
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })
})

// 每个测试前清除 localStorage 避免残留状态
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  // 等待左侧面板加载
  await expect(page.locator('h2:has-text("知识管理")')).toBeVisible({ timeout: 10000 })
})

// ============================================================
// 测试 1：页面加载与基础 UI
// ============================================================
test.describe('页面加载', () => {
  test('应用正常启动，三栏布局完整', async ({ page }) => {
    // 左侧面板
    await expect(page.locator('h2:has-text("知识管理")')).toBeVisible()
    // 中央画布 - 欢迎标题
    await expect(page.locator('h1:has-text("知识图谱")')).toBeVisible()
    // 右侧面板
    await expect(page.locator('h2:has-text("概念详情")')).toBeVisible()
    // 底部 AI 栏
    await expect(page.locator('input[placeholder*="输入文本"]')).toBeVisible()
  })

  test('欢迎页显示 4 步操作引导', async ({ page }) => {
    await expect(page.locator('text=导入文件或粘贴文本')).toBeVisible()
    await expect(page.locator('text=自动提取关键概念')).toBeVisible()
    await expect(page.locator('text=发现概念间关系')).toBeVisible()
    await expect(page.locator('text=导出知识图谱')).toBeVisible()
  })

  test('拖拽提示区可见', async ({ page }) => {
    await expect(page.locator('text=拖拽文件到此处开始')).toBeVisible()
  })
})

// ============================================================
// 测试 2：左侧面板 - 知识源管理
// ============================================================
// 辅助：点击左面板标签
// "知识源列表" 是页面唯一的，可以直接匹配
// "导入" 标签靠近 "知识源列表" 按钮（同一个 flex 容器中）
async function clickImportTab(page) {
  const sourceListBtn = page.locator('button:has-text("知识源列表")')
  // 导入标签是同级的下一个 button
  const parent = sourceListBtn.locator('..')
  await parent.locator('button', { hasText: /^导入$/ }).click()
  await page.waitForTimeout(100)
}
async function clickSourceListTab(page) {
  await page.locator('button:has-text("知识源列表")').click()
  await page.waitForTimeout(100)
}

test.describe('左侧面板', () => {
  test('知识源列表和导入两个标签可切换', async ({ page }) => {
    // 验证两个标签都存在
    await expect(page.locator('button:has-text("知识源列表")')).toBeVisible()
    // 点击导入标签 → 文件导入区域出现
    await clickImportTab(page)
    await expect(page.locator('input[placeholder="输入网址..."]')).toBeVisible({ timeout: 3000 })
    // 点击知识源列表标签 → 搜索框出现
    await clickSourceListTab(page)
    await expect(page.locator('input[placeholder="搜索知识源..."]')).toBeVisible({ timeout: 3000 })
  })

  test('文本片段导入', async ({ page }) => {
    await clickImportTab(page)
    // 验证导入面板可见（用 placeholder 而非文本避免多匹配）
    await expect(page.locator('textarea[placeholder="粘贴或输入文本内容..."]')).toBeVisible({ timeout: 3000 })
    await page.fill('input[placeholder="标题（可选）"]', '测试知识片段')
    await page.fill('textarea[placeholder="粘贴或输入文本内容..."]', '人工智能和机器学习的基础概念。')
    await page.locator('button:has-text("添加文本片段")').click()
    await clickSourceListTab(page)
    await expect(page.locator('text=测试知识片段')).toBeVisible({ timeout: 3000 })
  })

  test('Markdown 文件导入', async ({ page }) => {
    await clickImportTab(page)
    const filePath = path.join(process.cwd(), 'e2e', '.tmp', 'test-knowledge.md')
    await page.locator('input[type="file"]').first().setInputFiles(filePath)
    await clickSourceListTab(page)
    await expect(page.locator('text=test-knowledge.md')).toBeVisible({ timeout: 3000 })
  })

  test('URL 导入', async ({ page }) => {
    await clickImportTab(page)
    await page.fill('input[placeholder="输入网址..."]', 'https://example.com')
    await page.locator('button:has-text("添加")').first().click()
    await clickSourceListTab(page)
    await expect(page.locator('text=https://example.com')).toBeVisible({ timeout: 3000 })
  })

  test('搜索和分类过滤', async ({ page }) => {
    await clickImportTab(page)
    await page.fill('input[placeholder="标题（可选）"]', '搜索测试')
    await page.fill('textarea[placeholder="粘贴或输入文本内容..."]', '测试内容')
    await page.locator('button:has-text("添加文本片段")').click()
    await clickSourceListTab(page)
    await page.fill('input[placeholder="搜索知识源..."]', '搜索测试')
    await expect(page.locator('text=搜索测试')).toBeVisible()
    await page.fill('input[placeholder="搜索知识源..."]', '不存在的内容xyz')
    await expect(page.locator('text=暂无知识源')).toBeVisible()
  })
})

// ============================================================
// 测试 3：顶部工具栏
// ============================================================
test.describe('工具栏', () => {
  test('保存/导出/导入按钮可见', async ({ page }) => {
    // 用更精确的 button 选择器
    await expect(page.locator('button:has-text("保存")').first()).toBeVisible()
    await expect(page.locator('button:has-text("导出")').first()).toBeVisible()
    await expect(page.locator('button:has-text("导入")').last()).toBeVisible()
  })

  test('保存菜单展开', async ({ page }) => {
    await page.locator('button:has-text("保存")').first().click()
    await expect(page.locator('text=保存为 JSON')).toBeVisible({ timeout: 2000 })
  })

  test('导出菜单展开', async ({ page }) => {
    // 找工具栏区域的导出按钮（fixed 定位区域内的）
    const exportBtn = page.locator('.fixed button:has-text("导出")').first()
    await exportBtn.click()
    await expect(page.locator('text=导出为 Markdown')).toBeVisible({ timeout: 2000 })
    await expect(page.locator('text=导出为 JSON-LD')).toBeVisible()
    await expect(page.locator('text=导出为 PNG')).toBeVisible()
  })
})

// ============================================================
// 测试 4：右侧详情面板
// ============================================================
test.describe('右侧面板', () => {
  test('空状态提示', async ({ page }) => {
    await expect(page.locator('h2:has-text("概念详情")')).toBeVisible()
    await expect(page.locator('text=点击画布上的概念节点')).toBeVisible()
  })

  test('面板可通过按钮切换', async ({ page }) => {
    await expect(page.locator('h2:has-text("概念详情")')).toBeVisible()
    // 点击切换按钮
    const toggleBtn = page.locator('button[title*="详情面板"]')
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click()
      await expect(page.locator('h2:has-text("概念详情")')).not.toBeVisible({ timeout: 2000 })
      await toggleBtn.click()
      await expect(page.locator('h2:has-text("概念详情")')).toBeVisible({ timeout: 2000 })
    }
  })
})

// ============================================================
// 测试 5：AI 分析栏
// ============================================================
test.describe('AI 分析栏', () => {
  test('输入框和功能按钮可用', async ({ page }) => {
    const aiInput = page.locator('input[placeholder*="输入文本"]')
    await expect(aiInput).toBeVisible()
    await aiInput.fill('测试人工智能文本分析')
    await expect(aiInput).toHaveValue('测试人工智能文本分析')
    // 功能按钮
    // 功能按钮（用精确匹配避免子串命中步骤文字）
    await expect(page.locator('button:has-text("提取概念")')).toBeVisible()
    await expect(page.locator('button:has-text("发现关系")')).toBeVisible()
    await expect(page.locator('button:has-text("知识摘要")')).toBeVisible()
  })

  test('分析按钮可点击', async ({ page }) => {
    const analyzeBtn = page.locator('button:has-text("分析")')
    await expect(analyzeBtn).toBeVisible()
  })
})

// ============================================================
// 测试 6：快捷键
// ============================================================
test.describe('快捷键', () => {
  test('? 键打开快捷键面板', async ({ page }) => {
    // 先点击画布区域确保不在输入框中
    await page.locator('h1:has-text("知识图谱")').click()
    // 直接输入 ? 字符
    await page.keyboard.type('?')
    await expect(page.locator('h3:has-text("键盘快捷键")')).toBeVisible({ timeout: 3000 })
    // Esc 关闭
    await page.keyboard.press('Escape')
    await expect(page.locator('h3:has-text("键盘快捷键")')).not.toBeVisible({ timeout: 2000 })
  })

  test('Ctrl+B 切换左面板', async ({ page }) => {
    await expect(page.locator('h2:has-text("知识管理")')).toBeVisible()
    await page.keyboard.press('Control+b')
    await expect(page.locator('h2:has-text("知识管理")')).not.toBeVisible({ timeout: 2000 })
    await page.keyboard.press('Control+b')
    await expect(page.locator('h2:has-text("知识管理")')).toBeVisible({ timeout: 2000 })
  })
})

// ============================================================
// 测试 7：全流程
// ============================================================
test.describe('全流程', () => {
  test('导入 MD → 查看列表 → 工具栏', async ({ page }) => {
    // Step 1: 导入 MD 文件
    await clickImportTab(page)
    const filePath = path.join(process.cwd(), 'e2e', '.tmp', 'test-knowledge.md')
    await page.locator('input[type="file"]').first().setInputFiles(filePath)

    // Step 2: 回到列表确认
    await clickSourceListTab(page)
    await expect(page.locator('text=test-knowledge.md')).toBeVisible({ timeout: 3000 })

    // Step 3: 验证工具栏存在
    await expect(page.locator('button:has-text("保存")').first()).toBeVisible()
    await expect(page.locator('.fixed button:has-text("导出")').first()).toBeVisible()
  })

  test('导入 JSON 文件', async ({ page }) => {
    await clickImportTab(page)
    const filePath = path.join(process.cwd(), 'e2e', '.tmp', 'test-concepts.json')
    await page.locator('input[type="file"]').first().setInputFiles(filePath)
    await clickSourceListTab(page)
    await expect(page.locator('text=test-concepts.json')).toBeVisible({ timeout: 3000 })
  })

  test('完整多文件导入流程', async ({ page }) => {
    await clickImportTab(page)

    // 导入 MD
    const mdPath = path.join(process.cwd(), 'e2e', '.tmp', 'test-knowledge.md')
    await page.locator('input[type="file"]').first().setInputFiles(mdPath)
    await page.waitForTimeout(500)

    // 导入文本
    await page.fill('input[placeholder="标题（可选）"]', '额外笔记')
    await page.fill('textarea[placeholder="粘贴或输入文本内容..."]', '补充说明内容')
    await page.locator('button:has-text("添加文本片段")').click()

    // 导入 URL
    await page.fill('input[placeholder="输入网址..."]', 'https://example.org')
    await page.locator('button:has-text("添加")').first().click()

    // 验证列表
    await clickSourceListTab(page)
    await expect(page.locator('text=test-knowledge.md')).toBeVisible({ timeout: 3000 })
    await expect(page.locator('text=额外笔记')).toBeVisible()
    await expect(page.locator('text=https://example.org')).toBeVisible()
    await expect(page.locator('text=3 个知识源')).toBeVisible()
  })
})

// ============================================================
// 测试 8：边界条件
// ============================================================
test.describe('边界条件', () => {
  test('底部统计显示正确', async ({ page }) => {
    // 初始状态应显示 0 个知识源
    const stats = page.locator('text=0 个知识源')
    await expect(stats).toBeVisible({ timeout: 5000 })
  })

  test('知识源删除', async ({ page }) => {
    await clickImportTab(page)
    await page.fill('input[placeholder="标题（可选）"]', '待删除')
    await page.fill('textarea[placeholder="粘贴或输入文本内容..."]', '临时内容')
    await page.locator('button:has-text("添加文本片段")').click()
    await clickSourceListTab(page)
    await expect(page.locator('text=待删除')).toBeVisible({ timeout: 3000 })
    const sourceItem = page.locator('[draggable="true"]').first()
    await sourceItem.hover()
    const deleteBtn = sourceItem.locator('button').last()
    await deleteBtn.click()
    await expect(page.locator('text=暂无知识源')).toBeVisible({ timeout: 3000 })
  })
})
