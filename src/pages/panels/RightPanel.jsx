/**
 * RightPanel - 概念详情与关系编辑面板
 * 功能：选中概念信息展示、关系列表、快速添加关系、分类分配
 */

import { useState } from 'react'

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
    }
    setNewTag('')
  }

  // 移除标签
  const handleRemoveTag = (tag) => {
    if (!selectedNode) return
    const currentTags = selectedNode.data?.tags || []
    onUpdateNode?.(selectedNode.id, { tags: currentTags.filter(t => t !== tag) })
  }

  // 设置分类
  const handleSetCategory = (categoryId) => {
    if (!selectedNode) return
    onUpdateNode?.(selectedNode.id, { category: categoryId })
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
    setRelationTarget('')
    setShowAddRelation(false)
  }

  // 无选中节点时的空状态
  if (!selectedNode) {
    return (
      <div className="w-80 h-full flex flex-col border-l" style={{ borderColor: 'var(--gray-100)', background: 'var(--white)' }}>
        <div className="px-5 pt-5 pb-3">
          <div className="section-label mb-2">02 / 详情</div>
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
    <div className="w-80 h-full flex flex-col border-l" style={{ borderColor: 'var(--gray-100)', background: 'var(--white)' }}>
      {/* 头部 */}
      <div className="px-5 pt-5 pb-3">
        <div className="section-label mb-2">02 / 详情</div>
        <h2 className="heading-serif text-base font-semibold" style={{ color: 'var(--black)' }}>
          概念详情
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
                      onClick={() => onRemoveEdge?.(edge.id)}
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

export default RightPanel
