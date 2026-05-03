/**
 * ProjectLibraryButton — 顶部工具栏入口按钮
 *
 * 形态：建筑极简风圆角 button + 项目数 badge
 * 点击 onOpen() 打开 ProjectLibraryPanel
 *
 * 颜色一律走 var(--*) token, 黑/暖色基调; hover 时边框变 var(--accent), badge 变暖色背景
 */

import React, { useState } from 'react'
import useProjectLibraryStore from '../../stores/useProjectLibraryStore'

export default function ProjectLibraryButton({ onOpen }) {
  const count = useProjectLibraryStore((s) => s.projects.length)
  const [hover, setHover] = useState(false)

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`项目库 · 已保存 ${count} 个项目`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        background: 'var(--surface)',
        border: `1px solid ${hover ? 'var(--accent)' : 'var(--border-subtle)'}`,
        borderRadius: '4px',
        color: hover ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        fontSize: '12px',
        letterSpacing: '0.1em',
        cursor: 'pointer',
        transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
        boxShadow: hover ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: '14px', lineHeight: 1 }} aria-hidden>📚</span>
      <span>项目库</span>
      <span
        style={{
          minWidth: '20px',
          height: '18px',
          padding: '0 6px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.05em',
          color: hover ? 'var(--surface)' : 'var(--text-muted)',
          background: hover ? 'var(--accent)' : 'transparent',
          border: `1px solid ${hover ? 'var(--accent)' : 'var(--border-subtle)'}`,
          borderRadius: '999px',
          transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
          fontFamily: 'inherit',
        }}
      >
        {count}
      </span>
    </button>
  )
}
