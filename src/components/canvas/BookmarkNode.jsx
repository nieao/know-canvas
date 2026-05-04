/**
 * BookmarkNode - URL 书签节点（Notion 风格嵌入卡片）
 * 显示网页链接的预览卡片，含缩略图、标题、描述
 */

import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position } from 'reactflow'
import ColorAccentBar from './ColorAccentBar'

// 安全获取字符串内容
const safeString = (val) => {
  if (typeof val === 'string') return val
  if (val === null || val === undefined) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

// 常见网站品牌配色 (语义色: brand 色板, 不随主题切换)
const BRAND_COLORS = {
  'google.com': '#4285F4',
  'github.com': '#181717',
  'twitter.com': '#1DA1F2',
  'x.com': '#000000',
  'medium.com': '#000000',
  'linkedin.com': '#0A66C2',
  'stackoverflow.com': '#F58025',
  'wikipedia.org': '#000000',
  'notion.so': '#000000',
  'reddit.com': '#FF4500',
  'youtube.com': '#FF0000',
  'bilibili.com': '#00A1D6',
  'zhihu.com': '#0084FF',
}

// 从 URL 提取域名
const extractDomain = (url) => {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return ''
  }
}

// 获取网站 favicon URL
const getFaviconUrl = (url) => {
  const domain = extractDomain(url)
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
}

// 连接点样式
const HANDLE_STYLE = {
  width: 10, height: 10,
  border: '2px solid white',
  borderRadius: '50%',
  backgroundColor: 'var(--accent)',
  opacity: 1,
  cursor: 'crosshair',
}

function BookmarkNode({ id, data, selected }) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [faviconError, setFaviconError] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editUrl, setEditUrl] = useState('')
  const inputRef = useRef(null)

  const url = data.url || ''
  const domain = extractDomain(url)
  const brandColor = BRAND_COLORS[domain] || 'var(--text-muted)'
  const isLoading = data.loading

  // ── 外部源 watch 同步角标状态 (详见 docs/source-watch-sync-spec.md §9.1) ──
  // sourceMeta.syncStatus: 'idle' | 'checking' | 'updated-available' | 'synced' | 'conflict' | 'error'
  const sourceMeta = data.sourceMeta
  const syncStatus = sourceMeta?.syncStatus || 'idle'
  const showSyncBadge = sourceMeta && (sourceMeta.platform === 'feishu' || sourceMeta.platform === 'notion')
    && syncStatus !== 'idle'

  // 点击角标 → 触发同步 (updated-available / conflict 时)
  const handleSyncBadgeClick = useCallback(async (e) => {
    e.stopPropagation()
    if (syncStatus !== 'updated-available' && syncStatus !== 'conflict') return
    // 派事件让 store 处理, 避免 BookmarkNode 直接 import store (维持渲染层纯净)
    window.dispatchEvent(new CustomEvent('source-sync-node', {
      detail: { nodeId: id, force: syncStatus === 'conflict' },
    }))
  }, [id, syncStatus])

  // 处理链接点击
  const handleClick = () => {
    if (!isEditing && url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  // 处理双击编辑
  const handleDoubleClick = (e) => {
    e.stopPropagation()
    setEditUrl(url)
    setIsEditing(true)
  }

  // 编辑提交
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleEditSubmit = () => {
    if (editUrl.trim() && editUrl !== url) {
      window.dispatchEvent(new CustomEvent('bookmark-url-change', {
        detail: { nodeId: id, url: editUrl.trim() }
      }))
    }
    setIsEditing(false)
  }

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') handleEditSubmit()
    if (e.key === 'Escape') setIsEditing(false)
  }

  return (
    <div
      className={`
        relative w-[280px] rounded-lg border-2 cursor-pointer
        transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${selected ? 'ring-2 ring-offset-2 scale-[1.02]' : 'hover:shadow-lg'}
      `}
      style={{
        overflow: 'visible',
        backgroundColor: 'var(--surface)',
        borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
        ringColor: selected ? 'var(--accent)' : undefined,
        boxShadow: selected ? '0 4px 20px rgba(200, 168, 130, 0.15)' : '0 1px 3px rgba(0,0,0,0.06)',
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <ColorAccentBar color={data?.color} />

      {/* 连接点 */}
      <Handle type="target" position={Position.Top} id="top-target"
        style={{ ...HANDLE_STYLE }} />
      <Handle type="source" position={Position.Top} id="top-source"
        style={{ ...HANDLE_STYLE }} />
      <Handle type="target" position={Position.Bottom} id="bottom-target"
        style={{ ...HANDLE_STYLE, bottom: -5 }} />
      <Handle type="source" position={Position.Bottom} id="bottom-source"
        style={{ ...HANDLE_STYLE, bottom: -5 }} />
      <Handle type="target" position={Position.Left} id="left-target"
        style={{ ...HANDLE_STYLE, left: -5 }} />
      <Handle type="source" position={Position.Left} id="left-source"
        style={{ ...HANDLE_STYLE, left: -5 }} />
      <Handle type="target" position={Position.Right} id="right-target"
        style={{ ...HANDLE_STYLE, right: -5 }} />
      <Handle type="source" position={Position.Right} id="right-source"
        style={{ ...HANDLE_STYLE, right: -5 }} />

      {/* 加载状态 */}
      {isLoading && (
        <div className="absolute inset-0 rounded-lg flex items-center justify-center z-10" style={{ backgroundColor: 'rgba(250,250,250,0.8)' }}>
          <div className="flex flex-col items-center gap-2">
            <svg className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>获取链接信息...</span>
          </div>
        </div>
      )}

      {/* 预览图 */}
      {data.image && !imageError && (
        <div className="relative overflow-hidden rounded-t-lg" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {!imageLoaded && (
            <div className="w-full h-32 flex items-center justify-center" style={{ backgroundColor: 'var(--accent-bg)' }}>
              <div className="animate-pulse text-sm" style={{ color: 'var(--text-faint)' }}>加载中...</div>
            </div>
          )}
          <img
            src={data.image}
            alt={data.title || '预览图'}
            className={`w-full object-cover ${imageLoaded ? '' : 'hidden'}`}
            style={{ maxHeight: '140px' }}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        </div>
      )}

      {/* 内容区 */}
      <div className="p-3">
        {/* 标题 */}
        <h4
          className="font-medium text-sm line-clamp-2 mb-1"
          style={{
            color: 'var(--text-primary)',
            fontFamily: '"Noto Sans SC", system-ui, sans-serif',
          }}
        >
          {safeString(data.title) || '未命名链接'}
        </h4>

        {/* 描述 */}
        {data.description && (
          <p
            className="text-xs line-clamp-2 mb-2"
            style={{
              color: 'var(--text-muted)',
              fontFamily: '"Noto Sans SC", system-ui, sans-serif',
            }}
          >
            {safeString(data.description)}
          </p>
        )}

        {/* URL 编辑模式 */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="url"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            onBlur={handleEditSubmit}
            onKeyDown={handleEditKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1"
            style={{
              borderColor: 'var(--accent-soft)',
              color: 'var(--text-muted)',
              ringColor: 'var(--accent)',
            }}
            placeholder="输入链接地址..."
          />
        ) : (
          /* 底部域名信息 */
          <div className="flex items-center gap-2">
            {!faviconError && url && (
              <img
                src={getFaviconUrl(url)}
                alt=""
                className="w-4 h-4"
                onError={() => setFaviconError(true)}
              />
            )}
            <span
              className="text-[11px] truncate"
              style={{ color: brandColor }}
            >
              {domain || '双击设置链接'}
            </span>
          </div>
        )}
      </div>

      {/* 类型标签 */}
      <div
        className="absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-medium rounded"
        style={{
          backgroundColor: 'var(--accent)',
          color: 'var(--surface)',
          letterSpacing: '0.1em',
        }}
      >
        链接
      </div>

      {/* 外部源同步状态角标 — 右上角. 详见 docs/source-watch-sync-spec.md §9.1 */}
      {showSyncBadge && (
        <SyncBadge
          status={syncStatus}
          platform={sourceMeta?.platform}
          error={sourceMeta?.syncError}
          onClick={handleSyncBadgeClick}
        />
      )}
    </div>
  )
}

// 同步状态角标 — 右上角浮标
// status: 'checking' | 'updated-available' | 'synced' | 'conflict' | 'error'
function SyncBadge({ status, platform, error, onClick }) {
  const config = {
    checking: { color: '#c8a882', bg: '#fff', icon: '...', title: `检查中 (${platform})`, clickable: false, pulse: true },
    'updated-available': { color: '#fff', bg: '#3b82f6', icon: '↑', title: `远端 ${platform} 有更新, 点击同步`, clickable: true, pulse: true },
    synced: { color: '#fff', bg: '#22c55e', icon: '✓', title: '已同步', clickable: false, pulse: false },
    conflict: { color: '#fff', bg: '#f59e0b', icon: '⚠', title: '本地与远端都有修改, 点击查看', clickable: true, pulse: false },
    error: { color: '#fff', bg: '#ef4444', icon: '!', title: error || '同步失败', clickable: false, pulse: false },
  }
  const c = config[status] || config.checking
  return (
    <div
      onClick={c.clickable ? onClick : undefined}
      className="absolute top-2 right-2 z-20 flex items-center justify-center text-[10px] font-bold rounded-full select-none"
      style={{
        width: 18,
        height: 18,
        backgroundColor: c.bg,
        color: c.color,
        cursor: c.clickable ? 'pointer' : 'default',
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        animation: c.pulse ? 'syncBadgePulse 1.4s ease-in-out infinite' : 'none',
        lineHeight: 1,
      }}
      title={c.title}
    >
      {c.icon}
      <style>{`
        @keyframes syncBadgePulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.12); opacity: 0.75; }
        }
      `}</style>
    </div>
  )
}

export default memo(BookmarkNode)
