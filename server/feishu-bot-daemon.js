/**
 * Feishu Bot Daemon — 把飞书消息桥接到 Know Canvas
 *
 * 工作流:
 *   1. spawn `lark-cli event +subscribe --as bot ...` 监听飞书事件 (WebSocket 长连接, 无需公网回调)
 *   2. NDJSON 行解析, 抓 im.message.receive_v1 事件
 *   3. 文本消息 → POST orchestra-http /api/orchestra/inject 写 yjs (room=demo-final)
 *   4. 立即回 "已派单, 处理中..."
 *   5. 同时连 yjs demo-final 房间, observe ResultNode/SynthesisNode 涌现
 *   6. 拿到结果 → lark-cli im +messages-reply 回原消息
 *
 * 启动: node server/feishu-bot-daemon.js
 *       FEISHU_ROOM=demo-final FEISHU_BOT_ROOM 默认 demo-final
 *
 * 依赖: lark-cli (用户已登录 bot 身份, 飞书后台已开 im.message.receive_v1 事件)
 */

const { spawn } = require('child_process')
const Y = require('yjs')
const { WebsocketProvider } = require('y-websocket')
const WS = require('ws')

const ROOM = process.env.FEISHU_BOT_ROOM || 'demo-final'
const ORCHESTRA_HTTP = process.env.ORCHESTRA_HTTP || 'http://127.0.0.1:17082'
const WS_URL = process.env.ORCHESTRA_WS_URL || 'ws://127.0.0.1:1234'
const RESULT_TIMEOUT_MS = 5 * 60 * 1000  // 5 分钟拿不到结果就超时
// Windows 下 spawn .cmd / .bat 必须经 cmd.exe /c (Node 18+ 安全策略, 不能直接 spawn .cmd)
// 包装一层: spawnLark(args) 屏蔽平台差异, args 不经 shell 解析, 安全
const LARK_BIN = process.env.LARK_CLI || (process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli')
function spawnLark(args, opts = {}) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/c', LARK_BIN, ...args], { windowsHide: true, ...opts })
  }
  return spawn(LARK_BIN, args, { windowsHide: true, ...opts })
}

// taskId / pendingMessage 映射: 当 ResultNode 出现且 sourceTaskId 命中, 才回飞书
// key = taskId, value = { messageId, chatId, queuedText, ts, timer }
const pending = new Map()

function log(...args) {
  console.log('[feishu-bot]', new Date().toISOString().slice(11, 19), ...args)
}

// ---------- yjs 监听 ----------
const ydoc = new Y.Doc()
const provider = new WebsocketProvider(WS_URL, ROOM, ydoc, { WebSocketPolyfill: WS, connect: true })
const nodesMap = ydoc.getMap('nodes')

provider.awareness.setLocalStateField('user', {
  name: 'feishu-bot', color: '#888', isAgent: true, isBot: true,
})
provider.on('status', (e) => log('yjs:', e.status))

// 当 nodesMap 有变化, 检查是不是 pending 的 task 出了 ResultNode/SynthesisNode
nodesMap.observe(() => {
  for (const [, node] of nodesMap.entries()) {
    const t = node?.type
    if (t !== 'resultNode' && t !== 'synthesisNode') continue
    const d = node.data || {}
    const srcId = d.source_task_id || d.sourceTaskId
    if (!srcId) continue
    const p = pending.get(srcId)
    if (!p) continue

    // 拼回执文本
    let reply = ''
    if (t === 'synthesisNode') {
      const score = d.healthScore != null ? `[Health ${d.healthScore}]\n` : ''
      reply = `${score}${d.summary || '已综合'}\n\n${d.actionPlan || ''}`.trim()
    } else {
      // resultNode (hermes mock 或真)
      const summary = d.summary || ''
      const result = typeof d.result === 'string' ? d.result : JSON.stringify(d.result || {}, null, 2)
      reply = `${summary}\n\n${result}`.slice(0, 4000)
    }
    sendReplyToFeishu(p.messageId, reply, p.chatId)
    clearTimeout(p.timer)
    pending.delete(srcId)
    log(`✓ replied task ${srcId} -> chat ${p.chatId}`)
  }
})

// ---------- orchestra inject ----------
async function injectTask(text, sourceMeta = {}) {
  const r = await fetch(`${ORCHESTRA_HTTP}/api/orchestra/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room: ROOM,
      title: text.slice(0, 60),
      body: `_来自飞书_\n\n${text}\n\n— sender: ${sourceMeta.senderId || '(未知)'}`,
      assignedTo: 'hermes',
      hermesAssignee: null,
    }),
  })
  if (!r.ok) throw new Error(`inject failed ${r.status}`)
  const j = await r.json()
  return j.taskId
}

// ---------- lark-cli reply ----------
function sendReplyToFeishu(messageId, text, chatId) {
  // 用 spawn 而不是 exec, 避免 shell 注入 (text 可能含特殊字符)
  // 用 stdin 传内容? lark-cli 需要 --text 参数, 这里直接传 (Node 自动 escape arg)
  const args = [
    'im', '+messages-reply',
    '--message-id', messageId,
    '--text', text.slice(0, 2000),  // 飞书单条消息限制
    '--as', 'bot',
  ]
  const p = spawnLark(args)
  let err = ''
  p.stderr.on('data', (b) => { err += b.toString() })
  p.on('exit', (code) => {
    if (code !== 0) log(`× reply failed (code=${code})`, err.slice(0, 200))
  })
}

function sendInitialAck(messageId, taskId) {
  sendReplyToFeishu(
    messageId,
    `[Aletheia] 已派单到画布: ${taskId}\n\n看 https://ha2.digitalvio.shop/canvas/?room=${ROOM} 实时围观, 处理完我会发结果。`,
    null
  )
}

// ---------- 飞书事件 ----------
async function handleMessageEvent(ev) {
  // compact 后字段: type, message_id, chat_id, chat_type (p2p/group), message_type, content, sender_id, sender_type
  if (ev.message_type !== 'text') {
    log(`skip non-text: ${ev.message_type}`)
    return
  }
  const text = (ev.content || '').trim()
  if (!text) return

  // p2p: 私聊 bot, 全部处理
  // group: 群聊, 必须 @bot 才处理. 飞书 @bot 后 content 含 "@_user_1" 占位 — 简化: 群里只要 mention bot 就处理
  // 这里先粗放: p2p 全收, group 看 sender_type === 'user' 就收 (可能误触发, demo 阶段可接受, 后续加 @ 过滤)
  if (ev.chat_type === 'group' && ev.sender_type !== 'user') {
    return
  }

  log(`<- ${ev.chat_type} from ${ev.sender_id}: ${text.slice(0, 80)}`)

  let taskId
  try {
    taskId = await injectTask(text, { senderId: ev.sender_id })
  } catch (e) {
    log('inject error:', e.message)
    sendReplyToFeishu(ev.message_id, `[bot 错误] 派单失败: ${e.message}`, ev.chat_id)
    return
  }

  // 立刻回执 + 注册 pending
  sendInitialAck(ev.message_id, taskId)
  const timer = setTimeout(() => {
    if (pending.has(taskId)) {
      sendReplyToFeishu(
        ev.message_id,
        `[Aletheia] 任务 ${taskId} 超时 (${RESULT_TIMEOUT_MS / 1000}s 未拿到结果, 可能 Hermes gateway 没起)。可去画布看实时状态。`,
        ev.chat_id
      )
      pending.delete(taskId)
    }
  }, RESULT_TIMEOUT_MS)

  pending.set(taskId, {
    messageId: ev.message_id,
    chatId: ev.chat_id,
    queuedText: text,
    ts: Date.now(),
    timer,
  })
  log(`-> injected ${taskId}, awaiting result`)
}

// ---------- 启 lark-cli subprocess ----------
function startLarkSubscribe() {
  log(`spawning ${LARK_BIN} event +subscribe ...`)
  const cli = spawnLark(
    ['event', '+subscribe', '--as', 'bot', '--event-types', 'im.message.receive_v1', '--compact', '--quiet']
  )

  let buf = ''
  cli.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let ev
      try { ev = JSON.parse(line) } catch (e) { log('json parse error:', line.slice(0, 100)); continue }
      if (ev.type === 'im.message.receive_v1') {
        handleMessageEvent(ev).catch((e) => log('handle err:', e.message))
      }
    }
  })

  cli.stderr.on('data', (chunk) => {
    const s = chunk.toString().trim()
    if (s) log('lark-cli stderr:', s.slice(0, 200))
  })

  cli.on('exit', (code) => {
    log(`lark-cli exited with code ${code}, retrying in 5s...`)
    setTimeout(startLarkSubscribe, 5000)  // 自动重连
  })
}

// ---------- 启动 ----------
log(`room=${ROOM}, orchestra=${ORCHESTRA_HTTP}, ws=${WS_URL}`)
log('connecting yjs ...')
provider.once('sync', () => log('yjs synced'))
startLarkSubscribe()

// ---------- 优雅退出 ----------
function shutdown(sig) {
  log(`${sig}, shutting down...`)
  for (const p of pending.values()) clearTimeout(p.timer)
  try { provider.destroy() } catch (_) {}
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
