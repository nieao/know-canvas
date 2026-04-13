/**
 * GroupNode - 分组容器节点
 * 使用 React Flow 父子机制实现节点包含
 * 展开态为容器背景，收起态为紧凑卡片
 * 建筑极简风格
 */

import { memo, useState, useRef, useEffect, useMemo } from 'react'
import { Handle, Position, NodeResizer } from 'reactflow'

// 收起状态固定尺寸
const COLLAPSED_WIDTH = 220

// 预设分组颜色
const GROUP_COLORS = [
  '#c8a882', // 暖色（默认）
  '#7c9eb2', // 蓝灰
  '#8b9e7c', // 绿灰
  '#b2917c', // 棕灰
  '#9e7cb2', // 紫灰
  '#b27c8b', // 粉灰
  '#7cb2a8', // 青灰
  '#a8a87c', // 橄榄
]

// 节点类型图标和标签
const NODE_TYPE_CONFIG = {
  conceptNode: { icon: 'C', label: '概念', color: '#c8a882' },
  categoryNode: { icon: 'K', label: '分类', color: '#7c9eb2' },
  noteNode: { icon: 'N', label: '笔记', color: '#b2917c' },
  bookmarkNode: { icon: 'L', label: '链接', color: '#8b9e7c' },
  videoNode: { icon: 'V', label: '视频', color: '#9e7cb2' },
  imageNode: { icon: 'I', label: '图片', color: '#b27c8b' },
  fileNode: { icon: 'F', label: '文件', color: '#7cb2a8' },
}

function GroupNode({ id, data, selected, style }) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState('')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const nameInputRef = useRef(null)
  const colorPickerRef = useRef(null)

  const isExpanded = data.expanded !== false
  const memberCount = data.memberNodeIds?.length || 0
  const groupName = data.name || `分组 (${memberCount})`
  const groupColor = data.color || '#c8a882'

  // 计算成员类型统计
  const memberStats = useMemo(() => {
    if (!data.memberTypes) return null
    const stats = {}
    data.memberTypes.forEach(type => {
      stats[type] = (stats[type] || 0) + 1
    })
    return stats
  }, [data.memberTypes])

  const width = style?.width || data.width || 300
  const height = style?.height || data.height || 200

  // 编辑名称时自动聚焦
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isEditingName])

  // 点击外部关闭颜色选择器
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target)) {
        setShowColorPicker(false)
      }
    }
    if (showColorPicker) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showColorPicker])

  const handleColorChange = (color) => {
    window.dispatchEvent(new CustomEvent('group-color-change', {
      detail: { groupId: id, color }
    }))
    setShowColorPicker(false)
  }

  const handleAutoArrange = (e) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('group-auto-arrange', {
      detail: { groupId: id }
    }))
  }

  const handleNameDoubleClick = (e) => {
    e.stopPropagation()
    setEditName(groupName)
    setIsEditingName(true)
  }

  const handleNameSave = () => {
    if (editName.trim() && editName !== groupName) {
      window.dispatchEvent(new CustomEvent('group-rename', {
        detail: { groupId: id, name: editName.trim() }
      }))
    }
    setIsEditingName(false)
  }

  const handleNameKeyDown = (e) => {
    if (e.key === 'Enter') handleNameSave()
    else if (e.key === 'Escape') setIsEditingName(false)
  }

  const handleToggleExpand = (e) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('group-toggle', {
      detail: { groupId: id, expanded: !isExpanded }
    }))
  }

  const handleUngroup = (e) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('ungroup', {
      detail: { groupId: id }
    }))
  }

  // 颜色选择器下拉
  const ColorPicker = () => (
    showColorPicker && (
      <div
        className="absolute top-full left-0 mt-1 p-2 bg-white rounded-lg shadow-xl border z-50 grid grid-cols-4 gap-1"
        style={{ borderColor: '#e8e8e8' }}
        onClick={(e) => e.stopPropagation()}
      >
        {GROUP_COLORS.map((color) => (
          <button
            key={color}
            className={`w-6 h-6 rounded-full transition-all hover:scale-110 ${
              color === groupColor ? 'ring-2 ring-offset-1' : ''
            }`}
            style={{
              backgroundColor: color,
              ringColor: color === groupColor ? '#888' : undefined,
            }}
            onClick={() => handleColorChange(color)}
          />
        ))}
      </div>
    )
  )

  // ===== 收起态 =====
  if (!isExpanded) {
    return (
      <div
        className={`
          relative bg-white rounded-lg border-2 overflow-hidden shadow-md
          transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
          ${selected ? 'ring-2 ring-offset-2 scale-[1.02]' : 'hover:shadow-lg'}
        `}
        style={{
          width: COLLAPSED_WIDTH,
          borderColor: groupColor,
          backgroundColor: `${groupColor}08`,
          ringColor: selected ? groupColor : undefined,
        }}
      >
        {/* 连接点 */}
        <Handle type="target" position={Position.Top}
          className="!w-3 !h-3 !border-2 !border-white !rounded-full hover:!scale-125 transition-all"
          style={{ backgroundColor: groupColor }} />
        <Handle type="source" position={Position.Bottom}
          className="!w-3 !h-3 !border-2 !border-white !rounded-full hover:!scale-125 transition-all"
          style={{ backgroundColor: groupColor }} />
        <Handle type="target" position={Position.Left} id="left"
          className="!w-3 !h-3 !border-2 !border-white !rounded-full hover:!scale-125 transition-all"
          style={{ backgroundColor: groupColor }} />
        <Handle type="source" position={Position.Right} id="right"
          className="!w-3 !h-3 !border-2 !border-white !rounded-full hover:!scale-125 transition-all"
          style={{ backgroundColor: groupColor }} />

        {/* 头部 */}
        <div
          className="drag-handle px-3 py-2.5 flex items-center gap-2 cursor-move"
          style={{ backgroundColor: `${groupColor}20` }}
        >
          <div className="relative" ref={colorPickerRef}>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-white/50 transition-all"
              style={{ backgroundColor: groupColor }}
              onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker) }}
              title="更改颜色"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <ColorPicker />
          </div>

          <div className="flex-1 min-w-0" onDoubleClick={handleNameDoubleClick}>
            {isEditingName ? (
              <input
                ref={nameInputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleNameSave}
                onKeyDown={handleNameKeyDown}
                className="w-full px-2 py-1 text-sm font-semibold rounded border outline-none"
                style={{ borderColor: groupColor, color: groupColor }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <p className="text-sm font-semibold truncate" style={{ color: groupColor, fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}>
                  {groupName}
                </p>
                <p className="text-xs" style={{ color: '#bbb' }}>{memberCount} 节点</p>
              </>
            )}
          </div>

          <button
            className="p-1.5 hover:bg-white/50 rounded-lg transition-colors flex-shrink-0"
            onClick={handleToggleExpand}
            title="展开分组"
          >
            <svg className="w-4 h-4" style={{ color: '#888' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </div>

        {/* 成员类型统计 */}
        {memberStats && Object.keys(memberStats).length > 0 && (
          <div className="px-3 py-2 flex flex-wrap gap-1.5" style={{ borderTop: `1px solid ${groupColor}20` }}>
            {Object.entries(memberStats).map(([type, count]) => {
              const config = NODE_TYPE_CONFIG[type] || { icon: '?', label: type, color: '#888' }
              return (
                <div
                  key={type}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                  style={{ backgroundColor: `${config.color}15`, color: config.color }}
                  title={config.label}
                >
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: config.color }}
                  >
                    {config.icon}
                  </span>
                  <span className="font-medium">{count}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* 操作栏 */}
        <div className="px-3 py-1.5 flex items-center justify-between text-xs" style={{ borderTop: `1px solid ${groupColor}15` }}>
          <span className="cursor-pointer hover:opacity-80" style={{ color: '#bbb' }} onClick={handleToggleExpand}>
            点击展开
          </span>
          <button
            className="transition-colors"
            style={{ color: '#b27c8b' }}
            onClick={handleUngroup}
            title="解散分组"
          >
            解散
          </button>
        </div>
      </div>
    )
  }

  // ===== 展开态 =====
  return (
    <div
      className={`
        relative rounded-2xl border-2 border-dashed
        transition-all duration-300
        ${selected ? 'ring-2 ring-offset-2' : ''}
      `}
      style={{
        width,
        height,
        borderColor: `${groupColor}60`,
        backgroundColor: `${groupColor}15`,
        ringColor: selected ? `${groupColor}80` : undefined,
      }}
    >
      <NodeResizer
        minWidth={200}
        minHeight={150}
        isVisible={selected}
        lineClassName="!border-[#c8a882]"
        handleClassName="!w-3 !h-3 !bg-[#c8a882] !border-2 !border-white !rounded"
      />

      {/* 连接点 */}
      <Handle type="target" position={Position.Top}
        className="!w-3 !h-3 !border-2 !border-white !rounded-full hover:!scale-125 transition-all"
        style={{ backgroundColor: groupColor }} />
      <Handle type="source" position={Position.Bottom}
        className="!w-3 !h-3 !border-2 !border-white !rounded-full hover:!scale-125 transition-all"
        style={{ backgroundColor: groupColor }} />
      <Handle type="target" position={Position.Left} id="left"
        className="!w-3 !h-3 !border-2 !border-white !rounded-full hover:!scale-125 transition-all"
        style={{ backgroundColor: groupColor }} />
      <Handle type="source" position={Position.Right} id="right"
        className="!w-3 !h-3 !border-2 !border-white !rounded-full hover:!scale-125 transition-all"
        style={{ backgroundColor: groupColor }} />

      {/* 头部工具栏 */}
      <div
        className="drag-handle absolute top-0 left-0 right-0 h-10 rounded-t-2xl flex items-center px-3 gap-2 cursor-move"
        style={{ backgroundColor: `${groupColor}25` }}
      >
        <div className="relative" ref={colorPickerRef}>
          <div
            className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-white/50 transition-all"
            style={{ backgroundColor: groupColor }}
            onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker) }}
            title="更改颜色"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <ColorPicker />
        </div>

        <div className="flex-1 min-w-0" onDoubleClick={handleNameDoubleClick}>
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
              className="w-full px-2 py-0.5 text-sm font-semibold rounded border outline-none bg-white"
              style={{ borderColor: groupColor, color: groupColor }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <p className="text-sm font-semibold truncate cursor-pointer" style={{ color: groupColor, fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}>
              {groupName}
              <span className="ml-2 text-xs font-normal opacity-60">({memberCount})</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={handleAutoArrange} className="p-1.5 hover:bg-white/50 rounded transition-colors" title="自动排列">
            <svg className="w-4 h-4" style={{ color: groupColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
          </button>
          <button onClick={handleToggleExpand} className="p-1.5 hover:bg-white/50 rounded transition-colors" title="收起分组">
            <svg className="w-4 h-4" style={{ color: groupColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4m0 0l6-6m-6 6l6 6" />
            </svg>
          </button>
          <button onClick={handleUngroup} className="p-1.5 hover:bg-red-100 rounded transition-colors" title="解散分组">
            <svg className="w-4 h-4" style={{ color: '#b27c8b' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(GroupNode)
