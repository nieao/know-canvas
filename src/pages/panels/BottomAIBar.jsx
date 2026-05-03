/**
 * BottomAIBar — 一句话 → HTML 页面节点
 *
 * 交互:
 *   - 输入一句话 (问题/目标/想法)
 *   - 默认走"元认知"模式: LLM 一次调用 → 5 维度建筑极简 HTML 页面 → 落画布
 *   - 切到"Hermes"模式: 派单到 Hermes worker, 节点即派单回执 HTML, 后台跑
 *   - 提交后立即拿到节点 (running 状态), 完成后 iframe 渲染
 *
 * 历史的 4 个 AI_FUNCTIONS (extract / relations / aletheia / summary) 已下线 —
 * 元认知模式已经覆盖"一句话直接出洞察"的核心需求.
 */

import { useState, useRef, useEffect } from 'react'
import useCanvasStore from '../../stores/useCanvasStore'
import { parseFile } from '../../utils/fileParser'

const MODES = [
  {
    id: 'meta',
    label: '元认知',
    desc: '元认知 6 stage: 上下文 → 拆解 → Agent 涌现 → 拓扑 → 执行 → 决策反思. 画布上看真实拆分 + 多 agent 多节点',
  },
  {
    id: 'hermes',
    label: 'Hermes',
    desc: '派单给 Hermes worker, 节点显示派单回执. 远端跑完后 result 落到 ResultNode',
  },
  {
    id: 'oneshot',
    label: '极简 HTML',
    desc: '一句话 → 5 维度 HTML 页面 (单节点, 不拆解, 适合快速回答)',
  },
]

function BottomAIBar({ showLeftPanel = true, showRightPanel = true, rightPanelWidth = 320 }) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState('meta')
  const [submitting, setSubmitting] = useState(false)
  const [lastNodeId, setLastNodeId] = useState(null)
  const [importedFiles, setImportedFiles] = useState([])  // [{ name, text, fullSize }] — 多文件支持
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)

  // textarea 自动撑高 — 长文本不再被截断, 用户可整体阅读指令
  // 单行 ~36px, 上限 5 行 ~ 140px
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const next = Math.min(ta.scrollHeight, 140)
    ta.style.height = `${next}px`
  }, [input])

  const askAndCreateHtmlNode = useCanvasStore((s) => s.askAndCreateHtmlNode)
  const askAndStartMetaProject = useCanvasStore((s) => s.askAndStartMetaProject)

  // 文件选择 → 解析 → 预览到 input 提示 (支持多选 + 多次追加)
  const handleFilePick = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    const failed = []
    const parsedList = []
    for (const file of files) {
      try {
        const parsed = await parseFile(file)
        const text = String(parsed.content || '').trim()
        if (!text) {
          failed.push(`${file.name}: 文件为空`)
          continue
        }
        // 单文件截断 8000 字 (多文件时还会再做总量裁剪)
        const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n\n...(已截断, 原文 ' + text.length + ' 字)' : text
        parsedList.push({ name: file.name, text: truncated, fullSize: text.length })
      } catch (err) {
        failed.push(`${file.name}: ${err?.message || err}`)
      }
    }
    if (parsedList.length > 0) {
      // append 到现有列表 (用户可分批选)
      setImportedFiles((prev) => [...prev, ...parsedList])
      // 仅在 input 为空时填默认引导
      setInput((cur) => {
        if (cur.trim()) return cur
        const allNames = [...importedFiles, ...parsedList].map((f) => `《${f.name}》`).join('、')
        return `基于附件 ${allNames} 内容做元认知拆解 + 推导`
      })
    }
    if (failed.length > 0) {
      alert(`部分文件解析失败:\n${failed.join('\n')}`)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const clearImportedFile = (idx) => {
    if (typeof idx === 'number') setImportedFiles((prev) => prev.filter((_, i) => i !== idx))
    else setImportedFiles([])
  }

  const canSubmit = input.trim().length > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    let text = input.trim()
    // 多附件依次拼到 prompt 后, 总长度上限 24000 字 (LLM 上下文兜底)
    if (importedFiles.length > 0) {
      let attachBlock = ''
      let acc = 0
      const HARD_CAP = 24000
      for (const f of importedFiles) {
        const piece = `\n\n=== 附件: ${f.name} ===\n${f.text}`
        if (acc + piece.length > HARD_CAP) {
          attachBlock += `\n\n=== 附件: ${f.name} ===\n[多附件总长超 ${HARD_CAP} 字, 此项已跳过, 原 ${f.fullSize} 字]`
        } else {
          attachBlock += piece
          acc += piece.length
        }
      }
      text = `${text}${attachBlock}`
    }
    // 多轮对话: 自动把上一轮的 conclusion 节点拼到新 prompt 当上下文
    // (用户图 47/48 反馈"二次对话给指令但没执行" — 实际新 project 落到了远处, 视口没跟过去
    //  且没有上下文衔接, 视觉上像没响应)
    try {
      const allNodes = useCanvasStore.getState().nodes || []
      const conclusions = allNodes
        .filter((n) => n.type === 'ontologyNode' && n.data?.isConclusion && n.data?.conclusion)
        .sort((a, b) => (b.data?.created_at || 0) - (a.data?.created_at || 0))
        .slice(0, 1)
      if (conclusions.length > 0) {
        const last = conclusions[0]
        text = `${text}\n\n=== 上一轮决策结论 (供二次对话参考) ===\n${last.data.conclusion}`
      }
    } catch {}

    setSubmitting(true)
    try {
      let nodeId
      if (mode === 'meta') {
        // 元认知 = 6-stage 多节点 (上下文/拆解/agent涌现/拓扑/执行/决策反思)
        nodeId = await askAndStartMetaProject(text)
      } else if (mode === 'oneshot') {
        // 极简 HTML = 一次性单节点 5 维度 HTML
        nodeId = await askAndCreateHtmlNode(text, 'meta')
      } else {
        // hermes 派单
        nodeId = await askAndCreateHtmlNode(text, 'hermes')
      }
      setLastNodeId(nodeId)
      setInput('')
      setImportedFiles([])  // 提交后清空附件

      // 自动跳视口到新 root 节点, 让用户立刻看到新项目落到哪
      // (askAndStartMetaProject 同步返回 rootId, 新 projectGroup 因避让被推到远处时
      //  用户看不到, 以为没执行)
      if (nodeId) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('canvas-focus-node', { detail: { nodeId } }))
        }, 200)
      }
    } catch (err) {
      console.error('[BottomAIBar] submit failed:', err)
      alert(`提交失败: ${err?.message || err}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div
      className="fixed bottom-0 z-40 transition-all duration-500"
      style={{
        left: showLeftPanel ? '256px' : '0px',
        right: showRightPanel ? `${rightPanelWidth}px` : '0px',
        background: 'var(--white, #fafafa)',
        borderTop: '1px solid var(--gray-100, #e8e8e8)',
      }}
    >
      {/* === 模式切换条 === */}
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span
          className="text-[9px]"
          style={{ color: 'var(--gray-500, #888)', letterSpacing: '0.3em' }}
        >
          MODE
        </span>
        <div className="flex items-center gap-1">
          {MODES.map((m) => {
            const active = mode === m.id
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className="px-3 py-1 text-[10px] rounded-full transition-all duration-300"
                style={{
                  background: active ? 'var(--warm-bg, #f5f0eb)' : 'transparent',
                  color: active ? 'var(--warm, #c8a882)' : 'var(--gray-500, #888)',
                  border: `1px solid ${active ? 'var(--warm-light, #e8d5c0)' : 'var(--gray-100, #e8e8e8)'}`,
                  fontWeight: active ? 500 : 400,
                  letterSpacing: '0.05em',
                }}
                title={m.desc}
              >
                {m.label}
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        {/* 状态指示器 */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full"
          style={{ background: 'var(--warm-bg, #f5f0eb)' }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: submitting ? '#c8a882' : '#7bc47f',
              animation: submitting ? 'bottomai-pulse 1.4s ease-in-out infinite' : 'none',
            }}
          />
          <span className="text-[10px]" style={{ color: 'var(--gray-700, #555)' }}>
            {submitting ? '提交中' : '就绪'}
          </span>
        </div>
      </div>

      {/* === 已选附件预览 (多文件) === */}
      {importedFiles.length > 0 && (
        <div className="mx-3 mb-1 flex flex-wrap gap-1.5">
          {importedFiles.map((f, idx) => (
            <div
              key={`${f.name}-${idx}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded-md"
              style={{
                background: 'var(--warm-bg, #f5f0eb)',
                border: '1px solid var(--warm-light, #e8d5c0)',
                color: 'var(--gray-700, #555)',
              }}
            >
              <svg className="w-3 h-3" style={{ color: 'var(--warm, #c8a882)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span style={{ color: 'var(--warm, #c8a882)', fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>{f.name}</span>
              <span style={{ opacity: 0.7 }}>· {f.text.length}字{f.fullSize > f.text.length ? ' (截)' : ''}</span>
              <button
                type="button"
                onClick={() => clearImportedFile(idx)}
                className="px-1 rounded hover:bg-red-50 transition-colors"
                style={{ color: 'var(--gray-500, #888)' }}
                title="移除此附件"
              >
                ✕
              </button>
            </div>
          ))}
          {importedFiles.length > 1 && (
            <button
              type="button"
              onClick={() => clearImportedFile()}
              className="text-[10px] px-2 py-1 rounded transition-colors"
              style={{ color: 'var(--gray-500, #888)', border: '1px solid var(--gray-100, #e8e8e8)' }}
              title="全部移除"
            >
              清空 {importedFiles.length}
            </button>
          )}
        </div>
      )}

      {/* 隐藏的文件 input — multiple 允许选多个 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.markdown"
        multiple
        style={{ display: 'none' }}
        onChange={handleFilePick}
      />

      {/* === 输入栏 === */}
      <div className="flex items-end gap-2 px-3 pb-3 pt-2">
        {/* 附件按钮 — 选 MD/TXT 喂 LLM */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={submitting}
          className="px-2.5 py-2.5 rounded-lg text-xs transition-all duration-300"
          style={{
            border: '1px solid var(--gray-100, #e8e8e8)',
            background: 'var(--white, #fff)',
            color: importedFiles.length > 0 ? 'var(--warm, #c8a882)' : 'var(--gray-500, #888)',
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
          title="导入 MD / TXT 文件 → 喂给元认知作上下文"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'meta'
                ? '一句话 → 画布展开真实项目拆分 + 多 Agent 涌现 + 决策反思 (6 stage 多节点)…  例: 在上海开一家咖啡馆'
                : mode === 'hermes'
                ? '一句话任务描述 → 派给 Hermes worker…  例: 调研 2026 上半年 AI 编辑器市占率'
                : '一句话 → 一次性 5 维度极简 HTML 页面 (单节点)…  例: 短视频脚本 30s'
            }
            disabled={submitting}
            className="w-full px-4 py-2.5 text-xs rounded-lg transition-colors duration-300 focus:outline-none block"
            style={{
              border: '1px solid var(--gray-100, #e8e8e8)',
              color: 'var(--dark, #1a1a1a)',
              fontFamily: 'var(--font-sans), system-ui, sans-serif',
              background: submitting ? 'var(--gray-50, #f0f0f0)' : 'var(--white, #fff)',
              resize: 'none',
              minHeight: 38,
              maxHeight: 140,
              overflowY: 'auto',
              lineHeight: 1.55,
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--warm, #c8a882)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--gray-100, #e8e8e8)')}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-4 py-2.5 rounded-lg text-xs font-medium transition-all duration-300 flex items-center gap-1.5"
          style={{
            background: canSubmit ? 'var(--warm, #c8a882)' : 'var(--gray-100, #e8e8e8)',
            color: canSubmit ? 'white' : 'var(--gray-500, #888)',
            opacity: canSubmit ? 1 : 0.6,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            letterSpacing: '0.08em',
          }}
        >
          {submitting ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>生成中</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{mode === 'hermes' ? '派 Hermes' : mode === 'oneshot' ? '生成页面' : '启动元认知'}</span>
            </>
          )}
        </button>
      </div>

      {lastNodeId && (
        <div
          className="px-4 pb-2 text-[10px]"
          style={{ color: 'var(--gray-500, #888)' }}
        >
          已落画布 → 节点 <span style={{ color: 'var(--warm, #c8a882)' }}>{lastNodeId.slice(0, 18)}</span>
          {mode === 'hermes' ? ' (Hermes 后台执行中)' : mode === 'oneshot' ? ' (5 维度 HTML 生成中)' : ' (元认知拆解中, 看画布上的 6 阶段多节点揭示)'}
        </div>
      )}

      <style>{`
        @keyframes bottomai-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>
    </div>
  )
}

export default BottomAIBar
