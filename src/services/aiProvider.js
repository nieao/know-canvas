/**
 * AI Provider 调用层 — 统一 callLLM 接口
 *
 * 上游：aiService.js（业务函数 extractConcepts / suggestRelations 等）
 * 下游：aiConfig 选定的 provider（claude-cli / openai-like / mock）
 */

import { getActiveProvider } from './aiConfig'

/** 通用 LLM 调用 */
export async function callLLM({ system, prompt, model, temperature = 0.3, jsonMode = false }) {
  const provider = getActiveProvider()
  switch (provider.type) {
    case 'vps-proxy':
      return callVpsProxy({
        system,
        prompt,
        model: model || provider.config.model,
        temperature,
        jsonMode,
        proxyUrl: provider.config.proxyUrl,
      })
    case 'claude-cli':
      return callClaudeCli({ system, prompt, model: model || provider.config.model, bridgeUrl: provider.config.bridgeUrl })
    case 'openai-like':
      return callOpenAiLike({
        system,
        prompt,
        model: model || provider.config.model,
        temperature,
        jsonMode,
        baseURL: provider.config.baseURL,
        apiKey: provider.config.apiKey,
      })
    case 'mock':
    default:
      return ''
  }
}

/** 检测当前 provider 是否可用 */
export async function checkProvider() {
  const provider = getActiveProvider()
  try {
    if (provider.type === 'vps-proxy') {
      const url = (provider.config.proxyUrl || '/canvas/api/llm') + '/health'
      const resp = await fetch(url, { method: 'GET' })
      const data = await resp.json().catch(() => ({}))
      return { ok: resp.ok && data.ok, providerId: provider.id, detail: data }
    }
    if (provider.type === 'claude-cli') {
      const url = (provider.config.bridgeUrl || 'http://127.0.0.1:18080') + '/health'
      const resp = await fetch(url, { method: 'GET' })
      const data = await resp.json()
      return { ok: resp.ok && data.hasClaude, providerId: provider.id, detail: data }
    }
    if (provider.type === 'openai-like') {
      if (!provider.config.baseURL) return { ok: false, providerId: provider.id, detail: '缺少 baseURL' }
      if (!provider.config.apiKey) return { ok: false, providerId: provider.id, detail: '缺少 apiKey' }
      // 真正发一个最小 ping（避免烧 token：仅 1 token max_tokens）
      const text = await callOpenAiLike({
        system: '',
        prompt: 'ping',
        model: provider.config.model,
        baseURL: provider.config.baseURL,
        apiKey: provider.config.apiKey,
        maxTokens: 4,
      })
      return { ok: !!text, providerId: provider.id, detail: text || '空响应' }
    }
    if (provider.type === 'mock') return { ok: true, providerId: 'mock', detail: '本地规则解析' }
  } catch (e) {
    return { ok: false, providerId: provider.id, detail: e.message }
  }
  return { ok: false, providerId: provider.id, detail: '未知 provider' }
}

// ============================================================
// VPS LLM 代理 (同源, 凭据保管在服务端 systemd)
// 端点: POST {proxyUrl}/chat → { ok, text, model, usage }
// ============================================================

async function callVpsProxy({ system, prompt, model, temperature, jsonMode, proxyUrl }) {
  const url = (proxyUrl || '/canvas/api/llm').replace(/\/$/, '') + '/chat'
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ system, prompt, model, temperature, jsonMode }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`vps-proxy ${resp.status}: ${text.slice(0, 200) || resp.statusText}`)
  }
  const data = await resp.json()
  if (!data.ok) throw new Error(data.error || 'vps-proxy 返回失败')
  return data.text || ''
}

// ============================================================
// Claude CLI 桥
// ============================================================

async function callClaudeCli({ system, prompt, model, bridgeUrl }) {
  const url = (bridgeUrl || 'http://127.0.0.1:18080') + '/chat'
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ system, prompt, model }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`claude-bridge ${resp.status}: ${text || resp.statusText}`)
  }
  const data = await resp.json()
  if (!data.ok) throw new Error(data.error || 'claude-bridge 返回失败')
  return data.text || ''
}

// ============================================================
// OpenAI 兼容协议
// ============================================================

async function callOpenAiLike({ system, prompt, model, temperature = 0.3, jsonMode = false, baseURL, apiKey, maxTokens }) {
  if (!baseURL) throw new Error('未配置 baseURL')
  if (!apiKey) throw new Error('未配置 apiKey')

  const url = baseURL.replace(/\/$/, '') + '/chat/completions'
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })

  const body = {
    model,
    messages,
    temperature,
    stream: false,
  }
  if (typeof maxTokens === 'number') body.max_tokens = maxTokens
  if (jsonMode) body.response_format = { type: 'json_object' }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`${model} ${resp.status}: ${text.slice(0, 300)}`)
  }
  const data = await resp.json()
  // 兼容大多数厂商：choices[0].message.content
  const text = data?.choices?.[0]?.message?.content || ''
  return text
}
