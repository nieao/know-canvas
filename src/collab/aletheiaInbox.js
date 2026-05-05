/**
 * aletheia-inbox — 飞书 / 外部源远程触发元认知
 *
 * 工作流:
 *   1) bot daemon 把消息写到 ydoc.getMap('aletheia-inbox') 一条 item
 *      item = { id, text, attribution, ts, status:'pending' }
 *   2) 所有协作者订阅 inbox map; 当新 item 到达时, 走选举:
 *      - awareness 中 client id 最小者 = 执行者
 *      - 执行者: 把 item.text dispatchEvent('aletheia-inbox-fire') 给 BottomAIBar
 *               + 在 yjs transaction 里把 item.status 改为 'processing' (race-free)
 *      - 非执行者: 不做事 (避免 N 个 cc 同时调 LLM)
 *   3) BottomAIBar 收到 fire 事件 → setInput(text) + handleSubmit()
 *
 * 离线场景: 消息留在 inbox 里 (yjs 持久化), 等画布有人打开自动补 fire
 */

import { getDoc, getProvider } from './yjsClient'

const INBOX_KEY = 'aletheia-inbox'

let _attached = false
let _inboxMap = null
let _observer = null

function getInboxMap() {
  if (!_inboxMap) _inboxMap = getDoc().getMap(INBOX_KEY)
  return _inboxMap
}

/** 当前在线 awareness 状态里 client id 最小者 — 简单选举, 多 cc 不重复执行 */
function isElectedExecutor() {
  const provider = getProvider()
  if (!provider) return true // provider 未就绪默认让自己 fire (单机)
  const awareness = provider.awareness
  const myId = getDoc().clientID
  const states = awareness.getStates()
  if (states.size === 0) return true
  let minId = myId
  states.forEach((_state, clientId) => { if (clientId < minId) minId = clientId })
  return minId === myId
}

/** 处理一条 inbox item — 选举 + dispatch 事件 + 更新状态 */
function handleItem(id, item) {
  if (!item || item.status !== 'pending') return
  if (!isElectedExecutor()) {
    console.log('[aletheia-inbox] 非执行者, 跳过 fire (但 UI 可见 inbox)', id)
    return
  }

  // race 防护: yjs transaction 标记 processing, 这样即使刚好两 cc 都觉得自己是 min id (网络抖动)
  // 第二个看到 status 已经被改, 也不会 fire
  const map = getInboxMap()
  const fresh = map.get(id)
  if (!fresh || fresh.status !== 'pending') return
  getDoc().transact(() => {
    map.set(id, { ...fresh, status: 'processing', processedBy: getDoc().clientID, processedAt: Date.now() })
  }, 'aletheia-inbox-claim')

  console.log('[aletheia-inbox] fire 元认知:', fresh.text.slice(0, 60))

  // dispatch 给 BottomAIBar — payload 含 text + 来源标签 (UI 可显示飞书来的)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aletheia-inbox-fire', {
      detail: {
        id,
        text: fresh.text,
        attribution: fresh.attribution || { via: 'unknown' },
      },
    }))
  }
}

/** 找最老的 pending (按 ts 升序), 没有则返回 null */
function findOldestPending() {
  const map = getInboxMap()
  let oldest = null
  map.forEach((item, key) => {
    if (item?.status !== 'pending') return
    const ts = Number(item.ts || 0)
    if (!oldest || ts < oldest.ts) oldest = { key, item, ts }
  })
  return oldest
}

/**
 * 扫一次, 只 fire 最老的一条 pending — 让 BottomAIBar 串行处理.
 * 当前一条 LLM 跑完后, BottomAIBar 应主动调本函数取下一条.
 * 不能一次性 fire 全部: 因为 handleItem 会立刻把 yjs 状态标 processing,
 * 而 BottomAIBar 自己有 submitting 守护会把后续 fire 全部丢弃, 导致 inbox 永远卡死 processing.
 */
export function scanInboxNext() {
  if (!_attached) return
  const oldest = findOldestPending()
  if (oldest) handleItem(oldest.key, oldest.item)
}

/** mount 时挂上, unmount 时清掉 */
export function attachAletheiaInbox() {
  if (_attached) return
  _attached = true
  const map = getInboxMap()

  _observer = (event) => {
    // event.changes.keys 是 Map<key, {action: 'add'|'update'|'delete'}>
    event.changes.keys.forEach((change, key) => {
      if (change.action === 'add') {
        const item = map.get(key)
        // 新增的 pending 立即处理 (handleItem 自带 submitting / 选举守护)
        handleItem(key, item)
      } else if (change.action === 'update') {
        // update 不做 fire (避免循环)
      }
    })
  }
  map.observe(_observer)

  // 初次挂上时, 只 fire 最老的一条 pending — 后续靠 BottomAIBar 跑完后回调 scanInboxNext()
  setTimeout(() => { scanInboxNext() }, 1500) // 等 awareness 稳定再扫
}

export function detachAletheiaInbox() {
  if (!_attached) return
  _attached = false
  if (_inboxMap && _observer) _inboxMap.unobserve(_observer)
  _inboxMap = null
  _observer = null
}

/** 给 UI 用 — 当前 inbox 待处理数量 (展示用) */
export function getInboxPendingCount() {
  if (!_inboxMap) return 0
  let n = 0
  _inboxMap.forEach((item) => { if (item?.status === 'pending') n += 1 })
  return n
}
