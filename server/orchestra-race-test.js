/**
 * Orchestra CAS 抢锁竞态测试 — 启 3 个同名 worker, 验证只有一个胜出, 不双跑
 *
 * 用法: node orchestra-race-test.js
 *
 * 验证 spec §5 CAS 抢锁协议在 3 副本并发时:
 *   - 只有一个 claimedBy 留在 finalNode
 *   - 只有一个 ResultNode 被建出来
 *   - status 最终是 done
 */

const http = require('http')
const Y = require('yjs')
const WS = require('ws')
const { WebsocketProvider } = require('y-websocket')
const { setupWSConnection } = require('y-websocket/bin/utils')
const { Dispatcher } = require('./orchestra-dispatcher')
const { HermesWorker } = require('./orchestra-hermes-worker')

const TEST_ROOM = `race-${Date.now()}`
const TEST_PORT = 12000 + Math.floor(Math.random() * 1000)
const WS_URL = `ws://127.0.0.1:${TEST_PORT}`

process.env.ORCHESTRA_MOCK = '1'
process.env.ORCHESTRA_WS_URL = WS_URL

const NUM_WORKERS = 3

function startTestWsServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
    const wss = new WS.Server({ noServer: true })
    server.on('upgrade', (req, sock, head) => {
      wss.handleUpgrade(req, sock, head, (ws) => setupWSConnection(ws, req, { gc: true }))
    })
    server.listen(TEST_PORT, '127.0.0.1', () => resolve({ server, wss }))
    server.on('error', reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { server, wss } = await startTestWsServer()
  console.log(`[race] ws on ${WS_URL}, room=${TEST_ROOM}`)

  // 启动 dispatcher + N 个同名 hermes worker (每个 workerId 不同)
  const dispatcher = new Dispatcher({ room: TEST_ROOM, wsUrl: WS_URL }).start()
  const workers = []
  for (let i = 0; i < NUM_WORKERS; i++) {
    workers.push(new HermesWorker({ room: TEST_ROOM, wsUrl: WS_URL, workerId: `hermes-r${i}` }).start())
  }

  await sleep(1500)

  // 模拟浏览器写多个 task, 看是不是每个都只被一个 worker 抢到
  const browserDoc = new Y.Doc()
  const browserProvider = new WebsocketProvider(WS_URL, TEST_ROOM, browserDoc, { WebSocketPolyfill: WS, connect: true })
  const browserNodes = browserDoc.getMap('nodes')
  await new Promise((resolve) => browserProvider.on('sync', resolve))
  console.log('[race] browser synced')

  const NUM_TASKS = 5
  const taskIds = []
  // 一次性下发, 放大竞态压力
  browserDoc.transact(() => {
    for (let i = 0; i < NUM_TASKS; i++) {
      const id = `task-${i}-${Date.now()}`
      taskIds.push(id)
      browserNodes.set(id, {
        id,
        type: 'taskNode',
        position: { x: 100 + i * 50, y: 100 },
        data: {
          title: `race task ${i}`,
          body: `body for task ${i}`,
          status: 'draft',
          agentMode: 'auto',
          assignedTo: 'hermes',
        },
      })
    }
  })
  console.log(`[race] wrote ${NUM_TASKS} tasks at once`)

  // 等所有任务 done
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    const allDone = taskIds.every((id) => browserNodes.get(id)?.data?.status === 'done')
    if (allDone) break
    await sleep(200)
  }

  // 校验
  let pass = true
  const errs = []
  const winnersByTask = {}
  for (const id of taskIds) {
    const n = browserNodes.get(id)
    if (n?.data?.status !== 'done') {
      errs.push(`task ${id} not done: ${n?.data?.status}`)
      pass = false
    }
    winnersByTask[id] = n?.data?.claimedBy
  }

  // ResultNode 数量 = 任务数 (每个任务恰好一个 ResultNode, 不能 double)
  const resultsByTask = {}
  for (const [, n] of browserNodes.entries()) {
    if (n?.type !== 'resultNode') continue
    const src = n?.data?.sourceTaskId
    if (!resultsByTask[src]) resultsByTask[src] = []
    resultsByTask[src].push(n.id)
  }
  for (const id of taskIds) {
    const list = resultsByTask[id] || []
    if (list.length !== 1) {
      errs.push(`task ${id} produced ${list.length} ResultNode(s), expected 1`)
      pass = false
    }
  }

  console.log('\n[race] winners:')
  for (const id of taskIds) console.log(`  ${id} → ${winnersByTask[id]} (results: ${(resultsByTask[id] || []).length})`)

  // 抢锁分布: 多个 worker 应至少各分到一些 (不强制均匀, 但希望不全集中在一个)
  const winners = taskIds.map((id) => winnersByTask[id])
  const distinctWinners = new Set(winners)
  console.log(`[race] distinct winners: ${distinctWinners.size} / ${NUM_WORKERS} workers`)

  browserProvider.destroy()
  workers.forEach((w) => w.stop())
  dispatcher.stop()
  await sleep(200)
  wss.close()
  server.close()

  if (pass) {
    console.log('\n✓ orchestra race test PASS')
    process.exit(0)
  } else {
    console.error('\n✗ orchestra race test FAILED:')
    errs.forEach((e) => console.error('  -', e))
    process.exit(1)
  }
}

main().catch((e) => { console.error('[race] fatal:', e); process.exit(2) })
