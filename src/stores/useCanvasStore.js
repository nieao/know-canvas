/**
 * Know-Canvas - 画布状态管理 (Zustand)
 * 知识图谱画布核心状态
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from 'reactflow'
import { fetchLinkMetadata, detectVideoUrl } from '../utils/linkPreview'

// 元认知 5 步顺序 (与 services/metaCognitiveExecutor STEP_DEFS 同步, 避免循环 import)
const META_STEP_ORDER = ['intent', 'decompose', 'execute', 'reflect', 'synthesize']
function getStepIdByIndex(idx) {
  return META_STEP_ORDER[idx] || META_STEP_ORDER[0]
}

// 知识关系类型
export const RELATION_TYPES = {
  RELATED: { id: 'related', label: 'Related', labelCn: '相关', color: '#6b7280', style: 'dashed' },
  CAUSE_EFFECT: { id: 'cause_effect', label: 'Cause & Effect', labelCn: '因果', color: '#ef4444', style: 'solid' },
  PART_OF: { id: 'part_of', label: 'Part Of', labelCn: '组成', color: '#3b82f6', style: 'solid' },
  DEPENDS_ON: { id: 'depends_on', label: 'Depends On', labelCn: '依赖', color: '#f97316', style: 'solid' },
  SIMILAR: { id: 'similar', label: 'Similar', labelCn: '相似', color: '#22c55e', style: 'dashed' },
  CONTRADICTS: { id: 'contradicts', label: 'Contradicts', labelCn: '矛盾', color: '#a855f7', style: 'solid' },
  SEQUENCE: { id: 'sequence', label: 'Sequence', labelCn: '顺序', color: '#06b6d4', style: 'solid' },
  REFERENCE: { id: 'reference', label: 'Reference', labelCn: '引用', color: '#f59e0b', style: 'dashed' },
}

// 节点类型
export const NODE_TYPES = {
  CONCEPT: 'conceptNode',
  CATEGORY: 'categoryNode',
  BOOKMARK: 'bookmarkNode',
  IMAGE: 'imageNode',
  VIDEO: 'videoNode',
  NOTE: 'noteNode',
  FILE: 'fileNode',
  GROUP: 'groupNode',
}

// 布局常量
const LAYOUT = {
  NODE_WIDTH: 200,
  NODE_HEIGHT: 120,
  GRID_GAP_X: 250,
  GRID_GAP_Y: 180,
  PADDING: 40,
  HEADER_HEIGHT: 50,
  COMPONENT_GAP: 400,
  CATEGORY_SPACING: 600,
}

// 通用节点工厂，确保创建一致性
const createNodeFactory = (get, set) => (type, idPrefix, data, position = null) => {
  const pos = position || get().getNextGridPosition()
  const rand = Math.random().toString(36).slice(2, 8)
  const nodeId = `${idPrefix}-${Date.now()}-${rand}`

  const newNode = {
    id: nodeId,
    type,
    position: pos,
    data,
  }

  set((state) => {
    state.nodes.push(newNode)
  })

  return nodeId
}

const useCanvasStore = create(
  persist(
    immer((set, get) => ({
      // React Flow 状态
      nodes: [],
      edges: [],

      // UI 状态
      selectedNodeId: null,
      selectedEdgeId: null,
      viewMode: 'graph',
      showMiniMap: true,
      showChineseLabels: true,

      // 全局任务模式 — 决策层路由器使用
      // 'auto'   = 自动路由 (TaskRouter 按复杂度判断 local 还是 hermes)
      // 'local'  = 强制本地 (callLLM)
      // 'hermes' = 强制 Hermes (走 orchestra inject)
      // 初始化时从 localStorage 读取，setTaskMode 时写回
      taskMode:
        (typeof localStorage !== 'undefined' &&
          localStorage.getItem('know_canvas_task_mode')) ||
        'auto',

      // 自动排序方向 — 'TB' 竖排 / 'LR' 横排
      // 由 SaveExportToolbar 横/竖切换控制, 影响 applyAutoLayout 的 direction 入参
      layoutDirection:
        (typeof localStorage !== 'undefined' &&
          localStorage.getItem('know_canvas_layout_dir')) ||
        'TB',

      // 视口状态，用于定位新节点到视图中心
      viewportCenter: { x: 400, y: 300 },
      viewportZoom: 1,

      // 更新视口中心（由画布组件在视口变化时调用）
      setViewportCenter: (center, zoom = 1) => {
        set({ viewportCenter: center, viewportZoom: zoom })
      },

      // 设置自动排序方向 ('TB' | 'LR'), 写回 localStorage
      setLayoutDirection: (dir) => {
        const next = dir === 'LR' ? 'LR' : 'TB'
        if (typeof localStorage !== 'undefined') {
          try { localStorage.setItem('know_canvas_layout_dir', next) } catch {}
        }
        set({ layoutDirection: next })
      },

      // 一键应用自动布局 — SaveExportToolbar "排序" 按钮调这个
      // 横排(LR): 边 sourceHandle='right' / targetHandle='left' (节点上有命名 handle)
      // 竖排(TB): 清空 sourceHandle/targetHandle, react-flow 用节点 default top/bottom handle
      applyAutoLayout: async () => {
        const { nodes, edges, layoutDirection } = get()
        if (!nodes || nodes.length === 0) {
          return { count: 0, direction: layoutDirection }
        }
        const mod = await import('../utils/autoLayout')
        const nextNodes = mod.smartLayout(nodes, edges, { direction: layoutDirection })
        const isLR = layoutDirection === 'LR'
        const nextEdges = (edges || []).map((e) => {
          const { sourceHandle: _sh, targetHandle: _th, ...rest } = e
          if (isLR) {
            return { ...rest, sourceHandle: 'right', targetHandle: 'left' }
          }
          return rest
        })
        set({ nodes: nextNodes, edges: nextEdges })
        return { count: nextNodes.length, direction: layoutDirection }
      },

      // 筛选状态
      filterByCategory: null,
      filterBySource: null,
      filterByType: null,

      // 基础 React Flow 操作
      setNodes: (nodes) => set({ nodes }),
      setEdges: (edges) => set({ edges }),

      onNodesChange: (changes) => {
        set((state) => {
          state.nodes = applyNodeChanges(changes, state.nodes)
        })
      },

      onEdgesChange: (changes) => {
        set((state) => {
          state.edges = applyEdgeChanges(changes, state.edges)
        })
      },

      onConnect: (connection) => {
        set((state) => {
          const edge = {
            ...connection,
            id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            // smoothstep = 带圆角正交折线, 比 curved/default 更"工程图"感
            type: 'smoothstep',
            animated: false,
            data: { relationType: 'related' },
            style: { stroke: RELATION_TYPES.RELATED.color, strokeWidth: 1.5 },
          }
          state.edges = addEdge(edge, state.edges)
        })
      },

      // 切换中文标签显示
      toggleChineseLabels: () => {
        set((state) => ({ showChineseLabels: !state.showChineseLabels }))
      },

      // 计算下一个可用网格位置（螺旋算法避免重叠）
      getNextGridPosition: () => {
        const { nodes } = get()
        if (nodes.length === 0) return { x: 100, y: 100 }

        // 构建已占用网格位置集合
        const occupied = new Set()
        nodes.forEach(n => {
          const gridX = Math.round(n.position.x / LAYOUT.GRID_GAP_X)
          const gridY = Math.round(n.position.y / LAYOUT.GRID_GAP_Y)
          occupied.add(`${gridX},${gridY}`)
        })

        // 从原点螺旋向外寻找第一个可用位置
        let x = 0, y = 0
        let dx = 1, dy = 0
        let steps = 1, stepCount = 0, turnCount = 0

        while (occupied.has(`${x},${y}`)) {
          x += dx
          y += dy
          stepCount++

          if (stepCount === steps) {
            stepCount = 0
            ;[dx, dy] = [-dy, dx]
            turnCount++
            if (turnCount === 2) {
              turnCount = 0
              steps++
            }
          }
        }

        return {
          x: 100 + x * LAYOUT.GRID_GAP_X,
          y: 100 + y * LAYOUT.GRID_GAP_Y,
        }
      },

      // 添加概念节点
      addConceptNode: (concept, position = null) => {
        const { nodes, getNextGridPosition } = get()

        // 检查是否已存在同名概念
        const exists = nodes.find(n =>
          n.type === 'conceptNode' && n.data?.title === concept.title
        )
        if (exists) return exists.id

        const pos = position || getNextGridPosition()
        const nodeId = `concept-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        const newNode = {
          id: nodeId,
          type: 'conceptNode',
          position: pos,
          data: {
            title: concept.title || '未命名概念',
            description: concept.description || '',
            tags: concept.tags || [],
            source: concept.source || '',
            categoryId: concept.categoryId || null,
            createdAt: Date.now(),
          },
        }

        set((state) => {
          state.nodes.push(newNode)
        })

        return nodeId
      },

      // 添加分类节点
      addCategoryNode: (name, color = '#8b5cf6', position = null) => {
        const { nodes, getNextGridPosition } = get()

        const exists = nodes.find(n =>
          n.type === 'categoryNode' && n.data?.name === name
        )
        if (exists) return exists.id

        const pos = position || getNextGridPosition()
        const nodeId = `category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        const newNode = {
          id: nodeId,
          type: 'categoryNode',
          position: pos,
          data: {
            name,
            color,
          },
        }

        set((state) => {
          state.nodes.push(newNode)
        })

        return nodeId
      },

      // 添加书签节点（URL）- 自动获取元数据
      addBookmarkNode: (url, title = '', description = '', favicon = '', image = '', position = null, autoFetch = true) => {
        const { getNextGridPosition } = get()
        const pos = position || getNextGridPosition()
        const nodeId = `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        // 安全提取 hostname 用于 favicon
        let faviconUrl = favicon
        if (!favicon) {
          try {
            faviconUrl = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`
          } catch {
            faviconUrl = ''
          }
        }

        const newNode = {
          id: nodeId,
          type: 'bookmarkNode',
          position: pos,
          data: {
            url,
            title: title || url,
            description: description || '',
            favicon: faviconUrl,
            image: image || '',
            loading: autoFetch && !title,
          },
        }

        set((state) => {
          state.nodes.push(newNode)
        })

        // 自动获取元数据
        if (autoFetch && !title) {
          fetchLinkMetadata(url).then((metadata) => {
            set((state) => {
              const node = state.nodes.find(n => n.id === nodeId)
              if (node) {
                node.data = {
                  ...node.data,
                  title: metadata.title || url,
                  description: metadata.description || '',
                  favicon: metadata.favicon || faviconUrl,
                  image: metadata.image || metadata.screenshot || '',
                  loading: false,
                }
              }
            })
          })
        }

        return nodeId
      },

      // 添加图片节点
      addImageNode: (src, alt = '', position = null) => {
        const { getNextGridPosition } = get()
        const pos = position || getNextGridPosition()
        const nodeId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        const newNode = {
          id: nodeId,
          type: 'imageNode',
          position: pos,
          data: { src, alt },
        }

        set((state) => {
          state.nodes.push(newNode)
        })

        return nodeId
      },

      // 添加视频节点 - 支持在线视频和本地文件
      addVideoNode: (url, title = '', image = '', position = null, autoFetch = true, options = {}) => {
        const { getNextGridPosition } = get()
        const pos = position || getNextGridPosition()
        const nodeId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        let videoId = ''
        let platform = 'other'
        let isLocalFile = false

        // 检测是否为本地文件
        if (url.startsWith('blob:') || url.startsWith('file:')) {
          isLocalFile = true
          platform = 'local'
        } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
          platform = 'youtube'
          const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/)
          videoId = match ? match[1] : ''
        } else if (url.includes('bilibili.com')) {
          platform = 'bilibili'
          const match = url.match(/BV[\w]+/)
          videoId = match ? match[0] : ''
        }

        const newNode = {
          id: nodeId,
          type: 'videoNode',
          position: pos,
          data: {
            url,
            title: title || url,
            videoId,
            platform,
            image: image || '',
            loading: autoFetch && !title && !isLocalFile,
            isLocalFile,
            format: options.format || '',
            duration: options.duration || '',
            thumbnail: options.thumbnail || image || '',
          },
        }

        set((state) => {
          state.nodes.push(newNode)
        })

        // 仅在线视频自动获取元数据
        if (autoFetch && !title && !isLocalFile) {
          fetchLinkMetadata(url).then((metadata) => {
            set((state) => {
              const node = state.nodes.find(n => n.id === nodeId)
              if (node) {
                node.data = {
                  ...node.data,
                  title: metadata.title || url,
                  image: metadata.image || metadata.screenshot || node.data.image,
                  loading: false,
                }
              }
            })
          })
        }

        return nodeId
      },

      // 添加笔记节点
      addNoteNode: (content = '', position = null) => {
        const { getNextGridPosition } = get()
        const pos = position || getNextGridPosition()
        const nodeId = `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        const newNode = {
          id: nodeId,
          type: 'noteNode',
          position: pos,
          data: { content },
        }

        set((state) => {
          state.nodes.push(newNode)
        })

        return nodeId
      },

      // 添加组合节点（图片 + 文字）
      addCombinedNode: (content = '', imageSrc = '', imageAlt = '', position = null) => {
        const { getNextGridPosition } = get()
        const pos = position || getNextGridPosition()
        const nodeId = `combined-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        const newNode = {
          id: nodeId,
          type: 'noteNode',
          position: pos,
          data: {
            content,
            imageSrc,
            imageAlt,
            isCombined: true,
          },
        }

        set((state) => {
          state.nodes.push(newNode)
        })

        return nodeId
      },

      // 智能 URL 处理 - 自动检测视频或书签
      addUrlNode: (url, position = null) => {
        const { addBookmarkNode, addVideoNode } = get()
        const { isVideo } = detectVideoUrl(url)

        if (isVideo) {
          return addVideoNode(url, '', '', position, true)
        } else {
          return addBookmarkNode(url, '', '', '', '', position, true)
        }
      },

      // 添加文件节点
      addFileNode: (name, url = '', size = 0, position = null) => {
        const { getNextGridPosition } = get()
        const pos = position || getNextGridPosition()
        const nodeId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        const newNode = {
          id: nodeId,
          type: 'fileNode',
          position: pos,
          data: { name, url, size },
        }

        set((state) => {
          state.nodes.push(newNode)
        })

        return nodeId
      },

      // 从文件数据导入概念节点
      importFromFile: (fileData) => {
        const { addConceptNode, addCategoryNode, addRelation } = get()
        const { CATEGORY_SPACING, GRID_GAP_X, GRID_GAP_Y } = LAYOUT

        if (!fileData || !fileData.concepts || fileData.concepts.length === 0) {
          console.warn('导入数据为空或格式不正确')
          return
        }

        // 按分类分组
        const conceptsByCategory = {}
        fileData.concepts.forEach((concept) => {
          const category = concept.category || '未分类'
          if (!conceptsByCategory[category]) conceptsByCategory[category] = []
          conceptsByCategory[category].push(concept)
        })

        const nodeIdMap = {}

        // 创建分类节点和概念节点
        Object.entries(conceptsByCategory).forEach(([category, concepts], catIndex) => {
          const baseX = 150 + catIndex * CATEGORY_SPACING
          const baseY = 200

          // 添加分类节点
          const categoryNodeId = addCategoryNode(category, '#8b5cf6', {
            x: baseX + 150,
            y: baseY - 120,
          })

          // 计算网格布局
          const cols = Math.ceil(Math.sqrt(concepts.length))

          // 添加概念节点
          concepts.forEach((concept, idx) => {
            const row = Math.floor(idx / cols)
            const col = idx % cols
            const position = {
              x: baseX + col * GRID_GAP_X,
              y: baseY + row * GRID_GAP_Y,
            }

            const conceptNodeId = addConceptNode({
              title: concept.title,
              description: concept.description || '',
              tags: concept.tags || [],
              source: fileData.source || '',
              categoryId: category,
            }, position)

            nodeIdMap[concept.title] = conceptNodeId

            // 连接概念到分类
            addRelation(conceptNodeId, categoryNodeId, 'part_of')
          })
        })

        return nodeIdMap
      },

      // 从文本解析并创建概念节点
      addConceptsFromText: (text) => {
        const { addConceptNode } = get()

        if (!text || !text.trim()) return []

        // 按段落分割文本
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim())
        const createdIds = []

        paragraphs.forEach((paragraph) => {
          const trimmed = paragraph.trim()
          if (!trimmed) return

          // 尝试提取标题（第一行作为标题）
          const lines = trimmed.split('\n')
          let title = lines[0].replace(/^#+\s*/, '').trim()
          let description = lines.slice(1).join('\n').trim()

          // 如果只有一行，使用前30个字符作为标题
          if (!description) {
            if (title.length > 30) {
              description = title
              title = title.slice(0, 30) + '...'
            }
          }

          const nodeId = addConceptNode({
            title,
            description,
            tags: [],
            source: '文本导入',
          })

          createdIds.push(nodeId)
        })

        return createdIds
      },

      // 添加关系边（支持中文标签）
      addRelation: (sourceId, targetId, relationType = 'related', customLabel = '') => {
        const { showChineseLabels } = get()
        const relation = RELATION_TYPES[relationType.toUpperCase()] || RELATION_TYPES.RELATED
        const displayLabel = customLabel || (showChineseLabels ? relation.labelCn : relation.label)

        set((state) => {
          // 检查边是否已存在
          const exists = state.edges.find(
            e => (e.source === sourceId && e.target === targetId) ||
                 (e.source === targetId && e.target === sourceId)
          )
          if (exists) return

          const edge = {
            id: `edge-${sourceId}-${targetId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            source: sourceId,
            target: targetId,
            // smoothstep = 正交折线, 圆角拐弯, 工程图感
            type: 'smoothstep',
            animated: relation.style === 'dashed',
            data: {
              relationType: relation.id,
              label: relation.label,
              labelCn: relation.labelCn,
            },
            style: {
              stroke: relation.color,
              strokeWidth: 1.5,
              strokeDasharray: relation.style === 'dashed' ? '5,5' : '0',
            },
            label: displayLabel,
            labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
            labelStyle: { fill: relation.color, fontSize: 11, fontWeight: 500 },
          }
          state.edges = addEdge(edge, state.edges)
        })
      },

      // 删除节点
      removeNode: (nodeId) => {
        set((state) => {
          const nodeToRemove = state.nodes.find(n => n.id === nodeId)

          // 如果删除的是分组节点，处理子节点
          if (nodeToRemove?.type === 'groupNode') {
            const memberNodeIds = nodeToRemove.data?.memberNodeIds || []
            const groupPosition = nodeToRemove.position

            // 将子节点位置转回绝对坐标，移除父级关系
            state.nodes.forEach(node => {
              if (node.parentNode === nodeId) {
                node.position = {
                  x: node.position.x + groupPosition.x,
                  y: node.position.y + groupPosition.y,
                }
                delete node.parentNode
                delete node.extent
                node.hidden = false
                node.draggable = true
                if (node.data) {
                  node.data = { ...node.data, groupId: null }
                }
              }
            })

            state.edges = state.edges.filter(
              (e) => e.source !== nodeId && e.target !== nodeId
            )
          } else {
            state.edges = state.edges.filter(
              (e) => e.source !== nodeId && e.target !== nodeId
            )
          }

          state.nodes = state.nodes.filter((n) => n.id !== nodeId)

          if (state.selectedNodeId === nodeId) {
            state.selectedNodeId = null
          }
        })
      },

      // 更新节点数据
      updateNode: (nodeId, data) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (node) {
            node.data = { ...node.data, ...data }
          }
        })
      },

      // 更换节点类型（"模块性质修改"），保留通用字段
      changeNodeType: (nodeId, newType) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (node && node.type !== newType) {
            const preserved = {
              title: node.data?.title || node.data?.name || node.data?.alt || '',
              description: node.data?.description || node.data?.content || '',
              tags: node.data?.tags || [],
              color: node.data?.color,
              category: node.data?.category,
              source: node.data?.source,
              size: node.data?.size,
            }
            node.type = newType
            // noteNode 的核心字段是 content，把 description 映射过去
            if (newType === 'noteNode') {
              preserved.content = preserved.description
            }
            node.data = { ...preserved }
          }
        })
      },

      // ===== 任务模式 + 本地任务 + 任务清单 + 关联 agent/skill =====
      // 决策层 (RightPanel 路由器 + 三模式开关) 用于派单的统一数据模型。

      // 切换全局任务模式 ('auto' | 'local' | 'hermes')，并写入 localStorage
      setTaskMode: (mode) => {
        if (!['auto', 'local', 'hermes'].includes(mode)) return
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('know_canvas_task_mode', mode)
        }
        set({ taskMode: mode })
      },

      // 本地任务 — 添加 (status='pending')，返回 taskId
      addLocalTask: (nodeId, { prompt, target, routerReason }) => {
        const taskId = `ltask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (!node) return
          if (!Array.isArray(node.data.localTasks)) node.data.localTasks = []
          node.data.localTasks.push({
            id: taskId,
            prompt,
            target: target || 'local',
            routerReason: routerReason || '',
            status: 'pending',
            result: null,
            error: null,
            createdAt: Date.now(),
            startedAt: null,
            finishedAt: null,
            durationMs: 0,
          })
        })
        return taskId
      },

      // 本地任务 — 更新状态/字段 (patch merge)
      updateLocalTaskStatus: (nodeId, taskId, patch) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (!node || !Array.isArray(node.data.localTasks)) return
          const task = node.data.localTasks.find((t) => t.id === taskId)
          if (!task) return
          Object.assign(task, patch)
        })
      },

      // 本地任务 — 删除 (附带删掉它派生的所有 metaStepNode + 连边)
      removeLocalTask: (nodeId, taskId) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (!node || !Array.isArray(node.data.localTasks)) return
          node.data.localTasks = node.data.localTasks.filter((t) => t.id !== taskId)
          // 清理元认知步骤节点
          state.nodes = state.nodes.filter((n) => !(n.type === 'metaStepNode' && n.data?.taskId === taskId))
          state.edges = state.edges.filter((e) =>
            !state.nodes.every((n) => n.id !== e.source) &&
            !state.nodes.every((n) => n.id !== e.target)
          )
        })
      },

      // 元认知步骤节点 — 在源节点下方添加一个 pending 占位 (5 步串成一列)
      // 入参: { sourceNodeId, taskId, stepId, index, label, icon, en }
      // 返回新节点 id
      addMetaStepNode: ({ sourceNodeId, taskId, stepId, index, label, icon, en }) => {
        const id = `meta-${taskId}-${stepId}`
        let pos = { x: 100, y: 100 }
        // 用 get() 而不是 set 内部读, 避免 immer draft 引用混淆
        const src = get().nodes.find((n) => n.id === sourceNodeId)
        if (src) {
          // 5 步阶梯布局: 横向往右每步 +260, 纵向小幅下降 +80, 整体形成
          // ↘ 流向, 紧凑且能看到所有 5 步在一屏内 (5 * 260 = 1300px 宽, 4 * 80 = 320px 高)
          pos = {
            x: (src.position?.x ?? 100) + 320 + index * 260,
            y: (src.position?.y ?? 100) + index * 80,
          }
        }
        set((state) => {
          // 防重复 (同 stepId+taskId 已存在则跳过)
          if (state.nodes.some((n) => n.id === id)) return
          state.nodes.push({
            id,
            type: 'metaStepNode',
            position: pos,
            data: {
              taskId,
              stepId,
              index,
              label,
              icon,
              en,
              status: 'pending',
              output: null,
              error: null,
              startedAt: null,
              finishedAt: null,
              durationMs: 0,
            },
          })
          // 连边: 第一步连源节点; 后续连上一步
          const sourceForEdge = index === 0
            ? sourceNodeId
            : `meta-${taskId}-${getStepIdByIndex(index - 1)}`
          state.edges.push({
            id: `edge-meta-${taskId}-${index}`,
            source: sourceForEdge,
            target: id,
            type: 'smoothstep',
            label: index === 0 ? '元认知' : `${index + 1}/5`,
            data: { relationType: '元认知' },
            style: { stroke: '#a07cb8', strokeWidth: 1.2, strokeDasharray: '4 4', opacity: 0.7 },
          })
        })
        return id
      },

      // 元认知步骤节点 — 更新状态 (patch merge 到 data)
      updateMetaStepNodeStatus: (stepNodeId, patch) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === stepNodeId)
          if (!node || node.type !== 'metaStepNode') return
          Object.assign(node.data, patch)
        })
      },

      // 任务清单 — 添加项，返回 itemId
      addChecklistItem: (nodeId, text) => {
        const itemId = `cl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (!node) return
          if (!Array.isArray(node.data.checklist)) node.data.checklist = []
          node.data.checklist.push({ id: itemId, text, done: false })
        })
        return itemId
      },

      // 任务清单 — 切换 done
      toggleChecklistItem: (nodeId, itemId) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (!node || !Array.isArray(node.data.checklist)) return
          const item = node.data.checklist.find((i) => i.id === itemId)
          if (item) item.done = !item.done
        })
      },

      // 任务清单 — 删除项
      removeChecklistItem: (nodeId, itemId) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (!node || !Array.isArray(node.data.checklist)) return
          node.data.checklist = node.data.checklist.filter((i) => i.id !== itemId)
        })
      },

      // 关联 agents — 整体覆盖
      setRelatedAgents: (nodeId, agents) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (!node) return
          node.data.relatedAgents = Array.isArray(agents) ? agents : []
        })
      },

      // 关联 skills — 整体覆盖
      setRelatedSkills: (nodeId, skills) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (!node) return
          node.data.relatedSkills = Array.isArray(skills) ? skills : []
        })
      },

      // 更新节点尺寸
      updateNodeSize: (nodeId, size) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (node) {
            node.data = { ...node.data, size }
          }
        })
      },

      // 选中节点
      selectNode: (nodeId) => {
        set({ selectedNodeId: nodeId })
      },

      // 获取选中节点
      getSelectedNode: () => {
        const { nodes, selectedNodeId } = get()
        return nodes.find((n) => n.id === selectedNodeId)
      },

      // 选中边
      selectEdge: (edgeId) => {
        set({ selectedEdgeId: edgeId })
      },

      // 获取选中边
      getSelectedEdge: () => {
        const { edges, selectedEdgeId } = get()
        return edges.find((e) => e.id === selectedEdgeId)
      },

      // 删除边
      removeEdge: (edgeId) => {
        set((state) => {
          state.edges = state.edges.filter((e) => e.id !== edgeId)
          if (state.selectedEdgeId === edgeId) {
            state.selectedEdgeId = null
          }
        })
      },

      // 更新边的关系类型
      updateEdgeRelation: (edgeId, relationType) => {
        const { showChineseLabels } = get()
        const relation = RELATION_TYPES[relationType.toUpperCase()] || RELATION_TYPES.RELATED

        set((state) => {
          const edge = state.edges.find((e) => e.id === edgeId)
          if (edge) {
            edge.data = {
              ...edge.data,
              relationType: relation.id,
              label: relation.label,
              labelCn: relation.labelCn,
            }
            edge.style = {
              ...edge.style,
              stroke: relation.color,
              strokeDasharray: relation.style === 'dashed' ? '5,5' : '0',
            }
            edge.label = showChineseLabels ? relation.labelCn : relation.label
            edge.labelStyle = { ...edge.labelStyle, fill: relation.color }
            edge.animated = relation.style === 'dashed'
          }
        })
      },

      // 更新边自定义标签
      updateEdgeLabel: (edgeId, customLabel) => {
        set((state) => {
          const edge = state.edges.find((e) => e.id === edgeId)
          if (edge) {
            edge.label = customLabel
            edge.data = { ...edge.data, customLabel }
          }
        })
      },

      // 设置视图模式
      setViewMode: (mode) => {
        set({ viewMode: mode })
      },

      // 切换小地图
      toggleMiniMap: () => {
        set((state) => ({ showMiniMap: !state.showMiniMap }))
      },

      // 筛选操作
      setFilterByCategory: (categoryId) => set({ filterByCategory: categoryId }),
      setFilterBySource: (source) => set({ filterBySource: source }),
      setFilterByType: (type) => set({ filterByType: type }),
      clearFilters: () => set({ filterByCategory: null, filterBySource: null, filterByType: null }),

      // 自动布局（按分类网格排列）
      autoLayout: () => {
        set((state) => {
          const conceptNodes = state.nodes.filter(n => n.type === 'conceptNode')
          const categoryNodes = state.nodes.filter(n => n.type === 'categoryNode')
          const otherNodes = state.nodes.filter(n => !['conceptNode', 'categoryNode'].includes(n.type))

          // 按分类归组
          const conceptsByCategory = {}
          conceptNodes.forEach((node) => {
            const category = node.data?.categoryId || '未分类'
            if (!conceptsByCategory[category]) conceptsByCategory[category] = []
            conceptsByCategory[category].push(node)
          })

          const categoryCount = Object.keys(conceptsByCategory).length || 1

          // 布局每个分类组
          Object.entries(conceptsByCategory).forEach(([category, concepts], catIndex) => {
            const baseX = 150 + catIndex * LAYOUT.CATEGORY_SPACING
            const baseY = 150

            // 分类节点放在概念节点上方
            const categoryNode = categoryNodes.find(n => n.data?.name === category)
            if (categoryNode) {
              categoryNode.position = { x: baseX + 150, y: baseY - 80 }
            }

            // 概念节点网格布局
            const cols = Math.ceil(Math.sqrt(concepts.length))
            concepts.forEach((node, i) => {
              const row = Math.floor(i / cols)
              const col = i % cols
              node.position = {
                x: baseX + col * LAYOUT.GRID_GAP_X,
                y: baseY + row * LAYOUT.GRID_GAP_Y,
              }
            })
          })

          // 其他节点放在右侧
          const otherBaseX = categoryCount * LAYOUT.CATEGORY_SPACING + 200
          otherNodes.forEach((node, i) => {
            const row = Math.floor(i / 3)
            const col = i % 3
            node.position = {
              x: otherBaseX + col * LAYOUT.GRID_GAP_X,
              y: 150 + row * LAYOUT.GRID_GAP_Y,
            }
          })
        })
      },

      // 智能拓扑布局 - 力导向/放射/层级
      smartLayout: (layoutType = 'force') => {
        set((state) => {
          const visibleNodes = state.nodes.filter(n => !n.hidden)
          const visibleEdges = state.edges.filter(e => !e.hidden)

          if (visibleNodes.length === 0) return

          // 构建邻接表
          const adjacency = {}
          visibleNodes.forEach(n => { adjacency[n.id] = [] })
          visibleEdges.forEach(e => {
            if (adjacency[e.source]) adjacency[e.source].push(e.target)
            if (adjacency[e.target]) adjacency[e.target].push(e.source)
          })

          // 查找连通分量
          const visited = new Set()
          const components = []

          const dfs = (nodeId, component) => {
            if (visited.has(nodeId)) return
            visited.add(nodeId)
            component.push(nodeId)
            adjacency[nodeId]?.forEach(neighbor => dfs(neighbor, component))
          }

          visibleNodes.forEach(n => {
            if (!visited.has(n.id)) {
              const component = []
              dfs(n.id, component)
              components.push(component)
            }
          })

          // 逐分量布局
          let componentOffsetX = 100
          const { COMPONENT_GAP } = LAYOUT

          components.forEach((componentIds) => {
            const componentNodes = visibleNodes.filter(n => componentIds.includes(n.id))

            if (layoutType === 'force') {
              // 力导向布局
              const maxIterations = 50
              const convergenceThreshold = 0.5
              const attractionForce = 0.05
              const repulsionForce = 5000
              const centerForce = 0.01
              const dampingFactor = 0.8

              // 初始化为圆形分布
              const positions = {}
              const nodeCount = componentNodes.length
              componentNodes.forEach((node, i) => {
                const angle = (i / nodeCount) * 2 * Math.PI
                const radius = Math.max(150, nodeCount * 30)
                positions[node.id] = {
                  x: componentOffsetX + radius + Math.cos(angle) * radius,
                  y: 300 + Math.sin(angle) * radius,
                  vx: 0,
                  vy: 0,
                }
              })

              const centerX = componentOffsetX + 300
              const centerY = 350

              // 力模拟迭代
              for (let iter = 0; iter < maxIterations; iter++) {
                const cooling = 1 - iter / maxIterations
                let maxVelocity = 0

                componentNodes.forEach(node1 => {
                  const pos1 = positions[node1.id]
                  let fx = 0, fy = 0

                  // 斥力（反平方定律）
                  componentNodes.forEach(node2 => {
                    if (node1.id === node2.id) return
                    const pos2 = positions[node2.id]
                    const dx = pos1.x - pos2.x
                    const dy = pos1.y - pos2.y
                    const distSq = dx * dx + dy * dy
                    const dist = Math.max(1, Math.sqrt(distSq))
                    const force = repulsionForce / distSq * cooling
                    fx += (dx / dist) * force
                    fy += (dy / dist) * force
                  })

                  // 引力（沿边的胡克定律）
                  const neighbors = adjacency[node1.id] || []
                  neighbors.forEach(neighborId => {
                    const pos2 = positions[neighborId]
                    if (!pos2) return
                    const dx = pos2.x - pos1.x
                    const dy = pos2.y - pos1.y
                    fx += dx * attractionForce * cooling
                    fy += dy * attractionForce * cooling
                  })

                  // 中心引力
                  fx += (centerX - pos1.x) * centerForce
                  fy += (centerY - pos1.y) * centerForce

                  // 速度衰减
                  pos1.vx = (pos1.vx + fx) * dampingFactor
                  pos1.vy = (pos1.vy + fy) * dampingFactor
                  pos1.x += pos1.vx
                  pos1.y += pos1.vy

                  const velocity = Math.sqrt(pos1.vx * pos1.vx + pos1.vy * pos1.vy)
                  maxVelocity = Math.max(maxVelocity, velocity)
                })

                // 收敛时提前终止
                if (maxVelocity < convergenceThreshold) {
                  break
                }
              }

              // 应用最终位置
              componentNodes.forEach(node => {
                const nodeRef = state.nodes.find(n => n.id === node.id)
                if (nodeRef) {
                  nodeRef.position = {
                    x: Math.round(positions[node.id].x / 15) * 15,
                    y: Math.round(positions[node.id].y / 15) * 15,
                  }
                }
              })

              const maxX = Math.max(...componentNodes.map(n => positions[n.id].x))
              componentOffsetX = maxX + COMPONENT_GAP

            } else if (layoutType === 'radial') {
              // 放射布局 - 中心节点放在中间，连接节点围绕
              const centerNode = componentNodes.reduce((max, n) =>
                (adjacency[n.id]?.length || 0) > (adjacency[max.id]?.length || 0) ? n : max
              , componentNodes[0])

              const centerX = componentOffsetX + 250
              const centerY = 300

              const centerRef = state.nodes.find(n => n.id === centerNode.id)
              if (centerRef) centerRef.position = { x: centerX, y: centerY }

              const placed = new Set([centerNode.id])
              let ring = 1
              let currentRing = adjacency[centerNode.id]?.filter(id => componentIds.includes(id)) || []

              while (currentRing.length > 0 && ring < 5) {
                const radius = ring * 200
                currentRing.forEach((nodeId, i) => {
                  if (placed.has(nodeId)) return
                  placed.add(nodeId)
                  const angle = (i / currentRing.length) * 2 * Math.PI - Math.PI / 2
                  const nodeRef = state.nodes.find(n => n.id === nodeId)
                  if (nodeRef) {
                    nodeRef.position = {
                      x: Math.round((centerX + Math.cos(angle) * radius) / 15) * 15,
                      y: Math.round((centerY + Math.sin(angle) * radius) / 15) * 15,
                    }
                  }
                })

                const nextRing = []
                currentRing.forEach(nodeId => {
                  adjacency[nodeId]?.forEach(neighborId => {
                    if (!placed.has(neighborId) && componentIds.includes(neighborId)) {
                      nextRing.push(neighborId)
                    }
                  })
                })
                currentRing = [...new Set(nextRing)]
                ring++
              }

              // 放置剩余未连接节点
              componentNodes.forEach((node, i) => {
                if (!placed.has(node.id)) {
                  const nodeRef = state.nodes.find(n => n.id === node.id)
                  if (nodeRef) {
                    nodeRef.position = {
                      x: componentOffsetX + (i % 3) * 200,
                      y: 600 + Math.floor(i / 3) * 150,
                    }
                  }
                }
              })

              componentOffsetX += 600

            } else if (layoutType === 'hierarchical') {
              // 层级/树形布局
              const roots = componentNodes.filter(n =>
                !visibleEdges.some(e => e.target === n.id && componentIds.includes(e.source))
              )

              if (roots.length === 0) roots.push(componentNodes[0])

              const levels = {}
              const assignLevel = (nodeId, level) => {
                if (levels[nodeId] !== undefined && levels[nodeId] <= level) return
                levels[nodeId] = level
                adjacency[nodeId]?.forEach(neighborId => {
                  if (componentIds.includes(neighborId)) {
                    assignLevel(neighborId, level + 1)
                  }
                })
              }

              roots.forEach(root => assignLevel(root.id, 0))

              // 按层分组
              const nodesByLevel = {}
              componentNodes.forEach(node => {
                const level = levels[node.id] ?? 0
                if (!nodesByLevel[level]) nodesByLevel[level] = []
                nodesByLevel[level].push(node)
              })

              // 定位节点
              Object.entries(nodesByLevel).forEach(([level, levelNodes]) => {
                const levelNum = parseInt(level)
                const levelWidth = levelNodes.length * 220
                const startX = componentOffsetX + Math.max(0, (500 - levelWidth) / 2)

                levelNodes.forEach((node, i) => {
                  const nodeRef = state.nodes.find(n => n.id === node.id)
                  if (nodeRef) {
                    nodeRef.position = {
                      x: startX + i * 220,
                      y: 100 + levelNum * 180,
                    }
                  }
                })
              })

              componentOffsetX += Math.max(500, Object.values(nodesByLevel).reduce((max, lvl) =>
                Math.max(max, lvl.length * 220), 0)) + COMPONENT_GAP
            }
          })
        })
      },

      // 清空画布
      clearCanvas: () => {
        set({
          nodes: [],
          edges: [],
          selectedNodeId: null,
          selectedEdgeId: null,
        })
      },

      // 加载演示数据：黑金 02 主题配套的"产品方案对抗"演示
      // 6 节点 + 4 边 — 中心 ontology 节点（AI 知识助手），衍生出技术栈/用户场景两个 concept,
      // 一个 challenge 反驳延迟问题，一个 task 节点接收灰度任务，一个 note 节点放备注
      loadDemoBlackgold: () => {
        const ts = Date.now()
        const rand = () => Math.random().toString(36).slice(2, 8)

        // 节点 id（一次性生成，便于建边）
        const idOnto = `onto-${ts}-${rand()}`
        const idTech = `concept-${ts}-${rand()}`
        const idScene = `concept-${ts}-${rand()}`
        const idChall = `challenge-${ts}-${rand()}`
        const idTask = `task-${ts}-${rand()}`
        const idNote = `note-${ts}-${rand()}`

        // 竖向树布局：中心 ontology 顶部，左右两个 concept，再下一级是 challenge / task / note
        const CX = 400        // 中心 X
        const COL = 320       // 列间距
        const ROW = 200       // 行间距

        const nodes = [
          // 1) 中心 ontology — 项目目标
          {
            id: idOnto,
            type: 'ontologyNode',
            position: { x: CX, y: 0 },
            data: {
              variant: 'goal',
              title: 'AI 知识助手',
              description: '为团队构建可对抗的知识图谱画布',
              sentence: '为团队构建可对抗的知识图谱画布',
              created_at: ts,
            },
          },
          // 2) 左 concept — 技术栈
          {
            id: idTech,
            type: 'conceptNode',
            position: { x: CX - COL, y: ROW },
            data: {
              title: '技术栈',
              description: 'React 19 + React Flow + Yjs 协同 + Hermes 派单',
              tags: ['前端', '协同', '智能体'],
              source: 'demo-blackgold',
              categoryId: 'core',
              createdAt: ts,
            },
          },
          // 3) 右 concept — 用户场景
          {
            id: idScene,
            type: 'conceptNode',
            position: { x: CX + COL, y: ROW },
            data: {
              title: '用户场景',
              description: '研究员/产品/咨询师在画布上做立场对抗与方案推演',
              tags: ['场景', 'B 端'],
              source: 'demo-blackgold',
              categoryId: 'example',
              createdAt: ts,
            },
          },
          // 4) challenge — 反驳：延迟问题
          {
            id: idChall,
            type: 'challengeNode',
            position: { x: CX + COL, y: ROW * 2 + 40 },
            data: {
              source_node_id: idScene,
              source_title: '用户场景',
              angle: '商业可行性',
              claim: '用户量超过 1w 时延迟暴涨：Yjs 房间一旦超过 50 节点 + 5 协作者，rtt 显著恶化',
              text: '用户量超过 1w 时延迟暴涨：Yjs 房间一旦超过 50 节点 + 5 协作者，rtt 显著恶化',
              label: '延迟暴涨风险',
              tag: 'business',
              severity: 'high',
              source_id: idScene,
              created_at: ts,
            },
          },
          // 5) task — 任务：做 200 用户灰度
          {
            id: idTask,
            type: 'taskNode',
            position: { x: CX, y: ROW * 2 + 40 },
            data: {
              title: '做 200 用户灰度',
              body: '邀请 200 名内测用户，2 周观察 P95 延迟、节点数分布、对抗触发次数',
              status: 'draft',
              checklist: [
                { id: `ck-${rand()}`, text: '搭建灰度入口（room=beta-*）', done: false },
                { id: `ck-${rand()}`, text: '埋点 P95 / 节点数 / 对抗触发', done: false },
                { id: `ck-${rand()}`, text: '出 2 周复盘报告', done: false },
              ],
              relatedAgents: ['hermes', 'aletheia'],
              relatedSkills: ['onto-parser', 'antithesis-engine'],
              created_at: ts,
            },
          },
          // 6) note — 备注
          {
            id: idNote,
            type: 'noteNode',
            position: { x: CX - COL, y: ROW * 2 + 40 },
            data: {
              content:
                '演示主题：黑金 02 · 产品方案对抗\n用主题切换按钮 ◆/○ 在白底/黑金间切换',
            },
          },
        ]

        // 4 条边：onto → 2 concept；scene → challenge；onto → task
        const edges = [
          {
            id: `edge-${ts}-1-${rand()}`,
            source: idOnto,
            target: idTech,
            data: { label: '技术' },
          },
          {
            id: `edge-${ts}-2-${rand()}`,
            source: idOnto,
            target: idScene,
            data: { label: '场景' },
          },
          {
            id: `edge-${ts}-3-${rand()}`,
            source: idScene,
            target: idChall,
            data: { label: '反驳', type: 'challenge' },
          },
          {
            id: `edge-${ts}-4-${rand()}`,
            source: idOnto,
            target: idTask,
            data: { label: '任务' },
          },
        ]

        set({ nodes, edges, selectedNodeId: null, selectedEdgeId: null })
      },

      // 导出画布数据
      exportCanvasData: () => {
        const { nodes, edges } = get()
        return {
          nodes: nodes.map(n => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: n.data,
          })),
          edges: edges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            data: e.data,
          })),
          exportedAt: new Date().toISOString(),
          version: '1.0.0',
        }
      },

      // 导入画布数据（替换现有）
      importCanvasData: (newNodes, newEdges) => {
        set((state) => {
          state.nodes = newNodes || []
          state.edges = newEdges || []
        })
      },

      // 获取多选节点
      getSelectedNodes: () => {
        const { nodes } = get()
        return nodes.filter(n => n.selected)
      },

      // 批量连接选中节点
      linkSelectedNodes: (relationType = 'related') => {
        const { nodes, addRelation } = get()
        const selectedNodes = nodes.filter(n => n.selected)

        if (selectedNodes.length < 2) return

        for (let i = 0; i < selectedNodes.length; i++) {
          for (let j = i + 1; j < selectedNodes.length; j++) {
            addRelation(selectedNodes[i].id, selectedNodes[j].id, relationType)
          }
        }
      },

      // 标记选中节点
      markSelectedNodes: (color = '#fbbf24') => {
        const { nodes } = get()
        const selectedIds = nodes.filter(n => n.selected).map(n => n.id)

        set((state) => {
          state.nodes.forEach(node => {
            if (selectedIds.includes(node.id)) {
              node.data = { ...node.data, marked: true, markColor: color }
            }
          })
        })
      },

      // 清除选中节点的标记
      clearSelectedMarks: () => {
        const { nodes } = get()
        const selectedIds = nodes.filter(n => n.selected).map(n => n.id)

        set((state) => {
          state.nodes.forEach(node => {
            if (selectedIds.includes(node.id)) {
              node.data = { ...node.data, marked: false, markColor: null }
            }
          })
        })
      },

      // 删除选中节点
      deleteSelectedNodes: () => {
        set((state) => {
          const selectedIds = state.nodes.filter(n => n.selected).map(n => n.id)
          state.nodes = state.nodes.filter(n => !n.selected)
          state.edges = state.edges.filter(
            e => !selectedIds.includes(e.source) && !selectedIds.includes(e.target)
          )
        })
      },

      // 从选中节点创建分组 - 使用 React Flow 父子机制
      createGroup: (name = '') => {
        const { nodes } = get()
        const selectedNodes = nodes.filter(n => n.selected && n.type !== 'groupNode')

        if (selectedNodes.length < 2) {
          console.warn('至少需要 2 个节点才能创建分组')
          return null
        }

        const memberNodeIds = selectedNodes.map(n => n.id)
        const { PADDING, NODE_WIDTH, NODE_HEIGHT } = LAYOUT

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        selectedNodes.forEach(n => {
          minX = Math.min(minX, n.position.x)
          minY = Math.min(minY, n.position.y)
          maxX = Math.max(maxX, n.position.x + NODE_WIDTH)
          maxY = Math.max(maxY, n.position.y + NODE_HEIGHT)
        })

        const groupX = minX - PADDING
        const groupY = minY - PADDING - 40
        const groupWidth = maxX - minX + PADDING * 2
        const groupHeight = maxY - minY + PADDING * 2 + 40

        // 成员节点预览标签
        const memberPreview = selectedNodes.map(n => {
          if (n.type === 'conceptNode') return n.data?.title || '概念'
          if (n.type === 'noteNode') return (n.data?.content || '笔记').slice(0, 15) + '...'
          if (n.type === 'bookmarkNode') return n.data?.title || '链接'
          if (n.type === 'videoNode') return n.data?.title || '视频'
          if (n.type === 'imageNode') return n.data?.alt || '图片'
          if (n.type === 'fileNode') return n.data?.name || '文件'
          if (n.type === 'categoryNode') return n.data?.name || '分类'
          return '节点'
        })

        const memberTypes = selectedNodes.map(n => n.type)

        const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const groupName = name || `分组 (${memberNodeIds.length})`

        const groupNode = {
          id: groupId,
          type: 'groupNode',
          position: { x: groupX, y: groupY },
          zIndex: -1,
          style: {
            width: groupWidth,
            height: groupHeight,
          },
          data: {
            name: groupName,
            memberNodeIds,
            memberPreview,
            memberTypes,
            color: '#8b5cf6',
            expanded: true,
            width: groupWidth,
            height: groupHeight,
            createdAt: Date.now(),
          },
        }

        set((state) => {
          state.nodes.unshift(groupNode)

          state.nodes.forEach(node => {
            if (memberNodeIds.includes(node.id)) {
              node.position = {
                x: node.position.x - groupX,
                y: node.position.y - groupY,
              }
              node.parentNode = groupId
              node.extent = 'parent'
              node.data = {
                ...node.data,
                groupId: groupId,
              }
              node.selected = false
              node.draggable = true
            }
          })
        })

        return groupId
      },

      // 解散分组 - 恢复成员节点
      ungroupNodes: (groupId) => {
        set((state) => {
          const groupNode = state.nodes.find(n => n.id === groupId)
          if (!groupNode || groupNode.type !== 'groupNode') return

          const memberNodeIds = groupNode.data?.memberNodeIds || []
          const groupPosition = groupNode.position

          state.nodes.forEach(node => {
            if (memberNodeIds.includes(node.id)) {
              node.position = {
                x: node.position.x + groupPosition.x,
                y: node.position.y + groupPosition.y,
              }
              delete node.parentNode
              delete node.extent
              node.hidden = false
              node.draggable = true
              node.data = {
                ...node.data,
                groupId: null,
              }
            }
          })

          state.nodes = state.nodes.filter(n => n.id !== groupId)
        })
      },

      // 获取所有分组
      getGroups: () => {
        const { nodes } = get()
        return nodes.filter(n => n.type === 'groupNode')
      },

      // 切换分组展开/收起
      toggleGroupExpansion: (groupId, expanded) => {
        set((state) => {
          const groupNode = state.nodes.find(n => n.id === groupId)
          if (!groupNode || groupNode.type !== 'groupNode') return

          const memberNodeIds = groupNode.data?.memberNodeIds || []

          if (expanded) {
            // 展开：显示成员节点和边
            state.nodes.forEach(node => {
              if (memberNodeIds.includes(node.id)) {
                node.hidden = false
                node.draggable = true
              }
            })

            state.edges.forEach(edge => {
              const sourceInGroup = memberNodeIds.includes(edge.source)
              const targetInGroup = memberNodeIds.includes(edge.target)
              if (sourceInGroup || targetInGroup) {
                edge.hidden = false
              }
            })
          } else {
            // 收起：隐藏成员节点和边
            state.nodes.forEach(node => {
              if (memberNodeIds.includes(node.id)) {
                node.hidden = true
                node.draggable = false
              }
            })

            state.edges.forEach(edge => {
              const sourceInGroup = memberNodeIds.includes(edge.source)
              const targetInGroup = memberNodeIds.includes(edge.target)
              if (sourceInGroup || targetInGroup) {
                edge.hidden = true
              }
            })
          }

          groupNode.data = { ...groupNode.data, expanded }
        })
      },

      // 更新分组名称
      updateGroupName: (groupId, name) => {
        set((state) => {
          const groupNode = state.nodes.find(n => n.id === groupId)
          if (groupNode && groupNode.type === 'groupNode') {
            groupNode.data = { ...groupNode.data, name }
          }
        })
      },

      // 更新分组颜色
      updateGroupColor: (groupId, color) => {
        set((state) => {
          const groupNode = state.nodes.find(n => n.id === groupId)
          if (groupNode && groupNode.type === 'groupNode') {
            groupNode.data = { ...groupNode.data, color }
          }
        })
      },

      // 获取节点的所有连接节点
      getConnectedNodes: (nodeId) => {
        const { nodes, edges } = get()

        const connectedEdges = edges.filter(e =>
          e.source === nodeId || e.target === nodeId
        )

        const connectedIds = new Set()
        connectedEdges.forEach(e => {
          if (e.source === nodeId) connectedIds.add(e.target)
          if (e.target === nodeId) connectedIds.add(e.source)
        })

        return nodes.filter(n => connectedIds.has(n.id))
      },

      // 自动分组节点及其所有连接节点
      autoGroupConnectedNodes: (nodeId, groupName = '') => {
        const { nodes, getConnectedNodes } = get()

        const centerNode = nodes.find(n => n.id === nodeId)
        if (!centerNode) return null

        const connectedNodes = getConnectedNodes(nodeId)
        if (connectedNodes.length === 0) {
          console.warn('没有连接的节点可以分组')
          return null
        }

        const allNodes = [centerNode, ...connectedNodes]
        const memberNodeIds = allNodes.map(n => n.id)

        const { PADDING, NODE_WIDTH, NODE_HEIGHT } = LAYOUT

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        allNodes.forEach(n => {
          minX = Math.min(minX, n.position.x)
          minY = Math.min(minY, n.position.y)
          maxX = Math.max(maxX, n.position.x + NODE_WIDTH)
          maxY = Math.max(maxY, n.position.y + NODE_HEIGHT)
        })

        const groupX = minX - PADDING
        const groupY = minY - PADDING - 40
        const groupWidth = maxX - minX + PADDING * 2
        const groupHeight = maxY - minY + PADDING * 2 + 40

        const memberPreview = allNodes.map(n => {
          if (n.type === 'conceptNode') return n.data?.title || '概念'
          if (n.type === 'noteNode') return (n.data?.content || '笔记').slice(0, 15) + '...'
          if (n.type === 'bookmarkNode') return n.data?.title || '链接'
          if (n.type === 'videoNode') return n.data?.title || '视频'
          if (n.type === 'imageNode') return n.data?.alt || '图片'
          if (n.type === 'fileNode') return n.data?.name || '文件'
          if (n.type === 'categoryNode') return n.data?.name || '分类'
          return '节点'
        })

        const memberTypes = allNodes.map(n => n.type)

        const autoName = groupName || (centerNode.type === 'conceptNode'
          ? `${centerNode.data?.title || '概念'} 组`
          : `分组 (${memberNodeIds.length})`)

        const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        const groupNode = {
          id: groupId,
          type: 'groupNode',
          position: { x: groupX, y: groupY },
          zIndex: -1,
          style: {
            width: groupWidth,
            height: groupHeight,
          },
          data: {
            name: autoName,
            memberNodeIds,
            memberPreview,
            memberTypes,
            color: '#8b5cf6',
            expanded: true,
            width: groupWidth,
            height: groupHeight,
            createdAt: Date.now(),
          },
        }

        set((state) => {
          state.nodes.unshift(groupNode)

          state.nodes.forEach(node => {
            if (memberNodeIds.includes(node.id)) {
              node.position = {
                x: node.position.x - groupX,
                y: node.position.y - groupY,
              }
              node.parentNode = groupId
              node.extent = 'parent'
              node.data = {
                ...node.data,
                groupId: groupId,
              }
              node.selected = false
              node.draggable = true
            }
          })
        })

        return groupId
      },

      // 自动排列分组内成员（网格布局）
      autoArrangeGroupMembers: (groupId) => {
        set((state) => {
          const groupNode = state.nodes.find(n => n.id === groupId)
          if (!groupNode || groupNode.type !== 'groupNode') return

          const memberNodeIds = groupNode.data?.memberNodeIds || []
          const memberNodes = state.nodes.filter(n => memberNodeIds.includes(n.id))

          if (memberNodes.length === 0) return

          const { NODE_WIDTH, NODE_HEIGHT, HEADER_HEIGHT, PADDING } = LAYOUT
          const GAP = 20

          const cols = Math.ceil(Math.sqrt(memberNodes.length))
          const rows = Math.ceil(memberNodes.length / cols)

          const newWidth = PADDING * 2 + cols * NODE_WIDTH + (cols - 1) * GAP
          const newHeight = HEADER_HEIGHT + PADDING * 2 + rows * NODE_HEIGHT + (rows - 1) * GAP

          groupNode.style = {
            ...groupNode.style,
            width: newWidth,
            height: newHeight,
          }
          groupNode.data = {
            ...groupNode.data,
            width: newWidth,
            height: newHeight,
          }

          memberNodes.forEach((node, index) => {
            const col = index % cols
            const row = Math.floor(index / cols)
            node.position = {
              x: PADDING + col * (NODE_WIDTH + GAP),
              y: HEADER_HEIGHT + PADDING + row * (NODE_HEIGHT + GAP),
            }
          })
        })
      },

      // ===== Hermes 派单集成 (metahermes 三件套) =====

      // 在画布加一个 TaskNode (草稿状态)
      // 由决策层 (RightPanel 路由器 + 三模式开关) 统一调度，节点本身只承载
      // "任务清单 + 关联 agent/skill 标签" 展示，不再自带 Hermes 派单 UI。
      addTaskNode: (position = null) => {
        const { getNextGridPosition } = get()
        const pos = position || getNextGridPosition()
        const nodeId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const newNode = {
          id: nodeId,
          type: 'taskNode',
          position: pos,
          data: {
            title: '',
            body: '',
            status: 'draft',
            checklist: [],          // [{ id, text, done }] - 任务清单
            relatedAgents: [],      // ['hermes', 'aletheia', 'claude-cli']
            relatedSkills: [],      // ['onto-parser', 'antithesis-engine']
            created_at: Date.now(),
          },
        }
        set((state) => {
          state.nodes.push(newNode)
        })
        return nodeId
      },

      // 派一个 TaskNode 给 Hermes — 全程异步, 自动 polling, done 时自动建 ResultNode + 连线
      dispatchTaskNode: async (nodeId) => {
        const { nodes, updateNode } = get()
        const node = nodes.find((n) => n.id === nodeId)
        if (!node || node.type !== 'taskNode') {
          throw new Error(`dispatchTaskNode: 找不到 TaskNode ${nodeId}`)
        }
        if (!node.data?.title?.trim()) {
          throw new Error('dispatchTaskNode: title 不能为空')
        }

        // 动态 import 防止循环依赖 + 让 store 模块本身不带网络层
        const svc = await import('../services/hermesService')
        const { dispatchTask, pollTask, mapHermesStatus, TASK_NODE_STATUS } = svc

        updateNode(nodeId, { status: TASK_NODE_STATUS.DISPATCHING, error: null })

        let task
        try {
          task = await dispatchTask({
            title: node.data.title,
            body: node.data.body || '',
            assignee: node.data.assignee || null,
            priority: node.data.priority || 3,
          })
        } catch (err) {
          updateNode(nodeId, { status: TASK_NODE_STATUS.FAILED, error: err.message })
          throw err
        }

        updateNode(nodeId, {
          task_id: task.id,
          status: TASK_NODE_STATUS.PENDING,
          assignee: task.assignee || node.data.assignee,
        })

        // 轮询直到 done / blocked / 超时
        const { task: finalTask, timedOut } = await pollTask(task.id, {
          intervalMs: 3000,
          maxMs: 600000,
          onUpdate: (t) => {
            updateNode(nodeId, { status: mapHermesStatus(t.status) })
          },
        })

        if (timedOut) {
          updateNode(nodeId, {
            status: TASK_NODE_STATUS.FAILED,
            error: '轮询超时 (10min). gateway 可能没起或 worker 卡住.',
          })
          return
        }

        if (finalTask?.status === 'done') {
          const resultText =
            finalTask.result ||
            finalTask.output ||
            finalTask.body_after ||
            finalTask.body ||
            '(任务已完成, 无返回内容 — gateway 没起时 worker 不会写 result)'
          get()._addResultNodeFor(nodeId, finalTask, resultText)
          updateNode(nodeId, { status: TASK_NODE_STATUS.DONE })
        } else {
          updateNode(nodeId, {
            status: TASK_NODE_STATUS.FAILED,
            error: `Hermes status=${finalTask?.status || 'unknown'}`,
          })
        }
      },

      // ===== Aletheia 集成: 本体拆解 + 反驳引擎 (元认知 + Hermes 合作) =====

      // 一句话 → 调 LLM 拆解为本体框架, 一次性建 N 个节点 + 边
      // 节点类型: ontologyNode (variant: goal/entity/constraint/assumption)
      // 自动布局: goal 居中, entities 横排上方, constraints 左下, assumptions 右下
      addOntologyFramework: async (sentence, originPosition = null) => {
        if (!sentence?.trim()) {
          throw new Error('addOntologyFramework: sentence 不能为空')
        }
        const svc = await import('../services/aiService')
        const struct = await svc.decomposeToOntology(sentence)
        if (!struct.goal && struct.entities.length === 0) {
          throw new Error('LLM 没拆出任何节点 (可能未配置 provider 或调用失败)')
        }

        const { getNextGridPosition } = get()
        const origin = originPosition || getNextGridPosition()
        const ts = Date.now()
        const rand = () => Math.random().toString(36).slice(2, 8)

        // 布局参数
        const COL_W = 250
        const ROW_H = 180
        const goalX = origin.x
        const goalY = origin.y

        // 1. goal 节点
        const goalId = `onto-${ts}-${rand()}`
        const newNodes = [{
          id: goalId,
          type: 'ontologyNode',
          position: { x: goalX, y: goalY },
          data: {
            variant: 'goal',
            title: struct.goal,
            description: '',
            sentence,
            created_at: ts,
          },
        }]

        // 2. entities 横排在 goal 下一行, 居中
        const entCount = struct.entities.length
        const entStartX = goalX - ((entCount - 1) * COL_W) / 2
        const titleToId = { [struct.goal]: goalId }
        struct.entities.forEach((e, i) => {
          const nid = `onto-${ts}-${rand()}`
          titleToId[e.title] = nid
          newNodes.push({
            id: nid,
            type: 'ontologyNode',
            position: { x: entStartX + i * COL_W, y: goalY + ROW_H },
            data: {
              variant: 'entity',
              title: e.title,
              description: e.description,
              parent_goal: struct.goal,
              created_at: ts,
            },
          })
        })

        // 3. constraints 左下
        struct.constraints.forEach((c, i) => {
          const nid = `onto-${ts}-${rand()}`
          titleToId[c.title] = nid
          newNodes.push({
            id: nid,
            type: 'ontologyNode',
            position: { x: goalX - COL_W * (Math.ceil(struct.constraints.length / 2)) + i * COL_W, y: goalY + ROW_H * 2 + 40 },
            data: {
              variant: 'constraint',
              title: c.title,
              description: c.description,
              parent_goal: struct.goal,
              created_at: ts,
            },
          })
        })

        // 4. assumptions 右下
        struct.assumptions.forEach((a, i) => {
          const nid = `onto-${ts}-${rand()}`
          titleToId[a.title] = nid
          newNodes.push({
            id: nid,
            type: 'ontologyNode',
            position: { x: goalX + COL_W * (i + 1), y: goalY + ROW_H * 2 + 40 },
            data: {
              variant: 'assumption',
              title: a.title,
              description: a.description,
              parent_goal: struct.goal,
              created_at: ts,
            },
          })
        })

        // 5. edges: 用 LLM 给的 + 兜底 goal→entities
        const newEdges = []
        const seenEdges = new Set()
        const pushEdge = (sourceId, targetId, label) => {
          if (!sourceId || !targetId || sourceId === targetId) return
          const key = `${sourceId}|${targetId}`
          if (seenEdges.has(key)) return
          seenEdges.add(key)
          newEdges.push({
            id: `edge-${ts}-${rand()}`,
            source: sourceId,
            target: targetId,
            // smoothstep = 正交折线, 圆角拐弯
            type: 'smoothstep',
            data: { relationType: label || '拆解' },
            style: { stroke: '#888', strokeWidth: 1.5, strokeDasharray: label === '约束' ? '4 4' : undefined },
          })
        }
        // 兜底: goal → 每个 entity
        struct.entities.forEach((e) => pushEdge(goalId, titleToId[e.title], '拆解'))
        // LLM 给的 edges
        struct.edges.forEach((e) => {
          const s = e.from === 'Goal' || e.from === struct.goal ? goalId : titleToId[e.from]
          const t = e.to === 'Goal' || e.to === struct.goal ? goalId : titleToId[e.to]
          pushEdge(s, t, e.label)
        })

        set((state) => {
          state.nodes.push(...newNodes)
          state.edges.push(...newEdges)
        })

        return { goalId, nodeCount: newNodes.length, edgeCount: newEdges.length, struct }
      },

      // 把 OntologyNode (entity/constraint/assumption) 转为 TaskNode 并自动派给 Hermes
      // OntologyNode "派 Hermes →" 按钮调这个 — 创建 TaskNode 走 orchestra auto 流.
      // 真 Hermes worker (默认 profile=`default`, agent 已在 VPS 配好 deepseek-chat) 会接.
      // 不走 manual hermes-proxy (那条要 gateway+token, 限制多), 走 orchestra conductor 抢锁更稳.
      promoteOntologyToTask: async (ontoNodeId) => {
        const { nodes } = get()
        const src = nodes.find((n) => n.id === ontoNodeId)
        if (!src || src.type !== 'ontologyNode') {
          throw new Error(`promoteOntologyToTask: 找不到 OntologyNode ${ontoNodeId}`)
        }
        const ts = Date.now()
        const rand = Math.random().toString(36).slice(2, 8)
        const taskId = `task-${ts}-${rand}`
        const taskNode = {
          id: taskId,
          type: 'taskNode',
          position: { x: src.position.x + 280, y: src.position.y },
          data: {
            title: src.data?.title || '未命名任务',
            body: src.data?.description || '',
            assignee: '',
            priority: src.data?.variant === 'constraint' ? 4 : 3,
            // status='pending' — conductor _maybeClaim 只接 pending+auto+hermes
            // draft 是 UI 编辑中态, pending 才是 worker 可接的派单态
            status: 'pending',
            from_ontology_node: ontoNodeId,
            created_at: ts,
            // orchestra auto 流: conductor 在 demo-final 房间自动接管
            agentMode: 'auto',
            assignedTo: 'hermes',
            hermesAssignee: 'default',
          },
        }
        const newEdge = {
          id: `edge-${ts}-${rand}`,
          source: ontoNodeId,
          target: taskId,
          // smoothstep = 正交折线
          type: 'smoothstep',
          data: { relationType: '派单' },
          style: { stroke: '#c8a882', strokeWidth: 1.5 },
        }
        // 拆成两个 set — 单 set 同时改 nodes+edges 在 immer 下被观察过引用 stable
        // 导致 yjsSync subscribe 的 (nodes === lastNodes) 短路, 永远不 push 到 yjs
        set((state) => { state.nodes.push(taskNode) })
        set((state) => { state.edges.push(newEdge) })

        // 不调 dispatchTaskNode (那是 manual 流) — orchestra dispatcher 看到
        // agentMode='auto' + status='pending' 会自动接管 → hermes worker 抢锁
        return taskId
      },

      // 反驳引擎: 给一个 OntologyNode 生成 N 个 ChallengeNode (Devil's Advocate)
      dispatchChallenge: async (ontoNodeId) => {
        const { nodes } = get()
        const src = nodes.find((n) => n.id === ontoNodeId)
        if (!src) throw new Error(`dispatchChallenge: 找不到节点 ${ontoNodeId}`)

        const svc = await import('../services/aiService')
        const challenges = await svc.challengeNode({
          title: src.data?.title || '',
          description: src.data?.description || '',
        })

        if (!challenges.length) {
          console.warn('[dispatchChallenge] LLM 没返回反驳论点')
          return []
        }

        const ts = Date.now()
        const rand = () => Math.random().toString(36).slice(2, 8)
        const newNodes = []
        const newEdges = []

        challenges.forEach((c, i) => {
          const cid = `challenge-${ts}-${rand()}`
          newNodes.push({
            id: cid,
            type: 'challengeNode',
            position: {
              x: src.position.x + 320,
              y: src.position.y + i * 130 - ((challenges.length - 1) * 130) / 2,
            },
            data: {
              source_node_id: ontoNodeId,
              source_title: src.data?.title || '',
              angle: c.angle,
              claim: c.claim,
              severity: c.severity,
              created_at: ts,
            },
          })
          newEdges.push({
            id: `edge-${ts}-${rand()}`,
            source: ontoNodeId,
            target: cid,
            // smoothstep = 正交折线, 圆角拐弯
            type: 'smoothstep',
            data: { relationType: '反驳' },
            style: {
              stroke: c.severity === 'high' ? '#b27c8b' : c.severity === 'medium' ? '#c8a882' : '#888',
              strokeWidth: 1.5,
              strokeDasharray: '4 4',
            },
          })
        })

        set((state) => {
          state.nodes.push(...newNodes)
          state.edges.push(...newEdges)
        })

        return challenges
      },

      // 节点级二次拆解 — 把现有 OntologyNode 拆成 3-5 个子 entity 节点
      // 用于 OntologyNode 上的"拆解"按钮: 用户觉得一级拆解还太抽象, 让 LLM 再下一层
      decomposeOntologyFurther: async (ontoNodeId) => {
        const { nodes } = get()
        const src = nodes.find((n) => n.id === ontoNodeId)
        if (!src || src.type !== 'ontologyNode') {
          throw new Error(`decomposeOntologyFurther: 找不到 OntologyNode ${ontoNodeId}`)
        }

        const svc = await import('../services/aiService')
        const subitems = await svc.decomposeNodeFurther({
          title: src.data?.title || '',
          description: src.data?.description || '',
          variant: src.data?.variant || 'entity',
        })

        if (!subitems.length) {
          console.warn('[decomposeOntologyFurther] LLM 没返回子项')
          return []
        }

        const ts = Date.now()
        const rand = () => Math.random().toString(36).slice(2, 8)
        const COL_W = 240
        const ROW_H = 150
        const newNodes = []
        const newEdges = []

        // 子节点排成一横排, 在父节点下面
        const startX = src.position.x - ((subitems.length - 1) * COL_W) / 2
        subitems.forEach((s, i) => {
          const cid = `onto-${ts}-${rand()}`
          newNodes.push({
            id: cid,
            type: 'ontologyNode',
            position: { x: startX + i * COL_W, y: src.position.y + ROW_H },
            data: {
              variant: 'entity',  // 二次拆出来的统一作为 entity, 用户可手动改
              title: s.title,
              description: s.description,
              parent_node: ontoNodeId,
              parent_goal: src.data?.parent_goal || src.data?.title,
              created_at: ts,
            },
          })
          newEdges.push({
            id: `edge-${ts}-${rand()}`,
            source: ontoNodeId,
            target: cid,
            type: 'smoothstep',
            data: { relationType: '细化' },
            style: { stroke: '#c8a882', strokeWidth: 1.5 },
          })
        })

        set((state) => {
          state.nodes.push(...newNodes)
          state.edges.push(...newEdges)
        })
        return subitems
      },

      // 圈选组合元认知 — 把多个节点当一个系统看, 生成一个新节点 (variant=group-meta)
      // 自动连到所有选中节点, 折叠区直接展开 5 维度组合分析
      analyzeGroupMetaCognitive: async (nodeIds) => {
        if (!Array.isArray(nodeIds) || nodeIds.length < 2) {
          throw new Error('analyzeGroupMetaCognitive: 至少需要 2 个节点')
        }
        const { nodes } = get()
        const srcNodes = nodeIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean)
        if (srcNodes.length < 2) throw new Error('找不到足够的源节点')

        // 1. 先建占位节点 (analyzing: true), 用户立刻能看到
        const ts = Date.now()
        const rand = Math.random().toString(36).slice(2, 8)
        const groupId = `group-meta-${ts}-${rand}`
        // 位置: 选中节点的几何中心上方 200px
        const minX = Math.min(...srcNodes.map((n) => n.position.x))
        const maxX = Math.max(...srcNodes.map((n) => n.position.x))
        const minY = Math.min(...srcNodes.map((n) => n.position.y))
        const cx = (minX + maxX) / 2
        const cy = minY - 220

        const placeholderNode = {
          id: groupId,
          type: 'ontologyNode',
          position: { x: cx, y: cy },
          data: {
            variant: 'goal',  // 视觉用 goal (深底反色) 凸显这是组合分析
            title: `组合分析 (${srcNodes.length} 节点)`,
            description: srcNodes.map((n) => n.data?.title || '').filter(Boolean).join(' · '),
            metaAnalyzing: true,
            isGroupMeta: true,
            sourceNodeIds: nodeIds,
            created_at: ts,
          },
        }
        const newEdges = nodeIds.map((targetId) => ({
          id: `edge-group-${ts}-${rand}-${targetId.slice(-6)}`,
          source: groupId,
          target: targetId,
          type: 'smoothstep',
          data: { relationType: '组合分析' },
          style: { stroke: '#c8a882', strokeWidth: 1.5, strokeDasharray: '6 3' },
        }))
        set((state) => {
          state.nodes.push(placeholderNode)
          state.edges.push(...newEdges)
        })

        // 2. 调 LLM 做组合分析
        try {
          const svc = await import('../services/aiService')
          const result = await svc.analyzeGroupMeta(
            srcNodes.map((n) => ({
              title: n.data?.title || '',
              description: n.data?.description || '',
              variant: n.data?.variant,
            }))
          )
          if (!result) {
            get().updateNode(groupId, {
              metaAnalyzing: false,
              metaAnalysisError: 'LLM 输出无法解析',
            })
            return null
          }
          get().updateNode(groupId, {
            metaAnalysis: { ...result, analyzedAt: Date.now() },
            metaAnalyzing: false,
            metaAnalysisError: null,
            metaExpanded: true,
          })
          return { groupId, result }
        } catch (err) {
          console.error('[analyzeGroupMetaCognitive] failed:', err)
          get().updateNode(groupId, {
            metaAnalyzing: false,
            metaAnalysisError: err?.message || String(err),
          })
          throw err
        }
      },

      // 批量推进 — 对选中的多个节点并发执行同一类元认知动作
      // mode: 'analyze' (元认知分析) | 'decompose' (拆解, 仅 OntologyNode) | 'promote' (派 Hermes, 仅 OntologyNode)
      batchAdvance: async (nodeIds, mode = 'analyze') => {
        if (!Array.isArray(nodeIds) || nodeIds.length === 0) return { ok: 0, fail: 0 }
        const { nodes, analyzeNodeMetaCognitive, decomposeOntologyFurther, promoteOntologyToTask } = get()
        const handler = {
          analyze: (id) => analyzeNodeMetaCognitive(id),
          decompose: (id) => decomposeOntologyFurther(id),
          promote: (id) => promoteOntologyToTask(id),
        }[mode]
        if (!handler) throw new Error(`batchAdvance: 未知 mode "${mode}"`)

        // 过滤: decompose / promote 仅对 OntologyNode 生效
        const eligible = nodeIds.filter((id) => {
          if (mode === 'analyze') return true
          const n = nodes.find((x) => x.id === id)
          return n?.type === 'ontologyNode' && n.data?.variant !== 'goal'
        })

        // 并发调用 — 每个独立, 失败不阻塞其他
        const results = await Promise.allSettled(eligible.map((id) => handler(id)))
        const ok = results.filter((r) => r.status === 'fulfilled').length
        const fail = results.length - ok
        return { ok, fail, total: eligible.length, skipped: nodeIds.length - eligible.length }
      },

      // 节点级元认知分析 — 一次 LLM 调用, 5 维度简版结果直接 inline 写到节点 data
      // (不长 metaStepNode, 不开右侧任务面板, 节点自身展开就能看)
      analyzeNodeMetaCognitive: async (nodeId) => {
        const { nodes, updateNode } = get()
        const src = nodes.find((n) => n.id === nodeId)
        if (!src) throw new Error(`analyzeNodeMetaCognitive: 找不到节点 ${nodeId}`)
        const title = src.data?.title || ''
        if (!title.trim()) throw new Error('节点没有标题, 无法分析')

        // 标记 analyzing 状态让 UI 显示 loading
        updateNode(nodeId, { metaAnalyzing: true, metaAnalysisError: null })

        try {
          const svc = await import('../services/aiService')
          const result = await svc.analyzeNodeMeta({
            title,
            description: src.data?.description || '',
            variant: src.data?.variant,
          })
          if (!result) {
            updateNode(nodeId, { metaAnalyzing: false, metaAnalysisError: 'LLM 输出无法解析' })
            return null
          }
          updateNode(nodeId, {
            metaAnalysis: { ...result, analyzedAt: Date.now() },
            metaAnalyzing: false,
            metaAnalysisError: null,
            // 自动展开元认知折叠区, 让用户立刻看到结果
            metaExpanded: true,
          })
          return result
        } catch (err) {
          console.error('[analyzeNodeMetaCognitive] failed:', err)
          updateNode(nodeId, {
            metaAnalyzing: false,
            metaAnalysisError: err?.message || String(err),
          })
          throw err
        }
      },

      // 内部: 给一个 done 任务在右侧建 ResultNode + 自动连线
      _addResultNodeFor: (sourceNodeId, hermesTask, resultText) => {
        set((state) => {
          const src = state.nodes.find((n) => n.id === sourceNodeId)
          if (!src) return

          const rand = Math.random().toString(36).slice(2, 8)
          const resultNodeId = `result-${Date.now()}-${rand}`
          const newResultNode = {
            id: resultNodeId,
            type: 'resultNode',
            position: { x: src.position.x + 320, y: src.position.y },
            data: {
              source_task_id: hermesTask.id,
              source_title: src.data?.title || '未知任务',
              result: resultText,
              task_id: hermesTask.id,
              assignee: hermesTask.assignee || src.data?.assignee || '',
              finished_at: hermesTask.finished_at
                ? new Date(hermesTask.finished_at * 1000).toLocaleString()
                : new Date().toLocaleString(),
            },
          }
          state.nodes.push(newResultNode)

          state.edges.push({
            id: `edge-${Date.now()}-${rand}`,
            source: sourceNodeId,
            target: resultNodeId,
            // smoothstep = 正交折线, 比 curved 更规整
            type: 'smoothstep',
            animated: false,
            data: { relationType: 'reference' },
            style: { stroke: '#8b9e7c', strokeWidth: 1.5 },
          })
        })
      },
    })),
    {
      name: 'know-canvas-store',
      // 多人协作下 nodes/edges 必须永远走 yjs (黑板权威), 不能从 localStorage hydrate —
      // 否则 yjsSync 启动时本地旧数据会通过 pushLocalToYjs 把别人刚 inject 的节点删掉 (race)。
      // 仅持久化 UI 偏好。
      partialize: (state) => ({
        viewMode: state.viewMode,
        showMiniMap: state.showMiniMap,
        showChineseLabels: state.showChineseLabels,
        taskMode: state.taskMode,
        layoutDirection: state.layoutDirection,
      }),
    }
  )
)

export default useCanvasStore
