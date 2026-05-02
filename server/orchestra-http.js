/**
 * Orchestra HTTP 派单台 — 不依赖前端的 auto TaskNode 注入入口
 *
 * 启动: node server/orchestra-http.js  (默认端口 17082)
 *
 * 提供两套 surface:
 *   1. POST /api/orchestra/inject  — 派 auto TaskNode 到指定 room (供脚本/curl 使用)
 *   2. GET  /                      — 简易派单台 HTML 页面 (建筑极简风格)
 *   3. GET  /api/orchestra/list    — 列 room 所有 task/result 状态 (轮询)
 *
 * 内部维护 room → Y.Doc client 池, 懒连接 (第一次访问该 room 时连)。
 *
 * 架构定位: 既不是 hermes-proxy 的替代, 也不是 dispatcher 的替代,
 *           只是给"还没 UI 的 auto TaskNode"开一个入口让用户能动手。
 */

const http = require('http')
const Y = require('yjs')
const WS = require('ws')
const { WebsocketProvider } = require('y-websocket')

const PORT = parseInt(process.env.ORCHESTRA_HTTP_PORT || '17082', 10)
const HOST = process.env.ORCHESTRA_HTTP_HOST || '127.0.0.1'
const WS_URL = process.env.ORCHESTRA_WS_URL || 'ws://127.0.0.1:1234'
const CONDUCTOR_URL = process.env.CONDUCTOR_URL || 'http://127.0.0.1:17083'

/** 通知 conductor 新 room 需要被服务 — 失败不影响 inject (room 可能已被服务) */
async function notifyConductor(roomId, source) {
  try {
    const r = await fetch(`${CONDUCTOR_URL}/conductor/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: roomId, source }),
    })
    if (!r.ok) console.warn(`[orchestra-http] conductor notify failed: ${r.status}`)
  } catch (e) {
    // conductor 没起 — 老式 dispatcher/worker 模式仍可用
  }
}

// room → { ydoc, provider, nodesMap, edgesMap, lastUsed }
const rooms = new Map()
const ROOM_IDLE_MS = 30 * 60 * 1000  // 闲置 30 分钟回收连接

function getRoom(roomId) {
  let r = rooms.get(roomId)
  if (r) {
    r.lastUsed = Date.now()
    return r
  }
  const ydoc = new Y.Doc()
  const provider = new WebsocketProvider(WS_URL, roomId, ydoc, { WebSocketPolyfill: WS, connect: true })
  provider.awareness.setLocalStateField('user', { name: 'orchestra-http', color: '#aaa', isAgent: true })
  r = {
    ydoc,
    provider,
    nodesMap: ydoc.getMap('nodes'),
    edgesMap: ydoc.getMap('edges'),
    lastUsed: Date.now(),
  }
  rooms.set(roomId, r)
  console.log(`[orchestra-http] connected room=${roomId}`)
  return r
}

setInterval(() => {
  const now = Date.now()
  for (const [id, r] of rooms.entries()) {
    if (now - r.lastUsed > ROOM_IDLE_MS) {
      try { r.provider.destroy() } catch (_e) {}
      rooms.delete(id)
      console.log(`[orchestra-http] gc room=${id} (idle)`)
    }
  }
}, 5 * 60 * 1000)

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.setEncoding('utf8')
    req.on('data', (c) => {
      buf += c
      if (buf.length > 256 * 1024) { req.destroy(); reject(new Error('payload too large')) }
    })
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function jsonRes(res, status, body) {
  setCors(res)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { setCors(res); res.writeHead(204); res.end(); return }

  // ----- GET / → 派单台 HTML -----
  if (req.url === '/' || req.url === '/console') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(CONSOLE_HTML)
    return
  }

  // ----- GET /health -----
  if (req.url === '/health' && req.method === 'GET') {
    return jsonRes(res, 200, {
      ok: true,
      service: 'orchestra-http',
      port: PORT,
      ws_url: WS_URL,
      rooms_connected: Array.from(rooms.keys()),
    })
  }

  // ----- POST /api/orchestra/inject -----
  if (req.url === '/api/orchestra/inject' && req.method === 'POST') {
    let body
    try { body = await readJson(req) } catch (e) { return jsonRes(res, 400, { ok: false, error: e.message }) }
    const { room, title, body: taskBody, assignedTo, hermesAssignee } = body || {}
    if (!room || !title || !assignedTo) {
      return jsonRes(res, 400, { ok: false, error: '需要 room + title + assignedTo' })
    }
    try {
      const r = getRoom(room)
      // 等 ws 连上 (首次连接 sync 完成)
      if (!r._synced) {
        await new Promise((resolve) => {
          const onSync = () => { r._synced = true; resolve() }
          r.provider.once('sync', onSync)
          setTimeout(() => { if (!r._synced) resolve() }, 2000)  // 兜底超时
        })
      }
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      // 简单布局: x = 已有 task 数 * 320, y = 200
      let existingTasks = 0
      for (const n of r.nodesMap.values()) if (n?.type === 'taskNode') existingTasks++
      const node = {
        id: taskId,
        type: 'taskNode',
        position: { x: 100 + (existingTasks % 4) * 320, y: 100 + Math.floor(existingTasks / 4) * 220 },
        data: {
          title,
          body: taskBody || '',
          status: 'draft',
          agentMode: 'auto',
          assignedTo,
          hermesAssignee: hermesAssignee || null,
          createdBy: 'orchestra-http',
          createdAt: new Date().toISOString(),
        },
      }
      r.ydoc.transact(() => r.nodesMap.set(taskId, node), 'orchestra-http-inject')
      console.log(`[orchestra-http] injected ${taskId} → room=${room} assignedTo=${assignedTo}`)
      notifyConductor(room, 'inject')
      return jsonRes(res, 200, { ok: true, taskId, node })
    } catch (e) {
      return jsonRes(res, 500, { ok: false, error: e.message })
    }
  }

  // ----- POST /api/orchestra/inject-chain -----
  // 一次写多个 task + edge, 视觉演示用 (6 节点 DAG)
  // body: { room, assignedTo, hermesAssignee?, theme? }
  if (req.url === '/api/orchestra/inject-chain' && req.method === 'POST') {
    let body
    try { body = await readJson(req) } catch (e) { return jsonRes(res, 400, { ok: false, error: e.message }) }
    const { room, assignedTo = 'hermes', hermesAssignee = null, theme = '调研开源画布工具' } = body || {}
    if (!room) return jsonRes(res, 400, { ok: false, error: '需要 room' })

    try {
      const r = getRoom(room)
      if (!r._synced) {
        await new Promise((resolve) => {
          const onSync = () => { r._synced = true; resolve() }
          r.provider.once('sync', onSync)
          setTimeout(() => { if (!r._synced) resolve() }, 2000)
        })
      }

      const ts = Date.now()
      const baseX = 200, baseY = 100
      const dx = 320, dy = 220
      // DAG: root → (A, B, C 并行) → (A1, B1 后续, C 自己结束)
      //  root @ (baseX+dx*1, baseY)
      //   A @ (baseX, baseY+dy)            ← root
      //   B @ (baseX+dx, baseY+dy)         ← root
      //   C @ (baseX+dx*2, baseY+dy)       ← root
      //   A1 @ (baseX, baseY+dy*2)         ← A
      //   B1 @ (baseX+dx, baseY+dy*2)      ← B
      const layout = [
        { key: 'root', title: `${theme} · 拆分子任务`,    body: '把研究主题拆成 3 个子方向', x: baseX + dx, y: baseY },
        { key: 'A',    title: '抓 tldraw 资料',          body: '搜集 tldraw 的核心特性 / 限制', x: baseX,        y: baseY + dy },
        { key: 'B',    title: '抓 excalidraw 资料',     body: '搜集 excalidraw 的核心特性 / 限制', x: baseX + dx,   y: baseY + dy },
        { key: 'C',    title: 'know-canvas 自评',       body: '自家有什么独特能力',                x: baseX + dx*2, y: baseY + dy },
        { key: 'A1',   title: '总结 tldraw 优劣',       body: '对照 know-canvas 找差异点',          x: baseX,        y: baseY + dy*2 },
        { key: 'B1',   title: '总结 excalidraw 优劣',  body: '对照 know-canvas 找差异点',          x: baseX + dx,   y: baseY + dy*2 },
      ]
      const edges = [
        ['root', 'A'], ['root', 'B'], ['root', 'C'],
        ['A', 'A1'], ['B', 'B1'],
      ]

      // key → real id
      const ids = {}
      for (const item of layout) {
        ids[item.key] = `task-${ts}-${item.key}-${Math.random().toString(36).slice(2, 5)}`
      }

      r.ydoc.transact(() => {
        for (const item of layout) {
          r.nodesMap.set(ids[item.key], {
            id: ids[item.key],
            type: 'taskNode',
            position: { x: item.x, y: item.y },
            data: {
              title: item.title,
              body: item.body,
              status: 'draft',
              agentMode: 'auto',
              assignedTo,
              hermesAssignee,
              createdBy: 'orchestra-http-chain',
              createdAt: new Date().toISOString(),
              chainKey: item.key,
            },
          })
        }
        for (const [from, to] of edges) {
          const eid = `e-${ids[from]}-${ids[to]}`
          r.edgesMap.set(eid, {
            id: eid,
            source: ids[from],
            target: ids[to],
            type: 'default',
            animated: true,
            data: { kind: 'chain-dep' },
          })
        }
      }, 'orchestra-http-inject-chain')

      console.log(`[orchestra-http] injected chain (${layout.length} tasks, ${edges.length} edges) → room=${room}`)
      notifyConductor(room, 'inject-chain')
      return jsonRes(res, 200, { ok: true, taskIds: Object.values(ids), edges: edges.length })
    } catch (e) {
      return jsonRes(res, 500, { ok: false, error: e.message })
    }
  }

  // ----- GET /api/orchestra/list?room=xxx -----
  if (req.url.startsWith('/api/orchestra/list') && req.method === 'GET') {
    const u = new URL(req.url, 'http://localhost')
    const room = u.searchParams.get('room')
    if (!room) return jsonRes(res, 400, { ok: false, error: '需要 ?room=xxx' })
    try {
      const r = getRoom(room)
      const tasks = []
      const results = []
      for (const [, n] of r.nodesMap.entries()) {
        if (n?.type === 'taskNode') {
          const d = n.data || {}
          // 实时 elapsed: running 状态用 now-claimedAt, done/failed 用 totalElapsedMs
          let elapsedMs = null
          if (d.status === 'running' && d.claimedAtMs) {
            elapsedMs = Date.now() - d.claimedAtMs
          } else if (d.totalElapsedMs != null) {
            elapsedMs = d.totalElapsedMs
          } else if (d.progress?.elapsedMs != null) {
            elapsedMs = d.progress.elapsedMs
          }
          tasks.push({
            id: n.id,
            title: d.title,
            status: d.status,
            agentMode: d.agentMode,
            assignedTo: d.assignedTo,
            claimedBy: d.claimedBy,
            createdAt: d.createdAt,
            finishedAt: d.finishedAt,
            error: d.error,
            // 进度 + token + 预计
            elapsedMs,
            etaMs: d.progress?.etaMs ?? null,
            phase: d.progress?.phase ?? null,
            hermesStatus: d.progress?.hermesStatus ?? null,
            hermesTaskId: d.progress?.hermesTaskId ?? null,
            events: d.progress?.events ?? null,
            tokens: d.tokens || d.progress?.tokens || null,
          })
        } else if (n?.type === 'resultNode') {
          results.push({
            id: n.id,
            sourceTaskId: n.data?.sourceTaskId,
            summary: n.data?.summary,
            producedBy: n.data?.producedBy,
          })
        }
      }
      return jsonRes(res, 200, { ok: true, room, tasks, results })
    } catch (e) {
      return jsonRes(res, 500, { ok: false, error: e.message })
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('not found')
})

const CONSOLE_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>Orchestra 派单台 — Know Canvas</title>
<style>
  :root {
    --black: #1a1a1a; --dark: #2d2d2d; --gray-700: #555; --gray-500: #888;
    --gray-300: #bbb; --gray-100: #e8e8e8; --white: #fafafa;
    --warm: #c8a882; --warm-light: #e8d5c0; --warm-bg: #f5f0eb;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Noto Sans SC", system-ui, sans-serif; background: var(--white); color: var(--dark);
         padding: 48px 32px; max-width: 920px; margin: 0 auto; }
  .label { font-size: 0.72rem; letter-spacing: 0.35em; color: var(--warm); text-transform: uppercase; margin-bottom: 16px; }
  h1 { font-family: "Noto Serif SC", Georgia, serif; font-weight: 300; font-size: 2rem; color: var(--black); margin-bottom: 8px; }
  p.sub { color: var(--gray-500); font-size: 0.85rem; margin-bottom: 48px; }
  section { border: 1px solid var(--gray-100); padding: 24px; margin-bottom: 32px; background: rgba(250,250,250,0.9); }
  section h2 { font-family: "Noto Serif SC", serif; font-weight: 400; font-size: 1.1rem; color: var(--black); margin-bottom: 16px; }
  label { display: block; font-size: 0.72rem; letter-spacing: 0.15em; color: var(--gray-500); margin-bottom: 6px; text-transform: uppercase; }
  input, textarea, select {
    width: 100%; padding: 10px 12px; border: 1px solid var(--gray-100); background: white;
    font-family: inherit; font-size: 0.9rem; color: var(--dark); outline: none; margin-bottom: 16px;
    transition: border-color 0.3s;
  }
  input:focus, textarea:focus, select:focus { border-color: var(--warm); }
  textarea { resize: vertical; min-height: 80px; }
  button {
    background: var(--black); color: var(--white); border: none; padding: 12px 28px;
    font-family: inherit; font-size: 0.85rem; letter-spacing: 0.15em; cursor: pointer;
    transition: background 0.3s;
  }
  button:hover { background: var(--warm); }
  button:disabled { background: var(--gray-300); cursor: not-allowed; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--gray-100); font-size: 0.85rem; }
  th { color: var(--gray-500); font-weight: 500; font-size: 0.7rem; letter-spacing: 0.15em; text-transform: uppercase; }
  tr:hover td { background: var(--warm-bg); }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 0.7rem; letter-spacing: 0.1em; }
  .pill.draft { background: #eee; color: #666; }
  .pill.pending { background: var(--warm-bg); color: var(--warm); }
  .pill.running { background: #d6e4ec; color: #4a6c80; }
  .pill.done { background: #dceadb; color: #4a6e3f; }
  .pill.failed { background: #f0d6d6; color: #8c4a4a; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .toast { position: fixed; bottom: 32px; right: 32px; padding: 12px 20px; background: var(--black);
           color: var(--white); font-size: 0.85rem; opacity: 0; transition: opacity 0.3s; }
  .toast.show { opacity: 1; }
  small.muted { color: var(--gray-300); font-size: 0.7rem; }
  .grid-deco { position: fixed; inset: 0; pointer-events: none; opacity: 0.03; z-index: -1; }
  .grid-deco div { position: absolute; background: var(--black); }
</style>
</head>
<body>
<div class="grid-deco">
  <div style="top: 50%; left: 0; right: 0; height: 1px;"></div>
  <div style="top: 0; bottom: 0; left: 50%; width: 1px;"></div>
</div>

<div class="label">Orchestra · 多 agent 协作中枢</div>
<h1>派单台</h1>
<p class="sub">直接向 Y.Doc 黑板注入 auto TaskNode。dispatcher 看到后会推进 ready, agent worker 抢锁开干。<br/>所有动作同步到画布所有客户端。</p>

<section>
  <h2>派一个新任务</h2>
  <form id="form">
    <div class="row">
      <div>
        <label>房间</label>
        <input id="f-room" value="demo-orchestra" />
      </div>
      <div>
        <label>派给哪个 agent</label>
        <select id="f-assigned">
          <option value="hermes">hermes</option>
          <option value="claude-cli">claude-cli (P1)</option>
          <option value="feishu-bot">feishu-bot (P1)</option>
        </select>
      </div>
    </div>
    <label>任务标题</label>
    <input id="f-title" placeholder="例: 调研 5 个竞品" required />
    <label>任务描述 (markdown 可)</label>
    <textarea id="f-body" placeholder="把背景 / 输入 / 期望产物写清楚 ..."></textarea>
    <label>Hermes Profile (可空, 仅 assignedTo=hermes 真模式时用 — 没填会 skipped_unassigned)</label>
    <input id="f-hermes-assignee" placeholder="例: railway-data-analyst" />
    <div style="display:flex; gap:12px; margin-top:8px;">
      <button type="submit">→ 注入到画布</button>
      <button type="button" id="btn-chain" style="background:var(--warm); flex:1;">⚡ DEMO: 一键派 6 节点 DAG</button>
    </div>
  </form>
</section>

<section>
  <h2>实时状态 <small class="muted">(2s 刷新)</small></h2>
  <table>
    <thead><tr><th>任务</th><th>状态</th><th>派给</th><th>已运行 / 预计</th><th>tokens</th><th>结果</th></tr></thead>
    <tbody id="task-tbody"><tr><td colspan="6" style="color:var(--gray-300);text-align:center;padding:24px;">尚无任务</td></tr></tbody>
  </table>
</section>

<div id="toast" class="toast"></div>

<script>
const $ = (id) => document.getElementById(id);

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

$('btn-chain').addEventListener('click', async () => {
  const room = $('f-room').value.trim();
  const assignedTo = $('f-assigned').value;
  const hermesAssignee = $('f-hermes-assignee').value.trim() || null;
  if (!room) return toast('需要 room');
  const r = await fetch('/api/orchestra/inject-chain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, assignedTo, hermesAssignee, theme: '调研开源画布工具' }),
  });
  const j = await r.json();
  if (j.ok) {
    toast('派出 ' + j.taskIds.length + ' 节点 DAG, 看画布!');
    refresh();
  } else {
    toast('失败: ' + j.error);
  }
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const room = $('f-room').value.trim();
  const title = $('f-title').value.trim();
  const body = $('f-body').value;
  const assignedTo = $('f-assigned').value;
  const hermesAssignee = $('f-hermes-assignee').value.trim() || null;
  if (!room || !title) return;
  const r = await fetch('/api/orchestra/inject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, title, body, assignedTo, hermesAssignee }),
  });
  const j = await r.json();
  if (j.ok) {
    toast('任务已派出: ' + j.taskId);
    $('f-title').value = '';
    $('f-body').value = '';
    refresh();
  } else {
    toast('失败: ' + j.error);
  }
});

async function refresh() {
  const room = $('f-room').value.trim();
  if (!room) return;
  try {
    const r = await fetch('/api/orchestra/list?room=' + encodeURIComponent(room));
    const j = await r.json();
    if (!j.ok) return;
    const tbody = $('task-tbody');
    if (!j.tasks.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--gray-300);text-align:center;padding:24px;">尚无任务</td></tr>';
      return;
    }
    const resultsByTask = {};
    for (const r of j.results) {
      if (!resultsByTask[r.sourceTaskId]) resultsByTask[r.sourceTaskId] = [];
      resultsByTask[r.sourceTaskId].push(r);
    }
    tbody.innerHTML = j.tasks.map(t => {
      const result = (resultsByTask[t.id] || []).map(r => r.summary).join('; ');
      const elapsed = t.elapsedMs != null ? fmtDur(t.elapsedMs) : '-';
      const eta = t.etaMs != null && t.status === 'running' ? '~' + fmtDur(t.etaMs) : '';
      const hermesPhase = t.hermesStatus ? ' · ' + escapeHtml(t.hermesStatus) : '';
      const tokenStr = t.tokens
        ? \`<span title="模型 \${escapeHtml(t.tokens.model || '?')}">in <strong>\${t.tokens.input ?? '?'}</strong> · out <strong>\${t.tokens.output ?? '?'}</strong> · 总 \${t.tokens.total ?? '?'}</span>\`
        : '<small class="muted">-</small>';
      return \`<tr>
        <td><strong>\${escapeHtml(t.title || '(无标题)')}</strong><br/>
            <small class="muted">\${t.id}\${hermesPhase}</small></td>
        <td><span class="pill \${t.status}">\${t.status}</span><br/><small class="muted">\${escapeHtml(t.claimedBy || '-')}</small></td>
        <td>\${escapeHtml(t.assignedTo || '')}</td>
        <td><strong>\${elapsed}</strong>\${eta ? '<br/><small class="muted">预计 ' + eta + '</small>' : ''}</td>
        <td>\${tokenStr}</td>
        <td><small>\${escapeHtml(result || (t.error ? '错误: ' + t.error : ''))}</small></td>
      </tr>\`;
    }).join('');
  } catch (e) {
    console.error(e);
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
}

function fmtDur(ms) {
  if (ms == null || isNaN(ms)) return '-';
  if (ms < 1000) return ms + 'ms';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + 'm' + (r ? r + 's' : '');
}

setInterval(refresh, 2000);
refresh();
</script>
</body>
</html>`

server.listen(PORT, HOST, () => {
  console.log(`[orchestra-http] listening on http://${HOST}:${PORT}`)
  console.log(`[orchestra-http] ws backend: ${WS_URL}`)
  console.log(`[orchestra-http] open http://${HOST}:${PORT}/ for the dispatch console`)
})

function shutdown(signal) {
  console.log(`\n[orchestra-http] ${signal}, shutting down...`)
  for (const r of rooms.values()) {
    try { r.provider.destroy() } catch (_e) {}
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
