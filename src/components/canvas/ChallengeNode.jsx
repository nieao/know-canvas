/**
 * ChallengeNode — Aletheia 反驳节点 (Devil's Advocate)
 *
 * 由 OntologyNode 的"反驳 ⚔"按钮触发, 自动建在源节点右侧.
 * 显示:
 *   - 攻击角度 (6 类: 资源短缺/外部风险/逻辑矛盾/反例/逆向激励/二阶效应)
 *   - claim 反驳论点
 *   - severity 严重度 (high/medium/low → 红/黄/灰)
 *
 * 不可编辑 (read-only), 用户用它来收敛/修正源节点.
 */

import { memo } from 'react'
import { Handle, Position } from 'reactflow'

// severity 色 (语义色: 严重度色板, 跨主题保持语义)
const SEVERITY_META = {
  high:   { label: '严重', color: '#b27c8b', bg: '#fbf1f3' },        // severity-high 粉灰
  medium: { label: '中等', color: 'var(--accent)', bg: 'var(--accent-bg)' },  // severity-medium = accent
  low:    { label: '轻微', color: 'var(--text-muted)', bg: 'var(--border-subtle)' },
}

function ChallengeNodeImpl({ id, data, selected }) {
  const angle = data.angle || '反驳'
  const claim = data.claim || ''
  const severity = data.severity || 'medium'
  const sourceTitle = data.source_title || ''
  const meta = SEVERITY_META[severity] || SEVERITY_META.medium
  const evidence = Array.isArray(data.evidence) ? data.evidence : []
  const todos = Array.isArray(data.todos) ? data.todos : []
  const chainRunning = data.chainRunning === true
  const verifyRunning = data.verifyRunning === true
  const verification = data.verification || null  // { score, verdict, reason }

  const onChainTodos = (e) => {
    e.stopPropagation()
    if (chainRunning || todos.length === 0) return
    window.dispatchEvent(new CustomEvent('challenge:chain-todos', {
      detail: { challengeId: id, todos, claim, sourceTitle },
    }))
  }

  const onVerify = (e) => {
    e.stopPropagation()
    if (verifyRunning) return
    window.dispatchEvent(new CustomEvent('challenge:verify-hermes', {
      detail: { challengeId: id, claim, angle, severity, sourceTitle },
    }))
  }

  return (
    <div
      className="relative shadow-sm transition-all duration-300"
      style={{
        width: 280,
        background: 'var(--surface)',
        border: `${selected ? '2px' : '1px'} solid ${meta.color}`,
        borderRadius: 4,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: meta.color }} />
      <Handle type="target" position={Position.Top} style={{ background: meta.color }} />
      <Handle type="source" position={Position.Right} style={{ background: meta.color }} />
      <Handle type="source" position={Position.Bottom} style={{ background: meta.color }} />

      {/* 顶部色条 */}
      <div style={{ height: 3, background: meta.color }} />

      <div className="px-3 py-2.5">
        {/* 顶部标签行 */}
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-[9px] font-semibold"
            style={{ color: meta.color, letterSpacing: '0.2em' }}
          >
            ⚔ DEVIL'S ADVOCATE
          </span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-sm"
            style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.color}` }}
          >
            {meta.label}
          </span>
        </div>

        {/* 攻击角度 */}
        <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
          {angle}
        </div>

        {/* 反驳论点 */}
        <div
          className="text-[11px] leading-relaxed italic mb-2"
          style={{ color: 'var(--text-secondary)', borderLeft: `2px solid ${meta.color}`, paddingLeft: 8 }}
        >
          “{claim}”
        </div>

        {/* 论据列表 (evidence) - 分项展开 */}
        {evidence.length > 0 && (
          <div className="mt-2 mb-1">
            <div
              className="text-[9px] mb-1"
              style={{ color: meta.color, letterSpacing: '0.18em', fontWeight: 600 }}
            >
              论据 · EVIDENCE
            </div>
            <ul className="space-y-1">
              {evidence.map((e, i) => (
                <li
                  key={i}
                  className="text-[10px] leading-snug pl-2"
                  style={{ color: 'var(--text-secondary)', borderLeft: '2px solid var(--border-subtle)' }}
                >
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 待办事项 (todos) - 分项 checkbox 风格 + 下一步按钮 */}
        {todos.length > 0 && (
          <div className="mt-2.5 pt-2" style={{ borderTop: `1px dashed ${meta.color}40` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span
                className="text-[9px]"
                style={{ color: meta.color, letterSpacing: '0.18em', fontWeight: 600 }}
              >
                待办 · TODO
              </span>
              <button
                type="button"
                onClick={onChainTodos}
                disabled={chainRunning}
                className="text-[9px] px-2 py-0.5 rounded transition-all duration-300"
                style={{
                  border: `1px solid ${meta.color}`,
                  color: chainRunning ? 'var(--text-faint)' : meta.color,
                  background: 'transparent',
                  cursor: chainRunning ? 'wait' : 'pointer',
                  letterSpacing: '0.1em',
                  fontWeight: 500,
                }}
                title="把这些待办派给 LLM 继续规划成下一轮可执行任务"
              >
                {chainRunning ? '规划中…' : '下一步 ▸'}
              </button>
            </div>
            <ul className="space-y-1">
              {todos.map((t, i) => (
                <li
                  key={i}
                  className="text-[10px] leading-snug flex items-start gap-1.5"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <span style={{ color: meta.color, fontWeight: 700, flexShrink: 0 }}>›</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* === 二次验证: Hermes sanity check === */}
        {/* 让 LLM 做"反思"判断这个反驳是否切合实际 (用户图 43 反馈反驳脱离实际, 比如说 PDF 超 1GB) */}
        <div className="mt-2.5 pt-2" style={{ borderTop: `1px dashed ${meta.color}30` }}>
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[9px]"
              style={{ color: 'var(--text-muted)', letterSpacing: '0.15em' }}
            >
              {verification ? `验证 · ${verification.verdict || '已审'}` : '反驳是否成立?'}
            </span>
            <button
              type="button"
              onClick={onVerify}
              disabled={verifyRunning}
              className="text-[9px] px-2 py-0.5 rounded transition-all duration-300"
              style={{
                border: '1px solid var(--accent)',
                color: verifyRunning ? 'var(--text-faint)' : 'var(--accent)',
                background: verification ? 'var(--accent-bg, rgba(245,240,235,0.4))' : 'transparent',
                cursor: verifyRunning ? 'wait' : 'pointer',
                letterSpacing: '0.05em',
              }}
              title="让 LLM 二次审查这个反驳: 是否切合实际, 给可信度评分"
            >
              {verifyRunning ? '审中…' : verification ? '重审' : '⚖ 二次验证'}
            </button>
          </div>
          {verification && (
            <div className="mt-1.5 p-1.5 rounded" style={{
              background: verification.score >= 70 ? 'rgba(123,196,127,0.08)' : verification.score >= 40 ? 'rgba(200,168,130,0.08)' : 'rgba(178,124,139,0.08)',
              border: `1px solid ${verification.score >= 70 ? '#7bc47f55' : verification.score >= 40 ? '#c8a88255' : '#b27c8b55'}`,
            }}>
              <div className="flex items-center gap-1.5" style={{ marginBottom: 3 }}>
                <span style={{
                  fontSize: 12,
                  fontFamily: '"Noto Serif SC", Georgia, serif',
                  color: verification.score >= 70 ? '#3a8a3e' : verification.score >= 40 ? 'var(--accent)' : '#7a3a4a',
                  fontWeight: 600,
                }}>{Math.round(verification.score)}</span>
                <span style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.15em' }}>可信度 / 100</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {verification.reason}
              </div>
            </div>
          )}
        </div>

        {/* 攻击对象 (源节点) */}
        {sourceTitle && (
          <div className="text-[9px] mt-2.5 pt-1.5" style={{ color: 'var(--text-muted)', borderTop: '1px dashed var(--border-subtle)' }}>
            针对: <span className="font-medium" style={{ color: 'var(--text-muted)' }}>{sourceTitle}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(ChallengeNodeImpl)
