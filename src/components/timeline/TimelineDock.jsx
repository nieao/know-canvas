/**
 * TimelineDock - 项目运行时间轴
 *
 * 数据源: useCostMeterStore.events (cost-meter:record 事件流)
 * 折叠态: 底部居中 chip "⏱ 时间轴 · N 任务 · 累计 Ts"
 * 展开态: 底部抽屉 (Gantt 主图 + 右侧详情面板)
 *
 * Gantt:
 *   - 每个 taskId 一行
 *   - 同 task 内 events 按 timestamp 画圆点, 首尾连 1px 细线
 *   - 圆点颜色按 stage 映射, 最近 5s 内 event 加脉冲
 *   - click event 圆点 → 选中 event 进详情
 *   - click row 空白 → 选中 task summary
 *
 * 详情面板:
 *   - 选中 event: stage / provider-model / tokens / 花费 / timestamp / estimated
 *   - 选中 task:  持续时长 / event 数 / 总 tokens / 总花费 / 各 stage 列表
 */

import { useState, useMemo, useEffect } from 'react'
import useCostMeterStore from '../../stores/useCostMeterStore'

// stage → 颜色 (用语义 token, 主题切换自动适配)
const STAGE_COLOR = {
  intent: 'var(--severity-low)',
  decompose: 'var(--accent-soft)',
  execute: 'var(--accent)',
  reflect: 'var(--severity-medium)',
  synthesize: 'var(--status-success)',
  'aletheia.challenge': 'var(--severity-high)',
  'aletheia.synthesize': 'var(--status-success)',
  unknown: 'var(--text-faint)',
}

const STAGE_LABEL = {
  intent: '意图',
  decompose: '拆解',
  execute: '执行',
  reflect: '反思',
  synthesize: '综合',
  'aletheia.challenge': '反驳',
  'aletheia.synthesize': 'Aletheia 综合',
  unknown: '未知',
}

const ROW_HEIGHT = 32
const RECENT_THRESHOLD_MS = 5000

function fmtDuration(ms) {
  if (!ms || ms < 0) return '0s'
  if (ms < 1000) return Math.round(ms) + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(1) + 's'
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000)
    const s = Math.round((ms % 60_000) / 1000)
    return `${m}m ${s}s`
  }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.round((ms % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

function fmtTime(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

function shortId(id) {
  if (!id) return '-'
  return id.length > 18 ? id.slice(0, 9) + '…' + id.slice(-6) : id
}

function getStageColor(stage) {
  return STAGE_COLOR[stage] || STAGE_COLOR.unknown
}

function getStageLabel(stage) {
  return STAGE_LABEL[stage] || stage
}

export default function TimelineDock() {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(null) // { kind: 'task' | 'event', taskId, eventIndex? }
  const [tick, setTick] = useState(0) // 用于触发"正在跑"脉冲的相对时间刷新

  const events = useCostMeterStore((s) => s.events)
  const totalCostCny = useCostMeterStore((s) => s.totalCostCny)
  const totalTokens = useCostMeterStore((s) => s.totalTokens)

  // 5s tick: 让"最近事件"判断和正在跑的脉冲跟着实时刷新
  useEffect(() => {
    if (!open) return undefined
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [open])

  // 按 taskId 分组 + 计算时间范围
  const { tasks, minTs, maxTs } = useMemo(() => {
    if (!events || events.length === 0) {
      return { tasks: [], minTs: 0, maxTs: 0 }
    }
    const grouped = new Map()
    let _min = Infinity
    let _max = 0
    for (const e of events) {
      if (e.timestamp < _min) _min = e.timestamp
      if (e.timestamp > _max) _max = e.timestamp
      if (!grouped.has(e.taskId)) {
        grouped.set(e.taskId, { taskId: e.taskId, events: [] })
      }
      grouped.get(e.taskId).events.push(e)
    }
    const list = Array.from(grouped.values())
      .map((t) => {
        t.events.sort((a, b) => a.timestamp - b.timestamp)
        const first = t.events[0]
        const last = t.events[t.events.length - 1]
        let costCny = 0
        let inputTokens = 0
        let outputTokens = 0
        for (const e of t.events) {
          costCny += e.costCny || 0
          inputTokens += e.inputTokens || 0
          outputTokens += e.outputTokens || 0
        }
        return {
          taskId: t.taskId,
          events: t.events,
          firstTs: first.timestamp,
          lastTs: last.timestamp,
          duration: last.timestamp - first.timestamp,
          eventCount: t.events.length,
          costCny,
          tokens: { input: inputTokens, output: outputTokens },
        }
      })
      .sort((a, b) => b.lastTs - a.lastTs)
    return { tasks: list, minTs: _min, maxTs: _max }
  }, [events])

  // 时间窗口扩展到 now (让正在跑的任务在 Gantt 上能延伸到右边)
  const now = Date.now()
  const _ = tick // 保留 tick 引用让 react 知道依赖
  const windowStart = minTs || now - 1000
  const windowEnd = Math.max(maxTs, now)
  const windowSpan = Math.max(windowEnd - windowStart, 1)

  const tsToPercent = (ts) => {
    return ((ts - windowStart) / windowSpan) * 100
  }

  // 解析当前选中
  const selectedTask = selected
    ? tasks.find((t) => t.taskId === selected.taskId)
    : null
  const selectedEvent =
    selected && selected.kind === 'event' && selectedTask
      ? selectedTask.events[selected.eventIndex]
      : null

  // 默认选中最近一个 task (打开抽屉时)
  useEffect(() => {
    if (open && !selected && tasks.length > 0) {
      setSelected({ kind: 'task', taskId: tasks[0].taskId })
    }
  }, [open, selected, tasks])

  return (
    <>
      {/* 折叠 chip — 底部居中 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="absolute z-30 flex items-center gap-2 px-4 py-2 rounded-full transition-all"
        style={{
          bottom: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--surface-elevated, var(--surface))',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border-subtle)'}`,
          color: open ? 'var(--accent)' : 'var(--text-secondary)',
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
          fontSize: '12px',
          letterSpacing: '0.1em',
          cursor: 'pointer',
          boxShadow: open ? '0 4px 16px rgba(0,0,0,0.08)' : 'none',
        }}
        title={open ? '折叠时间轴' : '展开时间轴'}
      >
        <span style={{ fontSize: '14px' }}>⏱</span>
        <span>时间轴</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>{tasks.length} 任务</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>{events.length} 调用</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>¥{totalCostCny.toFixed(4)}</span>
        <span
          style={{
            display: 'inline-block',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.3s',
            color: 'var(--text-faint)',
          }}
        >
          ⌃
        </span>
      </button>

      {/* 展开抽屉 */}
      {open && (
        <div
          className="absolute z-30"
          style={{
            bottom: '60px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(960px, 88vw)',
            height: '360px',
            background: 'var(--surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            boxShadow: '0 12px 36px rgba(0,0,0,0.12)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: '"Noto Sans SC", system-ui, sans-serif',
          }}
        >
          {/* 顶部暖色细线 */}
          <div style={{ height: '2px', background: 'var(--accent)' }} />

          {/* stats 行 */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-4">
              <div
                style={{
                  fontSize: '10px',
                  letterSpacing: '0.35em',
                  color: 'var(--accent)',
                  fontFamily: '"Noto Sans SC", system-ui, sans-serif',
                }}
              >
                TIMELINE
              </div>
              <div
                style={{
                  fontFamily: '"Noto Serif SC", Georgia, serif',
                  fontSize: '14px',
                  color: 'var(--text-primary)',
                  letterSpacing: '0.02em',
                }}
              >
                项目运行时间轴
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
              <Stat label="任务" value={tasks.length} />
              <Stat label="调用" value={events.length} />
              <Stat label="Tokens" value={(totalTokens.input + totalTokens.output).toLocaleString()} />
              <Stat label="累计" value={`¥${totalCostCny.toFixed(4)}`} />
              <button
                onClick={() => setOpen(false)}
                className="px-2 py-0.5"
                style={{
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  lineHeight: 1,
                  borderRadius: '2px',
                }}
                title="关闭"
              >
                ×
              </button>
            </div>
          </div>

          {/* 主体: Gantt | 详情 */}
          <div className="flex-1 flex" style={{ minHeight: 0 }}>
            {/* 左 — Gantt */}
            <div
              className="flex-1 flex flex-col"
              style={{ borderRight: '1px solid var(--divider, var(--border-subtle))', minWidth: 0 }}
            >
              {tasks.length === 0 ? (
                <EmptyGantt />
              ) : (
                <Gantt
                  tasks={tasks}
                  windowStart={windowStart}
                  windowEnd={windowEnd}
                  tsToPercent={tsToPercent}
                  selected={selected}
                  onSelectTask={(taskId) => setSelected({ kind: 'task', taskId })}
                  onSelectEvent={(taskId, idx) => setSelected({ kind: 'event', taskId, eventIndex: idx })}
                />
              )}
            </div>

            {/* 右 — 详情 */}
            <aside
              style={{
                width: '36%',
                minWidth: '240px',
                overflowY: 'auto',
                padding: '14px 18px',
                background: 'var(--surface-soft, var(--surface))',
              }}
            >
              {selectedEvent ? (
                <EventDetail event={selectedEvent} task={selectedTask} />
              ) : selectedTask ? (
                <TaskDetail task={selectedTask} />
              ) : (
                <Hint>选择左侧任务或调用查看详情</Hint>
              )}
            </aside>
          </div>
        </div>
      )}
    </>
  )
}

// ============== 子组件 ==============

function Stat({ label, value }) {
  return (
    <div className="flex items-baseline gap-1">
      <span style={{ color: 'var(--text-faint)', fontSize: '10px', letterSpacing: '0.15em' }}>
        {label}
      </span>
      <span
        style={{
          color: 'var(--text-primary)',
          fontFamily: '"Noto Serif SC", Georgia, serif',
          fontSize: '13px',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function EmptyGantt() {
  return (
    <div
      className="flex items-center justify-center h-full"
      style={{ color: 'var(--text-faint)', fontSize: '12px', letterSpacing: '0.1em' }}
    >
      暂无运行记录 · 跑一次元认知任务或 Aletheia 推导后这里会出现
    </div>
  )
}

function Hint({ children }) {
  return (
    <div
      style={{
        fontSize: '11px',
        color: 'var(--text-faint)',
        letterSpacing: '0.1em',
        padding: '20px 0',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  )
}

function Gantt({ tasks, windowStart, windowEnd, tsToPercent, selected, onSelectTask, onSelectEvent }) {
  const now = Date.now()
  return (
    <div className="flex flex-col" style={{ height: '100%', minHeight: 0 }}>
      {/* 时间轴顶尺 */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '10px',
          color: 'var(--text-faint)',
          letterSpacing: '0.1em',
        }}
      >
        <span>{fmtTime(windowStart)}</span>
        <span>{fmtTime((windowStart + windowEnd) / 2)}</span>
        <span>{fmtTime(windowEnd)}</span>
      </div>

      {/* row 列表 */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '8px 0' }}>
        {tasks.map((task) => {
          const isActive = selected?.taskId === task.taskId
          const isRunning = now - task.lastTs < RECENT_THRESHOLD_MS
          return (
            <div
              key={task.taskId}
              onClick={() => onSelectTask(task.taskId)}
              className="flex items-center cursor-pointer"
              style={{
                height: ROW_HEIGHT + 'px',
                padding: '0 16px',
                background: isActive ? 'var(--accent-bg)' : 'transparent',
                transition: 'background 0.3s',
              }}
            >
              {/* 左标签 — taskId 缩写 */}
              <div
                style={{
                  width: '120px',
                  flexShrink: 0,
                  fontSize: '11px',
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  fontFamily: '"Noto Serif SC", Georgia, serif',
                  letterSpacing: '0.02em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={task.taskId}
              >
                {shortId(task.taskId)}
              </div>

              {/* Gantt 主条 */}
              <div
                style={{
                  flex: 1,
                  height: ROW_HEIGHT - 8 + 'px',
                  position: 'relative',
                  background: 'transparent',
                }}
              >
                {/* 首尾连线 */}
                {task.events.length > 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: tsToPercent(task.firstTs) + '%',
                      width: tsToPercent(task.lastTs) - tsToPercent(task.firstTs) + '%',
                      height: '1px',
                      background: 'var(--border-strong, var(--text-faint))',
                      transform: 'translateY(-50%)',
                    }}
                  />
                )}

                {/* 圆点 */}
                {task.events.map((e, i) => {
                  const isEvSel =
                    selected?.kind === 'event' &&
                    selected.taskId === task.taskId &&
                    selected.eventIndex === i
                  const recent = now - e.timestamp < RECENT_THRESHOLD_MS
                  return (
                    <div
                      key={i}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onSelectEvent(task.taskId, i)
                      }}
                      title={`${getStageLabel(e.stage)} · ${fmtTime(e.timestamp)} · ¥${(e.costCny || 0).toFixed(4)}`}
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: tsToPercent(e.timestamp) + '%',
                        width: isEvSel ? '12px' : '8px',
                        height: isEvSel ? '12px' : '8px',
                        borderRadius: '50%',
                        background: getStageColor(e.stage),
                        border: isEvSel ? '2px solid var(--text-primary)' : 'none',
                        transform: 'translate(-50%, -50%)',
                        cursor: 'pointer',
                        boxShadow: recent && isRunning
                          ? '0 0 0 0 rgba(200,168,130,0.4)'
                          : 'none',
                        animation: recent && isRunning
                          ? 'timeline-pulse 1.4s ease-out infinite'
                          : 'none',
                        zIndex: isEvSel ? 2 : 1,
                      }}
                    />
                  )
                })}
              </div>

              {/* 右侧统计 */}
              <div
                className="flex items-center gap-2"
                style={{
                  width: '120px',
                  flexShrink: 0,
                  paddingLeft: '12px',
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  letterSpacing: '0.05em',
                  justifyContent: 'flex-end',
                }}
              >
                <span>{fmtDuration(task.duration)}</span>
                <span style={{ color: 'var(--text-faint)' }}>·</span>
                <span>¥{task.costCny.toFixed(4)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* 脉冲 keyframes */}
      <style>{`
        @keyframes timeline-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(200,168,130,0.5); }
          70%  { box-shadow: 0 0 0 8px rgba(200,168,130,0); }
          100% { box-shadow: 0 0 0 0 rgba(200,168,130,0); }
        }
      `}</style>
    </div>
  )
}

function TaskDetail({ task }) {
  // 按 stage 聚合
  const stageMap = new Map()
  for (const e of task.events) {
    if (!stageMap.has(e.stage)) {
      stageMap.set(e.stage, { stage: e.stage, count: 0, costCny: 0, inputTokens: 0, outputTokens: 0 })
    }
    const s = stageMap.get(e.stage)
    s.count += 1
    s.costCny += e.costCny || 0
    s.inputTokens += e.inputTokens || 0
    s.outputTokens += e.outputTokens || 0
  }
  const stages = Array.from(stageMap.values())

  return (
    <div>
      <Section index="01" title="任务概览">
        <KV k="任务 ID" v={shortId(task.taskId)} mono />
        <KV k="开始" v={fmtTime(task.firstTs)} />
        <KV k="结束" v={fmtTime(task.lastTs)} />
        <KV k="持续" v={fmtDuration(task.duration)} accent />
        <KV k="调用次数" v={task.eventCount} />
        <KV k="累计 tokens" v={(task.tokens.input + task.tokens.output).toLocaleString()} />
        <KV k="累计费用" v={`¥${task.costCny.toFixed(4)}`} accent />
      </Section>

      <Section index="02" title="阶段明细">
        {stages.map((s) => (
          <div
            key={s.stage}
            className="flex items-center justify-between"
            style={{
              padding: '6px 0',
              borderBottom: '1px solid var(--divider, var(--border-subtle))',
              fontSize: '11px',
            }}
          >
            <div className="flex items-center gap-2">
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: getStageColor(s.stage),
                  display: 'inline-block',
                }}
              />
              <span style={{ color: 'var(--text-primary)' }}>{getStageLabel(s.stage)}</span>
              <span style={{ color: 'var(--text-faint)' }}>×{s.count}</span>
            </div>
            <div style={{ color: 'var(--text-muted)' }}>
              {(s.inputTokens + s.outputTokens).toLocaleString()} tk · ¥{s.costCny.toFixed(4)}
            </div>
          </div>
        ))}
      </Section>
    </div>
  )
}

function EventDetail({ event, task }) {
  return (
    <div>
      <Section index="01" title="调用详情">
        <div className="flex items-center gap-2 mb-2">
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: getStageColor(event.stage),
              display: 'inline-block',
            }}
          />
          <span
            style={{
              fontFamily: '"Noto Serif SC", Georgia, serif',
              fontSize: '14px',
              color: 'var(--text-primary)',
            }}
          >
            {getStageLabel(event.stage)}
          </span>
          {event.estimated && (
            <span
              style={{
                fontSize: '9px',
                padding: '1px 6px',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-faint)',
                letterSpacing: '0.1em',
              }}
            >
              ESTIMATED
            </span>
          )}
        </div>
        <KV k="时间" v={fmtTime(event.timestamp)} />
        <KV k="Provider" v={event.provider} />
        <KV k="Model" v={event.model} mono />
        <KV k="Input tokens" v={(event.inputTokens || 0).toLocaleString()} />
        <KV k="Output tokens" v={(event.outputTokens || 0).toLocaleString()} />
        <KV k="费用 (CNY)" v={`¥${(event.costCny || 0).toFixed(6)}`} accent />
        <KV k="费用 (USD)" v={`$${(event.costUsd || 0).toFixed(6)}`} />
      </Section>

      {task && (
        <Section index="02" title="所属任务">
          <KV k="Task ID" v={shortId(task.taskId)} mono />
          <KV k="持续" v={fmtDuration(task.duration)} />
          <KV k="调用 #" v={`${task.events.indexOf(event) + 1} / ${task.eventCount}`} />
        </Section>
      )}
    </div>
  )
}

function Section({ index, title, children }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div
        style={{
          fontSize: '9px',
          letterSpacing: '0.35em',
          color: 'var(--accent)',
          marginBottom: '4px',
        }}
      >
        {index} / {title.toUpperCase()}
      </div>
      <h3
        style={{
          margin: '0 0 8px',
          fontFamily: '"Noto Serif SC", Georgia, serif',
          fontSize: '13px',
          color: 'var(--text-primary)',
          letterSpacing: '0.02em',
          fontWeight: 500,
        }}
      >
        {title}
      </h3>
      <div>{children}</div>
    </div>
  )
}

function KV({ k, v, mono = false, accent = false }) {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: '4px 0',
        fontSize: '11px',
      }}
    >
      <span style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{k}</span>
      <span
        style={{
          color: accent ? 'var(--accent)' : 'var(--text-primary)',
          fontFamily: mono
            ? '"Fira Code", "Consolas", monospace'
            : '"Noto Sans SC", system-ui, sans-serif',
        }}
      >
        {v}
      </span>
    </div>
  )
}
