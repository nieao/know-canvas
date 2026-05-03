/**
 * Cost Meter — LLM 调用计费引擎 + 事件发射器
 *
 * 上游：aiProvider.js（每次 LLM 调用成功后调 recordLLMCall）
 * 下游：UI 组件订阅 window 'cost-meter:record' 事件实时显示开销
 *
 * 事件契约见 CLAUDE.md / 黑客松迭代说明：
 *   detail = { taskId, stage, provider, model, inputTokens, outputTokens,
 *              costUsd, costCny, timestamp, pricingSource, estimated? }
 */

import pricing from './aiPricing.json'

// 单次 fallback warn 锁（避免刷屏）
const _warnedModels = new Set()

/**
 * 在定价表里查模型；找不到则在同 provider 下找第一个兜底
 * @returns { entry, modelKey, isFallback }
 */
function resolveModel(provider, model) {
  if (model && pricing.models[model]) {
    return { entry: pricing.models[model], modelKey: model, isFallback: false }
  }
  // provider 默认兜底：取该 provider 下第一个匹配的 model
  if (provider) {
    for (const [key, entry] of Object.entries(pricing.models)) {
      if (entry.provider === provider) {
        if (model && !_warnedModels.has(model)) {
          // eslint-disable-next-line no-console
          console.warn(
            `[costMeter] 未找到 model="${model}" 的定价，已用 provider="${provider}" 默认 "${key}" 兜底。请在 aiPricing.json 补充。`
          )
          _warnedModels.add(model)
        }
        return { entry, modelKey: key, isFallback: true }
      }
    }
  }
  // provider 也找不到 → 返回 0 价占位（不阻塞业务）
  if (model && !_warnedModels.has(model)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[costMeter] 未找到 model="${model}" 且 provider="${provider}" 也无任何条目，按 0 元计。请补 aiPricing.json。`
    )
    _warnedModels.add(model)
  }
  return {
    entry: { provider: provider || 'unknown', inputUsdPer1M: 0, outputUsdPer1M: 0, source: 'no-match' },
    modelKey: model || 'unknown',
    isFallback: true,
  }
}

/**
 * 记录一次 LLM 调用：算钱 + 派事件 + 返回结果
 *
 * @param {Object} args
 * @param {string} args.provider     - 'deepseek' / 'anthropic' / 'openai' / 'claude-cli' ...
 * @param {string} args.model        - model id
 * @param {number} args.inputTokens  - prompt token 数
 * @param {number} args.outputTokens - completion token 数
 * @param {string} [args.taskId]     - 关联任务 ID（不传则 'global'）
 * @param {string} [args.stage]      - 阶段标签（不传则 'unknown'）
 * @param {boolean} [args.estimated] - token 数是否为估算
 * @returns {{ costUsd: number, costCny: number, pricingSource: string }}
 */
export function recordLLMCall({
  provider,
  model,
  inputTokens = 0,
  outputTokens = 0,
  taskId = 'global',
  stage = 'unknown',
  estimated = false,
}) {
  const { entry } = resolveModel(provider, model)
  const inputUsd = (Number(inputTokens) || 0) * (entry.inputUsdPer1M || 0) / 1_000_000
  const outputUsd = (Number(outputTokens) || 0) * (entry.outputUsdPer1M || 0) / 1_000_000
  const costUsd = inputUsd + outputUsd
  const rate = pricing.exchangeRate?.usd_to_cny || 7.2
  const costCny = costUsd * rate
  const pricingSource = entry.source || 'unknown'

  const detail = {
    taskId,
    stage,
    provider: provider || entry.provider,
    model: model || 'unknown',
    inputTokens: Number(inputTokens) || 0,
    outputTokens: Number(outputTokens) || 0,
    costUsd,
    costCny,
    timestamp: Date.now(),
    pricingSource,
  }
  if (estimated) detail.estimated = true

  // 浏览器派事件（SSR / Node 环境兜底）
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('cost-meter:record', { detail }))
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[costMeter] dispatchEvent 失败:', e)
    }
  }

  return { costUsd, costCny, pricingSource }
}

/**
 * 仅查价不发事件 — 给 UI 预估单价用
 * @returns {{ provider, inputUsdPer1M, outputUsdPer1M, source } | null}
 */
export function lookupPrice(model) {
  if (!model) return null
  return pricing.models[model] || null
}

/** 列出所有定价（model id → 条目）— UI 选模型时用 */
export function listAllPricing() {
  return pricing.models
}

/** 当前汇率配置 */
export function getExchangeRate() {
  return pricing.exchangeRate
}

/** 定价表版本号（UI 可显示） */
export function getPricingVersion() {
  return pricing.version
}
