// 临时: 看 agentRoleNode 字段结构, 找出真正的 name 字段在哪
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket

const doc = new Y.Doc()
const provider = new WebsocketProvider('ws://127.0.0.1:1234', 'demo-final', doc, { connect: true, WebSocketPolyfill: WebSocket })
await new Promise((r) => provider.once('synced', r))

const yNodes = doc.getMap('nodes')
const samples = []
yNodes.forEach((n, k) => {
  if (n.type === 'agentRoleNode' && samples.length < 3) samples.push({ id: k, data: n.data })
})
console.log(JSON.stringify(samples, null, 2))
process.exit(0)
