/**
 * SelectionToolbar - 多选浮动工具栏
 * 当选中多个节点时显示批量操作：分组、连接、标记、删除、批量分类、批量标签
 * 建筑极简风格
 */

import { memo, useState } from 'react'

// 知识关系类型 (语义色: 关系类型色板, 不随主题切换)
const RELATION_TYPES = {
  causal: { id: 'causal', label: '因果', color: '#c8a882' },
  compose: { id: 'compose', label: '组成', color: '#7c9eb2' },
  depend: { id: 'depend', label: '依赖', color: '#8b9e7c' },
  similar: { id: 'similar', label: '相似', color: '#9e7cb2' },
  contrast: { id: 'contrast', label: '对比', color: '#b27c8b' },
  derive: { id: 'derive', label: '派生', color: '#7cb2a8' },
  reference: { id: 'reference', label: '引用', color: '#b2917c' },
  sequence: { id: 'sequence', label: '顺序', color: '#a8a87c' },
}

// 标记颜色 (语义色: 用户自选标记色板, 不随主题切换)
const MARK_COLORS = [
  { color: '#c8a882', name: '暖色' },
  { color: '#b27c8b', name: '粉灰' },
  { color: '#8b9e7c', name: '绿灰' },
  { color: '#7c9eb2', name: '蓝灰' },
  { color: '#9e7cb2', name: '紫灰' },
  { color: '#b2917c', name: '棕灰' },
]

// 默认分类列表
const CATEGORIES = ['概念', '技术', '人物', '事件', '方法', '工具', '理论', '资源']

function SelectionToolbar({ selectedCount, position, onAction }) {
  const [showLinkMenu, setShowLinkMenu] = useState(false)
  const [showMarkMenu, setShowMarkMenu] = useState(false)
  const [showCategoryMenu, setShowCategoryMenu] = useState(false)
  const [showTagInput, setShowTagInput] = useState(false)
  const [showAdvanceMenu, setShowAdvanceMenu] = useState(false)
  const [tagInput, setTagInput] = useState('')

  if (selectedCount < 2) return null

  // 通用操作分发
  const dispatch = (action, payload) => {
    if (onAction) {
      onAction(action, payload)
    } else {
      window.dispatchEvent(new CustomEvent('selection-action', {
        detail: { action, ...payload }
      }))
    }
  }

  const handleCreateGroup = () => {
    const groupName = prompt('分组名称（留空使用默认）:', '')
    dispatch('createGroup', { name: groupName || '' })
  }

  const handleDelete = () => {
    dispatch('deleteSelected', {})
  }

  const handleBatchCategory = (category) => {
    dispatch('batchSetCategory', { category })
    setShowCategoryMenu(false)
  }

  const handleBatchTag = () => {
    if (tagInput.trim()) {
      const tags = tagInput.split(/[,，\s]+/).filter(Boolean)
      dispatch('batchAddTags', { tags })
      setTagInput('')
      setShowTagInput(false)
    }
  }

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter') handleBatchTag()
    if (e.key === 'Escape') setShowTagInput(false)
  }

  const closeAllMenus = () => {
    setShowLinkMenu(false)
    setShowMarkMenu(false)
    setShowCategoryMenu(false)
    setShowTagInput(false)
    setShowAdvanceMenu(false)
  }

  const handleGroupMeta = () => {
    closeAllMenus()
    dispatch('groupAnalyzeMeta', {})
  }

  const handleBatchAdvance = (mode) => {
    closeAllMenus()
    dispatch('batchAdvance', { mode })
  }

  // 按钮通用样式
  const btnClass = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-300"

  return (
    <div
      className="absolute z-50 rounded-lg shadow-lg p-2"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translateX(-50%)',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border-subtle)',
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
      }}
    >
      <div className="flex items-center gap-1 flex-wrap">
        {/* 选中数量 */}
        <div
          className="px-2 py-1 rounded-lg text-sm font-medium mr-2"
          style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}
        >
          {selectedCount} 已选
        </div>

        {/* 组合元认知分析 — 把选中节点当一个系统看, 生成新组合分析节点 */}
        <button
          onClick={handleGroupMeta}
          className={btnClass}
          style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)', fontWeight: 500 }}
          title="组合元认知分析: 把选中的节点当成一个系统, LLM 生成 5 维度组合分析新节点"
        >
          <span>🧠</span>
          <span>组合分析</span>
        </button>

        {/* 自动排列 — 横排 / 竖排 / 九宫格 */}
        <button
          onClick={() => { closeAllMenus(); dispatch('arrangeSelected', { mode: 'horizontal' }) }}
          className={btnClass}
          style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}
          title="把选中节点横向等距排列"
        >
          <span>⇿</span>
          <span>横排</span>
        </button>
        <button
          onClick={() => { closeAllMenus(); dispatch('arrangeSelected', { mode: 'vertical' }) }}
          className={btnClass}
          style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}
          title="把选中节点竖向等距排列"
        >
          <span>⇕</span>
          <span>竖排</span>
        </button>
        <button
          onClick={() => { closeAllMenus(); dispatch('arrangeSelected', { mode: 'grid' }) }}
          className={btnClass}
          style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}
          title="把选中节点排成 ceil(√N)×ceil(√N) 网格 (九宫格风格)"
        >
          <span>⊞</span>
          <span>九宫格</span>
        </button>

        {/* 批量推进 — 对每个选中节点并发跑同一种推进动作 */}
        <div className="relative">
          <button
            onClick={() => { closeAllMenus(); setShowAdvanceMenu(!showAdvanceMenu) }}
            className={btnClass}
            style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)', fontWeight: 500 }}
            title="批量推进: 对每个选中节点跑同一动作"
          >
            <span>🚀</span>
            <span>批量推进</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showAdvanceMenu && (
            <div
              className="absolute top-full left-0 mt-1 rounded-lg shadow-xl py-2 min-w-[180px] z-60"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="px-3 py-1 text-xs font-medium" style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}>
                选择批量动作 ({selectedCount} 个节点)
              </div>
              <button
                onClick={() => handleBatchAdvance('analyze')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                style={{ color: 'var(--accent)' }}
                title="并发对每个节点单独做元认知分析"
              >
                <span>⚡</span>
                <span>批量元认知</span>
              </button>
              <button
                onClick={() => handleBatchAdvance('decompose')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                style={{ color: 'var(--accent)' }}
                title="把每个 OntologyNode 拆成子节点 (跳过普通概念节点)"
              >
                <span>🔧</span>
                <span>批量拆解 (仅本体节点)</span>
              </button>
              <button
                onClick={() => handleBatchAdvance('promote')}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                style={{ color: 'var(--accent)' }}
                title="把每个 OntologyNode 派给 Hermes (跳过普通概念节点)"
              >
                <span>🚀</span>
                <span>批量派 Hermes (仅本体节点)</span>
              </button>
            </div>
          )}
        </div>

        {/* 分隔 */}
        <div className="w-px h-6 mx-1" style={{ backgroundColor: 'var(--border-subtle)' }} />

        {/* 创建分组 */}
        <button
          onClick={handleCreateGroup}
          className={btnClass}
          style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}
          title="创建分组"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span>分组</span>
        </button>

        {/* 连接按钮 */}
        <div className="relative">
          <button
            onClick={() => { closeAllMenus(); setShowLinkMenu(!showLinkMenu) }}
            className={btnClass}
            style={{ backgroundColor: 'var(--accent-bg)', color: '#7c9eb2' }}
            title="连接节点"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>连接</span>
          </button>

          {showLinkMenu && (
            <div
              className="absolute top-full left-0 mt-1 rounded-lg shadow-xl py-2 min-w-[160px] z-60"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="px-3 py-1 text-xs font-medium" style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}>选择关系类型</div>
              {Object.values(RELATION_TYPES).map((relation) => (
                <button
                  key={relation.id}
                  onClick={() => {
                    dispatch('linkSelected', { relationType: relation.id })
                    setShowLinkMenu(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <span className="w-4 h-0.5 flex-shrink-0" style={{ backgroundColor: relation.color }} />
                  <span style={{ color: relation.color }}>{relation.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 标记按钮 */}
        <div className="relative">
          <button
            onClick={() => { closeAllMenus(); setShowMarkMenu(!showMarkMenu) }}
            className={btnClass}
            style={{ backgroundColor: 'var(--accent-bg)', color: '#b2917c' }}
            title="标记颜色"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <span>标记</span>
          </button>

          {showMarkMenu && (
            <div
              className="absolute top-full left-0 mt-1 rounded-lg shadow-xl py-2 min-w-[140px] z-60"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="px-3 py-1 text-xs font-medium" style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}>选择颜色</div>
              <div className="flex flex-wrap gap-2 px-3 py-2">
                {MARK_COLORS.map((item) => (
                  <button
                    key={item.color}
                    onClick={() => {
                      dispatch('markSelected', { color: item.color })
                      setShowMarkMenu(false)
                    }}
                    className="w-7 h-7 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-transform"
                    style={{ backgroundColor: item.color }}
                    title={item.name}
                  />
                ))}
              </div>
              <button
                onClick={() => {
                  dispatch('clearMarks', {})
                  setShowMarkMenu(false)
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                style={{ color: 'var(--text-muted)' }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>清除标记</span>
              </button>
            </div>
          )}
        </div>

        {/* 分隔线 */}
        <div className="w-px h-6 mx-1" style={{ backgroundColor: 'var(--border-subtle)' }} />

        {/* 批量设置分类 */}
        <div className="relative">
          <button
            onClick={() => { closeAllMenus(); setShowCategoryMenu(!showCategoryMenu) }}
            className={btnClass}
            style={{ backgroundColor: 'var(--accent-bg)', color: '#9e7cb2' }}
            title="批量设置分类"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <span>分类</span>
          </button>

          {showCategoryMenu && (
            <div
              className="absolute top-full left-0 mt-1 rounded-lg shadow-xl py-2 min-w-[120px] z-60"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="px-3 py-1 text-xs font-medium" style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}>选择分类</div>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => handleBatchCategory(cat)}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 批量添加标签 */}
        <div className="relative">
          <button
            onClick={() => { closeAllMenus(); setShowTagInput(!showTagInput) }}
            className={btnClass}
            style={{ backgroundColor: 'var(--accent-bg)', color: '#7cb2a8' }}
            title="批量添加标签"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span>标签</span>
          </button>

          {showTagInput && (
            <div
              className="absolute top-full left-0 mt-1 rounded-lg shadow-xl p-3 min-w-[220px] z-60"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}>
                输入标签（逗号分隔）
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  autoFocus
                  placeholder="标签1, 标签2..."
                  className="flex-1 px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1"
                  style={{
                    borderColor: 'var(--accent-soft)',
                    color: 'var(--text-secondary)',
                    ringColor: 'var(--accent)',
                    fontFamily: '"Noto Sans SC", system-ui, sans-serif',
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  onClick={handleBatchTag}
                  className="px-3 py-1.5 text-sm font-medium rounded"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
                >
                  添加
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 分隔线 */}
        <div className="w-px h-6 mx-1" style={{ backgroundColor: 'var(--border-subtle)' }} />

        {/* 删除按钮: severity-high 粉灰 (跨主题保持警示语义) */}
        <button
          onClick={handleDelete}
          className={btnClass}
          style={{ backgroundColor: '#fef2f2', color: '#b27c8b' }}
          title="删除选中节点"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>删除</span>
        </button>
      </div>

      {/* 点击遮罩关闭下拉菜单 */}
      {(showLinkMenu || showMarkMenu || showCategoryMenu || showTagInput || showAdvanceMenu) && (
        <div className="fixed inset-0 z-50" onClick={closeAllMenus} />
      )}
    </div>
  )
}

export default memo(SelectionToolbar)
