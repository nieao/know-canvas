/**
 * KnowledgeGraph - 知识图谱主页面
 * 单页面布局：左侧知识源面板 + 中央 KnowledgeCanvas 画布 + 右侧详情面板 + 底部 AI 分析栏
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { LeftPanel, RightPanel, BottomAIBar, SaveExportToolbar } from './panels'
import { KnowledgeCanvas } from '../components/canvas'
import useCanvasStore from '../stores/useCanvasStore'
import useKnowledgeStore from '../stores/useKnowledgeStore'
import { extractConcepts, suggestRelations, parseMarkdown, parseCSV, parseJSON } from '../services/aiService'

// 文件类型扩展名分组
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi']
const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']
const TEXT_EXTENSIONS = ['md', 'txt', 'json', 'csv']

const getFileExtension = (filename) => filename?.split('.').pop()?.toLowerCase() || ''

export default function KnowledgeGraph() {
  // 画布状态（useCanvasStore）
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addConceptNode,
    addBookmarkNode,
    addImageNode,
    addVideoNode,
    addFileNode,
    addNoteNode,
    removeNode,
    updateNode,
    exportCanvasData,
    importCanvasData,
    clearCanvas,
    viewportCenter,
    setViewportCenter,
  } = useCanvasStore()

  // 知识源状态（useKnowledgeStore）
  const {
    sources,
    addSource,
    removeSource,
  } = useKnowledgeStore()

  const canvasRef = useRef(null)
  const [showLeftPanel, setShowLeftPanel] = useState(true)
  const [showRightPanel, setShowRightPanel] = useState(true)
  const [selectedNode, setSelectedNode] = useState(null)
  const [showShortcuts, setShowShortcuts] = useState(false)

  // 选中节点
  const handleNodeClick = useCallback((_event, node) => {
    setSelectedNode(node)
    if (!showRightPanel) setShowRightPanel(true)
  }, [showRightPanel])

  // 选中边
  const handleEdgeClick = useCallback((_event, edge) => {
    // 可扩展：边的详情展示
  }, [])

  // 更新节点数据
  const handleUpdateNode = useCallback((nodeId, updates) => {
    if (updates._delete) {
      removeNode(nodeId)
      setSelectedNode(null)
    } else {
      updateNode(nodeId, updates)
      // 同步更新选中节点
      setSelectedNode(prev => {
        if (prev?.id === nodeId) {
          return { ...prev, data: { ...prev.data, ...updates } }
        }
        return prev
      })
    }
  }, [updateNode, removeNode])

  // 选择知识源时触发解析
  const handleSelectSource = useCallback(async (source) => {
    if (!source.content) return

    try {
      let result
      switch (source.ext) {
        case 'md':
        case 'txt':
          result = await parseMarkdown(source.content)
          break
        case 'csv':
          const csvConcepts = await parseCSV(source.content)
          result = { concepts: csvConcepts, relations: [] }
          break
        case 'json':
          result = await parseJSON(source.content)
          break
        default:
          result = await parseMarkdown(source.content)
      }

      // 添加概念到画布
      if (result.concepts?.length > 0) {
        const GRID_GAP = 200
        const cols = Math.ceil(Math.sqrt(result.concepts.length))
        const startX = 100
        const startY = 100

        result.concepts.forEach((concept, index) => {
          const row = Math.floor(index / cols)
          const col = index % cols
          addConceptNode({
            title: concept.title,
            description: concept.description,
            tags: concept.tags,
            importance: concept.importance,
            source: source.name,
            category: concept.importance === 'high' ? 'core' : undefined,
          }, {
            x: startX + col * GRID_GAP,
            y: startY + row * GRID_GAP,
          })
        })
      }

      // 添加关系到画布
      if (result.relations?.length > 0) {
        for (const rel of result.relations) {
          const currentNodes = useCanvasStore.getState().nodes
          const sourceNode = currentNodes.find(n => n.data?.title === rel.source)
          const targetNode = currentNodes.find(n => n.data?.title === rel.target)
          if (sourceNode && targetNode) {
            // 使用 onConnect 添加边
            onConnect({
              source: sourceNode.id,
              target: targetNode.id,
            })
          }
        }
      }
    } catch (error) {
      console.error('解析知识源失败:', error)
    }
  }, [addConceptNode, onConnect])

  // AI 提取概念的回调
  const handleExtractConcepts = useCallback((concepts) => {
    const GRID_GAP = 180
    const cols = Math.ceil(Math.sqrt(concepts.length))
    const offsetX = nodes.length > 0 ? Math.max(...nodes.map(n => n.position?.x || 0)) + 300 : 100
    const startY = 100

    concepts.forEach((concept, index) => {
      const row = Math.floor(index / cols)
      const col = index % cols
      addConceptNode({
        title: concept.title,
        description: concept.description,
        tags: concept.tags,
        importance: concept.importance,
        source: 'AI 提取',
      }, {
        x: offsetX + col * GRID_GAP,
        y: startY + row * GRID_GAP,
      })
    })
  }, [addConceptNode, nodes])

  // AI 推荐关系的回调
  const handleSuggestRelations = useCallback((relations) => {
    for (const rel of relations) {
      const currentNodes = useCanvasStore.getState().nodes
      const sourceNode = currentNodes.find(n => n.data?.title === rel.source)
      const targetNode = currentNodes.find(n => n.data?.title === rel.target)
      if (sourceNode && targetNode) {
        onConnect({
          source: sourceNode.id,
          target: targetNode.id,
        })
      }
    }
  }, [onConnect])

  // ========== 处理多媒体文件 ==========
  const handleFileDrop = useCallback(async (files, position) => {
    for (const file of files) {
      const ext = getFileExtension(file.name)

      if (IMAGE_EXTENSIONS.includes(ext)) {
        // 图片 -> ImageNode
        const blobUrl = URL.createObjectURL(file)
        addImageNode(blobUrl, file.name, position)
      } else if (VIDEO_EXTENSIONS.includes(ext)) {
        // 视频 -> VideoNode
        const blobUrl = URL.createObjectURL(file)
        addVideoNode(blobUrl, file.name, '', position, false, {
          format: ext,
        })
      } else if (DOC_EXTENSIONS.includes(ext)) {
        // 文档 -> FileNode
        const blobUrl = URL.createObjectURL(file)
        addFileNode(file.name, blobUrl, file.size, position)
      } else if (TEXT_EXTENSIONS.includes(ext)) {
        // 文本文件 -> 解析后添加概念节点
        const content = await file.text()
        const source = {
          id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'file',
          name: file.name,
          ext,
          content,
          addedAt: new Date().toISOString(),
        }
        addSource(source)
        handleSelectSource(source)
      } else {
        // 未知类型 -> FileNode
        const blobUrl = URL.createObjectURL(file)
        addFileNode(file.name, blobUrl, file.size, position)
      }
    }
  }, [addImageNode, addVideoNode, addFileNode, addConceptNode, addSource, handleSelectSource])

  // ========== 监听画布自定义事件 ==========
  useEffect(() => {
    // 文件拖放到画布
    const onCanvasFileDrop = (e) => {
      const { files, position } = e.detail
      handleFileDrop(files, position)
    }

    // URL 拖放到画布
    const onCanvasUrlDrop = (e) => {
      const { url, position } = e.detail
      addBookmarkNode(url, '', '', '', '', position, true)
    }

    // 粘贴节点
    const onCanvasPaste = (e) => {
      const { nodes: pastedNodes, edges: pastedEdges } = e.detail
      if (pastedNodes?.length > 0) {
        // 将粘贴的节点和边合并到当前 store
        const currentNodes = useCanvasStore.getState().nodes
        const currentEdges = useCanvasStore.getState().edges
        useCanvasStore.getState().importCanvasData(
          [...currentNodes, ...pastedNodes],
          [...currentEdges, ...pastedEdges],
        )
      }
    }

    // 全选节点
    const onCanvasSelectAll = () => {
      const allNodes = useCanvasStore.getState().nodes
      const selectChanges = allNodes.map(n => ({
        id: n.id,
        type: 'select',
        selected: true,
      }))
      onNodesChange(selectChanges)
    }

    // 快速添加菜单
    const onCanvasQuickAdd = (e) => {
      const { type, position } = e.detail
      switch (type) {
        case 'concept':
          addConceptNode({
            title: '新概念',
            description: '',
            tags: [],
          }, position)
          break
        case 'note':
          addNoteNode('', position)
          break
        case 'link': {
          const url = prompt('请输入链接地址:')
          if (url && url.trim()) {
            addBookmarkNode(url.trim(), '', '', '', '', position, true)
          }
          break
        }
        case 'image': {
          // 创建文件选择器
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/*'
          input.onchange = (ev) => {
            const file = ev.target.files?.[0]
            if (file) {
              const blobUrl = URL.createObjectURL(file)
              addImageNode(blobUrl, file.name, position)
            }
          }
          input.click()
          break
        }
        case 'video': {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'video/*'
          input.onchange = (ev) => {
            const file = ev.target.files?.[0]
            if (file) {
              const blobUrl = URL.createObjectURL(file)
              addVideoNode(blobUrl, file.name, '', position, false)
            }
          }
          input.click()
          break
        }
        case 'file': {
          const input = document.createElement('input')
          input.type = 'file'
          input.onchange = (ev) => {
            const file = ev.target.files?.[0]
            if (file) {
              const blobUrl = URL.createObjectURL(file)
              addFileNode(file.name, blobUrl, file.size, position)
            }
          }
          input.click()
          break
        }
        default:
          addConceptNode({
            title: '新概念',
            description: '',
            tags: [],
          }, position)
      }
    }

    // 多选操作事件（来自 SelectionToolbar 和右键菜单）
    const onSelectionAction = (e) => {
      const { action, relationType, color, name, category, tags } = e.detail
      const store = useCanvasStore.getState()
      switch (action) {
        case 'linkSelected':
          store.linkSelectedNodes(relationType || 'related')
          break
        case 'autoLinkAll':
          store.linkSelectedNodes('related')
          break
        case 'autoLinkChain': {
          // 链式连接：按位置从左到右、从上到下排序后依次连接
          const sel = store.nodes.filter(n => n.selected)
          sel.sort((a, b) => (a.position.x + a.position.y) - (b.position.x + b.position.y))
          for (let i = 0; i < sel.length - 1; i++) {
            store.addRelation(sel[i].id, sel[i + 1].id, 'sequence')
          }
          break
        }
        case 'createGroup':
          store.createGroup(name || '')
          break
        case 'deleteSelected': {
          const selected = store.nodes.filter(n => n.selected)
          selected.forEach(n => store.removeNode(n.id))
          break
        }
        case 'markSelected':
          store.markSelectedNodes(color)
          break
        case 'clearMarks': {
          const sel = store.nodes.filter(n => n.selected).map(n => n.id)
          sel.forEach(id => store.updateNode(id, { marked: false, markColor: null }))
          break
        }
        case 'batchSetCategory': {
          const sel = store.nodes.filter(n => n.selected).map(n => n.id)
          sel.forEach(id => store.updateNode(id, { category }))
          break
        }
        case 'batchAddTags': {
          const sel = store.nodes.filter(n => n.selected)
          sel.forEach(n => {
            const existing = n.data?.tags || []
            const merged = [...new Set([...existing, ...tags])]
            store.updateNode(n.id, { tags: merged })
          })
          break
        }
        default:
          console.warn('未知的选择操作:', action)
      }
    }

    window.addEventListener('canvas-file-drop', onCanvasFileDrop)
    window.addEventListener('canvas-url-drop', onCanvasUrlDrop)
    window.addEventListener('canvas-paste', onCanvasPaste)
    window.addEventListener('canvas-select-all', onCanvasSelectAll)
    window.addEventListener('canvas-quick-add', onCanvasQuickAdd)
    window.addEventListener('selection-action', onSelectionAction)

    return () => {
      window.removeEventListener('canvas-file-drop', onCanvasFileDrop)
      window.removeEventListener('canvas-url-drop', onCanvasUrlDrop)
      window.removeEventListener('canvas-paste', onCanvasPaste)
      window.removeEventListener('canvas-select-all', onCanvasSelectAll)
      window.removeEventListener('canvas-quick-add', onCanvasQuickAdd)
      window.removeEventListener('selection-action', onSelectionAction)
    }
  }, [handleFileDrop, addBookmarkNode, addConceptNode, addNoteNode, addImageNode, addVideoNode, addFileNode, onNodesChange])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl/Cmd + B: 切换左侧面板
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        setShowLeftPanel(prev => !prev)
      }
      // Ctrl/Cmd + ]: 切换右侧面板
      if ((e.ctrlKey || e.metaKey) && e.key === ']') {
        e.preventDefault()
        setShowRightPanel(prev => !prev)
      }
      // ?: 显示快捷键
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        // 仅在非输入状态触发
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
          e.preventDefault()
          setShowShortcuts(prev => !prev)
        }
      }
      // Escape: 取消选中 / 关闭弹窗
      if (e.key === 'Escape') {
        setSelectedNode(null)
        setShowShortcuts(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 概念数据（传给 AI 分析栏）
  const conceptsForAI = nodes.map(n => ({
    title: n.data?.title || n.data?.name || '',
    description: n.data?.description || n.data?.content || '',
    tags: n.data?.tags || [],
    importance: n.data?.importance || 'medium',
  }))

  return (
    <div className="h-screen w-screen flex overflow-hidden" style={{ background: 'var(--white)' }}>
      {/* 左侧面板 */}
      {showLeftPanel && (
        <LeftPanel
          sources={sources}
          onAddSource={addSource}
          onRemoveSource={removeSource}
          onSelectSource={handleSelectSource}
        />
      )}

      {/* 中央画布区域 */}
      <div className="flex-1 relative" ref={canvasRef}>
        {/* 顶部工具栏 */}
        <SaveExportToolbar
          canvasRef={canvasRef}
          nodes={nodes}
          edges={edges}
          exportCanvasData={exportCanvasData}
          importCanvasData={importCanvasData}
        />

        {/* 面板切换按钮 */}
        <div className="absolute top-4 left-4 z-30 flex gap-2">
          <button
            onClick={() => setShowLeftPanel(prev => !prev)}
            className="p-2 rounded-lg shadow-sm transition-all duration-300"
            style={{
              background: 'var(--white)',
              border: `1px solid ${showLeftPanel ? 'var(--warm)' : 'var(--gray-100)'}`,
              color: showLeftPanel ? 'var(--warm)' : 'var(--gray-500)',
            }}
            title="切换知识源面板 (Ctrl+B)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
        </div>

        <div className="absolute top-4 right-4 z-30 flex gap-2">
          <button
            onClick={() => setShowRightPanel(prev => !prev)}
            className="p-2 rounded-lg shadow-sm transition-all duration-300"
            style={{
              background: 'var(--white)',
              border: `1px solid ${showRightPanel ? 'var(--warm)' : 'var(--gray-100)'}`,
              color: showRightPanel ? 'var(--warm)' : 'var(--gray-500)',
            }}
            title="切换详情面板 (Ctrl+])"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>

        {/* KnowledgeCanvas 画布 */}
        <KnowledgeCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          showMiniMap={true}
        >
          {/* 空状态欢迎覆盖层 */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="text-center max-w-md mx-auto px-8 pointer-events-auto">
                {/* 建筑网格装饰 */}
                <div className="fixed inset-0 pointer-events-none z-0" style={{ opacity: 0.03 }}>
                  <div className="absolute top-1/2 left-0 right-0 h-px" style={{ background: 'var(--black)' }} />
                  <div className="absolute top-0 bottom-0 left-1/2 w-px" style={{ background: 'var(--black)' }} />
                </div>

                <div className="section-label mb-6">KNOW / CANVAS</div>
                <h1 className="heading-serif text-2xl font-light mb-4" style={{ color: 'var(--black)' }}>
                  知识图谱
                </h1>
                <p className="text-sm leading-relaxed mb-8" style={{ color: 'var(--gray-700)' }}>
                  将文档、链接和文本导入画布，<br />
                  AI 自动提取概念、发现关系，<br />
                  构建你的知识网络。
                </p>

                {/* 操作引导 */}
                <div className="space-y-3 text-left max-w-xs mx-auto">
                  {[
                    { step: '01', text: '导入文件或粘贴文本', desc: '图片 / 视频 / PDF / MD / TXT / JSON / CSV' },
                    { step: '02', text: '自动提取关键概念', desc: '标题、关键词、高频术语' },
                    { step: '03', text: '发现概念间关系', desc: '层级、共现、语义关联' },
                    { step: '04', text: '导出知识图谱', desc: 'Markdown / JSON-LD / PNG' },
                  ].map(item => (
                    <div
                      key={item.step}
                      className="flex items-start gap-3 p-3 rounded-md transition-all duration-300"
                      style={{ border: '1px solid var(--gray-100)', background: 'rgba(250,250,250,0.9)' }}
                    >
                      <span className="text-xs font-light mt-0.5" style={{ color: 'var(--warm)', fontFamily: 'var(--font-serif)' }}>
                        {item.step}
                      </span>
                      <div>
                        <p className="text-xs font-medium" style={{ color: 'var(--dark)' }}>{item.text}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--gray-500)' }}>{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 拖拽提示 */}
                <div className="mt-8 py-6 px-8 rounded-lg border-dashed" style={{ border: '2px dashed var(--gray-100)', background: 'rgba(250,250,250,0.8)' }}>
                  <svg className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--gray-300)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-xs" style={{ color: 'var(--gray-500)' }}>拖拽文件到此处开始</p>
                </div>

                {/* 快捷键提示 */}
                <button
                  onClick={() => setShowShortcuts(true)}
                  className="mt-6 text-[10px] tracking-wider transition-colors duration-300"
                  style={{ color: 'var(--gray-300)' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--warm)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--gray-300)'}
                >
                  按 ? 查看快捷键
                </button>
              </div>
            </div>
          )}
        </KnowledgeCanvas>

        {/* 底部 AI 分析栏 */}
        <BottomAIBar
          showLeftPanel={showLeftPanel}
          showRightPanel={showRightPanel}
          onExtractConcepts={handleExtractConcepts}
          onSuggestRelations={handleSuggestRelations}
          concepts={conceptsForAI}
        />
      </div>

      {/* 右侧详情面板 */}
      {showRightPanel && (
        <RightPanel
          selectedNode={selectedNode}
          edges={edges}
          nodes={nodes}
          onUpdateNode={handleUpdateNode}
          onAddEdge={onConnect}
          onRemoveEdge={(edgeId) => {
            const currentEdges = useCanvasStore.getState().edges
            useCanvasStore.getState().importCanvasData(
              useCanvasStore.getState().nodes,
              currentEdges.filter(e => e.id !== edgeId),
            )
          }}
        />
      )}

      {/* 快捷键弹窗 */}
      {showShortcuts && (
        <>
          <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={() => setShowShortcuts(false)} />
          <div
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 rounded-lg shadow-xl p-6"
            style={{ background: 'var(--white)', border: '1px solid var(--gray-100)' }}
          >
            <div className="section-label mb-3">快捷键</div>
            <h3 className="heading-serif text-base font-semibold mb-4" style={{ color: 'var(--black)' }}>
              键盘快捷键
            </h3>
            <div className="space-y-2.5">
              {[
                { keys: 'Ctrl + B', desc: '切换左侧知识源面板' },
                { keys: 'Ctrl + ]', desc: '切换右侧详情面板' },
                { keys: 'Ctrl + A', desc: '全选节点' },
                { keys: 'Ctrl + C / V', desc: '复制 / 粘贴节点' },
                { keys: 'Ctrl + 0', desc: '适应视图' },
                { keys: 'Ctrl + 1', desc: '重置缩放' },
                { keys: 'Space', desc: '按住拖拽画布' },
                { keys: '双击画布', desc: '快速添加节点' },
                { keys: '?', desc: '显示/隐藏快捷键' },
                { keys: 'Esc', desc: '取消选中 / 关闭弹窗' },
                { keys: 'Delete', desc: '删除选中节点' },
              ].map(item => (
                <div key={item.keys} className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--gray-700)' }}>{item.desc}</span>
                  <kbd className="px-2 py-0.5 text-[10px] rounded" style={{ background: 'var(--warm-bg)', color: 'var(--warm)', fontFamily: 'var(--font-sans)' }}>
                    {item.keys}
                  </kbd>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowShortcuts(false)}
              className="w-full mt-5 py-2 text-xs rounded-md transition-all duration-300"
              style={{ border: '1px solid var(--gray-100)', color: 'var(--gray-700)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--warm)'; e.currentTarget.style.color = 'var(--warm)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--gray-100)'; e.currentTarget.style.color = 'var(--gray-700)' }}
            >
              关闭
            </button>
          </div>
        </>
      )}
    </div>
  )
}
