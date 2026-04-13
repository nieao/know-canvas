/**
 * CategoryNode - 知识分类标签节点
 * 圆形分类徽章，显示分类名称和子概念数量
 * 建筑极简风格
 */

import { memo } from 'react'
import { Handle, Position } from 'reactflow'

// 安全获取字符串内容
const safeString = (val) => {
  if (typeof val === 'string') return val
  if (val === null || val === undefined) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

// 默认分类配置：图标 + 颜色
const CATEGORY_CONFIG = {
  '概念': { icon: '💡', color: '#c8a882' },
  '技术': { icon: '⚙', color: '#7c9eb2' },
  '人物': { icon: '👤', color: '#b2917c' },
  '事件': { icon: '📅', color: '#8b9e7c' },
  '方法': { icon: '🔧', color: '#9e7cb2' },
  '工具': { icon: '🛠', color: '#7cb2a8' },
  '理论': { icon: '📐', color: '#b27c8b' },
  '资源': { icon: '📦', color: '#a8a87c' },
}

// 连接点样式
const HANDLE_STYLE = {
  width: 10, height: 10,
  border: '2px solid white',
  borderRadius: '50%',
  backgroundColor: '#fafafa',
  opacity: 1,
  cursor: 'crosshair',
}

function CategoryNode({ data, selected }) {
  const config = CATEGORY_CONFIG[data.name] || { icon: '📁', color: data.color || '#c8a882' }
  const categoryColor = data.color || config.color
  const childCount = data.childCount || 0

  return (
    <div
      className={`
        w-24 h-24 rounded-full flex flex-col items-center justify-center
        transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${selected ? 'scale-110' : 'hover:scale-105'}
      `}
      style={{
        backgroundColor: categoryColor,
        boxShadow: selected
          ? `0 0 0 4px #fafafa, 0 0 0 6px ${categoryColor}, 0 8px 24px ${categoryColor}40`
          : `0 4px 12px ${categoryColor}30`,
      }}
    >
      {/* 连接点 */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ ...HANDLE_STYLE, top: -5 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ ...HANDLE_STYLE, bottom: -5 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{ ...HANDLE_STYLE, left: -5 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ ...HANDLE_STYLE, right: -5 }}
      />

      {/* 图标 */}
      <span className="text-xl mb-0.5">{config.icon}</span>

      {/* 分类名称 */}
      <span
        className="text-xs font-bold text-center px-2 truncate max-w-full"
        style={{
          color: '#fafafa',
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
          letterSpacing: '0.05em',
        }}
      >
        {safeString(data.name)}
      </span>

      {/* 子概念数量 */}
      {childCount > 0 && (
        <span
          className="text-[10px] font-medium mt-0.5"
          style={{
            color: 'rgba(250, 250, 250, 0.7)',
            fontFamily: '"Noto Sans SC", system-ui, sans-serif',
          }}
        >
          {childCount} 条
        </span>
      )}
    </div>
  )
}

export default memo(CategoryNode)
