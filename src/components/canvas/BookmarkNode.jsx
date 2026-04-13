/**
 * BookmarkNode - URL 书签节点（Notion 风格嵌入卡片）
 * 显示网页链接的预览卡片，含缩略图、标题、描述
 */

import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position } from 'reactflow'

// 安全获取字符串内容
const safeString = (val) => {
  if (typeof val === 'string') return val
  if (val === null || val === undefined) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

// 常见网站品牌配色
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
  backgroundColor: '#c8a882',
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
  const brandColor = BRAND_COLORS[domain] || '#555'
  const isLoading = data.loading

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
        relative w-[280px] bg-white rounded-lg border-2 cursor-pointer
        transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${selected ? 'ring-2 ring-offset-2 scale-[1.02]' : 'hover:shadow-lg'}
      `}
      style={{
        overflow: 'visible',
        borderColor: selected ? '#c8a882' : '#e8e8e8',
        ringColor: selected ? '#c8a882' : undefined,
        boxShadow: selected ? '0 4px 20px rgba(200, 168, 130, 0.15)' : '0 1px 3px rgba(0,0,0,0.06)',
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
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
        <div className="absolute inset-0 bg-white/80 rounded-lg flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-2">
            <svg className="w-6 h-6 animate-spin" style={{ color: '#c8a882' }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-xs" style={{ color: '#888' }}>获取链接信息...</span>
          </div>
        </div>
      )}

      {/* 预览图 */}
      {data.image && !imageError && (
        <div className="relative overflow-hidden rounded-t-lg" style={{ borderBottom: '1px solid #e8e8e8' }}>
          {!imageLoaded && (
            <div className="w-full h-32 flex items-center justify-center" style={{ backgroundColor: '#f5f0eb' }}>
              <div className="animate-pulse text-sm" style={{ color: '#bbb' }}>加载中...</div>
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
            color: '#1a1a1a',
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
              color: '#888',
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
              borderColor: '#e8d5c0',
              color: '#555',
              ringColor: '#c8a882',
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
          backgroundColor: '#c8a882',
          color: '#fafafa',
          letterSpacing: '0.1em',
        }}
      >
        链接
      </div>
    </div>
  )
}

export default memo(BookmarkNode)
