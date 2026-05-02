/**
 * KnowledgeGraph - 知识图谱主页面
 * 单页面布局：左侧知识源面板 + 中央 KnowledgeCanvas 画布 + 右侧详情面板 + 底部 AI 分析栏
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { LeftPanel, RightPanel, BottomAIBar, SaveExportToolbar } from './panels'
import { KnowledgeCanvas } from '../components/canvas'
import WelcomeOverlay from '../components/canvas/WelcomeOverlay'
import ShortcutsModal from '../components/ShortcutsModal'
import useCanvasStore from '../stores/useCanvasStore'
import useKnowledgeStore from '../stores/useKnowledgeStore'
import { extractConcepts, suggestRelations, parseMarkdown, parseCSV, parseJSON } from '../services/aiService'
import { useCollabSession } from '../collab/useCollabSession'
import CollabHeader from '../collab/CollabHeader'
import { CursorAwarenessLayer, useRemoteSelections } from '../collab/PresenceLayer'
import AiSettingsPanel from '../components/AiSettingsPanel'
import CliMonitor from '../components/CliMonitor'
import { pushLog } from '../utils/logBus'

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
  } = useCanvasStore()

  // 知识源状态（useKnowledgeStore）
  const { sources, addSource, removeSource } = useKnowledgeStore()

  const canvasRef = useRef(null)
  const wrapperRef = useRef(null)
  const [showLeftPanel, setShowLeftPanel] = useState(true)
  const [showRightPanel, setShowRightPanel] = useState(true)
  const [selectedNode, setSelectedNode] = useState(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showAiSettings, setShowAiSettings] = useState(false)

  // 协作会话（启动 Yjs sync + 提供 room/username/exitSession）
  const { room, username, exitSession } = useCollabSession()
  useRemoteSelections() // 订阅远端选中变化触发重渲染

  // 选中节点
  const handleNodeClick = useCallback((_event, node) => {
    setSelectedNode(node)
    if (!showRightPanel) setShowRightPanel(true)
  }, [showRightPanel])

  // 选中边（预留扩展）
  const handleEdgeClick = useCallback(() => {}, [])

  // 更新节点数据
  const handleUpdateNode = useCallback((nodeId, updates) => {
    if (updates._delete) {
      removeNode(nodeId)
      setSelectedNode(null)
    } else {
      updateNode(nodeId, updates)
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

      if (result.relations?.length > 0) {
        for (const rel of result.relations) {
          const currentNodes = useCanvasStore.getState().nodes
          const sourceNode = currentNodes.find(n => n.data?.title === rel.source)
          const targetNode = currentNodes.find(n => n.data?.title === rel.target)
          if (sourceNode && targetNode) {
            onConnect({ source: sourceNode.id, target: targetNode.id })
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
        onConnect({ source: sourceNode.id, target: targetNode.id })
      }
    }
  }, [onConnect])

  // ========== 处理多媒体文件 ==========
  const handleFileDrop = useCallback(async (files, position) => {
    for (const file of files) {
      const ext = getFileExtension(file.name)

      if (IMAGE_EXTENSIONS.includes(ext)) {
        const blobUrl = URL.createObjectURL(file)
        addImageNode(blobUrl, file.name, position)
      } else if (VIDEO_EXTENSIONS.includes(ext)) {
        const blobUrl = URL.createObjectURL(file)
        addVideoNode(blobUrl, file.name, '', position, false, { format: ext })
      } else if (DOC_EXTENSIONS.includes(ext)) {
        const blobUrl = URL.createObjectURL(file)
        addFileNode(file.name, blobUrl, file.size, position)
      } else if (TEXT_EXTENSIONS.includes(ext)) {
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
        const blobUrl = URL.createObjectURL(file)
        addFileNode(file.name, blobUrl, file.size, position)
      }
    }
  }, [addImageNode, addVideoNode, addFileNode, addSource, handleSelectSource])

  // ========== 监听画布自定义事件 ==========
  useEffect(() => {
    const onCanvasFileDrop = (e) => handleFileDrop(e.detail.files, e.detail.position)
    const onCanvasUrlDrop = (e) => addBookmarkNode(e.detail.url, '', '', '', '', e.detail.position, true)

    const onCanvasPaste = (e) => {
      const { nodes: pastedNodes, edges: pastedEdges } = e.detail
      if (pastedNodes?.length > 0) {
        const currentNodes = useCanvasStore.getState().nodes
        const currentEdges = useCanvasStore.getState().edges
        useCanvasStore.getState().importCanvasData(
          [...currentNodes, ...pastedNodes],
          [...currentEdges, ...pastedEdges],
        )
      }
    }

    // 系统剪贴板纯文本粘贴 → 自动建 NoteNode
    const onCanvasPasteText = (e) => {
      const { text, position } = e.detail
      if (text) addNoteNode(text, position)
    }

    const onCanvasSelectAll = () => {
      const allNodes = useCanvasStore.getState().nodes
      onNodesChange(allNodes.map(n => ({ id: n.id, type: 'select', selected: true })))
    }

    const onCanvasQuickAdd = (e) => {
      const { type, position } = e.detail
      switch (type) {
        case 'concept':
          addConceptNode({ title: '新概念', description: '', tags: [] }, position)
          break
        case 'note':
          addNoteNode('', position)
          break
        case 'link': {
          const url = prompt('请输入链接地址:')
          if (url && url.trim()) addBookmarkNode(url.trim(), '', '', '', '', position, true)
          break
        }
        case 'image':
        case 'video':
        case 'file': {
          const input = document.createElement('input')
          input.type = 'file'
          if (type === 'image') input.accept = 'image/*'
          if (type === 'video') input.accept = 'video/*'
          input.onchange = (ev) => {
            const file = ev.target.files?.[0]
            if (!file) return
            const blobUrl = URL.createObjectURL(file)
            if (type === 'image') addImageNode(blobUrl, file.name, position)
            else if (type === 'video') addVideoNode(blobUrl, file.name, '', position, false)
            else addFileNode(file.name, blobUrl, file.size, position)
          }
          input.click()
          break
        }
        case 'task': {
          // metahermes 集成: 加 Hermes TaskNode (草稿状态, 用户填完点"派给 Hermes")
          const addTaskNode = useCanvasStore.getState().addTaskNode
          if (typeof addTaskNode === 'function') {
            addTaskNode(position)
          } else {
            console.warn('addTaskNode action 未实现')
          }
          break
        }
        default:
          addConceptNode({ title: '新概念', description: '', tags: [] }, position)
      }
    }

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
        case 'deleteSelected':
          store.nodes.filter(n => n.selected).forEach(n => store.removeNode(n.id))
          break
        case 'markSelected':
          store.markSelectedNodes(color)
          break
        case 'clearMarks':
          store.nodes.filter(n => n.selected).forEach(n => store.updateNode(n.id, { marked: false, markColor: null }))
          break
        case 'batchSetCategory':
          store.nodes.filter(n => n.selected).forEach(n => store.updateNode(n.id, { category }))
          break
        case 'batchAddTags':
          store.nodes.filter(n => n.selected).forEach(n => {
            const merged = [...new Set([...(n.data?.tags || []), ...tags])]
            store.updateNode(n.id, { tags: merged })
          })
          break
        default:
          console.warn('未知的选择操作:', action)
      }
    }

    const onNodeUpdate = (e) => {
      const { nodeId, data } = e.detail
      useCanvasStore.getState().updateNode(nodeId, data)
      setSelectedNode(prev => prev?.id === nodeId ? { ...prev, data: { ...prev.data, ...data } } : prev)
    }

    const onNodeChangeType = (e) => {
      const { nodeId, newType, currentData } = e.detail
      const store = useCanvasStore.getState()
      if (currentData) store.updateNode(nodeId, currentData)
      store.changeNodeType(nodeId, newType)
      setSelectedNode(prev => {
        if (prev?.id !== nodeId) return prev
        const updated = useCanvasStore.getState().nodes.find(n => n.id === nodeId)
        return updated ? { ...updated } : prev
      })
    }

    const onGroupColorChange = (e) => {
      useCanvasStore.getState().updateNode(e.detail.groupId, { color: e.detail.color })
    }

    window.addEventListener('canvas-file-drop', onCanvasFileDrop)
    window.addEventListener('canvas-url-drop', onCanvasUrlDrop)
    window.addEventListener('canvas-paste', onCanvasPaste)
    window.addEventListener('canvas-paste-text', onCanvasPasteText)
    window.addEventListener('canvas-select-all', onCanvasSelectAll)
    window.addEventListener('canvas-quick-add', onCanvasQuickAdd)
    window.addEventListener('selection-action', onSelectionAction)
    window.addEventListener('node-update', onNodeUpdate)
    window.addEventListener('node-change-type', onNodeChangeType)
    window.addEventListener('group-color-change', onGroupColorChange)

    return () => {
      window.removeEventListener('canvas-file-drop', onCanvasFileDrop)
      window.removeEventListener('canvas-url-drop', onCanvasUrlDrop)
      window.removeEventListener('canvas-paste', onCanvasPaste)
      window.removeEventListener('canvas-paste-text', onCanvasPasteText)
      window.removeEventListener('canvas-select-all', onCanvasSelectAll)
      window.removeEventListener('canvas-quick-add', onCanvasQuickAdd)
      window.removeEventListener('selection-action', onSelectionAction)
      window.removeEventListener('node-update', onNodeUpdate)
      window.removeEventListener('node-change-type', onNodeChangeType)
      window.removeEventListener('group-color-change', onGroupColorChange)
    }
  }, [handleFileDrop, addBookmarkNode, addConceptNode, addNoteNode, addImageNode, addVideoNode, addFileNode, onNodesChange])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)

      if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        const center = useCanvasStore.getState().viewportCenter || { x: 400, y: 300 }
        addConceptNode(
          { title: '新概念', description: '', tags: [] },
          { x: center.x + Math.random() * 100 - 50, y: center.y + Math.random() * 100 - 50 },
        )
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        setShowLeftPanel(prev => !prev)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ']') {
        e.preventDefault()
        setShowRightPanel(prev => !prev)
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !isInput) {
        e.preventDefault()
        setShowShortcuts(prev => !prev)
      }
      if (e.key === 'Escape') {
        setSelectedNode(null)
        setShowShortcuts(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addConceptNode])

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
      <div className="flex-1 relative" ref={(el) => { canvasRef.current = el; wrapperRef.current = el }}>
        <SaveExportToolbar
          canvasRef={canvasRef}
          nodes={nodes}
          edges={edges}
          exportCanvasData={exportCanvasData}
          importCanvasData={importCanvasData}
        />

        {/* 协作信息条（在线用户 + 房间号 + 退出 + AI 设置） */}
        <CollabHeader
          room={room}
          username={username}
          onOpenAiSettings={() => setShowAiSettings(true)}
          onExit={exitSession}
        />

        {/* 面板切换按钮 + ALETHEIA 品牌名 */}
        <div className="absolute top-4 left-4 z-30 flex items-center gap-3">
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
          {/* ALETHEIA 品牌标识 */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg shadow-sm"
            style={{
              background: 'rgba(250,250,250,0.95)',
              border: '1px solid #e8e8e8',
              backdropFilter: 'blur(8px)',
              fontFamily: '"Noto Serif SC", Georgia, serif',
            }}
            title="ALETHEIA — 逻辑对抗决策引擎"
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: '#c8a882' }}
            />
            <span
              className="text-xs font-medium"
              style={{ color: '#1a1a1a', letterSpacing: '0.35em' }}
            >
              ALETHEIA
            </span>
          </div>
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
          <CursorAwarenessLayer wrapperRef={wrapperRef} nodes={nodes} />
          {nodes.length === 0 && <WelcomeOverlay onShowShortcuts={() => setShowShortcuts(true)} />}
        </KnowledgeCanvas>

        <BottomAIBar
          showLeftPanel={showLeftPanel}
          showRightPanel={showRightPanel}
          onExtractConcepts={handleExtractConcepts}
          onSuggestRelations={handleSuggestRelations}
          concepts={conceptsForAI}
        />
      </div>

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

      <AiSettingsPanel open={showAiSettings} onClose={() => setShowAiSettings(false)} />
      <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <CliMonitor />
    </div>
  )
}
