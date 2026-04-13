/**
 * NodePropertyPanel - 节点属性编辑面板
 * 右键弹出，根据节点类型显示可编辑属性
 * 建筑极简风格
 */

import { memo, useState, useEffect } from 'react'

// 默认分类选项
const CATEGORIES = ['概念', '技术', '人物', '事件', '方法', '工具', '理论', '资源']

// 来源类型选项
const SOURCE_TYPES = [
  { value: 'file', label: '文件' },
  { value: 'web', label: '网页' },
  { value: 'note', label: '笔记' },
  { value: 'ai', label: 'AI生成' },
  { value: 'manual', label: '手动输入' },
]

// 通用输入框样式
const inputClass = "w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-1 transition-all"
const inputStyle = {
  borderColor: '#e8e8e8',
  color: '#2d2d2d',
  fontFamily: '"Noto Sans SC", system-ui, sans-serif',
}
const focusRingColor = '#c8a882'

function NodePropertyPanel({ node, position, onClose, onSave }) {
  const [formData, setFormData] = useState({})

  useEffect(() => {
    if (node) {
      setFormData({ ...node.data })
    }
  }, [node])

  if (!node) return null

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    if (onSave) {
      onSave(node.id, formData)
    } else {
      window.dispatchEvent(new CustomEvent('node-update', {
        detail: { nodeId: node.id, data: formData }
      }))
    }
    onClose()
  }

  // 标签编辑辅助
  const handleTagsChange = (value) => {
    const tags = value.split(/[,，\s]+/).filter(Boolean)
    handleChange('tags', tags)
  }

  // 根据节点类型渲染字段
  const renderFields = () => {
    switch (node.type) {
      case 'conceptNode':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>标题</label>
              <input
                type="text"
                value={formData.title || ''}
                onChange={(e) => handleChange('title', e.target.value)}
                className={inputClass}
                style={{ ...inputStyle, '--tw-ring-color': focusRingColor }}
                placeholder="概念名称"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>描述</label>
              <textarea
                value={formData.description || ''}
                onChange={(e) => handleChange('description', e.target.value)}
                rows={4}
                className={`${inputClass} resize-none`}
                style={{ ...inputStyle, '--tw-ring-color': focusRingColor }}
                placeholder="概念描述..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>分类</label>
              <select
                value={formData.category || ''}
                onChange={(e) => handleChange('category', e.target.value)}
                className={inputClass}
                style={inputStyle}
              >
                <option value="">未分类</option>
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>标签（逗号分隔）</label>
              <input
                type="text"
                value={(formData.tags || []).join(', ')}
                onChange={(e) => handleTagsChange(e.target.value)}
                className={inputClass}
                style={inputStyle}
                placeholder="标签1, 标签2, 标签3"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>来源</label>
              <input
                type="text"
                value={formData.source || ''}
                onChange={(e) => handleChange('source', e.target.value)}
                className={inputClass}
                style={inputStyle}
                placeholder="来源名称或链接"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>来源类型</label>
              <select
                value={formData.sourceType || 'manual'}
                onChange={(e) => handleChange('sourceType', e.target.value)}
                className={inputClass}
                style={inputStyle}
              >
                {SOURCE_TYPES.map(st => (
                  <option key={st.value} value={st.value}>{st.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>节点大小</label>
              <div className="flex gap-2">
                {[
                  { value: 'small', label: '小' },
                  { value: 'medium', label: '中' },
                  { value: 'large', label: '大' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleChange('size', option.value)}
                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors"
                    style={{
                      backgroundColor: (formData.size || 'medium') === option.value ? '#c8a882' : '#f5f0eb',
                      color: (formData.size || 'medium') === option.value ? '#fafafa' : '#888',
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )

      case 'categoryNode':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>分类名称</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => handleChange('name', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>颜色</label>
              <input
                type="color"
                value={formData.color || '#c8a882'}
                onChange={(e) => handleChange('color', e.target.value)}
                className="w-full h-8 rounded cursor-pointer"
              />
            </div>
          </div>
        )

      case 'bookmarkNode':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>链接地址</label>
              <input
                type="url"
                value={formData.url || ''}
                onChange={(e) => handleChange('url', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>标题</label>
              <input
                type="text"
                value={formData.title || ''}
                onChange={(e) => handleChange('title', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>描述</label>
              <textarea
                value={formData.description || ''}
                onChange={(e) => handleChange('description', e.target.value)}
                rows={3}
                className={`${inputClass} resize-none`}
                style={inputStyle}
              />
            </div>
          </div>
        )

      case 'videoNode':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>视频链接</label>
              <input
                type="url"
                value={formData.url || ''}
                onChange={(e) => handleChange('url', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>标题</label>
              <input
                type="text"
                value={formData.title || ''}
                onChange={(e) => handleChange('title', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>平台</label>
              <select
                value={formData.platform || 'other'}
                onChange={(e) => handleChange('platform', e.target.value)}
                className={inputClass}
                style={inputStyle}
              >
                <option value="youtube">YouTube</option>
                <option value="bilibili">Bilibili</option>
                <option value="local">本地</option>
                <option value="other">其他</option>
              </select>
            </div>
          </div>
        )

      case 'imageNode':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>图片地址</label>
              <input
                type="url"
                value={formData.src || ''}
                onChange={(e) => handleChange('src', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>说明文字</label>
              <input
                type="text"
                value={formData.alt || ''}
                onChange={(e) => handleChange('alt', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>
        )

      case 'noteNode':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>笔记内容</label>
              <textarea
                value={formData.content || ''}
                onChange={(e) => handleChange('content', e.target.value)}
                rows={6}
                className={`${inputClass} resize-none`}
                style={inputStyle}
                placeholder="输入笔记内容..."
              />
            </div>
          </div>
        )

      case 'fileNode':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>文件名</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => handleChange('name', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#888' }}>文件地址</label>
              <input
                type="url"
                value={formData.url || ''}
                onChange={(e) => handleChange('url', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>
        )

      default:
        return (
          <p className="text-sm" style={{ color: '#888' }}>此节点类型暂无可编辑属性。</p>
        )
    }
  }

  // 节点类型中文标签
  const getNodeTypeLabel = () => {
    const labels = {
      conceptNode: '概念',
      categoryNode: '分类',
      bookmarkNode: '链接',
      videoNode: '视频',
      imageNode: '图片',
      noteNode: '笔记',
      fileNode: '文件',
      groupNode: '分组',
    }
    return labels[node.type] || '节点'
  }

  return (
    <>
      {/* 背景遮罩 */}
      <div className="fixed inset-0 z-50" onClick={onClose} />

      {/* 面板 */}
      <div
        className="fixed z-50 w-[320px] max-h-[500px] overflow-hidden rounded-lg shadow-2xl"
        style={{
          left: position.x,
          top: position.y,
          backgroundColor: '#fafafa',
          border: '1px solid #e8e8e8',
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid #e8e8e8', backgroundColor: '#f5f0eb' }}
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" style={{ color: '#c8a882' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span className="text-sm font-medium" style={{ color: '#2d2d2d' }}>
              编辑{getNodeTypeLabel()}
            </span>
          </div>
          <button
            onClick={onClose}
            className="transition-colors hover:opacity-70"
            style={{ color: '#bbb' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容 */}
        <div className="p-4 max-h-[380px] overflow-y-auto">
          {renderFields()}
        </div>

        {/* 底部操作栏 */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid #e8e8e8', backgroundColor: '#f5f0eb' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{ color: '#888' }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{ backgroundColor: '#c8a882', color: '#fafafa' }}
          >
            保存
          </button>
        </div>
      </div>
    </>
  )
}

export default memo(NodePropertyPanel)
