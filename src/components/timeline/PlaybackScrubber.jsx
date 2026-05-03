/**
 * PlaybackScrubber — 项目回放控制条
 *
 * 形态: 底部居中浮窗, 仅在 playbackProjectId 不为 null 时显示.
 * 内含:
 *   - 项目标题 + owner
 *   - 模式切换 chip: [按项目 / 按用户] (用户模式下追加用户名 chip 切换)
 *   - 时间轴 slider (commits 数 1..N, 当前帧 highlight)
 *   - 上一帧 / 播放-暂停 / 下一帧 / 退出
 *   - 当前帧时间 + label
 *
 * 数据源: useProjectLibraryStore.getPlaybackCommits() + getCurrentPlaybackSnapshot()
 * 画布同步: KnowledgeCanvas 自身订阅 store, 不通过这里回调.
 */

import { useEffect, useMemo, useRef } from 'react'
import useProjectLibraryStore from '../../stores/useProjectLibraryStore'

const FONT_SERIF = '"Noto Serif SC", Georgia, serif'
const FONT_SANS = '"Noto Sans SC", system-ui, sans-serif'

function fmtClock(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0').slice(0, 2)
}

export default function PlaybackScrubber() {
  const playbackProjectId = useProjectLibraryStore((s) => s.playbackProjectId)
  const playbackCommitIndex = useProjectLibraryStore((s) => s.playbackCommitIndex)
  const playbackMode = useProjectLibraryStore((s) => s.playbackMode)
  const playbackUserFilter = useProjectLibraryStore((s) => s.playbackUserFilter)
  const playbackPlaying = useProjectLibraryStore((s) => s.playbackPlaying)
  const projects = useProjectLibraryStore((s) => s.projects)

  const setPlaybackIndex = useProjectLibraryStore((s) => s.setPlaybackIndex)
  const setPlaybackMode = useProjectLibraryStore((s) => s.setPlaybackMode)
  const setPlaybackUserFilter = useProjectLibraryStore((s) => s.setPlaybackUserFilter)
  const togglePlaybackPlaying = useProjectLibraryStore((s) => s.togglePlaybackPlaying)
  const exitPlayback = useProjectLibraryStore((s) => s.exitPlayback)

  const project = useMemo(
    () => projects.find((p) => p.id === playbackProjectId),
    [projects, playbackProjectId],
  )

  // 按当前模式拿到可用 commits — store 内部 getter 会过滤
  const commits = useMemo(() => {
    if (!project) return []
    const all = project.commits || []
    if (playbackMode === 'user' && playbackUserFilter) {
      return all.filter((c) => (c.owner?.name || '') === playbackUserFilter)
    }
    return all
  }, [project, playbackMode, playbackUserFilter])

  // 用户模式: 计算可选用户名
  const userOptions = useMemo(() => {
    if (!project) return []
    const set = new Map()
    for (const c of project.commits || []) {
      const name = c.owner?.name || '匿名'
      const color = c.owner?.color || '#999'
      if (!set.has(name)) set.set(name, { name, color, count: 1 })
      else set.get(name).count++
    }
    return Array.from(set.values()).sort((a, b) => b.count - a.count)
  }, [project])

  // 自动播放 — 1.5s 一帧
  const intervalRef = useRef(null)
  useEffect(() => {
    if (!playbackPlaying) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    intervalRef.current = setInterval(() => {
      const s = useProjectLibraryStore.getState()
      const cur = s.getPlaybackCommits?.() || []
      if (cur.length === 0) return
      const next = (s.playbackCommitIndex + 1) % cur.length
      s.setPlaybackIndex(next)
    }, 1500)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [playbackPlaying])

  // 切换 mode 时若没选 user 自动选第一个
  useEffect(() => {
    if (playbackMode === 'user' && !playbackUserFilter && userOptions[0]) {
      setPlaybackUserFilter(userOptions[0].name)
    }
  }, [playbackMode, playbackUserFilter, userOptions, setPlaybackUserFilter])

  if (!playbackProjectId || !project) return null

  const total = commits.length
  const idx = Math.min(playbackCommitIndex, Math.max(0, total - 1))
  const current = commits[idx]

  const goPrev = () => setPlaybackIndex(Math.max(0, idx - 1))
  const goNext = () => setPlaybackIndex(Math.min(total - 1, idx + 1))

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        zIndex: 105,
        background: 'var(--surface, #fafafa)',
        border: '1px solid var(--border-subtle, #e8e8e8)',
        borderTop: '2px solid var(--accent, #c8a882)',
        borderRadius: 6,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        fontFamily: FONT_SANS,
        minWidth: 720,
        maxWidth: 'calc(100vw - 32px)',
        padding: '12px 16px 10px',
      }}
    >
      {/* 顶部行: 标题 + 模式切换 + 退出 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 10,
          fontSize: 11,
        }}
      >
        <span style={{ color: 'var(--accent)', letterSpacing: '0.25em', fontSize: 9 }}>PLAYBACK</span>
        <span
          style={{
            fontFamily: FONT_SERIF,
            color: 'var(--text-primary)',
            fontSize: 13,
            maxWidth: 240,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={project.title}
        >
          {project.title}
        </span>

        {/* 模式切换 */}
        <div
          style={{
            display: 'flex',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            overflow: 'hidden',
            marginLeft: 8,
          }}
        >
          <ModeBtn active={playbackMode === 'project'} onClick={() => setPlaybackMode('project')}>按项目</ModeBtn>
          <ModeBtn
            active={playbackMode === 'user'}
            onClick={() => setPlaybackMode('user')}
            disabled={userOptions.length < 2}
            title={userOptions.length < 2 ? '只有一个用户参与, 不需要切换' : '按用户活动回放'}
          >按用户</ModeBtn>
        </div>

        {/* 用户筛选 chips (仅 user 模式) */}
        {playbackMode === 'user' && userOptions.length > 1 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {userOptions.map((u) => (
              <button
                key={u.name}
                onClick={() => setPlaybackUserFilter(u.name)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  border: `1px solid ${playbackUserFilter === u.name ? 'var(--accent)' : 'var(--border-subtle)'}`,
                  borderRadius: 10,
                  background: playbackUserFilter === u.name ? 'var(--warm-bg)' : 'transparent',
                  color: playbackUserFilter === u.name ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: 10,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: u.color }} />
                {u.name}
              </button>
            ))}
          </div>
        )}

        <span style={{ flex: 1 }} />

        {/* 当前帧 owner + label */}
        {current && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
            {current.owner?.color && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: current.owner.color }} />
            )}
            <span style={{ fontSize: 10 }}>{current.owner?.name || '匿名'}</span>
            <span style={{ color: 'var(--accent)', fontSize: 10 }}>{current.label || '快照'}</span>
            <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>{fmtClock(current.ts)}</span>
          </span>
        )}

        <button
          onClick={exitPlayback}
          style={{
            padding: '4px 10px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 2,
            color: 'var(--text-secondary)',
            background: 'transparent',
            fontSize: 10,
            letterSpacing: '0.2em',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          title="退出回放"
        >
          退出
        </button>
      </div>

      {/* 控制行: 上一 / 播放 / 下一 / scrubber */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={goPrev} disabled={idx === 0} style={iconBtnStyle(idx === 0)} title="上一帧">◀</button>
        <button
          onClick={togglePlaybackPlaying}
          style={{ ...iconBtnStyle(false), borderColor: 'var(--accent)', color: 'var(--accent)' }}
          title={playbackPlaying ? '暂停' : '播放'}
        >
          {playbackPlaying ? '⏸' : '▶'}
        </button>
        <button onClick={goNext} disabled={idx >= total - 1} style={iconBtnStyle(idx >= total - 1)} title="下一帧">▶</button>

        {/* Scrubber */}
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            value={idx}
            onChange={(e) => setPlaybackIndex(Number(e.target.value))}
            style={{
              width: '100%',
              accentColor: 'var(--accent, #c8a882)',
              cursor: 'pointer',
            }}
          />
          {/* 帧序号刻度 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>
            <span>1</span>
            <span style={{ color: 'var(--accent)' }}>{idx + 1} / {total}</span>
            <span>{total}</span>
          </div>
        </div>
      </div>

      {/* 空态 */}
      {total === 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          {playbackMode === 'user' ? '该用户在此项目无活动帧' : '无快照帧可回放'}
        </div>
      )}
    </div>
  )
}

function ModeBtn({ active, onClick, children, disabled, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '3px 10px',
        background: active ? 'var(--warm-bg)' : 'transparent',
        color: active ? 'var(--accent)' : disabled ? 'var(--text-faint)' : 'var(--text-secondary)',
        border: 'none',
        borderRight: '1px solid var(--border-subtle)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 10,
        letterSpacing: '0.05em',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

function iconBtnStyle(disabled) {
  return {
    width: 28,
    height: 28,
    border: '1px solid var(--border-subtle)',
    borderRadius: 4,
    background: 'var(--surface)',
    color: disabled ? 'var(--text-faint)' : 'var(--text-secondary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
}
