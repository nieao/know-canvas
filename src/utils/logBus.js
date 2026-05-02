/**
 * 前端全流程日志总线 — 简单 EventEmitter + ring buffer
 *
 * 谁会往里写：
 *   - actionLog.logAction()           → 用户左右面板动作
 *   - aletheia runner onProgress      → 决策引擎进度
 *   - localTaskExecutor onUpdate      → 本地任务状态变化
 *   - yjsClient status / sync         → 协作连接状态
 *   - 任何 console.log / console.warn 桥接（可选, 见 attachConsoleBridge）
 *
 * 谁会读：
 *   - CliMonitor 浮动监控面板（订阅 onAppend）
 *   - 用户调试时手动 window.__logBus.dump() 打 console
 *
 * 设计：单例, ring buffer 1000 条, 老的自动丢弃。
 */

const MAX = 1000
const buf = []
const listeners = new Set()

/**
 * 写一条日志
 * @param {object} entry
 *   - level: 'debug'|'info'|'warn'|'error'
 *   - source: 'action'|'aletheia'|'task'|'yjs'|'console'|...
 *   - msg: 主文本
 *   - data: 任意 payload (可选)
 */
export function pushLog(entry) {
  const e = {
    ts: Date.now(),
    level: entry.level || 'info',
    source: entry.source || 'misc',
    msg: entry.msg || '',
    data: entry.data,
  }
  buf.push(e)
  if (buf.length > MAX) buf.shift()
  for (const fn of listeners) {
    try { fn(e) } catch (_e) {}
  }
}

/** 订阅新日志（返回取消函数） */
export function onAppend(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 取当前全部日志（拷贝） */
export function getAll() {
  return buf.slice()
}

/** 清空 */
export function clear() {
  buf.length = 0
  for (const fn of listeners) {
    try { fn({ ts: Date.now(), level: 'info', source: 'bus', msg: '<cleared>' }) } catch (_e) {}
  }
}

/** 导出文本 */
export function exportText() {
  return buf.map((e) => {
    const t = new Date(e.ts).toISOString().slice(11, 23)
    const head = `[${t}] [${e.level.toUpperCase()}] [${e.source}] ${e.msg}`
    return e.data ? `${head}\n  ${JSON.stringify(e.data)}` : head
  }).join('\n')
}

/** 把 console.log/warn/error 桥接到 logBus（可选, dev 友好） */
export function attachConsoleBridge() {
  if (typeof window === 'undefined') return
  if (window.__logBusConsoleAttached) return
  window.__logBusConsoleAttached = true
  const origLog = console.log
  const origWarn = console.warn
  const origErr = console.error
  console.log = (...args) => { origLog(...args); pushLog({ level: 'info', source: 'console', msg: args.map(stringify).join(' ') }) }
  console.warn = (...args) => { origWarn(...args); pushLog({ level: 'warn', source: 'console', msg: args.map(stringify).join(' ') }) }
  console.error = (...args) => { origErr(...args); pushLog({ level: 'error', source: 'console', msg: args.map(stringify).join(' ') }) }
}

function stringify(v) {
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return String(v) }
}

// 暴露给 window 方便 devtools 调试
if (typeof window !== 'undefined') {
  window.__logBus = { pushLog, getAll, clear, exportText, onAppend, attachConsoleBridge }
}
