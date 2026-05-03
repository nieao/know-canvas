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

function ChallengeNodeImpl({ data, selected }) {
  const angle = data.angle || '反驳'
  const claim = data.claim || ''
  const severity = data.severity || 'medium'
  const sourceTitle = data.source_title || ''
  const meta = SEVERITY_META[severity] || SEVERITY_META.medium
  const evidence = Array.isArray(data.evidence) ? data.evidence : []
  const todos = Array.isArray(data.todos) ? data.todos : []

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

        {/* 待办事项 (todos) - 分项 checkbox 风格 */}
        {todos.length > 0 && (
          <div className="mt-2.5 pt-2" style={{ borderTop: `1px dashed ${meta.color}40` }}>
            <div
              className="text-[9px] mb-1.5"
              style={{ color: meta.color, letterSpacing: '0.18em', fontWeight: 600 }}
            >
              待办 · TODO
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
