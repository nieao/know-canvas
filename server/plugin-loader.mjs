// 插件加载器 — 扫 plugins/<id>/manifest.json + 动态 import adapter.mjs
//
// 设计原则 (见 docs/source-plugin-spec.md §2.2):
//   - 同进程动态 import, 不沙箱 (单机本地工具不需要隔离)
//   - daemon 启动一次性扫盘, 不做 hot reload (v0.2+ 可加)
//   - 插件 manifest 错误 / adapter import 失败 → log + skip, 不让 daemon 死
//
// 用法 (从 source-proxy.js):
//   const mod = await import('./plugin-loader.mjs')
//   const registry = await mod.loadPlugins(PLUGINS_DIR)
//   const r = await mod.dispatchPlugin(registry, pluginId, capability, input)

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const VALID_CAPABILITIES = new Set(['search', 'fetch', 'push', 'watch'])
const VALID_SOURCE_TYPES = new Set(['kb', 'web', 'social', 'feed', 'note', 'custom'])

function log(...args) {
  console.log('[plugin-loader]', new Date().toISOString().slice(11, 19), ...args)
}
function logErr(...args) {
  console.error('[plugin-loader]', new Date().toISOString().slice(11, 19), 'ERROR', ...args)
}

// 校验 manifest, 返回 [ok, errors]
function validateManifest(m, idFromDir) {
  const errors = []
  if (!m || typeof m !== 'object') return [false, ['manifest 不是对象']]
  if (!m.id || typeof m.id !== 'string') errors.push('id 缺失/非 string')
  if (m.id && idFromDir && m.id !== idFromDir) errors.push(`id ("${m.id}") 必须跟目录名 ("${idFromDir}") 一致`)
  if (!m.name) errors.push('name 缺失')
  if (!m.version) errors.push('version 缺失')
  if (!m.sourceType || !VALID_SOURCE_TYPES.has(m.sourceType)) {
    errors.push(`sourceType 必须 ∈ {${[...VALID_SOURCE_TYPES].join(',')}}`)
  }
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    errors.push('capabilities 必须是非空数组')
  } else {
    for (const c of m.capabilities) {
      if (!VALID_CAPABILITIES.has(c)) errors.push(`不合法 capability: ${c}`)
    }
  }
  return [errors.length === 0, errors]
}

// 三层合并 config: env > ~/.know-canvas/plugins.json[id] > manifest.configSchema 默认值
async function buildConfig(manifest, userPluginsConfig) {
  const cfg = {}
  const schema = manifest.configSchema || {}
  for (const key of Object.keys(schema)) {
    const def = schema[key] || {}
    let val = ''
    if (def.envVar && process.env[def.envVar]) {
      val = process.env[def.envVar]
    } else if (userPluginsConfig?.[manifest.id]?.[key] != null) {
      val = String(userPluginsConfig[manifest.id][key])
    } else if (def.default != null) {
      val = String(def.default)
    }
    cfg[key] = val
  }
  return cfg
}

async function readUserConfig() {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (!home) return {}
  const path = join(home, '.know-canvas', 'plugins.json')
  try {
    const buf = await readFile(path, 'utf8')
    return JSON.parse(buf)
  } catch {
    return {}
  }
}

// 主入口: 加载一个目录下所有插件
export async function loadPlugins(pluginsDir) {
  const root = resolve(pluginsDir)
  const registry = {} // { [id]: { manifest, adapter, ctx, dir } }

  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (e) {
    log(`插件目录不存在: ${root} (跳过插件加载)`)
    return registry
  }

  const userConfig = await readUserConfig()

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const idFromDir = ent.name
    const dir = join(root, idFromDir)
    const manifestPath = join(dir, 'manifest.json')
    const adapterPath = join(dir, 'adapter.mjs')
    let manifest
    try {
      const buf = await readFile(manifestPath, 'utf8')
      manifest = JSON.parse(buf)
    } catch (e) {
      logErr(`${idFromDir}: 读 manifest 失败 — ${e.message}`)
      continue
    }
    const [valid, errors] = validateManifest(manifest, idFromDir)
    if (!valid) {
      logErr(`${idFromDir}: manifest 校验失败 — ${errors.join('; ')}`)
      continue
    }
    let adapterModule
    try {
      // pathToFileURL 必须 — Windows 下 import('E:/...') 会失败
      adapterModule = await import(pathToFileURL(adapterPath).href)
    } catch (e) {
      logErr(`${idFromDir}: import adapter.mjs 失败 — ${e.message}`)
      continue
    }
    const adapter = adapterModule?.default
    if (!adapter || typeof adapter !== 'object') {
      logErr(`${idFromDir}: adapter.mjs 必须 default-export 一个对象`)
      continue
    }
    // 校验声明的 capability 都有对应函数
    const missing = manifest.capabilities.filter((c) => c !== 'watch' && typeof adapter[c] !== 'function')
    if (missing.length) {
      logErr(`${idFromDir}: 声明了 ${missing.join(',')} 但 adapter 没导出对应函数`)
      continue
    }
    const config = await buildConfig(manifest, userConfig)
    const ctx = {
      manifest,
      config,
      log: (...args) => console.log(`[plugin:${manifest.id}]`, ...args),
      fetch: globalThis.fetch,
    }
    registry[manifest.id] = { manifest, adapter, ctx, dir }
    log(`加载: ${manifest.id} v${manifest.version} (${manifest.capabilities.join('/')})`)
  }
  log(`共加载 ${Object.keys(registry).length} 个插件 from ${root}`)
  return registry
}

// 调度: 给定 pluginId + capability + 入参 → 调 adapter 函数
// 返回 { status, body } — status 是 HTTP code, body 是 JSON 对象
export async function dispatchPlugin(registry, pluginId, capability, input) {
  const plugin = registry[pluginId]
  if (!plugin) {
    return { status: 404, body: { ok: false, error: `plugin not found: ${pluginId}`, code: 'NOT_FOUND' } }
  }
  if (!plugin.manifest.capabilities.includes(capability)) {
    return { status: 405, body: { ok: false, error: `${pluginId} 未声明 capability=${capability}`, code: 'CAPABILITY_NOT_SUPPORTED' } }
  }
  const fn = plugin.adapter[capability]
  if (typeof fn !== 'function') {
    return { status: 405, body: { ok: false, error: `${pluginId}.${capability} 不是函数`, code: 'CAPABILITY_NOT_SUPPORTED' } }
  }
  try {
    const r = await Promise.race([
      fn(plugin.ctx, input),
      new Promise((_, rej) => setTimeout(() => rej(new Error('adapter timeout 20s')), 20000)),
    ])
    // 包络: search 返 {results, total}; fetch 返 {data}; push 返 {externalId, externalUrl}
    if (capability === 'search') {
      return { status: 200, body: { ok: true, results: r?.results || [], total: r?.total ?? (r?.results?.length || 0) } }
    }
    if (capability === 'fetch') {
      return { status: 200, body: { ok: true, data: r?.data || r } }
    }
    if (capability === 'push') {
      return { status: 200, body: { ok: true, externalId: r?.externalId, externalUrl: r?.externalUrl, meta: r?.meta } }
    }
    return { status: 200, body: { ok: true, ...r } }
  } catch (e) {
    const msg = e?.message || String(e)
    if (/timeout/i.test(msg)) {
      return { status: 504, body: { ok: false, error: msg, code: 'TIMEOUT' } }
    }
    logErr(`${pluginId}.${capability}:`, msg)
    return { status: 500, body: { ok: false, error: msg, code: 'PLUGIN_ERROR' } }
  }
}

// 列出所有已加载插件 (给 UI 用)
export function listPlugins(registry) {
  return Object.values(registry).map(({ manifest }) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    sourceType: manifest.sourceType,
    capabilities: manifest.capabilities,
    ui: manifest.ui || {},
  }))
}
