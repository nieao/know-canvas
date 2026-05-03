/**
 * VPS LLM Proxy — 把前端 /canvas/api/llm/chat 请求转发到 DeepSeek (或其它 OpenAI 兼容 endpoint)
 *
 * 凭据保管在 systemd 环境变量, 不暴露给浏览器
 *
 * 环境变量:
 *   PORT          监听端口 (默认 17080)
 *   HOST          监听 host (默认 127.0.0.1)
 *   LLM_BASE_URL  上游 base URL (默认 https://api.deepseek.com/v1)
 *   LLM_API_KEY   API key (必填)
 *   LLM_MODEL     默认 model (默认 deepseek-chat)
 *
 * 前端契约:
 *   POST /chat   { system, prompt, model, temperature, jsonMode } → { ok, text, model, usage }
 *   GET  /health → { ok: true, model, baseUrl }
 */

import http from 'node:http'

const PORT = Number(process.env.PORT) || 17080
const HOST = process.env.HOST || '127.0.0.1'
const BASE_URL = (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '')
const API_KEY = process.env.LLM_API_KEY || ''
const DEFAULT_MODEL = process.env.LLM_MODEL || 'deepseek-chat'

if (!API_KEY) {
  console.error('[vps-llm-proxy] FATAL: 缺少 LLM_API_KEY 环境变量')
  process.exit(1)
}

const log = (...a) => console.log(new Date().toISOString(), '[llm-proxy]', ...a)

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(body))
}

async function handleChat(req, res) {
  let body
  try { body = await readJson(req) }
  catch (e) { return send(res, 400, { ok: false, error: '请求体不是合法 JSON' }) }

  const { system, prompt, model, temperature = 0.3, jsonMode = false } = body
  if (!prompt || typeof prompt !== 'string') {
    return send(res, 400, { ok: false, error: 'prompt 必填' })
  }

  const messages = []
  if (system) messages.push({ role: 'system', content: String(system) })
  messages.push({ role: 'user', content: String(prompt) })

  const payload = {
    model: model || DEFAULT_MODEL,
    messages,
    temperature: Number(temperature) || 0.3,
    stream: false,
  }
  if (jsonMode) payload.response_format = { type: 'json_object' }

  const t0 = Date.now()
  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await upstream.json().catch(() => null)
    if (!upstream.ok || !data) {
      log(`upstream ${upstream.status} model=${payload.model}`)
      return send(res, upstream.status || 502, {
        ok: false,
        error: `上游 ${upstream.status}: ${data?.error?.message || upstream.statusText}`,
      })
    }
    const text = data?.choices?.[0]?.message?.content || ''
    const usage = data?.usage || null
    const elapsed = Date.now() - t0
    log(`ok ${payload.model} ${usage?.prompt_tokens || '?'}+${usage?.completion_tokens || '?'} tk ${elapsed}ms`)
    return send(res, 200, { ok: true, text, model: payload.model, usage })
  } catch (err) {
    log(`error ${err.message}`)
    return send(res, 502, { ok: false, error: '上游调用失败: ' + err.message })
  }
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    return res.end()
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, model: DEFAULT_MODEL, baseUrl: BASE_URL })
  }
  if (req.method === 'POST' && url.pathname === '/chat') {
    return handleChat(req, res)
  }
  send(res, 404, { ok: false, error: 'Not found · 支持 POST /chat 和 GET /health' })
})

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}  upstream=${BASE_URL}  model=${DEFAULT_MODEL}`)
})
