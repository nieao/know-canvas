/**
 * OntologyNode — Aletheia 本体节点
 *
 * 4 种 variant (从飞书 wiki Aletheia 设计):
 *   - goal:        顶层目标 (黑底 + 暖色边)
 *   - entity:      核心实体 (白底 + 暖色细线)
 *   - constraint:  硬约束 (暖色背景 + 重边)
 *   - assumption:  隐含假设 (灰背景 + 虚线, 等待验证)
 *
 * 每个非 goal 节点底部 4 个推进按钮 (2x2 网格):
 *   - "🔧 拆解"     → 节点级二次拆解, 长出 3-5 个子 entity 节点
 *   - "⚡ 元认知"   → 走 5 步元认知, 长出 5 个 metaStepNode
 *   - "派 Hermes →" → 把节点转为 TaskNode 派单 (调研/执行)
 *   - "反驳 ⚔"     → 调反驳引擎生成 ChallengeNode (Devil's Advocate)
 */

import { memo, useState } from 'react'
import { Handle, Position } from 'reactflow'
import useCanvasStore from '../../stores/useCanvasStore'

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

function OntologyNodeImpl({ id, data, selected }) {
  const promoteToTask = useCanvasStore((s) => s.promoteOntologyToTask)
  const challenge = useCanvasStore((s) => s.dispatchChallenge)
  const decomposeFurther = useCanvasStore((s) => s.decomposeOntologyFurther)
  const runMeta = useCanvasStore((s) => s.runMetaCognitiveOnNode)
  const updateNode = useCanvasStore((s) => s.updateNode)

  const variant = data.variant || 'entity'
  const meta = VARIANT_META[variant] || VARIANT_META.entity
  const title = data.title || ''
  const description = data.description || ''
  const isChallenging = data.challenging === true
  // 拆解 / 元认知 用本地 state 即可 (不需要持久化 — 失败可以重试, 成功后子节点已落地)
  const [isDecomposing, setIsDecomposing] = useState(false)
  const [isRunningMeta, setIsRunningMeta] = useState(false)

  const onPromoteToTask = (e) => {
    e.stopPropagation()
    promoteToTask(id).catch((err) => {
      console.error('[OntologyNode] promote failed:', err)
    })
  }

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

  const onRunMeta = (e) => {
    e.stopPropagation()
    if (isRunningMeta || !title.trim()) return
    setIsRunningMeta(true)
    // 元认知是异步长任务 — store action 内部不 await, 这里只标记按钮 1.5s 防抖即可
    runMeta(id)
      .catch((err) => console.error('[OntologyNode] meta failed:', err))
      .finally(() => setTimeout(() => setIsRunningMeta(false), 1500))
  }

  return (
    <div
      className="relative shadow-sm transition-all duration-300"
      style={{
        width: meta.width,
        background: meta.bg,
        color: meta.color,
        border: `${selected ? '2px' : '1px'} ${meta.borderStyle || 'solid'} ${selected ? 'var(--accent)' : meta.border}`,
        borderRadius: 4,
      }}
    >
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
          {variant === 'assumption' && (
            <span className="text-[9px]" style={{ color: meta.accent }}>未验证</span>
          )}
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

        {/* 推进按钮 — goal 不可派 (太抽象), 其他 3 类 4 个按钮 2x2 网格 */}
        {variant !== 'goal' && (
          <div className="grid grid-cols-2 gap-1.5 mt-3">
            {/* 第 1 行: 拆解 (生成子节点) + 元认知 (5 步流程) */}
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
              {isDecomposing ? '拆解中…' : '🔧 拆解'}
            </button>
            <button
              onClick={onRunMeta}
              disabled={!title.trim() || isRunningMeta}
              className="text-[10px] py-1 px-2 rounded-sm border transition-all"
              style={{
                borderColor: title.trim() ? 'var(--accent-soft, var(--accent))' : 'var(--border-subtle)',
                color: title.trim() ? 'var(--accent)' : 'var(--text-faint)',
                background: title.trim() ? 'var(--accent-bg, rgba(245,240,235,0.4))' : 'transparent',
                cursor: title.trim() && !isRunningMeta ? 'pointer' : 'not-allowed',
                opacity: isRunningMeta ? 0.6 : 1,
              }}
              title="走 5 步元认知 (意图/拆解/执行/反思/综合) — 长出 5 个步骤节点"
            >
              {isRunningMeta ? '已派…' : '⚡ 元认知'}
            </button>
            {/* 第 2 行: 派 Hermes (远端 worker) + 反驳 (Devil's Advocate) */}
            <button
              onClick={onPromoteToTask}
              disabled={!title.trim()}
              className="text-[10px] py-1 px-2 rounded-sm border transition-all"
              style={{
                borderColor: title.trim() ? 'var(--accent)' : 'var(--border-subtle)',
                color: title.trim() ? 'var(--text-primary)' : 'var(--text-faint)',
                background: title.trim() ? 'rgba(245,240,235,0.6)' : 'transparent',
                cursor: title.trim() ? 'pointer' : 'not-allowed',
              }}
              title="转为 Hermes 任务节点 (远端 worker 调研/执行)"
            >
              🚀 派 Hermes
            </button>
            {/* 反驳按钮: severity-high 粉灰色, 跨主题保持警示语义 */}
            <button
              onClick={onChallenge}
              disabled={!title.trim() || isChallenging}
              className="text-[10px] py-1 px-2 rounded-sm border transition-all"
              style={{
                borderColor: title.trim() ? '#b27c8b' : 'var(--border-subtle)',
                color: title.trim() ? '#7a3a4a' : 'var(--text-faint)',
                background: title.trim() ? 'rgba(245,235,237,0.6)' : 'transparent',
                cursor: title.trim() && !isChallenging ? 'pointer' : 'not-allowed',
              }}
              title="生成 Devil's Advocate 反驳论点"
            >
              {isChallenging ? '反驳中…' : '⚔ 反驳'}
            </button>
          </div>
        )}

        {/* goal 节点显示提示 */}
        {variant === 'goal' && (
          <div className="text-[10px] mt-2 opacity-50" style={{ color: meta.color }}>
            ↓ 已自动拆解 · 点下方节点上的按钮继续推进
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(OntologyNodeImpl)
