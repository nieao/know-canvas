/**
 * AI Provider 调用层 — 统一 callLLM 接口
 *
 * 上游：aiService.js（业务函数 extractConcepts / suggestRelations 等）
 * 下游：aiConfig 选定的 provider（claude-cli / openai-like / mock）
 */

import { getActiveProvider } from './aiConfig'
import { recordLLMCall } from './costMeter'

// 粗估 token 数兜底（provider 没返回 usage 时用）
function estimateTokens(text) {
  if (!text) return 0
  // 中英混合粗估：~3 字符 / token（保守）
  return Math.max(1, Math.ceil(String(text).length / 3))
}

// 把 prompt + system 视作输入合计
function estimateInputTokens(system, prompt) {
  return estimateTokens(system) + estimateTokens(prompt)
}

/**
 * 通用 LLM 调用
 *
 * @param {Object} args   现有调用参数（保持向后兼容）
 * @param {Object} [meta] { taskId, stage } — 计费/审计元信息，可选
 */
export async function callLLM(args, meta) {
  const { system, prompt, model, temperature = 0.3, jsonMode = false } = args || {}
  const { taskId = 'global', stage = 'unknown' } = meta || {}
  const provider = getActiveProvider()
  const finalModel = model || provider.config.model

  switch (provider.type) {
    case 'vps-proxy': {
      const { text, usage } = await callVpsProxy({
        system,
        prompt,
        model: finalModel,
        temperature,
        jsonMode,
        proxyUrl: provider.config.proxyUrl,
      })
      _record({
        providerName: _vpsProviderName(finalModel),
        model: finalModel,
        usage,
        system,
        prompt,
        response: text,
        taskId,
        stage,
      })
      return text
    }
    case 'claude-cli': {
      const { text, usage } = await callClaudeCli({
        system,
        prompt,
        model: finalModel,
        bridgeUrl: provider.config.bridgeUrl,
      })
      _record({
        providerName: 'claude-cli',
        model: 'claude-cli-local', // 本地 CLI 一律按 0 元定价 key 计
        usage,
        system,
        prompt,
        response: text,
        taskId,
        stage,
      })
      return text
    }
    case 'openai-like': {
      const { text, usage } = await callOpenAiLike({
        system,
        prompt,
        model: finalModel,
        temperature,
        jsonMode,
        baseURL: provider.config.baseURL,
        apiKey: provider.config.apiKey,
      })
      _record({
        providerName: _openAiLikeProviderName(provider.id, finalModel),
        model: finalModel,
        usage,
        system,
        prompt,
        response: text,
        taskId,
        stage,
      })
      return text
    }
    case 'mock':
    default:
      // mock 不计费
      return ''
  }
}

// ============================================================
// 内部：计费记录助手
// ============================================================

function _record({ providerName, model, usage, system, prompt, response, taskId, stage }) {
  let inputTokens = usage?.prompt_tokens ?? usage?.input_tokens
  let outputTokens = usage?.completion_tokens ?? usage?.output_tokens
  let estimated = false
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    inputTokens = estimateInputTokens(system, prompt)
    outputTokens = estimateTokens(response)
    estimated = true
  }
  try {
    recordLLMCall({
      provider: providerName,
      model,
      inputTokens,
      outputTokens,
      taskId,
      stage,
      estimated,
    })
  } catch (e) {
    // 计费失败绝不能影响业务流
    // eslint-disable-next-line no-console
    console.warn('[aiProvider] recordLLMCall 失败:', e)
  }
}

// vps-proxy 透传任何 model，按 model 名推断 provider 名
function _vpsProviderName(model) {
  if (!model) return 'vps-proxy'
  if (model.startsWith('deepseek')) return 'deepseek'
  if (model.startsWith('claude')) return 'anthropic'
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('gemini')) return 'google'
  if (model.startsWith('glm')) return 'zhipu'
  if (model.startsWith('qwen')) return 'alibaba'
  if (model.startsWith('moonshot')) return 'moonshot'
  return 'vps-proxy'
}

// openai-like 路由：preset id 优先（deepseek/glm/...），否则按 model 推断
function _openAiLikeProviderName(presetId, model) {
  if (presetId && presetId !== 'openai-like') return presetId
  return _vpsProviderName(model)
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
      const { text } = await callOpenAiLike({
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
  // 60s 超时, 防止后端挂住时前端按钮永远停在 loading 状态
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 60000)
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ system, prompt, model, temperature, jsonMode }),
      signal: ctl.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('vps-proxy 超时 (60s 无响应), 请检查 LLM 后端')
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`vps-proxy ${resp.status}: ${text.slice(0, 200) || resp.statusText}`)
  }
  const data = await resp.json()
  if (!data.ok) throw new Error(data.error || 'vps-proxy 返回失败')
  return { text: data.text || '', usage: data.usage }
}

// ============================================================
// Claude CLI 桥
// ============================================================

async function callClaudeCli({ system, prompt, model, bridgeUrl }) {
  const url = (bridgeUrl || 'http://127.0.0.1:18080') + '/chat'
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 120000) // claude CLI 慢一些, 留 120s
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ system, prompt, model }),
      signal: ctl.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('claude-bridge 超时 (120s 无响应), 请检查本地 claude CLI')
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`claude-bridge ${resp.status}: ${text || resp.statusText}`)
  }
  const data = await resp.json()
  if (!data.ok) throw new Error(data.error || 'claude-bridge 返回失败')
  return { text: data.text || '', usage: data.usage }
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
  return { text, usage: data?.usage }
}
