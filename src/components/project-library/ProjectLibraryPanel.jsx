/**
 * ProjectLibraryPanel — 项目库主面板
 *
 * 形态：全屏遮罩 + 居中卡片网格弹窗（参考 ActionPlanModal）
 * - 顶部 2px 暖色细线 + 标题 "PROJECT LIBRARY · 项目库"
 * - 主体: 项目卡片网格 grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))
 * - 卡片: 标题(可双击重命名) / summary / 元数据 / [载入][删除] 按钮
 * - 空态: 居中提示
 * - ESC 关闭, 点遮罩关闭
 *
 * 接收 props:
 *   open: bool
 *   onClose: () => void
 *   onLoadProject: (project) => void
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import useProjectLibraryStore from '../../stores/useProjectLibraryStore'

const FONT_SERIF = '"Noto Serif SC", Georgia, serif'
const FONT_SANS = '"Noto Sans SC", system-ui, sans-serif'

/** 时间格式化: 距今多久 */
function formatRelativeTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const SOURCE_LABEL = {
  'meta-cognitive': '元认知',
  'aletheia': 'ALETHEIA',
  'manual': '手动',
}

export default function ProjectLibraryPanel({ open, onClose, onLoadProject }) {
  const projects = useProjectLibraryStore((s) => s.projects)
  const removeProject = useProjectLibraryStore((s) => s.removeProject)
  const renameProject = useProjectLibraryStore((s) => s.renameProject)
  const yjsBound = useProjectLibraryStore((s) => s.yjsBound)

  const [entered, setEntered] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  // 按 owner 筛选 — 'all' | <ownerName>
  const [ownerFilter, setOwnerFilter] = useState('all')

  // 收集所有不同 owner (按出现次数排) — 给筛选 chip 行用
  const ownerStats = useMemo(() => {
    const map = new Map()
    for (const p of projects) {
      const name = p?.owner?.name || '匿名'
      const color = p?.owner?.color || '#999'
      const cur = map.get(name) || { name, color, count: 0 }
      cur.count++
      map.set(name, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count)
  }, [projects])

  const filteredProjects = ownerFilter === 'all'
    ? projects
    : projects.filter((p) => (p?.owner?.name || '匿名') === ownerFilter)

  // 入场动画
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setEntered(true))
      return () => cancelAnimationFrame(raf)
    } else {
      setEntered(false)
      setEditingId(null)
      setConfirmDeleteId(null)
    }
  }, [open])

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'Escape' && typeof onClose === 'function') {
        if (editingId) {
          setEditingId(null)
        } else if (confirmDeleteId) {
          setConfirmDeleteId(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, editingId, confirmDeleteId])

  const startEdit = useCallback((project) => {
    setEditingId(project.id)
    setEditingValue(project.title || '')
  }, [])

  const commitEdit = useCallback(() => {
    if (editingId) {
      renameProject(editingId, editingValue.trim() || '未命名项目')
    }
    setEditingId(null)
  }, [editingId, editingValue, renameProject])

  const handleLoad = useCallback((project) => {
    if (typeof onLoadProject === 'function') onLoadProject(project)
  }, [onLoadProject])

  const handleDelete = useCallback((id) => {
    removeProject(id)
    setConfirmDeleteId(null)
  }, [removeProject])

  if (!open) return null

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && typeof onClose === 'function') onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,26,26,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        opacity: entered ? 1 : 0,
        transition: 'opacity 300ms cubic-bezier(0.22, 1, 0.36, 1)',
        fontFamily: FONT_SANS,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1100px',
          maxHeight: '85vh',
          background: 'var(--surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '4px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          transform: entered ? 'scale(1)' : 'scale(0.96)',
          opacity: entered ? 1 : 0,
          transition:
            'transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms cubic-bezier(0.22, 1, 0.36, 1)',
          overflow: 'hidden',
        }}
      >
        {/* 顶部 2px 暖色细线 */}
        <div style={{ height: '2px', background: 'var(--accent)' }} />

        {/* 头部 */}
        <div
          style={{
            padding: '24px 32px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '10px',
                letterSpacing: '0.35em',
                color: 'var(--accent)',
                marginBottom: '6px',
              }}
            >
              PROJECT LIBRARY
            </div>
            <h1
              style={{
                margin: 0,
                fontFamily: FONT_SERIF,
                fontSize: '24px',
                color: 'var(--text-primary)',
                letterSpacing: '0.04em',
              }}
            >
              项目库
            </h1>
            <div
              style={{
                marginTop: '8px',
                fontSize: '12px',
                color: 'var(--text-muted)',
                lineHeight: 1.6,
              }}
            >
              已保存 {projects.length} 个项目 · {yjsBound ? (
                <span style={{ color: 'var(--accent)' }}>已共享到房间</span>
              ) : '本地'} · 双击卡片标题重命名
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              flexShrink: 0,
              padding: '6px 14px',
              fontSize: '11px',
              letterSpacing: '0.25em',
              color: 'var(--text-secondary)',
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: '2px',
              cursor: 'pointer',
              transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
          >
            关闭
          </button>
        </div>

        {/* 用户筛选 chip 行 — 仅当 owner 不止 1 个时显示 */}
        {ownerStats.length > 1 && (
          <div
            style={{
              padding: '12px 32px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              fontSize: '11px',
            }}
          >
            <span style={{ color: 'var(--text-muted)', letterSpacing: '0.15em', marginRight: 4 }}>
              按用户筛选 :
            </span>
            <OwnerChip
              label="全部"
              count={projects.length}
              active={ownerFilter === 'all'}
              onClick={() => setOwnerFilter('all')}
            />
            {ownerStats.map((o) => (
              <OwnerChip
                key={o.name}
                label={o.name}
                color={o.color}
                count={o.count}
                active={ownerFilter === o.name}
                onClick={() => setOwnerFilter(o.name)}
              />
            ))}
          </div>
        )}

        {/* 主体 - 滚动 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 32px 32px',
          }}
        >
          {filteredProjects.length === 0 ? (
            projects.length === 0 ? (
              <EmptyState />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: 12 }}>
                此用户暂无项目
              </div>
            )
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '16px',
              }}
            >
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isEditing={editingId === project.id}
                  editingValue={editingId === project.id ? editingValue : ''}
                  onEditingValueChange={setEditingValue}
                  isConfirmDelete={confirmDeleteId === project.id}
                  onStartEdit={() => startEdit(project)}
                  onCommitEdit={commitEdit}
                  onCancelEdit={() => setEditingId(null)}
                  onLoad={() => handleLoad(project)}
                  onAskDelete={() => setConfirmDeleteId(project.id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                  onConfirmDelete={() => handleDelete(project.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================ 子组件 ============================

function OwnerChip({ label, color, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 12,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
        background: active ? 'var(--warm-bg)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: 11,
        cursor: 'pointer',
        transition: 'all 0.3s',
        fontFamily: 'inherit',
      }}
    >
      {color && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
          }}
        />
      )}
      <span>{label}</span>
      <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>{count}</span>
    </button>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '60px 20px',
        color: 'var(--text-muted)',
      }}
    >
      <div
        style={{
          fontSize: '40px',
          marginBottom: '12px',
          opacity: 0.5,
        }}
        aria-hidden
      >
        📚
      </div>
      <div
        style={{
          fontFamily: FONT_SERIF,
          fontSize: '18px',
          color: 'var(--text-secondary)',
          letterSpacing: '0.05em',
          marginBottom: '10px',
        }}
      >
        还没有保存过项目
      </div>
      <div
        style={{
          fontSize: '12px',
          color: 'var(--text-faint)',
          lineHeight: 1.7,
          maxWidth: '440px',
          margin: '0 auto',
        }}
      >
        当一次<strong style={{ color: 'var(--accent)' }}> 元认知任务 </strong>
        5 步全部完成，<br />
        或一轮 <strong style={{ color: 'var(--accent)' }}> ALETHEIA 综合 </strong>
        结束时，
        <br />
        系统会自动把当时的画布快照保存到这里。
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  isEditing,
  editingValue,
  onEditingValueChange,
  isConfirmDelete,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onLoad,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}) {
  const [hover, setHover] = useState(false)

  const stats = project.stats || {}
  const sourceTag = SOURCE_LABEL[project.source] || project.source || ''

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        padding: '16px 18px 14px',
        background: 'var(--surface)',
        border: `1px solid ${hover ? 'var(--accent)' : 'var(--border-subtle)'}`,
        borderRadius: '4px',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: hover ? '0 6px 20px rgba(0,0,0,0.08)' : 'none',
        transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        minHeight: '170px',
      }}
    >
      {/* 顶部细线（hover 时暖色） */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: hover ? 'var(--accent)' : 'transparent',
          transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />

      {/* 来源 + 时间 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '9px',
          letterSpacing: '0.3em',
          color: 'var(--text-faint)',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ color: 'var(--accent)' }}>{sourceTag}</span>
        <span style={{ letterSpacing: '0.05em', textTransform: 'none' }}>
          {formatRelativeTime(project.createdAt)}
        </span>
      </div>

      {/* owner 标识 — 协作场景下区分项目创建者 */}
      {project.owner?.name && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-secondary)',
            letterSpacing: '0.05em',
          }}
          title={`创建者: ${project.owner.name}`}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: project.owner.color || '#999',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.08)',
              flexShrink: 0,
            }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
            {project.owner.name}
          </span>
        </div>
      )}

      {/* 标题（双击编辑） */}
      {isEditing ? (
        <input
          autoFocus
          value={editingValue}
          onChange={(e) => onEditingValueChange(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onCommitEdit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancelEdit()
            }
          }}
          style={{
            fontFamily: FONT_SERIF,
            fontSize: '15px',
            color: 'var(--text-primary)',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--accent)',
            outline: 'none',
            padding: '2px 0',
            letterSpacing: '0.02em',
            width: '100%',
          }}
        />
      ) : (
        <div
          onDoubleClick={onStartEdit}
          title="双击重命名"
          style={{
            fontFamily: FONT_SERIF,
            fontSize: '15px',
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            cursor: 'text',
            wordBreak: 'break-word',
          }}
        >
          {project.title || '未命名项目'}
        </div>
      )}

      {/* summary */}
      {project.summary && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            lineHeight: 1.6,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {project.summary}
        </div>
      )}

      {/* 元数据小标签 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          fontSize: '10px',
          color: 'var(--text-faint)',
          letterSpacing: '0.05em',
          marginTop: 'auto',
          paddingTop: '4px',
        }}
      >
        <MetaTag>节点 {stats.nodeCount ?? 0}</MetaTag>
        <MetaTag>边 {stats.edgeCount ?? 0}</MetaTag>
        {typeof stats.healthScore === 'number' && (
          <MetaTag accent>HP {Math.round(stats.healthScore)}</MetaTag>
        )}
        {typeof stats.totalCostCny === 'number' && stats.totalCostCny > 0 && (
          <MetaTag>¥ {stats.totalCostCny.toFixed(stats.totalCostCny < 1 ? 4 : 2)}</MetaTag>
        )}
      </div>

      {/* 底部按钮 */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          paddingTop: '10px',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {isConfirmDelete ? (
          <>
            <button
              onClick={onCancelDelete}
              style={btnStyleSecondary}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--text-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
            >
              取消
            </button>
            <button
              onClick={onConfirmDelete}
              style={{ ...btnStylePrimary, background: 'var(--text-primary)', color: 'var(--surface)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--text-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--text-primary)')}
            >
              确认删除
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onLoad}
              style={btnStylePrimary}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent)'
                e.currentTarget.style.color = 'var(--surface)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--text-primary)'
              }}
            >
              载入
            </button>
            <button
              onClick={onAskDelete}
              style={btnStyleSecondary}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--text-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
            >
              删除
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function MetaTag({ children, accent = false }) {
  return (
    <span
      style={{
        padding: '2px 8px',
        border: `1px solid ${accent ? 'var(--accent)' : 'var(--border-subtle)'}`,
        borderRadius: '999px',
        color: accent ? 'var(--accent)' : 'var(--text-faint)',
        background: accent ? 'rgba(200,168,130,0.08)' : 'transparent',
        fontFamily: FONT_SANS,
      }}
    >
      {children}
    </span>
  )
}

const btnStylePrimary = {
  flex: 1,
  padding: '8px 12px',
  fontSize: '11px',
  letterSpacing: '0.2em',
  color: 'var(--text-primary)',
  background: 'transparent',
  border: '1px solid var(--accent)',
  borderRadius: '2px',
  cursor: 'pointer',
  transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
  fontFamily: FONT_SANS,
}

const btnStyleSecondary = {
  padding: '8px 12px',
  fontSize: '11px',
  letterSpacing: '0.2em',
  color: 'var(--text-muted)',
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: '2px',
  cursor: 'pointer',
  transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
  fontFamily: FONT_SANS,
}
