/**
 * 完整 E2E 测试: 飞书 prompt → 画布元认知 → bot 反馈卡 + 云文档 + 多维表格 全闭环
 *
 * 流程:
 *   1) 通过 source-proxy /canvas/cast/aletheia-prompt 注入 inbox prompt
 *      attribution 含 chatId — bot 反向通道见到这个 inbox 自动 register pending
 *   2) 等用户浏览器 cc 跑元认知 5 步 (≤ 90s)
 *   3) bot 反向通道见到 conclusion → archive (云文档 + Bitable) + sendCard 到飞书
 *   4) 验证: bot 日志看到 "[reverse] 发反馈卡" + 拉云文档内容
 *
 *   node server/test-full-e2e.mjs "你的 prompt"
 *
 * 前置:
 *   - VPS y-ws (1234) + source-proxy (17090) + bot daemon 都跑着
 *   - 浏览器至少打开一个 demo-final 房间 (http://66.245.216.250/canvas/?room=demo-final)
 *
 * 设计要点 (跟 test-archive-only.mjs 区别):
 *   - 这个脚本不 import feishu-bot 模块, 只发 HTTP cast + 验证 bot 日志
 *   - 完整覆盖反向通道 — 让 bot 自己跑 archive + sendCard, 比手工 mock 更接近线上行为
 */
import { setTimeout as sleep } from 'node:timers/promises'

const PROXY = process.env.SOURCE_PROXY || 'http://127.0.0.1:17090'
const ROOM = process.env.ROOM || 'demo-final'
const CHAT_ID = process.env.CHAT_ID || 'oc_d2d890f2072a92a98b9f87ccb76a5b68'
const PROMPT = process.argv.slice(2).join(' ').trim() ||
  '为知识图谱画布产品做一份 V2 商业化路线规划: 围绕开源/付费定位 / 增值订阅 / 企业版 / 社区运营, 给出具体推进决策'

function logT(...a) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}]`, ...a)
}

logT(`====== Aletheia 完整 E2E ======`)
logT(`PROMPT: ${PROMPT}`)
logT(`ROOM: ${ROOM}`)
logT(`CHAT_ID: ${CHAT_ID.slice(0, 14)}...`)

// 步骤 1: cast (attribution 带 chatId, bot inbox 监听器自动 register pending)
logT(`[1/3] cast prompt → ${PROXY}/canvas/cast/aletheia-prompt`)
const castRes = await fetch(`${PROXY}/canvas/cast/aletheia-prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    room: ROOM,
    text: PROMPT,
    attribution: {
      name: '完整 E2E 测试',
      via: 'feishu-bot',
      chatId: CHAT_ID,            // ← 关键: bot 见到这个就 register pending
    },
  }),
})
const castJson = await castRes.json()
if (!castJson.ok) {
  console.error('cast 失败:', castJson)
  process.exit(1)
}
logT(`✓ cast inbox=${castJson.id} 在线 cc=${castJson.peers}`)
if (!castJson.peers || castJson.peers === 0) {
  logT(`⚠ 0 cc 在线 — 没有执行者, 元认知不会跑. 请确保浏览器打开 ${castJson.canvasUrl}`)
  process.exit(2)
}

// 步骤 2: 等元认知完成 + bot 反馈卡发出 (至多 120s)
logT(`[2/3] 等元认知 5 步 + bot archive + sendCard (≤ 120s)...`)
logT(`     在 VPS 上运行: ssh newvps "journalctl -u know-canvas-feishubot -f"`)
logT(`     看到 "[reverse] 发反馈卡" 即完成`)

// 这个脚本本身没法 ssh, 退出后用户用 journalctl 查
// 但作为 e2e 自动化, 至少要 fetch cast 后等 90s 让 bot 跑完
await sleep(90 * 1000)

logT(`[3/3] 90 秒已过 — 检查 bot 日志确认反馈卡已发`)
logT(`     验证: ssh newvps 'journalctl -u know-canvas-feishubot --since "2 minutes ago" | grep -E "reverse|archive"'`)
logT(`     验证: 飞书群 ${CHAT_ID.slice(0, 14)}... 应该收到一张元认知反馈卡`)
logT(`====== E2E 流程已注入 ======`)
process.exit(0)
