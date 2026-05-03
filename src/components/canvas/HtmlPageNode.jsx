/**
 * HtmlPageNode — 一句话产 HTML 页面节点
 *
 * 形态: BottomAIBar 输入一句话提交后, 落画布的"页面节点".
 * 内容: LLM (元认知模式) 直接产出的建筑极简风格 HTML 页面字符串.
 * 渲染: iframe srcdoc 沙箱化 (allow-same-origin 关闭, 防 XSS).
 *
 * 状态机 (data.taskStatus):
 *   pending  — 占位刚创建, 等 LLM/Hermes 启动
 *   running  — 正在调用 LLM 或 Hermes, 显示动画
 *   done     — 完成, 显示 iframe
 *   failed   — 失败, 显示错误 + 重试
 *
 * data 字段:
 *   prompt:     用户输入的一句话
 *   mode:       'meta' | 'hermes'
 *   taskStatus: 见上
 *   html:       完成后的 HTML 字符串
 *   error:      失败时的错误消息
 *   tasks:      [{label, status}] 任务清单 (用于 hermes 模式 / 多步流程)
 */

import { memo, useState } from 'react'
import { Handle, Position } from 'reactflow'
import useCanvasStore from '../../stores/useCanvasStore'

const STATUS_META = {
  pending: { label: '排队中',  color: '#888',     dot: '#bbb' },
  running: { label: '生成中',  color: '#c8a882',  dot: '#c8a882' },
  done:    { label: '已完成',  color: '#7bc47f',  dot: '#7bc47f' },
  failed:  { label: '失败',    color: '#7a3a4a',  dot: '#b27c8b' },
}

function HtmlPageNodeImpl({ id, data, selected }) {
  const updateNode = useCanvasStore((s) => s.updateNode)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const retry = useCanvasStore((s) => s.retryHtmlAnswer)
  const [fullscreen, setFullscreen] = useState(false)

  const status = data.taskStatus || 'pending'
  const meta = STATUS_META[status] || STATUS_META.pending
  const prompt = data.prompt || ''
  const mode = data.mode || 'meta'
  const html = data.html || ''
  const error = data.error || ''
  const tasks = Array.isArray(data.tasks) ? data.tasks : []
  const decision = data.decision
  const libraryId = data.libraryId
  const isLive = status === 'pending' || status === 'running'

  const VERDICT_META = {
    go:    { color: '#7bc47f', bg: 'rgba(123,196,127,0.12)', label: 'GO · 推进' },
    hold:  { color: '#c8a882', bg: 'rgba(200,168,130,0.14)', label: 'HOLD · 暂缓' },
    pivot: { color: '#b27c8b', bg: 'rgba(178,124,139,0.14)', label: 'PIVOT · 转向' },
  }
  const vmeta = decision?.verdict ? VERDICT_META[decision.verdict] : null

  const onCopy = (e) => {
    e.stopPropagation()
    if (!html) return
    navigator.clipboard?.writeText(html).catch(() => {})
  }

  const onRetry = (e) => {
    e.stopPropagation()
    retry?.(id)
  }

  const onRemove = (e) => {
    e.stopPropagation()
    removeNode?.(id)
  }

  const onToggleFullscreen = (e) => {
    e.stopPropagation()
    setFullscreen((v) => !v)
  }

  return (
    <div
      className="relative shadow-sm transition-all duration-300"
      style={{
        width: fullscreen ? 880 : 480,
        background: 'var(--surface, #fafafa)',
        border: `${selected ? '2px' : '1px'} solid ${selected ? 'var(--accent, #c8a882)' : 'var(--border-subtle, #e8e8e8)'}`,
        borderRadius: 4,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: '#c8a882' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#c8a882' }} />

      {/* === 顶部 header === */}
      <div
        className="px-4 py-2.5 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border-subtle, #e8e8e8)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-[9px] font-semibold flex-shrink-0"
            style={{ color: '#c8a882', letterSpacing: '0.3em' }}
          >
            {mode === 'hermes' ? 'HERMES PAGE' : 'META PAGE'}
          </span>
          <span className="text-[9px] flex-shrink-0" style={{ color: 'var(--text-faint, #bbb)' }}>·</span>
          <span
            className="text-[10px] truncate"
            title={prompt}
            style={{ color: 'var(--text-muted, #555)', fontFamily: 'var(--font-serif), Georgia, serif' }}
          >
            {prompt || '(无输入)'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          {/* 状态徽章 */}
          <span
            className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-sm"
            style={{ color: meta.color, letterSpacing: '0.15em' }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                background: meta.dot,
                animation: isLive ? 'htmlpage-pulse 1.4s ease-in-out infinite' : 'none',
              }}
            />
            {meta.label}
          </span>
          <button
            onClick={onRemove}
            className="text-[10px] opacity-40 hover:opacity-90 transition-opacity"
            style={{ color: 'var(--text-faint, #888)' }}
            title="删除此节点"
          >
            ✕
          </button>
        </div>
      </div>

      {/* === 进行中: 动画进度条 === */}
      {isLive && (
        <div
          className="relative h-[3px] overflow-hidden"
          style={{ background: 'var(--border-subtle, #e8e8e8)' }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, transparent 0%, #c8a882 50%, transparent 100%)',
              animation: 'htmlpage-shimmer 1.6s linear infinite',
            }}
          />
        </div>
      )}

      {/* === 任务清单 (元认知 5 维度 / hermes 步骤) === */}
      {tasks.length > 0 && (
        <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--border-subtle, #e8e8e8)' }}>
          <div className="text-[9px] mb-1.5" style={{ color: '#c8a882', letterSpacing: '0.25em' }}>
            TASKS · {tasks.filter((t) => t.status === 'done').length}/{tasks.length}
          </div>
          <div className="space-y-1">
            {tasks.map((t, i) => {
              const tDone = t.status === 'done'
              const tRunning = t.status === 'running'
              const tFailed = t.status === 'failed'
              return (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: tDone ? '#7bc47f' : tFailed ? '#b27c8b' : tRunning ? '#c8a882' : '#ddd',
                      animation: tRunning ? 'htmlpage-pulse 1.2s ease-in-out infinite' : 'none',
                    }}
                  />
                  <span
                    style={{
                      color: tDone ? 'var(--text-muted, #555)' : tFailed ? '#7a3a4a' : 'var(--text-primary, #1a1a1a)',
                      textDecoration: tDone ? 'line-through' : 'none',
                      opacity: tDone ? 0.55 : 1,
                    }}
                  >
                    {t.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* === 主内容区 === */}
      <div className="relative" style={{ height: fullscreen ? 640 : 360, background: '#fff' }}>
        {status === 'pending' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[11px]" style={{ color: 'var(--text-muted, #888)' }}>
            <div className="text-[9px] mb-2" style={{ color: '#c8a882', letterSpacing: '0.3em' }}>WAITING</div>
            排队中…
          </div>
        )}
        {status === 'running' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[9px] mb-3" style={{ color: '#c8a882', letterSpacing: '0.3em' }}>GENERATING</div>
            <div className="flex gap-1.5 mb-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block w-2 h-2 rounded-full"
                  style={{
                    background: '#c8a882',
                    animation: `htmlpage-bounce 1.2s ease-in-out ${i * 0.16}s infinite`,
                  }}
                />
              ))}
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted, #888)' }}>
              {mode === 'hermes' ? 'Hermes worker 跑中…' : 'LLM 思考中…'}
            </div>
          </div>
        )}
        {status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[11px] px-6">
            <div className="text-[9px] mb-2" style={{ color: '#7a3a4a', letterSpacing: '0.3em' }}>FAILED</div>
            <div className="text-center mb-3" style={{ color: '#7a3a4a' }}>{error || '生成失败'}</div>
            <button
              onClick={onRetry}
              className="text-[10px] px-3 py-1 rounded-sm border"
              style={{ borderColor: '#b27c8b', color: '#7a3a4a', background: 'rgba(245,235,237,0.6)' }}
            >
              重试
            </button>
          </div>
        )}
        {status === 'done' && html && (
          <iframe
            srcDoc={html}
            sandbox="allow-popups"
            title={`html-page-${id}`}
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
            // 节点不可拖动 iframe 区域时, 用 pointer-events 控制 — 这里允许 iframe 内交互, 拖节点请抓 header
          />
        )}
      </div>

      {/* === 决策引擎 verdict 块 (done + 有 decision 时显示) === */}
      {status === 'done' && decision && vmeta && (
        <div
          className="px-4 py-2.5"
          style={{ borderTop: '1px solid var(--border-subtle, #e8e8e8)', background: vmeta.bg }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px]" style={{ color: vmeta.color, letterSpacing: '0.3em', fontWeight: 600 }}>
              VERDICT · {vmeta.label}
            </span>
            <span
              className="text-[9px] ml-auto px-1.5 py-0.5 rounded-sm"
              style={{ color: vmeta.color, border: `1px solid ${vmeta.color}55`, fontVariantNumeric: 'tabular-nums' }}
            >
              {decision.score}/100
            </span>
          </div>
          {decision.summary && (
            <div className="text-[11px] mb-1.5" style={{ color: 'var(--text-primary, #1a1a1a)', fontFamily: 'var(--font-serif), Georgia, serif' }}>
              {decision.summary}
            </div>
          )}
          {decision.next_steps?.length > 0 && (
            <div className="mt-1.5">
              <div className="text-[9px] mb-0.5" style={{ color: vmeta.color, letterSpacing: '0.25em' }}>NEXT</div>
              {decision.next_steps.slice(0, 3).map((s, i) => (
                <div key={i} className="text-[10px] leading-snug" style={{ color: 'var(--text-muted, #555)' }}>
                  · {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* === 底部操作条 (done 才显示) === */}
      {status === 'done' && (
        <div
          className="px-4 py-1.5 flex items-center justify-between"
          style={{ borderTop: '1px solid var(--border-subtle, #e8e8e8)' }}
        >
          <span className="text-[9px] flex items-center gap-2" style={{ color: 'var(--text-faint, #bbb)', letterSpacing: '0.2em' }}>
            <span>{(html.length / 1024).toFixed(1)} KB · {mode === 'hermes' ? 'hermes' : 'meta'}</span>
            {libraryId && (
              <span style={{ color: '#7bc47f' }} title="已入项目库">✓ 已入库</span>
            )}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onCopy}
              className="text-[10px] hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-muted, #555)' }}
              title="复制 HTML 源码"
            >
              复制
            </button>
            <button
              onClick={onRetry}
              className="text-[10px] hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-muted, #555)' }}
              title="重新生成"
            >
              重新生成
            </button>
            <button
              onClick={onToggleFullscreen}
              className="text-[10px] hover:opacity-70 transition-opacity"
              style={{ color: '#c8a882' }}
              title="切换大尺寸"
            >
              {fullscreen ? '收起' : '展开'}
            </button>
          </div>
        </div>
      )}

      {/* 节点级 keyframes (注入一次, React 多次挂载也只会被浏览器去重一次) */}
      <style>{`
        @keyframes htmlpage-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.8); }
        }
        @keyframes htmlpage-shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes htmlpage-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50%      { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

const HtmlPageNode = memo(HtmlPageNodeImpl)
export default HtmlPageNode
