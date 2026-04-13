/**
 * BottomAIBar - AI 知识分析助手栏
 * 功能：使用本地 claude CLI 分析文本，提取概念和关系
 * v0.1: 客户端解析模式（无需 AI 后端）
 */

import { useState } from 'react'
import { extractConcepts, suggestRelations, summarizeKnowledge } from '../../services/aiService'

// AI 分析功能选项
const AI_FUNCTIONS = [
  { id: 'extract', label: '提取概念', icon: '概', description: '从文本中提取关键概念' },
  { id: 'relations', label: '发现关系', icon: '关', description: '分析概念间的关系' },
  { id: 'summary', label: '知识摘要', icon: '摘', description: '生成知识结构摘要' },
]

function BottomAIBar({
  showLeftPanel = true,
  showRightPanel = true,
  onExtractConcepts,
  onSuggestRelations,
  concepts = [],
}) {
  const [input, setInput] = useState('')
  const [activeFunction, setActiveFunction] = useState('extract')
  const [isLoading, setIsLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [messages, setMessages] = useState([])

  // 执行分析
  const handleAnalyze = async () => {
    if (!input.trim() && activeFunction === 'extract') return
    if (isLoading) return

    setIsLoading(true)
    const userMessage = {
      role: 'user',
      content: input || `[${AI_FUNCTIONS.find(f => f.id === activeFunction)?.label}] 基于当前 ${concepts.length} 个概念`,
      function: activeFunction,
    }
    setMessages(prev => [...prev, userMessage])

    try {
      let result = ''

      switch (activeFunction) {
        case 'extract': {
          const extracted = await extractConcepts(input)
          if (extracted.length > 0) {
            onExtractConcepts?.(extracted)
            result = `成功提取 ${extracted.length} 个概念：\n${extracted.map(c => `  - ${c.title}（${c.description}）`).join('\n')}`
          } else {
            result = '未能从文本中提取到有效概念，请尝试输入更多内容。'
          }
          break
        }
        case 'relations': {
          if (concepts.length < 2) {
            result = '需要至少 2 个概念才能分析关系。请先添加更多概念到画布。'
          } else {
            const relations = await suggestRelations(concepts, input)
            if (relations.length > 0) {
              onSuggestRelations?.(relations)
              result = `发现 ${relations.length} 组关系：\n${relations.map(r => `  - ${r.source} → ${r.target}（${r.type}：${r.reason}）`).join('\n')}`
            } else {
              result = '未发现明确的概念间关系。'
            }
          }
          break
        }
        case 'summary': {
          const summary = await summarizeKnowledge(concepts)
          result = summary
          break
        }
      }

      const aiMessage = { role: 'assistant', content: result, function: activeFunction }
      setMessages(prev => [...prev, aiMessage])
    } catch (error) {
      console.error('AI 分析失败:', error)
      const errorMessage = {
        role: 'assistant',
        content: `分析失败: ${error.message}\n\n当前为客户端解析模式（v0.1），不依赖外部 AI 服务。`,
      }
      setMessages(prev => [...prev, errorMessage])
    }

    setInput('')
    setIsLoading(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAnalyze()
    }
  }

  return (
    <div
      className="fixed bottom-0 z-40 transition-all duration-500"
      style={{
        left: showLeftPanel ? '256px' : '0px',
        right: showRightPanel ? '320px' : '0px',
        background: 'var(--white)',
        borderTop: '1px solid var(--gray-100)',
      }}
    >
      {/* 对话历史（展开区域） */}
      {showHistory && messages.length > 0 && (
        <div className="max-h-56 overflow-y-auto p-3" style={{ borderBottom: '1px solid var(--gray-100)', background: 'var(--warm-bg)' }}>
          <div className="space-y-2">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed"
                  style={{
                    background: msg.role === 'user' ? 'var(--warm)' : 'var(--white)',
                    color: msg.role === 'user' ? 'white' : 'var(--dark)',
                    border: msg.role === 'assistant' ? '1px solid var(--gray-100)' : 'none',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-2 mt-1.5 pt-1.5" style={{ borderTop: '1px solid var(--gray-100)' }}>
                      <span
                        className="text-[10px] cursor-pointer transition-colors"
                        style={{ color: 'var(--warm)' }}
                        onClick={() => onExtractConcepts?.([{ title: '从回复中添加', content: msg.content }])}
                      >
                        添加到画布
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 功能选择条 */}
      <div className="flex items-center gap-1 px-3 pt-2">
        {AI_FUNCTIONS.map(fn => (
          <button
            key={fn.id}
            onClick={() => setActiveFunction(fn.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] rounded-full transition-all duration-300"
            style={{
              background: activeFunction === fn.id ? 'var(--warm-bg)' : 'transparent',
              color: activeFunction === fn.id ? 'var(--warm)' : 'var(--gray-500)',
              border: `1px solid ${activeFunction === fn.id ? 'var(--warm-light)' : 'var(--gray-100)'}`,
            }}
            title={fn.description}
          >
            <span className="w-4 h-4 flex items-center justify-center text-[9px] rounded" style={{
              background: activeFunction === fn.id ? 'var(--warm)' : 'var(--gray-100)',
              color: activeFunction === fn.id ? 'white' : 'var(--gray-500)',
              fontFamily: 'var(--font-serif)',
            }}>
              {fn.icon}
            </span>
            {fn.label}
          </button>
        ))}

        <div className="flex-1" />

        {/* 模式指示器 */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: 'var(--warm-bg)' }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#7bc47f' }} />
          <span className="text-[10px]" style={{ color: 'var(--gray-700)' }}>客户端解析</span>
        </div>
      </div>

      {/* 输入栏 */}
      <div className="flex items-center gap-2 px-3 pb-3 pt-2">
        {/* 历史按钮 */}
        {messages.length > 0 && (
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="p-2 rounded-lg transition-all duration-300"
            style={{
              color: showHistory ? 'var(--warm)' : 'var(--gray-500)',
              background: showHistory ? 'var(--warm-bg)' : 'transparent',
            }}
            title="查看分析历史"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        )}

        {/* 输入框 */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeFunction === 'extract'
                ? '输入文本，AI 将提取关键概念...'
                : activeFunction === 'relations'
                ? '输入上下文文本辅助关系分析（可选）...'
                : '基于当前画布概念生成摘要...'
            }
            className="w-full px-4 py-2.5 text-xs rounded-lg transition-all duration-300 focus:outline-none"
            style={{
              border: '1px solid var(--gray-100)',
              color: 'var(--dark)',
              fontFamily: 'var(--font-sans)',
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--warm)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--gray-100)'}
          />
        </div>

        {/* 发送按钮 */}
        <button
          onClick={handleAnalyze}
          disabled={isLoading || (!input.trim() && activeFunction === 'extract')}
          className="px-4 py-2.5 rounded-lg text-xs font-medium transition-all duration-300 flex items-center gap-1.5"
          style={{
            background: isLoading ? 'var(--gray-100)' : 'var(--warm)',
            color: isLoading ? 'var(--gray-500)' : 'white',
            opacity: (!input.trim() && activeFunction === 'extract') ? 0.5 : 1,
          }}
        >
          {isLoading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
          <span>{isLoading ? '分析中' : '分析'}</span>
        </button>
      </div>
    </div>
  )
}

export default BottomAIBar
