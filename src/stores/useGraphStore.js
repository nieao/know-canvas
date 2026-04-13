/**
 * useGraphStore - 图谱统一状态接口
 * 组合 useCanvasStore（画布节点/边）和 useKnowledgeStore（知识源/分类）
 * 为 KnowledgeGraph 主页面提供统一 API
 */

import useCanvasStore from './useCanvasStore'
import useKnowledgeStore from './useKnowledgeStore'

/**
 * 统一图谱 Hook — 从两个底层 store 选取并暴露页面需要的方法
 * 不是独立 store，而是组合层
 */
export default function useGraphStore() {
  // 画布状态
  const nodes = useCanvasStore(s => s.nodes)
  const edges = useCanvasStore(s => s.edges)
  const addConceptNode = useCanvasStore(s => s.addConceptNode)
  const updateNode = useCanvasStore(s => s.updateNode)
  const removeNode = useCanvasStore(s => s.removeNode)
  const removeEdge = useCanvasStore(s => s.removeEdge)
  const clearCanvas = useCanvasStore(s => s.clearCanvas)
  const exportCanvasData = useCanvasStore(s => s.exportCanvasData)
  const importCanvasData = useCanvasStore(s => s.importCanvasData)

  // 知识源状态
  const sources = useKnowledgeStore(s => s.sources)
  const addSourceRaw = useKnowledgeStore(s => s.addSource)
  const removeSource = useKnowledgeStore(s => s.removeSource)

  // 添加边 — 包装为统一格式
  const addEdge = (edgeData) => {
    // 直接调用画布 store 的 addRelation（如果存在）或 onConnect
    const store = useCanvasStore.getState()
    if (store.addRelation) {
      store.addRelation(edgeData.source, edgeData.target, edgeData.type || 'related')
    } else {
      // 降级：手动创建边
      const newEdge = {
        id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        source: edgeData.source,
        target: edgeData.target,
        type: edgeData.type || 'default',
        label: edgeData.label || '',
        data: { relationType: edgeData.type || 'related' },
      }
      useCanvasStore.setState(state => ({
        edges: [...state.edges, newEdge],
      }))
    }
  }

  // 添加知识源 — 直接透传 LeftPanel 的数据格式（保留 id 和 ext）
  const addSource = (source) => {
    addSourceRaw({
      id: source.id,
      name: source.name,
      type: source.type,
      ext: source.ext || '',
      content: source.content || '',
      metadata: {
        url: source.url,
        addedAt: source.addedAt,
      },
    })
  }

  // 导出/导入
  const exportData = () => exportCanvasData()
  const importData = (newNodes, newEdges) => importCanvasData(newNodes, newEdges)

  // 清空全部
  const clearAll = () => {
    clearCanvas()
  }

  return {
    // 画布数据
    nodes,
    edges,
    // 知识源数据
    sources,
    // 知识源操作
    addSource,
    removeSource,
    // 画布操作
    addConceptNode,
    addEdge,
    removeEdge,
    updateNode,
    removeNode,
    // 导入导出
    exportData,
    importData,
    clearAll,
  }
}
