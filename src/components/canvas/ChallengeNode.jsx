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

const SEVERITY_META = {
  high:   { label: '严重', color: '#b27c8b', bg: '#fbf1f3' },
  medium: { label: '中等', color: '#c8a882', bg: '#f5f0eb' },
  low:    { label: '轻微', color: '#888',    bg: '#f5f5f5' },
}

function ChallengeNodeImpl({ data, selected }) {
  const angle = data.angle || '反驳'
  const claim = data.claim || ''
  const severity = data.severity || 'medium'
  const sourceTitle = data.source_title || ''
  const meta = SEVERITY_META[severity] || SEVERITY_META.medium

  return (
    <div
      className="relative shadow-sm transition-all duration-300"
      style={{
        width: 240,
        background: '#fafafa',
        border: `${selected ? '2px' : '1px'} solid ${meta.color}`,
        borderRadius: 4,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: meta.color }} />

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
        <div className="text-[11px] font-medium mb-1.5" style={{ color: '#1a1a1a' }}>
          {angle}
        </div>

        {/* 反驳论点 */}
        <div
          className="text-[11px] leading-relaxed italic"
          style={{ color: '#3a3a3a', borderLeft: `2px solid ${meta.color}`, paddingLeft: 8 }}
        >
          “{claim}”
        </div>

        {/* 攻击对象 (源节点) */}
        {sourceTitle && (
          <div className="text-[9px] mt-2 pt-1.5" style={{ color: '#888', borderTop: '1px dashed #e8e8e8' }}>
            针对: <span className="font-medium" style={{ color: '#555' }}>{sourceTitle}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(ChallengeNodeImpl)
