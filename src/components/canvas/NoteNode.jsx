/**
 * NoteNode - 文本笔记节点
 * 支持双击编辑、链接点击、图文混合
 */

import { memo, useState, useEffect } from 'react'
import { Handle, Position } from 'reactflow'

// 安全获取字符串内容
const safeString = (val) => {
  if (typeof val === 'string') return val
  if (val === null || val === undefined) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

// 渲染可点击的 URL
const renderWithLinks = (text) => {
  if (!text) return null
  const urlPattern = /(https?:\/\/[^\s]+)/g
  const parts = text.split(urlPattern)

  return parts.map((part, index) => {
    if (urlPattern.test(part)) {
      urlPattern.lastIndex = 0
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="hover:underline break-all"
          style={{ color: '#c8a882' }}
        >
          {part.length > 50 ? part.substring(0, 50) + '...' : part}
        </a>
      )
    }
    return <span key={index}>{part}</span>
  })
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

function NoteNode({ id, data, selected }) {
  const [isEditing, setIsEditing] = useState(false)
  const [content, setContent] = useState(safeString(data.content))
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  // 同步外部数据变化
  useEffect(() => {
    setContent(safeString(data.content))
  }, [data.content])

  const hasLinks = /https?:\/\//.test(content || data.content || '')
  const hasImage = !!(data.imageSrc || data.image)

  const handleDoubleClick = () => setIsEditing(true)
  const handleBlur = () => setIsEditing(false)
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') setIsEditing(false)
  }

  return (
    <div
      className={`
        relative ${hasLinks || hasImage ? 'min-w-[320px] max-w-[400px]' : 'min-w-[180px] max-w-[280px]'}
        rounded-lg border shadow-md
        transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${selected ? 'ring-2 ring-offset-2 scale-[1.02]' : 'hover:shadow-lg'}
      `}
      style={{
        overflow: 'visible',
        backgroundColor: '#fafafa',
        borderColor: selected ? '#c8a882' : '#e8e8e8',
        ringColor: selected ? '#c8a882' : undefined,
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* 连接点 */}
      <Handle type="target" position={Position.Top} id="top-target"
        style={{ ...HANDLE_STYLE, top: -5 }} />
      <Handle type="source" position={Position.Top} id="top-source"
        style={{ ...HANDLE_STYLE, top: -5 }} />
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

      {/* 头部 */}
      <div
        className="px-3 py-1.5 flex items-center gap-2"
        style={{
          backgroundColor: '#f5f0eb',
          borderBottom: '1px solid #e8d5c0',
          borderRadius: '0.5rem 0.5rem 0 0',
        }}
      >
        <svg className="w-4 h-4" style={{ color: '#c8a882' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <span
          className="text-xs font-medium"
          style={{
            color: '#c8a882',
            fontFamily: '"Noto Sans SC", system-ui, sans-serif',
            letterSpacing: '0.1em',
          }}
        >
          {hasImage ? '图文笔记' : '笔记'}
        </span>
      </div>

      {/* 图片区域 */}
      {hasImage && (
        <div className="relative overflow-hidden">
          {!imageLoaded && !imageError && (
            <div className="w-full h-32 flex items-center justify-center" style={{ backgroundColor: '#f5f0eb' }}>
              <div className="animate-pulse text-sm" style={{ color: '#bbb' }}>加载中...</div>
            </div>
          )}
          {imageError ? (
            <div className="w-full h-24 flex flex-col items-center justify-center" style={{ backgroundColor: '#f5f0eb' }}>
              <svg className="w-8 h-8 mb-1" style={{ color: '#bbb' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs" style={{ color: '#bbb' }}>图片加载失败</span>
            </div>
          ) : (
            <img
              src={data.imageSrc || data.image}
              alt={data.imageAlt || '图片'}
              className={`w-full object-cover ${imageLoaded ? '' : 'hidden'}`}
              style={{ maxHeight: '180px' }}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          )}
        </div>
      )}

      {/* 内容 */}
      <div className="p-3">
        {isEditing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-full min-h-[60px] p-2 text-sm border rounded resize-none focus:outline-none focus:ring-1"
            style={{
              color: '#2d2d2d',
              borderColor: '#e8d5c0',
              ringColor: '#c8a882',
              fontFamily: '"Noto Sans SC", system-ui, sans-serif',
            }}
            placeholder="输入笔记内容..."
          />
        ) : (
          <div
            className="text-sm whitespace-pre-wrap leading-relaxed"
            style={{
              color: '#2d2d2d',
              fontFamily: '"Noto Sans SC", system-ui, sans-serif',
            }}
          >
            {renderWithLinks(content || safeString(data.content)) || '双击编辑笔记...'}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      {!isEditing && (
        <div className="px-3 pb-2">
          <span className="text-[10px]" style={{ color: '#bbb' }}>双击编辑</span>
        </div>
      )}
    </div>
  )
}

export default memo(NoteNode)
