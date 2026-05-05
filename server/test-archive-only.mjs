/**
 * 单测: 直接走 archiveMetacognition 跑一遍现有 yjs 上的最新 conclusion, 不依赖飞书消息触发
 *   node server/test-archive-only.mjs [room=demo-final] [chatId=oc_d2d890f2072a92a98b9f87ccb76a5b68]
 *
 * 用法场景: bot daemon 重启后 reverse channel 的 pending queue 丢了, 但 yjs 里 conclusion 还在,
 *   想验证 archive 输出 (云文档 + Bitable) 的 markdown / 字段质量.
 */
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'
import { archiveMetacognition } from './feishu-bot.mjs'

if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket

const ROOM = process.argv[2] || 'demo-final'
const CHAT_ID = process.argv[3] || 'oc_d2d890f2072a92a98b9f87ccb76a5b68'
const WS = process.env.Y_WS_URL || 'ws://127.0.0.1:1234'

const doc = new Y.Doc()
const provider = new WebsocketProvider(WS, ROOM, doc, { connect: true, WebSocketPolyfill: WebSocket })
await new Promise((r, rej) => {
  const t = setTimeout(() => rej(new Error('sync timeout')), 8000)
  provider.once('synced', () => { clearTimeout(t); r() })
})

const yNodes = doc.getMap('nodes')
console.log(`房间 ${ROOM} 节点总数=${yNodes.size}`)

// 找最新的 conclusion (按 created_at 排)
let latestConclusion = null
let latestProjectRootId = null
yNodes.forEach((n, k) => {
  if (n?.type === 'ontologyNode' && n.data?.isConclusion) {
    if (!latestConclusion || (n.data?.created_at || 0) > (latestConclusion.data?.created_at || 0)) {
      latestConclusion = { ...n, id: k }
      latestProjectRootId = n.data?.projectRootId
    }
  }
})

if (!latestConclusion) {
  console.error('找不到任何 conclusion 节点, 退出')
  process.exit(1)
}

console.log(`选中 conclusion: ${latestConclusion.id}`)
console.log(`projectRootId: ${latestProjectRootId}`)
console.log(`title: ${latestConclusion.data?.title}`)

// 收集所有跟这个 project 相关的节点 (root + projectRootId 等于它的)
const projectNodes = []
yNodes.forEach((n, k) => {
  if (k === latestProjectRootId) projectNodes.push({ ...n, id: k })
  else if (n?.data?.projectRootId === latestProjectRootId) projectNodes.push({ ...n, id: k })
})
console.log(`项目相关节点数: ${projectNodes.length}`)

// 拼 ctx (模拟原 reverse channel 的 ctx)
const rootNode = projectNodes.find((n) => n.id === latestProjectRootId)
const PROMPT = rootNode?.data?.project_profile?.target ||
  String(rootNode?.data?.title || '').replace(/^\[来自[^\]]*\]\s*/, '').slice(0, 300) ||
  String(latestConclusion.data?.conclusion?.summary || '').slice(0, 300)
const ctx = {
  prompt: PROMPT,
  chatId: CHAT_ID,
  attribution: { name: '测试-9分评估', via: 'feishu-bot' },
}

console.log(`\n=== 调用 archiveMetacognition ===`)
console.log(`prompt: ${PROMPT.slice(0, 80)}`)
console.log(`chatId: ${CHAT_ID}`)

const screenshotPngUrl = latestConclusion.data?.screenshotPngUrl || ''
const screenshotSvgUrl = latestConclusion.data?.screenshotSvgUrl || ''
const pngPath = latestConclusion.data?.screenshotPngPath || ''

const result = await archiveMetacognition({
  ctx,
  conclusionNode: latestConclusion,
  newNodes: projectNodes,
  room: ROOM,
  pngPath,
  screenshotPngUrl,
  screenshotSvgUrl,
})

console.log('\n=== 结果 ===')
console.log(JSON.stringify(result, null, 2))

provider.disconnect()
provider.destroy()
doc.destroy()
process.exit(0)
