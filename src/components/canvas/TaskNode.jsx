/**
 * TaskNode — 派给 Hermes 的任务节点
 *
 * 状态机:
 *   draft → dispatching → pending/running → done/failed
 *
 * 建筑极简风:
 *   - 顶部 ColorAccentBar (状态色)
 *   - draft 灰 / running 暖色脉动 / done 绿 / failed 红
 *
 * 行为:
 *   - draft 状态: 显示「派给 Hermes」按钮, 点击调 store.dispatchTaskNode(id)
 *   - 派出后: 自动开始 polling, 由 store 在 useEffect 里管理
 *   - done: 显示结果摘要 + 提示已自动建 ResultNode
 */

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import ColorAccentBar from './ColorAccentBar'
import useCanvasStore from '../../stores/useCanvasStore'
import { TASK_NODE_STATUS } from '../../services/hermesService'

const STATUS_META = {
  [TASK_NODE_STATUS.DRAFT]:       { label: '草稿', color: '#bbbbbb', dot: '○' },
  [TASK_NODE_STATUS.DISPATCHING]: { label: '派单中…', color: '#c8a882', dot: '◐' },
  [TASK_NODE_STATUS.PENDING]:     { label: '排队中', color: '#c8a882', dot: '◔' },
  [TASK_NODE_STATUS.RUNNING]:     { label: 'AI 执行中…', color: '#7c9eb2', dot: '◕' },
  [TASK_NODE_STATUS.DONE]:        { label: '完成', color: '#8b9e7c', dot: '●' },
  [TASK_NODE_STATUS.FAILED]:      { label: '失败', color: '#b27c8b', dot: '✕' },
}

function TaskNodeImpl({ id, data, selected }) {
  const dispatchTaskNode = useCanvasStore((s) => s.dispatchTaskNode)
  const updateNode = useCanvasStore((s) => s.updateNode)

  const handleUpdate = (patch) => handleUpdate(patch)

  const status = data.status || TASK_NODE_STATUS.DRAFT
  const meta = STATUS_META[status] || STATUS_META[TASK_NODE_STATUS.DRAFT]
  const title = data.title || '未命名任务'
  const body = data.body || ''
  const assignee = data.assignee || ''
  const taskId = data.task_id || ''
  const errorMessage = data.error || ''

  const onDispatch = (e) => {
    e.stopPropagation()
    dispatchTaskNode(id).catch((err) => {
      console.error('[TaskNode] dispatch failed:', err)
      handleUpdate({ status: TASK_NODE_STATUS.FAILED, error: err.message })
    })
  }

  return (
    <div
      className={`relative bg-white border rounded-md shadow-sm transition-all duration-300 ${
        selected ? 'border-amber-500' : 'border-gray-200'
      }`}
      style={{ width: 260, minHeight: 140 }}
    >
      <ColorAccentBar color={meta.color} />

      <Handle type="target" position={Position.Top} style={{ background: '#c8a882' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#c8a882' }} />

      <div className="px-4 py-3">
        {/* 标签 */}
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-[10px] tracking-[0.25em] uppercase font-semibold"
            style={{ color: meta.color }}
          >
            <span className="mr-1">{meta.dot}</span>HERMES TASK
          </span>
          <span className="text-[10px] text-gray-400">{meta.label}</span>
        </div>

        {/* 标题 */}
        <input
          type="text"
          className="w-full text-sm font-medium text-gray-900 border-none outline-none bg-transparent mb-1"
          placeholder="任务标题…"
          value={title}
          onChange={(e) => handleUpdate({ title: e.target.value })}
          disabled={status !== TASK_NODE_STATUS.DRAFT}
        />

        {/* 描述 (草稿时可编辑, 之后只读) */}
        {status === TASK_NODE_STATUS.DRAFT ? (
          <textarea
            className="w-full text-xs text-gray-600 border-none outline-none bg-transparent resize-none mt-1"
            placeholder="任务描述 (markdown)…"
            rows={3}
            value={body}
            onChange={(e) => handleUpdate({ body: e.target.value })}
          />
        ) : (
          body && (
            <div className="text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-wrap">
              {body}
            </div>
          )
        )}

        {/* assignee 输入 (draft 状态可填) */}
        {status === TASK_NODE_STATUS.DRAFT && (
          <input
            type="text"
            className="w-full text-[11px] text-gray-500 border-b border-gray-100 outline-none bg-transparent mt-2 pb-1"
            placeholder="assignee (可空)"
            value={assignee}
            onChange={(e) => handleUpdate({ assignee: e.target.value })}
          />
        )}

        {/* 元信息 (派出后) */}
        {taskId && (
          <div className="text-[10px] text-gray-400 mt-2 font-mono">
            {taskId} {assignee ? `· ${assignee}` : ''}
          </div>
        )}

        {/* 错误信息 */}
        {errorMessage && (
          <div className="text-[11px] text-rose-600 mt-2 break-words">
            ⚠ {errorMessage}
          </div>
        )}

        {/* draft 状态: 派给 Hermes 按钮 */}
        {status === TASK_NODE_STATUS.DRAFT && (
          <button
            onClick={onDispatch}
            disabled={!title.trim()}
            className="mt-3 w-full text-xs py-1.5 px-3 rounded-sm border transition-all"
            style={{
              borderColor: title.trim() ? '#c8a882' : '#e5e5e5',
              color: title.trim() ? '#1a1a1a' : '#bbbbbb',
              background: title.trim() ? '#f5f0eb' : 'transparent',
              cursor: title.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            派给 Hermes →
          </button>
        )}

        {/* running 状态: 显示进度条动画 */}
        {(status === TASK_NODE_STATUS.RUNNING || status === TASK_NODE_STATUS.DISPATCHING) && (
          <div className="mt-3 h-0.5 bg-gray-100 overflow-hidden rounded-full">
            <div className="h-full bg-amber-400 animate-pulse" style={{ width: '60%' }} />
          </div>
        )}

        {/* done 状态: 结果跳转 */}
        {status === TASK_NODE_STATUS.DONE && (
          <div className="text-[11px] text-emerald-700 mt-2">
            ✓ 已完成 — 结果已生成 ResultNode
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(TaskNodeImpl)
