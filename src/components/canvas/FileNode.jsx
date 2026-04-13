/**
 * FileNode - 文件节点
 * 显示各类文件类型，含图标和颜色区分
 */

import { memo, useState } from 'react'
import { Handle, Position } from 'reactflow'

// 安全获取字符串内容
const safeString = (val) => {
  if (typeof val === 'string') return val
  if (val === null || val === undefined) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

// 文件类型配置
const FILE_TYPES = {
  pdf: { color: '#DC2626', bgColor: '#fef2f2', label: 'PDF' },
  doc: { color: '#2563EB', bgColor: '#eff6ff', label: 'Word' },
  docx: { color: '#2563EB', bgColor: '#eff6ff', label: 'Word' },
  xls: { color: '#16A34A', bgColor: '#f0fdf4', label: 'Excel' },
  xlsx: { color: '#16A34A', bgColor: '#f0fdf4', label: 'Excel' },
  ppt: { color: '#EA580C', bgColor: '#fff7ed', label: 'PPT' },
  pptx: { color: '#EA580C', bgColor: '#fff7ed', label: 'PPT' },
  txt: { color: '#6B7280', bgColor: '#f9fafb', label: 'TXT' },
  md: { color: '#1F2937', bgColor: '#f9fafb', label: 'Markdown' },
  json: { color: '#FBBF24', bgColor: '#fffbeb', label: 'JSON' },
  zip: { color: '#7C3AED', bgColor: '#faf5ff', label: 'ZIP' },
  default: { color: '#9CA3AF', bgColor: '#f9fafb', label: '文件' },
}

// 获取文件类型
const getFileType = (filename) => {
  const ext = filename?.split('.').pop()?.toLowerCase()
  return FILE_TYPES[ext] || FILE_TYPES.default
}

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 连接点样式
const HANDLE_STYLE = {
  width: 10, height: 10,
  border: '2px solid white',
  borderRadius: '50%',
  backgroundColor: '#888',
  opacity: 1,
  cursor: 'crosshair',
}

function FileNode({ id, data, selected }) {
  const [isHovered, setIsHovered] = useState(false)
  const fileType = getFileType(data.name)

  const handleClick = () => {
    if (data.url) window.open(data.url, '_blank')
  }

  return (
    <div
      className={`
        relative w-[200px] rounded-lg border cursor-pointer
        transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${selected ? 'ring-2 ring-offset-2 scale-[1.02]' : 'hover:shadow-lg'}
      `}
      style={{
        overflow: 'visible',
        backgroundColor: '#fafafa',
        borderColor: selected ? '#c8a882' : '#e8e8e8',
        ringColor: selected ? '#c8a882' : undefined,
        boxShadow: selected ? '0 4px 20px rgba(200, 168, 130, 0.15)' : '0 1px 3px rgba(0,0,0,0.06)',
      }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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

      {/* 文件图标区 */}
      <div
        className="relative h-24 flex items-center justify-center rounded-t-lg"
        style={{ backgroundColor: fileType.bgColor }}
      >
        {/* 文件图标 */}
        <svg className="w-12 h-12" style={{ color: fileType.color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>

        {/* 文件类型标签 */}
        <div
          className="absolute top-2 left-2 px-2 py-0.5 text-white text-[10px] font-bold rounded"
          style={{ backgroundColor: fileType.color }}
        >
          {fileType.label}
        </div>

        {/* 悬停时下载图标 */}
        {isHovered && data.url && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-white/90 rounded-full flex items-center justify-center shadow">
            <svg className="w-3.5 h-3.5" style={{ color: '#555' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
        )}
      </div>

      {/* 文件信息 */}
      <div className="p-2.5">
        <h4
          className="font-medium text-sm line-clamp-2 leading-tight"
          style={{ color: '#1a1a1a', fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}
        >
          {safeString(data.name) || '未命名文件'}
        </h4>
        {data.size && (
          <p className="text-xs mt-1" style={{ color: '#bbb' }}>
            {formatFileSize(data.size)}
          </p>
        )}
      </div>
    </div>
  )
}

export default memo(FileNode)
