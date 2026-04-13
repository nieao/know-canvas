/**
 * ImageNode - 图片节点
 * 在画布上显示图片，支持加载状态和错误处理
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

// 连接点样式
const HANDLE_STYLE = {
  width: 10, height: 10,
  border: '2px solid white',
  borderRadius: '50%',
  backgroundColor: '#c8a882',
  opacity: 1,
  cursor: 'crosshair',
}

function ImageNode({ id, data, selected }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  return (
    <div
      className={`
        relative min-w-[150px] max-w-[300px] rounded-lg border
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

      {/* 图片容器 */}
      <div className="relative overflow-hidden rounded-t-lg">
        {!loaded && !error && (
          <div className="w-full h-32 flex items-center justify-center" style={{ backgroundColor: '#f5f0eb' }}>
            <div className="animate-pulse" style={{ color: '#bbb' }}>加载中...</div>
          </div>
        )}

        {error ? (
          <div className="w-full h-32 flex flex-col items-center justify-center" style={{ backgroundColor: '#f5f0eb' }}>
            <svg className="w-10 h-10 mb-1" style={{ color: '#bbb' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs" style={{ color: '#bbb' }}>图片加载失败</span>
          </div>
        ) : (
          <img
            src={data.src}
            alt={data.alt || '图片'}
            className={`w-full object-cover ${loaded ? '' : 'hidden'}`}
            style={{ maxHeight: '200px' }}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
        )}

        {/* 类型标签 */}
        <div
          className="absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-medium rounded"
          style={{
            backgroundColor: '#c8a882',
            color: '#fafafa',
            letterSpacing: '0.1em',
          }}
        >
          图片
        </div>
      </div>

      {/* 说明文字 */}
      {data.alt && (
        <div className="px-2 py-1.5" style={{ borderTop: '1px solid #e8e8e8' }}>
          <p className="text-xs truncate" style={{ color: '#555', fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}>
            {safeString(data.alt)}
          </p>
        </div>
      )}
    </div>
  )
}

export default memo(ImageNode)
