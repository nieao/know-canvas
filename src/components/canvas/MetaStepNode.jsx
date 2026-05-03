/**
 * MetaStepNode — 元认知 skill 5 步流中的单步节点
 *
 * 状态: pending | running | done | failed
 *   - pending: 灰色占位, 半透明
 *   - running: 暖色 pulse + border 旋转流光 (强动画), 显示步骤 label + 转圈 spinner
 *   - done   : 暖色定格, 展开 output 详细字段 (按 stepId 渲染不同结构)
 *   - failed : 红色边 + error 信息
 *
 * 由 services/metaCognitiveExecutor 创建并按步驱动状态变化, 数据形态见 store
 * addMetaStepNode + updateMetaStepNodeStatus.
 */

import { memo } from 'react'
import { Handle, Position } from 'reactflow'

// MetaStep 状态色 (语义色: pending/running/done/failed 状态板, 跨主题保持语义)
const STATUS_META = {
  pending: { color: 'var(--text-faint)', bg: 'var(--surface)', label: '待执行' },
  running: { color: 'var(--accent)', bg: '#fffbf5', label: '执行中' },
  done:    { color: 'var(--accent)', bg: '#fdfaf5', label: '已完成' },
  failed:  { color: '#d27b7b', bg: '#fdf3f3', label: '失败' },  // status-failed 红
}

// 把秒数格式化成 "1.2s" / "12s" / "1m 30s"
function fmtDuration(ms) {
  if (!ms || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

// 渲染每步的 output (按 stepId 分类, output 形态来自 metaCognitiveExecutor 的 STEP_PROMPTS)
function StepOutput({ stepId, output }) {
  if (!output) return null
  const labelStyle = { fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.18em', fontWeight: 600, marginBottom: 3 }
  const textStyle = { fontSize: '10px', lineHeight: 1.55, color: 'var(--text-secondary)' }

  if (stepId === 'intent') {
    return (
      <div className="space-y-1.5">
        <div>
          <div style={labelStyle}>核心问题</div>
          <div style={{ ...textStyle, fontStyle: 'italic', borderLeft: '2px solid var(--accent)', paddingLeft: 6 }}>
            {output.core_question}
          </div>
        </div>
        {Array.isArray(output.implicit_goals) && output.implicit_goals.length > 0 && (
          <div>
            <div style={labelStyle}>隐含目标</div>
            <ul style={{ ...textStyle, paddingLeft: 14 }}>
              {output.implicit_goals.slice(0, 3).map((g, i) => <li key={i} style={{ listStyle: 'disc' }}>{g}</li>)}
            </ul>
          </div>
        )}
        {Array.isArray(output.ambiguities) && output.ambiguities.length > 0 && (
          <div>
            <div style={labelStyle}>歧义点</div>
            <ul style={{ ...textStyle, paddingLeft: 14, color: '#9b6a6a' }}>
              {output.ambiguities.slice(0, 3).map((a, i) => <li key={i} style={{ listStyle: 'disc' }}>{a}</li>)}
            </ul>
          </div>
        )}
      </div>
    )
  }

  if (stepId === 'decompose') {
    return (
      <div className="space-y-1.5">
        {output.strategy && (
          <div>
            <div style={labelStyle}>整体策略</div>
            <div style={textStyle}>{output.strategy}</div>
          </div>
        )}
        {Array.isArray(output.subtasks) && (
          <div>
            <div style={labelStyle}>子任务 · {output.subtasks.length}</div>
            <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
              {output.subtasks.slice(0, 5).map((s, i) => (
                <li key={i} style={{ ...textStyle, padding: '3px 0', borderBottom: '1px dashed var(--accent-soft)' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 6 }}>{s.id || `s${i + 1}`}</span>
                  {s.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  if (stepId === 'execute') {
    return (
      <div>
        <div style={labelStyle}>执行结果 · {Array.isArray(output.results) ? output.results.length : 0} 项</div>
        {Array.isArray(output.results) && output.results.slice(0, 3).map((r, i) => (
          <div key={i} style={{ ...textStyle, marginBottom: 6, paddingBottom: 6, borderBottom: '1px dashed var(--accent-soft)' }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              <span style={{ color: 'var(--accent)', marginRight: 6 }}>{r.subtask_id || `s${i + 1}`}</span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>conf {(r.confidence ?? 0).toFixed(2)}</span>
            </div>
            <div style={{ marginTop: 3 }}>{(r.output || '').slice(0, 140)}{(r.output || '').length > 140 ? '...' : ''}</div>
          </div>
        ))}
      </div>
    )
  }

  if (stepId === 'reflect') {
    // verdict 色 (语义色: passed/partial/failed 状态板, 跨主题不变)
    const verdictColor = output.verdict === 'passed' ? '#5a8a5a' : output.verdict === 'partial' ? 'var(--accent)' : '#d27b7b'
    return (
      <div className="space-y-1.5">
        <div>
          <div style={labelStyle}>判断</div>
          <div style={{ ...textStyle, color: verdictColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {output.verdict || '?'}
          </div>
        </div>
        {Array.isArray(output.weaknesses) && output.weaknesses.length > 0 && (
          <div>
            <div style={labelStyle}>薄弱点</div>
            <ul style={{ ...textStyle, paddingLeft: 14, color: '#9b6a6a' }}>
              {output.weaknesses.slice(0, 3).map((w, i) => <li key={i} style={{ listStyle: 'disc' }}>{w}</li>)}
            </ul>
          </div>
        )}
        {output.suggested_revision && (
          <div>
            <div style={labelStyle}>建议改进</div>
            <div style={textStyle}>{output.suggested_revision}</div>
          </div>
        )}
      </div>
    )
  }

  if (stepId === 'synthesize') {
    return (
      <div className="space-y-1.5">
        {output.final_answer && (
          <div>
            <div style={labelStyle}>最终答复</div>
            <div style={{ ...textStyle, lineHeight: 1.6, padding: 6, background: 'var(--accent-bg)', border: '1px solid var(--accent-soft)', borderRadius: 3 }}>
              {output.final_answer.slice(0, 320)}{output.final_answer.length > 320 ? '...' : ''}
            </div>
          </div>
        )}
        {Array.isArray(output.key_insights) && output.key_insights.length > 0 && (
          <div>
            <div style={labelStyle}>关键洞察</div>
            <ul style={{ ...textStyle, paddingLeft: 14 }}>
              {output.key_insights.slice(0, 3).map((k, i) => <li key={i} style={{ listStyle: 'disc' }}>{k}</li>)}
            </ul>
          </div>
        )}
        {Array.isArray(output.lessons_learned) && output.lessons_learned.length > 0 && (
          <div>
            <div style={labelStyle}>元认知教训</div>
            <ul style={{ ...textStyle, paddingLeft: 14, fontStyle: 'italic', color: 'var(--text-muted)' }}>
              {output.lessons_learned.slice(0, 2).map((l, i) => <li key={i} style={{ listStyle: 'disc' }}>{l}</li>)}
            </ul>
          </div>
        )}
      </div>
    )
  }

  return null
}

function MetaStepNodeImpl({ data, selected }) {
  const status = data.status || 'pending'
  const meta = STATUS_META[status] || STATUS_META.pending
  const isRunning = status === 'running'
  const isDone = status === 'done'
  const isFailed = status === 'failed'

  return (
    <div
      className="meta-step-node"
      style={{
        position: 'relative',
        width: 280,
        background: meta.bg,
        border: `${selected ? '2px' : '1.5px'} solid ${meta.color}`,
        borderRadius: 4,
        opacity: status === 'pending' ? 0.6 : 1,
        boxShadow: isRunning
          ? `0 0 0 4px rgba(200, 168, 130, 0.18), 0 8px 24px rgba(200, 168, 130, 0.25)`
          : isDone
            ? '0 4px 12px rgba(200, 168, 130, 0.18)'
            : '0 2px 6px rgba(0,0,0,0.08)',
        transition: 'all 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: meta.color }} />
      <Handle type="source" position={Position.Bottom} style={{ background: meta.color }} />

      {/* Running 时顶部流光条 */}
      {isRunning && (
        <>
          <div
            style={{
              position: 'absolute',
              top: -1.5, left: -1.5, right: -1.5,
              height: 2,
              borderRadius: 4,
              background: 'linear-gradient(90deg, transparent 0%, #c8a882 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'metaStepFlow 1.6s linear infinite',
              pointerEvents: 'none',
            }}
          />
          <style>{`
            @keyframes metaStepFlow {
              0%   { background-position: 100% 0; }
              100% { background-position: -100% 0; }
            }
            @keyframes metaStepPulse {
              0%, 100% { opacity: 1; transform: scale(1); }
              50%      { opacity: 0.55; transform: scale(1.18); }
            }
            @keyframes metaStepSpin {
              0%   { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </>
      )}

      {/* 顶部色条 */}
      <div style={{ height: 3, background: meta.color, opacity: isRunning ? 0.5 : 1 }} />

      <div style={{ padding: '10px 12px' }}>
        {/* 标题行 */}
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
            <span
              style={{
                fontSize: 14,
                animation: isRunning ? 'metaStepPulse 1.4s ease-in-out infinite' : 'none',
              }}
            >
              {data.icon || '·'}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
              {(data.index ?? 0) + 1}. {data.label || '步骤'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {isRunning && (
              <span
                style={{
                  display: 'inline-block',
                  width: 10, height: 10,
                  borderRadius: '50%',
                  border: '2px solid var(--accent-soft)',
                  borderTopColor: meta.color,
                  animation: 'metaStepSpin 0.9s linear infinite',
                }}
              />
            )}
            <span
              style={{
                fontSize: 9,
                color: meta.color,
                background: status === 'pending' ? 'transparent' : 'rgba(200, 168, 130, 0.12)',
                padding: '1px 6px',
                borderRadius: 2,
                letterSpacing: '0.15em',
                fontWeight: 600,
              }}
            >
              {meta.label}
            </span>
          </div>
        </div>

        {/* EN 副标 */}
        <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.3em', marginBottom: 8 }}>
          {data.en || ''}
        </div>

        {/* Done — 渲染 output */}
        {isDone && data.output && <StepOutput stepId={data.stepId} output={data.output} />}

        {/* Pending — 提示 */}
        {status === 'pending' && (
          <div style={{ fontSize: 10, color: 'var(--text-faint)', fontStyle: 'italic', textAlign: 'center', padding: '6px 0' }}>
            等待上一步完成
          </div>
        )}

        {/* Running — 提示 */}
        {isRunning && (
          <div style={{ fontSize: 10, color: 'var(--accent)', textAlign: 'center', padding: '4px 0' }}>
            LLM 正在生成...
          </div>
        )}

        {/* Failed — error */}
        {isFailed && data.error && (
          <div style={{ fontSize: 10, color: '#9b3a4c', background: '#fdf3f3', padding: 6, borderRadius: 3, lineHeight: 1.5 }}>
            {data.error}
          </div>
        )}

        {/* 底部时间 */}
        {(isDone || isFailed) && data.durationMs ? (
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, paddingTop: 4, borderTop: '1px dashed var(--border-subtle)', textAlign: 'right' }}>
            耗时 {fmtDuration(data.durationMs)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default memo(MetaStepNodeImpl)
