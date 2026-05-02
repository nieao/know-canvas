/**
 * TaskNode — 任务清单 + agent/skill 标签展示器
 * boss 方向调整 (2026-05-02 21:00): 节点级 Hermes 派单下放给「决策层」(RightPanel 路由器 + 三模式开关)。
 * 节点本身只展示「当前节点要完成的清单」+「牵扯到的 agent / skill」。
 * 状态机: draft → running → done / failed
 * data: title / body / status / error? / checklist[{id,text,done}] / relatedAgents[] / relatedSkills[]
 */

import { memo, useState } from 'react'
import { Handle, Position } from 'reactflow'
import ColorAccentBar from './ColorAccentBar'
import useCanvasStore from '../../stores/useCanvasStore'
import { TASK_NODE_STATUS } from '../../services/hermesService'

const STATUS_META = {
  [TASK_NODE_STATUS.DRAFT]:   { label: '草稿', color: '#bbbbbb', dot: '○' },
  [TASK_NODE_STATUS.RUNNING]: { label: 'AI 执行中…', color: '#7c9eb2', dot: '◕' },
  [TASK_NODE_STATUS.DONE]:    { label: '完成', color: '#8b9e7c', dot: '●' },
  [TASK_NODE_STATUS.FAILED]:  { label: '失败', color: '#b27c8b', dot: '✕' },
}
const MAX_VISIBLE = 5

function TaskNodeImpl({ id, data, selected }) {
  // 派单逻辑由决策层统一接管, 这里只读写本节点数据
  const updateNode = useCanvasStore((s) => s.updateNode)
  const addChecklistItem = useCanvasStore((s) => s.addChecklistItem)
  const toggleChecklistItem = useCanvasStore((s) => s.toggleChecklistItem)
  const removeChecklistItem = useCanvasStore((s) => s.removeChecklistItem)
  const setRelatedAgents = useCanvasStore((s) => s.setRelatedAgents)
  const setRelatedSkills = useCanvasStore((s) => s.setRelatedSkills)

  const status = data.status || TASK_NODE_STATUS.DRAFT
  const meta = STATUS_META[status] || STATUS_META[TASK_NODE_STATUS.DRAFT]
  const title = data.title || ''
  const body = data.body || ''
  const errorMessage = data.error || ''
  const checklist = Array.isArray(data.checklist) ? data.checklist : []
  const agents = Array.isArray(data.relatedAgents) ? data.relatedAgents : []
  const skills = Array.isArray(data.relatedSkills) ? data.relatedSkills : []
  const isDraft = status === TASK_NODE_STATUS.DRAFT

  const [expanded, setExpanded] = useState(false)
  const [newItem, setNewItem] = useState('')
  const [tagInput, setTagInput] = useState({ kind: null, text: '' }) // kind: 'agents' | 'skills' | null

  const handleUpdate = (patch) => updateNode(id, patch)

  const submitItem = () => {
    const t = newItem.trim()
    if (!t) return
    addChecklistItem?.(id, t)
    setNewItem('')
  }

  const submitTag = () => {
    const t = tagInput.text.trim()
    if (t) {
      if (tagInput.kind === 'agents' && !agents.includes(t)) setRelatedAgents?.(id, [...agents, t])
      if (tagInput.kind === 'skills' && !skills.includes(t)) setRelatedSkills?.(id, [...skills, t])
    }
    setTagInput({ kind: null, text: '' })
  }

  const visible = expanded ? checklist : checklist.slice(0, MAX_VISIBLE)
  const hidden = checklist.length - MAX_VISIBLE

  // 渲染单行标签 (agents 或 skills)
  const renderTagRow = (kind, list, color, removeFn) => {
    // 空状态: 非 draft 且空 → 不渲染整行
    if (!isDraft && list.length === 0) return null
    return (
      <div className="flex items-start gap-1.5 flex-wrap text-[10px]">
        <span className="text-gray-400 tracking-[0.15em] uppercase pt-0.5">{kind} ·</span>
        {list.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border bg-white"
            style={{ borderColor: color, color }}>
            {t}
            {isDraft && (
              <button onClick={(e) => { e.stopPropagation(); removeFn(t) }}
                className="text-gray-400 hover:text-rose-600 leading-none" title="删除">×</button>
            )}
          </span>
        ))}
        {isDraft && tagInput.kind !== kind && (
          <button onClick={(e) => { e.stopPropagation(); setTagInput({ kind, text: '' }) }}
            className="text-gray-400 hover:text-amber-600 px-1">+</button>
        )}
        {isDraft && tagInput.kind === kind && (
          <input autoFocus type="text" className="text-[10px] border-b outline-none bg-transparent w-20"
            style={{ borderColor: color }}
            value={tagInput.text}
            onChange={(e) => setTagInput({ kind, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitTag() }
              else if (e.key === 'Escape') setTagInput({ kind: null, text: '' })
            }}
            onBlur={submitTag} />
        )}
      </div>
    )
  }

  return (
    <div className={`relative bg-white border rounded-md shadow-sm transition-all duration-300 ${
      selected ? 'border-amber-500' : 'border-gray-200'
    }`} style={{ width: 280, minHeight: 140 }}>
      <ColorAccentBar color={meta.color} />
      <Handle type="target" position={Position.Top} style={{ background: '#c8a882' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#c8a882' }} />

      <div className="px-4 py-3">
        {/* 顶部状态行 */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] tracking-[0.25em] uppercase font-semibold" style={{ color: meta.color }}>
            <span className="mr-1">{meta.dot}</span>TASK
          </span>
          <span className="text-[10px] text-gray-400">{meta.label}</span>
        </div>

        {/* 标题 */}
        <input type="text"
          className="w-full text-sm font-medium text-gray-900 border-none outline-none bg-transparent mb-1"
          placeholder="任务标题…" value={title}
          onChange={(e) => handleUpdate({ title: e.target.value })}
          disabled={!isDraft} />

        {/* 描述 */}
        {isDraft ? (
          <textarea
            className="w-full text-xs text-gray-600 border-none outline-none bg-transparent resize-none mt-1"
            placeholder="任务描述 (markdown)…" rows={2} value={body}
            onChange={(e) => handleUpdate({ body: e.target.value })} />
        ) : body && (
          <div className="text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-wrap">{body}</div>
        )}

        {/* 任务清单 */}
        <div className="mt-3 pt-2 border-t" style={{ borderColor: '#f0f0f0' }}>
          <div className="text-[10px] tracking-[0.2em] uppercase text-gray-400 mb-1.5">任务清单</div>
          <ul className="space-y-1">
            {visible.map((item) => (
              <li key={item.id} className="group flex items-center gap-1.5 text-[11px]">
                <button
                  onClick={(e) => { e.stopPropagation(); isDraft && toggleChecklistItem?.(id, item.id) }}
                  disabled={!isDraft}
                  className="flex-shrink-0 w-3.5 h-3.5 border rounded-sm flex items-center justify-center"
                  style={{
                    borderColor: item.done ? '#c8a882' : '#d0d0d0',
                    background: item.done ? '#c8a882' : 'transparent',
                    color: 'white', fontSize: '9px',
                    cursor: isDraft ? 'pointer' : 'default',
                  }}>{item.done ? '✓' : ''}</button>
                <span className="flex-1 break-words" style={{
                  textDecoration: item.done ? 'line-through' : 'none',
                  opacity: item.done ? 0.5 : 1, color: '#3a3a3a',
                }}>{item.text}</span>
                {isDraft && (
                  <button onClick={(e) => { e.stopPropagation(); removeChecklistItem?.(id, item.id) }}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-600 text-[12px] leading-none px-1"
                    title="删除该项">×</button>
                )}
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
              className="text-[10px] text-gray-400 hover:text-amber-600 mt-1">
              {expanded ? '收起 ↑' : `还有 ${hidden} 项 ↓`}
            </button>
          )}
          {isDraft && (
            <input type="text"
              className="w-full text-[11px] mt-1.5 border-b outline-none bg-transparent pb-0.5"
              style={{ borderColor: '#f0f0f0', color: '#3a3a3a' }}
              placeholder="+ 添加项…" value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitItem() }
                else if (e.key === 'Escape') setNewItem('')
              }}
              onBlur={submitItem} />
          )}
        </div>

        {/* 关联标签 */}
        {(isDraft || agents.length > 0 || skills.length > 0) && (
          <div className="mt-3 pt-2 border-t space-y-1.5" style={{ borderColor: '#f0f0f0' }}>
            {renderTagRow('agents', agents, '#c8a882',
              (t) => setRelatedAgents?.(id, agents.filter((a) => a !== t)))}
            {renderTagRow('skills', skills, '#7c9eb2',
              (t) => setRelatedSkills?.(id, skills.filter((s) => s !== t)))}
          </div>
        )}

        {/* 错误信息 */}
        {errorMessage && (
          <div className="text-[11px] text-rose-600 mt-2 break-words">⚠ {errorMessage}</div>
        )}

        {/* running 进度条 */}
        {status === TASK_NODE_STATUS.RUNNING && (
          <div className="mt-3 h-0.5 bg-gray-100 overflow-hidden rounded-full">
            <div className="h-full bg-amber-400 animate-pulse" style={{ width: '60%' }} />
          </div>
        )}

        {/* done 提示 */}
        {status === TASK_NODE_STATUS.DONE && (
          <div className="text-[11px] text-emerald-700 mt-2">✓ 已完成 — 结果已生成 ResultNode</div>
        )}
      </div>
    </div>
  )
}

export default memo(TaskNodeImpl)
