/**
 * CollabHeader — 画布右上角的协作信息条
 *
 * 包含：AI 设置按钮 · 全局任务模式开关 · 在线用户列表 · 房间号/用户名徽章 · 退出按钮
 *
 * 拆出来的目的：让 KnowledgeGraph 只引一个组件，UI 细节内聚在协作子系统里。
 */

import { useEffect, useState } from 'react'
import { RemoteUserList } from './PresenceLayer'
import useCanvasStore from '../stores/useCanvasStore'

// 三种全局任务模式：自动路由 / 强制本地 / 强制 Hermes
const TASK_MODES = [
  { value: 'auto', label: '自动' },
  { value: 'local', label: '本地' },
  { value: 'hermes', label: 'Hermes' },
]

// 主题切换：4 选 1 循环（点击切下一个）
// default(建筑极简 · 白底) → blackgold(黑金 02) → cyberpunk(赛博朋克) → macaron(马卡龙Q版) → 回到 default
// 仅 toggle body 上的 .theme-xxx class, 让 CSS variables 自动反色
const THEMES = [
  { id: 'default',   label: '极简白',  icon: '○', bg: 'rgba(250,250,250,0.95)', border: '#e8e8e8', color: '#888' },
  { id: 'blackgold', label: '黑金 02', icon: '◆', bg: '#0a0a0a',                border: '#d4af37', color: '#d4af37' },
  { id: 'cyberpunk', label: '赛博朋克', icon: '⬢', bg: '#0d0221',                border: '#ff2a6d', color: '#ff2a6d' },
  { id: 'macaron',   label: '马卡龙 Q', icon: '♥', bg: '#fff5f9',                border: '#ffc9d9', color: '#ff8fb1' },
]

function ThemeToggle() {
  const [theme, setTheme] = useState(() =>
    typeof window !== 'undefined'
      ? localStorage.getItem('know_canvas_theme') || 'default'
      : 'default'
  )

  useEffect(() => {
    // 清掉所有主题 class, 再加当前主题
    document.body.classList.remove('theme-blackgold', 'theme-cyberpunk', 'theme-macaron')
    if (theme && theme !== 'default') document.body.classList.add(`theme-${theme}`)
    localStorage.setItem('know_canvas_theme', theme)
  }, [theme])

  const idx = Math.max(0, THEMES.findIndex((t) => t.id === theme))
  const cur = THEMES[idx] || THEMES[0]
  const nextIdx = (idx + 1) % THEMES.length
  const nxt = THEMES[nextIdx]

  return (
    <button
      onClick={() => setTheme(nxt.id)}
      title={`当前: ${cur.label}, 点击切到: ${nxt.label}`}
      className="px-2.5 py-1.5 rounded-lg shadow-sm transition-colors"
      style={{
        backgroundColor: cur.bg,
        border: `1px solid ${cur.border}`,
        color: cur.color,
        backdropFilter: 'blur(8px)',
        fontSize: '13px',
        lineHeight: 1,
        minWidth: '32px',
      }}
    >
      {cur.icon}
    </button>
  )
}

// 三段式任务模式开关 (segmented control) — 选中 warm-bg/warm，非选中透明/灰
function TaskModeSwitch() {
  const taskMode = useCanvasStore((s) => s.taskMode)
  const setTaskMode = useCanvasStore((s) => s.setTaskMode)
  const wrap = {
    backgroundColor: 'rgba(250,250,250,0.95)', border: '1px solid #e8e8e8',
    backdropFilter: 'blur(8px)', padding: '3px 8px',
    fontFamily: '"Noto Sans SC", system-ui, sans-serif',
  }
  return (
    <div className="flex items-center gap-1.5 rounded-lg shadow-sm" style={wrap}>
      <span style={{ fontSize: '0.7rem', letterSpacing: '0.25em', color: '#bbb' }}>模式</span>
      <div className="flex items-center" style={{ border: '1px solid #e8e8e8', borderRadius: '6px', overflow: 'hidden' }}>
        {TASK_MODES.map((m, i) => {
          const active = taskMode === m.value
          return (
            <button
              key={m.value}
              onClick={() => setTaskMode(m.value)}
              className="transition-colors"
              style={{
                fontSize: '11px', padding: '4px 12px', cursor: 'pointer',
                background: active ? 'var(--warm-bg, #f5f0eb)' : 'transparent',
                color: active ? 'var(--warm, #c8a882)' : '#888',
                borderLeft: i === 0 ? 'none' : '1px solid #e8e8e8',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = '#555' }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#888' }}
              title={`任务模式: ${m.label}`}
            >
              {m.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function CollabHeader({ room, username, onOpenAiSettings, onExit }) {
  return (
    <div className="absolute top-4 right-16 z-30 flex items-center gap-2">
      <button
        onClick={onOpenAiSettings}
        className="px-2.5 py-1.5 rounded-lg shadow-sm transition-colors"
        style={{
          backgroundColor: 'rgba(250,250,250,0.95)',
          border: '1px solid #e8e8e8',
          color: '#888',
          backdropFilter: 'blur(8px)',
        }}
        title="AI 模型设置"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <ThemeToggle />
      <TaskModeSwitch />
      <RemoteUserList />
      <div
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg shadow-sm"
        style={{
          backgroundColor: 'rgba(250,250,250,0.95)',
          border: '1px solid #e8e8e8',
          backdropFilter: 'blur(8px)',
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        }}
      >
        <span className="text-[10px]" style={{ color: '#bbb', letterSpacing: '0.15em' }}>房间</span>
        <span className="text-xs font-medium" style={{ color: '#c8a882' }}>{room}</span>
        <span className="mx-1 text-[10px]" style={{ color: '#e8e8e8' }}>·</span>
        <span className="text-xs" style={{ color: '#888' }}>{username}</span>
        <button
          onClick={onExit}
          className="ml-1 text-[10px] px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors"
          style={{ color: '#bbb' }}
          title="退出"
        >
          ×
        </button>
      </div>
    </div>
  )
}
