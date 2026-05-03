/**
 * RightPanel - 概念详情与关系编辑面板
 * 功能：选中概念信息展示、关系列表、快速添加关系、分类分配、本地任务派单
 */

import { useState } from 'react'
import useCanvasStore from '../../stores/useCanvasStore'
import { routeTask } from '../../services/taskRouter'
import { runMetaCognitiveTask } from '../../services/metaCognitiveExecutor'
import { logAction } from '../../utils/actionLog'

// 关系类型选项
const RELATION_TYPES = [
  { id: 'related', label: '相关', color: 'var(--warm)' },
  { id: 'contains', label: '包含', color: '#6b9bd2' },
  { id: 'parallel', label: '并列', color: '#7bc47f' },
  { id: 'causes', label: '因果', color: '#d27b7b' },
  { id: 'depends', label: '依赖', color: '#b07bd2' },
  { id: 'contradicts', label: '矛盾', color: '#d2a87b' },
]

// 概念分类
const CONCEPT_CATEGORIES = [
  { id: 'core', label: '核心概念', color: 'var(--warm)' },
  { id: 'theory', label: '理论', color: '#6b9bd2' },
  { id: 'method', label: '方法论', color: '#7bc47f' },
  { id: 'example', label: '案例', color: '#d2a87b' },
  { id: 'reference', label: '参考', color: '#b07bd2' },
  { id: 'question', label: '待探索', color: '#d27b7b' },
]

function RightPanel({
  selectedNode,
  edges = [],
  nodes = [],
  onUpdateNode,
  onAddEdge,
  onRemoveEdge,
  expanded = false,
  onToggleExpanded,
}) {
  const [editingField, setEditingField] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [newTag, setNewTag] = useState('')
  const [showAddRelation, setShowAddRelation] = useState(false)
  const [relationTarget, setRelationTarget] = useState('')
  const [relationType, setRelationType] = useState('related')

  // 获取选中节点的关系
  const nodeEdges = selectedNode
    ? edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id)
    : []

  // 开始编辑字段
  const startEdit = (field, currentValue) => {
    setEditingField(field)
    setEditValue(currentValue || '')
  }

  // 保存编辑
  const saveEdit = () => {
    if (editingField && selectedNode) {
      onUpdateNode?.(selectedNode.id, { [editingField]: editValue })
      logAction('rightpanel.editField', { nodeId: selectedNode.id, field: editingField, valueLen: (editValue || '').length })
    }
    setEditingField(null)
    setEditValue('')
  }

  // 添加标签
  const handleAddTag = () => {
    if (!newTag.trim() || !selectedNode) return
    const currentTags = selectedNode.data?.tags || []
    if (!currentTags.includes(newTag.trim())) {
      onUpdateNode?.(selectedNode.id, { tags: [...currentTags, newTag.trim()] })
      logAction('rightpanel.addTag', { nodeId: selectedNode.id, tag: newTag.trim() })
    }
    setNewTag('')
  }

  // 移除标签
  const handleRemoveTag = (tag) => {
    if (!selectedNode) return
    const currentTags = selectedNode.data?.tags || []
    onUpdateNode?.(selectedNode.id, { tags: currentTags.filter(t => t !== tag) })
    logAction('rightpanel.removeTag', { nodeId: selectedNode.id, tag })
  }

  // 设置分类
  const handleSetCategory = (categoryId) => {
    if (!selectedNode) return
    onUpdateNode?.(selectedNode.id, { category: categoryId })
    logAction('rightpanel.setCategory', { nodeId: selectedNode.id, category: categoryId })
  }

  // 添加关系
  const handleAddRelation = () => {
    if (!relationTarget || !selectedNode) return
    onAddEdge?.({
      source: selectedNode.id,
      target: relationTarget,
      type: relationType,
      label: RELATION_TYPES.find(r => r.id === relationType)?.label || '相关',
    })
    logAction('rightpanel.addRelation', { source: selectedNode.id, target: relationTarget, type: relationType })
    setRelationTarget('')
    setShowAddRelation(false)
  }

  // 无选中节点时的空状态
  if (!selectedNode) {
    return (
      <div className="h-full flex flex-col border-l transition-[width] duration-500" style={{ width: expanded ? 640 : 320, borderColor: 'var(--gray-100)', background: 'var(--white)' }}>
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="section-label">02 / 详情</div>
            <button
              onClick={onToggleExpanded}
              className="text-[10px] px-2 py-1 rounded-md transition-all"
              style={{
                color: 'var(--text-muted, #555)',
                border: '1px solid var(--border-subtle, #e8e8e8)',
                background: expanded ? 'var(--warm-bg, #f5f0eb)' : 'transparent',
              }}
              title={expanded ? '还原侧栏宽度' : '放大侧栏 — 展开完整结论 / 抉择引擎产出'}
            >
              {expanded ? '⇥ 还原' : '⇤ 放大'}
            </button>
          </div>
          <h2 className="heading-serif text-base font-semibold" style={{ color: 'var(--black)' }}>
            概念详情
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center" style={{ color: 'var(--gray-500)' }}>
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
            <p className="text-sm">点击画布上的概念节点</p>
            <p className="text-xs mt-1" style={{ color: 'var(--gray-300)' }}>查看和编辑概念详情</p>
          </div>
        </div>
      </div>
    )
  }

  const nodeData = selectedNode.data || {}

  return (
    <div className="h-full flex flex-col border-l transition-[width] duration-500" style={{ width: expanded ? 640 : 320, borderColor: 'var(--gray-100)', background: 'var(--white)' }}>
      {/* 头部 — 加放大/还原 toggle, 挤占画布比例展示完整结论 */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="section-label">02 / 详情</div>
          <button
            onClick={onToggleExpanded}
            className="text-[10px] px-2 py-1 rounded-md transition-all"
            style={{
              color: 'var(--text-muted, #555)',
              border: '1px solid var(--border-subtle, #e8e8e8)',
              background: expanded ? 'var(--warm-bg, #f5f0eb)' : 'transparent',
            }}
            title={expanded ? '还原侧栏宽度' : '放大侧栏 — 展开完整结论 / 抉择引擎产出'}
          >
            {expanded ? '⇥ 还原' : '⇤ 放大'}
          </button>
        </div>
        <h2 className="heading-serif text-base font-semibold" style={{ color: 'var(--black)' }}>
          {expanded ? '完整结论 · 抉择引擎产出' : '概念详情'}
        </h2>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-5">
        {/* 概念标题 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] tracking-wider" style={{ color: 'var(--gray-500)' }}>标题</span>
            <button
              onClick={() => startEdit('title', nodeData.title)}
              className="text-[10px] transition-colors duration-300"
              style={{ color: 'var(--warm)' }}
            >
              编辑
            </button>
          </div>
          {editingField === 'title' ? (
            <div className="flex gap-1">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                autoFocus
                className="flex-1 px-2.5 py-1.5 text-sm rounded-md focus:outline-none"
                style={{
                  border: '1px solid var(--warm)',
                  fontFamily: 'var(--font-serif)',
                  color: 'var(--black)',
                }}
              />
              <button onClick={saveEdit} className="px-2 text-xs rounded-md" style={{ background: 'var(--warm)', color: 'white' }}>
                保存
              </button>
            </div>
          ) : (
            <p className="text-base font-semibold" style={{ fontFamily: 'var(--font-serif)', color: 'var(--black)' }}>
              {nodeData.title || '未命名概念'}
            </p>
          )}
        </div>

        {/* 描述 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] tracking-wider" style={{ color: 'var(--gray-500)' }}>描述</span>
            <button
              onClick={() => startEdit('description', nodeData.description)}
              className="text-[10px] transition-colors duration-300"
              style={{ color: 'var(--warm)' }}
            >
              编辑
            </button>
          </div>
          {editingField === 'description' ? (
            <div>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                autoFocus
                rows={3}
                className="w-full px-2.5 py-1.5 text-xs rounded-md resize-none focus:outline-none"
                style={{ border: '1px solid var(--warm)', color: 'var(--dark)' }}
              />
              <button onClick={saveEdit} className="mt-1 px-2 py-1 text-[10px] rounded-md" style={{ background: 'var(--warm)', color: 'white' }}>
                保存
              </button>
            </div>
          ) : (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--gray-700)' }}>
              {nodeData.description || '暂无描述，点击编辑添加。'}
            </p>
          )}
        </div>

        {/* 分类 */}
        <div>
          <span className="text-[10px] tracking-wider block mb-2" style={{ color: 'var(--gray-500)' }}>分类</span>
          <div className="flex flex-wrap gap-1.5">
            {CONCEPT_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => handleSetCategory(cat.id)}
                className="px-2.5 py-1 text-[10px] rounded-full transition-all duration-300"
                style={{
                  border: `1px solid ${nodeData.category === cat.id ? cat.color : 'var(--gray-100)'}`,
                  background: nodeData.category === cat.id ? `${cat.color}15` : 'transparent',
                  color: nodeData.category === cat.id ? cat.color : 'var(--gray-500)',
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* 标签 */}
        <div>
          <span className="text-[10px] tracking-wider block mb-2" style={{ color: 'var(--gray-500)' }}>标签</span>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(nodeData.tags || []).map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full"
                style={{ background: 'var(--warm-bg)', color: 'var(--warm)' }}
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="hover:opacity-70"
                  style={{ color: 'var(--warm)' }}
                >
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              placeholder="添加标签..."
              className="flex-1 px-2.5 py-1 text-[10px] rounded-md focus:outline-none"
              style={{ border: '1px solid var(--gray-100)', color: 'var(--dark)' }}
              onFocus={(e) => e.target.style.borderColor = 'var(--warm)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--gray-100)'}
            />
            <button
              onClick={handleAddTag}
              disabled={!newTag.trim()}
              className="px-2 py-1 text-[10px] rounded-md transition-colors"
              style={{
                background: newTag.trim() ? 'var(--warm)' : 'var(--gray-100)',
                color: newTag.trim() ? 'white' : 'var(--gray-500)',
              }}
            >
              +
            </button>
          </div>
        </div>

        {/* 来源信息 */}
        {nodeData.source && (
          <div>
            <span className="text-[10px] tracking-wider block mb-1.5" style={{ color: 'var(--gray-500)' }}>来源</span>
            <p className="text-xs truncate" style={{ color: 'var(--gray-700)' }}>{nodeData.source}</p>
          </div>
        )}

        {/* 分隔线 */}
        <div style={{ borderTop: '1px solid var(--gray-100)' }} />

        {/* 关系列表 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] tracking-wider" style={{ color: 'var(--gray-500)' }}>
              关系 ({nodeEdges.length})
            </span>
            <button
              onClick={() => setShowAddRelation(!showAddRelation)}
              className="text-[10px] transition-colors duration-300"
              style={{ color: 'var(--warm)' }}
            >
              {showAddRelation ? '取消' : '+ 添加关系'}
            </button>
          </div>

          {/* 添加关系表单 */}
          {showAddRelation && (
            <div className="p-3 rounded-md mb-3" style={{ border: '1px solid var(--warm-light)', background: 'var(--warm-bg)' }}>
              <div className="space-y-2">
                <select
                  value={relationTarget}
                  onChange={(e) => setRelationTarget(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-md focus:outline-none"
                  style={{ border: '1px solid var(--gray-100)', color: 'var(--dark)' }}
                >
                  <option value="">选择目标概念...</option>
                  {nodes
                    .filter(n => n.id !== selectedNode.id)
                    .map(n => (
                      <option key={n.id} value={n.id}>{n.data?.title || n.id}</option>
                    ))
                  }
                </select>
                <div className="flex flex-wrap gap-1">
                  {RELATION_TYPES.map(rt => (
                    <button
                      key={rt.id}
                      onClick={() => setRelationType(rt.id)}
                      className="px-2 py-0.5 text-[10px] rounded-full transition-all"
                      style={{
                        border: `1px solid ${relationType === rt.id ? rt.color : 'var(--gray-100)'}`,
                        background: relationType === rt.id ? `${rt.color}20` : 'transparent',
                        color: relationType === rt.id ? rt.color : 'var(--gray-500)',
                      }}
                    >
                      {rt.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleAddRelation}
                  disabled={!relationTarget}
                  className="w-full py-1.5 text-xs rounded-md"
                  style={{
                    background: relationTarget ? 'var(--warm)' : 'var(--gray-100)',
                    color: relationTarget ? 'white' : 'var(--gray-500)',
                  }}
                >
                  添加关系
                </button>
              </div>
            </div>
          )}

          {/* 关系列表 */}
          {nodeEdges.length === 0 ? (
            <p className="text-xs py-3 text-center" style={{ color: 'var(--gray-300)' }}>
              暂无关联关系
            </p>
          ) : (
            <div className="space-y-1.5">
              {nodeEdges.map(edge => {
                const isSource = edge.source === selectedNode.id
                const otherNodeId = isSource ? edge.target : edge.source
                const otherNode = nodes.find(n => n.id === otherNodeId)
                const relType = RELATION_TYPES.find(r => r.id === edge.type || r.label === edge.label)

                return (
                  <div
                    key={edge.id}
                    className="group flex items-center gap-2 px-3 py-2 rounded-md transition-all duration-300"
                    style={{ border: '1px solid var(--gray-100)' }}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--warm-light)'}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--gray-100)'}
                  >
                    {/* 关系方向指示 */}
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: relType?.color || 'var(--warm)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate" style={{ color: 'var(--dark)' }}>
                        {isSource ? '' : ''} {otherNode?.data?.title || otherNodeId}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--gray-500)' }}>
                        {edge.label || edge.type || '相关'}
                      </p>
                    </div>
                    <button
                      onClick={() => { logAction('rightpanel.removeEdge', { edgeId: edge.id }); onRemoveEdge?.(edge.id) }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 transition-opacity"
                      style={{ color: 'var(--gray-500)' }}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 本地任务区块 — 决策层入口 (路由器 + 三模式开关) */}
        <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--gray-100)' }}>
          <LocalTaskSection node={selectedNode} />
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="px-5 py-3 border-t flex gap-2" style={{ borderColor: 'var(--gray-100)' }}>
        <button
          onClick={() => {
            if (selectedNode && confirm('确定要删除此概念吗？')) {
              onUpdateNode?.(selectedNode.id, { _delete: true })
            }
          }}
          className="flex-1 py-2 text-xs rounded-md transition-all duration-300"
          style={{
            border: '1px solid var(--gray-100)',
            color: 'var(--gray-500)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#d27b7b'
            e.currentTarget.style.color = '#d27b7b'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--gray-100)'
            e.currentTarget.style.color = 'var(--gray-500)'
          }}
        >
          删除概念
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LocalTaskSection — 节点级本地任务面板（决策层入口）
// 用户写 prompt → routeTask 实时判路由 → 点执行：
//   target='local'  → runLocalTask 直调本地 callLLM
//   target='hermes' → POST /api/orchestra/inject 派给 Hermes 集群
// 任务以 node.data.localTasks 形式持久化，受 yjs 同步
// ─────────────────────────────────────────────────────────────────────────────

// 中文相对时间
function formatRelativeTime(ts) {
  if (!ts) return ''
  const d = Date.now() - ts
  if (d < 5000) return '刚刚'
  if (d < 60000) return `${Math.floor(d / 1000)} 秒前`
  if (d < 3600000) return `${Math.floor(d / 60000)} 分钟前`
  if (d < 86400000) return `${Math.floor(d / 3600000)} 小时前`
  return `${Math.floor(d / 86400000)} 天前`
}

// 状态图标 + 颜色
const STATUS_META = {
  pending: { icon: '◌', color: '#bbb' },
  running: { icon: '⏵', color: 'var(--warm)' },
  done:    { icon: '✓', color: '#7bc47f' },
  failed:  { icon: '✗', color: '#d27b7b' },
}

// 共享样式常量（避免重复 inline）
const S_LABEL = { fontSize: '0.7rem', letterSpacing: '0.25em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '12px' }
const S_TEXTAREA = { width: '100%', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '12px', fontSize: '12px', minHeight: '80px', resize: 'vertical', color: 'var(--text-secondary)', background: 'var(--surface)', fontFamily: 'var(--font-sans, system-ui)', outline: 'none' }
const S_BTN_PRIMARY = { padding: '6px 16px', fontSize: '12px', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '4px', background: 'transparent', transition: 'all 0.3s' }
const S_BTN_GHOST = { padding: '6px 16px', fontSize: '12px', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', borderRadius: '4px', background: 'transparent' }
const S_PRE = { marginTop: '6px', fontSize: '11px', color: 'var(--text-secondary)', background: 'var(--surface-soft, var(--accent-bg))', border: '1px solid var(--border-subtle)', padding: '8px', borderRadius: '3px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-sans, system-ui)', maxHeight: '300px', overflowY: 'auto' }
const S_DOT = { color: 'var(--border-subtle)' }

function LocalTaskSection({ node }) {
  const [prompt, setPrompt] = useState('')
  const [expanded, setExpanded] = useState({})
  const taskMode = useCanvasStore((s) => s.taskMode)
  const addLocalTask = useCanvasStore((s) => s.addLocalTask)
  const updateLocalTaskStatus = useCanvasStore((s) => s.updateLocalTaskStatus)
  const removeLocalTask = useCanvasStore((s) => s.removeLocalTask)

  if (!node) return null

  const tasks = (node.data?.localTasks || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  const route = prompt.trim() ? routeTask({ text: prompt, mode: taskMode }) : null

  const handleRun = async () => {
    const text = prompt.trim()
    if (!text) return
    const r = routeTask({ text, mode: taskMode })
    const taskId = addLocalTask(node.id, { prompt: text, target: r.target, routerReason: r.reason })
    logAction('rightpanel.runLocalTask', { target: r.target, promptLen: text.length })
    setPrompt('')

    if (r.target === 'local') {
      // 'local' 在新架构下 = 元认知 skill 5 步工作流, 每一步在画布上长出 metaStepNode,
      // 当前 running 节点带脉冲 + 流光动画
      runMetaCognitiveTask({
        nodeId: node.id, taskId, prompt: text,
        onUpdate: (patch) => updateLocalTaskStatus(node.id, taskId, patch),
      })
    } else {
      // Hermes 派单 — 环境感知 URL: dev=本机 17082, prod=同源 /canvas/api/orchestra (经 caddy 反代)
      updateLocalTaskStatus(node.id, taskId, { status: 'running', startedAt: Date.now() })
      try {
        const room = new URLSearchParams(window.location.search).get('room') || 'demo-final'
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        const injectUrl = isLocal
          ? 'http://127.0.0.1:17082/api/orchestra/inject'
          : '/canvas/api/orchestra/inject'
        const resp = await fetch(injectUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room, title: text.slice(0, 60), body: text, assignedTo: 'hermes' }),
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const j = await resp.json()
        updateLocalTaskStatus(node.id, taskId, {
          status: 'done',
          result: `已派单到 Hermes\n\ntask_id: ${j.taskId || j.task_id || '(unknown)'}\n\n看画布 TaskNode 进展`,
          finishedAt: Date.now(),
        })
      } catch (err) {
        updateLocalTaskStatus(node.id, taskId, {
          status: 'failed',
          error: 'Hermes 派单失败：' + (err?.message || String(err)),
          finishedAt: Date.now(),
        })
      }
    }
  }

  const canRun = !!prompt.trim()

  return (
    <div>
      <div style={S_LABEL}>元认知任务</div>
      <div style={{ fontSize: '10px', color: 'var(--gray-500)', marginBottom: '8px', lineHeight: 1.55 }}>
        🧠 意图 → 🔧 拆解 → ⚡ 执行 → 🔍 反思 → ✨ 综合
        <br/>
        <span style={{ color: 'var(--gray-300)' }}>(走 5 步画布节点流, 当前节点有动态效果)</span>
      </div>

      {/* 输入区 */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="写下要做什么..."
        style={S_TEXTAREA}
        onFocus={(e) => (e.target.style.borderColor = 'var(--warm)')}
        onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle)')}
      />
      {route && (
        <p style={{ fontSize: '11px', marginTop: '8px', color: route.target === 'hermes' ? 'var(--warm)' : '#888' }}>
          路由：{route.target === 'hermes' ? 'Hermes' : '本地'} · {route.reason}
        </p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleRun}
          disabled={!canRun}
          style={{ ...S_BTN_PRIMARY, cursor: canRun ? 'pointer' : 'not-allowed', opacity: canRun ? 1 : 0.4 }}
          onMouseEnter={(e) => { if (canRun) e.currentTarget.style.background = 'var(--warm-bg)' }}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >执行</button>
        <button
          onClick={() => setPrompt('')}
          disabled={!prompt}
          style={{ ...S_BTN_GHOST, cursor: prompt ? 'pointer' : 'not-allowed', opacity: prompt ? 1 : 0.4 }}
        >清空</button>
      </div>

      {/* 历史 */}
      <div className="mt-5">
        <div style={{ fontSize: '10px', letterSpacing: '0.15em', color: 'var(--gray-500)', marginBottom: '6px' }}>
          历史 ({tasks.length})
        </div>

        {tasks.length === 0 ? (
          <p style={{ fontSize: '11px', color: 'var(--gray-300)', padding: '8px 0' }}>还没有任务，写一句试试。</p>
        ) : tasks.map((t) => {
          const meta = STATUS_META[t.status] || STATUS_META.pending
          const dur = t.durationMs ? `${Math.round(t.durationMs / 1000)}s` : null
          const isExpanded = !!expanded[t.id]
          const full = t.result || ''
          const preview = full.length > 400 ? full.slice(0, 400) + ' ...' : full
          const promptShort = (t.prompt || '').length > 60 ? t.prompt.slice(0, 60) + '...' : t.prompt

          return (
            <div key={t.id} className="group" style={{ padding: '8px 0', borderBottom: '1px solid var(--gray-100)', position: 'relative' }}>
              {/* 顶行 */}
              <div className="flex items-center gap-2" style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
                <span style={{ color: meta.color, fontSize: '12px', animation: t.status === 'running' ? 'pulse 1.5s ease-in-out infinite' : 'none' }}>{meta.icon}</span>
                <span>{formatRelativeTime(t.createdAt)}</span>
                <span style={S_DOT}>·</span>
                <span style={{ color: t.target === 'hermes' ? 'var(--warm)' : '#888' }}>{t.target === 'hermes' ? 'Hermes' : '元认知'}</span>
                {dur && (<><span style={S_DOT}>·</span><span>{dur}</span></>)}
                {t.status === 'failed' && (<><span style={S_DOT}>·</span><span style={{ color: '#d27b7b' }}>失败</span></>)}
                <button
                  onClick={() => removeLocalTask(node.id, t.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ marginLeft: 'auto', color: 'var(--gray-500)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}
                  title="删除该任务"
                >×</button>
              </div>

              {/* prompt 预览 */}
              <p style={{ marginTop: '4px', fontSize: '12px', color: 'var(--dark)', lineHeight: 1.5 }}>{promptShort}</p>

              {/* 错误信息 */}
              {t.status === 'failed' && t.error && (
                <p style={{ marginTop: '4px', fontSize: '11px', color: 'var(--status-failed)', background: 'transparent', border: '1px solid var(--status-failed)', padding: '6px 8px', borderRadius: '3px' }}>{t.error}</p>
              )}

              {/* result 折叠/展开 */}
              {full && (
                <div style={{ marginTop: '4px' }}>
                  <button
                    onClick={() => setExpanded((s) => ({ ...s, [t.id]: !s[t.id] }))}
                    style={{ fontSize: '11px', color: 'var(--warm)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    {isExpanded ? '▾ 收起结果' : '▸ 查看结果'}
                  </button>
                  {isExpanded && <pre style={S_PRE}>{preview}</pre>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default RightPanel
