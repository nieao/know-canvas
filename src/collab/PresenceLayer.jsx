/**
 * PresenceLayer - 协作存在感层
 * - 顶部右侧显示在线用户头像列表（可独立放任意位置）
 * - 画布上叠加远端光标（用户色 + 用户名标签）
 * - 节点选中时显示是哪个远端用户在选（通过 selection 同步）
 *
 * 必须放在 ReactFlowProvider 内部使用，因为依赖 useReactFlow。
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useReactFlow, useStore } from 'reactflow'
import {
  setLocalCursor,
  setLocalSelection,
  onAwarenessChange,
  getRemoteStates,
  getAwareness,
} from './yjsClient'

// 节流：远端光标 30fps
const throttle = (fn, ms) => {
  let last = 0
  let pendingTimer = null
  return (...args) => {
    const now = Date.now()
    const elapsed = now - last
    if (elapsed >= ms) {
      last = now
      fn(...args)
    } else {
      if (pendingTimer) clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => {
        last = Date.now()
        fn(...args)
      }, ms - elapsed)
    }
  }
}

/** 在线用户头像列表（小气泡，建议放 top-4 right-20） */
export function RemoteUserList({ className = '', style = {} }) {
  const [users, setUsers] = useState([])

  useEffect(() => {
    const update = () => {
      const states = getRemoteStates()
      const list = states
        .filter((s) => s.user)
        .map((s) => ({
          clientId: s.clientId,
          name: s.user.name,
          color: s.user.color,
        }))
      setUsers(list)
    }
    update()
    const off = onAwarenessChange(update)
    return off
  }, [])

  // 1 人 (只有自己) 时不显示 — 协作没启动, 没必要占顶栏空间
  if (users.length === 0) return null

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg shadow-sm ${className}`}
      style={{
        backgroundColor: 'rgba(250,250,250,0.95)',
        border: '1px solid #e8e8e8',
        backdropFilter: 'blur(8px)',
        ...style,
      }}
      data-testid="online-users"
      title={`在线 ${users.length + 1} 人`}
    >
      {users.map((u) => (
        <div
          key={u.clientId}
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-white"
          style={{ backgroundColor: u.color || '#888' }}
          title={u.name}
        >
          {(u.name || '?').slice(0, 1).toUpperCase()}
        </div>
      ))}
    </div>
  )
}

/**
 * Awareness 集成层（必须放 ReactFlow 容器内）
 *  - 监听本地鼠标 → 广播 cursor
 *  - 渲染远端光标
 */
export function CursorAwarenessLayer({ wrapperRef, nodes }) {
  const reactFlowInstance = useReactFlow()
  const [cursors, setCursors] = useState([])
  // viewport 变化时 transform 改, 组件自然重渲 (替代 200ms 轮询 forceUpdate, 显著降 CPU)
  // ✅ useStore 只在 transform 实际变时触发 re-render, idle 不消耗
  useStore((s) => s.transform)

  // 选中节点广播
  useEffect(() => {
    const selectedIds = (nodes || []).filter((n) => n.selected).map((n) => n.id)
    setLocalSelection(selectedIds)
  }, [nodes])

  // 鼠标位置广播（flow 坐标系）
  useEffect(() => {
    const el = wrapperRef?.current
    if (!el) return

    const broadcast = throttle((clientX, clientY) => {
      try {
        const flow = reactFlowInstance.screenToFlowPosition({ x: clientX, y: clientY })
        setLocalCursor({ x: flow.x, y: flow.y, t: Date.now() })
      } catch (_e) {}
    }, 33)

    const onMove = (e) => broadcast(e.clientX, e.clientY)
    const onLeave = () => setLocalCursor(null)
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [wrapperRef, reactFlowInstance])

  // 远端光标 + 缩放/平移变化时重渲
  useEffect(() => {
    const update = () => {
      const states = getRemoteStates()
      const list = []
      for (const s of states) {
        if (s.user && s.cursor && typeof s.cursor.x === 'number') {
          list.push({
            clientId: s.clientId,
            name: s.user.name,
            color: s.user.color || '#888',
            x: s.cursor.x,
            y: s.cursor.y,
          })
        }
      }
      setCursors(list)
    }
    update()
    const off = onAwarenessChange(update)
    return off
  }, [])

  const transform = useCallback((cursor) => {
    try {
      return reactFlowInstance.flowToScreenPosition({ x: cursor.x, y: cursor.y })
    } catch (_e) {
      return null
    }
  }, [reactFlowInstance])

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 25 }}>
      {cursors.map((c) => {
        const pos = transform(c)
        if (!pos) return null
        const wrapperRect = wrapperRef?.current?.getBoundingClientRect()
        const x = wrapperRect ? pos.x - wrapperRect.left : pos.x
        const y = wrapperRect ? pos.y - wrapperRect.top : pos.y
        return (
          <div
            key={c.clientId}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transition: 'left 0.05s linear, top 0.05s linear',
            }}
          >
            <svg width="20" height="22" viewBox="0 0 20 22" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.2))' }}>
              <path
                d="M 2 2 L 2 18 L 6 14 L 9 20 L 12 19 L 9 13 L 16 13 Z"
                fill={c.color}
                stroke="white"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="px-1.5 py-0.5 text-[10px] rounded text-white whitespace-nowrap"
              style={{
                backgroundColor: c.color,
                fontFamily: '"Noto Sans SC", system-ui, sans-serif',
                position: 'absolute',
                top: 16,
                left: 14,
              }}
            >
              {c.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Hook：根据远端 awareness 算出"哪些节点正被某用户选中"，给画布渲染用 */
export function useRemoteSelections() {
  const [map, setMap] = useState({})  // nodeId → { name, color }

  useEffect(() => {
    const update = () => {
      const states = getRemoteStates()
      const m = {}
      for (const s of states) {
        if (s.user && Array.isArray(s.selectedNodeIds)) {
          for (const id of s.selectedNodeIds) {
            m[id] = { name: s.user.name, color: s.user.color || '#888' }
          }
        }
      }
      setMap(m)
    }
    update()
    const off = onAwarenessChange(update)
    return off
  }, [])

  return map
}

/**
 * Hook：订阅远端 + 本地的"最近移动节点"awareness 字段
 * 返回 { nodeId → { name, color, ts } }，命中后 3 秒自动清除
 *
 * 包含本地用户：自己刚拖完一个节点也呼吸（直观反馈）
 * 远端：通过 awareness movedNode 字段同步
 */
export function useRecentMovers(windowMs = 3000) {
  const [map, setMap] = useState({})

  useEffect(() => {
    let timer = null

    const update = () => {
      // 收集所有 client（含本地）的 movedNode
      const states = getRemoteStates() // 远端
      const all = [...states]
      // 本地 awareness 也读一下，让自己拖也呼吸（远端列表不含自己）
      const localAw = getAwareness()
      if (localAw) {
        const local = localAw.getLocalState()
        if (local) all.push({ ...local, clientId: localAw.clientID })
      }

      const now = Date.now()
      setMap((prev) => {
        const next = { ...prev }
        // 清理过期
        for (const k of Object.keys(next)) {
          if (now - next[k].ts > windowMs) delete next[k]
        }
        for (const s of all) {
          if (s?.user && s?.movedNode?.nodeId) {
            // 仅在 ts 比 prev 新时更新（避免重复触发气泡）
            const exist = next[s.movedNode.nodeId]
            if (!exist || exist.ts < s.movedNode.ts) {
              next[s.movedNode.nodeId] = {
                name: s.user.name,
                color: s.user.color || '#888',
                ts: s.movedNode.ts,
              }
            }
          }
        }
        return next
      })
    }

    update()
    const off = onAwarenessChange(update)
    // 周期性清扫，让过期项主动退场（不依赖下一次 awareness change）
    timer = setInterval(() => {
      const now = Date.now()
      setMap((prev) => {
        let dirty = false
        const next = {}
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.ts <= windowMs) next[k] = v
          else dirty = true
        }
        return dirty ? next : prev
      })
    }, 500)

    return () => {
      off()
      if (timer) clearInterval(timer)
    }
  }, [windowMs])

  return map
}

/**
 * NodeBadgeLayer — 叠加在画布上的节点临时事件层（**只**渲染移动呼吸 ring + 气泡）
 *
 * 历史: 这里曾渲染过持久 createdBy 小圆头像浮层, 由于
 *   1) 浮层在 ReactFlow stacking context 内, z-index 低于 fixed panel 仍透出, 跑到 DebateStream 面板里
 *   2) 用户语义诉求是"任务节点本体带创建者名字", 不是空中飞的小头像
 * 已下线 createdBy 浮层。
 * 创建者名字现在直接由节点组件读 data.createdBy 自渲, 见 OntologyNode 等节点的 created-by-stamp。
 */
export function NodeBadgeLayer({ wrapperRef, nodes }) {
  const reactFlowInstance = useReactFlow()
  const recentMovers = useRecentMovers(3000)
  // viewport 变化触发 re-render (替代 200ms forceUpdate 轮询)
  useStore((s) => s.transform)

  if (!nodes || nodes.length === 0) return null

  const wrapperRect = wrapperRef?.current?.getBoundingClientRect()
  let zoom = 1
  try { zoom = reactFlowInstance.getZoom() } catch (_e) {}

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 26 }}>
      <style>{`
        @keyframes node-breathe {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.03); }
        }
        @keyframes badge-pop {
          0% { transform: translate(-50%, -100%) scale(0.6); opacity: 0; }
          40% { transform: translate(-50%, -110%) scale(1.05); opacity: 1; }
          100% { transform: translate(-50%, -100%) scale(1); opacity: 1; }
        }
      `}</style>

      {nodes.map((node) => {
        const mover = recentMovers[node.id]
        if (!mover) return null  // 没有移动事件就完全不渲染（不再渲染 createdBy 浮层）

        // flow 坐标 → 屏幕坐标 → wrapper 内坐标
        let pos
        try {
          pos = reactFlowInstance.flowToScreenPosition({
            x: node.position.x,
            y: node.position.y,
          })
        } catch (_e) {
          return null
        }
        const x = wrapperRect ? pos.x - wrapperRect.left : pos.x
        const y = wrapperRect ? pos.y - wrapperRect.top : pos.y

        // 节点尺寸（react-flow 在 measure 后填充）
        const nodeW = (node.width || node.measured?.width || 200) * zoom
        const nodeH = (node.height || node.measured?.height || 80) * zoom

        return (
          <div
            key={node.id}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: nodeW,
              height: nodeH,
            }}
          >
            {/* 呼吸 ring */}
            <div
              style={{
                position: 'absolute',
                inset: -3,
                borderRadius: 12,
                border: `2px solid ${mover.color}`,
                boxShadow: `0 0 12px ${mover.color}66`,
                animation: 'node-breathe 1.4s ease-in-out infinite',
                pointerEvents: 'none',
                transformOrigin: 'center center',
              }}
            />

            {/* 移动气泡 — 节点上方"X 移动了"（key=ts 让重复移动重播动画） */}
            <div
              key={mover.ts}
              style={{
                position: 'absolute',
                top: -8,
                left: '50%',
                transform: 'translate(-50%, -100%)',
                background: mover.color,
                color: 'white',
                fontSize: 10,
                lineHeight: 1.3,
                padding: '3px 8px',
                borderRadius: 999,
                whiteSpace: 'nowrap',
                fontFamily: '"Noto Sans SC", system-ui, sans-serif',
                fontWeight: 500,
                boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                animation: 'badge-pop 0.25s ease-out',
                zIndex: 3,
              }}
            >
              {mover.name} 移动了
            </div>
          </div>
        )
      })}
    </div>
  )
}
