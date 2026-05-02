/**
 * Yjs ↔ Zustand 双向同步
 *
 * 启动序列（关键）：
 *   1. 暂存本地 store 的 nodes/edges（用户单机时画的）
 *   2. 清空本地 store + suppress 本地 → Yjs 推送
 *   3. 等 provider 'sync' 事件触发（或 1.5s 超时）
 *   4. 此时 Yjs 已经拿到房间快照：
 *      - 远端有数据 → applyRemoteToLocal()（远端为准）
 *      - 远端空 → 把暂存的本地数据推上去（首位入房间者贡献画布）
 *   5. 解开 suppress，开始正常双向 sync
 *
 * 拖动节点 60fps 写 store，必须节流到 50ms 推 Yjs。
 *
 * 双向防循环：用 Y.Transaction.origin 区分 'local' / 远端。
 */

import { getDoc, getNodesMap, getEdgesMap, getProvider } from './yjsClient'
import useCanvasStore from '../stores/useCanvasStore'

const ORIGIN_LOCAL = 'local'

let _attached = false
let _unsubStore = null
let _unobserveNodes = null
let _unobserveEdges = null
let _suppressLocalPush = true  // 启动后默认禁用本地推送，等 sync 完成

/** 启动双向同步。重复调用 no-op。 */
export function attachYjsSync() {
  if (_attached) return
  _attached = true
  _suppressLocalPush = true

  const ydoc = getDoc()
  const yNodes = getNodesMap()
  const yEdges = getEdgesMap()
  const provider = getProvider()
  const store = useCanvasStore

  // 暂存本地数据 + 清空本地 store（避免持久化的旧数据污染协作）
  const localState = store.getState()
  const stashedNodes = [...(localState.nodes || [])]
  const stashedEdges = [...(localState.edges || [])]
  store.setState({ nodes: [], edges: [] })

  // 监听 Yjs 远端变更（启动后立即生效，捕获 sync 期间的初始数据）
  const onYjsChange = (event, transaction) => {
    if (transaction.origin === ORIGIN_LOCAL) return
    applyRemoteToLocal()
  }
  yNodes.observe(onYjsChange)
  yEdges.observe(onYjsChange)
  _unobserveNodes = () => yNodes.unobserve(onYjsChange)
  _unobserveEdges = () => yEdges.unobserve(onYjsChange)

  // 等 provider sync 完成（首次握手收完远端 update），再决定推/拉
  const onSynced = () => {
    finalizeStartup(stashedNodes, stashedEdges)
  }
  let synced = false
  if (provider) {
    provider.once('sync', () => {
      synced = true
      onSynced()
    })
  }
  // 1.5s 超时兜底（ws 连不上或本地模式）
  setTimeout(() => {
    if (!synced) onSynced()
  }, 1500)

  // 监听本地 Zustand 变更
  // 立即推送, 避免节流期间被远端 apply 覆盖造成节点丢失.
  // 拖动节点 60fps 也能扛住 (每次 push 是 diff, 单条记录 set).
  // ⚠ 不能用引用比较 (state.nodes === lastNodes) 短路 — immer 在某些路径下
  // (单 set 改多个数组 / 数组 mutation) 会保持 nodes 数组引用不变, 导致漏 push.
  // 实际 yjs push 内部已经做 diff (JSON.stringify 比对), 重复 push 几乎零成本.
  _unsubStore = store.subscribe((state) => {
    if (_suppressLocalPush) return
    pushLocalToYjs(state.nodes, state.edges)
  })

  // 调试钩子: 浏览器 console / Playwright 可以读 yjs 实时状态
  // window.__yjsDebug.getNodes() — 当前 yjs nodes
  // window.__yjsDebug.isSuppressed() — sync 是否被 suppress
  // window.__zustand.getState() — zustand 当前 state
  if (typeof window !== 'undefined') {
    window.__yjsDebug = {
      getNodes: () => {
        const arr = []
        getNodesMap().forEach((v, k) => arr.push({ id: k, type: v.type, data: v.data }))
        return arr
      },
      getYDoc: getDoc,
      getProvider,
      isSuppressed: () => _suppressLocalPush,
      pushNow: () => pushLocalToYjs(useCanvasStore.getState().nodes, useCanvasStore.getState().edges),
    }
    window.__zustand = useCanvasStore
  }

  console.log('[yjsSync] attached, waiting for sync...')
}

/** sync 完成后决定初始数据来源 */
function finalizeStartup(stashedNodes, stashedEdges) {
  const yNodes = getNodesMap()
  const yEdges = getEdgesMap()
  const remoteHasData = yNodes.size > 0 || yEdges.size > 0

  if (remoteHasData) {
    console.log(`[yjsSync] sync done, applying ${yNodes.size} nodes / ${yEdges.size} edges from remote`)
    applyRemoteToLocal()
  } else if (stashedNodes.length > 0 || stashedEdges.length > 0) {
    console.log(`[yjsSync] sync done, pushing local ${stashedNodes.length} nodes / ${stashedEdges.length} edges to remote (first in room)`)
    // 把暂存数据写回本地 store + 推到 Yjs
    useCanvasStore.setState({ nodes: stashedNodes, edges: stashedEdges })
    pushLocalToYjs(stashedNodes, stashedEdges)
  } else {
    console.log('[yjsSync] sync done, both sides empty')
  }

  _suppressLocalPush = false
}

export function detachYjsSync() {
  if (!_attached) return
  _attached = false
  _suppressLocalPush = true
  if (_unsubStore) { _unsubStore(); _unsubStore = null }
  if (_unobserveNodes) { _unobserveNodes(); _unobserveNodes = null }
  if (_unobserveEdges) { _unobserveEdges(); _unobserveEdges = null }
}

/** 把本地 nodes/edges diff 到 Yjs（origin='local'，对端不会回弹） */
function pushLocalToYjs(nodes, edges) {
  const ydoc = getDoc()
  const yNodes = getNodesMap()
  const yEdges = getEdgesMap()

  ydoc.transact(() => {
    // Nodes diff
    const localNodeIds = new Set(nodes.map((n) => n.id))
    yNodes.forEach((_v, id) => { if (!localNodeIds.has(id)) yNodes.delete(id) })
    for (const n of nodes) {
      const plain = nodeToPlain(n)
      const prev = yNodes.get(n.id)
      if (!prev || JSON.stringify(prev) !== JSON.stringify(plain)) {
        yNodes.set(n.id, plain)
      }
    }
    // Edges diff
    const localEdgeIds = new Set(edges.map((e) => e.id))
    yEdges.forEach((_v, id) => { if (!localEdgeIds.has(id)) yEdges.delete(id) })
    for (const e of edges) {
      const plain = edgeToPlain(e)
      const prev = yEdges.get(e.id)
      if (!prev || JSON.stringify(prev) !== JSON.stringify(plain)) {
        yEdges.set(e.id, plain)
      }
    }
  }, ORIGIN_LOCAL)
}

/** 把 Yjs 内容写回本地 store，期间禁用本地→Yjs 推送防回弹 */
function applyRemoteToLocal() {
  const yNodes = getNodesMap()
  const yEdges = getEdgesMap()
  const nodes = []
  yNodes.forEach((v) => nodes.push(v))
  const edges = []
  yEdges.forEach((v) => edges.push(v))

  // ⚠ 不要用 microtask 恢复 _suppressLocalPush — finalizeStartup 调完
  // applyRemoteToLocal 后会设 _suppressLocalPush = false, 但 microtask 在那之后
  // 才把 wasSuppressed=true 写回, 永远把 _suppressLocalPush 锁死在 true,
  // 结果浏览器派的新节点全都漏 push 到 yjs.
  // 同步恢复就行 — setState 是 sync 调用, callback 也 sync 触发, suppress 已生效.
  const wasSuppressed = _suppressLocalPush
  _suppressLocalPush = true
  try {
    useCanvasStore.setState({ nodes, edges })
  } finally {
    _suppressLocalPush = wasSuppressed
  }
}

/** React Flow node → Yjs 可序列化对象 */
function nodeToPlain(n) {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data ?? {},
    width: n.width ?? null,
    height: n.height ?? null,
    parentNode: n.parentNode ?? null,
    extent: n.extent ?? null,
    hidden: n.hidden ?? false,
    draggable: n.draggable !== false,
    selectable: n.selectable !== false,
    style: n.style ?? null,
    // selected 不同步：每个用户的本地选中状态独立（通过 awareness selectedNodeIds 广播）
  }
}

function edgeToPlain(e) {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    type: e.type ?? 'default',
    label: e.label ?? null,
    data: e.data ?? {},
    style: e.style ?? null,
    animated: e.animated ?? false,
  }
}
