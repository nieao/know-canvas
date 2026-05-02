/**
 * PresenceLayer - 协作存在感层
 * - 顶部右侧显示在线用户头像列表（可独立放任意位置）
 * - 画布上叠加远端光标（用户色 + 用户名标签）
 * - 节点选中时显示是哪个远端用户在选（通过 selection 同步）
 *
 * 必须放在 ReactFlowProvider 内部使用，因为依赖 useReactFlow。
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useReactFlow } from 'reactflow'
import {
  setLocalCursor,
  setLocalSelection,
  onAwarenessChange,
  getRemoteStates,
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
    >
      <span className="text-[10px] mr-1" style={{ color: '#bbb', letterSpacing: '0.15em' }}>
        在线 {users.length + 1}
      </span>
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
  const [, forceUpdate] = useState(0)

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
    // 视口变化时也强制重渲，让屏幕坐标重算
    const vpInterval = setInterval(() => forceUpdate((n) => n + 1), 200)
    return () => {
      off()
      clearInterval(vpInterval)
    }
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
