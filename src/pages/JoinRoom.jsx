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
  getPrivateRoomFor,
} from '../collab/session'

// 简易 nanoid（房间号生成）
const genRoomId = () => {
  const alpha = 'abcdefghijkmnpqrstuvwxyz23456789'
  let id = ''
  for (let i = 0; i < 6; i++) id += alpha[Math.floor(Math.random() * alpha.length)]
  return id
}

// 主公共频道 — 三人协作 / 黑客松 demo 共用
const PRIMARY_ROOM = 'demo-final'

// 三人组快捷名字 — 点击即填入用户名
const PRESET_NAMES = ['lichang', '你想猫', '小叶']

// 默认用户名 — 没历史 localStorage 时使用
const DEFAULT_NAME = '你想猫'

export default function JoinRoom() {
  const [name, setName] = useState(getUsername() || DEFAULT_NAME)
  const [room, setRoom] = useState(getRoomFromUrl())
  const [color, setColor] = useState(getUserColor())
  const [error, setError] = useState('')

  // 没用户名先聚焦输入框
  useEffect(() => {
    document.title = 'ALETHEIA — 进入协作'
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

  // 默认入口: 进自己的私人草稿空间 — 不被其他用户看到, 想协作时再用顶部 ChannelSwitcher 切公共
  const handleJoinPrivate = () => {
    setError('')
    if (!canCreate) {
      setError('请先填写用户名')
      return
    }
    setUsername(name.trim())
    setUserColor(color)
    navigateToRoom(getPrivateRoomFor(name.trim()))
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
          ALETHEIA
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
          {/* 三人组快捷选择 */}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px]" style={{ color: '#bbb', letterSpacing: '0.2em' }}>快捷</span>
            {PRESET_NAMES.map((preset) => {
              const active = name.trim() === preset
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setName(preset)}
                  className="px-3 py-1 text-xs rounded-full transition-all duration-300"
                  style={{
                    border: active ? '1px solid #c8a882' : '1px solid #e8e8e8',
                    color: active ? '#c8a882' : '#888',
                    background: active ? 'rgba(200,168,130,0.08)' : '#fff',
                    letterSpacing: '0.05em',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.borderColor = '#c8a882'
                      e.currentTarget.style.color = '#c8a882'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.borderColor = '#e8e8e8'
                      e.currentTarget.style.color = '#888'
                    }
                  }}
                >
                  {preset}
                </button>
              )
            })}
          </div>
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

        {/* 默认入口: 进主公共房间 — 三人协作 + 飞书 bot 默认落点 */}
        <button
          type="button"
          onClick={handleJoinPrimary}
          disabled={!canCreate}
          className="w-full py-3 text-sm font-medium rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed mb-2"
          style={{
            backgroundColor: '#1a1a1a',
            color: '#fafafa',
            letterSpacing: '0.05em',
          }}
          title="进入主公共房间, 跟其他在线用户一起协作 (飞书 bot 也默认写到这里)"
          autoFocus
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle" style={{ backgroundColor: '#c8a882' }} />
          进公共主房间 · {PRIMARY_ROOM}{name.trim() ? ` · ${name.trim()}` : ''}
        </button>

        {/* 次入口: 私人草稿 */}
        <button
          type="button"
          onClick={handleJoinPrivate}
          disabled={!canCreate}
          className="w-full py-2.5 text-sm rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed mb-2"
          style={{
            background: '#fafafa',
            color: '#2d2d2d',
            border: '1px solid #e8e8e8',
            letterSpacing: '0.05em',
          }}
          title="进入只属于你的草稿画布, 想协作时随时切到公共频道"
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle" style={{ backgroundColor: '#9e7cb2' }} />
          进入私人草稿{name.trim() ? ` · ${name.trim()}` : ''}
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
          私人草稿仅你可见 · 想协作时点画布顶部"频道切换" · 数据走 Yjs 实时同步
        </p>
      </div>
    </div>
  )
}
