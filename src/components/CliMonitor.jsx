/**
 * CliMonitor — 画布右下角 CLI 全流程监控折叠面板
 *
 * 订阅 logBus 实时显示用户左右面板动作 + Aletheia 进度 + 本地任务 + yjs 状态。
 * 折叠时只露一个小条, 展开后是全屏右侧 384px 宽抽屉, 黑底等宽字体。
 *
 * 操作:
 *   - 点条头 toggle 展开/折叠
 *   - 清空 / 复制全部 / 下载 .txt
 *   - 过滤等级 (info/warn/error/all)
 *   - 跟随最新 (auto-scroll)
 */

import { useEffect, useRef, useState } from 'react'
import { onAppend, getAll, clear, exportText, pushLog } from '../utils/logBus'

const LEVEL_COLOR = {
  debug: '#888',
  info: '#9ec3d8',
  warn: '#e8d5c0',
  error: '#d27b7b',
}
const SOURCE_COLOR = {
  action: '#c8a882',
  aletheia: '#a78bfa',
  task: '#7bc47f',
  yjs: '#7c9eb2',
  console: '#888',
  bus: '#555',
  net: '#d27b7b',
  misc: '#bbb',
}

export default function CliMonitor() {
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState(() => getAll())
  const [filter, setFilter] = useState('all')  // all | info | warn | error
  const [autoScroll, setAutoScroll] = useState(true)
  const [paused, setPaused] = useState(false)
  const scrollRef = useRef(null)

  // 订阅 logBus — 用 queueMicrotask 把 setLogs 推到渲染栈之外
  // (logBus.pushLog 桥接了 console.log, 其它组件渲染期间 console 输出会同步触发, 直接 setState 会引发 setState-in-render)
  useEffect(() => {
    let pending = []
    let scheduled = false
    const flush = () => {
      if (pending.length === 0) { scheduled = false; return }
      const batch = pending
      pending = []
      scheduled = false
      setLogs((prev) => {
        const merged = prev.concat(batch)
        return merged.length > 1000 ? merged.slice(-1000) : merged
      })
    }
    const off = onAppend((e) => {
      if (paused) return
      pending.push(e)
      if (!scheduled) {
        scheduled = true
        queueMicrotask(flush)
      }
    })
    return off
  }, [paused])

  // auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // 过滤后日志
  const filtered = filter === 'all' ? logs : logs.filter((e) => e.level === filter)

  // 错误数 / 警告数（折叠时显示徽章）
  const errCount = logs.filter((e) => e.level === 'error').length
  const warnCount = logs.filter((e) => e.level === 'warn').length

  const handleClear = () => { clear(); setLogs([]) }
  const handleCopy = () => {
    navigator.clipboard?.writeText(exportText()).then(
      () => pushLog({ level: 'info', source: 'bus', msg: '已复制 ' + logs.length + ' 行到剪贴板' }),
      () => pushLog({ level: 'warn', source: 'bus', msg: '复制失败（剪贴板权限被拒）' }),
    )
  }
  const handleDownload = () => {
    const blob = new Blob([exportText()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `know-canvas-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 折叠态 — 右下角小条
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        // 抬到 CostMeterChip (bottom 12 right 12) 上方, 不重叠
        className="absolute z-40 flex items-center gap-2 px-3 py-1.5 rounded-md shadow-lg transition-all hover:translate-y-[-2px]"
        style={{
          bottom: 56,
          right: 12,
          background: '#1a1a1a',
          color: '#fafafa',
          border: '1px solid #2d2d2d',
          fontFamily: '"Courier New", monospace',
          fontSize: 11,
          letterSpacing: '0.05em',
        }}
        title="展开 CLI 监控面板"
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: errCount > 0 ? '#d27b7b' : warnCount > 0 ? '#e8d5c0' : '#7bc47f' }}
        />
        <span>CLI 监控</span>
        <span style={{ color: '#888' }}>{logs.length}</span>
        {errCount > 0 && <span style={{ color: '#d27b7b' }}>!{errCount}</span>}
      </button>
    )
  }

  return (
    <div
      className="absolute top-0 right-0 bottom-0 z-40 flex flex-col"
      style={{
        width: 420,
        background: '#0f0f0f',
        color: '#e0e0e0',
        borderLeft: '1px solid #2d2d2d',
        fontFamily: '"Courier New", "Consolas", monospace',
        fontSize: 11,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: '#1a1a1a', borderBottom: '1px solid #2d2d2d' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: paused ? '#888' : '#c8a882' }}
          />
          <span style={{ color: '#c8a882', letterSpacing: '0.25em', fontSize: 10 }}>CLI 全流程监控</span>
          <span style={{ color: '#666', fontSize: 10 }}>({logs.length}/1000)</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="px-2 py-0.5 rounded"
          style={{ color: '#888', fontSize: 14 }}
          title="折叠"
        >
          —
        </button>
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center gap-1 px-2 py-1.5"
        style={{ background: '#161616', borderBottom: '1px solid #2d2d2d', fontSize: 10 }}
      >
        {['all', 'info', 'warn', 'error'].map((lv) => (
          <button
            key={lv}
            onClick={() => setFilter(lv)}
            className="px-2 py-0.5 rounded"
            style={{
              background: filter === lv ? '#2d2d2d' : 'transparent',
              color: filter === lv ? '#fafafa' : '#888',
              border: '1px solid ' + (filter === lv ? '#3a3a3a' : 'transparent'),
            }}
          >
            {lv}
          </button>
        ))}
        <span style={{ color: '#444', margin: '0 4px' }}>|</span>
        <button onClick={() => setPaused((p) => !p)} className="px-2 py-0.5 rounded" style={{ color: paused ? '#e8d5c0' : '#888' }}>
          {paused ? '▶' : '⏸'}
        </button>
        <button onClick={() => setAutoScroll((a) => !a)} className="px-2 py-0.5 rounded" style={{ color: autoScroll ? '#7bc47f' : '#888' }}>
          {autoScroll ? '↓ 跟随' : '↓ 暂停'}
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={handleCopy} className="px-2 py-0.5 rounded" style={{ color: '#888' }} title="复制全部">⎘</button>
        <button onClick={handleDownload} className="px-2 py-0.5 rounded" style={{ color: '#888' }} title="下载 .txt">⬇</button>
        <button onClick={handleClear} className="px-2 py-0.5 rounded" style={{ color: '#d27b7b' }} title="清空">×</button>
      </div>

      {/* Logs */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-1" style={{ scrollbarWidth: 'thin' }}>
        {filtered.length === 0 ? (
          <div style={{ color: '#444', padding: 16, textAlign: 'center', fontSize: 11 }}>
            {logs.length === 0 ? '暂无日志…\n左右面板任意操作都会出现在这里' : '<当前过滤无匹配>'}
          </div>
        ) : (
          filtered.map((e, i) => {
            const t = new Date(e.ts).toISOString().slice(11, 23)
            return (
              <div key={i} style={{ marginBottom: 2, lineHeight: 1.5, wordBreak: 'break-word' }}>
                <span style={{ color: '#555' }}>{t}</span>
                {' '}
                <span style={{ color: LEVEL_COLOR[e.level] || '#bbb' }}>{e.level.toUpperCase().padEnd(5)}</span>
                {' '}
                <span style={{ color: SOURCE_COLOR[e.source] || '#888' }}>[{e.source}]</span>
                {' '}
                <span style={{ color: '#e0e0e0' }}>{e.msg}</span>
                {e.data && (
                  <pre style={{ color: '#7c9eb2', marginLeft: 16, fontSize: 10, whiteSpace: 'pre-wrap', marginTop: 1 }}>
                    {JSON.stringify(e.data, null, 0)}
                  </pre>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
