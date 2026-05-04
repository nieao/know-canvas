/**
 * Feishu Bot Daemon — long-polling event consume + 自动响应群消息
 *
 * 架构: spawn `lark-cli event consume im.message.receive_v1 --as bot`,
 *       NDJSON 一行一条 message event, 解析后:
 *       - 含飞书 doc URL → 调 source-proxy /feishu/fetch 验证, reply "✓ 已记录: {title}"
 *       - 含 notion URL → 调 source-proxy /notion/fetch 验证, reply "✓ 已记录: {title}"
 *       - "/help" → reply 命令帮助
 *       - 其他 → 可选 echo (静默)
 *
 * 启动: npm run feishubot   (默认连 http://127.0.0.1:17090 source-proxy)
 *       SOURCE_PROXY=http://localhost:17090 node server/feishu-bot.mjs
 *
 * 依赖:
 *   - lark-cli 已 auth (root 用户, 至 2026-05-11)
 *   - bot 已被拉进至少 1 个群 (否则 event consume 收不到任何东西)
 *   - source-proxy daemon 在跑 (17090)
 *
 * 沉淀的坑 (见 ~/.claude/projects/E--claude-code-know-canvas/memory/reference_lark_bot_setup.md):
 *   - .content 已经预渲染成纯文本, 不用 JSON.parse
 *   - 必须用 SIGTERM, 绝不能 kill -9 (会泄漏服务端订阅)
 *   - 在 pipe 里用 --as bot 可能被忽略 (issue #41), 用 spawn 直接传参没问题
 */

import { spawn } from 'node:child_process'
import readline from 'node:readline'

const SOURCE_PROXY = process.env.SOURCE_PROXY || 'http://127.0.0.1:17090'
const LARK_BIN = process.env.LARK_CLI || 'lark-cli'
const EVENT_KEY = 'im.message.receive_v1'

function log(...args) {
  console.log('[feishu-bot]', new Date().toISOString().slice(11, 19), ...args)
}

function logErr(...args) {
  console.error('[feishu-bot]', new Date().toISOString().slice(11, 19), 'ERROR', ...args)
}

// === 消息内容里抽 URL ===
const FEISHU_URL_RE = /(https?:\/\/(?:[a-z0-9-]+\.)?(?:feishu\.cn|larksuite\.com)\/(?:wiki|docx|sheets|base|file)\/[A-Za-z0-9_-]+)/gi
const NOTION_URL_RE = /(https?:\/\/(?:www\.)?notion\.so\/[^\s<>]+)/gi

// === source-proxy 调用 helper ===
async function proxyPost(path, body, timeout = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(`${SOURCE_PROXY}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const j = await r.json().catch(() => ({ ok: false, error: 'invalid json from proxy' }))
    return j
  } finally {
    clearTimeout(t)
  }
}

// === 用 lark-cli 回复消息 (text mode, 不走 markdown 重排) ===
function replyMessage(messageId, text) {
  return new Promise((resolve) => {
    const proc = spawn(
      LARK_BIN,
      ['im', '+messages-reply', '--message-id', messageId, '--text', text, '--as', 'bot'],
      { windowsHide: true },
    )
    let out = ''
    let err = ''
    proc.stdout.on('data', (b) => { out += b.toString('utf8') })
    proc.stderr.on('data', (b) => { err += b.toString('utf8') })
    proc.on('close', (code) => {
      if (code !== 0) logErr('reply 失败:', err.slice(0, 200) || out.slice(0, 200))
      resolve(code === 0)
    })
    proc.on('error', (e) => { logErr('reply spawn 失败:', e.message); resolve(false) })
  })
}

// === 处理一条 message event ===
async function handleMessage(evt) {
  // im.message.receive_v1 是扁平 schema (字段在顶层), 不是 envelope
  const messageId = evt.message_id || ''
  const chatId = evt.chat_id || ''
  const senderId = evt.sender_id || ''
  const messageType = evt.message_type || 'text'
  const content = String(evt.content || '').trim()

  if (!messageId || !content) return // 不能识别的消息, 跳过

  log(`收到 ${messageType} chat=${chatId.slice(0, 12)}: ${content.slice(0, 80)}`)

  // /help 命令
  if (/^\s*\/help\b/i.test(content)) {
    await replyMessage(messageId, [
      '📖 [Aletheia-项目] bot 命令:',
      '',
      '· 直接发飞书/Notion 链接 → 自动记录到画布',
      '· /help → 这个帮助',
      '· /status → 看 source-proxy 状态',
      '',
      '画布: https://canvas.digitalvio.shop/canvas/',
    ].join('\n'))
    return
  }

  if (/^\s*\/status\b/i.test(content)) {
    try {
      const r = await fetch(`${SOURCE_PROXY}/health`).then((x) => x.json())
      await replyMessage(messageId, `source-proxy: ${r.ok ? '✓ 在线' : '✗ 异常'} (port ${r.port})`)
    } catch (e) {
      await replyMessage(messageId, `source-proxy: ✗ 不可达 (${e.message})`)
    }
    return
  }

  // 找飞书 URL
  const feishuUrls = [...content.matchAll(FEISHU_URL_RE)].map((m) => m[1])
  for (const url of feishuUrls.slice(0, 3)) { // 限 3 个防 DoS
    try {
      const j = await proxyPost('/feishu/fetch', { docUrl: url })
      if (j.ok) {
        const title = j.data?.title || '(无标题)'
        const len = (j.data?.content || '').length
        await replyMessage(messageId, `✓ 飞书已记录: ${title} (${len} 字符)\n→ 打开画布看节点`)
        log(`飞书导入成功: ${url} → ${title}`)
      } else {
        await replyMessage(messageId, `✗ 飞书导入失败: ${j.error || '未知错误'}`)
        logErr('飞书 fetch 失败:', j.error)
      }
    } catch (e) {
      await replyMessage(messageId, `✗ 飞书导入异常: ${e.message}`)
      logErr('飞书 fetch 异常:', e.message)
    }
  }

  // 找 Notion URL
  const notionUrls = [...content.matchAll(NOTION_URL_RE)].map((m) => m[1])
  for (const url of notionUrls.slice(0, 3)) {
    try {
      const j = await proxyPost('/notion/fetch', { pageUrl: url })
      if (j.ok) {
        const title = j.data?.title || '(无标题)'
        const len = (j.data?.content || '').length
        await replyMessage(messageId, `✓ Notion 已记录: ${title} (${len} 字符)`)
        log(`Notion 导入成功: ${url} → ${title}`)
      } else {
        await replyMessage(messageId, `✗ Notion 导入失败: ${j.error || '未知错误'}`)
      }
    } catch (e) {
      await replyMessage(messageId, `✗ Notion 导入异常: ${e.message}`)
    }
  }
}

// === 主入口 ===
function start() {
  log(`启动 bot daemon — source-proxy: ${SOURCE_PROXY}, EventKey: ${EVENT_KEY}`)

  const consumer = spawn(
    LARK_BIN,
    ['event', 'consume', EVENT_KEY, '--as', 'bot', '--quiet'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  )

  // 关键: 不能让 stdin 是 null 否则 lark-cli 当成 EOF 秒退
  // 写入一个不会关闭的可读流 (空数据流)
  // (systemd 配 StandardInput=tty-fail 也 ok, 但这里防御性挂个永不结束的)
  consumer.stdin.on('error', () => {}) // 忽略 stdin 错误

  const rl = readline.createInterface({ input: consumer.stdout })
  rl.on('line', async (line) => {
    if (!line.trim()) return
    let evt
    try { evt = JSON.parse(line) } catch (e) {
      logErr('NDJSON 解析失败:', line.slice(0, 200))
      return
    }
    try { await handleMessage(evt) } catch (e) {
      logErr('handleMessage 异常:', e.message, e.stack?.slice(0, 200))
    }
  })

  consumer.stderr.on('data', (b) => {
    const s = b.toString('utf8').trim()
    if (s) log('lark-cli stderr:', s.slice(0, 200))
  })

  consumer.on('error', (e) => { logErr('consumer spawn 失败:', e.message); process.exit(1) })
  consumer.on('exit', (code, sig) => {
    logErr(`consumer 退出 code=${code} sig=${sig} — 5s 后重启`)
    setTimeout(start, 5000) // 自愈重启
  })

  // 关键: SIGTERM/SIGINT 时优雅杀掉 consumer (绝不能 SIGKILL, 会泄漏服务端订阅)
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      log(`收到 ${sig}, 优雅退出 consumer`)
      try { consumer.kill('SIGTERM') } catch {}
      setTimeout(() => process.exit(0), 1500)
    })
  }
}

start()
