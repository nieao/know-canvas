/**
 * HistoryLibrary — LeftPanel "历史" tab 内容
 *
 * 实时显示用户操作历史 + 系统日志（订阅 logBus）。
 * 支持搜索、按 level 多选筛选、点行展开详情。
 *
 * 数据源: src/utils/logBus.js
 *   - getAll() 拉初始
 *   - onAppend(fn) 订阅新增, 返回取消函数
 *   - LogEntry: { ts, level, source, msg, data }
 *
 * 设计风格: 建筑极简（var() token, 1px 细线, 暖色点缀, 无硬编码颜色）
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { onAppend, getAll } from '../../utils/logBus'

const MAX_LIST = 200
const ALL_LEVELS = ['info', 'warn', 'error', 'debug']

// level → 左侧色条颜色（var token）
const LEVEL_BAR = {
  info: 'var(--severity-low)',
  warn: 'var(--severity-medium)',
  error: 'var(--severity-critical)',
  debug: 'var(--text-faint)',
}

// level → label（中文）
const LEVEL_LABEL = {
  info: '信息',
  warn: '警告',
  error: '错误',
  debug: '调试',
}

// 相对时间格式化（中文）
function fmtRelative(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 1) return '刚刚'
  if (sec < 60) return sec + '秒前'
  if (sec < 3600) return Math.floor(sec / 60) + '分前'
  if (sec < 86400) return Math.floor(sec / 3600) + '小时前'
  return Math.floor(sec / 86400) + '天前'
}

// 完整时间（用于展开详情）
function fmtFull(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function HistoryLibrary() {
  // 初始化时反序，最新在前
  const [logs, setLogs] = useState(() => {
    const all = getAll()
    return all.slice(-MAX_LIST).reverse()
  })
  const [keyword, setKeyword] = useState('')
  const [activeLevels, setActiveLevels] = useState(new Set(ALL_LEVELS)) // 默认全选
  const [expandedKey, setExpandedKey] = useState(null) // ts+idx 拼接
  const [, setTick] = useState(0) // 强制 60s 重渲染（更新相对时间）
  const inputRef = useRef(null)

  // 订阅新日志
  useEffect(() => {
    const off = onAppend((e) => {
      setLogs((prev) => {
        const next = [e, ...prev]
        if (next.length > MAX_LIST) next.length = MAX_LIST
        return next
      })
    })
    return off
  }, [])

  // 60s 触发一次相对时间重渲染
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  // 筛选 + 搜索（缓存）
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return logs.filter((e) => {
      if (!activeLevels.has(e.level)) return false
      if (!kw) return true
      const msgMatch = (e.msg || '').toLowerCase().includes(kw)
      const srcMatch = (e.source || '').toLowerCase().includes(kw)
      return msgMatch || srcMatch
    })
  }, [logs, keyword, activeLevels])

  // 最新一条时间（stats 用）
  const latestTs = logs.length > 0 ? logs[0].ts : null

  // 切换 level chip
  const toggleLevel = (lv) => {
    setActiveLevels((prev) => {
      const next = new Set(prev)
      if (lv === 'all') {
        // [全部] 行为：如果当前不是全选，则全选；否则清空
        return next.size === ALL_LEVELS.length ? new Set() : new Set(ALL_LEVELS)
      }
      if (next.has(lv)) next.delete(lv)
      else next.add(lv)
      return next
    })
  }

  const isAll = activeLevels.size === ALL_LEVELS.length

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: 'var(--surface)',
        color: 'var(--text-primary)',
        fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif',
      }}
    >
      {/* ====== 顶部：搜索 + 筛选 + stats ====== */}
      <div
        className="flex flex-col gap-2 px-3 py-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        {/* 搜索框 */}
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索操作 / 来源..."
            className="w-full px-3 py-1.5 outline-none transition-colors"
            style={{
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontSize: 12,
              borderRadius: 2,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
          />
          {keyword && (
            <button
              onClick={() => {
                setKeyword('')
                inputRef.current?.focus()
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{
                color: 'var(--text-muted)',
                fontSize: 14,
                lineHeight: 1,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              title="清空"
            >
              ×
            </button>
          )}
        </div>

        {/* level 筛选 chip 行 */}
        <div className="flex items-center gap-1 flex-wrap">
          <Chip active={isAll} onClick={() => toggleLevel('all')}>
            全部
          </Chip>
          {ALL_LEVELS.map((lv) => (
            <Chip
              key={lv}
              active={activeLevels.has(lv)}
              onClick={() => toggleLevel(lv)}
              barColor={LEVEL_BAR[lv]}
            >
              {LEVEL_LABEL[lv]}
            </Chip>
          ))}
        </div>

        {/* stats */}
        <div
          style={{
            color: 'var(--text-muted)',
            fontSize: 11,
            letterSpacing: '0.05em',
          }}
        >
          共 {filtered.length} 条
          {latestTs && (
            <>
              <span style={{ margin: '0 6px', color: 'var(--text-faint)' }}>·</span>
              最新 {fmtRelative(latestTs)}
            </>
          )}
        </div>
      </div>

      {/* ====== 主体：日志 list ====== */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: 'thin' }}
      >
        {filtered.length === 0 ? (
          <div
            className="flex items-center justify-center"
            style={{
              minHeight: 200,
              color: 'var(--text-faint)',
              fontSize: 12,
              padding: 24,
              textAlign: 'center',
            }}
          >
            {logs.length === 0 ? '暂无操作记录' : '当前筛选无匹配结果'}
          </div>
        ) : (
          filtered.map((e, idx) => {
            const key = `${e.ts}-${idx}-${e.source}`
            const expanded = expandedKey === key
            return (
              <LogRow
                key={key}
                entry={e}
                expanded={expanded}
                onToggle={() => setExpandedKey(expanded ? null : key)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

/* ============================================================ */
/*                          子组件                                */
/* ============================================================ */

function Chip({ active, onClick, barColor, children }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 transition-all"
      style={{
        background: active ? 'var(--accent-bg)' : 'transparent',
        border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border-subtle)'),
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: 11,
        letterSpacing: '0.1em',
        borderRadius: 2,
        cursor: 'pointer',
        transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {barColor && (
        <span
          className="inline-block"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: barColor,
          }}
        />
      )}
      {children}
    </button>
  )
}

function LogRow({ entry, expanded, onToggle }) {
  const barColor = LEVEL_BAR[entry.level] || 'var(--text-faint)'
  return (
    <div
      onClick={onToggle}
      className="relative cursor-pointer transition-colors"
      style={{
        borderBottom: '1px solid var(--border-divider)',
        padding: '8px 12px 8px 16px',
        minHeight: 52,
        background: 'transparent',
        transition: 'background 0.3s ease',
      }}
      onMouseEnter={(ev) => (ev.currentTarget.style.background = 'var(--surface-soft)')}
      onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
    >
      {/* 左侧 4px 色条 */}
      <span
        className="absolute left-0 top-0 bottom-0"
        style={{
          width: 4,
          background: barColor,
        }}
      />

      {/* 主文字 */}
      <div
        style={{
          color: 'var(--text-primary)',
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
          overflow: expanded ? 'visible' : 'hidden',
          textOverflow: expanded ? 'clip' : 'ellipsis',
          wordBreak: 'break-word',
        }}
        title={entry.msg}
      >
        {entry.msg || '(空)'}
      </div>

      {/* 副文字 */}
      <div
        className="flex items-center gap-1.5 mt-0.5"
        style={{
          color: 'var(--text-muted)',
          fontSize: 10,
          letterSpacing: '0.05em',
        }}
      >
        <span>{fmtRelative(entry.ts)}</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>{entry.source}</span>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div
          className="mt-2 pt-2"
          style={{
            borderTop: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            fontSize: 11,
            lineHeight: 1.6,
          }}
          onClick={(ev) => ev.stopPropagation()}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span
              style={{
                display: 'inline-block',
                padding: '1px 8px',
                background: barColor,
                color: 'var(--surface)',
                fontSize: 10,
                letterSpacing: '0.1em',
                borderRadius: 2,
              }}
            >
              {LEVEL_LABEL[entry.level] || entry.level}
            </span>
            <span style={{ color: 'var(--text-muted)', fontFamily: '"Courier New", monospace' }}>
              {fmtFull(entry.ts)}
            </span>
          </div>
          <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {entry.msg}
          </div>
          {entry.data !== undefined && entry.data !== null && (
            <pre
              style={{
                marginTop: 6,
                padding: 6,
                background: 'var(--surface-soft)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-muted)',
                fontSize: 10,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: '"Courier New", monospace',
                borderRadius: 2,
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {(() => {
                try {
                  return JSON.stringify(entry.data, null, 2)
                } catch {
                  return String(entry.data)
                }
              })()}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
