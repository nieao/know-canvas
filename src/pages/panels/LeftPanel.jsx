/**
 * LeftPanel - 知识库主壳 (4-Tab IA)
 *
 * 4 个 tab:
 *   - projects (默认) — 渲染 ProjectsLibraryTab, 已保存项目卡片列表
 *   - nodes            — 渲染 NodesLibrary, 当前画布节点
 *   - history          — 渲染 HistoryLibrary, 操作 / 任务日志
 *   - import           — sources 列表 + 三种导入(文件/URL/文本片段)
 *
 * Props (KnowledgeGraph 传入):
 *   sources, onAddSource, onRemoveSource, onSelectSource, onDragConcept (老 contract, 不变)
 *   onLoadProject(project)?    新增, 项目卡片"载入"回调
 *   onFocusNode(nodeId)?       新增, 节点卡片"聚焦"回调
 */

import { useState, useRef, useMemo, useEffect } from 'react'
import { logAction } from '../../utils/actionLog'
import NodesLibrary from '../../components/library/NodesLibrary'
import HistoryLibrary from '../../components/library/HistoryLibrary'
import ProjectsLibraryTab from '../../components/library/ProjectsLibraryTab'
import useCanvasStore from '../../stores/useCanvasStore'
import useProjectLibraryStore from '../../stores/useProjectLibraryStore'
import { onAppend, getAll as getAllLogs } from '../../utils/logBus'

// 文件类型图标映射 (导入 tab 用)
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

// 分类选项 (导入 tab 用)
const CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'file', label: '文件' },
  { id: 'url', label: '链接' },
  { id: 'text', label: '文本' },
]

// 4 个 tab 定义
const TABS = [
  { id: 'projects', label: '项目' },
  { id: 'nodes', label: '节点' },
  { id: 'history', label: '历史' },
  { id: 'import', label: '导入' },
]

const FONT_SERIF = '"Noto Serif SC", Georgia, serif'
const FONT_SANS = '"Noto Sans SC", system-ui, sans-serif'

function LeftPanel({
  sources = [],
  onAddSource,
  onRemoveSource,
  onSelectSource,
  onDragConcept,
  onLoadProject,
  onFocusNode,
}) {
  const [activeTab, setActiveTab] = useState('projects')

  // === Import tab 本地状态 ===
  const [urlInput, setUrlInput] = useState('')
  const [textInput, setTextInput] = useState('')
  const [textTitle, setTextTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const fileInputRef = useRef(null)

  // === Counts (badge 数据源) ===
  const projectCount = useProjectLibraryStore((s) => s.projects?.length || 0)
  const nodeCount = useCanvasStore((s) => s.nodes?.length || 0)

  // 日志 count: logBus 是 ring buffer, 订阅 onAppend 触发 rerender
  // 注意: pushLog 是同步广播 listeners, 如果在其他组件 (EdgeRenderer / React Flow 内部
  // console.warn 经 attachConsoleBridge) 渲染期间触发 pushLog, 同步 setState 会引发
  // "Cannot update a component while rendering a different component" 警告。
  // 解决: 用 queueMicrotask 把 setState 推迟到当前渲染栈之外, 同时合并同一 tick 内的
  // 多次 append 为一次 rerender。
  const [logTick, setLogTick] = useState(0)
  useEffect(() => {
    let scheduled = false
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        setLogTick((t) => (t + 1) & 0xffff)
      })
    }
    const unsub = onAppend(schedule)
    return () => unsub && unsub()
  }, [])
  const logCount = useMemo(() => getAllLogs().length, [logTick])

  const sourceCount = sources.length

  const counts = {
    projects: projectCount,
    nodes: nodeCount,
    history: logCount,
    import: sourceCount,
  }

  // === Import tab handlers ===
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
      logAction('leftpanel.addSource', { name: file.name, ext, size: file.size })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

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
    logAction('leftpanel.addSource', { name: urlInput.trim(), ext: 'url', size: 0 })
    setUrlInput('')
  }

  // 飞书 — 两种模式: 'url' 直接粘 URL / 'search' 搜索后点击导入
  const [feishuMode, setFeishuMode] = useState('search') // 'search' | 'url'
  const [feishuUrl, setFeishuUrl] = useState('')
  const [feishuQuery, setFeishuQuery] = useState('')
  const [feishuResults, setFeishuResults] = useState([]) // [{title,summary,url,owner,...}]
  const [feishuLoading, setFeishuLoading] = useState(false)
  const [feishuImportingUrl, setFeishuImportingUrl] = useState('') // 标记正在导入哪一条

  const handleFeishuSearch = async () => {
    const q = feishuQuery.trim()
    if (!q) return
    setFeishuLoading(true)
    setFeishuResults([])
    try {
      const store = useCanvasStore.getState()
      const r = await store.searchFeishu(q, 10)
      setFeishuResults(r.results || [])
      logAction('leftpanel.searchFeishu', { query: q, count: r.results?.length || 0 })
    } catch (err) {
      console.error('[leftpanel] feishu search failed:', err)
      alert(`飞书搜索失败:\n${err?.message || err}`)
    } finally {
      setFeishuLoading(false)
    }
  }

  const handleFeishuImport = async (urlOverride) => {
    const url = (urlOverride || feishuUrl).trim()
    if (!url) return
    setFeishuImportingUrl(url)
    if (!urlOverride) setFeishuLoading(true)
    try {
      const store = useCanvasStore.getState()
      const r = await store.importFromFeishuUrl(url)
      logAction('leftpanel.importFeishu', { url, title: r.title, contentLength: r.contentLength })
      if (!urlOverride) setFeishuUrl('')
    } catch (err) {
      console.error('[leftpanel] feishu import failed:', err)
      alert(`飞书文档导入失败:\n${err?.message || err}\n\n常见原因:\n1. source-proxy daemon 未启动 (npm run sourceproxy 起 17090)\n2. lark-cli 未登录 (lark-cli auth login --as user)\n3. 文档没权限访问`)
    } finally {
      setFeishuImportingUrl('')
      if (!urlOverride) setFeishuLoading(false)
    }
  }

  // Notion — 同款搜索 + URL 双模式
  const [notionMode, setNotionMode] = useState('search')
  const [notionUrl, setNotionUrl] = useState('')
  const [notionQuery, setNotionQuery] = useState('')
  const [notionResults, setNotionResults] = useState([])
  const [notionLoading, setNotionLoading] = useState(false)
  const [notionImportingUrl, setNotionImportingUrl] = useState('')

  const handleNotionSearch = async () => {
    const q = notionQuery.trim()
    if (!q) return
    setNotionLoading(true)
    setNotionResults([])
    try {
      const store = useCanvasStore.getState()
      const r = await store.searchNotion(q, 10)
      setNotionResults(r.results || [])
      logAction('leftpanel.searchNotion', { query: q, count: r.results?.length || 0 })
    } catch (err) {
      console.error('[leftpanel] notion search failed:', err)
      alert(`Notion 搜索失败:\n${err?.message || err}`)
    } finally {
      setNotionLoading(false)
    }
  }

  const handleNotionImport = async (urlOverride) => {
    const url = (urlOverride || notionUrl).trim()
    if (!url) return
    setNotionImportingUrl(url)
    if (!urlOverride) setNotionLoading(true)
    try {
      const store = useCanvasStore.getState()
      const r = await store.importFromNotionUrl(url)
      logAction('leftpanel.importNotion', { url, title: r.title, contentLength: r.contentLength })
      if (!urlOverride) setNotionUrl('')
    } catch (err) {
      console.error('[leftpanel] notion import failed:', err)
      alert(`Notion 导入失败:\n${err?.message || err}\n\n常见原因:\n1. NOTION_TOKEN 未配置 (VPS systemd / 本地 .env)\n2. integration 未邀到目标页面 (Notion 页面右上 share → invite integration)`)
    } finally {
      setNotionImportingUrl('')
      if (!urlOverride) setNotionLoading(false)
    }
  }

  // 得到笔记 — 三 mode: list 最近 N / search 关键词 / id 直接导入
  const [getnoteMode, setGetnoteMode] = useState('list')
  const [getnoteId, setGetnoteId] = useState('')
  const [getnoteQuery, setGetnoteQuery] = useState('')
  const [getnoteResults, setGetnoteResults] = useState([])
  const [getnoteLoading, setGetnoteLoading] = useState(false)
  const [getnoteImportingId, setGetnoteImportingId] = useState('')

  const handleGetnoteList = async () => {
    setGetnoteLoading(true)
    setGetnoteResults([])
    try {
      const r = await useCanvasStore.getState().listGetnote(15)
      setGetnoteResults(r.results || [])
      logAction('leftpanel.listGetnote', { count: r.results?.length || 0 })
    } catch (err) {
      alert(`得到笔记拉取失败:\n${err?.message || err}\n\n本地: getnote.exe 未配置或未登录\nVPS: 暂不支持 (Linux 二进制不存在)`)
    } finally {
      setGetnoteLoading(false)
    }
  }

  const handleGetnoteSearch = async () => {
    const q = getnoteQuery.trim()
    if (!q) return
    setGetnoteLoading(true)
    setGetnoteResults([])
    try {
      const r = await useCanvasStore.getState().searchGetnote(q)
      setGetnoteResults(r.results || [])
      logAction('leftpanel.searchGetnote', { query: q, count: r.results?.length || 0 })
    } catch (err) {
      alert(`得到搜索失败:\n${err?.message || err}`)
    } finally {
      setGetnoteLoading(false)
    }
  }

  const handleGetnoteImport = async (idOverride) => {
    const id = (idOverride || getnoteId).trim()
    if (!id) return
    setGetnoteImportingId(id)
    if (!idOverride) setGetnoteLoading(true)
    try {
      const r = await useCanvasStore.getState().importFromGetnoteId(id)
      logAction('leftpanel.importGetnote', { id, title: r.title, contentLength: r.contentLength })
      if (!idOverride) setGetnoteId('')
    } catch (err) {
      alert(`得到导入失败:\n${err?.message || err}`)
    } finally {
      setGetnoteImportingId('')
      if (!idOverride) setGetnoteLoading(false)
    }
  }

  const handleTextImport = () => {
    if (!textInput.trim()) return
    const textName = textTitle.trim() || `文本片段 ${new Date().toLocaleTimeString()}`
    onAddSource?.({
      id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'text',
      name: textName,
      ext: 'text',
      content: textInput.trim(),
      addedAt: new Date().toISOString(),
    })
    logAction('leftpanel.addSource', { name: textName, ext: 'text', size: textInput.trim().length })
    setTextInput('')
    setTextTitle('')
  }

  // 过滤和搜索 (用于 import tab 里的 sources 列表)
  const filteredSources = sources.filter((s) => {
    if (categoryFilter !== 'all' && s.type !== categoryFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.content?.toLowerCase().includes(q)
    }
    return true
  })

  const handleDragStart = (e, source) => {
    e.dataTransfer.setData('application/know-canvas-source', JSON.stringify(source))
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 320,
        borderRight: '1px solid var(--border-subtle, var(--gray-100))',
        background: 'var(--surface, var(--white))',
        fontFamily: FONT_SANS,
        color: 'var(--text-primary, var(--dark))',
      }}
    >
      {/* 顶部 2px 暖色细线 — 建筑极简风格招牌 */}
      <div style={{ height: 2, background: 'var(--accent, var(--warm))', flexShrink: 0 }} />

      {/* Header 区 */}
      <div
        style={{
          padding: '20px 16px 12px 16px',
          borderBottom: '1px solid var(--border-subtle, var(--gray-100))',
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.35em',
            color: 'var(--accent, var(--warm))',
            fontFamily: FONT_SANS,
            marginBottom: 8,
            textTransform: 'uppercase',
          }}
        >
          PROJECT LIBRARY
        </div>
        <h2
          style={{
            fontFamily: FONT_SERIF,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text-primary, var(--black))',
            letterSpacing: '0.02em',
            margin: 0,
          }}
        >
          知识库 hub
        </h2>
      </div>

      {/* 4-Tab 切换条 */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-subtle, var(--gray-100))',
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          const count = counts[tab.id] || 0
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: '12px 8px',
                fontSize: 11,
                letterSpacing: '0.15em',
                color: isActive
                  ? 'var(--text-primary, var(--black))'
                  : 'var(--text-muted, var(--gray-500))',
                fontWeight: isActive ? 600 : 400,
                background: 'transparent',
                border: 'none',
                borderBottom: isActive
                  ? '1px solid var(--accent, var(--warm))'
                  : '1px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                fontFamily: FONT_SANS,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-secondary, var(--gray-700))'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-muted, var(--gray-500))'
              }}
            >
              <span>{tab.label}</span>
              {count > 0 && (
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: '0.05em',
                    padding: '1px 6px',
                    minWidth: 18,
                    textAlign: 'center',
                    border: `1px solid ${isActive ? 'var(--accent, var(--warm))' : 'var(--border-subtle, var(--gray-100))'}`,
                    color: isActive ? 'var(--accent, var(--warm))' : 'var(--text-muted, var(--gray-500))',
                    borderRadius: 2,
                    fontWeight: 400,
                  }}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        {activeTab === 'projects' && (
          <ProjectsLibraryTab onLoadProject={onLoadProject} />
        )}

        {activeTab === 'nodes' && (
          <NodesLibrary onSelectNode={onDragConcept} onFocusNode={onFocusNode} />
        )}

        {activeTab === 'history' && <HistoryLibrary />}

        {activeTab === 'import' && (
          <div className="p-3 space-y-4">
            {/* === sources 列表区: 搜索 + 分类 + 列表 === */}
            <div>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.35em',
                  color: 'var(--accent, var(--warm))',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                }}
              >
                01 / 已导入
              </div>

              {/* 搜索框 */}
              <div className="relative" style={{ marginBottom: 8 }}>
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                  style={{ color: 'var(--text-muted, var(--gray-500))' }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索知识源..."
                  className="w-full pl-8 pr-3 py-2 text-xs"
                  style={{
                    border: '1px solid var(--border-subtle, var(--gray-100))',
                    background: 'var(--surface, var(--white))',
                    color: 'var(--text-primary, var(--dark))',
                    fontFamily: FONT_SANS,
                    borderRadius: 4,
                    outline: 'none',
                    transition: 'border-color 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--accent, var(--warm))')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle, var(--gray-100))')}
                />
              </div>

              {/* 分类过滤 */}
              <div className="flex gap-1" style={{ marginBottom: 12 }}>
                {CATEGORIES.map((cat) => {
                  const isActive = categoryFilter === cat.id
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setCategoryFilter(cat.id)}
                      style={{
                        padding: '4px 10px',
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        background: isActive ? 'var(--warm-bg, transparent)' : 'transparent',
                        color: isActive
                          ? 'var(--accent, var(--warm))'
                          : 'var(--text-muted, var(--gray-500))',
                        border: `1px solid ${isActive ? 'var(--accent, var(--warm))' : 'var(--border-subtle, var(--gray-100))'}`,
                        borderRadius: 999,
                        cursor: 'pointer',
                        transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                        fontFamily: FONT_SANS,
                      }}
                    >
                      {cat.label}
                    </button>
                  )
                })}
              </div>

              {/* sources 列表 */}
              {filteredSources.length === 0 ? (
                <div
                  style={{
                    padding: '24px 8px',
                    textAlign: 'center',
                    color: 'var(--text-muted, var(--gray-500))',
                  }}
                >
                  <p style={{ fontSize: 12, margin: 0 }}>暂无知识源</p>
                  <p
                    style={{
                      fontSize: 10,
                      marginTop: 4,
                      color: 'var(--text-tertiary, var(--gray-300))',
                    }}
                  >
                    使用下方导入功能添加
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredSources.map((source) => (
                    <div
                      key={source.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, source)}
                      onClick={() => {
                        logAction('leftpanel.selectSource', { id: source.id, name: source.name })
                        onSelectSource?.(source)
                      }}
                      className="group flex items-center gap-2.5 px-3 py-2.5 cursor-pointer overflow-hidden"
                      style={{
                        border: '1px solid var(--border-subtle, var(--gray-100))',
                        background: 'var(--surface, var(--white))',
                        borderRadius: 4,
                        transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--accent, var(--warm))'
                        e.currentTarget.style.background = 'var(--warm-bg, var(--surface))'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-subtle, var(--gray-100))'
                        e.currentTarget.style.background = 'var(--surface, var(--white))'
                      }}
                    >
                      <div style={{ flexShrink: 0, color: 'var(--accent, var(--warm))' }}>
                        {FILE_ICONS[source.ext] || FILE_ICONS.text}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className="truncate"
                          style={{ fontSize: 12, color: 'var(--text-primary, var(--dark))', margin: 0 }}
                        >
                          {source.name}
                        </p>
                        <p
                          style={{
                            fontSize: 10,
                            marginTop: 2,
                            color: 'var(--text-muted, var(--gray-500))',
                          }}
                        >
                          {source.type === 'file'
                            ? source.ext.toUpperCase()
                            : source.type === 'url'
                              ? '链接'
                              : '文本'}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          logAction('leftpanel.removeSource', { id: source.id, name: source.name })
                          onRemoveSource?.(source.id)
                        }}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1"
                        style={{
                          color: 'var(--text-muted, var(--gray-500))',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'all 0.3s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary, var(--black))')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted, var(--gray-500))')}
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

            {/* === 文件导入 === */}
            <div>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.35em',
                  color: 'var(--accent, var(--warm))',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                }}
              >
                02 / 文件导入
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full"
                style={{
                  padding: '24px 16px',
                  border: '1px dashed var(--border-subtle, var(--gray-100))',
                  background: 'transparent',
                  color: 'var(--text-muted, var(--gray-500))',
                  cursor: 'pointer',
                  borderRadius: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                  fontFamily: FONT_SANS,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent, var(--warm))'
                  e.currentTarget.style.color = 'var(--accent, var(--warm))'
                  e.currentTarget.style.background = 'var(--warm-bg, transparent)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle, var(--gray-100))'
                  e.currentTarget.style.color = 'var(--text-muted, var(--gray-500))'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span style={{ fontSize: 12 }}>点击或拖拽文件到此处</span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary, var(--gray-300))' }}>
                  支持 MD / TXT / JSON / CSV
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

            {/* === URL 导入 === */}
            <div>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.35em',
                  color: 'var(--accent, var(--warm))',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                }}
              >
                03 / 链接导入
              </div>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="输入网址..."
                  className="flex-1 px-3 py-2"
                  style={{
                    fontSize: 12,
                    border: '1px solid var(--border-subtle, var(--gray-100))',
                    color: 'var(--text-primary, var(--dark))',
                    background: 'var(--surface, var(--white))',
                    fontFamily: FONT_SANS,
                    borderRadius: 4,
                    outline: 'none',
                    transition: 'border-color 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--accent, var(--warm))')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle, var(--gray-100))')}
                  onKeyDown={(e) => e.key === 'Enter' && handleUrlImport()}
                />
                <button
                  onClick={handleUrlImport}
                  disabled={!urlInput.trim()}
                  style={{
                    padding: '8px 16px',
                    fontSize: 11,
                    letterSpacing: '0.15em',
                    background: urlInput.trim()
                      ? 'var(--accent, var(--warm))'
                      : 'var(--border-subtle, var(--gray-100))',
                    color: urlInput.trim()
                      ? 'var(--surface, white)'
                      : 'var(--text-muted, var(--gray-500))',
                    border: 'none',
                    borderRadius: 4,
                    cursor: urlInput.trim() ? 'pointer' : 'not-allowed',
                    transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                    fontFamily: FONT_SANS,
                  }}
                >
                  添加
                </button>
              </div>
            </div>

            {/* === 飞书 doc 搜索 + 导入 === */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.35em',
                    color: 'var(--accent, var(--warm))',
                    textTransform: 'uppercase',
                  }}
                >
                  04 / 飞书文档
                </div>
                {/* mode 切换 */}
                <div style={{ display: 'flex', gap: 0, fontSize: 10 }}>
                  {[
                    { id: 'search', label: '搜索' },
                    { id: 'url', label: 'URL' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setFeishuMode(m.id)}
                      style={{
                        padding: '2px 10px',
                        letterSpacing: '0.1em',
                        background: feishuMode === m.id ? 'var(--accent, var(--warm))' : 'transparent',
                        color: feishuMode === m.id ? 'var(--surface, white)' : 'var(--text-muted, var(--gray-500))',
                        border: '1px solid var(--border-subtle, var(--gray-100))',
                        borderRadius: 0,
                        cursor: 'pointer',
                        fontFamily: FONT_SANS,
                        transition: 'all 0.3s',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {feishuMode === 'search' ? (
                <>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={feishuQuery}
                      onChange={(e) => setFeishuQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !feishuLoading && handleFeishuSearch()}
                      placeholder="搜飞书 docs / wiki..."
                      disabled={feishuLoading}
                      className="flex-1 px-3 py-2"
                      style={{
                        fontSize: 12,
                        border: '1px solid var(--border-subtle, var(--gray-100))',
                        color: 'var(--text-primary, var(--dark))',
                        background: 'var(--surface, var(--white))',
                        fontFamily: FONT_SANS,
                        borderRadius: 4,
                        outline: 'none',
                        transition: 'border-color 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                        opacity: feishuLoading ? 0.5 : 1,
                      }}
                      onFocus={(e) => (e.target.style.borderColor = 'var(--accent, var(--warm))')}
                      onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle, var(--gray-100))')}
                    />
                    <button
                      onClick={handleFeishuSearch}
                      disabled={!feishuQuery.trim() || feishuLoading}
                      style={{
                        padding: '8px 14px',
                        fontSize: 11,
                        letterSpacing: '0.15em',
                        background: feishuQuery.trim() && !feishuLoading
                          ? 'var(--accent, var(--warm))'
                          : 'var(--border-subtle, var(--gray-100))',
                        color: feishuQuery.trim() && !feishuLoading
                          ? 'var(--surface, white)'
                          : 'var(--text-muted, var(--gray-500))',
                        border: 'none',
                        borderRadius: 4,
                        cursor: feishuQuery.trim() && !feishuLoading ? 'pointer' : 'not-allowed',
                        transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                        fontFamily: FONT_SANS,
                        minWidth: 50,
                      }}
                    >
                      {feishuLoading ? '...' : '搜'}
                    </button>
                  </div>

                  {/* 搜索结果列表 */}
                  {feishuResults.length > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        maxHeight: 360,
                        overflowY: 'auto',
                        border: '1px solid var(--border-subtle, var(--gray-100))',
                        borderRadius: 4,
                      }}
                    >
                      {feishuResults.map((r, i) => {
                        const isImporting = feishuImportingUrl === r.url
                        return (
                          <div
                            key={r.url + i}
                            onClick={() => !isImporting && handleFeishuImport(r.url)}
                            style={{
                              padding: '8px 10px',
                              borderBottom:
                                i < feishuResults.length - 1
                                  ? '1px solid var(--border-subtle, var(--gray-100))'
                                  : 'none',
                              cursor: isImporting ? 'wait' : 'pointer',
                              opacity: isImporting ? 0.5 : 1,
                              transition: 'background 0.2s',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gray-50, #f9f9f9)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            title={`点击导入: ${r.title}`}
                          >
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--text-primary, var(--dark))',
                                lineHeight: 1.3,
                                marginBottom: 4,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {isImporting && '⟳ '}
                              {r.title}
                            </div>
                            {r.summary && (
                              <div
                                style={{
                                  fontSize: 10,
                                  color: 'var(--text-muted, var(--gray-500))',
                                  lineHeight: 1.4,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  marginBottom: 4,
                                }}
                              >
                                {r.summary}
                              </div>
                            )}
                            <div
                              style={{
                                fontSize: 9,
                                color: 'var(--gray-500, #888)',
                                display: 'flex',
                                gap: 8,
                                letterSpacing: '0.05em',
                              }}
                            >
                              <span>{r.docType || r.entityType}</span>
                              {r.owner && <span>· {r.owner}</span>}
                              {r.updateTime && <span>· {r.updateTime.slice(0, 10)}</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={feishuUrl}
                    onChange={(e) => setFeishuUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !feishuLoading && handleFeishuImport()}
                    placeholder="my.feishu.cn/docx/... 或 wiki/..."
                    disabled={feishuLoading}
                    className="flex-1 px-3 py-2"
                    style={{
                      fontSize: 12,
                      border: '1px solid var(--border-subtle, var(--gray-100))',
                      color: 'var(--text-primary, var(--dark))',
                      background: 'var(--surface, var(--white))',
                      fontFamily: FONT_SANS,
                      borderRadius: 4,
                      outline: 'none',
                      transition: 'border-color 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                      opacity: feishuLoading ? 0.5 : 1,
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--accent, var(--warm))')}
                    onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle, var(--gray-100))')}
                  />
                  <button
                    onClick={() => handleFeishuImport()}
                    disabled={!feishuUrl.trim() || feishuLoading}
                    style={{
                      padding: '8px 16px',
                      fontSize: 11,
                      letterSpacing: '0.15em',
                      background: feishuUrl.trim() && !feishuLoading
                        ? 'var(--accent, var(--warm))'
                        : 'var(--border-subtle, var(--gray-100))',
                      color: feishuUrl.trim() && !feishuLoading
                        ? 'var(--surface, white)'
                        : 'var(--text-muted, var(--gray-500))',
                      border: 'none',
                      borderRadius: 4,
                      cursor: feishuUrl.trim() && !feishuLoading ? 'pointer' : 'not-allowed',
                      transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                      fontFamily: FONT_SANS,
                      minWidth: 56,
                    }}
                  >
                    {feishuLoading ? '...' : '导入'}
                  </button>
                </div>
              )}

              <p className="text-[10px] mt-1.5" style={{ color: 'var(--gray-500, #888)' }}>
                {feishuMode === 'search' ? '搜你飞书 docs/wiki, 点击列表项即导入' : '粘贴 URL 直接导入'}
              </p>
            </div>

            {/* === Notion 搜索 + 导入 === */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.35em',
                    color: 'var(--accent, var(--warm))',
                    textTransform: 'uppercase',
                  }}
                >
                  05 / Notion
                </div>
                <div style={{ display: 'flex', gap: 0, fontSize: 10 }}>
                  {[
                    { id: 'search', label: '搜索' },
                    { id: 'url', label: 'URL' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setNotionMode(m.id)}
                      style={{
                        padding: '2px 10px',
                        letterSpacing: '0.1em',
                        background: notionMode === m.id ? 'var(--accent, var(--warm))' : 'transparent',
                        color: notionMode === m.id ? 'var(--surface, white)' : 'var(--text-muted, var(--gray-500))',
                        border: '1px solid var(--border-subtle, var(--gray-100))',
                        borderRadius: 0,
                        cursor: 'pointer',
                        fontFamily: FONT_SANS,
                        transition: 'all 0.3s',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {notionMode === 'search' ? (
                <>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={notionQuery}
                      onChange={(e) => setNotionQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !notionLoading && handleNotionSearch()}
                      placeholder="搜 Notion pages..."
                      disabled={notionLoading}
                      className="flex-1 px-3 py-2"
                      style={{
                        fontSize: 12,
                        border: '1px solid var(--border-subtle, var(--gray-100))',
                        color: 'var(--text-primary, var(--dark))',
                        background: 'var(--surface, var(--white))',
                        fontFamily: FONT_SANS,
                        borderRadius: 4,
                        outline: 'none',
                        opacity: notionLoading ? 0.5 : 1,
                      }}
                      onFocus={(e) => (e.target.style.borderColor = 'var(--accent, var(--warm))')}
                      onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle, var(--gray-100))')}
                    />
                    <button
                      onClick={handleNotionSearch}
                      disabled={!notionQuery.trim() || notionLoading}
                      style={{
                        padding: '8px 14px',
                        fontSize: 11,
                        letterSpacing: '0.15em',
                        background: notionQuery.trim() && !notionLoading
                          ? 'var(--accent, var(--warm))'
                          : 'var(--border-subtle, var(--gray-100))',
                        color: notionQuery.trim() && !notionLoading
                          ? 'var(--surface, white)'
                          : 'var(--text-muted, var(--gray-500))',
                        border: 'none',
                        borderRadius: 4,
                        cursor: notionQuery.trim() && !notionLoading ? 'pointer' : 'not-allowed',
                        fontFamily: FONT_SANS,
                        minWidth: 50,
                      }}
                    >
                      {notionLoading ? '...' : '搜'}
                    </button>
                  </div>

                  {notionResults.length > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        maxHeight: 360,
                        overflowY: 'auto',
                        border: '1px solid var(--border-subtle, var(--gray-100))',
                        borderRadius: 4,
                      }}
                    >
                      {notionResults.map((r, i) => {
                        const isImporting = notionImportingUrl === r.url
                        return (
                          <div
                            key={r.id + i}
                            onClick={() => !isImporting && handleNotionImport(r.url)}
                            style={{
                              padding: '8px 10px',
                              borderBottom:
                                i < notionResults.length - 1
                                  ? '1px solid var(--border-subtle, var(--gray-100))'
                                  : 'none',
                              cursor: isImporting ? 'wait' : 'pointer',
                              opacity: isImporting ? 0.5 : 1,
                              transition: 'background 0.2s',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gray-50, #f9f9f9)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            title={`点击导入: ${r.title}`}
                          >
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--text-primary, var(--dark))',
                                lineHeight: 1.3,
                                marginBottom: 4,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {isImporting && '⟳ '}
                              {r.title}
                            </div>
                            <div
                              style={{
                                fontSize: 9,
                                color: 'var(--gray-500, #888)',
                                letterSpacing: '0.05em',
                              }}
                            >
                              {r.lastEditedTime ? r.lastEditedTime.slice(0, 10) : ''}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={notionUrl}
                    onChange={(e) => setNotionUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !notionLoading && handleNotionImport()}
                    placeholder="notion.so/... 或 32 hex id"
                    disabled={notionLoading}
                    className="flex-1 px-3 py-2"
                    style={{
                      fontSize: 12,
                      border: '1px solid var(--border-subtle, var(--gray-100))',
                      color: 'var(--text-primary, var(--dark))',
                      background: 'var(--surface, var(--white))',
                      fontFamily: FONT_SANS,
                      borderRadius: 4,
                      outline: 'none',
                      opacity: notionLoading ? 0.5 : 1,
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--accent, var(--warm))')}
                    onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle, var(--gray-100))')}
                  />
                  <button
                    onClick={() => handleNotionImport()}
                    disabled={!notionUrl.trim() || notionLoading}
                    style={{
                      padding: '8px 16px',
                      fontSize: 11,
                      letterSpacing: '0.15em',
                      background: notionUrl.trim() && !notionLoading
                        ? 'var(--accent, var(--warm))'
                        : 'var(--border-subtle, var(--gray-100))',
                      color: notionUrl.trim() && !notionLoading
                        ? 'var(--surface, white)'
                        : 'var(--text-muted, var(--gray-500))',
                      border: 'none',
                      borderRadius: 4,
                      cursor: notionUrl.trim() && !notionLoading ? 'pointer' : 'not-allowed',
                      fontFamily: FONT_SANS,
                      minWidth: 56,
                    }}
                  >
                    {notionLoading ? '...' : '导入'}
                  </button>
                </div>
              )}

              <p className="text-[10px] mt-1.5" style={{ color: 'var(--gray-500, #888)' }}>
                {notionMode === 'search' ? '搜 Notion pages, 点击列表项即导入' : '粘贴 Notion 页面 URL 直接导入'}
              </p>
            </div>

            {/* === 得到笔记 === */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.35em',
                    color: 'var(--accent, var(--warm))',
                    textTransform: 'uppercase',
                  }}
                >
                  06 / 得到笔记
                </div>
                <div style={{ display: 'flex', gap: 0, fontSize: 10 }}>
                  {[
                    { id: 'list', label: '最近' },
                    { id: 'search', label: '搜索' },
                    { id: 'id', label: 'ID' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setGetnoteMode(m.id)}
                      style={{
                        padding: '2px 8px',
                        letterSpacing: '0.1em',
                        background: getnoteMode === m.id ? 'var(--accent, var(--warm))' : 'transparent',
                        color: getnoteMode === m.id ? 'var(--surface, white)' : 'var(--text-muted, var(--gray-500))',
                        border: '1px solid var(--border-subtle, var(--gray-100))',
                        borderRadius: 0,
                        cursor: 'pointer',
                        fontFamily: FONT_SANS,
                        transition: 'all 0.3s',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {getnoteMode === 'list' && (
                <button
                  onClick={handleGetnoteList}
                  disabled={getnoteLoading}
                  className="w-full"
                  style={{
                    padding: '8px',
                    fontSize: 11,
                    letterSpacing: '0.15em',
                    background: getnoteLoading ? 'var(--border-subtle, var(--gray-100))' : 'var(--accent, var(--warm))',
                    color: getnoteLoading ? 'var(--text-muted, var(--gray-500))' : 'var(--surface, white)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: getnoteLoading ? 'wait' : 'pointer',
                    fontFamily: FONT_SANS,
                  }}
                >
                  {getnoteLoading ? '...' : '拉取最近 15 条'}
                </button>
              )}

              {getnoteMode === 'search' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={getnoteQuery}
                    onChange={(e) => setGetnoteQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !getnoteLoading && handleGetnoteSearch()}
                    placeholder="语义搜索..."
                    disabled={getnoteLoading}
                    className="flex-1 px-3 py-2"
                    style={{
                      fontSize: 12,
                      border: '1px solid var(--border-subtle, var(--gray-100))',
                      color: 'var(--text-primary, var(--dark))',
                      background: 'var(--surface, var(--white))',
                      fontFamily: FONT_SANS,
                      borderRadius: 4,
                      outline: 'none',
                      opacity: getnoteLoading ? 0.5 : 1,
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--accent, var(--warm))')}
                    onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle, var(--gray-100))')}
                  />
                  <button
                    onClick={handleGetnoteSearch}
                    disabled={!getnoteQuery.trim() || getnoteLoading}
                    style={{
                      padding: '8px 14px',
                      fontSize: 11,
                      letterSpacing: '0.15em',
                      background: getnoteQuery.trim() && !getnoteLoading
                        ? 'var(--accent, var(--warm))'
                        : 'var(--border-subtle, var(--gray-100))',
                      color: getnoteQuery.trim() && !getnoteLoading ? 'var(--surface, white)' : 'var(--text-muted, var(--gray-500))',
                      border: 'none',
                      borderRadius: 4,
                      cursor: getnoteQuery.trim() && !getnoteLoading ? 'pointer' : 'not-allowed',
                      fontFamily: FONT_SANS,
                      minWidth: 50,
                    }}
                  >
                    {getnoteLoading ? '...' : '搜'}
                  </button>
                </div>
              )}

              {getnoteMode === 'id' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={getnoteId}
                    onChange={(e) => setGetnoteId(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !getnoteLoading && handleGetnoteImport()}
                    placeholder="note_id (19 位数字)"
                    disabled={getnoteLoading}
                    className="flex-1 px-3 py-2"
                    style={{
                      fontSize: 12,
                      border: '1px solid var(--border-subtle, var(--gray-100))',
                      color: 'var(--text-primary, var(--dark))',
                      background: 'var(--surface, var(--white))',
                      fontFamily: FONT_SANS,
                      borderRadius: 4,
                      outline: 'none',
                      opacity: getnoteLoading ? 0.5 : 1,
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--accent, var(--warm))')}
                    onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle, var(--gray-100))')}
                  />
                  <button
                    onClick={() => handleGetnoteImport()}
                    disabled={!getnoteId.trim() || getnoteLoading}
                    style={{
                      padding: '8px 16px',
                      fontSize: 11,
                      letterSpacing: '0.15em',
                      background: getnoteId.trim() && !getnoteLoading
                        ? 'var(--accent, var(--warm))'
                        : 'var(--border-subtle, var(--gray-100))',
                      color: getnoteId.trim() && !getnoteLoading ? 'var(--surface, white)' : 'var(--text-muted, var(--gray-500))',
                      border: 'none',
                      borderRadius: 4,
                      cursor: getnoteId.trim() && !getnoteLoading ? 'pointer' : 'not-allowed',
                      fontFamily: FONT_SANS,
                      minWidth: 56,
                    }}
                  >
                    {getnoteLoading ? '...' : '导入'}
                  </button>
                </div>
              )}

              {getnoteResults.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    maxHeight: 360,
                    overflowY: 'auto',
                    border: '1px solid var(--border-subtle, var(--gray-100))',
                    borderRadius: 4,
                  }}
                >
                  {getnoteResults.map((r, i) => {
                    const isImporting = getnoteImportingId === r.id
                    return (
                      <div
                        key={r.id + i}
                        onClick={() => !isImporting && handleGetnoteImport(r.id)}
                        style={{
                          padding: '8px 10px',
                          borderBottom:
                            i < getnoteResults.length - 1
                              ? '1px solid var(--border-subtle, var(--gray-100))'
                              : 'none',
                          cursor: isImporting ? 'wait' : 'pointer',
                          opacity: isImporting ? 0.5 : 1,
                          transition: 'background 0.2s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gray-50, #f9f9f9)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        title={`点击导入: ${r.title}`}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: 'var(--text-primary, var(--dark))',
                            lineHeight: 1.3,
                            marginBottom: 4,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {isImporting && '⟳ '}
                          {r.title}
                        </div>
                        {r.summary && (
                          <div
                            style={{
                              fontSize: 10,
                              color: 'var(--text-muted, var(--gray-500))',
                              lineHeight: 1.4,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              marginBottom: 4,
                            }}
                          >
                            {r.summary}
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: 9,
                            color: 'var(--gray-500, #888)',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {r.createdAt ? r.createdAt.slice(0, 10) : ''}
                          {r.tags?.length > 0 && ' · ' + r.tags.slice(0, 3).join(' · ')}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <p className="text-[10px] mt-1.5" style={{ color: 'var(--gray-500, #888)' }}>
                得到 OpenAPI · 仅本地 dev (VPS 暂无 Linux 二进制)
              </p>
            </div>

            {/* === 文本片段导入 === */}
            <div>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.35em',
                  color: 'var(--accent, var(--warm))',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                }}
              >
                07 / 文本片段
              </div>
              <input
                type="text"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                placeholder="标题(可选)"
                className="w-full px-3 py-2"
                style={{
                  fontSize: 12,
                  border: '1px solid var(--border-subtle, var(--gray-100))',
                  color: 'var(--text-primary, var(--dark))',
                  background: 'var(--surface, var(--white))',
                  fontFamily: FONT_SANS,
                  borderRadius: 4,
                  outline: 'none',
                  marginBottom: 8,
                  transition: 'border-color 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--accent, var(--warm))')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle, var(--gray-100))')}
              />
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="粘贴或输入文本内容..."
                rows={4}
                className="w-full px-3 py-2"
                style={{
                  fontSize: 12,
                  border: '1px solid var(--border-subtle, var(--gray-100))',
                  color: 'var(--text-primary, var(--dark))',
                  background: 'var(--surface, var(--white))',
                  fontFamily: FONT_SANS,
                  borderRadius: 4,
                  outline: 'none',
                  resize: 'none',
                  transition: 'border-color 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--accent, var(--warm))')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle, var(--gray-100))')}
              />
              <button
                onClick={handleTextImport}
                disabled={!textInput.trim()}
                className="w-full"
                style={{
                  marginTop: 8,
                  padding: '8px',
                  fontSize: 11,
                  letterSpacing: '0.15em',
                  background: textInput.trim()
                    ? 'var(--accent, var(--warm))'
                    : 'var(--border-subtle, var(--gray-100))',
                  color: textInput.trim()
                    ? 'var(--surface, white)'
                    : 'var(--text-muted, var(--gray-500))',
                  border: 'none',
                  borderRadius: 4,
                  cursor: textInput.trim() ? 'pointer' : 'not-allowed',
                  transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                  fontFamily: FONT_SANS,
                }}
              >
                添加文本片段
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部统计 (仅 import tab 显示, 其他 tab 让子组件自己处理) */}
      {activeTab === 'import' && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border-subtle, var(--gray-100))',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 10,
              color: 'var(--text-muted, var(--gray-500))',
              fontFamily: FONT_SANS,
            }}
          >
            <span>{sources.length} 个知识源</span>
            <span style={{ color: 'var(--accent, var(--warm))' }}>
              {sources.filter((s) => s.type === 'file').length} 文件 ·{' '}
              {sources.filter((s) => s.type === 'url').length} 链接 ·{' '}
              {sources.filter((s) => s.type === 'text').length} 文本
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default LeftPanel
