/**
 * Hermes 终端 log → worker 输出文本 提取器
 *
 * 现实: hermes task done 后 task.result === null, worker 的回答只在
 *   GET /api/plugins/kanban/tasks/:id/log 的 content 里, 包在
 *
 *     ╭─ ⚕ Hermes ─...─╮
 *         worker 的回答文字 (可能多行)
 *     ╰────────────────╯
 *
 *   这种 box-drawing 块里. 同一 log 通常有多个块 (思考 + 工具调用 + 最终输出),
 *   最后一个块就是用户该看到的回答.
 *
 * 用法:
 *   const { parseHermesLog } = require('./hermes-log-parser')
 *   const text = parseHermesLog(logResp.content)
 *   if (text) console.log('worker 输出:', text)
 *
 * 已知坑:
 *   - hermes log 含 ANSI escape (\x1b[..m) 跟 unicode box-drawing
 *   - 部分块带左右 │ 框线, 部分块只有顶底 ╭╯ + 缩进
 *   - 4-6 空格 / 全角空格 / 制表符 缩进都见过, 统一 strip
 */

// 匹配 ╭─ ⚕ Hermes ─...─╮  (Hermes 输出块的开头)
// 然后非贪婪匹配中间内容, 直到下一个 ╰─...─╯
const HERMES_BLOCK_RE = /╭─\s*⚕?\s*Hermes\s*─[^\n]*\n([\s\S]*?)╰─[─]*╯/g

/** 去 ANSI escape codes */
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
}

/** 单行去前导 / 尾部空白 + box-drawing 框线字符 */
function cleanLine(line) {
  return line
    .replace(/^[\s│┃║]+/, '')
    .replace(/[\s│┃║]+$/, '')
}

/**
 * 从 hermes task log content 提取 worker 的最终输出文本
 *
 * @param {string} logContent - GET /api/plugins/kanban/tasks/:id/log 返回的 content
 * @returns {string|null} 提取的文本, 没找到返回 null
 */
function parseHermesLog(logContent) {
  if (!logContent || typeof logContent !== 'string') return null

  const noAnsi = stripAnsi(logContent)
  const blocks = [...noAnsi.matchAll(HERMES_BLOCK_RE)]
  if (blocks.length === 0) return null

  // 取最后一个 ⚕ Hermes 块 (worker 的最终回答)
  const lastBody = blocks[blocks.length - 1][1]

  const cleaned = lastBody
    .split('\n')
    .map(cleanLine)
    .filter((line) => line.length > 0)
    .join('\n')
    .trim()

  return cleaned || null
}

/**
 * 提取所有 Hermes 块 (调试用 — 看 worker 一步步在干什么)
 * @returns {string[]}
 */
function parseAllHermesBlocks(logContent) {
  if (!logContent || typeof logContent !== 'string') return []
  const noAnsi = stripAnsi(logContent)
  const blocks = [...noAnsi.matchAll(HERMES_BLOCK_RE)]
  return blocks.map((m) => {
    return m[1]
      .split('\n')
      .map(cleanLine)
      .filter((line) => line.length > 0)
      .join('\n')
      .trim()
  }).filter(Boolean)
}

/**
 * 从 task log 提取 session metadata (Resume / Duration / Messages 等)
 * 返回 { sessionId, duration, messages, resumeCmd } 或 {}
 */
function parseHermesSessionMeta(logContent) {
  if (!logContent || typeof logContent !== 'string') return {}
  const noAnsi = stripAnsi(logContent)
  const meta = {}
  const m1 = noAnsi.match(/Session:\s*(\S+)/)
  if (m1) meta.sessionId = m1[1]
  const m2 = noAnsi.match(/Duration:\s*([0-9]+\s*\w+)/)
  if (m2) meta.duration = m2[1]
  const m3 = noAnsi.match(/Messages:\s*(\d+)\s*\(([^)]*)\)/)
  if (m3) { meta.messages = parseInt(m3[1], 10); meta.messagesDetail = m3[2] }
  const m4 = noAnsi.match(/hermes --resume (\S+)/)
  if (m4) meta.resumeCmd = `hermes --resume ${m4[1]}`
  return meta
}

module.exports = { parseHermesLog, parseAllHermesBlocks, parseHermesSessionMeta, stripAnsi }
