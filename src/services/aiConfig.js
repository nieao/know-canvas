/**
 * AI Provider 配置 — 支持多家模型可手动输入
 *
 * 三轨：
 *   1. claude-cli  → 默认；走本机 localhost:18080 调用户自己的 claude CLI（零 API 成本）
 *   2. openai-like → 兼容 OpenAI Chat Completions 协议（DeepSeek / GLM / MiniMax / 通义 / Moonshot 等都兼容）
 *   3. mock        → 不调 LLM，用客户端规则解析（兜底）
 *
 * 配置存 localStorage（key: know_canvas_ai_config），用户在设置面板填。
 */

const KEY = 'know_canvas_ai_config'

// 预设 provider 模板（用户进设置面板可一键填充）
export const PROVIDER_PRESETS = [
  {
    id: 'vps-proxy',
    label: 'VPS LLM 代理（线上默认）',
    description: '同源调 https://ha2.digitalvio.shop/canvas/api/llm — 凭据保管在 systemd, 浏览器零配置',
    type: 'vps-proxy',
    config: {
      // 同源相对路径, 让 vite dev 和 vps build 都能直接用
      // (本地 dev 时浏览器没 nginx, 改 localStorage 指向 http://localhost:17082)
      proxyUrl: '/canvas/api/llm',
      model: 'deepseek-chat',
    },
  },
  {
    id: 'claude-cli',
    label: 'Claude CLI 桥（本机）',
    description: '调用本机 claude CLI，零 API 成本；需先启动 server/claude-bridge.js',
    type: 'claude-cli',
    config: {
      bridgeUrl: 'http://127.0.0.1:18080',
      model: 'claude-sonnet-4-5-20250514',
    },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'platform.deepseek.com — 国内可访问，价格低',
    type: 'openai-like',
    config: {
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
    },
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    description: 'open.bigmodel.cn — GLM-4 系列',
    type: 'openai-like',
    config: {
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: '',
      model: 'glm-4-flash',
    },
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    description: 'api.minimax.chat — abab 系列',
    type: 'openai-like',
    config: {
      baseURL: 'https://api.minimax.chat/v1',
      apiKey: '',
      model: 'abab6.5s-chat',
    },
  },
  {
    id: 'qwen',
    label: '阿里通义千问',
    description: 'dashscope.aliyuncs.com — Coding Plan 也走 OpenAI 兼容',
    type: 'openai-like',
    config: {
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: '',
      model: 'qwen-turbo',
    },
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    description: 'api.moonshot.cn',
    type: 'openai-like',
    config: {
      baseURL: 'https://api.moonshot.cn/v1',
      apiKey: '',
      model: 'moonshot-v1-8k',
    },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'api.openai.com',
    type: 'openai-like',
    config: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
    },
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    description: '任何兼容 OpenAI Chat Completions 协议的服务',
    type: 'openai-like',
    config: {
      baseURL: '',
      apiKey: '',
      model: '',
    },
  },
  {
    id: 'mock',
    label: '本地规则解析（不调 LLM）',
    description: '兜底；只用客户端规则提取概念和关系',
    type: 'mock',
    config: {},
  },
]

const DEFAULT_CONFIG = {
  activeProviderId: 'vps-proxy',
  // 每个 provider 的具体配置（key 为 provider id）
  providers: PROVIDER_PRESETS.reduce((acc, p) => {
    acc[p.id] = { ...p.config }
    return acc
  }, {}),
}

export function getAiConfig() {
  if (typeof localStorage === 'undefined') return DEFAULT_CONFIG
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw)
    return {
      activeProviderId: parsed.activeProviderId || DEFAULT_CONFIG.activeProviderId,
      providers: { ...DEFAULT_CONFIG.providers, ...(parsed.providers || {}) },
    }
  } catch (_e) {
    return DEFAULT_CONFIG
  }
}

export function setAiConfig(cfg) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(cfg))
}

export function setActiveProvider(id) {
  const cfg = getAiConfig()
  cfg.activeProviderId = id
  setAiConfig(cfg)
}

export function setProviderConfig(id, partial) {
  const cfg = getAiConfig()
  cfg.providers[id] = { ...(cfg.providers[id] || {}), ...partial }
  setAiConfig(cfg)
}

/** 取当前激活 provider 的完整描述（含 type + config） */
export function getActiveProvider() {
  const cfg = getAiConfig()
  const preset = PROVIDER_PRESETS.find((p) => p.id === cfg.activeProviderId) || PROVIDER_PRESETS[0]
  return {
    ...preset,
    config: cfg.providers[preset.id] || preset.config,
  }
}
