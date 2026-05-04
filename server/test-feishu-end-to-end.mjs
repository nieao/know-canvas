/**
 * 端到端测试: 飞书 bot ↔ 画布 ↔ 元认知 ↔ 飞书 闭环
 *
 * 流程:
 *   1) bot 把一条 prompt cast 到画布 demo-final 的 aletheia-inbox
 *   2) 等 30~90 秒前端 cc 选举 + 跑 askAndStartMetaProject (5 步元认知)
 *   3) 从 yjs 读最新的 metacog 节点 (ontologyNode 含 conclusion)
 *   4) bot 把结论汇总发到飞书群
 */

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket

const ROOM = 'demo-final'
const CHAT_ID = 'oc_d2d890f2072a92a98b9f87ccb76a5b68' // 你想猫画布 · bot 测试
const WS_URL = 'ws://127.0.0.1:1234'
const PROXY_URL = 'http://127.0.0.1:17090'
const PROMPT = process.argv.slice(2).join(' ').trim() || '比较 yjs 和 Automerge: 应用场景 / 性能权衡 / 成本对比'

function resolveLarkBin() {
  if (process.env.LARK_CLI_BIN) return process.env.LARK_CLI_BIN
  if (process.platform === 'win32') {
    const npmRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(npmRoot, 'npm', 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe')
  }
  return process.env.LARK_CLI || 'lark-cli'
}
const LARK_BIN = resolveLarkBin()

function logT(...a) { console.log(`[${new Date().toLocaleTimeString('zh-CN', {hour12:false})}]`, ...a) }

// node type → 中文显示标签 (跟 feishu-bot.mjs 保持一致)
const TYPE_LABEL = {
  ontologyNode: '拆解',
  agentRoleNode: '角色',
  synthesisNode: '综合',
  metaStepNode: '元认知步骤',
  taskNode: '任务',
  resultNode: '结果',
  conceptNode: '概念',
  noteNode: '笔记',
  bookmarkNode: '链接',
  challengeNode: '反驳',
  group: '分组',
}
function typeLabel(t) { return TYPE_LABEL[t] || t }

// 步骤 1: cast prompt 到 inbox
logT(`[1/4] cast prompt → ${ROOM}: "${PROMPT}"`)
const castRes = await fetch(`${PROXY_URL}/canvas/cast/aletheia-prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    room: ROOM,
    text: PROMPT,
    attribution: { name: '你想猫', via: 'feishu-bot', testCase: 'end-to-end' },
  }),
})
const castJson = await castRes.json()
if (!castJson.ok) {
  console.error('cast 失败:', castJson)
  process.exit(1)
}
logT(`✓ cast 成功 inbox=${castJson.id} 在线 cc=${castJson.peers}`)
if (castJson.peers === 0) {
  logT(`⚠ 0 cc 在线 — 没有执行者会跑元认知, 等画布有人打开`)
}

// 步骤 2: 连 yjs 监听新节点产生 (元认知 5 步会陆续写入 ontology / agentRole / synthesis 节点)
logT(`[2/4] 等画布前端跑元认知 5 步 (≤ 90 s)`)
const doc = new Y.Doc()
const provider = new WebsocketProvider(WS_URL, ROOM, doc, { connect: true, WebSocketPolyfill: WebSocket })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('sync timeout 8s')), 8000)
  provider.once('synced', () => { clearTimeout(t); resolve() })
})

const yNodes = doc.getMap('nodes')
const baseline = new Set()
yNodes.forEach((_, k) => baseline.add(k))
logT(`基线节点数: ${baseline.size}`)

// 等新节点出现 (持续监听 90s, 抓所有新增的)
const newNodes = []
const observer = (event) => {
  event.changes.keys.forEach((change, key) => {
    if (change.action === 'add' && !baseline.has(key)) {
      const n = yNodes.get(key)
      newNodes.push({ id: key, ...n })
      logT(`+新节点 ${n.type} ${(n.data?.title || n.data?.label || '').slice(0, 40)}`)
    }
  })
}
yNodes.observe(observer)

// 等 conclusion 节点出现, 或 90s 超时
const conclusionsBefore = []
yNodes.forEach((n) => {
  if (n.type === 'ontologyNode' && n.data?.isConclusion) conclusionsBefore.push(n.data?.conclusion || '')
})
logT(`已有 conclusion 节点数: ${conclusionsBefore.length}`)

const startedAt = Date.now()
const TIMEOUT_MS = 90 * 1000
let conclusion = null
while (Date.now() - startedAt < TIMEOUT_MS) {
  await new Promise((r) => setTimeout(r, 3000))
  // 找最新出现的 conclusion (ontologyNode + isConclusion + 含 conclusion 文本)
  const conclusionNodes = []
  yNodes.forEach((n, key) => {
    if (n.type === 'ontologyNode' && n.data?.isConclusion && n.data?.conclusion && !baseline.has(key)) {
      conclusionNodes.push({ ...n, _key: key })
    }
  })
  if (conclusionNodes.length > 0) {
    // 取最新的一个 (按 created_at 排)
    conclusionNodes.sort((a, b) => (b.data?.created_at || 0) - (a.data?.created_at || 0))
    conclusion = conclusionNodes[0]
    logT(`✓ 拿到 conclusion 节点 ${conclusion._key}`)
    break
  }
  logT(`...等待 (已等 ${Math.round((Date.now() - startedAt) / 1000)}s, 新节点 ${newNodes.length})`)
}

yNodes.unobserve(observer)

// 步骤 3: 拼摘要 — 含所有分支节点 + 推进建议
logT(`[3/4] 整理结果`)

// 把 conclusion 字段(可能 string 或 object) flatten 成可读文本
function flattenField(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map((x) => flattenField(x)).filter(Boolean).join('\n  · ')
  if (typeof v === 'object') {
    const parts = []
    if (v.decision) parts.push(`决策: ${v.decision}`)
    if (v.score !== undefined) parts.push(`置信度: ${v.score}`)
    if (v.summary) parts.push(`摘要: ${v.summary}`)
    if (v.reasoning) parts.push(`推理: ${v.reasoning}`)
    if (v.text) parts.push(v.text)
    if (Array.isArray(v.pros) && v.pros.length) parts.push(`优势:\n  · ${v.pros.join('\n  · ')}`)
    if (Array.isArray(v.cons) && v.cons.length) parts.push(`劣势:\n  · ${v.cons.join('\n  · ')}`)
    if (Array.isArray(v.next_steps) && v.next_steps.length) parts.push(`下一步:\n  · ${v.next_steps.join('\n  · ')}`)
    if (parts.length === 0) parts.push(JSON.stringify(v, null, 2).slice(0, 800))
    return parts.join('\n')
  }
  return String(v)
}

function nodeTitle(n) {
  const d = n.data || {}
  let t = d.title || d.label || d.name || d.agentName || d.role_name || d.roleName
  if (!t && d.role && typeof d.role === 'object') t = d.role.name || d.role.title
  // agentRoleNode 没 name 时用 responsibility / roleId 兜底
  if (!t && n.type === 'agentRoleNode') {
    if (d.responsibility) t = String(d.responsibility).slice(0, 24)
    else if (d.roleId) t = `Agent ${d.roleId}`
  }
  // taskNode 兜底用 task / description
  if (!t && n.type === 'taskNode') {
    t = d.task || d.description || d.taskId || ''
    if (t) t = String(t).slice(0, 24)
  }
  return t || `(${n.type})`
}

function nodeText(n) {
  const d = n.data || {}
  // agentRoleNode 特化: 显示 职责 + 工具 + 输出
  if (n.type === 'agentRoleNode') {
    const parts = []
    if (d.responsibility) parts.push(`职责: ${d.responsibility}`)
    if (Array.isArray(d.tools) && d.tools.length) parts.push(`工具: ${d.tools.join('/')}`)
    if (Array.isArray(d.assigned_tasks) && d.assigned_tasks.length) parts.push(`派单: ${d.assigned_tasks.join(',')}`)
    if (d.status) parts.push(`状态: ${d.status}`)
    if (d.output_summary) parts.push(`产出: ${d.output_summary}`)
    return parts.join(' · ')
  }
  // taskNode 特化
  if (n.type === 'taskNode') {
    return flattenField(d.task) || flattenField(d.description) || flattenField(d.input) || ''
  }
  // 通用 fallback
  return (
    flattenField(d.content) ||
    flattenField(d.summary) ||
    flattenField(d.description) ||
    flattenField(d.text) ||
    flattenField(d.role) ||
    flattenField(d.payload) ||
    flattenField(d.conclusion) ||
    flattenField(d.persona) ||
    flattenField(d.reasoning) ||
    ''
  )
}

const lines = [
  `🧠 元认知反馈 [${ROOM}]`,
  '',
  `输入: ${PROMPT}`,
  '',
  `产生 ${newNodes.length} 个新节点:`,
  '',
]

// 按类型分组列所有新节点
const byType = new Map()
for (const n of newNodes) {
  const t = n.type || 'unknown'
  if (!byType.has(t)) byType.set(t, [])
  byType.get(t).push(n)
}

// 顺序: 先 ontology (拆解), 再 agentRole (角色), 再 synthesis/conclusion (结论)
const order = ['ontologyNode', 'agentRoleNode', 'synthesisNode', 'metaStepNode', 'taskNode', 'resultNode', 'conceptNode', 'noteNode']
const sortedTypes = [...byType.keys()].sort((a, b) => {
  const ai = order.indexOf(a); const bi = order.indexOf(b)
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
})

for (const t of sortedTypes) {
  const items = byType.get(t)
  // conclusion 节点单独突出
  const conclusionItems = items.filter((n) => n.data?.isConclusion)
  const normalItems = items.filter((n) => !n.data?.isConclusion)
  if (normalItems.length > 0) {
    lines.push(`【${typeLabel(t)}】`)
    for (const n of normalItems) {
      const title = nodeTitle(n)
      const body = nodeText(n).slice(0, 240).replace(/\n/g, ' ')
      lines.push(`▸ ${title}`)
      if (body) lines.push(`   ${body}`)
    }
    lines.push('')
  }
  if (conclusionItems.length > 0) {
    lines.push(`【⭐ ${typeLabel(t)} · 结论】`)
    for (const n of conclusionItems) {
      const title = nodeTitle(n) || '结论'
      const body = nodeText(n).slice(0, 600)
      lines.push(`▸ ${title}`)
      if (body) lines.push(body)
    }
    lines.push('')
  }
}

// 下一步推进建议 — 基于 conclusion 的 decision / score 动态生成
let suggestion = ''
if (conclusion) {
  const c = conclusion.data?.conclusion
  const cObj = (c && typeof c === 'object') ? c : {}
  // 优先从 object 字段拿; 否则从 title 文字解析 (例: "结论: GO · 82 分")
  let decision = String(cObj.decision || '').toUpperCase()
  let score = Number(cObj.score || cObj.confidence || 0)
  if (!decision || !score) {
    const titleStr = String(conclusion.data?.title || '')
    const m = titleStr.match(/(GO|NO[\s_-]*GO|NOGO)[^0-9]*([0-9]+)/i)
    if (m) {
      if (!decision) decision = m[1].toUpperCase().replace(/[\s_-]/g, '')
      if (!score) score = Number(m[2])
    }
  }

  if (decision === 'GO' && score >= 80) {
    suggestion = [
      '继续推进建议 (高置信度 GO):',
      '  1. 在画布上选中结论节点 → 点 "派单 Hermes" 让 worker 真实执行',
      '  2. 或选中拆解的关键 ontology → 再次 "拆解" 深挖一层',
      '  3. 飞书直接发新指令: 例如 "/aletheia 用 yjs 改造现有项目, 给具体落地路径"',
    ].join('\n')
  } else if (decision === 'GO' && score < 80) {
    suggestion = [
      '继续推进建议 (中置信度 GO):',
      '  1. 选中结论节点 → 点 "反驳" 让 LLM 列质疑点, 看哪些假设站不住脚',
      '  2. 或选中可疑的 ontology → 单独 "拆解" 确认细节',
      '  3. 决定可行后再派单',
    ].join('\n')
  } else if (decision === 'NO_GO' || decision === 'NOGO' || decision === 'NO-GO') {
    suggestion = [
      '继续推进建议 (NO-GO):',
      '  1. 看 cons / 劣势字段, 找出关键阻碍',
      '  2. 重新拆解时换一个角度问题 (例如限定具体场景 / 缩小规模)',
      '  3. 或选 "Aletheia 综合" 让多 agent 重新涌现新方案',
    ].join('\n')
  } else {
    suggestion = [
      '继续推进建议:',
      '  1. 在画布上点结论节点查看完整推理',
      '  2. 不满意 → "反驳" 或 "再次拆解"',
      '  3. 满意 → "派单 Hermes" 真实执行',
    ].join('\n')
  }
} else {
  suggestion = [
    '继续推进建议 (元认知未完成):',
    '  1. 检查画布是否有 cc 在线执行 (peers 数 > 0)',
    '  2. 检查 LLM provider 是否可用 (BottomAIBar 角标)',
    '  3. 重发指令或在画布手动点 "启动元认知"',
  ].join('\n')
}

lines.push(suggestion)
lines.push('', `画布: http://66.245.216.250/canvas/?room=${encodeURIComponent(ROOM)}`)

const text = lines.join('\n')
console.log('=== 即将发送 ===')
console.log(text)
console.log('=== 发送 ===')

provider.disconnect()
provider.destroy()
doc.destroy()

// === 步骤 4: 飞书发送 — 用 interactive 卡片, 每个分支节点带按钮 ===
// 构造卡片 (Lark schema 2.0)
function buildBranchButtons() {
  const result = []
  // 每个 ontology 分支生成 3 个 button: 深挖 / 派单 / 反驳
  // 每行 max 3 button (飞书行宽限制)
  for (const n of newNodes) {
    if (n.type !== 'ontologyNode' || n.data?.isConclusion) continue
    const title = nodeTitle(n)
    result.push({
      tag: 'action',
      actions: [
        { tag: 'button', text: { tag: 'plain_text', content: `▸ ${title.slice(0, 14)} · 深挖` }, type: 'default',
          value: { action: 'decompose', nodeId: n.id, room: ROOM, title } },
        { tag: 'button', text: { tag: 'plain_text', content: '派单' }, type: 'primary',
          value: { action: 'dispatch', nodeId: n.id, room: ROOM, title } },
        { tag: 'button', text: { tag: 'plain_text', content: '反驳' }, type: 'danger',
          value: { action: 'challenge', nodeId: n.id, room: ROOM, title } },
      ],
    })
  }
  return result
}

const card = {
  config: { wide_screen_mode: true },
  header: {
    template: 'turquoise',
    title: { tag: 'plain_text', content: `🧠 元认知反馈 [${ROOM}]` },
  },
  elements: [
    { tag: 'markdown', content: `**输入**: ${PROMPT}` },
    { tag: 'hr' },
    { tag: 'markdown', content: `**产生 ${newNodes.length} 个新节点**` },
    // 主体内容 (markdown 列出所有分支)
    { tag: 'markdown', content: text.split('\n').slice(2).join('\n').slice(0, 1800) },
    { tag: 'hr' },
    { tag: 'markdown', content: '**点击下方按钮直接操作画布:**' },
    ...buildBranchButtons(),
    { tag: 'hr' },
    {
      tag: 'action',
      actions: [
        { tag: 'button', text: { tag: 'plain_text', content: '🌐 打开画布' }, type: 'primary',
          url: `http://66.245.216.250/canvas/?room=${encodeURIComponent(ROOM)}` },
        { tag: 'button', text: { tag: 'plain_text', content: '🤖 派单全部' }, type: 'default',
          value: { action: 'dispatch_all', room: ROOM } },
        { tag: 'button', text: { tag: 'plain_text', content: '↩ 重新拆解' }, type: 'default',
          value: { action: 'redecompose', prompt: PROMPT, room: ROOM } },
      ],
    },
  ],
}

logT(`[4/4] 发到飞书群 ${CHAT_ID} (interactive card)`)
await new Promise((resolve, reject) => {
  const proc = spawn(LARK_BIN, [
    'im', '+messages-send',
    '--chat-id', CHAT_ID,
    '--msg-type', 'interactive',
    '--content', JSON.stringify(card),
    '--as', 'bot',
  ], { windowsHide: true })
  let out = ''
  let err = ''
  proc.stdout.on('data', (b) => out += b.toString('utf8'))
  proc.stderr.on('data', (b) => err += b.toString('utf8'))
  proc.on('close', (code) => {
    if (code !== 0) {
      console.error('lark-cli 失败:', err.slice(0, 400))
      reject(new Error(`exit ${code}`))
    } else {
      logT('✓ 发送成功')
      console.log(out.slice(0, 200))
      resolve()
    }
  })
  proc.on('error', reject)
})

process.exit(0)
