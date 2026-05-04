/**
 * NodePropertyPanel - 节点属性编辑面板
 * 右键弹出，根据节点类型显示可编辑属性
 * 建筑极简风格
 */

import { memo, useState, useEffect } from 'react'
import useCanvasStore from '../../stores/useCanvasStore'

// 默认分类选项
const CATEGORIES = ['概念', '技术', '人物', '事件', '方法', '工具', '理论', '资源']

// 节点类型选项（"模块性质"），与 store 里 NODE_TYPES 对齐
const NODE_TYPE_OPTIONS = [
  { value: 'conceptNode', label: '概念', icon: '💡' },
  { value: 'noteNode', label: '笔记', icon: '📝' },
  { value: 'bookmarkNode', label: '链接', icon: '🔗' },
  { value: 'imageNode', label: '图片', icon: '🖼️' },
  { value: 'videoNode', label: '视频', icon: '🎬' },
  { value: 'fileNode', label: '文件', icon: '📎' },
  { value: 'categoryNode', label: '分类', icon: '🗂️' },
]

// 预设颜色（与 GroupNode 保持一致）
const PRESET_COLORS = [
  '#c8a882', '#7c9eb2', '#8b9e7c', '#9e7cb2',
  '#b27c8b', '#7cb2a8', '#b2917c', '#a8a87c',
  '#888888', '#1a1a1a',
]

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
  const [pushingNotion, setPushingNotion] = useState(false)
  const [pushingFeishu, setPushingFeishu] = useState(false)

  useEffect(() => {
    if (node) {
      setFormData({ ...node.data })
    }
  }, [node])

  // 推送当前节点到飞书群 (custom robot webhook)
  // 首次使用提示输入 webhook URL + 自定义关键词, 存 localStorage 复用
  const handlePushToFeishuChat = async () => {
    if (!node || pushingFeishu) return
    let webhookUrl = localStorage.getItem('feishuWebhookUrl') || ''
    let keyword = localStorage.getItem('feishuWebhookKeyword') || ''
    // 首次或长按 shift 改 — 让用户输入
    const needConfig = !webhookUrl || (typeof window !== 'undefined' && window.event?.shiftKey)
    if (needConfig) {
      const url = window.prompt(
        '飞书自定义机器人 webhook URL\n(群设置 → 群机器人 → 自定义机器人 → 复制 URL)',
        webhookUrl,
      )
      if (!url) return
      webhookUrl = url.trim()
      const kw = window.prompt('自定义关键词 (机器人安全设置里填的, 留空 = 不补)', keyword || 'know-canvas')
      keyword = (kw || '').trim()
      localStorage.setItem('feishuWebhookUrl', webhookUrl)
      localStorage.setItem('feishuWebhookKeyword', keyword)
    }
    setPushingFeishu(true)
    try {
      await useCanvasStore.getState().pushNodeToFeishuChat(node.id, { webhookUrl, keyword })
      // 静默成功 — 群里能看到, 不弹 confirm
      const flash = document.createElement('div')
      flash.textContent = '✓ 已发到飞书群'
      flash.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:8px 16px;border-radius:4px;z-index:9999;font-size:12px;'
      document.body.appendChild(flash)
      setTimeout(() => flash.remove(), 2000)
    } catch (err) {
      console.error('[feishu-push]', err)
      alert(`推送飞书群失败:\n${err?.message || err}\n\n按住 Shift 点按钮可重新配置 webhook URL`)
    } finally {
      setPushingFeishu(false)
    }
  }

  // 推送当前节点到 Notion (默认 AI学习库)
  const handlePushToNotion = async () => {
    if (!node || pushingNotion) return
    setPushingNotion(true)
    try {
      const r = await useCanvasStore.getState().pushNodeToNotion(node.id, { includeChildren: true })
      // 成功 — 弹个非阻塞 toast 并尝试打开 Notion 页面
      const open = window.confirm(`已推送到 Notion ✓\n\n标题: ${r.pageId.slice(0, 8)}...\n\n点 OK 在新标签打开 Notion 页面`)
      if (open && r.pageUrl) window.open(r.pageUrl, '_blank')
    } catch (err) {
      console.error('[notion-push]', err)
      alert(`推送 Notion 失败:\n${err?.message || err}\n\n常见原因:\n1. NOTION_TOKEN 未配置 (VPS systemd / 本地 .env)\n2. integration 没邀到目标数据库 (默认 AI学习库)\n3. 数据库 title 属性名异常`)
    } finally {
      setPushingNotion(false)
    }
  }

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

  // 切换节点类型（"模块性质修改"）
  const handleChangeType = (newType) => {
    if (newType === node.type) return
    window.dispatchEvent(new CustomEvent('node-change-type', {
      detail: { nodeId: node.id, newType, currentData: formData }
    }))
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
        <div className="p-4 max-h-[380px] overflow-y-auto space-y-4">
          {/* 通用：类型切换 + 颜色 */}
          {node.type !== 'groupNode' && (
            <div className="space-y-3 pb-3" style={{ borderBottom: '1px dashed #e8e8e8' }}>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#888' }}>模块性质</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {NODE_TYPE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleChangeType(opt.value)}
                      className="flex flex-col items-center gap-0.5 py-1.5 rounded-md text-[11px] transition-colors"
                      style={{
                        backgroundColor: node.type === opt.value ? '#c8a882' : '#f5f0eb',
                        color: node.type === opt.value ? '#fafafa' : '#888',
                      }}
                      title={`切换为${opt.label}`}
                    >
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#888' }}>颜色</label>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {PRESET_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => handleChange('color', color)}
                        className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                        style={{
                          backgroundColor: color,
                          border: formData.color === color ? '2px solid #2d2d2d' : '1px solid #e8e8e8',
                        }}
                        title={color}
                      />
                    ))}
                  </div>
                  <input
                    type="color"
                    value={formData.color || '#c8a882'}
                    onChange={(e) => handleChange('color', e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer"
                    title="自定义颜色"
                  />
                </div>
              </div>
            </div>
          )}

          {renderFields()}
        </div>

        {/* 底部操作栏 */}
        <div
          className="flex items-center justify-between gap-2 px-4 py-3"
          style={{ borderTop: '1px solid #e8e8e8', backgroundColor: '#f5f0eb' }}
        >
          {/* 左侧 — 跨平台推送 */}
          <div className="flex items-center gap-1">
            <button
              onClick={handlePushToNotion}
              disabled={pushingNotion}
              className="px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
              style={{
                backgroundColor: pushingNotion ? '#e8e8e8' : 'rgba(0,0,0,0.04)',
                color: pushingNotion ? '#888' : '#2d2d2d',
                cursor: pushingNotion ? 'wait' : 'pointer',
              }}
              title="推送当前节点（含子节点）到 Notion 默认数据库 (AI学习库)"
            >
              <span>{pushingNotion ? '⟳' : '↗'}</span>
              <span>{pushingNotion ? '推送中' : '推 Notion'}</span>
            </button>
            <button
              onClick={handlePushToFeishuChat}
              disabled={pushingFeishu}
              className="px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
              style={{
                backgroundColor: pushingFeishu ? '#e8e8e8' : 'rgba(0,0,0,0.04)',
                color: pushingFeishu ? '#888' : '#2d2d2d',
                cursor: pushingFeishu ? 'wait' : 'pointer',
              }}
              title="推送当前节点摘要到飞书群 (自定义机器人 webhook). 首次会问你 URL + 关键词. Shift+点击重新配置"
            >
              <span>{pushingFeishu ? '⟳' : '💬'}</span>
              <span>{pushingFeishu ? '推送中' : '推飞书群'}</span>
            </button>
          </div>
          {/* 右侧 — 取消 / 保存 */}
          <div className="flex items-center gap-2">
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
      </div>
    </>
  )
}

export default memo(NodePropertyPanel)
