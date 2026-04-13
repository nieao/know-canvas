/**
 * LeftPanel - 知识源管理面板
 * 功能：文件导入、URL 导入、文本片段输入、知识源列表管理
 */

import { useState, useRef } from 'react'

// 文件类型图标映射
const FILE_ICONS = {
  md: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  txt: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  json: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  csv: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  url: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  ),
  text: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  ),
}

// 分类选项
const CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'file', label: '文件' },
  { id: 'url', label: '链接' },
  { id: 'text', label: '文本' },
]

function LeftPanel({ sources = [], onAddSource, onRemoveSource, onSelectSource, onDragConcept }) {
  const [activeTab, setActiveTab] = useState('sources') // 'sources' | 'import'
  const [urlInput, setUrlInput] = useState('')
  const [textInput, setTextInput] = useState('')
  const [textTitle, setTextTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const fileInputRef = useRef(null)

  // 处理文件导入
  const handleFileImport = async (e) => {
    const files = Array.from(e.target.files || [])
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase()
      if (!['md', 'txt', 'json', 'csv'].includes(ext)) {
        continue
      }
      const content = await file.text()
      onAddSource?.({
        id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'file',
        name: file.name,
        ext,
        content,
        addedAt: new Date().toISOString(),
      })
    }
    // 重置
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // 处理 URL 导入
  const handleUrlImport = () => {
    if (!urlInput.trim()) return
    onAddSource?.({
      id: `url_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'url',
      name: urlInput.trim(),
      ext: 'url',
      content: '',
      url: urlInput.trim(),
      addedAt: new Date().toISOString(),
    })
    setUrlInput('')
  }

  // 处理文本片段导入
  const handleTextImport = () => {
    if (!textInput.trim()) return
    onAddSource?.({
      id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'text',
      name: textTitle.trim() || `文本片段 ${new Date().toLocaleTimeString()}`,
      ext: 'text',
      content: textInput.trim(),
      addedAt: new Date().toISOString(),
    })
    setTextInput('')
    setTextTitle('')
  }

  // 过滤和搜索
  const filteredSources = sources.filter(s => {
    if (categoryFilter !== 'all' && s.type !== categoryFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.content?.toLowerCase().includes(q)
    }
    return true
  })

  // 拖拽开始
  const handleDragStart = (e, source) => {
    e.dataTransfer.setData('application/know-canvas-source', JSON.stringify(source))
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="w-64 h-full flex flex-col border-r border-fine" style={{ borderColor: 'var(--gray-100)', background: 'var(--white)' }}>
      {/* 面板头部 */}
      <div className="px-4 pt-5 pb-3">
        <div className="section-label mb-2">01 / 知识源</div>
        <h2 className="heading-serif text-base font-semibold" style={{ color: 'var(--black)' }}>
          知识管理
        </h2>
      </div>

      {/* 标签切换 */}
      <div className="flex border-b" style={{ borderColor: 'var(--gray-100)' }}>
        <button
          onClick={() => setActiveTab('sources')}
          className="flex-1 py-2.5 text-xs tracking-wider transition-all duration-300"
          style={{
            color: activeTab === 'sources' ? 'var(--warm)' : 'var(--gray-500)',
            borderBottom: activeTab === 'sources' ? '2px solid var(--warm)' : '2px solid transparent',
            fontFamily: 'var(--font-sans)',
          }}
        >
          知识源列表
        </button>
        <button
          onClick={() => setActiveTab('import')}
          className="flex-1 py-2.5 text-xs tracking-wider transition-all duration-300"
          style={{
            color: activeTab === 'import' ? 'var(--warm)' : 'var(--gray-500)',
            borderBottom: activeTab === 'import' ? '2px solid var(--warm)' : '2px solid transparent',
            fontFamily: 'var(--font-sans)',
          }}
        >
          导入
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'sources' ? (
          <div className="p-3 space-y-3">
            {/* 搜索框 */}
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--gray-500)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索知识源..."
                className="w-full pl-8 pr-3 py-2 text-xs rounded-md transition-all duration-300 focus:outline-none"
                style={{
                  border: '1px solid var(--gray-100)',
                  background: 'var(--white)',
                  color: 'var(--dark)',
                  fontFamily: 'var(--font-sans)',
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--warm)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--gray-100)'}
              />
            </div>

            {/* 分类过滤 */}
            <div className="flex gap-1">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCategoryFilter(cat.id)}
                  className="px-2.5 py-1 text-[10px] rounded-full transition-all duration-300"
                  style={{
                    background: categoryFilter === cat.id ? 'var(--warm-bg)' : 'transparent',
                    color: categoryFilter === cat.id ? 'var(--warm)' : 'var(--gray-500)',
                    border: `1px solid ${categoryFilter === cat.id ? 'var(--warm-light)' : 'var(--gray-100)'}`,
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* 知识源列表 */}
            {filteredSources.length === 0 ? (
              <div className="py-8 text-center" style={{ color: 'var(--gray-500)' }}>
                <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="text-xs">暂无知识源</p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--gray-300)' }}>
                  切换到「导入」标签添加
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredSources.map(source => (
                  <div
                    key={source.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, source)}
                    onClick={() => onSelectSource?.(source)}
                    className="group flex items-center gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-all duration-300 warm-top-line overflow-hidden"
                    style={{
                      border: '1px solid var(--gray-100)',
                      background: 'var(--white)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--warm-light)'
                      e.currentTarget.style.background = 'var(--warm-bg)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--gray-100)'
                      e.currentTarget.style.background = 'var(--white)'
                    }}
                  >
                    {/* 类型图标 */}
                    <div className="flex-shrink-0" style={{ color: 'var(--warm)' }}>
                      {FILE_ICONS[source.ext] || FILE_ICONS.text}
                    </div>
                    {/* 名称 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate" style={{ color: 'var(--dark)' }}>
                        {source.name}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--gray-500)' }}>
                        {source.type === 'file' ? source.ext.toUpperCase() : source.type === 'url' ? '链接' : '文本'}
                      </p>
                    </div>
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemoveSource?.(source.id) }}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded transition-all duration-300"
                      style={{ color: 'var(--gray-500)' }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--black)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--gray-500)'}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* 导入面板 */
          <div className="p-3 space-y-4">
            {/* 文件导入 */}
            <div>
              <div className="section-label mb-2" style={{ fontSize: '0.65rem' }}>文件导入</div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-6 rounded-md border-dashed cursor-pointer transition-all duration-300 flex flex-col items-center gap-2"
                style={{
                  border: '2px dashed var(--gray-100)',
                  color: 'var(--gray-500)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--warm)'
                  e.currentTarget.style.color = 'var(--warm)'
                  e.currentTarget.style.background = 'var(--warm-bg)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--gray-100)'
                  e.currentTarget.style.color = 'var(--gray-500)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="text-xs">点击或拖拽文件到此处</span>
                <span className="text-[10px]" style={{ color: 'var(--gray-300)' }}>
                  支持 MD, TXT, JSON, CSV
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.json,.csv"
                multiple
                onChange={handleFileImport}
                className="hidden"
              />
            </div>

            {/* URL 导入 */}
            <div>
              <div className="section-label mb-2" style={{ fontSize: '0.65rem' }}>链接导入</div>
              <div className="flex gap-1.5">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="输入网址..."
                  className="flex-1 px-3 py-2 text-xs rounded-md transition-all duration-300 focus:outline-none"
                  style={{
                    border: '1px solid var(--gray-100)',
                    color: 'var(--dark)',
                    fontFamily: 'var(--font-sans)',
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--warm)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--gray-100)'}
                  onKeyDown={(e) => e.key === 'Enter' && handleUrlImport()}
                />
                <button
                  onClick={handleUrlImport}
                  disabled={!urlInput.trim()}
                  className="px-3 py-2 text-xs rounded-md transition-all duration-300"
                  style={{
                    background: urlInput.trim() ? 'var(--warm)' : 'var(--gray-100)',
                    color: urlInput.trim() ? 'white' : 'var(--gray-500)',
                  }}
                >
                  添加
                </button>
              </div>
            </div>

            {/* 文本片段导入 */}
            <div>
              <div className="section-label mb-2" style={{ fontSize: '0.65rem' }}>文本片段</div>
              <input
                type="text"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                placeholder="标题（可选）"
                className="w-full px-3 py-2 text-xs rounded-md mb-1.5 transition-all duration-300 focus:outline-none"
                style={{
                  border: '1px solid var(--gray-100)',
                  color: 'var(--dark)',
                  fontFamily: 'var(--font-sans)',
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--warm)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--gray-100)'}
              />
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="粘贴或输入文本内容..."
                rows={4}
                className="w-full px-3 py-2 text-xs rounded-md resize-none transition-all duration-300 focus:outline-none"
                style={{
                  border: '1px solid var(--gray-100)',
                  color: 'var(--dark)',
                  fontFamily: 'var(--font-sans)',
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--warm)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--gray-100)'}
              />
              <button
                onClick={handleTextImport}
                disabled={!textInput.trim()}
                className="w-full mt-1.5 py-2 text-xs rounded-md transition-all duration-300"
                style={{
                  background: textInput.trim() ? 'var(--warm)' : 'var(--gray-100)',
                  color: textInput.trim() ? 'white' : 'var(--gray-500)',
                }}
              >
                添加文本片段
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部统计 */}
      <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--gray-100)' }}>
        <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--gray-500)' }}>
          <span>{sources.length} 个知识源</span>
          <span style={{ color: 'var(--warm)' }}>
            {sources.filter(s => s.type === 'file').length} 文件 / {sources.filter(s => s.type === 'url').length} 链接 / {sources.filter(s => s.type === 'text').length} 文本
          </span>
        </div>
      </div>
    </div>
  )
}

export default LeftPanel
