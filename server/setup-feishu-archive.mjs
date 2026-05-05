/**
 * 一次性脚本: 建多维表格 + 字段 + 文档文件夹, 输出环境变量 → 写到 systemd unit
 *
 * 用法:
 *   node server/setup-feishu-archive.mjs
 *   node server/setup-feishu-archive.mjs --bitable-name "Aletheia 元认知归档"
 *
 * 输出 (示例):
 *   FEISHU_BITABLE_APP_TOKEN=bascngXXXX
 *   FEISHU_BITABLE_TABLE_ID=tblXXXX
 *   FEISHU_DOCS_FOLDER_TOKEN=fldXXXX (可选, 不建文件夹则用根目录)
 *
 * 把上面 3 行加到 deploy/know-canvas-feishubot.service 的 [Service] 段后,
 *   systemctl daemon-reload && systemctl restart know-canvas-feishubot
 *   bot 反馈卡就会自动同步云文档 + 多维表格.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const LARK_PROFILE = process.env.LARK_PROFILE || 'cli_a9434cff84381bd9'
const BITABLE_NAME = process.argv.includes('--bitable-name')
  ? process.argv[process.argv.indexOf('--bitable-name') + 1]
  : 'Aletheia 元认知归档'
const TABLE_NAME = '元认知历史'

function resolveLarkBin() {
  if (process.env.LARK_CLI_BIN) return process.env.LARK_CLI_BIN
  if (process.platform === 'win32') {
    const npmRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(npmRoot, 'npm', 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe')
  }
  return process.env.LARK_CLI || 'lark-cli'
}
const LARK_BIN = resolveLarkBin()

function runLark(args, timeoutMs = 30000) {
  const finalArgs = LARK_PROFILE ? ['--profile', LARK_PROFILE, ...args] : args
  return new Promise((resolve) => {
    const proc = spawn(LARK_BIN, finalArgs, { windowsHide: true })
    let out = ''
    let err = ''
    const t = setTimeout(() => { try { proc.kill('SIGTERM') } catch {}; resolve({ ok: false, error: 'timeout' }) }, timeoutMs)
    proc.stdout.on('data', (b) => { out += b.toString('utf8') })
    proc.stderr.on('data', (b) => { err += b.toString('utf8') })
    proc.on('close', (code) => {
      clearTimeout(t)
      if (code !== 0) return resolve({ ok: false, error: err.slice(0, 500) || `exit ${code}`, raw: out })
      try { resolve({ ok: true, data: JSON.parse(out), raw: out }) }
      catch { resolve({ ok: true, data: { raw: out.slice(0, 500) }, raw: out }) }
    })
    proc.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: e.message }) })
  })
}

console.log(`[setup] 用 profile=${LARK_PROFILE}`)
console.log(`[setup] 1. 建多维表格 "${BITABLE_NAME}" ...`)

const r1 = await runLark(['base', '+base-create', '--name', BITABLE_NAME, '--as', 'bot'])
if (!r1.ok) { console.error('建多维表格失败:', r1.error || r1.raw); process.exit(1) }
const baseData = r1.data?.data || r1.data
const appToken = baseData?.app?.app_token || baseData?.app_token
if (!appToken) { console.error('没拿到 app_token, raw:', r1.raw.slice(0, 500)); process.exit(1) }
console.log(`[setup] ✓ app_token=${appToken}`)

console.log(`[setup] 2. 在 app 内建数据表 "${TABLE_NAME}" + 字段 schema ...`)

const tableSchema = {
  name: TABLE_NAME,
  default_fields: [
    { field_name: '标题', type: 1 },          // 文本 (必含 — 是首列)
    { field_name: '决策', type: 3, property: { options: [{ name: 'GO' }, { name: 'NO_GO' }, { name: 'UNKNOWN' }] } }, // 单选
    { field_name: '评分', type: 2 },           // 数字
    { field_name: '输入 prompt', type: 1 },
    { field_name: '摘要', type: 1 },
    { field_name: '任务拆解', type: 1 },
    { field_name: '截图', type: 17 },          // 附件
    { field_name: '画布链接', type: 15 },      // 超链接
    { field_name: '云文档', type: 15 },
    { field_name: '截图 (SVG)', type: 15 },
    { field_name: '创建时间', type: 5 },       // 日期/时间
    { field_name: 'chat_id', type: 1 },
  ],
}

const r2 = await runLark([
  'base', '+table-create', appToken,
  '--data', JSON.stringify(tableSchema),
  '--as', 'bot',
])
if (!r2.ok) { console.error('建数据表失败:', r2.error || r2.raw); process.exit(1) }
const tableData = r2.data?.data || r2.data
const tableId = tableData?.table_id || tableData?.table?.table_id
if (!tableId) { console.error('没拿到 table_id, raw:', r2.raw.slice(0, 500)); process.exit(1) }
console.log(`[setup] ✓ table_id=${tableId}`)

console.log('')
console.log('=== 结果 ===')
console.log(`FEISHU_BITABLE_APP_TOKEN=${appToken}`)
console.log(`FEISHU_BITABLE_TABLE_ID=${tableId}`)
console.log('')
console.log(`多维表格: https://feishu.cn/base/${appToken}?table=${tableId}`)
console.log('')
console.log('把上面 2 行 Environment= 加到 deploy/know-canvas-feishubot.service [Service] 段, 然后:')
console.log('  systemctl daemon-reload && systemctl restart know-canvas-feishubot')
console.log('')
console.log('(可选) FEISHU_DOCS_FOLDER_TOKEN — 不设则云文档建到 bot 应用根目录, 一般不影响.')
