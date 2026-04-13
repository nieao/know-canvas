/**
 * VideoNode - 视频节点
 * 显示视频嵌入（YouTube、Bilibili 等），支持本地视频
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

// 平台配置
const PLATFORMS = {
  youtube: {
    color: '#DC2626',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
    label: 'YouTube',
  },
  bilibili: {
    color: '#00A1D6',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.659.373-.907.249-.248.556-.373.92-.373.347 0 .653.125.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.248.573-.373.92-.373.347 0 .662.125.92.373.248.248.373.551.373.907 0 .355-.125.658-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373z"/>
      </svg>
    ),
    label: 'Bilibili',
  },
  local: {
    color: '#555',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
      </svg>
    ),
    label: '本地',
  },
  other: {
    color: '#888',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    label: '视频',
  },
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

function VideoNode({ id, data, selected }) {
  const platform = PLATFORMS[data.platform] || PLATFORMS.other
  const isLoading = data.loading
  const isLocalVideo = data.isLocalFile || data.platform === 'local'

  const handleClick = () => {
    if (data.url) {
      window.open(data.url, '_blank', isLocalVideo ? undefined : 'noopener,noreferrer')
    }
  }

  // 获取缩略图
  const getThumbnail = () => {
    if (data.thumbnail) return data.thumbnail
    if (data.image) return data.image
    if (data.platform === 'youtube' && data.videoId) {
      return `https://img.youtube.com/vi/${data.videoId}/mqdefault.jpg`
    }
    return null
  }

  const thumbnail = getThumbnail()
  const badgeLabel = isLocalVideo && data.format ? data.format : platform.label

  return (
    <div
      className={`
        relative w-[260px] rounded-lg border cursor-pointer
        transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${selected ? 'ring-2 ring-offset-2' : 'hover:shadow-lg'}
      `}
      style={{
        overflow: 'visible',
        backgroundColor: '#fafafa',
        borderColor: selected ? '#c8a882' : '#e8e8e8',
        ringColor: selected ? '#c8a882' : undefined,
        boxShadow: selected ? '0 4px 20px rgba(200, 168, 130, 0.15)' : '0 1px 3px rgba(0,0,0,0.06)',
      }}
      onClick={handleClick}
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

      {/* 缩略图 / 预览 */}
      <div className="relative h-36 flex items-center justify-center overflow-hidden rounded-t-lg" style={{ backgroundColor: '#1a1a1a' }}>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center" style={{ color: '#888' }}>
            <svg className="w-8 h-8 animate-spin mb-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-xs">获取视频信息...</span>
          </div>
        ) : thumbnail ? (
          <img
            src={thumbnail}
            alt={safeString(data.title) || '视频缩略图'}
            className="w-full h-full object-cover"
          />
        ) : (
          <div style={{ color: '#555' }}>
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {/* 播放按钮覆盖层 */}
        {!isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors">
            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 ml-0.5" style={{ color: '#1a1a1a' }} fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          </div>
        )}

        {/* 平台标签 */}
        <div
          className="absolute top-2 left-2 px-2 py-1 text-[10px] font-medium rounded flex items-center gap-1 text-white"
          style={{ backgroundColor: platform.color }}
        >
          {platform.icon}
          <span>{badgeLabel}</span>
        </div>

        {/* 时长标签 */}
        {data.duration && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 text-white text-[10px] font-medium rounded">
            {data.duration}
          </div>
        )}
      </div>

      {/* 视频信息 */}
      <div className="p-2.5">
        <h4
          className="font-medium text-sm line-clamp-2 mb-1"
          style={{ color: '#1a1a1a', fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}
        >
          {safeString(data.title) || '未命名视频'}
        </h4>
        {data.url && (
          <p className="text-[10px] truncate" style={{ color: '#c8a882' }} title={data.url}>
            {safeString(data.url)}
          </p>
        )}
      </div>
    </div>
  )
}

export default memo(VideoNode)
