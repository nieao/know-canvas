/**
 * ConceptNode - 知识概念卡片节点
 * 显示知识概念信息，支持悬停展开、钉住、尺寸缩放
 * 建筑极简风格：暖色点缀 #c8a882，灰色系主体
 */

import { memo, useState, useRef, useEffect } from 'react'
import { Handle, Position } from 'reactflow'

// 安全获取字符串内容
const safeString = (val) => {
  if (typeof val === 'string') return val
  if (val === null || val === undefined) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

// 来源类型图标
const SOURCE_TYPE_ICONS = {
  file: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  web: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
  ),
  note: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  ai: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  manual: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
}

// 分类颜色映射
const CATEGORY_COLORS = {
  '概念': '#c8a882',
  '技术': '#7c9eb2',
  '人物': '#b2917c',
  '事件': '#8b9e7c',
  '方法': '#9e7cb2',
  '工具': '#7cb2a8',
  '理论': '#b27c8b',
  '资源': '#a8a87c',
}

// 节点尺寸配置
const SIZE_SCALES = {
  small: {
    minW: 'min-w-[160px]',
    maxW: 'max-w-[200px]',
    titleSize: 'text-sm',
    textSize: 'text-xs',
    padding: 'px-3 py-2',
  },
  medium: {
    minW: 'min-w-[200px]',
    maxW: 'max-w-[260px]',
    titleSize: 'text-base',
    textSize: 'text-xs',
    padding: 'px-4 py-3',
  },
  large: {
    minW: 'min-w-[260px]',
    maxW: 'max-w-[340px]',
    titleSize: 'text-lg',
    textSize: 'text-sm',
    padding: 'px-5 py-4',
  },
}

// 连接点内联样式（Tailwind v4 不支持 ! 前缀，用 inline style）
const HANDLE_STYLE = {
  width: 10,
  height: 10,
  border: '2px solid white',
  borderRadius: '50%',
  backgroundColor: '#c8a882',
  opacity: 1,
}

function ConceptNode({ id, data, selected }) {
  const [isHovered, setIsHovered] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const hoverTimeoutRef = useRef(null)
  const collapseTimeoutRef = useRef(null)

  const sizeStyle = SIZE_SCALES[data.size] || SIZE_SCALES.medium
  const isMarked = data.marked
  const markColor = data.markColor || '#c8a882'
  const categoryColor = CATEGORY_COLORS[data.category] || '#c8a882'
  const sourceIcon = SOURCE_TYPE_ICONS[data.sourceType] || SOURCE_TYPE_ICONS.manual

  // 判断是否有可展开的详细描述
  const hasRichContent = data.description && data.description.length > 60
  const isExpanded = (isHovered || isPinned) && hasRichContent

  // 清理定时器
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
      if (collapseTimeoutRef.current) clearTimeout(collapseTimeoutRef.current)
    }
  }, [])

  // 悬停 800ms 后展开
  const handleHoverStart = () => {
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current)
      collapseTimeoutRef.current = null
    }
    if (isPinned) return
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true)
    }, 800)
  }

  // 离开 500ms 后收起
  const handleHoverEnd = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    if (!isPinned) {
      collapseTimeoutRef.current = setTimeout(() => {
        setIsHovered(false)
      }, 500)
    }
  }

  // 切换钉住状态
  const handleTogglePin = (e) => {
    e.stopPropagation()
    setIsPinned(!isPinned)
    if (!isPinned) setIsHovered(true)
  }

  // 截断描述文本
  const getShortDescription = () => {
    if (!data.description) return ''
    if (data.description.length <= 60) return data.description
    return data.description.slice(0, 60) + '...'
  }

  return (
    <div
      className={`
        relative rounded-lg border
        transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${selected ? 'ring-2 ring-offset-2 scale-[1.02]' : 'hover:shadow-lg'}
        ${isExpanded ? 'min-w-[320px] max-w-[400px]' : `${sizeStyle.minW} ${sizeStyle.maxW}`}
      `}
      style={{
        backgroundColor: '#fafafa',
        borderColor: selected ? '#c8a882' : '#e8e8e8',
        ringColor: selected ? '#c8a882' : undefined,
        boxShadow: isMarked
          ? `0 0 0 3px ${markColor}40, 0 4px 12px ${markColor}20`
          : selected
            ? '0 4px 20px rgba(200, 168, 130, 0.15)'
            : '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      {/* 标记指示器 */}
      {isMarked && (
        <div
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-white shadow-sm"
          style={{ backgroundColor: markColor }}
        />
      )}

      {/* 连接点 */}
      <Handle type="target" position={Position.Top} style={{ ...HANDLE_STYLE, top: -5 }} />
      <Handle type="source" position={Position.Bottom} style={{ ...HANDLE_STYLE, bottom: -5 }} />
      <Handle type="target" position={Position.Left} id="left" style={{ ...HANDLE_STYLE, left: -5 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ ...HANDLE_STYLE, right: -5 }} />

      {/* 钉住按钮 */}
      {isExpanded && (
        <button
          onClick={handleTogglePin}
          className="absolute -top-3 right-2 w-5 h-5 flex items-center justify-center rounded-full shadow-sm transition-all z-10"
          style={{
            backgroundColor: isPinned ? '#c8a882' : '#fafafa',
            color: isPinned ? '#fafafa' : '#888',
            border: isPinned ? 'none' : '1px solid #e8e8e8',
          }}
          title={isPinned ? '取消钉住' : '钉住展开'}
        >
          <svg className="w-3 h-3" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3 7h6l-5 5 2 8-6-4-6 4 2-8-5-5h6l3-7z" />
          </svg>
        </button>
      )}

      {/* 分类标签（右上角） */}
      {data.category && (
        <div
          className="absolute -top-2.5 right-6 px-2 py-0.5 rounded text-[10px] font-medium tracking-wider"
          style={{
            backgroundColor: categoryColor,
            color: '#fafafa',
            fontFamily: '"Noto Sans SC", system-ui, sans-serif',
            letterSpacing: '0.15em',
          }}
        >
          {data.category}
        </div>
      )}

      {/* 顶部暖色装饰线 */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] rounded-t-lg transition-all duration-500"
        style={{
          backgroundColor: '#c8a882',
          opacity: selected || isHovered ? 1 : 0.4,
          transform: selected || isHovered ? 'scaleX(1)' : 'scaleX(0.3)',
          transformOrigin: 'left',
        }}
      />

      {/* 内容区域 */}
      <div
        className={`${sizeStyle.padding} transition-all duration-300`}
        onMouseEnter={handleHoverStart}
        onMouseLeave={handleHoverEnd}
      >
        {/* 标题 */}
        <h3
          className={`${sizeStyle.titleSize} font-bold truncate`}
          style={{
            color: '#1a1a1a',
            fontFamily: '"Noto Serif SC", Georgia, serif',
            letterSpacing: '0.02em',
          }}
        >
          {safeString(data.title)}
        </h3>

        {/* 收起态 - 简短描述 */}
        <div className={`transition-all duration-300 overflow-hidden ${
          isExpanded ? 'max-h-0 opacity-0' : 'max-h-20 opacity-100'
        }`}>
          <p
            className={`${sizeStyle.textSize} mt-1 leading-relaxed line-clamp-2`}
            style={{ color: '#555', fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}
          >
            {getShortDescription()}
          </p>
        </div>

        {/* 展开态 - 完整描述 */}
        <div className={`transition-all duration-300 overflow-hidden ${
          isExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
        }`}>
          <div
            className="text-xs mt-2 whitespace-pre-wrap leading-relaxed max-h-[380px] overflow-y-auto"
            style={{
              color: '#2d2d2d',
              fontFamily: '"Noto Sans SC", system-ui, sans-serif',
            }}
          >
            {safeString(data.description)}
          </div>
        </div>

        {/* 标签 */}
        {data.tags && data.tags.length > 0 && !isExpanded && (
          <div className="flex flex-wrap gap-1 mt-2">
            {data.tags.slice(0, 3).map((tag, i) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: '#f5f0eb',
                  color: '#c8a882',
                  border: '1px solid #e8d5c0',
                  fontFamily: '"Noto Sans SC", system-ui, sans-serif',
                }}
              >
                {safeString(tag)}
              </span>
            ))}
            {data.tags.length > 3 && (
              <span className="text-[10px]" style={{ color: '#bbb' }}>
                +{data.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* 展开态标签（全部显示） */}
        {data.tags && data.tags.length > 0 && isExpanded && (
          <div className="flex flex-wrap gap-1 mt-2">
            {data.tags.map((tag, i) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: '#f5f0eb',
                  color: '#c8a882',
                  border: '1px solid #e8d5c0',
                  fontFamily: '"Noto Sans SC", system-ui, sans-serif',
                }}
              >
                {safeString(tag)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 底部信息栏 */}
      {data.source && !isExpanded && (
        <div
          className="px-3 py-1.5 flex items-center gap-1.5"
          style={{
            borderTop: '1px solid #e8e8e8',
          }}
        >
          <span style={{ color: '#bbb' }}>{sourceIcon}</span>
          <span
            className="text-[10px] truncate max-w-[120px]"
            style={{ color: '#888', fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}
          >
            {safeString(data.source)}
          </span>
        </div>
      )}

      {/* 悬停展开提示 */}
      {hasRichContent && !isExpanded && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-1 text-[10px] opacity-40 hover:opacity-80 transition-opacity" style={{ color: '#888' }}>
            <svg className="w-3 h-3 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span style={{ fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}>悬停展开</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(ConceptNode)
