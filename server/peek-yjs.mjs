/**
 * 查 yjs room 当前 inbox + 节点状态 — 本地运行也行 (默认连 ws://127.0.0.1:1234)
 *   node server/peek-yjs.mjs [room=demo-final]
 */
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket

const ROOM = process.argv[2] || 'demo-final'
const WS = process.env.WS_URL || 'ws://127.0.0.1:1234'

const doc = new Y.Doc()
const provider = new WebsocketProvider(WS, ROOM, doc, { connect: true, WebSocketPolyfill: WebSocket })
await new Promise((r, rej) => {
  const t = setTimeout(() => rej(new Error('sync timeout')), 8000)
  provider.once('synced', () => { clearTimeout(t); r() })
})

const inbox = doc.getMap('aletheia-inbox')
console.log('=== aletheia-inbox (' + inbox.size + ') ===')
inbox.forEach((v, k) => {
  console.log(`${k} | status=${v?.status} | ts=${v?.ts} | text="${String(v?.text || '').slice(0, 80)}"`)
})

const nodes = doc.getMap('nodes')
console.log('\n=== latest 8 ontologyNode ===')
const list = []
nodes.forEach((n, k) => { if (n?.type === 'ontologyNode') list.push({ k, n }) })
list.sort((a, b) => (b.n.data?.created_at || 0) - (a.n.data?.created_at || 0))
list.slice(0, 8).forEach(({ k, n }) => {
  const t = n.data?.created_at ? new Date(n.data.created_at).toISOString().slice(11, 19) : '?'
  console.log(`${t} | ${k.slice(0, 60).padEnd(60)} | ${n.data?.isConclusion ? '⭐CONC ' : '       '} | ${String(n.data?.title || '').slice(0, 50)}`)
})

console.log('\n=== awareness ===')
provider.awareness.getStates().forEach((state, cid) => {
  console.log(`client ${cid}: user=${JSON.stringify(state?.user || null)?.slice(0, 60)}`)
})

provider.disconnect()
provider.destroy()
doc.destroy()
process.exit(0)
