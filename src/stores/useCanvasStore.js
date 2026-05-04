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
import { getUsername, getUserColor } from '../collab/session'

// 节点出生印记：写入 createdBy = { name, color, ts } —— 角标 UI 永久显示创建者
function getCreatedByStamp() {
  try {
    const name = getUsername()
    if (!name) return null
    return { name, color: getUserColor(), ts: Date.now() }
  } catch (_e) {
    return null
  }
}

// 给"非工厂创建"的节点统一补出生印记（mutate 节点对象）
function applyCreatedByStamp(node) {
  if (!node || !node.data || node.data.createdBy) return
  const stamp = getCreatedByStamp()
  if (stamp) node.data.createdBy = stamp
}

// 批量补印：用于 askAndStartMetaProject / analyzeGroupMeta 等批量 push 场景
function stampNodesInPlace(arr) {
  if (!Array.isArray(arr)) return
  for (const n of arr) applyCreatedByStamp(n)
}

// 元认知 5 步顺序 (与 services/metaCognitiveExecutor STEP_DEFS 同步, 避免循环 import)
const META_STEP_ORDER = ['intent', 'decompose', 'execute', 'reflect', 'synthesize']
function getStepIdByIndex(idx) {
  return META_STEP_ORDER[idx] || META_STEP_ORDER[0]
}

// 元认知 5 步中文标签 (用于回放系统的 commit label)
const META_STEP_LABEL_CN = {
  intent: '意图',
  decompose: '拆解',
  execute: '执行',
  reflect: '反思',
  synthesize: '综合',
}

// === 外部源 watch sync 工具函数 — 详见 docs/source-watch-sync-spec.md ===
// 12 字符快速 hash (DJB2 变种) — 给 sourceMeta.remoteContentHash 用
// 同步检测时仅当远端时间戳变了才会调用, 性能不是热点
function _quickHash(str) {
  if (!str) return ''
  let h = 5381
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  // 转无符号 16 进制, 取前 12 位
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 12)
}

// 把 ISO 字符串 / number ts 统一转成 number ts (毫秒)
function _toTs(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  const t = Date.parse(v)
  return isNaN(t) ? 0 : t
}

// 比较远端时间是否严格新于本地 (用 lastSyncedAt 当 baseline, 没有 baseline 则用 importedAt fallback)
// 容忍 5s 时钟漂移 — 远端必须比本地基线早过 5s 才算"新"
function _isRemoteNewer(remoteAt, oldRemoteAt, baselineTs) {
  const r = _toTs(remoteAt)
  const baseline = _toTs(baselineTs)
  if (!r) return false
  if (!baseline) return true  // 第一次, 远端有时间就标新 (不应该, 但兜底)
  // 允许 5s 漂移
  return r > baseline + 5000
}

// 给单个节点拉 fetch-meta — 返回 { remoteUpdatedAt, title? }
async function _fetchMetaForNode(node) {
  const meta = node.data?.sourceMeta
  if (!meta?.platform) throw new Error('节点没有 sourceMeta')
  if (meta.platform === 'feishu') {
    const resp = await fetch('/canvas/api/source/feishu/fetch-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ docUrl: meta.originalUrl }),
    })
    if (!resp.ok) throw new Error(`fetch-meta ${resp.status}`)
    const json = await resp.json()
    if (!json.ok) throw new Error(json.error || 'fetch-meta 失败')
    return json.data || {}
  }
  if (meta.platform === 'notion') {
    const resp = await fetch('/canvas/api/source/notion/fetch-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ pageUrl: meta.originalUrl, pageId: meta.pageId }),
    })
    if (!resp.ok) throw new Error(`fetch-meta ${resp.status}`)
    const json = await resp.json()
    if (!json.ok) throw new Error(json.error || 'fetch-meta 失败')
    return json.data || {}
  }
  throw new Error(`不支持的 platform: ${meta.platform}`)
}

// 由任意画布节点向上找到所属项目库的 projectId
//   - 节点 → parentNode → projectGroup → 兄弟 ontologyNode 项目根 → libraryId
//   - 找不到时返回 null (调用方可 fallback 到 projects[0]?.id)
function _findActiveProjectIdFromNode(nodes, srcNode) {
  if (!srcNode || !Array.isArray(nodes)) return null
  let cur = srcNode
  // 最多向上找 4 层 parentNode (projectGroup 通常是 src 的直接父)
  for (let i = 0; i < 4 && cur; i++) {
    const pgId = cur.parentNode
    if (!pgId) break
    const pg = nodes.find((n) => n.id === pgId)
    if (!pg) break
    if (pg.data?.isProjectGroup) {
      const root = nodes.find(
        (n) => n.parentNode === pg.id && n.type === 'ontologyNode' && n.data?.projectMode,
      )
      if (root?.data?.libraryId) return root.data.libraryId
      // 项目根尚未入库 — 没有 libraryId 时返回 null, 让调用方决定 fallback
      return null
    }
    cur = pg
  }
  return null
}

// 关键 action 完成后追加一帧到项目库 commits[] (回放系统用)
//   - projectId 优先使用调用方算出来的; 取不到时 fallback 到 projects[0]?.id (最新项目)
//   - 失败仅 warn, 不阻塞主流程
//   - getSnapshot() 由调用方提供, 默认从 useCanvasStore 抓 nodes/edges
async function _commitProjectSnapshot({ projectId, label, getSnapshot }) {
  try {
    const mod = await import('./useProjectLibraryStore')
    const lib = mod?.default
    if (!lib?.getState) return
    const s = lib.getState()
    if (typeof s.addProjectCommit !== 'function') return
    let pid = projectId
    if (!pid) pid = Array.isArray(s.projects) && s.projects.length > 0 ? s.projects[0]?.id : null
    if (!pid) return  // 没有任何项目可挂, 静默跳过
    const snapshot = (typeof getSnapshot === 'function' ? getSnapshot() : null)
      || { nodes: [], edges: [] }
    s.addProjectCommit(pid, { label: label || '快照', snapshot })
  } catch (e) {
    console.warn('[commit-snapshot]', e?.message || e)
  }
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

// === 遮挡检测 ===
// 计算节点的 absolute bbox (考虑 parentNode 嵌套)
// 不同 group 类型的 fallback width/height 必须分别给, 否则 collision 检测假阴性
// (用户反馈: projectGroup 实际 1600+ 但 fallback 800 → 新 group 放进去看起来不撞实际撞了 → 整个组团跑很远找空位)
function getNodeAbsoluteBox(node, allNodes) {
  let x = node.position?.x || 0
  let y = node.position?.y || 0
  let parentId = node.parentNode
  while (parentId) {
    const parent = allNodes.find((n) => n.id === parentId)
    if (!parent) break
    x += parent.position?.x || 0
    y += parent.position?.y || 0
    parentId = parent.parentNode
  }
  // 按 group 子类型给精确尺寸
  let fallbackW, fallbackH
  if (node.type === 'group') {
    if (node.data?.isChallengeGroup) { fallbackW = 380; fallbackH = 800 }
    else if (node.data?.isDecomposeGroup) { fallbackW = 1260; fallbackH = 260 }
    else if (node.data?.isProjectGroup || node.data?.isProject) { fallbackW = 1600; fallbackH = 1100 }
    else if (node.data?.isOrphanFallback) { fallbackW = 0; fallbackH = 0 }  // 隐形 fallback root, 不参与 collision
    else { fallbackW = 800; fallbackH = 600 }
  } else if (node.type === 'challengeNode') { fallbackW = 280; fallbackH = 200 }
  else if (node.type === 'ontologyNode') { fallbackW = 220; fallbackH = 140 }
  else { fallbackW = 200; fallbackH = 120 }

  const w = Number(node.style?.width) || node.width || node.measured?.width || fallbackW
  const h = Number(node.style?.height) || node.height || node.measured?.height || fallbackH
  return { x, y, w, h }
}

// 判断两 box 是否撞 (留 SAFE_GAP 间距)
function boxOverlap(a, b, gap = 30) {
  return !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y)
}

/**
 * 在已有节点旁边找一个不撞的位置. 优先按 strategy 偏移.
 *
 * MAX_TRIES 限制 16 次, STEP 100 — 最大偏移 ~1600px 内, 不会跑到天涯.
 * 16 次还找不到说明画布拥挤, 不再死磕"完美不撞", 回到第 4 次的位置(局部已偏开但还在视野内).
 * (用户反馈: 之前 50 次×80px = 4000px 偏移, 节点跑很远视野外, 必须手动找回)
 *
 * @param {{x,y,w,h}} desired 期望的 box
 * @param {Array} allNodes 所有节点
 * @param {Array<string>} excludeIds 排除自身/同时新增的节点 ids
 * @param {'down'|'right'} strategy 撞了之后向哪个方向偏移
 * @returns {{x,y}} 不撞的目标位置
 */
function findFreePosition(desired, allNodes, excludeIds = [], strategy = 'down') {
  const STEP = strategy === 'down' ? 100 : 140
  const MAX_TRIES = 16
  const FALLBACK_TRY = 4  // 找不到完美位置时, 回这一步 (~400-560px 偏移, 仍在视野内)
  let { x, y } = desired
  let fallbackPos = null
  for (let i = 0; i < MAX_TRIES; i++) {
    const cur = { x, y, w: desired.w, h: desired.h }
    const collided = allNodes.find((n) => {
      if (excludeIds.includes(n.id)) return false
      if (n.parentNode) return false  // 子节点的位置已经体现在父级 bbox 内, 跳过避免重复检测
      if (n.data?.isOrphanFallback) return false  // 隐形 fallback root 不参与
      const box = getNodeAbsoluteBox(n, allNodes)
      if (box.w === 0 || box.h === 0) return false
      return boxOverlap(cur, box)
    })
    if (!collided) return { x, y }
    if (i === FALLBACK_TRY) fallbackPos = { x, y }
    if (strategy === 'down') y += STEP
    else x += STEP
  }
  console.warn('[findFreePosition] 16 次尝试都撞, 回退到 fallback 位置 (~400px 偏移). 画布可能需要手动整理')
  return fallbackPos || { x: desired.x, y: desired.y }
}

// 通用节点工厂，确保创建一致性
const createNodeFactory = (get, set) => (type, idPrefix, data, position = null) => {
  const pos = position || get().getNextGridPosition()
  const rand = Math.random().toString(36).slice(2, 8)
  const nodeId = `${idPrefix}-${Date.now()}-${rand}`

  // 出生印记：本地用户作为创建者，落到 data.createdBy（不覆盖已有值，便于导入数据保留原作者）
  const createdBy = data?.createdBy || getCreatedByStamp()
  const dataWithStamp = createdBy ? { ...data, createdBy } : data

  const newNode = {
    id: nodeId,
    type,
    position: pos,
    data: dataWithStamp,
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

      // === 折叠分级视图 (按节点类型分 L0/L1/L2) ===
      // mode: 'minimal' = 仅主干 (L0 显示, L1/L2 折叠)
      //       'full'    = 显示全部 (默认 ALETHEIA 老行为, 兼容)
      // expandedSourceIds = 用户点击 ENTITY/源节点单独展开本支 (Set 持久不持久无所谓, 重启回 minimal 默认)
      // pinnedNodeIds     = 用户 pin 的节点, 即使 minimal 模式也强制显示 (选项 A)
      collapseMode:
        (typeof localStorage !== 'undefined' && localStorage.getItem('know_canvas_collapse_mode')) || 'full',
      expandedSourceIds: [],
      pinnedNodeIds: [],

      setCollapseMode: (mode) => {
        const next = mode === 'minimal' ? 'minimal' : 'full'
        try { localStorage.setItem('know_canvas_collapse_mode', next) } catch {}
        set({ collapseMode: next })
      },

      // 切换某个 ENTITY/源节点的"展开本支"状态
      toggleExpandSource: (sourceId) => {
        if (!sourceId) return
        set((state) => {
          const arr = Array.isArray(state.expandedSourceIds) ? state.expandedSourceIds : []
          const idx = arr.indexOf(sourceId)
          if (idx >= 0) state.expandedSourceIds = arr.filter((id) => id !== sourceId)
          else state.expandedSourceIds = [...arr, sourceId]
        })
      },
      collapseAllSources: () => set({ expandedSourceIds: [] }),

      // pin / unpin 一个节点 (强制显示, 不受 minimal 折叠规则约束)
      togglePinNode: (nodeId) => {
        if (!nodeId) return
        set((state) => {
          const arr = Array.isArray(state.pinnedNodeIds) ? state.pinnedNodeIds : []
          const idx = arr.indexOf(nodeId)
          if (idx >= 0) state.pinnedNodeIds = arr.filter((id) => id !== nodeId)
          else state.pinnedNodeIds = [...arr, nodeId]
        })
      },

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
      // 用户独立区域: 按用户名 hash 给每个用户分配独立的 X 偏移区, 避免多用户协作时项目互相重叠
      getNextGridPosition: () => {
        const { nodes } = get()

        // 计算本地用户的"分区偏移"
        // 简单 hash: 取用户名字符 codePoint 之和 mod 4, 给 0/2400/4800/7200 px 偏移
        // 4 列足够 4 个并发用户互不打架, 超过时取模仍有错位
        let userZoneX = 0
        try {
          const name = getUsername() || 'anonymous'
          let h = 0
          for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * 31) | 0
          userZoneX = (Math.abs(h) % 4) * 2400
        } catch (_e) {}

        if (nodes.length === 0) return { x: 100 + userZoneX, y: 100 }

        // 构建已占用网格位置集合 (含所有用户已落的节点)
        const occupied = new Set()
        nodes.forEach(n => {
          // 子节点 (parentNode 关系) 跳过, 它们的 position 是相对父的, 不参与全局占位
          if (n.parentNode) return
          const gridX = Math.round(n.position.x / LAYOUT.GRID_GAP_X)
          const gridY = Math.round(n.position.y / LAYOUT.GRID_GAP_Y)
          occupied.add(`${gridX},${gridY}`)
        })

        // 从用户专区原点螺旋向外寻找第一个可用位置
        const baseGridX = Math.round(userZoneX / LAYOUT.GRID_GAP_X)
        let x = baseGridX, y = 0
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

        applyCreatedByStamp(newNode)
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

        applyCreatedByStamp(newNode)
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

        applyCreatedByStamp(newNode)
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

        applyCreatedByStamp(newNode)
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

        applyCreatedByStamp(newNode)
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

        applyCreatedByStamp(newNode)
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
        // 元认知 5 步埋点: 每完成一步追加一帧 commit, 让回放系统能看到推进过程
        // metaStepNode 在自由画布上 (无 parentNode 链), 用 fallback 到 projects[0] (最新项目)
        if (patch && patch.status === 'done') {
          try {
            const stepNode = get().nodes.find((n) => n.id === stepNodeId)
            const stepId = stepNode?.data?.stepId
            const labelCn = META_STEP_LABEL_CN[stepId] || stepId || '步骤'
            _commitProjectSnapshot({
              projectId: null,  // metaStepNode 没有 projectGroup 关联, 走 fallback
              label: `元认知-${labelCn}`,
              getSnapshot: () => {
                const ex = get().exportCanvasData
                return typeof ex === 'function' ? ex() : { nodes: get().nodes, edges: get().edges }
              },
            })
          } catch (e) { console.warn('[commit-snapshot:meta-step]', e?.message) }
        }
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
              description: '为团队构建可对抗的决策画布',
              sentence: '为团队构建可对抗的决策画布',
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
        applyCreatedByStamp(newNode)
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
          // 派单时强制中文输出 (防止 Hermes worker 默认 system prompt 走英文)
          const userBody = node.data.body || ''
          const enrichedBody = userBody.includes('中文输出')
            ? userBody
            : `【输出语言要求】必须用简体中文输出, 禁止英文回答, 禁止英文标签或英文 title.\n\n${userBody}`
          task = await dispatchTask({
            title: node.data.title,
            body: enrichedBody,
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
        // 用绝对坐标定位新顶层 taskNode — src 若是 projectGroup 子节点, src.position 是相对父的偏移,
        // 直接 + offset 当绝对值会让 task 跑到 (画布原点+offset, 离源几千 px) — 用户感知"跑很远"
        const srcBox = getNodeAbsoluteBox(src, nodes)
        const taskNode = {
          id: taskId,
          type: 'taskNode',
          position: { x: srcBox.x + srcBox.w + 60, y: srcBox.y },
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
      // 反驳卡片**统一**堆到源节点所在 projectGroup 右侧的 challengeGroup 容器里
      // (避免散落在 entity / agent 之间造成视觉重叠 — 用户希望"自动生成就和手动整理后一样")
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

        // === 决定 challengeGroup 容器 ===
        // 优先复用源节点所在 projectGroup 的兄弟反驳通道 (id = `${projectGroupId}-challenges`)
        // 没有 projectGroup 时, 复用以源节点为单位的浮动通道 (id = `challengeGroup-floating-${ontoNodeId}`)
        const CHALLENGE_GROUP_W = 380
        const CHALLENGE_CARD_H = 230  // 单张反驳卡片估算高度 (含 padding)
        const CHALLENGE_GROUP_PAD = 30 // 容器内上下边距

        let challengeGroupId
        let challengeGroupPos
        const projectGroup = src.parentNode ? nodes.find((n) => n.id === src.parentNode && n.type === 'group') : null

        if (projectGroup) {
          challengeGroupId = `${projectGroup.id}-challenges`
          // 容器位置: projectGroup 右边界 + 80
          const groupX = projectGroup.position?.x || 0
          const groupY = projectGroup.position?.y || 0
          const groupW = Number(projectGroup.style?.width) || 1600
          challengeGroupPos = { x: groupX + groupW + 80, y: groupY }
        } else {
          challengeGroupId = `challengeGroup-floating-${ontoNodeId}`
          challengeGroupPos = { x: (src.position?.x || 0) + 360, y: src.position?.y || 0 }
        }

        const existing = nodes.find((n) => n.id === challengeGroupId)

        // 遮挡检测: 新建容器时避开已有节点 (PDF / 别的 challengeGroup / 其他 projectGroup)
        // 仅对新建容器做; 复用已存在的不动 (用户可能已经手动调过位置)
        if (!existing) {
          const containerH = CHALLENGE_GROUP_PAD * 2 + Math.max(challenges.length, 3) * CHALLENGE_CARD_H
          const free = findFreePosition(
            { x: challengeGroupPos.x, y: challengeGroupPos.y, w: CHALLENGE_GROUP_W, h: containerH },
            nodes, [], 'down',
          )
          challengeGroupPos = free
        }
        // 已有反驳卡片数 (用于 append 时的 y 偏移)
        const existingChallenges = nodes.filter((n) => n.parentNode === challengeGroupId && n.type === 'challengeNode')
        const startIdx = existingChallenges.length

        const ts = Date.now()
        const rand = () => Math.random().toString(36).slice(2, 8)
        const newNodes = []
        const newEdges = []

        // 没有容器就建一个 (severity 排序后续 append 也按到达顺序排, 简化处理)
        if (!existing) {
          newNodes.push({
            id: challengeGroupId,
            type: 'group',
            position: challengeGroupPos,
            style: {
              width: CHALLENGE_GROUP_W,
              height: Math.max(CHALLENGE_GROUP_PAD * 2 + (startIdx + challenges.length) * CHALLENGE_CARD_H, 260),
              background: 'rgba(178,124,139,0.04)',
              border: '1px dashed rgba(178,124,139,0.45)',
              borderRadius: 14,
            },
            data: {
              isChallengeGroup: true,
              label: '反驳通道',
              relatedProjectGroupId: projectGroup?.id || null,
              // sourceNodeId: minimal 折叠模式下 KnowledgeCanvas.shouldShow 用它判断是否展示本组
              // (之前漏了字段, 反驳容器和卡片在 minimal 模式永远 hidden, 用户点反驳后看不到任何反馈)
              sourceNodeId: ontoNodeId,
            },
          })
        }

        // 反驳按 severity 排 (critical/high 在上)
        const sevRank = { critical: 0, high: 1, medium: 2, low: 3 }
        const ordered = [...challenges].sort(
          (a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9),
        )

        ordered.forEach((c, i) => {
          const cid = `challenge-${ts}-${rand()}`
          const slotIdx = startIdx + i
          newNodes.push({
            id: cid,
            type: 'challengeNode',
            parentNode: challengeGroupId,
            extent: 'parent',
            // 容器内坐标: 居中放, 顶部留 PAD, 每张卡 CHALLENGE_CARD_H 高
            position: { x: 20, y: CHALLENGE_GROUP_PAD + slotIdx * CHALLENGE_CARD_H },
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
            type: 'smoothstep',
            data: { relationType: '反驳' },
            style: {
              stroke: c.severity === 'high' ? '#b27c8b' : c.severity === 'medium' ? '#c8a882' : '#888',
              strokeWidth: 1.5,
              strokeDasharray: '4 4',
            },
          })
        })

        stampNodesInPlace(newNodes)
        set((state) => {
          state.nodes.push(...newNodes)
          state.edges.push(...newEdges)
          // 复用旧容器时把高度撑大, 容下新卡片
          if (existing) {
            const grp = state.nodes.find((n) => n.id === challengeGroupId)
            if (grp) {
              const total = startIdx + challenges.length
              grp.style = {
                ...grp.style,
                height: Math.max(CHALLENGE_GROUP_PAD * 2 + total * CHALLENGE_CARD_H, 260),
              }
            }
          }
          // minimal 折叠模式: 自动展开"源节点"那一支 — 否则反驳卡片虽然存在, shouldShow 也 false
          if (Array.isArray(state.expandedSourceIds) && !state.expandedSourceIds.includes(ontoNodeId)) {
            state.expandedSourceIds.push(ontoNodeId)
          }
        })

        // 派 focus 事件 — 反驳容器被 findFreePosition 推到 projectGroup 右侧 +80, 可能再下偏 1600px,
        // 视野外, 用户点了反驳按钮以为没响应. 让视口跳到容器位置, 一眼看到新卡片.
        try {
          window.dispatchEvent(new CustomEvent('canvas-focus-node', { detail: { nodeId: challengeGroupId } }))
        } catch {}

        // 反驳生成完成 — 追加一帧 commit (回放埋点)
        // 项目 id 来源: src 节点向上查 projectGroup 的项目根 libraryId; 找不到 fallback projects[0]
        try {
          const pid = _findActiveProjectIdFromNode(get().nodes, src)
          _commitProjectSnapshot({
            projectId: pid,
            label: '反驳完成',
            getSnapshot: () => {
              const ex = get().exportCanvasData
              return typeof ex === 'function' ? ex() : { nodes: get().nodes, edges: get().edges }
            },
          })
        } catch (e) { console.warn('[commit-snapshot:challenge]', e?.message) }

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
        const CARD_H = 170
        const PAD = 30
        const newNodes = []
        const newEdges = []

        // === 决定 decomposeGroup 容器 ===
        // 拆解子节点散落在源下方会撞 ROLE/AGENT 行 (用户图 34 反馈)
        // 改为统一收到 projectGroup 下方独立容器, 每个源节点一个 decomposeGroup
        const projectGroup = src.parentNode ? nodes.find((n) => n.id === src.parentNode && n.type === 'group') : null

        let dgId, dgPos
        if (projectGroup) {
          dgId = `${projectGroup.id}-decompose-${ontoNodeId}`
          const groupX = projectGroup.position?.x || 0
          const groupY = projectGroup.position?.y || 0
          const groupH = Number(projectGroup.style?.height) || 1100
          // 落在所有兄弟 dg 的最低边下方 — 而不是按 existingDgs.length 计数偏移.
          // (按 length 偏移在删除中间 dg 后会与剩下的撞, 用户图反馈)
          let baseY = groupY + groupH + 60
          const existingDgs = nodes.filter((n) => n.type === 'group' && n.data?.isDecomposeGroup && n.data?.relatedProjectGroupId === projectGroup.id)
          for (const dg of existingDgs) {
            const box = getNodeAbsoluteBox(dg, nodes)
            baseY = Math.max(baseY, box.y + box.h + 40)
          }
          dgPos = { x: groupX, y: baseY }
        } else {
          dgId = `decomposeGroup-floating-${ontoNodeId}`
          dgPos = { x: (src.position?.x || 0), y: (src.position?.y || 0) + 320 }
        }

        const existing = nodes.find((n) => n.id === dgId)

        // 遮挡检测: 新建 decompose 容器时避开已有内容
        if (!existing) {
          const tentativeW = Math.max(COL_W * 5 + PAD * 2, COL_W * subitems.length + PAD * 2)
          const free = findFreePosition(
            { x: dgPos.x, y: dgPos.y, w: tentativeW, h: CARD_H + PAD * 2 + 24 },
            nodes, [], 'down',
          )
          dgPos = free
        }
        const existingChildren = nodes.filter((n) => n.parentNode === dgId && n.type === 'ontologyNode')
        const startIdx = existingChildren.length
        const totalAfter = startIdx + subitems.length
        const containerW = Math.max(COL_W * totalAfter + PAD * 2, COL_W * 5 + PAD * 2)

        if (!existing) {
          newNodes.push({
            id: dgId,
            type: 'group',
            position: dgPos,
            style: {
              width: containerW,
              height: CARD_H + PAD * 2 + 24,
              background: 'rgba(200,168,130,0.04)',
              border: '1px dashed rgba(200,168,130,0.45)',
              borderRadius: 14,
            },
            data: {
              isDecomposeGroup: true,
              label: `拆解 · ${src.data?.title || ''}`.slice(0, 32),
              relatedProjectGroupId: projectGroup?.id || null,
              sourceNodeId: ontoNodeId,
            },
          })
        }

        const srcDepth = typeof src.data?.depth === 'number' ? src.data.depth : 0
        subitems.forEach((s, i) => {
          const cid = `onto-${ts}-${rand()}`
          const slotIdx = startIdx + i
          newNodes.push({
            id: cid,
            type: 'ontologyNode',
            parentNode: dgId,
            extent: 'parent',
            position: { x: PAD + slotIdx * COL_W, y: PAD },
            data: {
              variant: 'entity',  // 二次拆出来的统一作为 entity, 用户可手动改
              title: s.title,
              description: s.description,
              parent_node: ontoNodeId,
              parent_goal: src.data?.parent_goal || src.data?.title,
              depth: srcDepth + 1,  // 拆解深度 +1, OntologyNode 用 MAX_DEPTH=3 截断
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

        stampNodesInPlace(newNodes)
        set((state) => {
          state.nodes.push(...newNodes)
          state.edges.push(...newEdges)
          // 复用已有容器: 撑大宽度
          if (existing) {
            const grp = state.nodes.find((n) => n.id === dgId)
            if (grp) grp.style = { ...grp.style, width: containerW }
          }
        })

        // 二次拆解完成 — 追加一帧 commit (回放埋点)
        // 项目 id 来源: src 节点向上查 projectGroup 的项目根 libraryId; 找不到 fallback projects[0]
        try {
          const pid = _findActiveProjectIdFromNode(get().nodes, src)
          _commitProjectSnapshot({
            projectId: pid,
            label: '再次拆解',
            getSnapshot: () => {
              const ex = get().exportCanvasData
              return typeof ex === 'function' ? ex() : { nodes: get().nodes, edges: get().edges }
            },
          })
        } catch (e) { console.warn('[commit-snapshot:decompose]', e?.message) }

        return subitems
      },

      // 圈选组合元认知 — 把多个节点合成一句话 → 走 6-stage 多节点拆解 + agent + 决策
      // (老行为: 单节点 5 维度大纲已废弃, 用户反馈"应该直接调元认知 LLM 对内容做分解和再推导")
      // 新行为: askAndStartMetaProject(合成 prompt) 拿到 root, 再把 root 用"组合源"边连回选中节点
      analyzeGroupMetaCognitive: async (nodeIds) => {
        if (!Array.isArray(nodeIds) || nodeIds.length < 2) {
          throw new Error('analyzeGroupMetaCognitive: 至少需要 2 个节点')
        }
        const { nodes, askAndStartMetaProject } = get()
        const srcNodes = nodeIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean)
        if (srcNodes.length < 2) throw new Error('找不到足够的源节点')

        // 1. 把选中节点合成一句话 prompt — 让 LLM 当作完整问题重新拆解
        const titles = srcNodes.map((n) => (n.data?.title || n.data?.label || '未命名节点')).filter(Boolean)
        const descs = srcNodes
          .map((n) => (n.data?.description || n.data?.summary || n.data?.text || ''))
          .filter((s) => s && s.length > 0)
          .map((s) => String(s).slice(0, 180))
        const prompt = [
          `请把下列 ${srcNodes.length} 个节点当作一个整体系统, 重新拆解 / 推导出可执行的 task DAG + 角色分工 + 决策建议:`,
          '',
          `节点标题: ${titles.join(' · ')}`,
          descs.length ? `节点详情: ${descs.join(' / ')}` : '',
        ].filter(Boolean).join('\n')

        // 2. 算所选节点 bbox 给新 projectGroup 一个有视觉关联的 origin —
        // 默认 getNextGridPosition 会按用户专区螺旋找空位, 跟所选节点完全无关, 用户看不到"下一步出在哪"
        let originPosition
        try {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const n of srcNodes) {
            const box = getNodeAbsoluteBox(n, nodes)
            if (box.x < minX) minX = box.x
            if (box.y < minY) minY = box.y
            if (box.x + box.w > maxX) maxX = box.x + box.w
            if (box.y + box.h > maxY) maxY = box.y + box.h
          }
          if (Number.isFinite(minX)) {
            // 落在所选 bbox 的右侧 80px, 顶部对齐 — projectGroup 1600×1100 与源都在视野
            originPosition = { x: maxX + 80, y: minY }
          }
        } catch (e) { console.warn('[analyzeGroupMetaCognitive] origin 计算失败, 回退默认网格', e?.message) }

        // 3. 调 askAndStartMetaProject (同步返回 rootId, 6-stage 异步跑)
        const rootId = askAndStartMetaProject(prompt, originPosition ? { originPosition } : undefined)

        // 3. 给 root 加 sourceNodeIds 标记 + 用边连回所有选中节点
        const ts = Date.now()
        const rand = Math.random().toString(36).slice(2, 8)
        const newEdges = nodeIds.map((targetId, i) => ({
          id: `edge-group-${ts}-${rand}-${i}`,
          source: rootId,
          target: targetId,
          type: 'smoothstep',
          data: { relationType: '组合源' },
          label: '组合源',
          style: { stroke: '#c8a882', strokeWidth: 1.2, strokeDasharray: '6 3', opacity: 0.7 },
        }))
        get().updateNode(rootId, {
          isGroupMeta: true,
          sourceNodeIds: nodeIds,
          title: `组合分析: ${titles.slice(0, 2).join(' · ')}${titles.length > 2 ? ` 等 ${titles.length} 项` : ''}`,
        })
        set((state) => { state.edges.push(...newEdges) })

        // 派 focus 到新 projectGroup — 让视口跳过去, 用户立刻看到下一步在哪 (新 group + 与源的连边)
        try {
          window.dispatchEvent(new CustomEvent('canvas-focus-node', { detail: { nodeId: `pgroup-${rootId}` } }))
        } catch {}

        return { groupId: rootId, sourceCount: srcNodes.length }
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

      // ──────────────────────────────────────────────────────────────────────
      // 一句话 → HtmlPageNode (BottomAIBar 主交互)
      //   - 立即创建 htmlPageNode 占位 (status='running' + 任务清单)
      //   - 异步走 LLM (元认知) 或 Hermes 派单, 完成回填 html
      //   - 提供 retryHtmlAnswer 复用同一节点重跑
      // ──────────────────────────────────────────────────────────────────────
      askAndCreateHtmlNode: async (input, mode = 'meta') => {
        const text = String(input || '').trim()
        if (!text) throw new Error('askAndCreateHtmlNode: 输入为空')

        const { getNextGridPosition } = get()
        const ts = Date.now()
        const rand = Math.random().toString(36).slice(2, 8)
        const nodeId = `htmlpage-${ts}-${rand}`
        const pos = getNextGridPosition()

        const tasksMeta = [
          { label: '解析输入意图', status: 'running' },
          { label: '推理 5 维度元认知', status: 'pending' },
          { label: '渲染 HTML 页面', status: 'pending' },
        ]
        const tasksHermes = [
          { label: '派单到 Hermes', status: 'running' },
          { label: '等待 worker 接手', status: 'pending' },
          { label: '抓取结果包装 HTML', status: 'pending' },
        ]

        set((state) => {
          state.nodes.push({
            id: nodeId,
            type: 'htmlPageNode',
            position: pos,
            data: {
              prompt: text,
              mode,
              taskStatus: 'running',
              html: '',
              error: '',
              tasks: mode === 'hermes' ? tasksHermes : tasksMeta,
              created_at: ts,
            },
          })
        })

        // 异步执行核心 — 不 await, 让节点先呈现
        get()._runHtmlAnswer(nodeId).catch((err) => {
          console.error('[askAndCreateHtmlNode] run failed:', err)
        })

        return nodeId
      },

      retryHtmlAnswer: (nodeId) => {
        const { nodes, updateNode, _runHtmlAnswer } = get()
        const node = nodes.find((n) => n.id === nodeId)
        if (!node || node.type !== 'htmlPageNode') return
        const mode = node.data?.mode || 'meta'
        const tasks = mode === 'hermes'
          ? [
              { label: '派单到 Hermes', status: 'running' },
              { label: '等待 worker 接手', status: 'pending' },
              { label: '抓取结果包装 HTML', status: 'pending' },
            ]
          : [
              { label: '解析输入意图', status: 'running' },
              { label: '推理 5 维度元认知', status: 'pending' },
              { label: '渲染 HTML 页面', status: 'pending' },
            ]
        updateNode(nodeId, {
          taskStatus: 'running',
          html: '',
          error: '',
          tasks,
        })
        _runHtmlAnswer(nodeId).catch((err) => console.error('[retryHtmlAnswer] failed:', err))
      },

      // 内部: 实际跑 LLM/Hermes 的核心, askAndCreate + retry 共用
      _runHtmlAnswer: async (nodeId) => {
        const { nodes, updateNode } = get()
        const node = nodes.find((n) => n.id === nodeId)
        if (!node) return
        const text = node.data?.prompt || ''
        const mode = node.data?.mode || 'meta'

        const setTasks = (tasks) => updateNode(nodeId, { tasks })

        if (mode === 'meta') {
          try {
            const svc = await import('../services/aiService')
            // step1 done, step2 running
            setTasks([
              { label: '解析输入意图', status: 'done' },
              { label: '推理 5 维度元认知', status: 'running' },
              { label: '渲染 HTML 页面', status: 'pending' },
              { label: '决策引擎评判', status: 'pending' },
            ])
            const html = await svc.generateAnswerHtml(text)
            // step2/3 done, step4 running (决策引擎)
            updateNode(nodeId, {
              taskStatus: 'done',
              html,
              tasks: [
                { label: '解析输入意图', status: 'done' },
                { label: '推理 5 维度元认知', status: 'done' },
                { label: '渲染 HTML 页面', status: 'done' },
                { label: '决策引擎评判', status: 'running' },
              ],
            })
            // 决策引擎 (failure 不阻断, html 已经在了)
            const decision = await svc.runDecisionEngine(text, html).catch((e) => {
              console.warn('[runDecisionEngine] 失败:', e)
              return null
            })
            updateNode(nodeId, {
              decision,
              tasks: [
                { label: '解析输入意图', status: 'done' },
                { label: '推理 5 维度元认知', status: 'done' },
                { label: '渲染 HTML 页面', status: 'done' },
                { label: '决策引擎评判', status: decision ? 'done' : 'failed' },
              ],
            })
            // 自动入项目库 — 存全字段 (prompt/mode/html/decision/tasks)
            await get()._saveProjectFromHtmlNode(nodeId)
          } catch (err) {
            updateNode(nodeId, {
              taskStatus: 'failed',
              error: err?.message || '生成失败',
              tasks: [
                { label: '解析输入意图', status: 'done' },
                { label: '推理 5 维度元认知', status: 'failed' },
                { label: '渲染 HTML 页面', status: 'pending' },
              ],
            })
          }
        } else if (mode === 'hermes') {
          try {
            const svc = await import('../services/hermesService')
            const task = await svc.dispatchTask({
              title: text.slice(0, 80),
              body: `【输出语言要求】必须用简体中文输出, 禁止英文回答, 禁止英文标签或英文 title.\n\n${text}`,
            })
            setTasks([
              { label: '派单到 Hermes', status: 'done' },
              { label: '等待 worker 接手', status: 'running' },
              { label: '抓取结果包装 HTML', status: 'pending' },
            ])
            // 包成 HTML 派单回执 (poll 完整结果留 v0.2)
            const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
            const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
body{font-family:'Noto Sans SC',system-ui,sans-serif;background:#fafafa;color:#1a1a1a;padding:48px;max-width:720px;margin:0 auto;line-height:1.7}
h1{font-family:'Noto Serif SC',Georgia,serif;font-size:1.3rem;letter-spacing:0.02em;margin:0 0 32px;font-weight:500}
.label{font-size:0.7rem;letter-spacing:0.35em;color:#c8a882;margin-bottom:8px;text-transform:uppercase}
.row{margin:18px 0;display:flex;gap:16px;font-size:0.85rem}
.row b{color:#888;font-weight:400;letter-spacing:0.1em;font-size:0.7rem;text-transform:uppercase;min-width:90px}
.note{margin-top:40px;font-size:0.78rem;color:#888;border-left:2px solid #e8d5c0;padding:8px 16px;line-height:1.8}
.divider{height:1px;background:#e8e8e8;margin:32px 0}
</style></head><body>
<div class="label">Hermes Dispatch · 派单回执</div>
<h1>${escape(text)}</h1>
<div class="divider"></div>
<div class="row"><b>任务 ID</b><span>${escape(task.id)}</span></div>
<div class="row"><b>状态</b><span>${escape(task.status || 'ready')}</span></div>
<div class="row"><b>派发时间</b><span>${new Date().toLocaleString('zh-CN')}</span></div>
${task.assignee ? `<div class="row"><b>Worker</b><span>${escape(task.assignee)}</span></div>` : ''}
<div class="note">Worker 在 Hermes 端运行中, 完成后 result 会写到画布右侧 ResultNode. 当前是派单回执. 此节点可作为页面索引保留.</div>
</body></html>`
            updateNode(nodeId, {
              taskStatus: 'done',
              html,
              hermesTaskId: task.id,
              tasks: [
                { label: '派单到 Hermes', status: 'done' },
                { label: '等待 worker 接手', status: 'done' },
                { label: '抓取结果包装 HTML', status: 'done' },
                { label: '决策引擎评判', status: 'running' },
              ],
            })
            // 决策引擎 (Hermes 模式也跑)
            const aiSvc = await import('../services/aiService')
            const decision = await aiSvc.runDecisionEngine(text, html).catch(() => null)
            updateNode(nodeId, {
              decision,
              tasks: [
                { label: '派单到 Hermes', status: 'done' },
                { label: '等待 worker 接手', status: 'done' },
                { label: '抓取结果包装 HTML', status: 'done' },
                { label: '决策引擎评判', status: decision ? 'done' : 'failed' },
              ],
            })
            await get()._saveProjectFromHtmlNode(nodeId)
          } catch (err) {
            updateNode(nodeId, {
              taskStatus: 'failed',
              error: err?.message || '派单失败',
              tasks: [
                { label: '派单到 Hermes', status: 'failed' },
                { label: '等待 worker 接手', status: 'pending' },
                { label: '抓取结果包装 HTML', status: 'pending' },
              ],
            })
          }
        } else {
          updateNode(nodeId, {
            taskStatus: 'failed',
            error: `未知模式 "${mode}"`,
          })
        }
      },

      // ──────────────────────────────────────────────────────────────────────
      // ALETHEIA 项目模式 — 一句话 → 真实项目拆分 + Agent 涌现 (画布展示推理过程)
      //   1. 立即建项目根节点 (ontologyNode goal)
      //   2. 一次 LLM 调用拿 6 stage 结构 (project_profile/task_dag/roles/topology/reflection)
      //   3. 串行揭示 6 阶段: CONTEXT → DECOMPOSE (建 task 节点) → EMERGE (建 agent 节点)
      //      → TOPOLOGY (画依赖虚线 + 染 stage 同色) → EXECUTE (按 stage 切 running/done)
      //      → REFLECT (跑决策引擎, 入项目库)
      // ──────────────────────────────────────────────────────────────────────
      askAndStartMetaProject: (input, opts = {}) => {
        const text = String(input || '').trim()
        if (!text) throw new Error('askAndStartMetaProject: 输入为空')

        const { getNextGridPosition, updateNode } = get()
        const ts = Date.now()
        const rand = () => Math.random().toString(36).slice(2, 8)
        const rootId = `project-${ts}-${rand()}`
        const projectGroupId = `pgroup-${rootId}`  // 整个项目的 group 容器
        // opts.originPosition: 绝对坐标 {x, y} — 让 projectGroup 落在指定位置 (例: 圈选组合分析时用源节点中心)
        // 否则按用户专区螺旋找空位 (默认行为, 适合 BottomAIBar 自由提问)
        const pos = opts.originPosition || getNextGridPosition()

        // 0. 项目独立"频道" — 用 react-flow group 节点把 root + tasks + agents + conclusion 全包起来
        //    用户拖 group 时整个项目跟随; 不同项目的 group 互不重叠 (用户独立 X 区已分配)
        const stamp = (() => { try { return getCreatedByStamp() } catch { return null } })()
        const projectGroupNode = {
          id: projectGroupId,
          type: 'group',
          position: pos,
          // 预留尺寸 (root + 5 task + 4 agent + conclusion 大致占地); 子节点位置都是相对 group 的偏移
          style: {
            width: 1600,
            height: 1100,
            background: stamp?.color ? `${stamp.color}10` : 'rgba(200,168,130,0.06)',
            border: `1px dashed ${stamp?.color || '#c8a882'}55`,
            borderRadius: 14,
          },
          data: {
            isProjectGroup: true,
            ownerName: stamp?.name || '',
            ownerColor: stamp?.color || '#c8a882',
            createdBy: stamp,
          },
          draggable: true,
          selectable: true,
        }
        set((state) => { state.nodes.push(projectGroupNode) })

        // 1. 立即建项目根节点 (goal variant) — 作为 group 的子节点, position 改成相对 group
        const rootNode = {
          id: rootId,
          type: 'ontologyNode',
          position: { x: 700, y: 60 },  // 相对 group 居中靠上
          parentNode: projectGroupId,
          data: {
            variant: 'goal',
            title: text.slice(0, 40),
            description: '',
            sentence: text,
            projectMode: true,
            projectStatus: 'running',
            projectStage: 'CONTEXT',
            created_at: ts,
          },
        }
        applyCreatedByStamp(rootNode)
        set((state) => { state.nodes.push(rootNode) })

        // 串行揭示用的延时
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

        // 整个 6-stage 流程异步跑 — 立即返回 rootId, 让 BottomAIBar 解锁 submitting
        ;(async () => {

        // 项目模式 stage 同组配色 — 用户反馈 (图 49 后): 从上到下深浅梯度更易读
        // 同一暖色 hue, 从上往下 alpha 递减 (顶层 stage 1 最深, 底层 stage N 最浅)
        // 让用户一眼看出层级关系: 越深越靠主干顶端
        const stageGroupColors = [
          'rgba(200,168,130,0.28)', // L1 stage 1 (DECOMPOSE 拆解层) — 最深
          'rgba(200,168,130,0.18)', // L2 stage 2 (EMERGE 涌现层) — 中
          'rgba(200,168,130,0.10)', // L3 stage 3 (EXECUTE 执行层) — 较浅
          'rgba(200,168,130,0.05)', // L4 stage 4 (REFLECT 反思层) — 最浅
        ]

        try {
          // 2. 一次 LLM 调用拿整个 6 stage 结构
          const svc = await import('../services/aiService')
          const structure = await svc.generateMetaProjectStructure(text)

          if (!structure?.task_dag?.length || !structure?.roles?.length) {
            throw new Error('LLM 没产出有效的 task_dag / roles')
          }

          // ───── Stage 1 CONTEXT (1.2s 后) ─────
          await sleep(1200)
          updateNode(rootId, {
            projectStage: 'DECOMPOSE',
            description: structure.project_profile.target,
            project_profile: structure.project_profile,
            structure, // 整个 6 stage 全字段都存一份, 入库时直接用
          })

          // ───── Stage 2 DECOMPOSE (1.2s 后) — 建 task 节点 ─────
          await sleep(1200)
          const COL_W = 260
          const ROW_H = 220
          const GROUP_CENTER_X = 800  // root 居中在 group 中心
          const ROOT_Y = 60
          const TASK_Y = ROOT_Y + ROW_H
          const taskCount = structure.task_dag.length
          // task 位置: 相对 group 的偏移 (parentNode = projectGroupId, 与 root 平级当 group 子)
          // 横向以 group 中心为基准, 居中分布
          const taskOffsetX0 = GROUP_CENTER_X - ((taskCount - 1) * COL_W) / 2
          const taskIdMap = {} // T1 → 真实 nodeId
          // 给每个 task 预算一个 stageGroupColor: 由"承担它的 role 的 stage"决定
          // 同 stage 的 task + agent 用同色, 视觉上一目了然属于一组
          const taskStageColorMap = {}
          structure.execution_topology.stages.forEach((s) => {
            const color = stageGroupColors[(s.stage_index - 1) % stageGroupColors.length]
            s.role_ids.forEach((rid) => {
              const role = structure.roles.find((r) => r.id === rid)
              if (role?.assigned_tasks) {
                role.assigned_tasks.forEach((tid) => {
                  if (!taskStageColorMap[tid]) taskStageColorMap[tid] = color
                })
              }
            })
          })
          const taskNodes = structure.task_dag.map((t, i) => {
            const nid = `task-${rootId}-${t.id}`
            taskIdMap[t.id] = nid
            return {
              id: nid,
              type: 'ontologyNode',
              position: { x: taskOffsetX0 + i * COL_W, y: TASK_Y },
              parentNode: projectGroupId,  // 整组移动: parent = projectGroup, 与 root 平级
              data: {
                variant: 'entity',
                title: t.title,
                description: t.desc,
                projectTaskId: t.id,
                projectRootId: rootId,
                stageGroupColor: taskStageColorMap[t.id] || stageGroupColors[0],  // 同组同色
                created_at: ts,
              },
            }
          })
          const taskEdges = taskNodes.map((tn) => ({
            id: `edge-${ts}-${rand()}`,
            source: rootId,
            target: tn.id,
            type: 'smoothstep',
            data: { relationType: '拆解' },
            label: '拆解',
            style: { stroke: 'var(--accent, #c8a882)', strokeWidth: 1.5 },
          }))
          stampNodesInPlace(taskNodes)
          set((state) => {
            state.nodes.push(...taskNodes)
            state.edges.push(...taskEdges)
          })
          updateNode(rootId, { projectStage: 'EMERGE' })

          // ───── Stage 3 EMERGE — 每个 role 间隔 0.6s ─────
          // 计算 role -> stage_index 映射 (用于布局 + 染色)
          const roleStageMap = {}
          structure.execution_topology.stages.forEach((s) => {
            s.role_ids.forEach((rid) => {
              roleStageMap[rid] = s
            })
          })

          const roleIdMap = {}
          // role 的 y 按它所在 stage_index 错位排, x 跟随 assigned_tasks 第一个 task
          for (let i = 0; i < structure.roles.length; i++) {
            const role = structure.roles[i]
            const firstTaskId = role.assigned_tasks[0]
            const anchorTaskNode = firstTaskId ? taskNodes.find((n) => n.data.projectTaskId === firstTaskId) : null
            const stageInfo = roleStageMap[role.id]
            const stageIndex = stageInfo?.stage_index || 1
            // 同 stage 多 role 横向错开 — 计算这个 stage 里它的位置
            const sameStageRoles = structure.execution_topology.stages.find((s) => s.stage_index === stageIndex)?.role_ids || [role.id]
            const sameStageIdx = sameStageRoles.indexOf(role.id)
            const sameStageCount = sameStageRoles.length

            // anchorTaskNode.position 已经是相对 projectGroup 的偏移
            const anchorX = anchorTaskNode ? anchorTaskNode.position.x : taskOffsetX0 + i * COL_W
            const xOffset = sameStageCount > 1 ? (sameStageIdx - (sameStageCount - 1) / 2) * 60 : 0
            const x = anchorX + xOffset
            // agent 作为 projectGroup 子, y = task 行下面 + stage 错开
            const AGENT_Y_BASE = TASK_Y + ROW_H
            const y = AGENT_Y_BASE + (stageIndex - 1) * 40

            const nid = `agent-${rootId}-${role.id}`
            roleIdMap[role.id] = nid

            const stageGroupColor = stageGroupColors[(stageIndex - 1) % stageGroupColors.length]
            const newRoleNode = {
              id: nid,
              type: 'agentRoleNode',
              position: { x, y },
              parentNode: projectGroupId,  // 整组移动: parent = projectGroup
              data: {
                roleId: role.id,
                name: role.name,
                responsibility: role.responsibility,
                assigned_tasks: role.assigned_tasks,
                tools: role.tools,
                status: 'pending',
                stageIndex,
                stageKind: stageInfo?.kind || 'parallel',
                stageGroupColor,
                projectRootId: rootId,
                created_at: ts,
              },
            }
            // 从该 role 承担的每个 task → role 节点连边
            const newRoleEdges = role.assigned_tasks
              .map((tid) => taskIdMap[tid])
              .filter(Boolean)
              .map((taskNodeId) => ({
                id: `edge-${ts}-${rand()}`,
                source: taskNodeId,
                target: nid,
                type: 'smoothstep',
                data: { relationType: '承担' },
                label: '承担',
                style: { stroke: 'var(--accent, #c8a882)', strokeWidth: 1.5 },
              }))
            applyCreatedByStamp(newRoleNode)
            set((state) => {
              state.nodes.push(newRoleNode)
              state.edges.push(...newRoleEdges)
            })
            await sleep(600)
          }

          updateNode(rootId, { projectStage: 'TOPOLOGY' })

          // ───── Stage 4 TOPOLOGY (1.2s 后) — 串行 stage 之间画虚线依赖 ─────
          await sleep(1200)
          const stages = [...structure.execution_topology.stages].sort((a, b) => a.stage_index - b.stage_index)
          const topologyEdges = []
          for (let i = 1; i < stages.length; i++) {
            const prev = stages[i - 1]
            const cur = stages[i]
            // 给每对 (prev role → cur role) 画依赖虚线
            prev.role_ids.forEach((prid) => {
              cur.role_ids.forEach((crid) => {
                const sourceNid = roleIdMap[prid]
                const targetNid = roleIdMap[crid]
                if (!sourceNid || !targetNid) return
                topologyEdges.push({
                  id: `edge-${ts}-${rand()}`,
                  source: sourceNid,
                  target: targetNid,
                  type: 'smoothstep',
                  data: { relationType: '依赖' },
                  label: '依赖',
                  style: { stroke: '#888', strokeWidth: 1, strokeDasharray: '4 4' },
                })
              })
            })
          }
          if (topologyEdges.length > 0) {
            set((state) => {
              state.edges.push(...topologyEdges)
            })
          }
          updateNode(rootId, { projectStage: 'EXECUTE' })

          // ───── Stage 5 EXECUTE — 按 topology stage 顺序派真 Hermes worker ─────
          // 优先派真 worker; hermes-proxy 健康检查失败时退化到前端模拟保 demo 不挂
          let hermesAvailable = false
          let hermesSvc = null
          try {
            hermesSvc = await import('../services/hermesService')
            const hc = await hermesSvc.healthCheck()
            hermesAvailable = !!hc?.ok
          } catch {
            hermesAvailable = false
          }

          for (const stage of stages) {
            await sleep(800)
            const runningRoleNodeIds = stage.role_ids.map((rid) => roleIdMap[rid]).filter(Boolean)
            // 该 stage 所有 role 同时切 running
            set((state) => {
              runningRoleNodeIds.forEach((nid) => {
                const n = state.nodes.find((x) => x.id === nid)
                if (n) n.data.status = 'running'
              })
            })

            if (hermesAvailable && hermesSvc) {
              // 真 worker 路径 — 并行派单, 拿到 hermesTaskId 立即写回, 然后 polling 完成
              const dispatches = stage.role_ids.map(async (rid) => {
                const role = structure.roles.find((r) => r.id === rid)
                const nid = roleIdMap[rid]
                if (!role || !nid) return
                const assignedTitles = (role.assigned_tasks || [])
                  .map((tid) => structure.task_dag.find((t) => t.id === tid)?.title)
                  .filter(Boolean)
                  .join(' / ') || role.responsibility
                const title = `${role.name}: ${assignedTitles}`.slice(0, 80)
                const body = `【输出语言要求】必须用简体中文输出, 禁止英文回答, 禁止英文标签或英文 title.

项目目标: ${structure.project_profile?.target || text}

角色: ${role.name}
职责: ${role.responsibility}
负责任务: ${assignedTitles}
工具: ${(role.tools || []).join(', ')}

请按角色职责给出执行计划摘要 (用中文, 不超过 120 字).`
                try {
                  const task = await hermesSvc.dispatchTask({ title, body, max_runtime_seconds: 180 })
                  set((state) => {
                    const n = state.nodes.find((x) => x.id === nid)
                    if (n) {
                      n.data.hermesTaskId = task.id
                      n.data.dispatchedAt = Date.now()
                    }
                  })
                  // polling 直到 done/failed 或 90s 上限
                  const result = await hermesSvc.pollTask(task.id, { intervalMs: 5000, timeoutMs: 90000 }).catch(() => null)
                  set((state) => {
                    const n = state.nodes.find((x) => x.id === nid)
                    if (!n) return
                    if (result && result.status === 'done') {
                      n.data.status = 'done'
                      n.data.output_summary = (result.result || result.summary || '').slice(0, 200) || `${role.name} 已完成`
                    } else if (result && (result.status === 'blocked' || result.status === 'failed')) {
                      n.data.status = 'failed'
                      n.data.output_summary = `Hermes ${result.status}: ${(result.error || '').slice(0, 100)}`
                    } else {
                      // timeout — 标 done 但说明走超时 fallback
                      n.data.status = 'done'
                      n.data.output_summary = `${role.name} 已派单, worker 超时未返回 (taskId: ${task.id.slice(0, 12)}…)`
                    }
                  })
                } catch (err) {
                  // dispatch 本身失败 — 退化到模拟
                  await sleep(1200)
                  set((state) => {
                    const n = state.nodes.find((x) => x.id === nid)
                    if (n) {
                      n.data.status = 'done'
                      n.data.output_summary = `Hermes 派单失败 (${(err?.message || '').slice(0, 60)}), 用模拟产出`
                    }
                  })
                }
              })
              await Promise.all(dispatches)
            } else {
              // 模拟路径 — 1.5s 后切 done
              await sleep(1500)
              set((state) => {
                stage.role_ids.forEach((rid) => {
                  const role = structure.roles.find((r) => r.id === rid)
                  const nid = roleIdMap[rid]
                  const n = state.nodes.find((x) => x.id === nid)
                  if (n) {
                    n.data.status = 'done'
                    n.data.output_summary = role
                      ? `已完成 ${role.name} 的工作 (Hermes 不可用, 模拟产出)`
                      : '已完成 (模拟产出)'
                  }
                })
              })
            }
          }

          updateNode(rootId, { projectStage: 'REFLECT' })

          // ───── Stage 6 REFLECT — 跑决策引擎 + 入项目库 ─────
          // 把整个 structure 序列化喂给决策引擎, 让它基于"项目拆解出来什么"来评判
          const structText = JSON.stringify({
            target: structure.project_profile.target,
            tasks: structure.task_dag.map((t) => `${t.id}: ${t.title}`),
            roles: structure.roles.map((r) => `${r.id}(${r.name}): ${r.responsibility}`),
            topology: structure.execution_topology.stages.map((s) =>
              `${s.kind} stage ${s.stage_index}: [${s.role_ids.join(', ')}]`
            ),
            reflection: structure.reflection_hint,
          }, null, 2)
          const decision = await svc.runDecisionEngine(text, structText).catch((e) => {
            console.warn('[askAndStartMetaProject] runDecisionEngine 失败:', e)
            return null
          })

          updateNode(rootId, {
            projectStatus: 'done',
            decision,
          })

          // 结论节点 — 把决策独立成一个深色"汇聚"节点, 放在所有 agent 之下
          // 视觉效果: root → tasks → agents → 结论 (从上到下严格层级)
          if (decision) {
            const stageMaxIdx = Math.max(1, ...Object.values(roleStageMap).map((s) => s.stage_index || 1))
            const conclusionId = `conclusion-${rootId}`
            const conclusionNode = {
              id: conclusionId,
              type: 'ontologyNode',
              // 相对 projectGroup: 居中横向, 纵向在所有 agent 之下
              position: { x: GROUP_CENTER_X, y: TASK_Y + ROW_H + (stageMaxIdx - 1) * 40 + 220 },
              parentNode: projectGroupId,
              data: {
                variant: 'goal',  // 深色显示
                title: `结论: ${decision.verdict?.toUpperCase() || '?'}${decision.score ? ` · ${decision.score} 分` : ''}`,
                description: decision.summary || '',
                isConclusion: true,
                projectRootId: rootId,
                conclusion: decision,
                created_at: ts,
              },
            }
            applyCreatedByStamp(conclusionNode)
            // 从所有 agent 节点指向结论 (汇聚虚线)
            const conclusionEdges = Object.values(roleIdMap).map((agentId) => ({
              id: `edge-${ts}-conc-${agentId.slice(-6)}`,
              source: agentId,
              target: conclusionId,
              type: 'smoothstep',
              data: { relationType: '汇聚' },
              label: '',
              style: { stroke: '#1a1a1a', strokeWidth: 1.2, strokeDasharray: '4 3', opacity: 0.55 },
            }))
            set((state) => {
              state.nodes.push(conclusionNode)
              state.edges.push(...conclusionEdges)
            })
          }

          // 入项目库 — snapshot 含整个 structure + decision + 创建的所有节点 id
          await get()._saveProjectFromMetaProject(rootId)

          // Aletheia 综合阶段完成 — 追加一帧 commit (回放埋点)
          // _saveProjectFromMetaProject 之后 root 已带 libraryId, 直接读它
          try {
            const root = get().nodes.find((n) => n.id === rootId)
            const pid = root?.data?.libraryId || null
            _commitProjectSnapshot({
              projectId: pid,
              label: 'Aletheia 综合',
              getSnapshot: () => {
                const ex = get().exportCanvasData
                return typeof ex === 'function' ? ex() : { nodes: get().nodes, edges: get().edges }
              },
            })
          } catch (e) { console.warn('[commit-snapshot:aletheia]', e?.message) }
        } catch (err) {
          console.error('[askAndStartMetaProject] failed:', err)
          updateNode(rootId, {
            projectStatus: 'failed',
            error: err?.message || '项目拆解失败',
          })
        }
        })()  // IIFE 结束 - 6-stage 异步流程

        // 同步返回 rootId, BottomAIBar 立刻解锁 submitting
        return rootId
      },

      // 内部: 把一个 done 的 ALETHEIA 项目入项目库, source='aletheia'
      // snapshot 含整个 6-stage structure + decision + 所有节点/边的 id 引用
      _saveProjectFromMetaProject: async (rootId) => {
        try {
          const { nodes, edges } = get()
          const root = nodes.find((n) => n.id === rootId)
          if (!root || root.type !== 'ontologyNode') return null
          const d = root.data || {}
          const lib = (await import('./useProjectLibraryStore')).default.getState()
          if (!lib?.saveProject) return null

          // 收集这次创建的所有节点/边 (包含 root 自己 + task_dag + agent_role 节点)
          const projectNodeIds = new Set([rootId])
          nodes.forEach((n) => {
            if (n.data?.projectRootId === rootId) projectNodeIds.add(n.id)
          })
          const projectNodes = nodes.filter((n) => projectNodeIds.has(n.id))
          const projectEdges = edges.filter((e) => projectNodeIds.has(e.source) && projectNodeIds.has(e.target))

          const verdict = d.decision?.verdict
          const score = d.decision?.score
          const titleBase = (d.sentence || d.title || '未命名项目').slice(0, 60)
          const title = verdict
            ? `${titleBase} · ${verdict.toUpperCase()}${score ? ` ${score}` : ''}`
            : titleBase
          const summary = d.decision?.summary
            || (d.project_profile?.target ? `ALETHEIA 项目: ${d.project_profile.target}` : '')

          const id = lib.saveProject({
            title,
            summary,
            source: 'aletheia',
            tags: ['aletheia', 'project', verdict, d.project_profile?.domain].filter(Boolean),
            snapshot: {
              kind: 'aletheiaProject',
              prompt: d.sentence,
              project_profile: d.project_profile,
              structure: d.structure,
              decision: d.decision,
              // 整个项目相关的节点和边都存一份, 方便重载
              nodes: JSON.parse(JSON.stringify(projectNodes)),
              edges: JSON.parse(JSON.stringify(projectEdges)),
              rootId,
              created_at: d.created_at || Date.now(),
            },
            stats: {
              nodeCount: projectNodes.length,
              edgeCount: projectEdges.length,
            },
          })
          if (id) {
            const { updateNode } = get()
            updateNode(rootId, { libraryId: id })
          }
          return id
        } catch (err) {
          console.error('[_saveProjectFromMetaProject] 失败:', err)
          return null
        }
      },

      // 内部: 把一个 done 的 HtmlPageNode 入项目库, 存全字段
      // (prompt + mode + html + decision + tasks + 节点 snapshot 引用)
      _saveProjectFromHtmlNode: async (nodeId) => {
        try {
          const node = get().nodes.find((n) => n.id === nodeId)
          if (!node || node.type !== 'htmlPageNode') return null
          const d = node.data || {}
          const lib = (await import('./useProjectLibraryStore')).default.getState()
          if (!lib?.saveProject) return null
          const verdict = d.decision?.verdict
          const score = d.decision?.score
          // 项目库 entry 标题 = prompt 前 60 字 + verdict 后缀
          const titleBase = (d.prompt || '未命名项目').slice(0, 60)
          const title = verdict ? `${titleBase} · ${verdict.toUpperCase()}${score ? ` ${score}` : ''}` : titleBase
          const summary = d.decision?.summary || (d.html ? `${d.mode === 'hermes' ? 'Hermes 派单' : '元认知 5 维度'}, ${(d.html.length / 1024).toFixed(1)} KB HTML` : '')
          const id = lib.saveProject({
            title,
            summary,
            source: d.mode === 'hermes' ? 'hermes' : 'meta-cognitive',
            tags: [d.mode, verdict].filter(Boolean),
            // 把整条 HtmlPageNode 数据快照下来 — 全字段, 后续可重载
            snapshot: {
              kind: 'htmlPage',
              prompt: d.prompt,
              mode: d.mode,
              html: d.html,
              decision: d.decision,
              tasks: d.tasks,
              hermesTaskId: d.hermesTaskId || null,
              // 把节点本身也存一份 (id/position 让重载能放回画布)
              nodes: [JSON.parse(JSON.stringify(node))],
              edges: [],
              created_at: d.created_at || Date.now(),
            },
            stats: { nodeCount: 1, edgeCount: 0 },
          })
          // 在节点 data 里记一下 libraryId, UI 可显示"已入库"
          if (id) {
            const { updateNode } = get()
            updateNode(nodeId, { libraryId: id })
          }
          return id
        } catch (err) {
          console.error('[_saveProjectFromHtmlNode] 失败:', err)
          return null
        }
      },

      // 内部: 给一个 done 任务在右侧建 ResultNode + 自动连线
      _addResultNodeFor: (sourceNodeId, hermesTask, resultText) => {
        set((state) => {
          const src = state.nodes.find((n) => n.id === sourceNodeId)
          if (!src) return

          const rand = Math.random().toString(36).slice(2, 8)
          const resultNodeId = `result-${Date.now()}-${rand}`
          // 同 promoteOntologyToTask: 用绝对坐标避免 src 在 group 内时新节点跑到画布原点附近
          const srcBox = getNodeAbsoluteBox(src, state.nodes)
          const newResultNode = {
            id: resultNodeId,
            type: 'resultNode',
            position: { x: srcBox.x + srcBox.w + 60, y: srcBox.y },
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

      // ──────────────────────────────────────────────────────────────────
      // 外部源搜索 — 飞书 docs/wiki 全文搜
      //   返回 [{title, summary, url, owner, updateTime, docType, ...}]
      //   不改 store, 纯转发, 由 LeftPanel 自己渲染列表
      // ──────────────────────────────────────────────────────────────────
      searchFeishu: async (query, pageSize = 10) => {
        const q = String(query || '').trim()
        if (!q) throw new Error('searchFeishu: query 为空')
        const resp = await fetch('/canvas/api/source/feishu/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ query: q, pageSize }),
        })
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '')
          throw new Error(`source-proxy ${resp.status}: ${txt.slice(0, 200)}`)
        }
        const json = await resp.json()
        if (!json.ok) throw new Error(json.error || 'source-proxy 返回失败')
        return { results: json.results || [], total: json.total || 0 }
      },

      // ──────────────────────────────────────────────────────────────────
      // 外部源导入 — 飞书 doc URL → BookmarkNode (含 title + 摘要 + sourceMeta)
      //   走 server/source-proxy.js (vite dev: /canvas/api/source 反代 17090)
      //   后续 #9 加得到 / Notion 时复制此模式
      // ──────────────────────────────────────────────────────────────────
      importFromFeishuUrl: async (docUrl, position = null) => {
        const url = String(docUrl || '').trim()
        if (!url) throw new Error('importFromFeishuUrl: docUrl 为空')
        if (!/feishu\.cn|larksuite\.com/i.test(url)) {
          throw new Error('importFromFeishuUrl: 不是飞书/Lark URL')
        }

        const resp = await fetch('/canvas/api/source/feishu/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ docUrl: url }),
        })
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '')
          throw new Error(`source-proxy ${resp.status}: ${txt.slice(0, 200)}`)
        }
        const json = await resp.json()
        if (!json.ok) throw new Error(json.error || 'source-proxy 返回失败')

        const data = json.data || {}
        const title = data.title || url
        // 取 markdown 内容前 240 字作摘要
        const content = String(data.content || '').replace(/\s+/g, ' ').trim()
        const summary = content.slice(0, 240) + (content.length > 240 ? '...' : '')

        const { addBookmarkNode } = get()
        // autoFetch=false — 已经从 source-proxy 拿到 title + summary, 不再走 microlink
        const nodeId = addBookmarkNode(url, title, summary, '', '', position, false)

        // 标记 sourceMeta 让节点知道是从飞书来 + 后续推回时能找到原 URL
        // source-watch 字段 (remoteUpdatedAt 等) 见 docs/source-watch-sync-spec.md §2.1
        set((state) => {
          const n = state.nodes.find((x) => x.id === nodeId)
          if (n) {
            n.data = n.data || {}
            n.data.sourceMeta = {
              platform: 'feishu',
              originalUrl: url,
              importedAt: Date.now(),
              fullContent: content, // 全文留着, 后续节点详情面板可展开
              // source-watch fields
              remoteUpdatedAt: data.update_time_iso || data.update_time || '', // 飞书 fetch 偶尔带, 没有就空
              remoteContentHash: _quickHash(content),
              lastCheckedAt: Date.now(),
              lastSyncedAt: Date.now(),
              syncStatus: 'idle',
            }
          }
        })

        return { nodeId, title, contentLength: content.length }
      },

      // ──────────────────────────────────────────────────────────────────
      // Notion — 搜索 + URL 导入 (复用飞书同款模式, 走 /canvas/api/source/notion/*)
      // ──────────────────────────────────────────────────────────────────
      searchNotion: async (query, pageSize = 10) => {
        const q = String(query || '').trim()
        if (!q) throw new Error('searchNotion: query 为空')
        const resp = await fetch('/canvas/api/source/notion/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ query: q, pageSize }),
        })
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '')
          throw new Error(`source-proxy ${resp.status}: ${txt.slice(0, 200)}`)
        }
        const json = await resp.json()
        if (!json.ok) throw new Error(json.error || 'source-proxy 返回失败')
        return { results: json.results || [], total: json.total || 0 }
      },

      // 节点 → Notion 页面 (创建到指定数据库, 默认 AI 学习库)
      // opts: { databaseId? = AI学习库, includeChildren? = true 含子节点拼接 }
      pushNodeToNotion: async (nodeId, opts = {}) => {
        const databaseId = opts.databaseId || '9f6bbdc391484e7f85bf92cde6a74fe6' // AI学习库
        const includeChildren = opts.includeChildren !== false
        const { nodes } = get()
        const node = nodes.find((n) => n.id === nodeId)
        if (!node) throw new Error(`pushNodeToNotion: 节点 ${nodeId} 不存在`)

        // 拼标题: data.label / data.title / data.text 优先
        const title = String(
          node.data?.label ||
          node.data?.title ||
          node.data?.text ||
          node.data?.name ||
          `节点 ${nodeId}`
        ).slice(0, 200)

        // 拼内容: 节点自身正文 + (可选) 子节点内容拼接
        const lines = []
        const nodeContent = node.data?.fullContent || node.data?.content || node.data?.summary || node.data?.description || ''
        if (nodeContent) {
          lines.push(String(nodeContent))
          lines.push('')
        }
        if (includeChildren) {
          const childIds = nodes.filter((n) => n.parentNode === nodeId).map((n) => n.id)
          if (childIds.length > 0) {
            lines.push('## 子节点')
            for (const cid of childIds) {
              const c = nodes.find((n) => n.id === cid)
              if (!c) continue
              const cTitle = c.data?.label || c.data?.title || c.data?.text || cid
              const cBody = c.data?.fullContent || c.data?.content || c.data?.summary || ''
              lines.push(`### ${cTitle}`)
              if (cBody) lines.push(String(cBody))
              lines.push('')
            }
          }
        }
        const sourceUrl = node.data?.sourceMeta?.originalUrl || node.data?.url || ''
        const content = lines.join('\n').trim()

        const resp = await fetch('/canvas/api/source/notion/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ databaseId, title, content, sourceUrl }),
        })
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '')
          throw new Error(`source-proxy ${resp.status}: ${txt.slice(0, 200)}`)
        }
        const json = await resp.json()
        if (!json.ok) throw new Error(json.error || 'source-proxy 返回失败')

        // 在节点上打 publishedTo 标记 (跟 castNodesToChannel 同款语义)
        set((state) => {
          const n = state.nodes.find((x) => x.id === nodeId)
          if (n) {
            n.data = n.data || {}
            n.data.publishedTo = n.data.publishedTo || []
            n.data.publishedTo.push({
              platform: 'notion',
              pageId: json.pageId,
              pageUrl: json.pageUrl,
              pushedAt: Date.now(),
            })
          }
        })
        return { pageId: json.pageId, pageUrl: json.pageUrl }
      },

      importFromNotionUrl: async (pageUrl, position = null) => {
        const url = String(pageUrl || '').trim()
        if (!url) throw new Error('importFromNotionUrl: pageUrl 为空')
        const resp = await fetch('/canvas/api/source/notion/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ pageUrl: url }),
        })
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '')
          throw new Error(`source-proxy ${resp.status}: ${txt.slice(0, 200)}`)
        }
        const json = await resp.json()
        if (!json.ok) throw new Error(json.error || 'source-proxy 返回失败')
        const data = json.data || {}
        const title = data.title || url
        const content = String(data.content || '').replace(/\s+/g, ' ').trim()
        const summary = content.slice(0, 240) + (content.length > 240 ? '...' : '')

        const { addBookmarkNode } = get()
        const nodeId = addBookmarkNode(data.url || url, title, summary, '', '', position, false)

        set((state) => {
          const n = state.nodes.find((x) => x.id === nodeId)
          if (n) {
            n.data = n.data || {}
            n.data.sourceMeta = {
              platform: 'notion',
              originalUrl: data.url || url,
              pageId: data.pageId || '',
              importedAt: Date.now(),
              fullContent: content,
              // source-watch fields
              remoteUpdatedAt: data.lastEditedTime || '',
              remoteContentHash: _quickHash(content),
              lastCheckedAt: Date.now(),
              lastSyncedAt: Date.now(),
              syncStatus: 'idle',
            }
          }
        })
        return { nodeId, title, contentLength: content.length }
      },

      // ──────────────────────────────────────────────────────────────────
      // 外部源 watch 同步 — 详细设计见 docs/source-watch-sync-spec.md
      //   - checkSourceUpdates: 全量扫一遍 sourceMeta 节点, 调 fetch-meta 比对时间戳, 标 syncStatus
      //   - syncNodeFromSource: 单节点拉全文覆盖
      //   状态字段:
      //     sourceMeta.syncStatus: 'idle' | 'checking' | 'updated-available' | 'synced' | 'conflict' | 'error'
      //     sourceMeta.remoteUpdatedAt: ISO 时间字符串 (远端最近修改)
      //     sourceMeta.lastCheckedAt: ts (本地上次 poll)
      //     sourceMeta.lastSyncedAt: ts (用户上次同步覆盖)
      // ──────────────────────────────────────────────────────────────────

      // sourceWatch 全局状态 (持久化 enabled, 其他运行时)
      sourceWatch: {
        enabled: true,
        mode: 'manual',  // 'manual' (MVP) | 'auto' (Phase 2)
        intervalMs: 60 * 1000,
        lastRunAt: 0,
        inFlight: false,
        lastReport: null,  // { total, checked, updated, errors, durationMs }
      },

      // 主入口: 检查所有外部源节点是否有更新
      checkSourceUpdates: async () => {
        const state = get()
        if (state.sourceWatch?.inFlight) {
          return { skipped: true, reason: 'already-running' }
        }
        const targets = state.nodes.filter((n) => {
          const m = n.data?.sourceMeta
          return m && (m.platform === 'feishu' || m.platform === 'notion')
        })
        const startTs = Date.now()
        const report = { total: targets.length, checked: 0, updated: 0, errors: 0, durationMs: 0 }

        // 标记 inFlight
        set((s) => {
          s.sourceWatch = s.sourceWatch || {}
          s.sourceWatch.inFlight = true
        })

        // 标节点为 checking (UI 立即反馈)
        set((s) => {
          for (const n of s.nodes) {
            const m = n.data?.sourceMeta
            if (m && (m.platform === 'feishu' || m.platform === 'notion')) {
              m.syncStatus = 'checking'
            }
          }
        })

        try {
          // 分批并发, 3 节点一批, 批间 200ms
          const BATCH = 3
          const PAUSE_MS = 200
          for (let i = 0; i < targets.length; i += BATCH) {
            const chunk = targets.slice(i, i + BATCH)
            await Promise.all(chunk.map(async (node) => {
              try {
                const meta = await _fetchMetaForNode(node)
                const oldRemote = node.data?.sourceMeta?.remoteUpdatedAt || ''
                const oldImported = node.data?.sourceMeta?.importedAt || 0
                const oldSynced = node.data?.sourceMeta?.lastSyncedAt || oldImported
                const newRemote = meta.remoteUpdatedAt || ''
                const isNewer = _isRemoteNewer(newRemote, oldRemote, oldSynced)
                set((s) => {
                  const tn = s.nodes.find((x) => x.id === node.id)
                  if (!tn) return
                  tn.data = tn.data || {}
                  tn.data.sourceMeta = tn.data.sourceMeta || {}
                  tn.data.sourceMeta.lastCheckedAt = Date.now()
                  tn.data.sourceMeta.remoteUpdatedAt = newRemote || tn.data.sourceMeta.remoteUpdatedAt
                  tn.data.sourceMeta.syncStatus = isNewer ? 'updated-available' : 'idle'
                  tn.data.sourceMeta.syncError = null
                })
                if (isNewer) report.updated++
                report.checked++
              } catch (err) {
                set((s) => {
                  const tn = s.nodes.find((x) => x.id === node.id)
                  if (!tn) return
                  tn.data = tn.data || {}
                  tn.data.sourceMeta = tn.data.sourceMeta || {}
                  tn.data.sourceMeta.syncStatus = 'error'
                  tn.data.sourceMeta.syncError = String(err?.message || err).slice(0, 200)
                  tn.data.sourceMeta.lastCheckedAt = Date.now()
                })
                report.errors++
              }
            }))
            if (i + BATCH < targets.length) {
              await new Promise((r) => setTimeout(r, PAUSE_MS))
            }
          }
          report.durationMs = Date.now() - startTs
          set((s) => {
            s.sourceWatch = s.sourceWatch || {}
            s.sourceWatch.lastRunAt = Date.now()
            s.sourceWatch.lastReport = report
          })
          return report
        } finally {
          set((s) => {
            if (s.sourceWatch) s.sourceWatch.inFlight = false
          })
        }
      },

      // 单节点同步: 从远端拉全文覆盖本地 title/description/fullContent
      // opts: { force?: bool 跳过 conflict 检测直接覆盖 }
      syncNodeFromSource: async (nodeId, opts = {}) => {
        const node = get().nodes.find((n) => n.id === nodeId)
        if (!node) throw new Error(`syncNodeFromSource: 节点 ${nodeId} 不存在`)
        const meta = node.data?.sourceMeta
        if (!meta?.platform) throw new Error('节点没有 sourceMeta, 不是外部源导入的')

        // 冲突检测 (字段已埋, MVP 仅记录, 不弹 modal)
        // localEditedAt > lastSyncedAt 且 remoteUpdatedAt > lastSyncedAt → conflict
        const localEdited = meta.localEditedAt || 0
        const lastSynced = meta.lastSyncedAt || meta.importedAt || 0
        const remoteAt = _toTs(meta.remoteUpdatedAt)
        if (!opts.force && localEdited > lastSynced && remoteAt > lastSynced) {
          set((s) => {
            const tn = s.nodes.find((x) => x.id === nodeId)
            if (tn?.data?.sourceMeta) tn.data.sourceMeta.syncStatus = 'conflict'
          })
          return { ok: false, conflict: true, reason: 'local-edits-detected' }
        }

        // 拉全文
        let data
        if (meta.platform === 'feishu') {
          const resp = await fetch('/canvas/api/source/feishu/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ docUrl: meta.originalUrl }),
          })
          if (!resp.ok) throw new Error(`feishu fetch ${resp.status}`)
          const json = await resp.json()
          if (!json.ok) throw new Error(json.error || 'feishu fetch 失败')
          data = json.data
        } else if (meta.platform === 'notion') {
          const resp = await fetch('/canvas/api/source/notion/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ pageUrl: meta.originalUrl, pageId: meta.pageId }),
          })
          if (!resp.ok) throw new Error(`notion fetch ${resp.status}`)
          const json = await resp.json()
          if (!json.ok) throw new Error(json.error || 'notion fetch 失败')
          data = json.data
        } else {
          throw new Error(`不支持的 platform: ${meta.platform}`)
        }

        const newTitle = data.title || meta.originalUrl
        const newContent = String(data.content || '').replace(/\s+/g, ' ').trim()
        const newSummary = newContent.slice(0, 240) + (newContent.length > 240 ? '...' : '')
        const newRemoteAt = data.lastEditedTime || data.update_time_iso || ''

        set((s) => {
          const tn = s.nodes.find((x) => x.id === nodeId)
          if (!tn) return
          tn.data = tn.data || {}
          // 仅覆盖远端字段, 保留 position/marked/category/tags/parentNode 等本地加工
          tn.data.title = newTitle
          tn.data.description = newSummary
          tn.data.sourceMeta = {
            ...tn.data.sourceMeta,
            fullContent: newContent,
            remoteUpdatedAt: newRemoteAt || tn.data.sourceMeta?.remoteUpdatedAt,
            remoteContentHash: _quickHash(newContent),
            lastSyncedAt: Date.now(),
            lastCheckedAt: Date.now(),
            syncStatus: 'synced',
            syncError: null,
          }
        })

        // 'synced' 3s 后回 'idle' (UI 角标淡出)
        setTimeout(() => {
          const cur = get().nodes.find((n) => n.id === nodeId)
          if (cur?.data?.sourceMeta?.syncStatus === 'synced') {
            set((s) => {
              const tn = s.nodes.find((x) => x.id === nodeId)
              if (tn?.data?.sourceMeta) tn.data.sourceMeta.syncStatus = 'idle'
            })
          }
        }, 3000)

        return { ok: true, nodeId, title: newTitle, contentLength: newContent.length }
      },

      // ──────────────────────────────────────────────────────────────────
      // 频道投送 — 私人草稿 → 公共频道发布
      //   - 收集所选节点 + 完整子树 (group 嵌套靠 parentNode 链)
      //   - 重新生成 id 防与目标房间冲突
      //   - 调 yjsClient.castToRoom 临时连目标 room 写入
      //   - 本地原节点保留 (拷贝不是移动), 仅打 publishedTo 标记
      // ──────────────────────────────────────────────────────────────────
      castNodesToChannel: async (nodeIds, targetRoom) => {
        if (!Array.isArray(nodeIds) || !nodeIds.length) {
          throw new Error('castNodesToChannel: nodeIds 为空')
        }
        if (!targetRoom) throw new Error('castNodesToChannel: 目标房间为空')

        const { nodes, edges } = get()
        // 1) 收集子树 (含所有 parentNode → 选中的节点的子孙)
        //    最多 4 级嵌套 (projectGroup → challengeGroup → 卡片), 跑 4 pass 兜底
        const memberSet = new Set(nodeIds)
        for (let pass = 0; pass < 4; pass++) {
          let grew = false
          for (const n of nodes) {
            if (n.parentNode && memberSet.has(n.parentNode) && !memberSet.has(n.id)) {
              memberSet.add(n.id)
              grew = true
            }
          }
          if (!grew) break
        }
        const memberArr = nodes.filter((n) => memberSet.has(n.id))
        if (!memberArr.length) return { castedCount: 0 }

        // 2) id 改写防冲突 — 目标房间可能已存在同 id
        const ts = Date.now()
        const idMap = {}
        for (const n of memberArr) idMap[n.id] = `${n.id}-cast-${ts.toString(36)}`

        const renamedNodes = memberArr.map((n) => {
          const next = {
            ...n,
            id: idMap[n.id],
            // parentNode 跟着改 — 仅当父节点也在投送集合内, 否则当顶层 (清掉 parentNode)
            parentNode: n.parentNode && idMap[n.parentNode] ? idMap[n.parentNode] : undefined,
            extent: (n.parentNode && idMap[n.parentNode]) ? n.extent : undefined,
            selected: false,
            data: { ...(n.data || {}), castFrom: { room: get().__currentRoom || '', origId: n.id, ts } },
          }
          return next
        })

        // 3) 涉及的边 — 两端都在投送集合内才带过去, 否则丢弃 (避免悬空 edge)
        const renamedEdges = edges
          .filter((e) => idMap[e.source] && idMap[e.target])
          .map((e) => ({
            ...e,
            id: `${e.id}-cast-${ts.toString(36)}`,
            source: idMap[e.source],
            target: idMap[e.target],
          }))

        // 4) 调 yjsClient.castToRoom (临时 connect → 写入 → disconnect)
        const { castToRoom } = await import('../collab/yjsClient')
        await castToRoom({ nodes: renamedNodes, edges: renamedEdges }, targetRoom)

        // 5) 本地原节点打 publishedTo 标记 (历史记录 + 防重复投送 UI 提示)
        set((state) => {
          for (const n of state.nodes) {
            if (memberSet.has(n.id)) {
              n.data = n.data || {}
              const arr = Array.isArray(n.data.publishedTo) ? n.data.publishedTo : []
              arr.push({ room: targetRoom, ts, externalId: idMap[n.id] })
              n.data.publishedTo = arr.slice(-10) // 限 10 条防膨胀
            }
          }
        })

        return {
          castedCount: renamedNodes.length,
          edgeCount: renamedEdges.length,
          targetRoom,
        }
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
