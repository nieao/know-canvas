/**
 * KnowledgeGraph - 知识图谱主页面
 * 单页面布局：左侧知识源面板 + 中央 KnowledgeCanvas 画布 + 右侧详情面板 + 底部 AI 分析栏
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { LeftPanel, RightPanel, BottomAIBar, SaveExportToolbar } from './panels'
import { KnowledgeCanvas } from '../components/canvas'
import WelcomeOverlay from '../components/canvas/WelcomeOverlay'
import ShortcutsModal from '../components/ShortcutsModal'
import useCanvasStore from '../stores/useCanvasStore'
import useKnowledgeStore from '../stores/useKnowledgeStore'
import { extractConcepts, suggestRelations, parseMarkdown, parseCSV, parseJSON } from '../services/aiService'
import { useCollabSession } from '../collab/useCollabSession'
import CollabHeader from '../collab/CollabHeader'
import { CursorAwarenessLayer, NodeBadgeLayer, useRemoteSelections } from '../collab/PresenceLayer'
import { setLocalMovedNode } from '../collab/yjsClient'
import AiSettingsPanel from '../components/AiSettingsPanel'
import CliMonitor from '../components/CliMonitor'
import CostMeterChip from '../components/cost/CostMeterChip'
import TimelineDock from '../components/timeline/TimelineDock'
import PlaybackScrubber from '../components/timeline/PlaybackScrubber'
import ProjectLibraryButton from '../components/project-library/ProjectLibraryButton'
import ProjectLibraryPanel from '../components/project-library/ProjectLibraryPanel'
import useProjectLibraryStore from '../stores/useProjectLibraryStore'
import { loadProjectToCanvas } from '../services/projectLibraryActions'
import { pushLog } from '../utils/logBus'
// toB/toC/toG 场景切换 — 之前埋在 AletheiaLayer 里, 而 AletheiaLayer 没挂载 → 用户找不到切换入口
// 单独提到顶部 ALETHEIA 品牌右侧, 默认收起成胶囊, 不挡画布
import ScenarioSwitcher from '../components/aletheia/ScenarioSwitcher'
// 私人/公共频道切换 — 草稿在私室, 协作时切公共频道. 切换走 navigateToRoom (reload + 重连 yjs)
import ChannelSwitcher from '../components/collab/ChannelSwitcher'

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
  // RightPanel 横向放大状态 — 挤占画布比例展示完整结论 / 抉择引擎产出
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false)
  const rightPanelWidth = showRightPanel ? (rightPanelExpanded ? 640 : 320) : 0
  const [selectedNode, setSelectedNode] = useState(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [showProjectLibrary, setShowProjectLibrary] = useState(false)

  // 协作会话（启动 Yjs sync + 提供 room/username/exitSession）
  const { room, username, exitSession } = useCollabSession()
  useRemoteSelections() // 订阅远端选中变化触发重渲染

  // ── 回放模式: 用 commits[i].snapshot 替代 store nodes/edges ──
  const playbackProjectId = useProjectLibraryStore((s) => s.playbackProjectId)
  const playbackCommitIndex = useProjectLibraryStore((s) => s.playbackCommitIndex)
  const playbackMode = useProjectLibraryStore((s) => s.playbackMode)
  const playbackUserFilter = useProjectLibraryStore((s) => s.playbackUserFilter)
  const isPlayback = !!playbackProjectId

  const playbackSnapshot = useMemo(() => {
    if (!isPlayback) return null
    return useProjectLibraryStore.getState().getCurrentPlaybackSnapshot?.() || null
  }, [isPlayback, playbackProjectId, playbackCommitIndex, playbackMode, playbackUserFilter])

  const displayNodes = playbackSnapshot?.nodes || nodes
  const displayEdges = playbackSnapshot?.edges || edges
  const noopHandler = useCallback(() => {}, [])

  // 选中节点
  const handleNodeClick = useCallback((_event, node) => {
    setSelectedNode(node)
    if (!showRightPanel) setShowRightPanel(true)
  }, [showRightPanel])

  // === 来自 LeftPanel 项目 tab 的"载入"回调 ===
  const handleLoadProjectFromTab = useCallback((project) => {
    if (!project?.id) return
    const r = loadProjectToCanvas(project.id)
    if (r?.ok) {
      pushLog({
        level: 'info',
        source: 'project-library',
        msg: `已载入: ${project.title || project.id}`,
      })
    } else {
      pushLog({
        level: 'warn',
        source: 'project-library',
        msg: `载入项目失败: ${r?.reason || 'unknown'}`,
      })
    }
  }, [])

  // === 来自 LeftPanel 节点 tab 的"聚焦"回调 ===
  // 简版实现: 把目标节点作为 selectedNode 推到 RightPanel,
  // 并通过自定义事件让画布尝试聚焦 (KnowledgeCanvas 监听 canvas-focus-node 时会 setCenter)
  const handleFocusNode = useCallback((nodeId) => {
    if (!nodeId) return
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)
    if (!node) {
      console.warn('[LeftPanel.focusNode] 节点不存在:', nodeId)
      return
    }
    setSelectedNode(node)
    if (!showRightPanel) setShowRightPanel(true)
    // 派一个事件让画布(若已实现 listener)尝试 fitView/setCenter
    window.dispatchEvent(new CustomEvent('canvas-focus-node', { detail: { nodeId, node } }))
    pushLog({ level: 'debug', source: 'left-panel', msg: `聚焦节点: ${nodeId}` })
  }, [showRightPanel])

  // 选中边（预留扩展）
  const handleEdgeClick = useCallback(() => {}, [])

  // 节点拖拽完成 — 广播给其他用户做"呼吸 + 气泡"
  const handleNodeDragStop = useCallback((_event, node) => {
    if (node?.id) setLocalMovedNode(node.id)
  }, [])

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
  // 文件 → dataURL (base64) 让 yjs 跨客户端同步可见.
  // 大文件 (> 限制) 退回 blob URL — 本地可见, 远端用户不可见 (yjs 体积控制)
  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const handleFileDrop = useCallback(async (files, position) => {
    // 体积阈值: yjs 协作场景下大文件会拖慢 sync, 仅小文件入云 (内嵌 dataURL)
    // 图片 4MB / 视频 8MB / 其他文档 6MB
    const LIMIT_IMG = 4 * 1024 * 1024
    const LIMIT_VIDEO = 8 * 1024 * 1024
    const LIMIT_DOC = 6 * 1024 * 1024

    for (const file of files) {
      const ext = getFileExtension(file.name)
      const inlineable = (limit) => file.size <= limit

      if (IMAGE_EXTENSIONS.includes(ext)) {
        const url = inlineable(LIMIT_IMG)
          ? await fileToDataUrl(file).catch(() => URL.createObjectURL(file))
          : URL.createObjectURL(file)
        addImageNode(url, file.name, position)
      } else if (VIDEO_EXTENSIONS.includes(ext)) {
        const url = inlineable(LIMIT_VIDEO)
          ? await fileToDataUrl(file).catch(() => URL.createObjectURL(file))
          : URL.createObjectURL(file)
        addVideoNode(url, file.name, '', position, false, { format: ext })
      } else if (DOC_EXTENSIONS.includes(ext)) {
        const url = inlineable(LIMIT_DOC)
          ? await fileToDataUrl(file).catch(() => URL.createObjectURL(file))
          : URL.createObjectURL(file)
        addFileNode(file.name, url, file.size, position)
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
        const url = inlineable(LIMIT_DOC)
          ? await fileToDataUrl(file).catch(() => URL.createObjectURL(file))
          : URL.createObjectURL(file)
        addFileNode(file.name, url, file.size, position)
      }
    }

    // 上传完自动保存 — 触发 SaveExportToolbar 的快照 (yjs 已自动同步, 这里给本地持久化兜底)
    window.dispatchEvent(new CustomEvent('canvas-auto-save', { detail: { trigger: 'file-upload' } }))
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
      const { action, relationType, color, name, category, tags, mode } = e.detail
      const store = useCanvasStore.getState()
      switch (action) {
        case 'groupAnalyzeMeta': {
          // 圈选组合元认知 — 生成新组合分析节点并连边
          const selectedIds = store.nodes.filter((n) => n.selected).map((n) => n.id)
          if (selectedIds.length < 2) {
            console.warn('[selection] 组合分析至少需要 2 个节点')
            return
          }
          store.analyzeGroupMetaCognitive(selectedIds).catch((err) => {
            console.error('[selection] groupAnalyzeMeta failed:', err)
          })
          break
        }
        case 'batchAdvance': {
          // 批量推进 — 对每个选中节点跑同一动作
          const selectedIds = store.nodes.filter((n) => n.selected).map((n) => n.id)
          if (selectedIds.length === 0) return
          store.batchAdvance(selectedIds, mode || 'analyze')
            .then((r) => console.log(`[selection] batchAdvance ${mode}: ${r.ok}/${r.total} 成功 ${r.fail} 失败 ${r.skipped} 跳过`))
            .catch((err) => console.error('[selection] batchAdvance failed:', err))
          break
        }
        case 'castToChannel': {
          // 投送到目标频道 — 拷贝选中节点 + 子树到目标 room (本地原节点保留)
          const selectedIds = store.nodes.filter((n) => n.selected).map((n) => n.id)
          const targetRoom = e.detail?.targetRoom
          if (!selectedIds.length || !targetRoom) return
          store.castNodesToChannel(selectedIds, targetRoom)
            .then((r) => {
              alert(`已投送 ${r.castedCount} 个节点 + ${r.edgeCount} 条边到 ${r.targetRoom}\n\n本地原节点已保留 + 打 publishedTo 标记`)
            })
            .catch((err) => {
              console.error('[selection] castToChannel failed:', err)
              alert(`投送失败:\n${err?.message || err}\n\n常见原因: yws-server 没起 / 目标 room 连接超时`)
            })
          break
        }
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
        case 'arrangeSelected': {
          // 圈选自动排列: mode = horizontal / vertical / grid
          const sel = store.nodes.filter((n) => n.selected)
          if (sel.length < 2) {
            console.warn('[selection] 排列至少需要 2 个节点')
            break
          }
          // 按当前 X+Y 排序保持视觉顺序
          sel.sort((a, b) => (a.position.x + a.position.y) - (b.position.x + b.position.y))
          // 用排序后第一个节点的 position 当原点 (保持其位置不变)
          const origin = { x: sel[0].position.x, y: sel[0].position.y }
          const COL_W = 260
          const ROW_H = 200
          const arrangeMode = mode || e.detail.arrangeMode || 'horizontal'
          let positions = []
          if (arrangeMode === 'horizontal') {
            positions = sel.map((_, i) => ({ x: origin.x + i * COL_W, y: origin.y }))
          } else if (arrangeMode === 'vertical') {
            positions = sel.map((_, i) => ({ x: origin.x, y: origin.y + i * ROW_H }))
          } else if (arrangeMode === 'grid') {
            const cols = Math.ceil(Math.sqrt(sel.length))
            positions = sel.map((_, i) => ({
              x: origin.x + (i % cols) * COL_W,
              y: origin.y + Math.floor(i / cols) * ROW_H,
            }))
          }
          // 一次性写回 (走 setNodes 触发 yjsSync)
          const idToPos = new Map(sel.map((n, i) => [n.id, positions[i]]))
          const next = store.nodes.map((n) => {
            const p = idToPos.get(n.id)
            return p ? { ...n, position: p } : n
          })
          store.setNodes(next)
          console.log(`[selection] 排列 ${sel.length} 节点 → ${arrangeMode}`)
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

    // 自动保存 — 上传文件后或其他触发点, 直接写入项目库 (yjs 已自动同步, 这里给本地项目库做归档)
    // 节流 5s, 避免短时间多次触发产生大量重复快照
    let _lastAutoSaveTs = 0
    const onAutoSave = async (e) => {
      const now = Date.now()
      if (now - _lastAutoSaveTs < 5000) return
      _lastAutoSaveTs = now
      try {
        const { saveCurrentCanvasAsProject } = await import('../services/projectLibraryActions')
        const trigger = e?.detail?.trigger || 'auto'
        const titlePrefix = trigger === 'file-upload' ? '文件上传后归档' : '自动归档'
        const title = `${titlePrefix} · ${new Date().toLocaleString('zh-CN', { hour12: false })}`
        saveCurrentCanvasAsProject({ title, source: 'manual', tags: ['auto', trigger] })
        console.log('[auto-save] 已写入项目库:', title)
      } catch (err) {
        console.warn('[auto-save] 失败:', err?.message || err)
      }
    }

    // 反驳节点的"二次验证"按钮 — 让 LLM 反思这个反驳是否切合实际, 给可信度评分
    // (用户图 43 反馈: 反驳脱离实际, 比如 PDF 不会超 1GB 但反驳照搬 OOM 风险)
    const onVerifyHermes = async (e) => {
      const { challengeId, claim, angle, severity, sourceTitle } = e.detail || {}
      if (!challengeId || !claim) return
      const store = useCanvasStore.getState()
      store.updateNode(challengeId, { verifyRunning: true })
      try {
        const { callLLM } = await import('../services/aiProvider')
        const { tryParseLLMJson } = await import('../services/aiService')
        const system = `你是 Hermes 二次审查官. 给定一个对原方案的反驳, 你要判断这个反驳是否站得住脚 — 是否切合实际语境 (避免 LLM 编造不切实际的论点, 比如假设 PDF 超 1GB 之类).
按 JSON 输出: { "score": 0-100 整数 (反驳的可信度), "verdict": "成立"|"勉强"|"不成立", "reason": "一句话理由 (50 字内)" }`
        const prompt = `原方案 (针对): ${sourceTitle || '未知'}
反驳角度: ${angle || ''}
反驳论点: ${claim}
反驳严重度: ${severity || 'medium'}

请审视这个反驳是否切合实际, 还是 LLM 想当然脱离场景的臆测? 评分 + 一句话理由.`
        const raw = await callLLM({ system, prompt, jsonMode: true })
        const parsed = tryParseLLMJson(raw)
        const score = typeof parsed?.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50
        const verdict = parsed?.verdict || (score >= 70 ? '成立' : score >= 40 ? '勉强' : '不成立')
        const reason = parsed?.reason || '审查官未给出理由'
        useCanvasStore.getState().updateNode(challengeId, {
          verifyRunning: false,
          verification: { score, verdict, reason, ts: Date.now() },
        })
      } catch (err) {
        console.error('[verify-hermes] 失败:', err)
        useCanvasStore.getState().updateNode(challengeId, {
          verifyRunning: false,
          verification: { score: 0, verdict: '审查失败', reason: err?.message || String(err) },
        })
      }
    }

    // 反驳节点的"下一步"按钮 — 把 todos 派给元认知, 串成下一轮可执行项目
    const onChainTodos = (e) => {
      const { challengeId, todos = [], claim = '', sourceTitle = '' } = e.detail || {}
      if (!challengeId || !Array.isArray(todos) || todos.length === 0) return
      const store = useCanvasStore.getState()
      // 标记 chainRunning, 让按钮显示"规划中..."
      store.updateNode(challengeId, { chainRunning: true })
      // 把 todos 拼成 prompt
      const prompt = [
        `针对反驳"${claim}"产出的待办事项, 请规划成下一轮可执行任务并自主推导:`,
        ...todos.map((t, i) => `${i + 1}. ${t}`),
        sourceTitle ? `\n上下文: 这些待办源于对"${sourceTitle}"的反驳。` : '',
      ].filter(Boolean).join('\n')
      // 派给元认知 (异步, 不阻塞)
      Promise.resolve()
        .then(() => store.askAndStartMetaProject(prompt))
        .catch((err) => console.error('[chain-todos] 派单失败:', err))
        .finally(() => {
          // 无论成功失败, 解除按钮 loading 状态
          useCanvasStore.getState().updateNode(challengeId, { chainRunning: false })
        })
    }

    // 外部源 watch 节点同步 — BookmarkNode 角标点击派来 (详见 docs/source-watch-sync-spec.md §9.1)
    const onSourceSyncNode = async (e) => {
      const { nodeId, force } = e.detail || {}
      if (!nodeId) return
      const store = useCanvasStore.getState()
      if (typeof store.syncNodeFromSource !== 'function') {
        console.warn('[source-sync-node] syncNodeFromSource action 未实现')
        return
      }
      try {
        const r = await store.syncNodeFromSource(nodeId, { force: !!force })
        if (r?.conflict) {
          // MVP: 简单 confirm, Phase 2 换 modal + diff
          if (window.confirm('本地修改与远端都有更新, 同步将覆盖本地修改. 是否继续?')) {
            await store.syncNodeFromSource(nodeId, { force: true })
          }
        } else {
          pushLog({ level: 'info', source: 'source-watch', msg: `已同步: ${r?.title || nodeId}` })
        }
      } catch (err) {
        pushLog({ level: 'warn', source: 'source-watch', msg: `同步失败 ${nodeId}: ${err?.message || err}` })
      }
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
    window.addEventListener('challenge:chain-todos', onChainTodos)
    window.addEventListener('challenge:verify-hermes', onVerifyHermes)
    window.addEventListener('canvas-auto-save', onAutoSave)
    window.addEventListener('source-sync-node', onSourceSyncNode)

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
      window.removeEventListener('challenge:chain-todos', onChainTodos)
      window.removeEventListener('challenge:verify-hermes', onVerifyHermes)
      window.removeEventListener('canvas-auto-save', onAutoSave)
      window.removeEventListener('source-sync-node', onSourceSyncNode)
    }
  }, [handleFileDrop, addBookmarkNode, addConceptNode, addNoteNode, addImageNode, addVideoNode, addFileNode, onNodesChange])

  // === 外部源 watch 自动 polling (#19) ===
  // mode === 'auto' 时后台周期检查更新; idle (5min 无操作 OR tab 隐藏) 改 10min/次
  useEffect(() => {
    // 启动时从 localStorage 恢复 mode
    const saved = (() => {
      try { return localStorage.getItem('sourceWatchMode') } catch { return null }
    })()
    if (saved === 'auto' || saved === 'manual') {
      useCanvasStore.getState().setSourceWatchMode(saved)
    }

    let lastActivityAt = Date.now()
    const bumpActivity = () => { lastActivityAt = Date.now() }
    const events = ['mousemove', 'keydown', 'click', 'wheel']
    events.forEach((e) => window.addEventListener(e, bumpActivity, { passive: true }))

    const tick = async () => {
      const state = useCanvasStore.getState()
      const watch = state.sourceWatch || {}
      if (watch.mode !== 'auto' || !watch.enabled || watch.inFlight) return
      // 没有 sourceMeta 节点就不跑 (省得 spam)
      const hasTargets = state.nodes.some((n) => {
        const m = n.data?.sourceMeta
        return m && (m.platform === 'feishu' || m.platform === 'notion')
      })
      if (!hasTargets) return
      // idle 判定: 5min 无操作 OR tab 隐藏 → 10min/次, 否则 60s/次
      const isIdle = (Date.now() - lastActivityAt) > 5 * 60 * 1000 || document.visibilityState === 'hidden'
      const wantedInterval = isIdle ? 10 * 60 * 1000 : 60 * 1000
      const sinceLast = Date.now() - (watch.lastRunAt || 0)
      if (sinceLast < wantedInterval) return
      try {
        const r = await state.checkSourceUpdates()
        if (r && !r.skipped) console.log('[watch-auto]', r)
      } catch (e) {
        console.error('[watch-auto] error', e)
      }
    }
    // 每 30s 检查一次条件 (实际 fetch 受 wantedInterval 节流)
    const timer = setInterval(tick, 30 * 1000)
    // 启动后 5s 跑一次 (避免每次刷新等 30s)
    const initial = setTimeout(tick, 5000)

    return () => {
      events.forEach((e) => window.removeEventListener(e, bumpActivity))
      clearInterval(timer)
      clearTimeout(initial)
    }
  }, [])

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
      // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — 撤销/重做 (走 Yjs UndoManager, 协作友好)
      // 输入框内不拦截, 让浏览器原生 undo 处理文本编辑
      if (!isInput && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault()
        import('../collab/yjsClient').then(({ undo }) => undo())
      }
      if (!isInput && (e.ctrlKey || e.metaKey) && ((e.key === 'z' || e.key === 'Z') && e.shiftKey || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        import('../collab/yjsClient').then(({ redo }) => redo())
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
          onLoadProject={handleLoadProjectFromTab}
          onFocusNode={handleFocusNode}
        />
      )}

      {/* 中央画布区域 */}
      <div className="flex-1 relative" ref={(el) => { canvasRef.current = el; wrapperRef.current = el }}>
        {/* 左组顶栏 — 折叠 + ALETHEIA + 频道 + 场景 + SaveExportToolbar (一行 flex 防重叠) */}
        <div
          className="absolute top-4 z-30 flex items-center gap-3 transition-all duration-500"
          style={{ left: showLeftPanel ? 272 : 16 }}
        >
          <button
            onClick={() => setShowLeftPanel(prev => !prev)}
            className="p-2 rounded-lg shadow-sm transition-all duration-300"
            style={{
              background: 'var(--white)',
              border: `1px solid ${showLeftPanel ? 'var(--warm)' : 'var(--gray-100)'}`,
              color: showLeftPanel ? 'var(--warm)' : 'var(--gray-500)',
            }}
            title="切换左侧面板 (Ctrl+B)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
          {/* ALETHEIA 品牌标识 */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg shadow-sm"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border-subtle)',
              backdropFilter: 'blur(8px)',
              fontFamily: '"Noto Serif SC", Georgia, serif',
            }}
            title="ALETHEIA — 逻辑对抗决策引擎"
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: 'var(--accent)' }}
            />
            <span
              className="text-xs font-medium"
              style={{ color: 'var(--text-primary)', letterSpacing: '0.35em' }}
            >
              ALETHEIA
            </span>
          </div>
          {/* 频道切换 — 默认收起胶囊, 私人/公共/最近/自定义 */}
          <ChannelSwitcher />
          {/* toB/toC/toG 场景切换 — 默认收起胶囊, 点击展开 */}
          <ScenarioSwitcher />
          {/* 保存/排序/外部源/⚙️ 工具栏 — 跟左组同行排, 不再居中 */}
          <SaveExportToolbar
            canvasRef={canvasRef}
            nodes={nodes}
            edges={edges}
            exportCanvasData={exportCanvasData}
            importCanvasData={importCanvasData}
          />
        </div>

        {/* 右侧顶栏 — 协作信息 + 项目库 + 右栏折叠, 一行 flex 防重叠 */}
        <div
          className="absolute top-4 z-30 flex gap-2 items-center transition-all duration-500 justify-end"
          style={{ right: showRightPanel ? rightPanelWidth + 16 : 16 }}
        >
          <CollabHeader
            room={room}
            username={username}
            onOpenAiSettings={() => setShowAiSettings(true)}
            onExit={exitSession}
          />
          <ProjectLibraryButton onOpen={() => setShowProjectLibrary(true)} />
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
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={isPlayback ? noopHandler : onNodesChange}
          onEdgesChange={isPlayback ? noopHandler : onEdgesChange}
          onConnect={isPlayback ? noopHandler : onConnect}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onNodeDragStop={isPlayback ? noopHandler : handleNodeDragStop}
          showMiniMap={true}
        >
          <CursorAwarenessLayer wrapperRef={wrapperRef} nodes={nodes} />
          <NodeBadgeLayer wrapperRef={wrapperRef} nodes={nodes} />
          {nodes.length === 0 && <WelcomeOverlay onShowShortcuts={() => setShowShortcuts(true)} />}
        </KnowledgeCanvas>

        <BottomAIBar
          showLeftPanel={showLeftPanel}
          showRightPanel={showRightPanel}
          rightPanelWidth={rightPanelWidth}
          onExtractConcepts={handleExtractConcepts}
          onSuggestRelations={handleSuggestRelations}
          concepts={conceptsForAI}
        />

        <CostMeterChip />
        <TimelineDock />
        <PlaybackScrubber />

        {/* 回放视觉边框 — 让用户一眼看出"在回放" */}
        {isPlayback && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              boxShadow: 'inset 0 0 0 3px rgba(200,168,130,0.55), inset 0 0 32px rgba(200,168,130,0.18)',
              zIndex: 50,
              animation: 'playbackPulse 2.4s ease-in-out infinite',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 70,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(200,168,130,0.95)',
                color: '#fff',
                padding: '4px 14px',
                fontSize: 10,
                letterSpacing: '0.35em',
                borderRadius: 2,
                fontFamily: '"Noto Sans SC", system-ui, sans-serif',
                boxShadow: '0 4px 12px rgba(200,168,130,0.4)',
              }}
            >
              PLAYBACK · 回放模式
            </div>
            <style>{`
              @keyframes playbackPulse {
                0%, 100% { box-shadow: inset 0 0 0 3px rgba(200,168,130,0.55), inset 0 0 32px rgba(200,168,130,0.18); }
                50% { box-shadow: inset 0 0 0 3px rgba(200,168,130,0.75), inset 0 0 48px rgba(200,168,130,0.28); }
              }
            `}</style>
          </div>
        )}
      </div>

      {showRightPanel && (
        <RightPanel
          selectedNode={selectedNode}
          edges={edges}
          nodes={nodes}
          expanded={rightPanelExpanded}
          onToggleExpanded={() => setRightPanelExpanded(v => !v)}
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
      {showProjectLibrary && (
        <ProjectLibraryPanel
          open={showProjectLibrary}
          onClose={() => setShowProjectLibrary(false)}
          onLoadProject={(project) => {
            const r = loadProjectToCanvas(project.id)
            setShowProjectLibrary(false)
            if (r?.ok) {
              pushLog({ level: 'info', source: 'project-library', msg: `已载入项目: ${project.title || ''}` })
            } else {
              pushLog({ level: 'warn', source: 'project-library', msg: `载入项目失败: ${r?.reason || 'unknown'}` })
            }
          }}
        />
      )}
      <CliMonitor />
    </div>
  )
}
