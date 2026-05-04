/**
 * 反向通道: 画布 → 飞书 bot
 *
 * 工作流:
 *   1) 临时连 ws://127.0.0.1:1234/<room> 拿 nodes/edges 当前快照
 *   2) 摘要: 节点数 + 类型分布 + 最近 N 条标题
 *   3) 用 lark-cli 主动发 P2P 给指定 user_id (默认你想猫 self)
 *
 * 用法: node server/send-canvas-summary.mjs [--room demo-final] [--user-id ou_xxx]
 */

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const idx = argv.indexOf(name)
  return idx >= 0 ? argv[idx + 1] : fallback
}
const ROOM = arg('--room', 'demo-final')
const USER_ID = arg('--user-id', '') // 默认空, 改用 chat-id (P2P 自动创建的 chat 用户看不见)
const CHAT_ID = arg('--chat-id', 'oc_4b92a9a0673a7300a9068542b244fa66') // 默认: "我们小组三人" 群
const WS_URL = arg('--ws', 'ws://127.0.0.1:1234')

// 直接 spawn lark-cli.exe 原生二进制 (绕开 cmd.exe 编码)
function resolveLarkBin() {
  if (process.env.LARK_CLI_BIN) return process.env.LARK_CLI_BIN
  if (process.platform === 'win32') {
    const npmRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(npmRoot, 'npm', 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe')
  }
  return process.env.LARK_CLI || 'lark-cli'
}
const LARK_BIN = resolveLarkBin()

console.log(`[summary] 连 ${WS_URL} room=${ROOM}`)

const doc = new Y.Doc()
const provider = new WebsocketProvider(WS_URL, ROOM, doc, { connect: true, WebSocketPolyfill: WebSocket })

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('sync timeout 8s')), 8000)
  provider.once('synced', () => { clearTimeout(t); resolve() })
})

const yNodes = doc.getMap('nodes')
const yEdges = doc.getMap('edges')

const nodes = []
yNodes.forEach((v) => nodes.push(v))
const edges = []
yEdges.forEach((v) => edges.push(v))

console.log(`[summary] 拿到 ${nodes.length} 节点 / ${edges.length} 边`)

// 摘要
const typeCount = {}
nodes.forEach((n) => {
  const t = n.type || 'unknown'
  typeCount[t] = (typeCount[t] || 0) + 1
})

// 最近 5 条 (按 createdAt / position.y 简单排, 没 createdAt 就 fallback)
const recent = [...nodes]
  .sort((a, b) => (b.data?.createdAt || 0) - (a.data?.createdAt || 0))
  .slice(0, 5)
  .map((n, i) => {
    const title = n.data?.title || n.data?.label || n.data?.content?.slice(0, 30) || `(${n.type})`
    const ts = n.data?.createdAt ? new Date(n.data.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) : ''
    const author = n.data?.createdBy?.name || ''
    return `${i + 1}. ${String(title).slice(0, 40)}${author ? ` · ${author}` : ''}${ts ? ` · ${ts}` : ''}`
  })

const lines = [
  `📊 画布 [${ROOM}] 当前状态`,
  '',
  `节点 ${nodes.length} · 边 ${edges.length}`,
  '',
  '类型分布:',
  ...Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `  · ${t}: ${n}`),
]
if (recent.length > 0) {
  lines.push('', '最近 5 条节点:', ...recent)
}
// 用 IP HTTP fallback (canvas.digitalvio.shop 的 https 当前不稳; ha2 是 hermes 不是 know-canvas)
lines.push('', `画布: http://66.245.216.250/canvas/?room=${encodeURIComponent(ROOM)}`)

const text = lines.join('\n')

console.log('=== 摘要 ===')
console.log(text)
console.log('=== 摘要结束 ===')

provider.disconnect()
provider.destroy()
doc.destroy()

// 发到飞书 — 优先 chat_id (用户能看到), 否则 user_id (P2P 自动创建)
const target = CHAT_ID ? ['--chat-id', CHAT_ID] : ['--user-id', USER_ID]
console.log(`[summary] 发到飞书 ${CHAT_ID ? `chat=${CHAT_ID}` : `user=${USER_ID}`}`)
await new Promise((resolve, reject) => {
  const proc = spawn(LARK_BIN, [
    'im', '+messages-send',
    ...target,
    '--text', text,
    '--as', 'bot',
  ], { windowsHide: true })
  let out = ''
  let err = ''
  proc.stdout.on('data', (b) => out += b.toString('utf8'))
  proc.stderr.on('data', (b) => err += b.toString('utf8'))
  proc.on('close', (code) => {
    if (code !== 0) {
      console.error('[summary] lark-cli 失败 code=', code)
      console.error('stderr:', err.slice(0, 500))
      console.error('stdout:', out.slice(0, 500))
      reject(new Error(`lark-cli exit ${code}`))
    } else {
      console.log('[summary] ✓ 发送成功')
      console.log(out.slice(0, 300))
      resolve()
    }
  })
  proc.on('error', reject)
})

process.exit(0)
