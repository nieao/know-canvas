// 实时成本面板 - 展开态抽屉，向上弹出
// 显示总览 / 最近任务 stage 级瀑布 / 平衡点反馈
import React from 'react';
import useCostMeterStore from '../../stores/useCostMeterStore';
import useAletheiaStore from '../../stores/useAletheiaStore';
import CostFeedbackButtons from './CostFeedbackButtons';

/**
 * 描述 costWeight 在量表上的语义文案
 * 0.0~0.3 偏效果, 0.3~0.6 中性, 0.6~1.0 偏省钱
 */
function describeCostWeight(w) {
  if (typeof w !== 'number' || Number.isNaN(w)) return '中性';
  if (w < 0.3) return '出效果不计成本';
  if (w < 0.6) return '中性';
  return '先省钱再出效果';
}

/**
 * 截短 taskId 到前 8 位
 */
function shortId(id) {
  if (!id) return '—';
  return String(id).slice(0, 8);
}

/**
 * 计算瀑布 mini bar 的宽度百分比 (按 stage cost 占任务总 cost 的比例)
 */
function barPct(stageCost, taskTotalCost) {
  if (!taskTotalCost || taskTotalCost <= 0) return 0;
  const pct = (stageCost / taskTotalCost) * 100;
  return Math.max(2, Math.min(100, pct));
}

/**
 * 实时成本面板
 * @param {object} props
 * @param {boolean} props.open - 是否显示
 * @param {() => void} props.onClose - 关闭回调
 */
export default function CostMeterPanel({ open, onClose }) {
  // 安全读取 cost meter store；store 还没就绪时全部 fallback
  const totalCny = useCostMeterStore
    ? useCostMeterStore((s) => s?.totalCostCny ?? 0)
    : 0;
  const totalUsd = useCostMeterStore
    ? useCostMeterStore((s) => s?.totalCostUsd ?? 0)
    : 0;
  const totalTokens = useCostMeterStore
    ? useCostMeterStore((s) => s?.totalTokens ?? { input: 0, output: 0 })
    : { input: 0, output: 0 };

  // 最近任务列表（订阅 events 长度，让数据变化时面板自动重渲）
  const eventCount = useCostMeterStore
    ? useCostMeterStore((s) => s?.events?.length ?? 0)
    : 0;
  const recentTasks = React.useMemo(() => {
    try {
      const fn = useCostMeterStore?.getState?.()?.getRecentTasks;
      if (typeof fn === 'function') return fn(5) || [];
    } catch (err) {
      // 静默降级
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCount]);

  // 最近一个 taskId 给反馈按钮
  const latestTaskId =
    recentTasks && recentTasks.length > 0 ? recentTasks[0].taskId : null;

  // costWeight 来自 aletheia store
  const costWeight = useAletheiaStore
    ? useAletheiaStore((s) => (typeof s?.costWeight === 'number' ? s.costWeight : 0.5))
    : 0.5;

  if (!open) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '64px',
        right: '12px',
        width: '360px',
        maxHeight: '480px',
        overflowY: 'auto',
        zIndex: 30,
        background: 'var(--surface-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '4px',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.08)',
        fontFamily: 'var(--font-sans)',
        color: 'var(--text-secondary)',
      }}
    >
      {/* 顶部 1px 暖色细线 */}
      <div
        style={{
          height: '2px',
          background: 'var(--accent)',
          width: '100%',
        }}
      />

      {/* 头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px 10px',
          borderBottom: '1px solid var(--divider)',
        }}
      >
        <span
          style={{
            fontSize: '0.7rem',
            letterSpacing: '0.35em',
            color: 'var(--accent)',
            textTransform: 'uppercase',
          }}
        >
          REALTIME · 成本面板
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭面板"
          title="关闭"
          style={{
            width: '22px',
            height: '22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '0.9rem',
            lineHeight: 1,
            padding: 0,
            borderRadius: '2px',
            transition: 'all 0.5s var(--ease-out)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
        >
          ×
        </button>
      </div>

      {/* 1. 总览 */}
      <section style={{ padding: '16px' }}>
        <div
          style={{
            fontSize: '0.66rem',
            letterSpacing: '0.3em',
            color: 'var(--text-muted)',
            marginBottom: '10px',
            textTransform: 'uppercase',
          }}
        >
          01 / 总览
        </div>
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.6rem',
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
            lineHeight: 1.2,
          }}
        >
          ¥{Number(totalCny).toFixed(4)}
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '0.78rem',
              color: 'var(--text-muted)',
              marginLeft: '10px',
              letterSpacing: 0,
            }}
          >
            ~ ${Number(totalUsd).toFixed(4)}
          </span>
        </div>
        <div
          style={{
            marginTop: '8px',
            fontSize: '0.74rem',
            color: 'var(--text-muted)',
            letterSpacing: '0.05em',
          }}
        >
          tokens · 输入{' '}
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            {totalTokens?.input ?? 0}
          </span>
          <span style={{ color: 'var(--text-faint)', margin: '0 6px' }}>·</span>
          输出{' '}
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            {totalTokens?.output ?? 0}
          </span>
        </div>
      </section>

      <div style={{ height: '1px', background: 'var(--divider)' }} />

      {/* 2. 最近任务 */}
      <section style={{ padding: '16px' }}>
        <div
          style={{
            fontSize: '0.66rem',
            letterSpacing: '0.3em',
            color: 'var(--text-muted)',
            marginBottom: '12px',
            textTransform: 'uppercase',
          }}
        >
          02 / 最近任务
        </div>

        {recentTasks.length === 0 ? (
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-faint)',
              fontStyle: 'italic',
              padding: '8px 0',
            }}
          >
            暂无任务记录
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {recentTasks.map((task) => {
              const taskTotalCny = task?.total?.costCny ?? 0;
              // 拉 stage 详情：store 返回 stages 是对象 map { stageName: {...} }
              // 这里展开成数组方便渲染
              let stages = [];
              try {
                const fn = useCostMeterStore?.getState?.()?.getCostByTaskId;
                if (typeof fn === 'function') {
                  const detail = fn(task.taskId);
                  const map = detail?.stages || {};
                  stages = Object.entries(map).map(([name, agg]) => ({
                    stage: name,
                    costCny: agg?.costCny ?? 0,
                    costUsd: agg?.costUsd ?? 0,
                    tokens: agg?.tokens ?? { input: 0, output: 0 },
                    count: agg?.count ?? 0,
                  }));
                  // 按花费降序，最贵的 stage 在最上面
                  stages.sort((a, b) => b.costCny - a.costCny);
                }
              } catch (err) {
                stages = [];
              }

              return (
                <div
                  key={task.taskId}
                  style={{
                    border: '1px solid var(--border-subtle)',
                    padding: '10px 12px',
                    borderRadius: '2px',
                    background: 'var(--surface)',
                    transition: 'border-color 0.5s var(--ease-out)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-soft)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  }}
                >
                  {/* 任务头 */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: '8px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-serif)',
                        fontSize: '0.78rem',
                        color: 'var(--text-primary)',
                        letterSpacing: '0.05em',
                      }}
                    >
                      #{shortId(task.taskId)}
                    </span>
                    <span
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--accent)',
                        fontWeight: 500,
                      }}
                    >
                      ¥{Number(taskTotalCny).toFixed(4)}
                    </span>
                  </div>

                  {/* stage 瀑布 */}
                  {stages.length > 0 ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      {stages.map((stage, idx) => {
                        const stageCny = Number(stage?.costCny) || 0;
                        const stageTokens =
                          (stage?.tokens?.input ?? 0) + (stage?.tokens?.output ?? 0);
                        const pct = barPct(stageCny, taskTotalCny);
                        return (
                          <div
                            key={`${stage.stage}-${idx}`}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '70px 1fr 64px',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '0.7rem',
                            }}
                          >
                            <span
                              style={{
                                color: 'var(--text-secondary)',
                                letterSpacing: '0.05em',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              title={stage.stage}
                            >
                              {stage.stage || '—'}
                            </span>
                            {/* mini bar 容器 */}
                            <div
                              style={{
                                position: 'relative',
                                height: '6px',
                                background: 'var(--accent-bg)',
                                borderRadius: '1px',
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                style={{
                                  position: 'absolute',
                                  left: 0,
                                  top: 0,
                                  bottom: 0,
                                  width: `${pct}%`,
                                  background: 'var(--accent)',
                                  opacity: 0.6 + Math.min(0.4, pct / 250),
                                  transition: 'width 0.5s var(--ease-out)',
                                }}
                              />
                            </div>
                            <span
                              style={{
                                color: 'var(--text-muted)',
                                textAlign: 'right',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {stageTokens}t · ¥{Number(stageCny).toFixed(3)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--text-faint)',
                      }}
                    >
                      共 {task?.eventCount ?? 0} 次调用
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div style={{ height: '1px', background: 'var(--divider)' }} />

      {/* 3. 平衡点反馈 */}
      <section style={{ padding: '16px' }}>
        <div
          style={{
            fontSize: '0.66rem',
            letterSpacing: '0.3em',
            color: 'var(--text-muted)',
            marginBottom: '10px',
            textTransform: 'uppercase',
          }}
        >
          03 / 平衡点反馈
        </div>

        <CostFeedbackButtons
          taskId={latestTaskId}
          costAtTime={Number(totalCny) || 0}
        />

        <div
          style={{
            marginTop: '12px',
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            lineHeight: 1.6,
          }}
        >
          平衡偏置 → costWeight ={' '}
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {Number(costWeight).toFixed(3)}
          </span>{' '}
          <span style={{ color: 'var(--accent)' }}>
            ({describeCostWeight(costWeight)})
          </span>
        </div>
        <div
          style={{
            marginTop: '6px',
            paddingLeft: '10px',
            borderLeft: '2px solid var(--accent-soft)',
            fontSize: '0.68rem',
            color: 'var(--text-faint)',
            fontStyle: 'italic',
            lineHeight: 1.5,
          }}
        >
          0.0~0.3 偏好"出效果不计成本"&nbsp;·&nbsp;0.3~0.6 中性&nbsp;·&nbsp;0.6~1.0
          偏好"先省钱再出效果"
        </div>
      </section>
    </div>
  );
}
