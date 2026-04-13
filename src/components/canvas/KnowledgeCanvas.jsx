/**
 * KnowledgeCanvas - 知识图谱画布主容器
 * 基于 React Flow 的交互式画布，支持知识概念节点管理
 * 功能：缩放、键盘快捷键、对齐网格、拖拽文件、知识关系连线
 * 建筑极简风格
 */

import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  Panel,
  useViewport,
  MarkerType,
  EdgeLabelRenderer,
} from 'reactflow'
import 'reactflow/dist/style.css'

import ConceptNode from './ConceptNode'
import CategoryNode from './CategoryNode'
import BookmarkNode from './BookmarkNode'
import ImageNode from './ImageNode'
import VideoNode from './VideoNode'
import FileNode from './FileNode'
import NoteNode from './NoteNode'
import GroupNode from './GroupNode'
import SelectionToolbar from './SelectionToolbar'
import NodePropertyPanel from './NodePropertyPanel'

// 注册自定义节点类型
const nodeTypes = {
  conceptNode: ConceptNode,
  categoryNode: CategoryNode,
  bookmarkNode: BookmarkNode,
  imageNode: ImageNode,
  videoNode: VideoNode,
  fileNode: FileNode,
  noteNode: NoteNode,
  groupNode: GroupNode,
}

// 知识关系类型
const RELATION_TYPES = {
  causal: { id: 'causal', label: '因果', color: '#c8a882' },
  compose: { id: 'compose', label: '组成', color: '#7c9eb2' },
  depend: { id: 'depend', label: '依赖', color: '#8b9e7c' },
  similar: { id: 'similar', label: '相似', color: '#9e7cb2' },
  contrast: { id: 'contrast', label: '对比', color: '#b27c8b' },
  derive: { id: 'derive', label: '派生', color: '#7cb2a8' },
  reference: { id: 'reference', label: '引用', color: '#b2917c' },
  sequence: { id: 'sequence', label: '顺序', color: '#a8a87c' },
}

// 文件类型检测
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi']
const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'json', 'zip', 'rar']

const getFileExtension = (filename) => filename?.split('.').pop()?.toLowerCase() || ''
const isImageFile = (filename) => IMAGE_EXTENSIONS.includes(getFileExtension(filename))
const isVideoFile = (filename) => VIDEO_EXTENSIONS.includes(getFileExtension(filename))

// 默认连线配置
const defaultEdgeOptions = {
  type: 'curved',
  animated: false,
  style: { strokeWidth: 2 },
}

// 网格配置
const snapGrid = [15, 15]
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2.0
const ZOOM_STEP = 0.1
const deleteKeyCode = ['Backspace', 'Delete']

// 剪贴板
let clipboardData = { nodes: [], edges: [] }

// 自定义曲线连线（知识关系）
const CurvedEdge = ({
  id, sourceX, sourceY, targetX, targetY,
  style, data, selected, label, labelStyle, labelBgStyle, markerEnd,
}) => {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const distance = Math.sqrt(dx * dx + dy * dy)
  const curvature = Math.min(0.5, Math.max(0.15, distance / 800))
  const midX = (sourceX + targetX) / 2
  const midY = (sourceY + targetY) / 2
  const perpOffset = distance * curvature * 0.3
  const angle = Math.atan2(dy, dx)
  const curveDirection = ((sourceX < targetX && sourceY < targetY) ||
                          (sourceX > targetX && sourceY > targetY)) ? 1 : -1
  const controlX = midX + Math.sin(angle) * perpOffset * curveDirection
  const controlY = midY - Math.cos(angle) * perpOffset * curveDirection
  const pathD = `M ${sourceX} ${sourceY} Q ${controlX} ${controlY} ${targetX} ${targetY}`
  const labelX = (sourceX + 2 * controlX + targetX) / 4
  const labelY = (sourceY + 2 * controlY + targetY) / 4

  return (
    <>
      {selected && (
        <path d={pathD} fill="none" stroke={style?.stroke || '#c8a882'} strokeWidth={8} strokeOpacity={0.2} className="pointer-events-none" />
      )}
      <path
        id={id} d={pathD} fill="none"
        stroke={style?.stroke || '#c8a882'}
        strokeWidth={selected ? 3 : (style?.strokeWidth || 2)}
        strokeDasharray={style?.strokeDasharray || '0'}
        strokeLinecap="round"
        className="cursor-pointer transition-colors duration-150"
        markerEnd={markerEnd}
      />
      {data?.isRunning && (
        <>
          <circle r="4" fill={style?.stroke || '#c8a882'}>
            <animateMotion dur="1.5s" repeatCount="indefinite" path={pathD} />
          </circle>
          <circle r="3" fill="#fafafa">
            <animateMotion dur="1.5s" repeatCount="indefinite" path={pathD} />
          </circle>
        </>
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div
              className="px-2 py-0.5 rounded text-xs font-medium shadow-sm"
              style={{
                backgroundColor: labelBgStyle?.fill || '#fafafa',
                color: labelStyle?.fill || style?.stroke || '#c8a882',
                opacity: labelBgStyle?.fillOpacity || 0.95,
                fontSize: labelStyle?.fontSize || 11,
                fontWeight: labelStyle?.fontWeight || 500,
                fontFamily: '"Noto Sans SC", system-ui, sans-serif',
                border: '1px solid #e8e8e8',
              }}
            >
              {label}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

// 注册自定义连线类型
const edgeTypes = {
  curved: CurvedEdge,
}

// 缩放指示器
function ZoomIndicator({ zoom, onZoomIn, onZoomOut, onFitView, onResetZoom }) {
  const percentage = Math.round(zoom * 100)
  return (
    <div
      className="flex items-center gap-1 backdrop-blur-sm rounded-lg shadow-md px-2 py-1"
      style={{ backgroundColor: 'rgba(250,250,250,0.95)', border: '1px solid #e8e8e8' }}
    >
      <button onClick={onZoomOut} disabled={zoom <= MIN_ZOOM}
        className="p-1 hover:bg-gray-100 rounded transition-colors disabled:opacity-40" title="缩小">
        <svg className="w-4 h-4" style={{ color: '#555' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
        </svg>
      </button>
      <button onClick={onResetZoom} className="px-2 py-0.5 min-w-[50px] text-sm font-medium hover:bg-gray-100 rounded transition-colors"
        style={{ color: '#555' }} title="重置为 100%">
        {percentage}%
      </button>
      <button onClick={onZoomIn} disabled={zoom >= MAX_ZOOM}
        className="p-1 hover:bg-gray-100 rounded transition-colors disabled:opacity-40" title="放大">
        <svg className="w-4 h-4" style={{ color: '#555' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
      <div className="w-px h-5 mx-1" style={{ backgroundColor: '#e8e8e8' }} />
      <button onClick={onFitView} className="p-1 hover:bg-gray-100 rounded transition-colors" title="适应视图">
        <svg className="w-4 h-4" style={{ color: '#555' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
      </button>
    </div>
  )
}

// 快速添加菜单
function QuickAddMenu({ x, y, onSelect, onClose }) {
  const options = [
    { type: 'concept', label: '概念', icon: '💡' },
    { type: 'note', label: '笔记', icon: '📝' },
    { type: 'link', label: '链接', icon: '🔗' },
  ]

  return (
    <div
      className="fixed rounded-lg shadow-2xl py-2 z-50"
      style={{
        left: x, top: y, transform: 'translate(-50%, -50%)',
        backgroundColor: '#fafafa', border: '1px solid #e8e8e8',
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-xs font-medium mb-1" style={{ color: '#bbb', borderBottom: '1px solid #e8e8e8', letterSpacing: '0.15em' }}>
        快速添加
      </div>
      {options.map((option) => (
        <button
          key={option.type}
          onClick={() => onSelect(option.type)}
          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 transition-colors"
          style={{ color: '#2d2d2d' }}
        >
          <span>{option.icon}</span>
          <span>{option.label}</span>
        </button>
      ))}
      <div style={{ borderTop: '1px solid #e8e8e8' }} className="mt-1 pt-1">
        <button onClick={onClose} className="w-full px-4 py-1.5 text-left text-xs hover:bg-gray-50" style={{ color: '#bbb' }}>
          取消 (Esc)
        </button>
      </div>
    </div>
  )
}

// 画布内部组件
function KnowledgeCanvasInner({
  nodes = [],
  edges = [],
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onEdgeClick,
  onDrop,
  onInit,
  showMiniMap = true,
  children,
}) {
  const reactFlowInstance = useReactFlow()
  const reactFlowWrapper = useRef(null)
  const [isPanMode, setIsPanMode] = useState(false)
  const [quickAddMenu, setQuickAddMenu] = useState({ visible: false, x: 0, y: 0 })
  const { zoom } = useViewport()

  const [propertyPanel, setPropertyPanel] = useState({ visible: false, x: 0, y: 0, node: null })
  const [selectionBounds, setSelectionBounds] = useState({ x: 0, y: 0 })

  const selectedNodes = useMemo(() => nodes.filter(n => n.selected), [nodes])
  const selectedCount = selectedNodes.length

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    const z = reactFlowInstance.getZoom()
    reactFlowInstance.zoomTo(Math.min(z + ZOOM_STEP, MAX_ZOOM), { duration: 200 })
  }, [reactFlowInstance])

  const handleZoomOut = useCallback(() => {
    const z = reactFlowInstance.getZoom()
    reactFlowInstance.zoomTo(Math.max(z - ZOOM_STEP, MIN_ZOOM), { duration: 200 })
  }, [reactFlowInstance])

  const handleFitView = useCallback(() => {
    reactFlowInstance.fitView({ padding: 0.2, duration: 300 })
  }, [reactFlowInstance])

  const handleResetZoom = useCallback(() => {
    reactFlowInstance.zoomTo(1, { duration: 200 })
  }, [reactFlowInstance])

  // 复制 / 粘贴
  const handleCopy = useCallback(() => {
    const sel = nodes.filter(n => n.selected)
    if (sel.length === 0) return
    const ids = new Set(sel.map(n => n.id))
    clipboardData = {
      nodes: sel.map(n => ({ ...n })),
      edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({ ...e })),
    }
  }, [nodes, edges])

  const handlePaste = useCallback(() => {
    if (clipboardData.nodes.length === 0) return
    const ts = Date.now()
    const idMap = {}
    const newNodes = clipboardData.nodes.map((node, idx) => {
      const newId = `${node.id}-copy-${ts}-${idx}`
      idMap[node.id] = newId
      return {
        ...node, id: newId,
        position: { x: node.position.x + 50, y: node.position.y + 50 },
        selected: true, data: { ...node.data },
      }
    })
    const newEdges = clipboardData.edges.map((edge, idx) => ({
      ...edge,
      id: `${edge.id}-copy-${ts}-${idx}`,
      source: idMap[edge.source],
      target: idMap[edge.target],
    }))
    // 通过事件通知外部
    window.dispatchEvent(new CustomEvent('canvas-paste', {
      detail: { nodes: newNodes, edges: newEdges }
    }))
  }, [])

  const handleSelectAll = useCallback(() => {
    window.dispatchEvent(new CustomEvent('canvas-select-all'))
  }, [])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (isInput) return

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        setIsPanMode(true)
      }

      if (e.key === 'Escape') {
        setQuickAddMenu(prev => ({ ...prev, visible: false }))
        setPropertyPanel(prev => ({ ...prev, visible: false }))
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'a': e.preventDefault(); handleSelectAll(); break
          case 'c': e.preventDefault(); handleCopy(); break
          case 'v':
            if (clipboardData.nodes.length > 0) { e.preventDefault(); handlePaste() }
            break
          case '0': e.preventDefault(); handleFitView(); break
          case '1': e.preventDefault(); handleResetZoom(); break
          case '=': case '+': e.preventDefault(); handleZoomIn(); break
          case '-': e.preventDefault(); handleZoomOut(); break
        }
      }
    }

    const handleKeyUp = (e) => {
      if (e.code === 'Space') setIsPanMode(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [handleCopy, handlePaste, handleSelectAll, handleFitView, handleResetZoom, handleZoomIn, handleZoomOut])

  // 多选右键菜单状态
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 })

  // 右键：多选时弹出链接菜单，单选时弹出属性面板
  const handleNodeContextMenu = useCallback((e, node) => {
    e.preventDefault()
    const sel = nodes.filter(n => n.selected)
    if (sel.length >= 2) {
      // 多选 → 右键自动链接菜单
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
      })
    } else {
      // 单选 → 属性面板
      setPropertyPanel({
        visible: true,
        x: Math.min(e.clientX, window.innerWidth - 340),
        y: Math.min(e.clientY, window.innerHeight - 520),
        node,
      })
    }
  }, [nodes])

  // 画布空白区域右键（也支持多选状态）
  const handlePaneContextMenu = useCallback((e) => {
    e.preventDefault()
    const sel = nodes.filter(n => n.selected)
    if (sel.length >= 2) {
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
      })
    }
  }, [nodes])

  // 拖拽文件到画布
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleFileDrop = useCallback((e) => {
    e.preventDefault()
    if (!reactFlowInstance) return

    const position = reactFlowInstance.screenToFlowPosition({
      x: e.clientX,
      y: e.clientY,
    })

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      window.dispatchEvent(new CustomEvent('canvas-file-drop', {
        detail: { files, position }
      }))
      return
    }

    // URL 拖拽
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (url && url.startsWith('http')) {
      window.dispatchEvent(new CustomEvent('canvas-url-drop', {
        detail: { url, position }
      }))
    }

    if (onDrop) onDrop(e)
  }, [reactFlowInstance, onDrop])

  // 选中节点边界计算
  useEffect(() => {
    if (selectedCount >= 2) {
      const bounds = selectedNodes.reduce(
        (acc, node) => ({
          minX: Math.min(acc.minX, node.position.x),
          maxX: Math.max(acc.maxX, node.position.x + 200),
          minY: Math.min(acc.minY, node.position.y),
        }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity }
      )
      setSelectionBounds({
        x: (bounds.minX + bounds.maxX) / 2,
        y: bounds.minY - 60,
      })
    }
  }, [selectedNodes, selectedCount])

  // 为连线添加关系标签
  const processedEdges = useMemo(() => {
    return edges.map(edge => {
      const relation = RELATION_TYPES[edge.data?.relationType]
      if (relation) {
        return {
          ...edge,
          label: relation.label,
          style: { ...edge.style, stroke: relation.color, strokeWidth: 2 },
          labelStyle: { fill: relation.color, fontWeight: 500 },
          labelBgStyle: { fill: '#fafafa', fillOpacity: 0.95 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: relation.color,
            width: 20,
            height: 20,
          },
        }
      }
      return {
        ...edge,
        style: { ...edge.style, stroke: '#c8a882', strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#c8a882',
          width: 20,
          height: 20,
        },
      }
    })
  }, [edges])

  return (
    <div
      ref={reactFlowWrapper}
      className="w-full h-full"
      style={{ backgroundColor: '#fafafa', cursor: isPanMode ? 'grab' : 'default' }}
      onDragOver={handleDragOver}
      onDrop={handleFileDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={processedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        onInit={onInit}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        snapToGrid={true}
        snapGrid={snapGrid}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        deleteKeyCode={deleteKeyCode}
        panOnDrag={isPanMode ? [0] : [1]}
        selectionOnDrag={!isPanMode}
        multiSelectionKeyCode="Shift"
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        {/* 背景网格 */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={15}
          size={1}
          color="#e8e8e8"
        />

        {/* 控制按钮 */}
        <Controls
          showInteractive={false}
          style={{ display: 'none' }}
        />

        {/* 小地图 */}
        {showMiniMap && (
          <MiniMap
            nodeStrokeColor={() => '#c8a882'}
            nodeColor={() => '#f5f0eb'}
            nodeBorderRadius={8}
            maskColor="rgba(250, 250, 250, 0.8)"
            style={{
              backgroundColor: '#fafafa',
              border: '1px solid #e8e8e8',
              borderRadius: '8px',
            }}
          />
        )}

        {/* 缩放指示器 */}
        <Panel position="bottom-left">
          <ZoomIndicator
            zoom={zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onFitView={handleFitView}
            onResetZoom={handleResetZoom}
          />
        </Panel>

        {/* 画布信息 */}
        <Panel position="top-left">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg shadow-sm"
            style={{
              backgroundColor: 'rgba(250,250,250,0.9)',
              border: '1px solid #e8e8e8',
              fontFamily: '"Noto Sans SC", system-ui, sans-serif',
            }}
          >
            <span className="text-xs" style={{ color: '#bbb', letterSpacing: '0.15em' }}>
              {nodes.length} 节点 / {edges.length} 连线
            </span>
          </div>
        </Panel>
      </ReactFlow>

      {/* 多选工具栏 */}
      {selectedCount >= 2 && (
        <SelectionToolbar
          selectedCount={selectedCount}
          position={selectionBounds}
        />
      )}

      {/* 多选右键自动链接菜单 */}
      {contextMenu.visible && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu({ visible: false, x: 0, y: 0 })} />
          <div
            className="fixed z-50 rounded-lg shadow-2xl py-2 min-w-[180px]"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              backgroundColor: '#fafafa',
              border: '1px solid #e8e8e8',
              fontFamily: '"Noto Sans SC", system-ui, sans-serif',
            }}
          >
            <div className="px-3 py-1.5 text-xs font-medium flex items-center gap-2" style={{ color: '#bbb', borderBottom: '1px solid #e8e8e8', letterSpacing: '0.1em' }}>
              <span>{selectedCount} 个节点</span>
              <span>·</span>
              <span>自动链接</span>
            </div>
            {/* 自动全连接 */}
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('selection-action', { detail: { action: 'autoLinkAll' } }))
                setContextMenu({ visible: false, x: 0, y: 0 })
              }}
              className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors"
              style={{ color: '#2d2d2d' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f0eb'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <svg className="w-4 h-4" style={{ color: '#c8a882' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span>全部互连（相关）</span>
            </button>
            {/* 链式连接 */}
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('selection-action', { detail: { action: 'autoLinkChain' } }))
                setContextMenu({ visible: false, x: 0, y: 0 })
              }}
              className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors"
              style={{ color: '#2d2d2d' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f0eb'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <svg className="w-4 h-4" style={{ color: '#06b6d4' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
              <span>链式连接（顺序）</span>
            </button>
            {/* 分隔线 */}
            <div className="my-1" style={{ borderTop: '1px solid #e8e8e8' }} />
            {/* 按类型连接 */}
            {Object.values(RELATION_TYPES).map((rel) => (
              <button
                key={rel.id}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('selection-action', { detail: { action: 'linkSelected', relationType: rel.id } }))
                  setContextMenu({ visible: false, x: 0, y: 0 })
                }}
                className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 transition-colors"
                style={{ color: '#2d2d2d' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f0eb'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span className="w-3 h-0.5 flex-shrink-0" style={{ backgroundColor: rel.color }} />
                <span style={{ color: rel.color }}>{rel.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* 属性编辑面板 */}
      {propertyPanel.visible && propertyPanel.node && (
        <NodePropertyPanel
          node={propertyPanel.node}
          position={{ x: propertyPanel.x, y: propertyPanel.y }}
          onClose={() => setPropertyPanel(prev => ({ ...prev, visible: false }))}
        />
      )}

      {/* 快速添加菜单 */}
      {quickAddMenu.visible && (
        <QuickAddMenu
          x={quickAddMenu.x}
          y={quickAddMenu.y}
          onSelect={(type) => {
            window.dispatchEvent(new CustomEvent('canvas-quick-add', {
              detail: { type, position: quickAddMenu.flowPosition }
            }))
            setQuickAddMenu(prev => ({ ...prev, visible: false }))
          }}
          onClose={() => setQuickAddMenu(prev => ({ ...prev, visible: false }))}
        />
      )}

      {/* 子元素插槽 */}
      {children}
    </div>
  )
}

// 带 Provider 的导出组件
function KnowledgeCanvas(props) {
  return (
    <ReactFlowProvider>
      <KnowledgeCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

// 导出关系类型供外部使用
export { RELATION_TYPES }
export default KnowledgeCanvas
