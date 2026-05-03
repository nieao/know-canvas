/**
 * NodesLibrary — 节点库
 *
 * LeftPanel "节点" tab 内容: 展示当前画布的所有节点 (来自 useCanvasStore),
 * 按节点类型分组渲染, 每个节点一个紧凑卡片.
 *
 * 设计风格: 建筑极简唯美 — 全部用 var() token, 0 硬编码颜色
 *
 * Props:
 *   onSelectNode(node)    — 点击卡片时触发, 可选
 *   onFocusNode(nodeId)   — 双击/聚焦按钮触发, 让画布聚焦到该节点, 可选
 */

import React, { useMemo, useState, useCallback } from 'react'
import useCanvasStore from '../../stores/useCanvasStore'

const FONT_SERIF = '"Noto Serif SC", Georgia, serif'
const FONT_SANS = '"Noto Sans SC", system-ui, sans-serif'

/** 类型中文名 + emoji 图标映射 */
const TYPE_META = {
  conceptNode:    { label: '概念',     icon: '🧠' },
  categoryNode:   { label: '分类',     icon: '📂' },
  bookmarkNode:   { label: '书签',     icon: '🔖' },
  imageNode:      { label: '图片',     icon: '🖼' },
  videoNode:      { label: '视频',     icon: '🎬' },
  fileNode:       { label: '文件',     icon: '📄' },
  noteNode:       { label: '笔记',     icon: '📝' },
  groupNode:      { label: '分组',     icon: '🗂' },
  taskNode:       { label: '任务',     icon: '⚡' },
  resultNode:     { label: '结果',     icon: '✅' },
  ontologyNode:   { label: '本体',     icon: '🎯' },
  challengeNode:  { label: '反驳',     icon: '⚔' },
  synthesisNode:  { label: '综合',     icon: '✨' },
  metaStepNode:   { label: '元认知步', icon: '🔮' },
}

/** 兜底取节点标题 */
function getNodeTitle(node) {
  const d = node?.data || {}
  return d.title || d.label || d.name || '未命名'
}

/** 兜底取节点摘要 */
function getNodeSummary(node) {
  const d = node?.data || {}
  return d.summary || d.description || d.content || d.claim || d.text || ''
}

/** 兜底取节点 source 来源 */
function getNodeSource(node) {
  const d = node?.data || {}
  return d.source || d.origin || ''
}

/** 兜底取节点 tags */
function getNodeTags(node) {
  const d = node?.data || {}
  if (Array.isArray(d.tags)) return d.tags
  if (Array.isArray(d.keywords)) return d.keywords
  return []
}

/** 获取类型 meta, 未知类型走兜底 */
function getTypeMeta(type) {
  return TYPE_META[type] || { label: type || '未知', icon: '◆' }
}

export default function NodesLibrary({ onSelectNode, onFocusNode }) {
  const nodes = useCanvasStore((s) => s.nodes)

  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [collapsedSections, setCollapsedSections] = useState(() => new Set())

  // 过滤后的节点 (按搜索 + 类型筛选)
  const filteredNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return (nodes || []).filter((n) => {
      if (typeFilter !== 'all' && n.type !== typeFilter) return false
      if (!q) return true
      const title = String(getNodeTitle(n)).toLowerCase()
      const summary = String(getNodeSummary(n)).toLowerCase()
      return title.includes(q) || summary.includes(q)
    })
  }, [nodes, searchQuery, typeFilter])

  // 按类型分组 (Map 保持插入顺序稳定)
  const grouped = useMemo(() => {
    const map = new Map()
    for (const n of filteredNodes) {
      const t = n.type || 'unknownNode'
      if (!map.has(t)) map.set(t, [])
      map.get(t).push(n)
    }
    return map
  }, [filteredNodes])

  // 出现过的类型清单 (供下拉筛选, 基于全部 nodes 不受 filter 影响)
  const availableTypes = useMemo(() => {
    const set = new Set()
    for (const n of nodes || []) set.add(n.type || 'unknownNode')
    return Array.from(set)
  }, [nodes])

  const toggleSection = useCallback((type) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const totalCount = filteredNodes.length
  const groupCount = grouped.size

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: FONT_SANS,
        color: 'var(--text-primary)',
      }}
    >
      {/* 顶部: 搜索 + 类型筛选 */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索节点标题或摘要..."
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: 12,
            fontFamily: FONT_SANS,
            color: 'var(--text-primary)',
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            outline: 'none',
            transition: 'border-color 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
        />

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: 12,
            fontFamily: FONT_SANS,
            color: 'var(--text-primary)',
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="all">全部类型</option>
          {availableTypes.map((t) => (
            <option key={t} value={t}>
              {getTypeMeta(t).icon}  {getTypeMeta(t).label}
            </option>
          ))}
        </select>

        {/* 统计行 */}
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            letterSpacing: '0.05em',
            paddingTop: 4,
          }}
        >
          共 {totalCount} 个节点 · 按类型 {groupCount} 组
        </div>
      </div>

      {/* 主体: 分组卡片 */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 16px 24px',
        }}
      >
        {totalCount === 0 ? (
          <div
            style={{
              padding: '48px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 12,
              fontFamily: FONT_SERIF,
              fontStyle: 'italic',
              lineHeight: 1.8,
            }}
          >
            画布暂无节点
            <br />
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              · 去导入页或新建 ·
            </span>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([type, list]) => {
            const meta = getTypeMeta(type)
            const collapsed = collapsedSections.has(type)
            return (
              <SectionGroup
                key={type}
                type={type}
                meta={meta}
                nodes={list}
                collapsed={collapsed}
                onToggle={() => toggleSection(type)}
                onSelectNode={onSelectNode}
                onFocusNode={onFocusNode}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

/** 单个类型的折叠分组 */
function SectionGroup({ type, meta, nodes, collapsed, onToggle, onSelectNode, onFocusNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      {/* Section header */}
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '8px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--border-subtle)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: FONT_SANS,
          color: 'var(--text-secondary)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>{meta.icon}</span>
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.25em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              fontFamily: FONT_SANS,
            }}
          >
            {meta.label}
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: FONT_SERIF,
            }}
          >
            · {nodes.length}
          </span>
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          }}
        >
          ▼
        </span>
      </button>

      {/* Section body */}
      {!collapsed && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 8,
            paddingTop: 12,
          }}
        >
          {nodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              onSelectNode={onSelectNode}
              onFocusNode={onFocusNode}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** 单个节点紧凑卡片 */
function NodeCard({ node, onSelectNode, onFocusNode }) {
  const [hovering, setHovering] = useState(false)
  const meta = getTypeMeta(node.type)
  const title = getNodeTitle(node)
  const summary = getNodeSummary(node)
  const source = getNodeSource(node)
  const tags = getNodeTags(node)

  const handleClick = useCallback(() => {
    if (typeof onSelectNode === 'function') onSelectNode(node)
  }, [node, onSelectNode])

  const handleDoubleClick = useCallback(() => {
    if (typeof onFocusNode === 'function') onFocusNode(node.id)
  }, [node.id, onFocusNode])

  const handleFocusBtn = useCallback(
    (e) => {
      e.stopPropagation()
      if (typeof onFocusNode === 'function') onFocusNode(node.id)
    },
    [node.id, onFocusNode],
  )

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        position: 'relative',
        padding: '12px 16px',
        border: `1px solid ${hovering ? 'var(--accent)' : 'var(--border-subtle)'}`,
        borderRadius: 4,
        background: 'var(--surface-elevated)',
        cursor: 'pointer',
        transform: hovering ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
        fontFamily: FONT_SANS,
        boxShadow: hovering ? '0 2px 8px var(--border-subtle)' : 'none',
      }}
    >
      {/* 顶行: emoji + title */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 13, flexShrink: 0 }}>{meta.icon}</span>
        <span
          style={{
            fontSize: 12,
            fontFamily: FONT_SERIF,
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
          title={title}
        >
          {title}
        </span>
      </div>

      {/* summary 摘要 (可选) */}
      {summary && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            marginBottom: 8,
          }}
          title={summary}
        >
          {summary}
        </div>
      )}

      {/* 底部 tag 区 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
        }}
      >
        <Chip variant="type">{meta.label}</Chip>
        {source && <Chip variant="source">{source}</Chip>}
        {tags.slice(0, 3).map((t, i) => (
          <Chip key={`${t}-${i}`} variant="tag">{String(t)}</Chip>
        ))}
      </div>

      {/* hover 时显示聚焦按钮 */}
      {hovering && typeof onFocusNode === 'function' && (
        <button
          type="button"
          onClick={handleFocusBtn}
          title="聚焦到画布"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            padding: '2px 6px',
            fontSize: 10,
            fontFamily: FONT_SANS,
            color: 'var(--accent)',
            background: 'var(--accent-bg)',
            border: '1px solid var(--accent-soft)',
            borderRadius: 3,
            cursor: 'pointer',
            letterSpacing: '0.1em',
            transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          聚焦
        </button>
      )}
    </div>
  )
}

/** chip 小标签 */
function Chip({ children, variant = 'type' }) {
  const styles = {
    type: {
      color: 'var(--accent)',
      background: 'var(--accent-bg)',
      border: '1px solid var(--accent-soft)',
    },
    source: {
      color: 'var(--text-secondary)',
      background: 'var(--surface-soft)',
      border: '1px solid var(--border-subtle)',
    },
    tag: {
      color: 'var(--text-muted)',
      background: 'transparent',
      border: '1px solid var(--border-subtle)',
    },
  }
  const s = styles[variant] || styles.type
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        fontSize: 10,
        fontFamily: FONT_SANS,
        letterSpacing: '0.05em',
        borderRadius: 2,
        lineHeight: 1.6,
        ...s,
      }}
    >
      {children}
    </span>
  )
}
