/**
 * AiSettingsPanel - AI Provider 设置面板
 * 让用户选 provider + 填 baseURL/apiKey/model；测试连接
 * 建筑极简风格
 */

import { useState, useEffect } from 'react'
import {
  PROVIDER_PRESETS,
  getAiConfig,
  setActiveProvider,
  setProviderConfig,
} from '../services/aiConfig'
import { checkProvider } from '../services/aiProvider'

export default function AiSettingsPanel({ open, onClose }) {
  const [activeId, setActiveId] = useState('claude-cli')
  const [providerConfigs, setProviderConfigs] = useState({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    if (open) {
      const cfg = getAiConfig()
      setActiveId(cfg.activeProviderId)
      setProviderConfigs(cfg.providers)
      setTestResult(null)
    }
  }, [open])

  if (!open) return null

  const activePreset = PROVIDER_PRESETS.find((p) => p.id === activeId) || PROVIDER_PRESETS[0]
  const activeCfg = providerConfigs[activeId] || activePreset.config

  const handleSelectProvider = (id) => {
    setActiveId(id)
    setActiveProvider(id)
    setTestResult(null)
  }

  const handleConfigChange = (key, value) => {
    const next = { ...activeCfg, [key]: value }
    setProviderConfigs((prev) => ({ ...prev, [activeId]: next }))
    setProviderConfig(activeId, { [key]: value })
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await checkProvider()
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, detail: e.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
      />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[640px] max-h-[80vh] overflow-hidden rounded-lg shadow-2xl flex"
        style={{
          backgroundColor: '#fafafa',
          border: '1px solid #e8e8e8',
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        }}
      >
        {/* 左侧 provider 列表 */}
        <div className="w-48 flex-shrink-0 overflow-y-auto" style={{ borderRight: '1px solid #e8e8e8', backgroundColor: '#f5f0eb' }}>
          <div
            className="px-4 py-3 text-xs font-medium"
            style={{ color: '#888', letterSpacing: '0.2em', borderBottom: '1px solid #e8e8e8' }}
          >
            AI 模型源
          </div>
          {PROVIDER_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectProvider(p.id)}
              className="w-full px-4 py-2.5 text-left text-sm transition-colors"
              style={{
                backgroundColor: activeId === p.id ? '#fafafa' : 'transparent',
                color: activeId === p.id ? '#c8a882' : '#2d2d2d',
                fontWeight: activeId === p.id ? 500 : 400,
                borderLeft: activeId === p.id ? '2px solid #c8a882' : '2px solid transparent',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* 右侧配置 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 头部 */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: '1px solid #e8e8e8' }}
          >
            <div>
              <div className="text-[10px] font-medium" style={{ color: '#c8a882', letterSpacing: '0.3em' }}>
                AI / SETTINGS
              </div>
              <h3 className="text-sm font-medium mt-0.5" style={{ color: '#1a1a1a' }}>
                {activePreset.label}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="hover:opacity-70 transition-opacity"
              style={{ color: '#bbb' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 描述 */}
          <p className="px-5 pt-3 text-xs leading-relaxed" style={{ color: '#888' }}>
            {activePreset.description}
          </p>

          {/* 配置表单 */}
          <div className="flex-1 px-5 py-4 overflow-y-auto space-y-3">
            {activePreset.type === 'claude-cli' && (
              <>
                <Field label="桥接地址" hint="在本机运行 server/claude-bridge.js 启动该服务">
                  <input
                    type="text"
                    value={activeCfg.bridgeUrl || ''}
                    onChange={(e) => handleConfigChange('bridgeUrl', e.target.value)}
                    placeholder="http://127.0.0.1:18080"
                    className="w-full px-3 py-2 text-sm rounded-md focus:outline-none"
                    style={{ border: '1px solid #e8e8e8', backgroundColor: '#fff', color: '#2d2d2d' }}
                  />
                </Field>
                <Field label="模型 ID" hint="claude-sonnet-4-5 / claude-opus-4-7 等">
                  <input
                    type="text"
                    value={activeCfg.model || ''}
                    onChange={(e) => handleConfigChange('model', e.target.value)}
                    placeholder="claude-sonnet-4-5-20250514"
                    className="w-full px-3 py-2 text-sm rounded-md focus:outline-none"
                    style={{ border: '1px solid #e8e8e8', backgroundColor: '#fff', color: '#2d2d2d' }}
                  />
                </Field>
                <div
                  className="text-[11px] p-2.5 rounded-md leading-relaxed"
                  style={{ backgroundColor: '#f5f0eb', color: '#888', border: '1px solid #e8d5c0' }}
                >
                  <strong style={{ color: '#c8a882' }}>使用说明</strong>
                  <br />
                  在终端运行：<code style={{ color: '#2d2d2d' }}>cd server && npm run bridge</code>
                  <br />
                  桥接服务会调用本机已登录的 claude CLI，零 API 成本。
                </div>
              </>
            )}

            {activePreset.type === 'openai-like' && (
              <>
                <Field label="API 地址 (baseURL)">
                  <input
                    type="text"
                    value={activeCfg.baseURL || ''}
                    onChange={(e) => handleConfigChange('baseURL', e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="w-full px-3 py-2 text-sm rounded-md focus:outline-none"
                    style={{ border: '1px solid #e8e8e8', backgroundColor: '#fff', color: '#2d2d2d', fontFamily: 'monospace' }}
                  />
                </Field>
                <Field label="API Key" hint="只存浏览器 localStorage，不会上传">
                  <input
                    type="password"
                    value={activeCfg.apiKey || ''}
                    onChange={(e) => handleConfigChange('apiKey', e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-3 py-2 text-sm rounded-md focus:outline-none"
                    style={{ border: '1px solid #e8e8e8', backgroundColor: '#fff', color: '#2d2d2d', fontFamily: 'monospace' }}
                  />
                </Field>
                <Field label="模型 ID">
                  <input
                    type="text"
                    value={activeCfg.model || ''}
                    onChange={(e) => handleConfigChange('model', e.target.value)}
                    placeholder="deepseek-chat / glm-4-flash / qwen-turbo ..."
                    className="w-full px-3 py-2 text-sm rounded-md focus:outline-none"
                    style={{ border: '1px solid #e8e8e8', backgroundColor: '#fff', color: '#2d2d2d', fontFamily: 'monospace' }}
                  />
                </Field>
              </>
            )}

            {activePreset.type === 'mock' && (
              <div
                className="text-xs p-3 rounded-md leading-relaxed"
                style={{ backgroundColor: '#f5f0eb', color: '#888', border: '1px solid #e8d5c0' }}
              >
                启用本地规则解析模式。所有 AI 任务（提取概念、推荐关系）只用客户端规则跑，不调任何 LLM。
                适合无网络环境或纯展示用途。
              </div>
            )}

            {/* 测试连接 */}
            <div className="pt-3 mt-3" style={{ borderTop: '1px dashed #e8e8e8' }}>
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-4 py-2 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: '#fafafa',
                  color: '#c8a882',
                  border: '1px solid #c8a882',
                }}
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
              {testResult && (
                <div
                  className="mt-2 text-xs p-2 rounded-md"
                  style={{
                    backgroundColor: testResult.ok ? '#f0f9f4' : '#fef2f2',
                    color: testResult.ok ? '#16a34a' : '#dc2626',
                    border: testResult.ok ? '1px solid #bbf7d0' : '1px solid #fecaca',
                  }}
                >
                  {testResult.ok ? '✓ 连接正常' : '✗ 连接失败'}
                  {testResult.detail && (
                    <div className="mt-1 text-[11px]" style={{ opacity: 0.8 }}>
                      {typeof testResult.detail === 'string' ? testResult.detail : JSON.stringify(testResult.detail)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 底部 */}
          <div
            className="flex items-center justify-end gap-2 px-5 py-3"
            style={{ borderTop: '1px solid #e8e8e8', backgroundColor: '#f5f0eb' }}
          >
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-md transition-colors"
              style={{ backgroundColor: '#c8a882', color: '#fafafa' }}
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: '#888', letterSpacing: '0.05em' }}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] mt-1" style={{ color: '#bbb' }}>{hint}</p>
      )}
    </div>
  )
}
