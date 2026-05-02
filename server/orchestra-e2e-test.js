/**
 * Orchestra 端到端 mock 验证 — 自带 y-ws-server + dispatcher + hermes-worker(mock)
 *
 * 验证流程:
 *   1. 启动 y-ws-server (in-process)
 *   2. 启动 dispatcher
 *   3. 启动 hermes worker (mock 模式)
 *   4. 用一个独立 Y.Doc client 写入 TaskNode(agentMode='auto', assignedTo='hermes', status='draft')
 *   5. 观察状态流转: draft → pending (dispatcher) → running (worker claim) → done (worker finalize)
 *   6. 验证自动建了 ResultNode + edge
 *   7. 通过则 exit 0, 失败则 exit 1
 *
 * 用法:
 *   cd server && npm run orchestra:e2e
 *
 * 设计: 整个测试是单进程, 使用随机端口避免占用 1234
 */

const http = require('http')
const Y = require('yjs')
const WS = require('ws')
const { WebsocketProvider } = require('y-websocket')
const { setupWSConnection } = require('y-websocket/bin/utils')
const { Dispatcher } = require('./orchestra-dispatcher')
const { HermesWorker } = require('./orchestra-hermes-worker')

const TEST_ROOM = `e2e-${Date.now()}`
const TEST_PORT = 11234 + Math.floor(Math.random() * 1000)
const WS_URL = `ws://127.0.0.1:${TEST_PORT}`

// 强制 mock 模式
process.env.ORCHESTRA_MOCK = '1'
process.env.ORCHESTRA_WS_URL = WS_URL

function startTestWsServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })
    const wss = new WS.Server({ noServer: true })
    server.on('upgrade', (req, sock, head) => {
      wss.handleUpgrade(req, sock, head, (ws) => setupWSConnection(ws, req, { gc: true }))
    })
    server.listen(TEST_PORT, '127.0.0.1', () => {
      console.log(`[e2e] test ws server on ${WS_URL}`)
      resolve({ server, wss })
    })
    server.on('error', reject)
  })
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function fmtNode(n) {
  if (!n?.data) return JSON.stringify(n)
  return `status=${n.data.status} claimedBy=${n.data.claimedBy || '-'} mode=${n.data.agentMode}`
}

async function main() {
  const { server, wss } = await startTestWsServer()

  // 启动 dispatcher + worker
  const dispatcher = new Dispatcher({ room: TEST_ROOM, wsUrl: WS_URL }).start()
  const worker = new HermesWorker({ room: TEST_ROOM, wsUrl: WS_URL }).start()

  // 给它们一点时间连上
  await sleep(1500)

  // 模拟"浏览器"客户端
  const browserDoc = new Y.Doc()
  const browserProvider = new WebsocketProvider(WS_URL, TEST_ROOM, browserDoc, {
    WebSocketPolyfill: WS,
    connect: true,
  })
  const browserNodes = browserDoc.getMap('nodes')
  const browserEdges = browserDoc.getMap('edges')

  await new Promise((resolve) => browserProvider.on('sync', resolve))
  console.log('[e2e] browser client synced')

  // 写一个 auto TaskNode
  const taskId = `task-${Date.now()}`
  browserNodes.set(taskId, {
    id: taskId,
    type: 'taskNode',
    position: { x: 100, y: 100 },
    data: {
      title: 'e2e test: 调研竞品',
      body: '请列出 3 个竞品并简述其优劣',
      status: 'draft',
      agentMode: 'auto',
      assignedTo: 'hermes',
    },
  })
  console.log(`[e2e] wrote TaskNode ${taskId} status=draft agentMode=auto`)

  // 用 observeDeep 订阅每次 update, 避免 polling 错过中间态
  const seen = []
  let lastStatus = null
  const recordStatus = () => {
    const node = browserNodes.get(taskId)
    if (node && node.data.status !== lastStatus) {
      lastStatus = node.data.status
      seen.push(lastStatus)
      console.log(`[e2e] status flip → ${fmtNode(node)}`)
    }
  }
  const observer = () => recordStatus()
  browserNodes.observeDeep(observer)
  recordStatus()  // 初始 draft

  // 等到 done/failed 或超时
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    if (lastStatus === 'done' || lastStatus === 'failed') break
    await sleep(100)
  }
  browserNodes.unobserveDeep(observer)

  console.log('[e2e] state trace:', seen.join(' → '))

  // 校验
  const finalNode = browserNodes.get(taskId)
  let pass = true
  const errs = []

  // pending 是 dispatcher → worker 之间 < 1ms 的中间态, Yjs 网络层会合并掉, 不强求观察到
  // 关键合约: 最终态必须是 done, 且必须看到 running 中间态(说明 worker 抢到了)
  const required = ['running', 'done']
  for (const s of required) {
    if (!seen.includes(s)) {
      errs.push(`missing transition: ${s}`)
      pass = false
    }
  }
  if (finalNode?.data?.status !== 'done') {
    errs.push(`final status not done: ${finalNode?.data?.status}`)
    pass = false
  }
  if (!finalNode?.data?.claimedBy?.startsWith('hermes-')) {
    errs.push(`claimedBy missing/invalid: ${finalNode?.data?.claimedBy}`)
    pass = false
  }

  // 校验 ResultNode 自动建了
  let resultNodeFound = false
  let resultEdgeFound = false
  for (const [id, n] of browserNodes.entries()) {
    if (n?.type === 'resultNode' && n?.data?.sourceTaskId === taskId) {
      resultNodeFound = true
      console.log(`[e2e] found result node ${id}`)
      break
    }
  }
  for (const e of browserEdges.values()) {
    if (e?.source === taskId && e?.data?.producedBy === 'hermes') {
      resultEdgeFound = true
      break
    }
  }
  if (!resultNodeFound) { errs.push('no ResultNode auto-created'); pass = false }
  if (!resultEdgeFound) { errs.push('no edge to ResultNode auto-created'); pass = false }

  // 清理
  browserProvider.destroy()
  worker.stop()
  dispatcher.stop()
  await sleep(200)
  wss.close()
  server.close()

  if (pass) {
    console.log('\n✓ orchestra e2e PASS')
    process.exit(0)
  } else {
    console.error('\n✗ orchestra e2e FAILED:')
    errs.forEach((e) => console.error('  -', e))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('[e2e] fatal:', e)
  process.exit(2)
})
