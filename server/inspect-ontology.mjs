// 一次性脚本: 连 yjs 拿 demo-final 最近 5 个 ontology 节点 data 字段
// 用法: node server/inspect-ontology.mjs [room]
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket

const ROOM = process.argv[2] || 'demo-final'
const WS = process.env.Y_WS_URL || 'ws://127.0.0.1:1234'

const doc = new Y.Doc()
const provider = new WebsocketProvider(WS, ROOM, doc, { connect: true, WebSocketPolyfill: WebSocket })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('sync timeout')), 8000)
  provider.once('synced', () => { clearTimeout(t); resolve() })
})

const yNodes = doc.getMap('nodes')
const onts = []
yNodes.forEach((n, k) => {
  if (n?.type === 'ontologyNode' && !n.data?.isConclusion) {
    onts.push({ id: k, type: n.type, dataKeys: Object.keys(n.data || {}), data: n.data })
  }
})

// 按 created_at 倒序排, 取最近 8 个
onts.sort((a, b) => Number(b.data?.created_at || 0) - Number(a.data?.created_at || 0))
console.log(JSON.stringify({ total: onts.length, samples: onts.slice(0, 8) }, null, 2))

provider.disconnect()
provider.destroy()
doc.destroy()
process.exit(0)
