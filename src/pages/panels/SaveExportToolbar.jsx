/**
 * SaveExportToolbar - 保存、导入、导出工具栏
 * 功能：保存 JSON、导入 JSON、导出 PNG/PDF/Markdown/JSON-LD
 */

import { useState, useRef } from 'react'

function SaveExportToolbar({ canvasRef, nodes, edges, exportCanvasData, importCanvasData }) {
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef(null)

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
    let md = `# 知识图谱导出\n\n`
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
    setShowExportMenu(false)
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
    setShowExportMenu(false)
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
    setShowExportMenu(false)
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

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex gap-2">
      {/* 保存按钮 */}
      <div className="relative">
        <button
          onClick={() => { setShowSaveMenu(!showSaveMenu); setShowExportMenu(false) }}
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

      {/* 导出按钮 */}
      <div className="relative">
        <button
          onClick={() => { setShowExportMenu(!showExportMenu); setShowSaveMenu(false) }}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg shadow-sm transition-all duration-300 card-hover disabled:opacity-50"
          style={{
            background: 'var(--white)',
            border: '1px solid var(--gray-100)',
            color: 'var(--dark)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--warm)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--gray-100)'}
        >
          {isExporting ? (
            <svg className="w-4 h-4 animate-spin" style={{ color: 'var(--warm)' }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          )}
          <span className="text-xs font-medium">{isExporting ? '导出中...' : '导出'}</span>
        </button>

        {showExportMenu && !isExporting && (
          <div className="absolute top-full left-0 mt-2 w-52 rounded-lg shadow-lg py-1.5 z-50" style={{ background: 'var(--white)', border: '1px solid var(--gray-100)' }}>
            <button
              onClick={handleExportMarkdown}
              className="w-full px-4 py-2 text-left text-xs flex items-center gap-2 transition-colors"
              style={{ color: 'var(--dark)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--warm-bg)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-3.5 h-3.5" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              导出为 Markdown
            </button>
            <button
              onClick={handleExportJSONLD}
              className="w-full px-4 py-2 text-left text-xs flex items-center gap-2 transition-colors"
              style={{ color: 'var(--dark)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--warm-bg)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-3.5 h-3.5" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              导出为 JSON-LD
            </button>
            <button
              onClick={handleExportPNG}
              className="w-full px-4 py-2 text-left text-xs flex items-center gap-2 transition-colors"
              style={{ color: 'var(--dark)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--warm-bg)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <svg className="w-3.5 h-3.5" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              导出为 PNG
            </button>
          </div>
        )}
      </div>

      {/* 导入按钮 */}
      <div className="relative">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg shadow-sm transition-all duration-300 card-hover disabled:opacity-50"
          style={{
            background: 'var(--white)',
            border: '1px solid var(--gray-100)',
            color: 'var(--dark)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--warm)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--gray-100)'}
        >
          {isImporting ? (
            <svg className="w-4 h-4 animate-spin" style={{ color: 'var(--warm)' }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" style={{ color: 'var(--warm)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
          <span className="text-xs font-medium">{isImporting ? '导入中...' : '导入'}</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImportJSON}
          className="hidden"
        />
      </div>

      {/* 点击外部关闭菜单 */}
      {(showSaveMenu || showExportMenu) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => { setShowSaveMenu(false); setShowExportMenu(false) }}
        />
      )}
    </div>
  )
}

export default SaveExportToolbar
