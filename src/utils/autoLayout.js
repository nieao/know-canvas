/**
 * autoLayout - 画布自动布局工具
 *
 * 提供三种布局策略:
 *   1. autoLayout         — 用 dagre 跑分层布局 (有边的图谱效果最好)
 *   2. categorizedLayout  — 按节点类型分桶, 不依赖边 (孤立节点也能整齐排列)
 *   3. smartLayout        — 综合入口: 有边走 dagre, 否则走分类
 *
 * 方向 (direction):
 *   - 'TB' (Top to Bottom)   竖排
 *   - 'LR' (Left to Right)   横排
 *
 * 节点宽高:
 *   - 优先取 node.width / node.height (react-flow 测量后会写回)
 *   - 否则按 node.type 给一组合理默认值
 */

import dagre from 'dagre'

// 不同节点类型的默认尺寸 (react-flow 还没测量时兜底)
// 这些值与各 NodeXXX.jsx 实际渲染宽度大致对齐
const DEFAULT_SIZES = {
  conceptNode:   { width: 240, height: 140 },
  categoryNode:  { width: 220, height: 100 },
  bookmarkNode:  { width: 280, height: 160 },
  imageNode:     { width: 240, height: 200 },
  videoNode:     { width: 280, height: 200 },
  fileNode:      { width: 240, height: 120 },
  noteNode:      { width: 240, height: 160 },
  groupNode:     { width: 360, height: 240 },
  taskNode:      { width: 280, height: 180 },
  resultNode:    { width: 280, height: 180 },
  ontologyNode:  { width: 260, height: 160 },
  challengeNode: { width: 260, height: 140 },
  synthesisNode: { width: 280, height: 180 },
}

const FALLBACK_SIZE = { width: 240, height: 120 }

// 类型在分类布局中的纵向 (TB) 或横向 (LR) 顺序
// 越靠前越接近原点,语义上从"目标层"到"产出层"
const TYPE_ORDER = [
  'ontologyNode',     // 本体目标
  'conceptNode',      // 概念
  'categoryNode',     // 分类
  'noteNode',         // 笔记
  'bookmarkNode',     // 链接
  'imageNode',        // 图片
  'videoNode',        // 视频
  'fileNode',         // 文件
  'taskNode',         // 任务派单
  'challengeNode',    // 反驳
  'resultNode',       // 结果回流
  'synthesisNode',    // 综合
  'groupNode',        // 分组容器(单独一行)
]

// 取节点尺寸: 先 react-flow 测量值, 再类型默认, 最后兜底
function getNodeSize(node) {
  const w = node.width  || DEFAULT_SIZES[node.type]?.width  || FALLBACK_SIZE.width
  const h = node.height || DEFAULT_SIZES[node.type]?.height || FALLBACK_SIZE.height
  return { width: w, height: h }
}

/**
 * 用 dagre 做分层自动布局
 * @param {Array} nodes  react-flow 节点数组
 * @param {Array} edges  react-flow 连线数组
 * @param {Object} opts
 *   direction:    'TB' | 'LR'  布局方向 (默认 TB)
 *   nodeSpacing:  同层内节点间距 (px, 默认 80)
 *   rankSpacing:  跨层间距 (px, 默认 160)
 * @returns {Array} 新节点数组 (position 已重算)
 */
export function autoLayout(nodes, edges, {
  direction = 'TB',
  nodeSpacing = 80,
  rankSpacing = 160,
} = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return nodes

  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSpacing,
    ranksep: rankSpacing,
    marginx: 40,
    marginy: 40,
  })
  g.setDefaultEdgeLabel(() => ({}))

  // 注册节点
  nodes.forEach((n) => {
    const { width, height } = getNodeSize(n)
    g.setNode(n.id, { width, height })
  })

  // 注册边 (只注册两端节点都存在的)
  const idSet = new Set(nodes.map((n) => n.id))
  ;(edges || []).forEach((e) => {
    if (idSet.has(e.source) && idSet.has(e.target)) {
      g.setEdge(e.source, e.target)
    }
  })

  dagre.layout(g)

  // 横排时连线从节点右侧出 / 左侧入; 竖排时从底部出 / 顶部入
  const sourcePosition = direction === 'LR' ? 'right' : 'bottom'
  const targetPosition = direction === 'LR' ? 'left' : 'top'

  // dagre 返回的是节点中心点, react-flow 需要左上角
  return nodes.map((n) => {
    const dn = g.node(n.id)
    if (!dn) return n
    const { width, height } = getNodeSize(n)
    return {
      ...n,
      position: {
        x: Math.round(dn.x - width / 2),
        y: Math.round(dn.y - height / 2),
      },
      sourcePosition,
      targetPosition,
    }
  })
}

/**
 * 按节点类型分类成行(竖排)或列(横排), 不依赖 edges
 * 适合纯节点池场景: 没建任何关系也能整齐排列
 * @param {Array} nodes
 * @param {Object} opts
 *   direction:   'TB' | 'LR'
 *   gap:         同行/同列内节点间距
 *   bandSpacing: 行/列之间的空隙
 *   originX/Y:   起始原点
 */
export function categorizedLayout(nodes, {
  direction = 'TB',
  gap = 60,
  bandSpacing = 80,
  originX = 100,
  originY = 100,
} = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return nodes

  // 按类型分桶
  const buckets = new Map()
  nodes.forEach((n) => {
    const key = n.type || 'unknown'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(n)
  })

  // 类型按 TYPE_ORDER 排序, 没列出的扔到末尾
  const sortedTypes = Array.from(buckets.keys()).sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a)
    const ib = TYPE_ORDER.indexOf(b)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })

  const idToPos = new Map()

  if (direction === 'TB') {
    // 竖排: 每个类型一行, 行内从左往右排开
    let cursorY = originY
    sortedTypes.forEach((type) => {
      const list = buckets.get(type)
      let cursorX = originX
      let rowMaxH = 0
      list.forEach((n) => {
        const { width, height } = getNodeSize(n)
        idToPos.set(n.id, { x: cursorX, y: cursorY })
        cursorX += width + gap
        if (height > rowMaxH) rowMaxH = height
      })
      cursorY += rowMaxH + bandSpacing
    })
  } else {
    // 横排: 每个类型一列, 列内从上往下排开
    let cursorX = originX
    sortedTypes.forEach((type) => {
      const list = buckets.get(type)
      let cursorY = originY
      let colMaxW = 0
      list.forEach((n) => {
        const { width, height } = getNodeSize(n)
        idToPos.set(n.id, { x: cursorX, y: cursorY })
        cursorY += height + gap
        if (width > colMaxW) colMaxW = width
      })
      cursorX += colMaxW + bandSpacing
    })
  }

  // 横排连线右出 / 左入; 竖排底出 / 顶入 — 与 dagre 路径保持一致
  const sourcePosition = direction === 'LR' ? 'right' : 'bottom'
  const targetPosition = direction === 'LR' ? 'left' : 'top'

  return nodes.map((n) => {
    const p = idToPos.get(n.id)
    return p ? { ...n, position: p, sourcePosition, targetPosition } : n
  })
}

/**
 * 综合入口: 有边就用 dagre, 没边就分类
 * 这是 SaveExportToolbar "自动排序" 按钮调的函数
 */
export function smartLayout(nodes, edges, { direction = 'TB' } = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return nodes
  // edges 数量足够多走 dagre, 否则走分类 (避免单边产生奇怪布局)
  const validEdgeCount = (edges || []).filter(
    (e) => e && e.source && e.target,
  ).length
  if (validEdgeCount >= 1) {
    return autoLayout(nodes, edges, { direction })
  }
  return categorizedLayout(nodes, { direction })
}

export default smartLayout
