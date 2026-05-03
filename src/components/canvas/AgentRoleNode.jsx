/**
 * AgentRoleNode — ALETHEIA 项目模式中的 agent 角色节点
 *
 * 出现时机: BottomAIBar 切到"项目"模式 → askAndStartMetaProject → EMERGE 阶段
 * 形态: 一张角色卡片, 体现"agent 涌现 + 任务承担" 这件事在画布上的视觉表达.
 *
 * 状态机 (data.status):
 *   pending  — 默认 (灰色, 等 EXECUTE 阶段)
 *   running  — 当前 stage 正在执行 (脉冲 + shimmer 进度条)
 *   done     — 完成 (绿色对勾, 边框变绿, 显示 output_summary)
 *   failed   — 失败 (粉灰边框)
 *
 * data 字段:
 *   roleId            "R1"
 *   name              角色名 (e.g. 选址调研员)
 *   responsibility    一句话职责
 *   assigned_tasks    ["T1", "T2"]
 *   tools             ["实地踩点", "Excel 建模"]
 *   status            "pending|running|done|failed"
 *   output_summary    执行完后的 1 句产出摘要
 *   stageGroupColor   同一 parallel stage 的角色共享一个底色 (tinted)
 *
 * 入场动画: opacity 0 → 1 + translateY(8px) → 0, 0.5s ease-out (memo 后挂载即播)
 *
 * 视觉规范: 建筑极简, 暖色 #c8a882 + 黑白, 1px 细线, 圆角 4
 */

import { memo, useEffect, useState } from 'react'
import { Handle, Position } from 'reactflow'

const STATUS_META = {
  pending: {
    label: 'PENDING',
    color: 'var(--text-faint, #888)',
    border: 'var(--border-subtle, #e8e8e8)',
    dot: '#bbb',
  },
  running: {
    label: 'RUNNING',
    color: 'var(--accent, #c8a882)',
    border: 'var(--accent, #c8a882)',
    dot: '#c8a882',
  },
  done: {
    label: 'DONE',
    color: '#5a8d5e',
    border: '#7bc47f',
    dot: '#7bc47f',
  },
  failed: {
    label: 'FAILED',
    color: '#7a3a4a',
    border: '#b27c8b',
    dot: '#b27c8b',
  },
}

function AgentRoleNodeImpl({ data, selected }) {
  const status = data?.status || 'pending'
  const meta = STATUS_META[status] || STATUS_META.pending
  const name = data?.name || '未命名角色'
  const responsibility = data?.responsibility || ''
  const tools = Array.isArray(data?.tools) ? data.tools : []
  const outputSummary = data?.output_summary || ''
  const stageBg = data?.stageGroupColor || 'var(--surface, #fff)'

  // 入场动画 — mount 后下一帧释放 (用 state 切 transform/opacity)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div
      className="relative shadow-sm"
      style={{
        width: 220,
        background: stageBg,
        color: 'var(--text-primary, #1a1a1a)',
        border: `${selected ? '2px' : '1px'} solid ${selected ? 'var(--accent, #c8a882)' : meta.border}`,
        borderRadius: 4,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.5s ease-out, transform 0.5s ease-out, border-color 0.4s ease',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: 'var(--accent, #c8a882)' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--accent, #c8a882)' }} />

      {/* 顶部 ROLE 标签 + 状态 dot */}
      <div className="px-3 pt-2.5 flex items-center justify-between">
        <span
          className="text-[9px] font-semibold"
          style={{ color: 'var(--accent, #c8a882)', letterSpacing: '0.3em' }}
        >
          ROLE · {data?.roleId || ''}
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: meta.dot,
              animation: status === 'running' ? 'agent-role-pulse 1.2s ease-in-out infinite' : 'none',
            }}
          />
          <span
            className="text-[8px]"
            style={{ color: meta.color, letterSpacing: '0.2em' }}
          >
            {status === 'done' ? '✓ ' : ''}{meta.label}
          </span>
        </span>
      </div>

      {/* 角色名 (衬线) */}
      <div className="px-3 pt-1.5">
        <div
          className="text-sm font-medium"
          style={{
            fontFamily: '"Noto Serif SC", Georgia, serif',
            color: 'var(--text-primary, #1a1a1a)',
            letterSpacing: '0.02em',
            lineHeight: 1.3,
          }}
        >
          {name}
        </div>
      </div>

      {/* 职责 (10px 灰色, 1.5 行截断) */}
      {responsibility && (
        <div
          className="px-3 pt-1 text-[10px]"
          style={{
            color: 'var(--text-muted, #555)',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {responsibility}
        </div>
      )}

      {/* running 状态下的 shimmer 进度条 */}
      {status === 'running' && (
        <div
          className="mt-2 mx-3 relative overflow-hidden"
          style={{ height: 2, background: 'rgba(200,168,130,0.18)' }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, transparent 0%, var(--accent, #c8a882) 50%, transparent 100%)',
              animation: 'agent-role-shimmer 1.6s linear infinite',
            }}
          />
        </div>
      )}

      {/* done 状态下的 output_summary */}
      {status === 'done' && outputSummary && (
        <div
          className="mx-3 mt-2 px-2 py-1 text-[10px]"
          style={{
            background: 'rgba(123,196,127,0.08)',
            borderLeft: '2px solid #7bc47f',
            color: 'var(--text-muted, #555)',
            lineHeight: 1.5,
          }}
        >
          {outputSummary}
        </div>
      )}

      {/* tools tag pills (6-8px 灰色边框 small pills) */}
      {tools.length > 0 && (
        <div className="px-3 pt-2 pb-2.5 flex flex-wrap gap-1">
          {tools.map((t, i) => (
            <span
              key={i}
              className="text-[9px]"
              style={{
                padding: '2px 6px',
                border: '1px solid var(--border-subtle, #e8e8e8)',
                borderRadius: 2,
                color: 'var(--text-muted, #555)',
                letterSpacing: '0.05em',
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* 关键帧动画 */}
      <style>{`
        @keyframes agent-role-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.6); }
        }
        @keyframes agent-role-shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}

export default memo(AgentRoleNodeImpl)
