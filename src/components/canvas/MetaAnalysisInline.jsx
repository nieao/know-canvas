/**
 * MetaAnalysisInline — 节点内 inline 元认知分析折叠区
 *
 * 5 维度结构化展示:
 *   - 核心意图 (1 句)
 *   - 隐含目标 (2-3 条)
 *   - 关键风险 (2-3 条, 粉灰警示色)
 *   - 前置依赖 (2-3 条)
 *   - 下一步行动 (1-3 条, 有序列表)
 *
 * 由 OntologyNode + ConceptNode + 组合分析节点共用.
 *
 * Props:
 *   - analysis: { core_intent, implicit_goals, key_risks, dependencies, next_actions }
 *   - textColor: 文字主色 (跟随节点 variant 配色)
 *   - onReanalyze: 重跑回调
 *   - isAnalyzing: 是否正在重跑 (loading)
 */

import { memo } from 'react'

function MetaAnalysisInlineImpl({ analysis, textColor = 'var(--text-primary)', onReanalyze, isAnalyzing = false }) {
  if (!analysis) return null

  return (
    <div className="mt-3 pt-2" style={{ borderTop: '1px dashed var(--border-subtle)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-semibold" style={{ color: 'var(--accent)', letterSpacing: '0.2em' }}>
          META-COGNITIVE
        </span>
        {onReanalyze && (
          <button
            onClick={onReanalyze}
            disabled={isAnalyzing}
            className="text-[9px] underline"
            style={{ color: 'var(--text-muted)', cursor: isAnalyzing ? 'wait' : 'pointer' }}
            title="重新分析"
          >
            {isAnalyzing ? '...' : '↻ 重跑'}
          </button>
        )}
      </div>

      {analysis.core_intent && (
        <div className="mb-2">
          <div className="text-[9px] font-medium mb-0.5" style={{ color: 'var(--accent)' }}>核心意图</div>
          <div className="text-[11px] leading-relaxed" style={{ color: textColor }}>{analysis.core_intent}</div>
        </div>
      )}

      {analysis.implicit_goals?.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] font-medium mb-0.5" style={{ color: 'var(--accent)' }}>隐含目标</div>
          <ul className="text-[10.5px] leading-snug pl-3" style={{ color: textColor, opacity: 0.85, listStyleType: 'disc' }}>
            {analysis.implicit_goals.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      )}

      {analysis.key_risks?.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] font-medium mb-0.5" style={{ color: '#7a3a4a' }}>关键风险</div>
          <ul className="text-[10.5px] leading-snug pl-3" style={{ color: textColor, opacity: 0.85, listStyleType: 'disc' }}>
            {analysis.key_risks.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {analysis.dependencies?.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] font-medium mb-0.5" style={{ color: 'var(--accent)' }}>前置依赖</div>
          <ul className="text-[10.5px] leading-snug pl-3" style={{ color: textColor, opacity: 0.85, listStyleType: 'disc' }}>
            {analysis.dependencies.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}

      {analysis.next_actions?.length > 0 && (
        <div>
          <div className="text-[9px] font-medium mb-0.5" style={{ color: 'var(--accent)' }}>下一步行动</div>
          <ol className="text-[10.5px] leading-snug pl-3" style={{ color: textColor, listStyleType: 'decimal' }}>
            {analysis.next_actions.map((a, i) => <li key={i}>{a}</li>)}
          </ol>
        </div>
      )}
    </div>
  )
}

export default memo(MetaAnalysisInlineImpl)
