/**
 * ChannelSwitcher — 私人/公共频道切换胶囊
 *
 * 设计:
 * - 默认折叠胶囊 (避免遮挡画布), 点击展开列表
 * - 频道分两类:
 *     private-{slug}  → 个人草稿空间 (圆点紫灰)
 *     pub-*           → 公共频道 (圆点暖色)
 * - 切换 = navigateToRoom(id) → 触发 reload, yjsClient 重连新房间
 * - 列表项: 系统预设 + 最近访问过的 (localStorage)
 * - 自定义房间: 输入框 + Enter
 *
 * 风格: 建筑极简, 跟 ScenarioSwitcher 同款胶囊
 */

import { useState, useEffect, useRef } from 'react'
import {
  getRoomFromUrl,
  getRoomDisplayName,
  getRoomType,
  getPrivateRoomFor,
  getUsername,
  navigateToRoom,
} from '../../collab/session'

const RECENT_KEY = 'know_canvas_recent_rooms'
const MAX_RECENT = 5

// 系统预设公共频道
const BUILTIN_PUBLIC = [
  { id: 'pub-default', label: '公共频道', desc: '全站公共, 任何人可加入' },
  { id: 'demo-final', label: '主房间 · demo-final', desc: 'Hackathon 三人共用' },
]

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    return JSON.parse(raw).slice(0, MAX_RECENT)
  } catch { return [] }
}

function pushRecent(roomId) {
  if (!roomId) return
  try {
    const cur = loadRecent().filter((r) => r !== roomId)
    cur.unshift(roomId)
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, MAX_RECENT)))
  } catch {}
}

export default function ChannelSwitcher() {
  const [expanded, setExpanded] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [recent, setRecent] = useState([])
  const ref = useRef(null)

  const currentRoom = getRoomFromUrl()
  const username = getUsername()
  const myPrivateRoom = username ? getPrivateRoomFor(username) : ''
  const currentType = getRoomType(currentRoom)
  const currentLabel = getRoomDisplayName(currentRoom)

  useEffect(() => {
    setRecent(loadRecent())
    if (currentRoom) pushRecent(currentRoom)
  }, [currentRoom])

  // 点空白处收起
  useEffect(() => {
    if (!expanded) return
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setExpanded(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [expanded])

  const handleSwitch = (roomId) => {
    if (!roomId || roomId === currentRoom) {
      setExpanded(false)
      return
    }
    pushRecent(roomId)
    navigateToRoom(roomId)
  }

  const handleCustom = () => {
    const id = customInput.trim()
    if (!id) return
    handleSwitch(id)
  }

  // 频道圆点色: private 紫灰 / public 暖 / custom 灰
  const dotColor = currentType === 'private' ? '#9e7cb2'
                 : currentType === 'public' ? 'var(--accent, #c8a882)'
                 : 'var(--gray-500, #888)'

  // 折叠胶囊
  if (!expanded) {
    return (
      <button
        type="button"
        ref={ref}
        onClick={() => setExpanded(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 12px',
          background: 'var(--surface, #fff)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--border-subtle, #e8e8e8)',
          borderRadius: '999px',
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
          fontSize: '11px',
          letterSpacing: '0.15em',
          color: 'var(--text-faint, #888)',
          cursor: 'pointer',
          userSelect: 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
        title={`当前频道: ${currentRoom || '未连接'}\n点击切换`}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor }} />
        <span>{currentLabel}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>
    )
  }

  // 展开面板
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 320,
          padding: '14px 16px',
          background: 'var(--surface, #fff)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid var(--border-subtle, #e8e8e8)',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        }}
      >
        {/* 收起 × */}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            position: 'absolute', top: 6, right: 8,
            width: 18, height: 18, padding: 0,
            background: 'transparent', border: 'none',
            color: 'var(--text-faint, #888)', cursor: 'pointer',
            fontSize: 14, lineHeight: 1,
          }}
          title="收起"
        >×</button>

        {/* 标题: 频道切换 */}
        <div style={{
          fontSize: 10, letterSpacing: '0.35em',
          color: 'var(--accent, #c8a882)',
          marginBottom: 10, textTransform: 'uppercase',
        }}>
          CHANNEL · 频道切换
        </div>

        {/* 私人草稿 */}
        {myPrivateRoom && (
          <RoomItem
            roomId={myPrivateRoom}
            label={`我的私人草稿 · ${username}`}
            desc="只有你能看到, 投送到公共频道才会被别人发现"
            dot="#9e7cb2"
            active={currentRoom === myPrivateRoom}
            onClick={() => handleSwitch(myPrivateRoom)}
          />
        )}

        {/* 分隔 */}
        <div style={{
          height: 1, background: 'var(--gray-100, #e8e8e8)',
          margin: '8px 0',
        }} />
        <div style={{
          fontSize: 9, letterSpacing: '0.35em',
          color: 'var(--gray-500, #888)',
          marginBottom: 6, textTransform: 'uppercase',
        }}>
          PUBLIC · 公共
        </div>

        {/* 公共预设 */}
        {BUILTIN_PUBLIC.map((p) => (
          <RoomItem
            key={p.id}
            roomId={p.id}
            label={p.label}
            desc={p.desc}
            dot="var(--accent, #c8a882)"
            active={currentRoom === p.id}
            onClick={() => handleSwitch(p.id)}
          />
        ))}

        {/* 最近访问 */}
        {recent.filter(r => r !== currentRoom && r !== myPrivateRoom && !BUILTIN_PUBLIC.find(p => p.id === r)).length > 0 && (
          <>
            <div style={{
              height: 1, background: 'var(--gray-100, #e8e8e8)',
              margin: '8px 0',
            }} />
            <div style={{
              fontSize: 9, letterSpacing: '0.35em',
              color: 'var(--gray-500, #888)',
              marginBottom: 6, textTransform: 'uppercase',
            }}>
              RECENT · 最近
            </div>
            {recent
              .filter(r => r !== currentRoom && r !== myPrivateRoom && !BUILTIN_PUBLIC.find(p => p.id === r))
              .slice(0, 3)
              .map((r) => (
                <RoomItem
                  key={r}
                  roomId={r}
                  label={getRoomDisplayName(r)}
                  desc={r}
                  dot={getRoomType(r) === 'private' ? '#9e7cb2' : 'var(--gray-500, #888)'}
                  active={false}
                  onClick={() => handleSwitch(r)}
                />
              ))}
          </>
        )}

        {/* 自定义 */}
        <div style={{
          height: 1, background: 'var(--gray-100, #e8e8e8)',
          margin: '8px 0',
        }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCustom()}
            placeholder="自定义房间 id..."
            style={{
              flex: 1, fontSize: 11, padding: '6px 10px',
              border: '1px solid var(--border-subtle, #e8e8e8)',
              borderRadius: 4, outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            onClick={handleCustom}
            disabled={!customInput.trim()}
            style={{
              padding: '6px 12px', fontSize: 10,
              letterSpacing: '0.15em',
              background: customInput.trim() ? 'var(--accent, #c8a882)' : 'var(--gray-100, #e8e8e8)',
              color: customInput.trim() ? '#fff' : 'var(--gray-500, #888)',
              border: 'none', borderRadius: 4,
              cursor: customInput.trim() ? 'pointer' : 'not-allowed',
            }}
          >进入</button>
        </div>
      </div>
    </div>
  )
}

function RoomItem({ label, desc, dot, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        width: '100%', padding: '8px 10px',
        background: active ? 'rgba(200,168,130,0.08)' : 'transparent',
        border: active ? '1px solid var(--accent, #c8a882)' : '1px solid transparent',
        borderRadius: 4, marginBottom: 2,
        cursor: 'pointer', textAlign: 'left',
        transition: 'all 0.3s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(200,168,130,0.04)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: dot, marginTop: 5, flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, color: 'var(--text-primary, #1a1a1a)',
          fontWeight: active ? 500 : 400,
        }}>{label}{active && ' · 当前'}</div>
        <div style={{
          fontSize: 10, color: 'var(--text-faint, #888)',
          marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{desc}</div>
      </div>
    </button>
  )
}
