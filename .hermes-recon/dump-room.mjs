// 用 y-websocket 连进 ha2 的 yws 服务读 demo-final 房间所有 nodes
// 用 server/node_modules 里的 ws (跟 yws 同源, 兼容性确定)
import * as Y from '../node_modules/yjs/src/index.js'
import { WebsocketProvider } from '../node_modules/y-websocket/src/y-websocket.js'
import { WebSocket } from '../server/node_modules/ws/wrapper.mjs'

const room = process.argv[2] || 'demo-final'
const wsUrl = process.argv[3] || 'wss://ha2.digitalvio.shop/yws/'

console.log(`连 ${wsUrl} room=${room}`)
const ydoc = new Y.Doc()
const provider = new WebsocketProvider(wsUrl, room, ydoc, { WebSocketPolyfill: WebSocket })

let synced = false
provider.on('status', (e) => console.log(`[status] ${e.status}`))
provider.on('sync', (s) => {
  if (s) synced = true
  console.log(`[sync] ${s}`)
})

setTimeout(() => {
  const nodes = ydoc.getMap('nodes')
  const taskNodes = []
  nodes.forEach((n, k) => {
    if (n?.type === 'taskNode') {
      taskNodes.push({
        id: k,
        title: (n.data?.title || '').slice(0, 30),
        status: n.data?.status,
        agentMode: n.data?.agentMode,
        assignedTo: n.data?.assignedTo,
        hermesAssignee: n.data?.hermesAssignee,
        claimedBy: n.data?.claimedBy,
        created_at: n.data?.created_at,
      })
    }
  })
  console.log(`\nTotal nodes: ${nodes.size}`)
  console.log(`TaskNodes: ${taskNodes.length}`)
  taskNodes.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
  for (const t of taskNodes) {
    console.log(JSON.stringify(t))
  }
  process.exit(synced ? 0 : 2)
}, 4500)
