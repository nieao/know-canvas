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

const SOURCE_PROXY = process.env.SOURCE_PROXY || 'http://127.0.0.1:17090'
const LARK_BIN = process.env.LARK_CLI || (process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli')
const CANVAS_PUBLIC_URL = process.env.CANVAS_PUBLIC_URL || 'https://ha2.digitalvio.shop/canvas/'
const DEFAULT_ROOM = process.env.CANVAS_DEFAULT_ROOM || 'feishu-inbox'

// Windows 下 spawn .cmd 必须经 cmd.exe /c (Node 18+ 安全策略)
function spawnLark(args, opts = {}) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/c', LARK_BIN, ...args], { windowsHide: true, ...opts })
  }
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
  const messageType = msg.message_type || msg.msg_type || 'text'
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

  // === /help ===
  if (/^\/help\b/i.test(content)) {
    await reply(messageId, cardHelp(), { textFallback: '查看 /help 帮助' })
    return
  }

  // === /status ===
  if (/^\/status\b/i.test(content)) {
    await reply(messageId, await cardStatus(), { textFallback: '查看 /status 状态' })
    return
  }

  // === /room ===
  const roomMatch = content.match(/^\/room(?:\s+(.+))?$/i)
  if (roomMatch) {
    const newRoom = (roomMatch[1] || '').trim()
    if (newRoom) {
      chatRoomMap.set(chatId, newRoom)
      await reply(messageId, buildCard({
        title: '✓ 房间已切换',
        header: 'green',
        body: [`本群后续 → \`${newRoom}\``, '老房间内容不动'],
        buttons: [{ text: '打开新房间', type: 'primary', url: CANVAS_PUBLIC_URL + `?room=${encodeURIComponent(newRoom)}` }],
      }))
    } else {
      await reply(messageId, buildCard({
        title: '当前房间',
        header: 'blue',
        body: [`本群 → \`${room}\``, '改用 `/room <名字>` 切换'],
        buttons: [{ text: '打开此房间', type: 'primary', url: CANVAS_PUBLIC_URL + `?room=${encodeURIComponent(room)}` }],
      }))
    }
    return
  }

  // === /canvas <text-or-url> ===
  const canvasMatch = content.match(/^\/canvas\s+(.+)/is)
  if (canvasMatch) {
    const payload = canvasMatch[1].trim()
    const urlInPayload = payload.match(ANY_URL_RE)?.[0]
    const attribution = { name: senderId.slice(0, 16) || 'feishu', via: 'feishu-bot', chatId }
    if (urlInPayload) {
      // 当 bookmark 写入
      const r = await proxyPost('/canvas/cast/bookmark', {
        room, url: urlInPayload, title: payload, summary: payload, attribution,
      })
      if (r.ok) await reply(messageId, cardCastSuccess({ what: '🔖 链接节点', room: r.room, nodeId: r.nodeId, canvasUrl: r.canvasUrl }))
      else await reply(messageId, cardCastFailed({ what: '🔖 链接节点', error: r.error || '未知' }))
    } else {
      const r = await proxyPost('/canvas/cast/text', { room, text: payload, attribution })
      if (r.ok) await reply(messageId, cardCastSuccess({ what: '📝 文本节点', room: r.room, nodeId: r.nodeId, canvasUrl: r.canvasUrl }))
      else await reply(messageId, cardCastFailed({ what: '📝 文本节点', error: r.error || '未知' }))
    }
    return
  }

  // === /aletheia <topic> ===
  const aletheiaMatch = content.match(/^\/aletheia\s+(.+)/is)
  if (aletheiaMatch) {
    const topic = aletheiaMatch[1].trim()
    // 先占位写入一个文本节点, 标记为 metacog seed
    const attribution = { name: senderId.slice(0, 16) || 'feishu', via: 'feishu-bot', chatId, kind: 'aletheia-seed' }
    const r = await proxyPost('/canvas/cast/text', {
      room, text: `[Aletheia 元认知 · 种子]\n${topic}`, attribution,
    })
    if (r.ok) {
      await reply(messageId, buildCard({
        title: '🧠 已埋下元认知种子',
        header: 'purple',
        body: [
          `话题: **${topic.slice(0, 80)}**`,
          `房间: \`${r.room}\``,
          '*(后续: 在画布点 "拆解" 触发 5 步元认知)*',
        ],
        buttons: [
          { text: '到画布拆解', type: 'primary', url: r.canvasUrl },
          { text: '换房间', type: 'default', value: { action: 'switch_room', text: topic } },
        ],
      }))
    } else {
      await reply(messageId, cardCastFailed({ what: '🧠 元认知种子', error: r.error || '未知' }))
    }
    return
  }

  // === 含飞书 URL → 自动 fetch + 写 bookmark ===
  const feishuUrls = [...content.matchAll(FEISHU_URL_RE)].map((m) => m[1])
  for (const u of feishuUrls.slice(0, 2)) {
    try {
      const j = await proxyPost('/feishu/fetch', { docUrl: u })
      const title = j.ok ? (j.data?.title || '(无标题)') : '(fetch 失败)'
      const summary = j.ok ? String(j.data?.content || '').slice(0, 400) : ''
      const r = await proxyPost('/canvas/cast/bookmark', {
        room, url: u, title, summary,
        attribution: { name: senderId.slice(0, 16) || 'feishu', via: 'feishu-bot', chatId },
      })
      if (r.ok) await reply(messageId, cardCastSuccess({ what: `📄 飞书 · ${title}`, room: r.room, nodeId: r.nodeId, canvasUrl: r.canvasUrl }))
      else await reply(messageId, cardCastFailed({ what: `📄 飞书 · ${title}`, error: r.error || '未知' }))
    } catch (e) {
      await reply(messageId, cardCastFailed({ what: '📄 飞书链接', error: e.message }))
    }
  }

  // === 含 Notion URL ===
  const notionUrls = [...content.matchAll(NOTION_URL_RE)].map((m) => m[1])
  for (const u of notionUrls.slice(0, 2)) {
    try {
      const j = await proxyPost('/notion/fetch', { pageUrl: u })
      const title = j.ok ? (j.data?.title || '(无标题)') : '(fetch 失败)'
      const summary = j.ok ? String(j.data?.content || '').slice(0, 400) : ''
      const r = await proxyPost('/canvas/cast/bookmark', {
        room, url: u, title, summary,
        attribution: { name: senderId.slice(0, 16) || 'feishu', via: 'feishu-bot', chatId },
      })
      if (r.ok) await reply(messageId, cardCastSuccess({ what: `📒 Notion · ${title}`, room: r.room, nodeId: r.nodeId, canvasUrl: r.canvasUrl }))
      else await reply(messageId, cardCastFailed({ what: `📒 Notion · ${title}`, error: r.error || '未知' }))
    } catch (e) {
      await reply(messageId, cardCastFailed({ what: '📒 Notion 链接', error: e.message }))
    }
  }

  // === 已经处理过 URL 就别再问了 ===
  if (feishuUrls.length || notionUrls.length) return

  // === 纯文本 → 弹确认卡 (避免误触每条群消息都写) ===
  // 短消息 < 6 字 视为闲聊, 不弹卡
  if (content.length < 6) return
  await reply(messageId, cardConfirmCast({ text: content, room }))
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
function start() {
  log(`启动 bot — source-proxy: ${SOURCE_PROXY}, default room: ${DEFAULT_ROOM}`)

  // 用 +subscribe catch-all (不传 --event-types 才能同时拿 message + card.action.trigger)
  const consumer = spawnLark(
    ['event', '+subscribe', '--as', 'bot', '--quiet'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
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

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      log(`收到 ${sig}, 优雅关闭`)
      try { consumer.kill('SIGTERM') } catch {}
      setTimeout(() => process.exit(0), 1500)
    })
  }
}

start()
