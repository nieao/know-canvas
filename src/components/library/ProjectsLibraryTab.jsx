/**
 * ProjectsLibraryTab — LeftPanel "项目" tab 的内嵌项目库
 *
 * 与 src/components/project-library/ProjectLibraryPanel.jsx (全屏弹窗版) 区别:
 *   - 本组件: 嵌入 LeftPanel, 紧凑列表风格, 卡片纵向排列, 不占全屏
 *   - 弹窗版:  全屏遮罩 + 网格 + 双击重命名, 用于"集中管理"场景
 *
 * 数据源: useProjectLibraryStore + projectLibraryActions
 *
 * Props:
 *   - onLoadProject?: (project) => void
 *       外部回调; 不传则内部 loadProjectToCanvas + logBus.pushLog
 *
 * 功能:
 *   - 顶部: 搜索框 + source chip (全部/元认知/Aletheia) + stats 一行
 *   - 列表: 紧凑 3 行卡片, hover 显示底部按钮条
 *   - accordion: 点[查看详情]内嵌展开 node 列表(按 type 分组, mini chip)
 *   - 删除: 二次确认(3 秒超时还原)
 *   - 默认 sortBy = 'createdAt-desc'
 *   - 全部颜色用 var() token, 6 套主题自适应
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import useProjectLibraryStore from '../../stores/useProjectLibraryStore'
import { loadProjectToCanvas } from '../../services/projectLibraryActions'
import { pushLog } from '../../utils/logBus'

const FONT_SERIF = 'var(--font-serif)'
const FONT_SANS = 'var(--font-sans)'

const SOURCE_LABEL = {
  'meta-cognitive': '元认知',
  'aletheia': 'Aletheia',
  'manual': '手动',
}

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

/** 节点 type → emoji (取常见的几种, 兜底用 ◎) */
const TYPE_EMOJI = {
  knowledge: '📘',
  task: '🎯',
  result: '✅',
  category: '🗂️',
  source: '📎',
  insight: '💡',
  question: '❓',
  decision: '⚖️',
  evidence: '🔎',
  hypothesis: '🧪',
}

function emojiForType(t) {
  if (!t) return '◎'
  return TYPE_EMOJI[t] || '◎'
}

export default function ProjectsLibraryTab({ onLoadProject }) {
  const projects = useProjectLibraryStore((s) => s.projects)
  const removeProject = useProjectLibraryStore((s) => s.removeProject)

  const [keyword, setKeyword] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all') // 'all' | 'meta-cognitive' | 'aletheia'
  const [expandedId, setExpandedId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [hoverId, setHoverId] = useState(null)
  const confirmTimerRef = useRef(null)

  // 二次确认 3 秒超时还原
  useEffect(() => {
    if (!confirmDeleteId) return undefined
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = setTimeout(() => {
      setConfirmDeleteId(null)
    }, 3000)
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    }
  }, [confirmDeleteId])

  // 过滤 + 排序 (createdAt desc)
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const list = (projects || []).filter((p) => {
      if (sourceFilter !== 'all' && (p.source || 'manual') !== sourceFilter) return false
      if (!kw) return true
      const hay = `${p.title || ''} ${p.summary || ''}`.toLowerCase()
      return hay.includes(kw)
    })
    return list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }, [projects, keyword, sourceFilter])

  // stats 一行
  const stats = useMemo(() => {
    const total = projects?.length || 0
    let nodeSum = 0
    let costSum = 0
    for (const p of projects || []) {
      nodeSum += Number(p?.stats?.nodeCount || 0)
      costSum += Number(p?.stats?.totalCostCny || 0)
    }
    return { total, nodeSum, costSum }
  }, [projects])

  const handleLoad = (project) => {
    if (typeof onLoadProject === 'function') {
      onLoadProject(project)
      pushLog({ level: 'info', source: 'action', msg: `载入项目: ${project.title}`, data: { id: project.id } })
      return
    }
    const r = loadProjectToCanvas(project.id)
    if (r?.ok) {
      pushLog({ level: 'info', source: 'action', msg: `已载入到画布: ${project.title}`, data: { id: project.id } })
    } else {
      pushLog({ level: 'error', source: 'action', msg: `载入项目失败: ${project.title}`, data: { reason: r?.reason } })
    }
  }

  const handleDelete = (project) => {
    if (confirmDeleteId === project.id) {
      removeProject(project.id)
      setConfirmDeleteId(null)
      if (expandedId === project.id) setExpandedId(null)
      pushLog({ level: 'warn', source: 'action', msg: `已删除项目: ${project.title}`, data: { id: project.id } })
    } else {
      setConfirmDeleteId(project.id)
    }
  }

  const toggleExpand = (id) => {
    setExpandedId((cur) => (cur === id ? null : id))
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: FONT_SANS,
        color: 'var(--text-primary)',
        background: 'var(--surface)',
      }}
    >
      {/* 顶部: 搜索 + 筛选 + stats */}
      <div
        style={{
          padding: '12px 14px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索项目标题或摘要..."
          style={{
            width: '100%',
            padding: '7px 10px',
            fontSize: '12px',
            fontFamily: FONT_SANS,
            color: 'var(--text-primary)',
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '2px',
            outline: 'none',
            transition: 'border-color 0.3s var(--ease-out)',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
        />

        {/* source 筛选 chip */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {[
            { v: 'all', label: '全部' },
            { v: 'meta-cognitive', label: '元认知' },
            { v: 'aletheia', label: 'Aletheia' },
          ].map((opt) => {
            const active = sourceFilter === opt.v
            return (
              <button
                key={opt.v}
                onClick={() => setSourceFilter(opt.v)}
                style={{
                  padding: '3px 10px',
                  fontSize: '11px',
                  fontFamily: FONT_SANS,
                  letterSpacing: '0.05em',
                  color: active ? 'var(--surface)' : 'var(--text-secondary)',
                  background: active ? 'var(--text-primary)' : 'transparent',
                  border: `1px solid ${active ? 'var(--text-primary)' : 'var(--border-subtle)'}`,
                  borderRadius: '2px',
                  cursor: 'pointer',
                  transition: 'all 0.3s var(--ease-out)',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        {/* stats 一行 */}
        <div
          style={{
            marginTop: 8,
            fontSize: '10.5px',
            letterSpacing: '0.04em',
            color: 'var(--text-faint)',
            fontFamily: FONT_SANS,
          }}
        >
          共 {stats.total} 个项目 · 总节点 {stats.nodeSum}
          {stats.costSum > 0 ? ` · 累计 ¥${stats.costSum.toFixed(2)}` : ''}
        </div>
      </div>

      {/* 主体: 项目卡片纵向列表 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '10px 12px',
        }}
      >
        {filtered.length === 0 ? (
          <EmptyState hasProjects={(projects || []).length > 0} keyword={keyword} />
        ) : (
          filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              expanded={expandedId === project.id}
              hovered={hoverId === project.id}
              confirmingDelete={confirmDeleteId === project.id}
              onHover={setHoverId}
              onToggleExpand={() => toggleExpand(project.id)}
              onLoad={() => handleLoad(project)}
              onDelete={() => handleDelete(project)}
            />
          ))
        )}
      </div>
    </div>
  )
}

/* ===================== 子组件 ===================== */

function EmptyState({ hasProjects, keyword }) {
  if (hasProjects && keyword) {
    return (
      <div
        style={{
          padding: '40px 14px',
          textAlign: 'center',
          color: 'var(--text-faint)',
          fontSize: '12px',
          fontFamily: FONT_SANS,
        }}
      >
        没有匹配 “{keyword}” 的项目
      </div>
    )
  }
  return (
    <div
      style={{
        padding: '60px 14px',
        textAlign: 'center',
        fontFamily: FONT_SANS,
      }}
    >
      <div
        style={{
          fontSize: '32px',
          marginBottom: 12,
          opacity: 0.4,
        }}
      >
        ◇
      </div>
      <div
        style={{
          fontSize: '13px',
          color: 'var(--text-secondary)',
          fontFamily: FONT_SERIF,
          letterSpacing: '0.04em',
          marginBottom: 8,
        }}
      >
        还没有保存的项目
      </div>
      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-faint)',
          lineHeight: 1.6,
          maxWidth: 240,
          margin: '0 auto',
        }}
      >
        跑一次元认知任务或 Aletheia 推导后<br />
        会自动入库
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  expanded,
  hovered,
  confirmingDelete,
  onHover,
  onToggleExpand,
  onLoad,
  onDelete,
}) {
  const source = project.source || 'manual'
  const isAletheia = source === 'aletheia'
  const isMeta = source === 'meta-cognitive'
  const badgeColor = isAletheia
    ? 'var(--severity-high)'
    : isMeta
      ? 'var(--accent)'
      : 'var(--text-faint)'

  const nodeCount = project?.stats?.nodeCount ?? 0
  const edgeCount = project?.stats?.edgeCount ?? 0
  const healthScore = project?.stats?.healthScore
  const costCny = project?.stats?.totalCostCny

  const showActions = hovered || expanded

  return (
    <div
      onMouseEnter={() => onHover(project.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        marginBottom: 8,
        padding: '10px 12px',
        border: '1px solid var(--border-subtle)',
        borderRadius: '2px',
        background: 'var(--surface-elevated)',
        transition: 'all 0.4s var(--ease-out)',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        borderColor: hovered ? 'var(--accent)' : 'var(--border-subtle)',
        position: 'relative',
      }}
    >
      {/* 行 1: 标题 + source badge */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: FONT_SERIF,
            fontSize: '13px',
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={project.title}
        >
          {project.title || '未命名项目'}
        </div>
        <span
          style={{
            flexShrink: 0,
            fontSize: '9.5px',
            letterSpacing: '0.12em',
            padding: '1px 6px',
            color: badgeColor,
            border: `1px solid ${badgeColor}`,
            borderRadius: '2px',
            opacity: 0.85,
            fontFamily: FONT_SANS,
          }}
        >
          {SOURCE_LABEL[source] || source}
        </span>
      </div>

      {/* 行 2: summary 摘要(2 行省略) */}
      {project.summary ? (
        <div
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            marginBottom: 6,
          }}
          title={project.summary}
        >
          {project.summary}
        </div>
      ) : null}

      {/* 行 3: 元数据小标签 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          fontSize: '10.5px',
          color: 'var(--text-faint)',
          fontFamily: FONT_SANS,
          letterSpacing: '0.02em',
        }}
      >
        <span>🔘 {nodeCount}</span>
        <span>↗ {edgeCount}</span>
        {typeof healthScore === 'number' ? (
          <span>❤ {Math.round(healthScore)}</span>
        ) : null}
        {typeof costCny === 'number' && costCny > 0 ? (
          <span>¥ {costCny.toFixed(2)}</span>
        ) : null}
        <span style={{ marginLeft: 'auto', opacity: 0.85 }}>{formatRelativeTime(project.createdAt)}</span>
      </div>

      {/* hover 时按钮条 */}
      {showActions ? (
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px dashed var(--border-subtle)',
          }}
        >
          <ActionButton onClick={onLoad} title="把此项目快照载入到当前画布">
            载入到画布
          </ActionButton>
          <ActionButton onClick={onToggleExpand} title="展开查看项目内的节点">
            {expanded ? '收起详情' : '查看详情'}
          </ActionButton>
          <button
            onClick={onDelete}
            title="删除此项目(再点一次确认)"
            style={{
              marginLeft: 'auto',
              padding: '4px 10px',
              fontSize: '11px',
              fontFamily: FONT_SANS,
              letterSpacing: '0.05em',
              color: confirmingDelete ? 'var(--surface)' : 'var(--severity-high)',
              background: confirmingDelete ? 'var(--severity-high)' : 'transparent',
              border: '1px solid var(--severity-high)',
              borderRadius: '2px',
              cursor: 'pointer',
              transition: 'all 0.3s var(--ease-out)',
            }}
          >
            {confirmingDelete ? '再点确认' : '删除'}
          </button>
        </div>
      ) : null}

      {/* accordion 展开 — 节点列表 */}
      {expanded ? <ProjectNodesAccordion project={project} /> : null}
    </div>
  )
}

function ActionButton({ onClick, title, children }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '4px 10px',
        fontSize: '11px',
        fontFamily: FONT_SANS,
        letterSpacing: '0.05em',
        color: hover ? 'var(--surface)' : 'var(--text-secondary)',
        background: hover ? 'var(--accent)' : 'transparent',
        border: `1px solid ${hover ? 'var(--accent)' : 'var(--border-subtle)'}`,
        borderRadius: '2px',
        cursor: 'pointer',
        transition: 'all 0.3s var(--ease-out)',
      }}
    >
      {children}
    </button>
  )
}

function ProjectNodesAccordion({ project }) {
  // 仅在展开时才计算 (snapshot.nodes 可能很大)
  const grouped = useMemo(() => {
    const nodes = project?.snapshot?.nodes || []
    const map = new Map()
    for (const n of nodes) {
      const t = (n?.type || n?.data?.type || 'misc')
      if (!map.has(t)) map.set(t, [])
      map.get(t).push(n)
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [project])

  if (!grouped.length) {
    return (
      <div
        style={{
          marginTop: 10,
          padding: '10px 0',
          fontSize: '11px',
          color: 'var(--text-faint)',
          textAlign: 'center',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        快照中暂无节点
      </div>
    )
  }

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      {grouped.map(([type, list]) => (
        <div key={type} style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: '9.5px',
              letterSpacing: '0.18em',
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              marginBottom: 4,
              fontFamily: FONT_SANS,
            }}
          >
            {type} · {list.length}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {list.slice(0, 24).map((n) => {
              const title =
                n?.data?.title ||
                n?.data?.label ||
                n?.data?.name ||
                n?.id ||
                '(节点)'
              const short = String(title).length > 22 ? String(title).slice(0, 22) + '…' : title
              return (
                <span
                  key={n.id}
                  title={String(title)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '2px 6px',
                    fontSize: '10.5px',
                    color: 'var(--text-secondary)',
                    background: 'var(--surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '2px',
                    fontFamily: FONT_SANS,
                  }}
                >
                  <span style={{ fontSize: '10px' }}>{emojiForType(type)}</span>
                  {short}
                </span>
              )
            })}
            {list.length > 24 ? (
              <span
                style={{
                  fontSize: '10px',
                  color: 'var(--text-faint)',
                  alignSelf: 'center',
                  padding: '0 4px',
                }}
              >
                +{list.length - 24}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
