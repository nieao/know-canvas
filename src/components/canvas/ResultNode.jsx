/**
 * ResultNode — Hermes 任务返回的结果节点
 *
 * 由 store.dispatchTaskNode 在 polling 拿到 done 状态时自动创建 + 自动连线 (TaskNode → ResultNode)
 *
 * 显示:
 *   - 任务标题 (引用源 TaskNode)
 *   - 完整结果文本 (markdown 简单 render)
 *   - 元信息: task_id, assignee, 完成时间
 *
 * 建筑极简风, 暖色系绿色 accent (区别于 TaskNode 的暖色)
 */

import { memo, useState } from 'react'
import { Handle, Position } from 'reactflow'
import ColorAccentBar from './ColorAccentBar'

function ResultNodeImpl({ data, selected }) {
  const [expanded, setExpanded] = useState(false)
  const sourceTaskId = data.source_task_id || ''
  const sourceTitle = data.source_title || '未知任务'
  const result = data.result || '(无结果文本)'
  const taskId = data.task_id || ''
  const assignee = data.assignee || ''
  const finishedAt = data.finished_at || ''

  const isLong = result.length > 200
  const preview = expanded ? result : (isLong ? result.slice(0, 200) + '…' : result)

  return (
    <div
      className="relative border rounded-md shadow-sm transition-all duration-300"
      style={{
        width: 320, minHeight: 160,
        background: 'var(--surface)',
        // 选中边: emerald 完成色 — 用 status-success 语义色, 跨主题保持完成绿
        borderColor: selected ? '#5a8a5a' : 'var(--border-subtle)',
      }}
    >
      {/* 顶部色条: 完成色 (语义色: 完成绿, 不随主题切换) */}
      <ColorAccentBar color="#8b9e7c" />

      <Handle type="target" position={Position.Top} style={{ background: '#8b9e7c' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#8b9e7c' }} />

      <div className="px-4 py-3">
        {/* 标签 */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] tracking-[0.25em] uppercase font-semibold" style={{ color: '#5a8a5a' }}>
            <span className="mr-1">●</span>HERMES RESULT
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>已完成</span>
        </div>

        {/* 源任务标题 */}
        <div className="text-[11px] mb-1 truncate" style={{ color: 'var(--text-muted)' }}>
          ↩ {sourceTitle}
        </div>

        {/* 结果内容 */}
        <div className="text-xs whitespace-pre-wrap break-words leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {preview}
        </div>

        {isLong && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            className="text-[10px] mt-1 hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            {expanded ? '收起' : '展开全文'}
          </button>
        )}

        {/* 元信息 */}
        <div className="text-[10px] mt-2 font-mono space-y-0.5" style={{ color: 'var(--text-faint)' }}>
          {taskId && <div>{taskId}</div>}
          {assignee && <div>by {assignee}</div>}
          {finishedAt && <div>{finishedAt}</div>}
        </div>
      </div>
    </div>
  )
}

export default memo(ResultNodeImpl)
