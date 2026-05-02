/**
 * JoinRoom - 协作画布入口页
 * 用户输入用户名 + 房间号（或新建一个），跳到 /?room=xxx
 * 建筑极简风格
 */

import { useState, useEffect } from 'react'
import {
  getUsername,
  setUsername,
  getUserColor,
  setUserColor,
  USER_PALETTE,
  navigateToRoom,
  getRoomFromUrl,
} from '../collab/session'

// 简易 nanoid（房间号生成）
const genRoomId = () => {
  const alpha = 'abcdefghijkmnpqrstuvwxyz23456789'
  let id = ''
  for (let i = 0; i < 6; i++) id += alpha[Math.floor(Math.random() * alpha.length)]
  return id
}

// 当前 hackathon 主房间 — orchestra conductor 默认 BOOT_ROOMS 接管的房间
// 三人协作时点"快速进入主房间"即可，确保都进同一个 room
const PRIMARY_ROOM = 'demo-final'

export default function JoinRoom() {
  const [name, setName] = useState(getUsername())
  const [room, setRoom] = useState(getRoomFromUrl())
  const [color, setColor] = useState(getUserColor())
  const [error, setError] = useState('')

  // 没用户名先聚焦输入框
  useEffect(() => {
    document.title = 'Know Canvas — 进入协作'
  }, [])

  const canJoin = name.trim().length > 0 && room.trim().length > 0
  const canCreate = name.trim().length > 0

  const handleJoin = () => {
    setError('')
    if (!canJoin) {
      setError('请填写用户名和房间号')
      return
    }
    setUsername(name.trim())
    setUserColor(color)
    navigateToRoom(room.trim())
  }

  const handleCreate = () => {
    setError('')
    if (!canCreate) {
      setError('请先填写用户名')
      return
    }
    setUsername(name.trim())
    setUserColor(color)
    navigateToRoom(genRoomId())
  }

  const handleJoinPrimary = () => {
    setError('')
    if (!canCreate) {
      setError('请先填写用户名')
      return
    }
    setUsername(name.trim())
    setUserColor(color)
    navigateToRoom(PRIMARY_ROOM)
  }

  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      style={{ backgroundColor: '#fafafa', fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}
    >
      {/* 建筑网格装饰 */}
      <div className="fixed inset-0 pointer-events-none" style={{ opacity: 0.04 }}>
        <div className="absolute top-1/2 left-0 right-0 h-px" style={{ background: '#1a1a1a' }} />
        <div className="absolute top-0 bottom-0 left-1/2 w-px" style={{ background: '#1a1a1a' }} />
      </div>

      <div
        className="w-full max-w-md mx-auto px-10 py-12 rounded-lg relative"
        style={{
          backgroundColor: '#fafafa',
          border: '1px solid #e8e8e8',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        {/* 顶部细线 */}
        <div className="absolute top-0 left-8 right-8 h-px" style={{ background: '#c8a882' }} />

        {/* 段落标签 */}
        <div
          className="text-xs font-medium mb-3"
          style={{ color: '#c8a882', letterSpacing: '0.35em' }}
        >
          KNOW / CANVAS
        </div>

        <h1
          className="text-2xl font-light mb-2"
          style={{ color: '#1a1a1a', fontFamily: '"Noto Serif SC", Georgia, serif', letterSpacing: '0.02em' }}
        >
          进入协作画布
        </h1>
        <p className="text-sm mb-8" style={{ color: '#888' }}>
          填写用户名与房间号，与团队成员共建一张图谱
        </p>

        {/* 用户名 */}
        <div className="mb-5">
          <label className="block text-xs font-medium mb-1.5" style={{ color: '#888', letterSpacing: '0.1em' }}>
            用户名
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canJoin && handleJoin()}
            placeholder="例如：你想猫"
            autoFocus
            className="w-full px-3 py-2.5 text-sm rounded-md focus:outline-none focus:ring-1"
            style={{
              border: '1px solid #e8e8e8',
              color: '#2d2d2d',
              backgroundColor: '#fff',
            }}
          />
        </div>

        {/* 房间号 */}
        <div className="mb-5">
          <label className="block text-xs font-medium mb-1.5" style={{ color: '#888', letterSpacing: '0.1em' }}>
            房间号
          </label>
          <input
            type="text"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canJoin && handleJoin()}
            placeholder="例如：hackathon-2026"
            className="w-full px-3 py-2.5 text-sm rounded-md focus:outline-none focus:ring-1"
            style={{
              border: '1px solid #e8e8e8',
              color: '#2d2d2d',
              backgroundColor: '#fff',
            }}
          />
          <p className="text-[11px] mt-1.5" style={{ color: '#bbb' }}>
            房间号即邀请码，团队成员填同一个就能进同一张画布
          </p>
        </div>

        {/* 颜色 */}
        <div className="mb-7">
          <label className="block text-xs font-medium mb-1.5" style={{ color: '#888', letterSpacing: '0.1em' }}>
            个人色（光标 / 选中标识）
          </label>
          <div className="flex flex-wrap gap-1.5">
            {USER_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  border: color === c ? '2px solid #1a1a1a' : '1px solid #e8e8e8',
                }}
                title={c}
              />
            ))}
          </div>
        </div>

        {/* 错误 */}
        {error && (
          <p className="text-xs mb-3" style={{ color: '#ef4444' }}>{error}</p>
        )}

        {/* 快速进入主房间 — Hackathon demo 三人共用 */}
        <button
          type="button"
          onClick={handleJoinPrimary}
          disabled={!canCreate}
          className="w-full py-3 text-sm font-medium rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed mb-2 group relative"
          style={{
            backgroundColor: '#1a1a1a',
            color: '#fafafa',
            letterSpacing: '0.05em',
          }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle" style={{ backgroundColor: '#c8a882' }} />
          快速进入主房间 · {PRIMARY_ROOM}
        </button>

        <div className="flex items-center gap-3 my-3">
          <div className="flex-1 h-px" style={{ background: '#e8e8e8' }} />
          <span className="text-[10px]" style={{ color: '#bbb', letterSpacing: '0.2em' }}>OR</span>
          <div className="flex-1 h-px" style={{ background: '#e8e8e8' }} />
        </div>

        {/* 按钮 */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleJoin}
            disabled={!canJoin}
            className="flex-1 py-2.5 text-sm font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: '#c8a882',
              color: '#fafafa',
            }}
          >
            进入自定义房间
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className="flex-1 py-2.5 text-sm font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: '#fafafa',
              color: '#2d2d2d',
              border: '1px solid #e8e8e8',
            }}
          >
            新建随机房间
          </button>
        </div>

        <p className="text-[11px] mt-6 text-center" style={{ color: '#bbb' }}>
          所有数据通过 Yjs 实时同步 · 服务器仅做中转 · 浏览器本地缓存
        </p>
      </div>
    </div>
  )
}
