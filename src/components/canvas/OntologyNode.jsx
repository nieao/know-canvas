/**
 * OntologyNode — Aletheia 本体节点
 *
 * 4 种 variant (从飞书 wiki Aletheia 设计):
 *   - goal:        顶层目标 (黑底 + 暖色边)
 *   - entity:      核心实体 (白底 + 暖色细线)
 *   - constraint:  硬约束 (暖色背景 + 重边)
 *   - assumption:  隐含假设 (灰背景 + 虚线, 等待验证)
 *
 * 每个非 goal 节点底部 3 个推进按钮 (1x3 网格):
 *   - "🔧 拆解"   → 节点级二次拆解, 长出 3-5 个子 entity 节点
 *   - "⚡ 元认知" → 一次 LLM 调用 → 5 维度 inline 分析
 *   - "⚔ 反驳"   → 调反驳引擎生成 ChallengeNode (Devil's Advocate)
 *
 * 派 Hermes 已下沉到 BottomAIBar 的 Hermes 模式 — 一句话直接派单, 节点上不再展示按钮.
 * 节点级任务进行状态条聚合显示当前活跃 LLM 操作 (拆解/分析/反驳), 带 shimmer + pulse 动画.
 */

import { memo, useState } from 'react'
import { Handle, Position, useReactFlow } from 'reactflow'
import useCanvasStore from '../../stores/useCanvasStore'
import MetaAnalysisInline from './MetaAnalysisInline'

const VARIANT_META = {
  goal: {
    label: 'GOAL',
    bg: 'var(--text-primary)',     // 反色深底, 跟随主题切换
    color: 'var(--surface)',
    border: 'var(--accent)',
    accent: 'var(--accent)',
    width: 280,
  },
  entity: {
    label: 'ENTITY',
    bg: 'var(--surface)',
    color: 'var(--text-primary)',
    border: 'var(--border-subtle)',
    accent: 'var(--accent)',
    width: 220,
  },
  constraint: {
    label: 'CONSTRAINT',
    bg: 'var(--accent-bg)',
    color: 'var(--text-primary)',
    border: 'var(--accent)',
    accent: 'var(--accent)',
    width: 220,
  },
  assumption: {
    label: 'ASSUMPTION',
    bg: 'var(--surface)',
    color: 'var(--text-muted)',
    border: 'var(--text-faint)',
    borderStyle: 'dashed',
    accent: 'var(--text-muted)',
    width: 220,
  },
}

// ALETHEIA 项目模式 6-stage timeline — 仅当 data.projectStage 存在时, 在 goal 节点内部渲染
const PROJECT_STAGES = [
  { id: 'CONTEXT',    label: '语境' },
  { id: 'DECOMPOSE',  label: '拆解' },
  { id: 'EMERGE',     label: '涌现' },
  { id: 'TOPOLOGY',   label: '拓扑' },
  { id: 'EXECUTE',    label: '执行' },
  { id: 'REFLECT',    label: '反思' },
]

function ProjectStageTimeline({ currentStage, status, rootId }) {
  // status = 'running' | 'done' | 'failed' — done 时所有点变绿
  const currentIdx = PROJECT_STAGES.findIndex((s) => s.id === currentStage)
  const allDone = status === 'done'
  const rf = useReactFlow()

  // 点击 done 的 stage → 跳到该 stage 创建的节点
  // 映射: CONTEXT/REFLECT → root 节点; DECOMPOSE → 第一个 task; EMERGE/EXECUTE → 第一个 agent; TOPOLOGY → 居中所有节点
  const onStageClick = (stageId, isClickable) => {
    if (!isClickable || !rf || !rootId) return
    const allNodes = rf.getNodes ? rf.getNodes() : []
    let target = null
    if (stageId === 'CONTEXT' || stageId === 'REFLECT') {
      target = allNodes.find((n) => n.id === rootId)
    } else if (stageId === 'DECOMPOSE') {
      target = allNodes.find((n) => n.id.startsWith(`task-${rootId}-`)) || allNodes.find((n) => n.id.startsWith('task-'))
    } else if (stageId === 'EMERGE' || stageId === 'EXECUTE') {
      target = allNodes.find((n) => n.id.startsWith(`agent-${rootId}-`)) || allNodes.find((n) => n.type === 'agentRoleNode')
    } else if (stageId === 'TOPOLOGY') {
      // 居中显示所有 task + agent + root
      const stageNodes = allNodes.filter((n) =>
        n.id === rootId
        || n.id.startsWith(`task-${rootId}-`)
        || n.id.startsWith(`agent-${rootId}-`)
      )
      if (stageNodes.length && rf.fitView) {
        rf.fitView({ nodes: stageNodes, duration: 600, padding: 0.2 })
        return
      }
    }
    if (target && rf.setCenter) {
      rf.setCenter(target.position.x + 110, target.position.y + 80, { zoom: 1.2, duration: 600 })
    }
  }

  return (
    <div
      className="mt-2.5 -mx-1 px-1 py-2 rounded-sm"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="flex items-center justify-between" style={{ position: 'relative' }}>
        {/* 底部连线 */}
        <div
          style={{
            position: 'absolute',
            left: 6,
            right: 6,
            top: 4,
            height: 1,
            background: 'rgba(255,255,255,0.12)',
            zIndex: 0,
          }}
        />
        {PROJECT_STAGES.map((s, i) => {
          const isDone = allDone || i < currentIdx
          const isCurrent = !allDone && i === currentIdx
          const isClickable = isDone || isCurrent
          const dotColor = isDone ? '#7bc47f' : isCurrent ? 'var(--accent, #c8a882)' : 'rgba(255,255,255,0.3)'
          return (
            <div
              key={s.id}
              onClick={(e) => {
                e.stopPropagation()
                onStageClick(s.id, isClickable)
              }}
              title={isClickable ? `跳到 ${s.label} 阶段相关节点` : `${s.label} 阶段未完成`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                position: 'relative',
                zIndex: 1,
                flex: 1,
                cursor: isClickable ? 'pointer' : 'default',
                padding: '2px 0',
                borderRadius: 3,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => { if (isClickable) e.currentTarget.style.background = 'rgba(200,168,130,0.12)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: dotColor,
                  border: isCurrent ? '1px solid var(--accent, #c8a882)' : 'none',
                  boxShadow: isCurrent ? '0 0 0 3px rgba(200,168,130,0.25)' : 'none',
                  animation: isCurrent ? 'project-stage-pulse 1.4s ease-in-out infinite' : 'none',
                }}
              />
              <span
                style={{
                  fontSize: 7,
                  letterSpacing: '0.15em',
                  color: isCurrent ? 'var(--accent, #c8a882)' : isDone ? '#7bc47f' : 'rgba(255,255,255,0.45)',
                  fontWeight: isCurrent ? 600 : 400,
                }}
              >
                {s.id}
              </span>
            </div>
          )
        })}
      </div>
      <style>{`
        @keyframes project-stage-pulse {
          0%, 100% { transform: scale(1);   box-shadow: 0 0 0 3px rgba(200,168,130,0.25); }
          50%      { transform: scale(1.3); box-shadow: 0 0 0 5px rgba(200,168,130,0.10); }
        }
      `}</style>
    </div>
  )
}

// 决策块 (verdict) — 项目完成后, 在 goal 节点内 inline 显示, 复用 HtmlPageNode 的视觉
const VERDICT_META = {
  go:    { color: '#7bc47f', bg: 'rgba(123,196,127,0.16)', label: 'GO · 推进' },
  hold:  { color: '#c8a882', bg: 'rgba(200,168,130,0.18)', label: 'HOLD · 暂缓' },
  pivot: { color: '#b27c8b', bg: 'rgba(178,124,139,0.18)', label: 'PIVOT · 转向' },
}

function ProjectDecisionInline({ decision, profile }) {
  const vmeta = decision?.verdict ? VERDICT_META[decision.verdict] : null
  if (!vmeta) return null
  return (
    <div
      className="mt-2 px-2 py-2 rounded-sm"
      style={{
        background: vmeta.bg,
        borderLeft: `2px solid ${vmeta.color}`,
      }}
    >
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 9, letterSpacing: '0.25em', color: vmeta.color, fontWeight: 600 }}>
          {vmeta.label}
        </span>
        {typeof decision.score === 'number' && (
          <span style={{ fontSize: 10, color: vmeta.color, fontWeight: 500 }}>
            {decision.score}/100
          </span>
        )}
      </div>
      {decision.summary && (
        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'inherit', opacity: 0.9, marginTop: 4 }}>
          {decision.summary}
        </div>
      )}
      {profile?.domain && (
        <div style={{ fontSize: 9, marginTop: 4, opacity: 0.55, letterSpacing: '0.1em' }}>
          领域: {profile.domain} · 复杂度: {profile.complexity}
        </div>
      )}
    </div>
  )
}

function OntologyNodeImpl({ id, data, selected }) {
  // 派 Hermes 已下沉到 BottomAIBar 的 Hermes 模式 — 节点上不再单独按钮
  const challenge = useCanvasStore((s) => s.dispatchChallenge)
  const decomposeFurther = useCanvasStore((s) => s.decomposeOntologyFurther)
  const analyzeMeta = useCanvasStore((s) => s.analyzeNodeMetaCognitive)
  const updateNode = useCanvasStore((s) => s.updateNode)

  const variant = data.variant || 'entity'
  const meta = VARIANT_META[variant] || VARIANT_META.entity
  const title = data.title || ''
  const description = data.description || ''
  const isChallenging = data.challenging === true
  // 拆解 用本地 state 即可 (不需要持久化 — 失败可以重试, 成功后子节点已落地)
  const [isDecomposing, setIsDecomposing] = useState(false)
  // 元认知状态来自 data — analyzing/分析完后的结果都要持久化 + yjs 同步
  const isAnalyzing = data.metaAnalyzing === true
  const metaAnalysis = data.metaAnalysis
  const metaError = data.metaAnalysisError
  const metaExpanded = data.metaExpanded === true

  const onChallenge = (e) => {
    e.stopPropagation()
    if (isChallenging) return
    updateNode(id, { challenging: true })
    challenge(id)
      .catch((err) => console.error('[OntologyNode] challenge failed:', err))
      .finally(() => updateNode(id, { challenging: false }))
  }

  const onDecompose = (e) => {
    e.stopPropagation()
    if (isDecomposing || !title.trim()) return
    setIsDecomposing(true)
    decomposeFurther(id)
      .catch((err) => console.error('[OntologyNode] decompose failed:', err))
      .finally(() => setIsDecomposing(false))
  }

  const onAnalyzeMeta = (e) => {
    e.stopPropagation()
    if (isAnalyzing || !title.trim()) return
    // 已经分析过 → 切换折叠/展开
    if (metaAnalysis) {
      updateNode(id, { metaExpanded: !metaExpanded })
      return
    }
    // 没分析过 → 调 LLM, 完成后 store action 自动 set metaExpanded: true
    analyzeMeta(id).catch((err) => console.error('[OntologyNode] analyze failed:', err))
  }

  const onToggleMetaExpand = (e) => {
    e.stopPropagation()
    updateNode(id, { metaExpanded: !metaExpanded })
  }

  const onReanalyze = (e) => {
    e.stopPropagation()
    if (isAnalyzing) return
    analyzeMeta(id).catch((err) => console.error('[OntologyNode] reanalyze failed:', err))
  }

  // 项目根节点 (goal) 在 6-stage 跑的时候属于"running 项目状态" — 也算正在跑
  const isProjectRunning = variant === 'goal' && data.projectStatus === 'running'
  const isLoading = isDecomposing || isAnalyzing || isChallenging || isProjectRunning

  return (
    <div
      className="relative shadow-sm transition-all duration-300"
      style={{
        width: meta.width,
        background: meta.bg,
        color: meta.color,
        border: `${selected ? '2px' : '1px'} ${meta.borderStyle || 'solid'} ${selected ? 'var(--accent)' : meta.border}`,
        borderRadius: 4,
        boxShadow: isLoading
          ? '0 0 0 2px rgba(200,168,130,0.18), 0 0 20px rgba(200,168,130,0.32)'
          : undefined,
        animation: isLoading ? 'ontology-loading-glow 2.4s ease-in-out infinite' : undefined,
      }}
    >
      {isLoading && (
        <style>{`
          @keyframes ontology-loading-glow {
            0%, 100% { box-shadow: 0 0 0 2px rgba(200,168,130,0.18), 0 0 20px rgba(200,168,130,0.32); }
            50%      { box-shadow: 0 0 0 3px rgba(200,168,130,0.30), 0 0 32px rgba(200,168,130,0.50); }
          }
        `}</style>
      )}
      <Handle type="target" position={Position.Top} style={{ background: meta.accent }} />
      <Handle type="source" position={Position.Bottom} style={{ background: meta.accent }} />

      <div className="px-4 py-3">
        {/* 顶部标签 */}
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-[9px] font-semibold"
            style={{ color: meta.accent, letterSpacing: '0.25em' }}
          >
            {meta.label}
          </span>
          <div className="flex items-center gap-1.5">
            {data.createdBy?.name && (
              <span
                title={`由 ${data.createdBy.name} 创建`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                style={{
                  background: `${data.createdBy.color || '#888'}1a`,
                  border: `1px solid ${data.createdBy.color || '#888'}66`,
                  color: data.createdBy.color || '#888',
                  fontSize: 9,
                  letterSpacing: '0.05em',
                  lineHeight: 1.2,
                  maxWidth: 90,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: data.createdBy.color || '#888',
                  }}
                />
                {data.createdBy.name}
              </span>
            )}
            {variant === 'assumption' && (
              <span className="text-[9px]" style={{ color: meta.accent }}>未验证</span>
            )}
          </div>
        </div>

        {/* 标题 */}
        <input
          type="text"
          className="w-full text-sm font-medium bg-transparent border-none outline-none"
          style={{ color: meta.color, fontFamily: variant === 'goal' ? 'var(--font-serif), Georgia, serif' : 'inherit' }}
          placeholder="节点标题…"
          value={title}
          onChange={(e) => updateNode(id, { title: e.target.value })}
        />

        {/* 描述 */}
        {description && (
          <div className="text-[11px] mt-1.5 leading-relaxed" style={{ color: meta.color, opacity: 0.7 }}>
            {description}
          </div>
        )}

        {/* 推进按钮 — 派 Hermes 已下沉到底部 BottomAIBar (Hermes 模式), 节点上不再展示.
            保留 3 个本节点级动作: 拆解 / 元认知 / 反驳, 1 行 3 列 */}
        {variant !== 'goal' && (
          <div className="grid grid-cols-3 gap-1.5 mt-3">
            <button
              onClick={onDecompose}
              disabled={!title.trim() || isDecomposing}
              className="text-[10px] py-1 px-2 rounded-sm border transition-all"
              style={{
                borderColor: title.trim() ? 'var(--accent-soft, var(--accent))' : 'var(--border-subtle)',
                color: title.trim() ? 'var(--accent)' : 'var(--text-faint)',
                background: title.trim() ? 'var(--accent-bg, rgba(245,240,235,0.4))' : 'transparent',
                cursor: title.trim() && !isDecomposing ? 'pointer' : 'not-allowed',
                opacity: isDecomposing ? 0.6 : 1,
              }}
              title="把这个节点再拆成 3-5 个子实体"
            >
              {isDecomposing ? '拆解中' : '🔧 拆解'}
            </button>
            <button
              onClick={onAnalyzeMeta}
              disabled={!title.trim() || isAnalyzing}
              className="text-[10px] py-1 px-2 rounded-sm border transition-all"
              style={{
                borderColor: title.trim() ? (metaAnalysis ? 'var(--accent)' : 'var(--accent-soft, var(--accent))') : 'var(--border-subtle)',
                color: title.trim() ? 'var(--accent)' : 'var(--text-faint)',
                background: metaAnalysis
                  ? 'var(--accent-bg, rgba(245,240,235,0.7))'
                  : (title.trim() ? 'var(--accent-bg, rgba(245,240,235,0.4))' : 'transparent'),
                cursor: title.trim() && !isAnalyzing ? 'pointer' : 'not-allowed',
                opacity: isAnalyzing ? 0.6 : 1,
                fontWeight: metaAnalysis ? 500 : 400,
              }}
              title={
                isAnalyzing ? '正在分析中…' :
                metaAnalysis ? `点击${metaExpanded ? '收起' : '展开'}元认知分析` :
                '一次 LLM 调用 → 5 维度分析 (意图/隐含目标/风险/依赖/下一步)'
              }
            >
              {isAnalyzing ? '分析中' : metaAnalysis ? `⚡ ${metaExpanded ? '▴' : '▾'}` : '⚡ 元认知'}
            </button>
            <button
              onClick={onChallenge}
              disabled={!title.trim() || isChallenging}
              className="text-[10px] py-1 px-2 rounded-sm border transition-all"
              style={{
                borderColor: title.trim() ? '#c2392f' : 'var(--border-subtle)',
                color: title.trim() ? '#ffffff' : 'var(--text-faint)',
                background: title.trim() ? '#d04a4a' : 'transparent',
                cursor: title.trim() && !isChallenging ? 'pointer' : 'not-allowed',
                fontWeight: 600,
                letterSpacing: '0.05em',
                boxShadow: title.trim() ? '0 1px 2px rgba(208,74,74,0.25)' : 'none',
              }}
              onMouseEnter={(e) => {
                if (!title.trim() || isChallenging) return
                e.currentTarget.style.background = '#b03838'
              }}
              onMouseLeave={(e) => {
                if (!title.trim() || isChallenging) return
                e.currentTarget.style.background = '#d04a4a'
              }}
              title="生成 Devil's Advocate 反驳论点 — 调 LLM 推导"
            >
              {isChallenging ? '反驳中…' : '⚔ 反驳'}
            </button>
          </div>
        )}

        {/* 节点级任务进行状态条 — 任意 LLM 操作进行中时聚合显示, 带 shimmer 动画 */}
        {(isDecomposing || isAnalyzing || isChallenging) && (
          <div className="mt-2.5 -mx-4">
            <div
              className="relative overflow-hidden h-[2px]"
              style={{ background: 'rgba(200,168,130,0.14)' }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(90deg, transparent 0%, var(--accent, #c8a882) 50%, transparent 100%)',
                  animation: 'ontology-shimmer 1.6s linear infinite',
                }}
              />
            </div>
            <div className="px-4 pt-1.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px]" style={{ color: 'var(--accent, #c8a882)', letterSpacing: '0.25em' }}>
                TASKS
              </span>
              {isDecomposing && (
                <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-muted, #555)' }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent, #c8a882)', animation: 'ontology-pulse 1.2s ease-in-out infinite' }} />
                  拆解中
                </span>
              )}
              {isAnalyzing && (
                <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-muted, #555)' }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent, #c8a882)', animation: 'ontology-pulse 1.2s ease-in-out infinite' }} />
                  元认知分析中
                </span>
              )}
              {isChallenging && (
                <span className="text-[10px] flex items-center gap-1" style={{ color: '#7a3a4a' }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#b27c8b', animation: 'ontology-pulse 1.2s ease-in-out infinite' }} />
                  反驳生成中
                </span>
              )}
            </div>
            <style>{`
              @keyframes ontology-pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50%      { opacity: 0.4; transform: scale(0.7); }
              }
              @keyframes ontology-shimmer {
                0%   { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
              }
            `}</style>
          </div>
        )}

        {/* ALETHEIA 项目模式 — 6 stage timeline (仅 goal 节点 + data.projectStage 存在时渲染) */}
        {variant === 'goal' && data.projectStage && (
          <ProjectStageTimeline
            currentStage={data.projectStage}
            status={data.projectStatus || 'running'}
            rootId={id}
          />
        )}

        {/* ALETHEIA 项目模式 — 决策结果块 (REFLECT 完成后) */}
        {variant === 'goal' && data.decision && (
          <ProjectDecisionInline decision={data.decision} profile={data.project_profile} />
        )}

        {/* ALETHEIA 项目模式 — 失败提示 */}
        {variant === 'goal' && data.projectStatus === 'failed' && data.error && (
          <div
            className="mt-2 px-2 py-1.5 rounded-sm text-[10px]"
            style={{
              background: 'rgba(178,124,139,0.18)',
              borderLeft: '2px solid #b27c8b',
              color: '#f0d4d8',
              lineHeight: 1.4,
            }}
          >
            项目拆解失败: {data.error}
          </div>
        )}

        {/* goal 节点显示提示 (项目模式不显示这条, 因为有 timeline) */}
        {variant === 'goal' && !data.projectStage && (
          <div className="text-[10px] mt-2 opacity-50" style={{ color: meta.color }}>
            ↓ 已自动拆解 · 点下方节点上的按钮继续推进
          </div>
        )}

        {/* 元认知错误显示 */}
        {metaError && !metaAnalysis && (
          <div className="text-[10px] mt-2 px-2 py-1 rounded-sm" style={{
            color: '#7a3a4a',
            background: 'rgba(245,235,237,0.6)',
            border: '1px solid #b27c8b',
          }}>
            元认知分析失败: {metaError}
            <button onClick={onReanalyze} className="ml-2 underline" style={{ color: '#7a3a4a' }}>重试</button>
          </div>
        )}

        {/* 元认知分析结果 inline 折叠区 — 共享组件 */}
        {metaAnalysis && metaExpanded && (
          <MetaAnalysisInline
            analysis={metaAnalysis}
            textColor={meta.color}
            onReanalyze={onReanalyze}
            isAnalyzing={isAnalyzing}
          />
        )}
      </div>
    </div>
  )
}

export default memo(OntologyNodeImpl)
