/**
 * CollabHeader — 画布右上角的协作信息条
 *
 * 包含：AI 设置按钮 · 全局任务模式开关 · 在线用户列表 · 房间号/用户名徽章 · 退出按钮
 *
 * 拆出来的目的：让 KnowledgeGraph 只引一个组件，UI 细节内聚在协作子系统里。
 */

import { useEffect, useState, useRef } from 'react'
import { RemoteUserList } from './PresenceLayer'
import useCanvasStore from '../stores/useCanvasStore'

// 三种全局任务模式: 自动路由 / 强制元认知 skill / 强制 Hermes
// 'local' value 保留 (兼容已持久化的 localStorage), 但 UI 改名"元认知" + 内部走 5 步元认知工作流
const TASK_MODES = [
  { value: 'auto',   label: '自动' },
  { value: 'local',  label: '元认知', title: '元认知 skill: 5 步工作流 (意图理解/拆解/执行/反思/综合), 步骤逐个长出节点' },
  { value: 'hermes', label: 'Hermes' },
]

// 主题切换 — 下拉菜单, 6 个主题 (3 浅 + 1 偏冷 + 1 偏甜 + 1 深霓虹)
// 数据驱动: { id, label, icon, swatchBg, swatchAccent, desc }
//   - swatchBg/Accent 用于左侧色块预览, 用户能直接看到这是个啥色调
//   - body class = 'theme-{id}' (default 不加 class)
const THEMES = [
  { id: 'default',   label: '建筑极简',   en: 'ARCHITECTURAL', icon: '○', swatchBg: '#fafafa', swatchAccent: '#c8a882', desc: '白底 + 暖灰金' },
  { id: 'mistblue',  label: '极简 02 · 雾蓝', en: 'MIST BLUE',  icon: '◐', swatchBg: '#f6f8fa', swatchAccent: '#4a6e8a', desc: '蓝白 + 钢蓝' },
  { id: 'forest',    label: '森林 · 苔影', en: 'MOSSY FOREST',  icon: '❀', swatchBg: '#f7f5ee', swatchAccent: '#5a7a4a', desc: '米白 + 苔绿' },
  { id: 'macaron',   label: '马卡龙 Q',   en: 'MACARON Q',     icon: '♥', swatchBg: '#fff5f9', swatchAccent: '#ff8fb1', desc: '奶粉 + 马卡龙' },
  { id: 'blackgold', label: '黑金 02',     en: 'BLACK & GOLD',  icon: '◆', swatchBg: '#0a0a0a', swatchAccent: '#d4af37', desc: '深底 + 金线' },
  { id: 'cyberpunk', label: '赛博朋克',    en: 'CYBERPUNK',     icon: '⬢', swatchBg: '#0d0221', swatchAccent: '#ff2a6d', desc: '紫黑 + 霓虹粉' },
]
const ALL_THEME_CLASSES = ['theme-blackgold', 'theme-cyberpunk', 'theme-macaron', 'theme-mistblue', 'theme-forest']

function ThemeToggle() {
  const [theme, setTheme] = useState(() =>
    typeof window !== 'undefined'
      ? localStorage.getItem('know_canvas_theme') || 'default'
      : 'default'
  )
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    document.body.classList.remove(...ALL_THEME_CLASSES)
    if (theme && theme !== 'default') document.body.classList.add(`theme-${theme}`)
    localStorage.setItem('know_canvas_theme', theme)
  }, [theme])

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const cur = THEMES.find((t) => t.id === theme) || THEMES[0]
  const isDark = theme === 'blackgold' || theme === 'cyberpunk'

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`当前主题: ${cur.label}`}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg shadow-sm transition-colors"
        style={{
          backgroundColor: 'var(--surface, rgba(250,250,250,0.95))',
          border: '1px solid var(--border-subtle, #e8e8e8)',
          color: 'var(--text-secondary, #555)',
          backdropFilter: 'blur(8px)',
          fontSize: '12px',
          lineHeight: 1,
        }}
      >
        {/* 左色块预览 */}
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 14, height: 14,
            borderRadius: 3,
            background: cur.swatchBg,
            border: `1.5px solid ${cur.swatchAccent}`,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-secondary, #555)' }}>{cur.label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted, #888)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 rounded-lg shadow-xl py-1.5 z-[100]"
          style={{
            background: 'var(--surface, #ffffff)',
            border: '1px solid var(--border-subtle, #e8e8e8)',
            backdropFilter: 'blur(12px)',
            minWidth: 240,
            boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          }}
        >
          <div
            style={{
              padding: '6px 12px 4px',
              fontSize: 9,
              letterSpacing: '0.3em',
              color: 'var(--text-muted, #888)',
              fontWeight: 600,
            }}
          >
            主题 · THEME
          </div>
          {THEMES.map((t) => {
            const active = t.id === theme
            return (
              <button
                key={t.id}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { setTheme(t.id); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                style={{
                  background: active ? 'var(--accent-bg, var(--warm-bg, #f5f0eb))' : 'transparent',
                  cursor: 'pointer',
                  border: 'none',
                  color: 'var(--text-secondary, #555)',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--accent-bg, var(--warm-bg, #f5f0eb))' }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                {/* 色块大预览 (主题底色 + 主题强调色双层) */}
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 24, height: 24,
                    borderRadius: 4,
                    background: t.swatchBg,
                    border: `2px solid ${t.swatchAccent}`,
                    flexShrink: 0,
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
                  }}
                />
                {/* 主名 + en + desc */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary, #1a1a1a)' }}>{t.label}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted, #888)', letterSpacing: '0.18em' }}>{t.en}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted, #888)', marginTop: 1 }}>{t.desc}</div>
                </div>
                {/* 选中标记 */}
                {active && (
                  <span style={{ color: 'var(--accent, var(--warm, #c8a882))', fontSize: 14, flexShrink: 0 }}>✓</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 三段式任务模式开关 (segmented control) — 选中 warm-bg/warm，非选中透明/灰
function TaskModeSwitch() {
  const taskMode = useCanvasStore((s) => s.taskMode)
  const setTaskMode = useCanvasStore((s) => s.setTaskMode)
  const wrap = {
    backgroundColor: 'var(--surface)', border: '1px solid var(--border-subtle)',
    backdropFilter: 'blur(8px)', padding: '3px 8px',
    fontFamily: '"Noto Sans SC", system-ui, sans-serif',
  }
  return (
    <div className="flex items-center gap-1.5 rounded-lg shadow-sm" style={wrap}>
      <span style={{ fontSize: '0.7rem', letterSpacing: '0.25em', color: 'var(--text-faint)' }}>模式</span>
      <div className="flex items-center" style={{ border: '1px solid var(--border-subtle)', borderRadius: '6px', overflow: 'hidden' }}>
        {TASK_MODES.map((m, i) => {
          const active = taskMode === m.value
          return (
            <button
              key={m.value}
              onClick={() => setTaskMode(m.value)}
              className="transition-colors"
              style={{
                fontSize: '11px', padding: '4px 12px', cursor: 'pointer',
                background: active ? 'var(--accent-bg)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-muted)',
                borderLeft: i === 0 ? 'none' : '1px solid var(--border-subtle)',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-muted)' }}
              title={m.title || `任务模式: ${m.label}`}
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
  // 注意: 不再 absolute, 由父容器统一布局, 避免与 ProjectLibraryButton 重叠
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onOpenAiSettings}
        className="px-2.5 py-1.5 rounded-lg shadow-sm transition-colors"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-muted)',
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
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border-subtle)',
          backdropFilter: 'blur(8px)',
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        }}
      >
        <span className="text-[10px]" style={{ color: 'var(--text-faint)', letterSpacing: '0.15em' }}>房间</span>
        <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>{room}</span>
        <span className="mx-1 text-[10px]" style={{ color: 'var(--border-subtle)' }}>·</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{username}</span>
        <button
          onClick={onExit}
          className="ml-1 text-[10px] px-1.5 py-0.5 rounded transition-colors"
          style={{ color: 'var(--text-faint)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; e.currentTarget.style.color = 'var(--accent)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faint)' }}
          title="退出"
        >
          ×
        </button>
      </div>
    </div>
  )
}
