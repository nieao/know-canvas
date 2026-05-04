/**
 * Feishu Bot Daemon — long-polling event subscribe + 互动卡片双向回复
 *
 * 架构:
 *   1) spawn `lark-cli event +subscribe --as bot` (catch-all NDJSON)
 *      同时收 im.message.receive_v1 (用户消息) + card.action.trigger (按钮点击)
 *   2) 命令路由 (在群里 @bot 或私聊):
 *      /help                    → 帮助卡片
 *      /status                  → source-proxy + canvas 状态卡
 *      /room <name>             → 把当前会话绑定到指定 canvas room (per chat 持久内存)
 *      /room                    → 看当前 chat 绑的 room (默认 feishu-inbox)
 *      /canvas <text>           → 直接写文本节点
 *      /canvas <URL>            → 写 bookmark 节点 (带 URL)
 *      /aletheia <topic>        → (TODO) 触发元认知 5 步; 当前先写 paragraph 占位
 *      含飞书/Notion URL        → 自动 fetch 标题摘要 → 写 bookmark 卡片确认
 *      其它纯文本               → 弹 "写到画布?" 选择卡 (按钮 callback 决定)
 *
 *   3) 每条回复都是 interactive 卡片:
 *      - 单纯成功 → "打开画布" 跳转链接按钮 (URL action)
 *      - 待确认/路由选择 → "确认写入" / "换房间" / "取消" callback 按钮
 *      - 帮助/状态 → 信息卡 + 跳转链接
 *
 * 启动:  npm run feishubot    (默认连 http://127.0.0.1:17090 source-proxy)
 *
 * 依赖:
 *   - lark-cli 已 auth as bot (cli_a97294f03cf89cef Aletheia-bot)
 *   - bot 已被拉进至少 1 个群
 *   - source-proxy daemon 在跑 + yjs-cast 已加载 + y-ws-server 在 1234 在跑
 *
 * 沉淀的坑 (见 ~/.claude/projects/E--claude-code-know-canvas/memory/reference_lark_bot_setup.md):
 *   - .content 已经预渲染成纯文本, 不用 JSON.parse
 *   - 必须用 SIGTERM, 绝不能 kill -9 (会泄漏服务端订阅)
 *   - lark-cli event 子命令是 +subscribe (不是 consume), --as bot
 *   - card 的 callback action 触发的是 card.action.trigger 事件, 含 action.value 自定义负载
 */

import { spawn } from 'node:child_process'
import readline from 'node:readline'
import path from 'node:path'
import os from 'node:os'

const SOURCE_PROXY = process.env.SOURCE_PROXY || 'http://127.0.0.1:17090'
const CANVAS_PUBLIC_URL = process.env.CANVAS_PUBLIC_URL || 'https://ha2.digitalvio.shop/canvas/'
const DEFAULT_ROOM = process.env.CANVAS_DEFAULT_ROOM || 'demo-final'

// 直接定位 lark-cli 原生 .exe 二进制 (Go 编译), 绕开 cmd.exe wrapper
// (cmd.exe /c 包装会按 GBK 解读 lark-cli stdout 把 UTF-8 中文搞乱; 直接 spawn .exe 走 Node native unicode)
function resolveLarkBin() {
  if (process.env.LARK_CLI_BIN) return process.env.LARK_CLI_BIN
  if (process.platform === 'win32') {
    const npmRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(npmRoot, 'npm', 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe')
  }
  // 类 Unix: 默认包内二进制 / 或 PATH 上的 lark-cli
  return process.env.LARK_CLI || 'lark-cli'
}
const LARK_BIN = resolveLarkBin()

function spawnLark(args, opts = {}) {
  return spawn(LARK_BIN, args, { windowsHide: true, ...opts })
}

function log(...args) {
  console.log('[feishu-bot]', new Date().toISOString().slice(11, 19), ...args)
}
function logErr(...args) {
  console.error('[feishu-bot]', new Date().toISOString().slice(11, 19), 'ERROR', ...args)
}

// === 消息内容里抽 URL ===
const FEISHU_URL_RE = /(https?:\/\/(?:[a-z0-9-]+\.)?(?:feishu\.cn|larksuite\.com)\/(?:wiki|docx|sheets|base|file)\/[A-Za-z0-9_-]+)/gi
const NOTION_URL_RE = /(https?:\/\/(?:www\.)?notion\.so\/[^\s<>]+)/gi
const ANY_URL_RE = /(https?:\/\/[^\s<>"']+)/gi

// === 每个 chat 绑的 canvas room (in-memory; 重启失效 ok 因为有默认值) ===
const chatRoomMap = new Map() // chat_id → room_name
function roomOf(chatId) {
  return chatRoomMap.get(chatId) || DEFAULT_ROOM
}

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
    return await r.json().catch(() => ({ ok: false, error: 'invalid json from proxy' }))
  } finally {
    clearTimeout(t)
  }
}

async function proxyGet(path, timeout = 5000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(`${SOURCE_PROXY}${path}`, { signal: ctrl.signal })
    return await r.json().catch(() => ({ ok: false, error: 'invalid json from proxy' }))
  } finally {
    clearTimeout(t)
  }
}

// === 互动卡片 schema 构造 ===
// Lark 卡片协议 (schema 2.0): { config, header, elements }
// elements 里:
//   - div: 段落
//   - markdown: 富文本
//   - action: 按钮组 ({tag:"action", actions:[{tag:"button", text:..., type:..., url? value?}]})
//     button.type: primary / default / danger; url 字段触发跳转, value 触发 card.action.trigger
function buildCard({ title, header = 'gray', body = [], buttons = [] }) {
  const card = {
    config: { wide_screen_mode: true },
    header: title ? {
      template: header,  // gray / blue / green / red / orange / yellow / turquoise / purple
      title: { tag: 'plain_text', content: title },
    } : undefined,
    elements: [],
  }
  for (const b of body) {
    if (typeof b === 'string') {
      card.elements.push({ tag: 'markdown', content: b })
    } else if (b.tag) {
      card.elements.push(b)
    }
  }
  if (buttons.length > 0) {
    card.elements.push({
      tag: 'action',
      actions: buttons.map((btn) => {
        const a = {
          tag: 'button',
          text: { tag: 'plain_text', content: btn.text },
          type: btn.type || 'default',
        }
        if (btn.url) a.url = btn.url
        if (btn.value) a.value = btn.value  // callback 触发 card.action.trigger
        return a
      }),
    })
  }
  if (!card.header) delete card.header
  return card
}

// 标准 "已写入" 成功卡 (跳转打开画布)
function cardCastSuccess({ what, room, nodeId, canvasUrl }) {
  return buildCard({
    title: '✓ 已写入画布',
    header: 'green',
    body: [
      `**${what}**`,
      `房间: \`${room}\` · 节点: \`${nodeId.slice(0, 24)}\``,
    ],
    buttons: [
      { text: '打开画布', type: 'primary', url: canvasUrl },
      { text: '换个房间', type: 'default', value: { action: 'switch_room' } },
    ],
  })
}

function cardCastFailed({ what, error }) {
  return buildCard({
    title: '✗ 写入失败',
    header: 'red',
    body: [
      `**${what}**`,
      `错误: ${error}`,
      '可能原因: yjs-cast 未启动 / source-proxy 离线 / room 不可达',
    ],
    buttons: [
      { text: '重试', type: 'primary', value: { action: 'retry' } },
      { text: '查状态', type: 'default', value: { action: 'status' } },
    ],
  })
}

// 待确认卡 (用户发了一段话, 让用户确认写哪个房间)
function cardConfirmCast({ text, room }) {
  const preview = text.length > 200 ? text.slice(0, 200) + '...' : text
  return buildCard({
    title: '写入画布?',
    header: 'blue',
    body: [
      `> ${preview.replace(/\n/g, '\n> ')}`,
      `**目标房间**: \`${room}\``,
    ],
    buttons: [
      { text: '✓ 写入', type: 'primary', value: { action: 'confirm_text', text, room } },
      { text: '换房间', type: 'default', value: { action: 'switch_room', text } },
      { text: '取消', type: 'default', value: { action: 'cancel' } },
    ],
  })
}

function cardHelp() {
  return buildCard({
    title: '📖 Aletheia 画布 bot',
    header: 'turquoise',
    body: [
      '**命令**',
      '`/canvas <文本>` — 写文本节点',
      '`/canvas <URL>` — 写链接节点',
      '`/aletheia <话题>` — 启动元认知 5 步 (开发中)',
      '`/room <名字>` — 切换当前会话绑的画布房间',
      '`/status` — 看后端状态',
      '`/help` — 显示这个帮助',
      '',
      '**直接发**',
      '· 飞书/Notion 链接 → 自动 fetch 标题写入',
      '· 其它纯文本 → 弹"写入?"按钮卡',
    ],
    buttons: [
      { text: '打开画布', type: 'primary', url: CANVAS_PUBLIC_URL + `?room=${DEFAULT_ROOM}` },
    ],
  })
}

async function cardStatus() {
  const lines = ['**后端服务状态**']
  let ok = true
  try {
    const h = await proxyGet('/health', 3000)
    lines.push(`source-proxy: ${h.ok ? '✓ 在线' : '✗ 异常'} (port ${h.port})`)
  } catch (e) {
    ok = false
    lines.push(`source-proxy: ✗ 不可达 (${e.message})`)
  }
  try {
    const c = await proxyGet('/canvas/status', 3000)
    lines.push(`yjs-cast: ${c.castReady ? '✓ 就绪' : '✗ 未加载'}`)
    lines.push(`yjs-ws: \`${c.yjsWs}\``)
    lines.push(`默认房间: \`${c.defaultRoom}\``)
  } catch (e) {
    ok = false
    lines.push(`yjs-cast: ✗ 不可达 (${e.message})`)
  }
  return buildCard({
    title: ok ? '⚙ 系统状态' : '⚠ 部分服务异常',
    header: ok ? 'green' : 'orange',
    body: lines,
    buttons: [
      { text: '打开画布', type: 'primary', url: CANVAS_PUBLIC_URL },
      { text: '刷新', type: 'default', value: { action: 'status' } },
    ],
  })
}

// === 用 lark-cli 回复消息 (interactive card) ===
function reply(messageId, card, { textFallback } = {}) {
  return new Promise((resolve) => {
    const args = [
      'im', '+messages-reply',
      '--message-id', messageId,
      '--msg-type', 'interactive',
      '--content', JSON.stringify(card),
      '--as', 'bot',
    ]
    const proc = spawnLark(args)
    let out = ''
    let err = ''
    proc.stdout.on('data', (b) => { out += b.toString('utf8') })
    proc.stderr.on('data', (b) => { err += b.toString('utf8') })
    proc.on('close', (code) => {
      if (code !== 0) {
        logErr('reply 失败:', err.slice(0, 300) || out.slice(0, 300))
        // 失败 fallback 用 text 回复
        if (textFallback) replyText(messageId, textFallback).then(resolve)
        else resolve(false)
      } else resolve(true)
    })
    proc.on('error', (e) => { logErr('reply spawn 失败:', e.message); resolve(false) })
  })
}

function replyText(messageId, text) {
  return new Promise((resolve) => {
    const proc = spawnLark(['im', '+messages-reply', '--message-id', messageId, '--text', text, '--as', 'bot'])
    proc.on('close', () => resolve(true))
    proc.on('error', () => resolve(false))
  })
}

// 给 chat 主动发卡 (callback 后无 message-id 用)
function sendCard(chatId, card) {
  return new Promise((resolve) => {
    const args = [
      'im', '+messages-send',
      '--chat-id', chatId,
      '--msg-type', 'interactive',
      '--content', JSON.stringify(card),
      '--as', 'bot',
    ]
    const proc = spawnLark(args)
    let err = ''
    proc.stderr.on('data', (b) => { err += b.toString('utf8') })
    proc.on('close', (code) => {
      if (code !== 0) logErr('sendCard 失败:', err.slice(0, 300))
      resolve(code === 0)
    })
    proc.on('error', (e) => { logErr('sendCard spawn 失败:', e.message); resolve(false) })
  })
}

// === 命令处理 ===
async function handleMessage(evt) {
  // im.message.receive_v1 在 lark-cli +subscribe 输出里是 {event_type, ...flatFields}
  // 但 envelope 形态也有: {event: {message: {...}}}; 兼容两种
  const evtType = evt.event_type || evt.header?.event_type || ''
  if (evtType && evtType !== 'im.message.receive_v1' && evtType !== 'card.action.trigger') {
    return // 忽略其他 event
  }

  if (evtType === 'card.action.trigger') {
    return handleCardAction(evt)
  }

  // 提取 message 字段 (兼容扁平 + envelope)
  const msg = evt.message || evt
  const messageId = msg.message_id || ''
  const chatId = msg.chat_id || ''
  const senderId = msg.sender_id || msg.sender?.sender_id?.open_id || ''
  let content = String(msg.content || '').trim()

  // 飞书 content 有时是 JSON {text: ".."}, 有时是裸字符串. 尝试 parse
  if (content.startsWith('{') && content.includes('"text"')) {
    try {
      const parsed = JSON.parse(content)
      if (parsed.text) content = String(parsed.text).trim()
    } catch {}
  }

  if (!messageId || !content) return

  // 群里 @bot 时 content 头会带 @_user_X 或 @ALL 的字符, 简单清掉
  content = content.replace(/^@[^\s]+\s+/, '').trim()

  log(`[msg] chat=${chatId.slice(0, 12)} sender=${senderId.slice(0, 12)}: ${content.slice(0, 80)}`)

  const room = roomOf(chatId)
  const attribution = { name: senderId.slice(0, 16) || 'feishu', via: 'feishu-bot', chatId }

  // === 元命令: /help /status /room — 用纯文本回 (绕开互动卡片可能的乱码) ===
  if (/^\/help\b/i.test(content)) {
    await replyText(messageId, [
      'Aletheia 画布 bot — 直接发任何文字,自动启动元认知 5 步',
      '',
      '· 文字消息  → 落入画布对话框 + 自动启动元认知',
      '· 链接 (飞书/Notion/任意 URL) → 写成画布书签节点',
      '· /room <名字> → 切本群绑的画布房间',
      '· /status → 看后端状态',
      '· /help → 这条帮助',
      '',
      `画布: ${CANVAS_PUBLIC_URL}?room=${encodeURIComponent(room)}`,
    ].join('\n'))
    return
  }

  if (/^\/status\b/i.test(content)) {
    let lines = ['后端状态']
    try {
      const h = await proxyGet('/health', 3000)
      lines.push(`source-proxy: ${h.ok ? '✓ 在线' : '✗ 异常'} (port ${h.port})`)
    } catch (e) { lines.push(`source-proxy: ✗ 不可达`) }
    try {
      const c = await proxyGet('/canvas/status', 3000)
      lines.push(`yjs-cast: ${c.castReady ? '✓ 就绪' : '✗ 未加载'}`)
      lines.push(`默认房间: ${c.defaultRoom}`)
    } catch (e) { lines.push(`yjs-cast: ✗ 不可达`) }
    lines.push(`本群房间: ${room}`)
    await replyText(messageId, lines.join('\n'))
    return
  }

  const roomMatch = content.match(/^\/room(?:\s+(.+))?$/i)
  if (roomMatch) {
    const newRoom = (roomMatch[1] || '').trim()
    if (newRoom) {
      chatRoomMap.set(chatId, newRoom)
      await replyText(messageId, `✓ 本群房间切到: ${newRoom}\n打开: ${CANVAS_PUBLIC_URL}?room=${encodeURIComponent(newRoom)}`)
    } else {
      await replyText(messageId, `当前本群房间: ${room}\n打开: ${CANVAS_PUBLIC_URL}?room=${encodeURIComponent(room)}`)
    }
    return
  }

  // === 链接消息 → 画布书签节点 (含飞书 / Notion 自动 fetch 标题) ===
  const feishuUrls = [...content.matchAll(FEISHU_URL_RE)].map((m) => m[1])
  const notionUrls = [...content.matchAll(NOTION_URL_RE)].map((m) => m[1])
  const otherUrls = [...content.matchAll(ANY_URL_RE)].map((m) => m[1])
    .filter((u) => !feishuUrls.includes(u) && !notionUrls.includes(u))

  let handledAsLink = false
  for (const u of feishuUrls.slice(0, 2)) {
    handledAsLink = true
    try {
      const j = await proxyPost('/feishu/fetch', { docUrl: u })
      const title = j.ok ? (j.data?.title || u) : u
      const summary = j.ok ? String(j.data?.content || '').slice(0, 400) : ''
      const r = await proxyPost('/canvas/cast/bookmark', { room, url: u, title, summary, attribution })
      if (r.ok) await replyText(messageId, `✓ 飞书已记录: ${title}\n打开: ${r.canvasUrl}`)
      else await replyText(messageId, `✗ 飞书写入失败: ${r.error || '未知'}`)
    } catch (e) { await replyText(messageId, `✗ 飞书链接异常: ${e.message}`) }
  }
  for (const u of notionUrls.slice(0, 2)) {
    handledAsLink = true
    try {
      const j = await proxyPost('/notion/fetch', { pageUrl: u })
      const title = j.ok ? (j.data?.title || u) : u
      const summary = j.ok ? String(j.data?.content || '').slice(0, 400) : ''
      const r = await proxyPost('/canvas/cast/bookmark', { room, url: u, title, summary, attribution })
      if (r.ok) await replyText(messageId, `✓ Notion 已记录: ${title}\n打开: ${r.canvasUrl}`)
      else await replyText(messageId, `✗ Notion 写入失败: ${r.error || '未知'}`)
    } catch (e) { await replyText(messageId, `✗ Notion 链接异常: ${e.message}`) }
  }
  for (const u of otherUrls.slice(0, 2)) {
    handledAsLink = true
    const r = await proxyPost('/canvas/cast/bookmark', { room, url: u, title: u, summary: '', attribution })
    if (r.ok) await replyText(messageId, `✓ 链接已记录\n打开: ${r.canvasUrl}`)
  }
  if (handledAsLink) return

  // === 默认: 纯文本 → 写入 aletheia-inbox, 让画布前端自动启动元认知 ===
  // 短消息 < 4 字视为闲聊, 不触发 (避免 "嗯", "好的" 等触发 LLM)
  if (content.length < 4) return
  try {
    const r = await proxyPost('/canvas/cast/aletheia-prompt', { room, text: content, attribution })
    if (r.ok) {
      const peers = (r.peers ?? 0)
      const tip = peers > 0
        ? `当前画布在线 ${peers} 人, 即将自动启动元认知 5 步`
        : `当前画布暂无人在线, 一旦有人打开会自动启动 (或你直接打开)`
      await replyText(messageId, `✓ 已送入元认知\n${tip}\n打开: ${r.canvasUrl}`)
    } else {
      await replyText(messageId, `✗ 写入失败: ${r.error || '未知'}`)
    }
  } catch (e) {
    await replyText(messageId, `✗ 异常: ${e.message}`)
  }
}

// === 处理按钮回调 ===
async function handleCardAction(evt) {
  // card.action.trigger schema: {operator, token, action: {value, tag, ...}, open_message_id, open_chat_id}
  const ev = evt.event || evt
  const action = ev.action || {}
  const value = action.value || {}
  const chatId = ev.open_chat_id || ev.chat_id || ''
  const messageId = ev.open_message_id || ev.message_id || ''
  const operatorId = ev.operator?.open_id || ev.operator_id || ''

  log(`[card-action] chat=${chatId.slice(0, 12)} action=${value.action || '?'}`)

  if (!value.action) return

  switch (value.action) {
    case 'confirm_text': {
      const room = value.room || roomOf(chatId)
      const text = value.text || ''
      if (!text) return
      const r = await proxyPost('/canvas/cast/text', {
        room, text,
        attribution: { name: operatorId.slice(0, 16) || 'feishu', via: 'feishu-bot', chatId },
      })
      if (r.ok && chatId) {
        await sendCard(chatId, cardCastSuccess({ what: '📝 文本节点 (确认写入)', room: r.room, nodeId: r.nodeId, canvasUrl: r.canvasUrl }))
      } else if (chatId) {
        await sendCard(chatId, cardCastFailed({ what: '📝 文本节点', error: r.error || '未知' }))
      }
      return
    }
    case 'cancel': {
      if (chatId) await sendCard(chatId, buildCard({ title: '已取消', header: 'gray', body: ['未写入'] }))
      return
    }
    case 'switch_room': {
      if (chatId) {
        await sendCard(chatId, buildCard({
          title: '切换房间',
          header: 'blue',
          body: [
            '回复 `/room <名字>` 设置房间',
            `或 直接 \`/canvas\` 写入当前房间 \`${roomOf(chatId)}\``,
            value.text ? `\n*待写入文本*:\n> ${String(value.text).slice(0, 120)}` : '',
          ].filter(Boolean),
          buttons: [{ text: '帮助', type: 'default', value: { action: 'help' } }],
        }))
      }
      return
    }
    case 'status': {
      if (chatId) await sendCard(chatId, await cardStatus())
      return
    }
    case 'help': {
      if (chatId) await sendCard(chatId, cardHelp())
      return
    }
    case 'retry': {
      if (chatId) await sendCard(chatId, buildCard({ title: '重试', header: 'blue', body: ['请重新发送命令或链接'] }))
      return
    }
  }
}

// === 主入口 ===
let _currentConsumer = null

// 全局 SIGTERM/SIGINT — 只挂一次, 避免每次 start() 累积 listener
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log(`收到 ${sig}, 优雅关闭`)
    try { _currentConsumer?.kill('SIGTERM') } catch {}
    setTimeout(() => process.exit(0), 1500)
  })
}

function start() {
  log(`启动 bot — source-proxy: ${SOURCE_PROXY}, default room: ${DEFAULT_ROOM}, lark-bin: ${LARK_BIN}`)

  // 用 +subscribe catch-all (不传 --event-types 才能同时拿 message + card.action.trigger)
  // --force 绕过 single-instance lock (旧 daemon SIGKILL 不释放锁; 我们重启时若锁未失效会卡死)
  const consumer = spawnLark(
    ['event', '+subscribe', '--as', 'bot', '--force'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  _currentConsumer = consumer
  consumer.stdin.on('error', () => {})

  const rl = readline.createInterface({ input: consumer.stdout })
  rl.on('line', async (line) => {
    if (!line.trim()) return
    let evt
    try { evt = JSON.parse(line) }
    catch (e) { logErr('NDJSON 解析失败:', line.slice(0, 200)); return }
    try { await handleMessage(evt) }
    catch (e) { logErr('handleMessage 异常:', e.message, e.stack?.slice(0, 200)) }
  })

  consumer.stderr.on('data', (b) => {
    const s = b.toString('utf8').trim()
    if (s) log('[lark-cli]', s.slice(0, 200))
  })

  consumer.on('error', (e) => { logErr('subscribe spawn 失败:', e.message); process.exit(1) })
  consumer.on('exit', (code, sig) => {
    logErr(`subscribe 退出 code=${code} sig=${sig} — 5s 后重启`)
    setTimeout(start, 5000)
  })

}

start()
