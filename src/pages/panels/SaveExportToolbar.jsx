/**
 * SaveExportToolbar - 保存、导入、导出工具栏
 * 功能：保存 JSON、导入 JSON、导出 PNG/PDF/Markdown/JSON-LD、一键自动排序 (横/竖)
 */

import { useState, useRef } from 'react'
import useCanvasStore from '../../stores/useCanvasStore'
import { useAletheiaStore } from '../../stores/useAletheiaStore'
import { logAction } from '../../utils/actionLog'

function SaveExportToolbar({ canvasRef, nodes, edges, exportCanvasData, importCanvasData }) {
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [isLayouting, setIsLayouting] = useState(false)
  const fileInputRef = useRef(null)

  // 自动排序方向 — TB(竖) | LR(横)
  const layoutDirection = useCanvasStore((s) => s.layoutDirection)
  const setLayoutDirection = useCanvasStore((s) => s.setLayoutDirection)
  const applyAutoLayout = useCanvasStore((s) => s.applyAutoLayout)

  // Aletheia 决策引擎激活时, 让工具栏给 banner 的"对画布跑一轮"等按钮让位
  // (banner 的按钮坐标和工具栏的"排序"按钮在 1280 视口下 bbox 重叠, 工具栏会拦截 banner 的点击)
  const aletheiaActive = useAletheiaStore((s) => s?.aletheiaActive ?? false)

  // 外部源 watch 同步 — 详见 docs/source-watch-sync-spec.md
  const checkSourceUpdates = useCanvasStore((s) => s.checkSourceUpdates)
  const sourceWatchInFlight = useCanvasStore((s) => s.sourceWatch?.inFlight ?? false)
  const lastSourceReport = useCanvasStore((s) => s.sourceWatch?.lastReport ?? null)
  const [showSourceReport, setShowSourceReport] = useState(false)

  const handleCheckSourceUpdates = async () => {
    if (sourceWatchInFlight) return
    try {
      const r = await checkSourceUpdates?.()
      if (r && !r.skipped) {
        setShowSourceReport(true)
        setTimeout(() => setShowSourceReport(false), 4000)
        logAction?.('toolbar.checkSourceUpdates', r)
      }
    } catch (e) {
      console.error('[checkSourceUpdates] 失败:', e)
      alert('检查外部源更新失败: ' + (e?.message || e))
    }
  }

  // 一键自动排序 — 按当前方向 + 节点连边算出新位置
  const handleAutoLayout = async () => {
    if (isLayouting) return
    setIsLayouting(true)
    try {
      const result = await applyAutoLayout()
      logAction('toolbar.autoLayout', {
        direction: result.direction,
        nodeCount: result.count,
      })
      // 简短提示, 不打扰
      const label = result.direction === 'LR' ? '横排' : '竖排'
      if (result.count > 0) {
        // 用 console + 临时 toast 替代 alert (alert 会打断协作流)
        console.log(`[自动排序] 已按 ${label} 重新布局 ${result.count} 个节点`)
      }
    } catch (e) {
      console.error('自动排序失败:', e)
      alert('自动排序失败：' + (e?.message || e))
    }
    setIsLayouting(false)
  }

  // 切换横竖排 — 切换后立即自动排序, 不需要再点"排序"按钮
  const handleToggleDirection = async (dir) => {
    if (dir === layoutDirection || isLayouting) return
    setLayoutDirection(dir)
    logAction('toolbar.setLayoutDirection', { direction: dir })
    setIsLayouting(true)
    try {
      const result = await applyAutoLayout()
      logAction('toolbar.autoLayoutOnToggle', {
        direction: result.direction,
        nodeCount: result.count,
      })
    } catch (e) {
      console.error('切换方向后自动排序失败:', e)
    }
    setIsLayouting(false)
  }

  // 清空画布（带二次确认）
  const handleClearCanvas = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    useCanvasStore.getState().clearCanvas()
    setConfirmClear(false)
  }

  // 下载文件辅助函数
  const downloadFile = (content, filename, type) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  // 保存为 JSON
  const handleSaveJSON = () => {
    const data = exportCanvasData?.() || { nodes, edges }
    const jsonStr = JSON.stringify(data, null, 2)
    downloadFile(jsonStr, `know-canvas-${Date.now()}.json`, 'application/json')
    setShowSaveMenu(false)
  }

  // 导出为 Markdown 知识库
  const handleExportMarkdown = () => {
    const conceptNodes = nodes.filter(n => n.type === 'conceptNode' && n.data?.title)
    let md = `# ALETHEIA 画布导出\n\n`
    md += `> 导出时间：${new Date().toLocaleString()}\n`
    md += `> 概念数量：${conceptNodes.length}，关系数量：${edges.length}\n\n`
    md += `---\n\n`

    // 按分类分组
    const categories = {}
    for (const node of conceptNodes) {
      const cat = node.data?.category || 'uncategorized'
      if (!categories[cat]) categories[cat] = []
      categories[cat].push(node)
    }

    const categoryLabels = {
      core: '核心概念',
      theory: '理论',
      method: '方法论',
      example: '案例',
      reference: '参考',
      question: '待探索',
      uncategorized: '未分类',
    }

    for (const [catId, catNodes] of Object.entries(categories)) {
      md += `## ${categoryLabels[catId] || catId}\n\n`
      for (const node of catNodes) {
        md += `### ${node.data?.title || '未命名'}\n\n`
        if (node.data?.description) {
          md += `${node.data.description}\n\n`
        }
        if (node.data?.tags?.length > 0) {
          md += `**标签**：${node.data.tags.join('、')}\n\n`
        }
        // 查找关联关系
        const nodeEdges = edges.filter(e => e.source === node.id || e.target === node.id)
        if (nodeEdges.length > 0) {
          md += `**关系**：\n`
          for (const edge of nodeEdges) {
            const isSource = edge.source === node.id
            const otherId = isSource ? edge.target : edge.source
            const otherNode = nodes.find(n => n.id === otherId)
            md += `- ${edge.label || edge.type || '相关'} → ${otherNode?.data?.title || otherId}\n`
          }
          md += '\n'
        }
      }
    }

    downloadFile(md, `know-canvas-${Date.now()}.md`, 'text/markdown')
  }

  // 导出为 JSON-LD
  const handleExportJSONLD = () => {
    const conceptNodes = nodes.filter(n => n.type === 'conceptNode' && n.data?.title)

    const jsonld = {
      '@context': {
        '@vocab': 'http://schema.org/',
        'concept': 'http://schema.org/Thing',
        'relatedTo': 'http://schema.org/relatedTo',
        'isPartOf': 'http://schema.org/isPartOf',
      },
      '@graph': conceptNodes.map(node => {
        const nodeEdges = edges.filter(e => e.source === node.id)
        const entry = {
          '@type': 'Thing',
          '@id': node.id,
          'name': node.data?.title || '',
          'description': node.data?.description || '',
        }
        if (node.data?.tags?.length > 0) {
          entry.keywords = node.data.tags.join(', ')
        }
        if (nodeEdges.length > 0) {
          entry.relatedTo = nodeEdges.map(e => ({ '@id': e.target }))
        }
        return entry
      }),
    }

    const jsonStr = JSON.stringify(jsonld, null, 2)
    downloadFile(jsonStr, `know-canvas-${Date.now()}.jsonld`, 'application/ld+json')
  }

  // 导出为 PNG（需要 html-to-image）
  const handleExportPNG = async () => {
    if (!canvasRef?.current) return
    setIsExporting(true)

    try {
      // 动态导入避免未安装时报错
      const { toPng } = await import('html-to-image')
      const element = canvasRef.current.querySelector('.react-flow')
      if (!element) throw new Error('画布元素未找到')

      const dataUrl = await toPng(element, {
        backgroundColor: '#fafafa',
        quality: 1,
        pixelRatio: 2,
      })

      const link = document.createElement('a')
      link.download = `know-canvas-${Date.now()}.png`
      link.href = dataUrl
      link.click()
    } catch (error) {
      console.error('PNG 导出失败:', error)
      alert('导出 PNG 失败：' + error.message)
    }

    setIsExporting(false)
  }

  // 导入 JSON
  const handleImportJSON = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (!data.nodes || !Array.isArray(data.nodes)) {
        throw new Error('无效的画布数据格式')
      }

      importCanvasData?.(data.nodes, data.edges || [])
      alert('导入成功！')
    } catch (error) {
      console.error('导入失败:', error)
      alert('导入失败：' + error.message)
    }

    setIsImporting(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Aletheia 引擎激活时隐藏工具栏 — 让 banner 的"对画布跑一轮"独占顶部点击
  if (aletheiaActive) return null

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex gap-2">
      {/* 保存按钮 */}
      <div className="relative">
        <button
          onClick={() => { setShowSaveMenu(!showSaveMenu); setShowSettingsMenu(false) }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg shadow-sm transition-all duration-300 card-hover"
          style={{
            background: 'var(--white)',
            border: '1px solid var(--gray-100)',
            color: 'var(--dark)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--warm)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--gray-100)'}
        >
          <svg className="w-4 h-4" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          <span className="text-xs font-medium">保存</span>
        </button>

        {showSaveMenu && (
          <div className="absolute top-full left-0 mt-2 w-52 rounded-lg shadow-lg py-1.5 z-50" style={{ background: 'var(--white)', border: '1px solid var(--gray-100)' }}>
            <button
              onClick={handleSaveJSON}
              className="w-full px-4 py-2 text-left text-xs flex items-center gap-2 transition-colors duration-300"
              style={{ color: 'var(--dark)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--warm-bg)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-3.5 h-3.5" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              保存为 JSON
            </button>
          </div>
        )}
      </div>

      {/* 隐藏的文件 input — 给设置菜单用 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImportJSON}
        className="hidden"
      />

      {/* 折叠分级开关 — 仅主干 / 显示全部 */}
      <CollapseModeSwitch />

      {/* 一键自动排序按钮 (smartLayout: 有边走 dagre, 无边走分类) */}
      <div className="relative">
        <button
          onClick={handleAutoLayout}
          disabled={isLayouting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg shadow-sm transition-all duration-300 card-hover disabled:opacity-50"
          style={{
            background: 'var(--white)',
            border: '1px solid var(--gray-100)',
            color: 'var(--dark)',
          }}
          onMouseEnter={(e) => { if (!isLayouting) e.currentTarget.style.borderColor = 'var(--warm)' }}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--gray-100)'}
          title={`自动排序 (${layoutDirection === 'LR' ? '横排' : '竖排'}) — 解遮挡、规整化`}
        >
          {isLayouting ? (
            <svg className="w-4 h-4 animate-spin" style={{ color: 'var(--warm)' }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {/* 网格 + 箭头, 寓意"重新排列" */}
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h6M4 12h6M4 18h6M14 4l4 4m0 0l-4 4m4-4h-4M14 16l4-4m0 0l-4-4m4 4h-4" />
            </svg>
          )}
          <span className="text-xs font-medium">{isLayouting ? '排序中...' : '排序'}</span>
        </button>
      </div>

      {/* 外部源 watch 同步按钮 — 检查飞书/Notion 节点是否有更新 */}
      <div className="relative">
        <button
          onClick={handleCheckSourceUpdates}
          disabled={sourceWatchInFlight}
          className="flex items-center gap-2 px-3 py-2 rounded-lg shadow-sm transition-all duration-300 card-hover disabled:opacity-50"
          style={{
            background: 'var(--white)',
            border: '1px solid var(--gray-100)',
            color: 'var(--dark)',
          }}
          onMouseEnter={(e) => { if (!sourceWatchInFlight) e.currentTarget.style.borderColor = 'var(--warm)' }}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--gray-100)'}
          title="检查飞书 / Notion 导入的节点是否有更新"
        >
          <svg
            className={`w-4 h-4 ${sourceWatchInFlight ? 'animate-spin' : ''}`}
            style={{ color: 'var(--warm)' }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="text-xs font-medium">
            {sourceWatchInFlight ? '检查中...' : '外部源'}
          </span>
        </button>
        {/* 报告气泡 — 检查完 4s 内显示 */}
        {showSourceReport && lastSourceReport && (
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 rounded-lg shadow-md text-[11px] whitespace-nowrap z-50"
            style={{
              background: 'var(--white)',
              border: '1px solid var(--gray-100)',
              color: 'var(--dark)',
            }}
          >
            {lastSourceReport.total === 0 ? (
              <span style={{ color: 'var(--gray-500)' }}>暂无外部源节点</span>
            ) : (
              <>
                <span>检查 {lastSourceReport.checked}/{lastSourceReport.total}</span>
                {' · '}
                <span style={{ color: lastSourceReport.updated > 0 ? '#3b82f6' : 'var(--gray-500)' }}>
                  更新 {lastSourceReport.updated}
                </span>
                {lastSourceReport.errors > 0 && (
                  <>
                    {' · '}
                    <span style={{ color: '#ef4444' }}>错误 {lastSourceReport.errors}</span>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ⚙ 设置下拉 — 收纳次要操作: 横竖切换/导入/导出/清空 */}
      <div className="relative">
        <button
          onClick={() => { setShowSettingsMenu(!showSettingsMenu); setShowSaveMenu(false) }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg shadow-sm transition-all duration-300 card-hover"
          style={{
            background: 'var(--white)',
            border: '1px solid var(--gray-100)',
            color: 'var(--dark)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--warm)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--gray-100)'}
          title="更多设置: 排序方向 / 导入 / 导出 / 清空"
        >
          <svg className="w-4 h-4" style={{ color: 'var(--gray-700)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {showSettingsMenu && (
          <div className="absolute top-full right-0 mt-2 w-56 rounded-lg shadow-lg py-1.5 z-50" style={{ background: 'var(--white)', border: '1px solid var(--gray-100)' }}>
            {/* 排序方向 — 嵌入式分段 */}
            <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--gray-100)' }}>
              <div style={{ fontSize: 10, color: 'var(--gray-500)', letterSpacing: '0.15em', marginBottom: 6 }}>排序方向</div>
              <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--gray-100)' }}>
                <button
                  onClick={() => handleToggleDirection('LR')}
                  className="flex-1 py-1 text-xs font-medium"
                  style={{
                    background: layoutDirection === 'LR' ? 'var(--warm-bg)' : 'transparent',
                    color: layoutDirection === 'LR' ? 'var(--warm)' : 'var(--gray-700)',
                  }}
                >横排</button>
                <button
                  onClick={() => handleToggleDirection('TB')}
                  className="flex-1 py-1 text-xs font-medium"
                  style={{
                    background: layoutDirection === 'TB' ? 'var(--warm-bg)' : 'transparent',
                    color: layoutDirection === 'TB' ? 'var(--warm)' : 'var(--gray-700)',
                    borderLeft: '1px solid var(--gray-100)',
                  }}
                >竖排</button>
              </div>
            </div>

            {/* 导入 */}
            <button
              onClick={() => { fileInputRef.current?.click(); setShowSettingsMenu(false) }}
              disabled={isImporting}
              className="w-full px-4 py-2 text-left text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
              style={{ color: 'var(--dark)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--warm-bg)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-3.5 h-3.5" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {isImporting ? '导入中...' : '导入 JSON'}
            </button>

            <div style={{ height: 1, background: 'var(--gray-100)', margin: '4px 0' }} />

            {/* 导出三种格式 */}
            <button
              onClick={() => { handleExportMarkdown(); setShowSettingsMenu(false) }}
              className="w-full px-4 py-2 text-left text-xs flex items-center gap-2 transition-colors"
              style={{ color: 'var(--dark)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--warm-bg)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-3.5 h-3.5" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              导出 Markdown
            </button>
            <button
              onClick={() => { handleExportJSONLD(); setShowSettingsMenu(false) }}
              className="w-full px-4 py-2 text-left text-xs flex items-center gap-2 transition-colors"
              style={{ color: 'var(--dark)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--warm-bg)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-3.5 h-3.5" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              导出 JSON-LD
            </button>
            <button
              onClick={() => { handleExportPNG(); setShowSettingsMenu(false) }}
              disabled={isExporting}
              className="w-full px-4 py-2 text-left text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
              style={{ color: 'var(--dark)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--warm-bg)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-3.5 h-3.5" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {isExporting ? '导出中...' : '导出 PNG'}
            </button>

            <div style={{ height: 1, background: 'var(--gray-100)', margin: '4px 0' }} />

            {/* 清空 — 二次确认 */}
            <button
              onClick={handleClearCanvas}
              className="w-full px-4 py-2 text-left text-xs flex items-center gap-2 transition-colors"
              style={{ color: confirmClear ? 'var(--severity-critical)' : 'var(--dark)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#fef2f2'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-3.5 h-3.5" style={{ color: 'var(--severity-critical)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {confirmClear ? '再点确认清空' : '清空画布'}
            </button>
          </div>
        )}
      </div>

      {/* 点击外部关闭菜单 */}
      {(showSaveMenu || showSettingsMenu) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => { setShowSaveMenu(false); setShowSettingsMenu(false) }}
        />
      )}
    </div>
  )
}

// === 折叠分级开关 — 仅主干 / 显示全部 ===
// 选中"仅主干"时, ROLE/AGENT/反驳/拆解节点折叠, 只看 GOAL/ENTITY/SYNTHESIS/CONCLUSION 主干。
// 用户可在 ENTITY 节点 click 单独展开本支, 或 pin 节点强制显示。
function CollapseModeSwitch() {
  const collapseMode = useCanvasStore((s) => s.collapseMode || 'full')
  const setCollapseMode = useCanvasStore((s) => s.setCollapseMode)
  const collapseAllSources = useCanvasStore((s) => s.collapseAllSources)
  const expandedCount = useCanvasStore((s) => (s.expandedSourceIds || []).length)
  const pinnedCount = useCanvasStore((s) => (s.pinnedNodeIds || []).length)

  return (
    <div
      className="flex items-center rounded-lg overflow-hidden shadow-sm"
      style={{ border: '1px solid var(--gray-100)', background: 'var(--white)' }}
      title="折叠分级 — 仅主干视图减少视觉噪音"
    >
      <button
        onClick={() => setCollapseMode('minimal')}
        className="px-3 py-2 text-xs font-medium transition-colors duration-200"
        style={{
          background: collapseMode === 'minimal' ? 'var(--warm-bg)' : 'transparent',
          color: collapseMode === 'minimal' ? 'var(--warm)' : 'var(--gray-700)',
          borderRight: '1px solid var(--gray-100)',
        }}
        title="仅显示主干 (GOAL/ENTITY/SYNTHESIS/CONCLUSION), 其他折叠"
      >
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          主干
        </span>
      </button>
      <button
        onClick={() => {
          setCollapseMode('full')
          collapseAllSources?.()
        }}
        className="px-3 py-2 text-xs font-medium transition-colors duration-200"
        style={{
          background: collapseMode === 'full' ? 'var(--warm-bg)' : 'transparent',
          color: collapseMode === 'full' ? 'var(--warm)' : 'var(--gray-700)',
        }}
        title="显示全部节点"
      >
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4h16v16H4z M4 10h16 M10 4v16" />
          </svg>
          全部
          {collapseMode === 'minimal' && (expandedCount > 0 || pinnedCount > 0) && (
            <span style={{ fontSize: 9, color: 'var(--accent)', marginLeft: 2 }}>
              {expandedCount > 0 && `+${expandedCount}支`}{pinnedCount > 0 && ` ${pinnedCount}📌`}
            </span>
          )}
        </span>
      </button>
    </div>
  )
}

export default SaveExportToolbar
