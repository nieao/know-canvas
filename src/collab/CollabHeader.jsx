/**
 * CollabHeader — 画布右上角的协作信息条
 *
 * 包含：AI 设置按钮 · 在线用户列表 · 房间号/用户名徽章 · 退出按钮
 *
 * 拆出来的目的：让 KnowledgeGraph 只引一个组件，UI 细节内聚在协作子系统里。
 */

import { RemoteUserList } from './PresenceLayer'

export default function CollabHeader({ room, username, onOpenAiSettings, onExit }) {
  return (
    <div className="absolute top-4 right-16 z-30 flex items-center gap-2">
      <button
        onClick={onOpenAiSettings}
        className="px-2.5 py-1.5 rounded-lg shadow-sm transition-colors"
        style={{
          backgroundColor: 'rgba(250,250,250,0.95)',
          border: '1px solid #e8e8e8',
          color: '#888',
          backdropFilter: 'blur(8px)',
        }}
        title="AI 模型设置"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <RemoteUserList />
      <div
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg shadow-sm"
        style={{
          backgroundColor: 'rgba(250,250,250,0.95)',
          border: '1px solid #e8e8e8',
          backdropFilter: 'blur(8px)',
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        }}
      >
        <span className="text-[10px]" style={{ color: '#bbb', letterSpacing: '0.15em' }}>房间</span>
        <span className="text-xs font-medium" style={{ color: '#c8a882' }}>{room}</span>
        <span className="mx-1 text-[10px]" style={{ color: '#e8e8e8' }}>·</span>
        <span className="text-xs" style={{ color: '#888' }}>{username}</span>
        <button
          onClick={onExit}
          className="ml-1 text-[10px] px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors"
          style={{ color: '#bbb' }}
          title="退出"
        >
          ×
        </button>
      </div>
    </div>
  )
}
