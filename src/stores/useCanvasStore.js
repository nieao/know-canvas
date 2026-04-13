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
  const nodeId = `${idPrefix}-${Date.now()}`

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

// 数据迁移：清理孤儿 parentNode 引用
const migrateNodes = (nodes) => {
  if (!nodes || !Array.isArray(nodes)) return nodes

  // 获取所有分组节点 ID
  const groupIds = new Set(
    nodes.filter(n => n.type === 'groupNode').map(n => n.id)
  )

  // 清理孤儿引用
  return nodes.map(node => {
    if (node.parentNode && !groupIds.has(node.parentNode)) {
      const { parentNode, extent, ...cleanNode } = node
      return {
        ...cleanNode,
        hidden: false,
        draggable: true,
        data: node.data ? { ...node.data, groupId: null } : node.data,
      }
    }
    return node
  })
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

      // 视口状态，用于定位新节点到视图中心
      viewportCenter: { x: 400, y: 300 },
      viewportZoom: 1,

      // 更新视口中心（由画布组件在视口变化时调用）
      setViewportCenter: (center, zoom = 1) => {
        set({ viewportCenter: center, viewportZoom: zoom })
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
            id: `edge-${Date.now()}`,
            type: 'curved',
            animated: false,
            data: { relationType: 'related' },
            style: { stroke: RELATION_TYPES.RELATED.color },
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
        const nodeId = `concept-${Date.now()}`

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
        const nodeId = `category-${Date.now()}`

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
        const nodeId = `bookmark-${Date.now()}`

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
        const nodeId = `image-${Date.now()}`

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
        const nodeId = `video-${Date.now()}`

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
        const nodeId = `note-${Date.now()}`

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
        const nodeId = `combined-${Date.now()}`

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
        const nodeId = `file-${Date.now()}`

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
            id: `edge-${sourceId}-${targetId}-${Date.now()}`,
            source: sourceId,
            target: targetId,
            type: 'curved',
            animated: relation.style === 'dashed',
            data: {
              relationType: relation.id,
              label: relation.label,
              labelCn: relation.labelCn,
            },
            style: {
              stroke: relation.color,
              strokeWidth: 2,
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

        const groupId = `group-${Date.now()}`
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

        const groupId = `group-${Date.now()}`

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
    })),
    {
      name: 'know-canvas-store',
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
        viewMode: state.viewMode,
        showMiniMap: state.showMiniMap,
        showChineseLabels: state.showChineseLabels,
      }),
      // 加载时执行数据迁移，修复孤儿 parentNode 引用
      merge: (persistedState, currentState) => {
        const migratedNodes = migrateNodes(persistedState?.nodes)
        return {
          ...currentState,
          ...persistedState,
          nodes: migratedNodes || currentState.nodes,
        }
      },
    }
  )
)

export default useCanvasStore
