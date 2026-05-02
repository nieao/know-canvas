/**
 * Aletheia Runner — 扫提议 → LLM 反驳 → ChallengeNode 一条条长出 → 综合 → SynthesisNode
 * 调用: runAletheiaCycle({ canvasNodes, canvasEdges, store, onProgress })
 * onProgress.stage: analyze / refute / synthesize / done / empty
 */

import { callLLM } from '../aiProvider'
import { getPersonaPrompt } from './personas'
import { getScenarioPrompt, SCENARIOS } from './scenarios'
import { synthesize } from './synthesis'
import useAletheiaStore from '../../stores/useAletheiaStore'
import useCanvasStore from '../../stores/useCanvasStore'

const PROPOSER_TYPES = new Set(['conceptNode', 'taskNode', 'ontologyNode'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sevColor = (s) =>
  s === 'critical' ? '#9b3a4c' : s === 'high' ? '#b27c8b' : s === 'medium' ? '#c8a882' : '#888'
// 总是从全局 store 拿最新快照, 避免连续 setNodes 时丢节点
const snap = () => useCanvasStore.getState()

/** 解析 LLM JSON 数组, 抗代码块 + 抗前后缀污染 */
function parseJsonArray(raw) {
  if (!raw) return []
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  const cand = fenced ? fenced[1] : raw
  try {
    const v = JSON.parse(cand)
    if (Array.isArray(v)) return v
    if (Array.isArray(v?.challenges)) return v.challenges
    if (Array.isArray(v?.refutations)) return v.refutations
  } catch {
    const a = cand.indexOf('['), b = cand.lastIndexOf(']')
    if (a >= 0 && b > a) try { const x = JSON.parse(cand.slice(a, b + 1)); if (Array.isArray(x)) return x } catch {}
  }
  return []
}

/** 抽节点可读文本 (concept/task/ontology 字段不一致, 统一映射) */
const extractText = (n) => ({
  title: n.data?.title || n.data?.label || n.data?.name || '未命名',
  body: String(n.data?.description || n.data?.summary || n.data?.content || n.data?.claim || n.data?.text || '').slice(0, 200),
})

/** 兜底 mock — LLM 不可用时让 UI 仍有节点流, 按 persona 区分口吻 */
const MOCK_TONES = {
  reddit: [
    ['high',   'logic',    '这个前提你默认成立, 但根本没人验过 — 举个反例就崩'],
    ['medium', 'business', '收益模型只算了顺境, 顺境占多大比例你说不出来'],
    ['low',    'logic',    '术语堆砌掩盖了"看情况"式答辩, 给个可证伪判据'],
  ],
  audit: [
    ['critical', 'compliance', '数据隐私边界未明确, 10x 用户量时合规风险指数级上升'],
    ['high',     'business',   'ROI 假设忽略运营成本中位数, 实际回收周期翻倍'],
    ['medium',   'logic',      '边界条件失效场景未列举, 异常输入下行为未定义'],
  ],
  socratic: [
    ['medium', 'logic',    '如果用户量减半, 这个结论还成立吗? 边界在哪?'],
    ['low',    'business', '你说的"成功"用什么具体指标衡量? 阈值是多少?'],
    ['medium', 'logic',    '路径上最脆弱的一环是什么? 它断了怎么办?'],
  ],
}
function mockChallenges(proposers, personaId) {
  const pool = MOCK_TONES[personaId] || MOCK_TONES.reddit
  return proposers.slice(0, 3).map((p, i) => {
    const [severity, tag, text] = pool[i % pool.length]
    return { source: p.id, severity, tag, text }
  })
}

/** 主循环: 一轮 Aletheia 对抗 */
export async function runAletheiaCycle({ canvasNodes, canvasEdges, store, onProgress }) {
  const emit = (p) => { try { onProgress && onProgress(p) } catch {} }
  const ales = useAletheiaStore.getState()
  const personaId = ales.persona || 'reddit'
  const scenarioId = ales.scenario || 'tob'
  const weights = ales.weights || { logic: 1, compliance: 1, business: 1 }
  const round = ales.currentRound || 0

  // 1) 扫提议物料
  const proposers = (canvasNodes || []).filter((n) => PROPOSER_TYPES.has(n.type))
  if (proposers.length === 0) {
    emit({ stage: 'empty', message: '画布暂无可推导的提议节点 (需 concept/task/ontology)' })
    return { ok: false, reason: 'empty' }
  }
  emit({ stage: 'analyze', message: `扫描画布, 发现 ${proposers.length} 个提议节点...` })

  // 2) 组装 prompt
  const lines = proposers.slice(0, 8).map((n) => {
    const { title, body } = extractText(n)
    return `- id=${n.id} | type=${n.type} | 标题=${title}\n  内容=${body}`
  }).join('\n')
  const meta = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0]
  const baseChallenge = [
    '你正在对下列提议节点做反驳, 必须严格输出 JSON 数组, 每条结构:',
    '{ "source": "<提议节点id>", "severity": "low|medium|high|critical", "tag": "logic|compliance|business", "text": "<反驳内容, 限 80 字>" }',
    '',
    '要求: 1) 共 3-6 条, 覆盖至少 2 个不同 source  2) severity 分布合理, 至少 1 条 high 或 critical',
    `3) 在 ${meta.label} 场景下评判 (维度: ${meta.ontologyKeys.slice(0, 4).join('/')})  4) 不要任何额外文字, 只输出 JSON 数组`,
    '',
    '【提议节点清单】',
    lines,
    '',
    `【对抗权重】逻辑×${weights.logic} / 合规×${weights.compliance} / 商业×${weights.business}`,
  ].join('\n')
  const userPrompt = getScenarioPrompt(scenarioId, baseChallenge)
  const systemPrompt = '你是 Aletheia 决策引擎中的反驳 agent。\n'
    + getPersonaPrompt(personaId, '请按下文要求对画布提议进行反驳, 严格输出 JSON 数组.')

  // 3) 调 LLM (失败 / 空返回都走 mock 兜底, 让 UI 仍能演示节点流)
  let challenges = []
  let usedMock = false
  try {
    const raw = await callLLM({ system: systemPrompt, prompt: userPrompt, temperature: 0.6, jsonMode: true })
    challenges = parseJsonArray(raw)
    if (challenges.length === 0) {
      usedMock = true; challenges = mockChallenges(proposers, personaId)
      emit({ stage: 'analyze', message: 'LLM 返回空, 已切换 mock 演示数据', hint: 'mock' })
    }
  } catch (err) {
    usedMock = true; challenges = mockChallenges(proposers, personaId)
    emit({ stage: 'analyze', message: `LLM 调用失败: ${err.message || err}`, hint: 'LLM 调用失败, 已用本地 mock 演示节点流' })
  }

  // 校验回填: source 找不到就落到第一个 proposer
  const ids = new Set(proposers.map((p) => p.id))
  challenges = challenges
    .filter((c) => c && (c.text || c.claim))
    .map((c) => ({
      source: ids.has(c.source) ? c.source : proposers[0].id,
      severity: ['low', 'medium', 'high', 'critical'].includes(c.severity) ? c.severity : 'medium',
      tag: ['logic', 'compliance', 'business'].includes(c.tag) ? c.tag : 'logic',
      text: String(c.text || c.claim).slice(0, 240),
    }))
    .slice(0, 6)
  if (challenges.length === 0) {
    emit({ stage: 'empty', message: '反驳生成失败, 本轮无新节点产出' })
    return { ok: false, reason: 'no-challenge' }
  }

  // 4) 一条条加 ChallengeNode (sleep 600ms 让用户能看见生长)
  const ts = Date.now()
  const newChallengeIds = []
  for (let i = 0; i < challenges.length; i++) {
    const c = challenges[i]
    const src = canvasNodes.find((n) => n.id === c.source) || proposers[0]
    const cid = `challenge-${ts}-${Math.random().toString(36).slice(2, 7)}-${i}`
    const angle = c.tag === 'compliance' ? '合规风险' : c.tag === 'business' ? '商业可行性' : '逻辑漏洞'
    // ChallengeNode 组件读 claim, 只识别 high/medium/low (critical 退化为 high)
    const newNode = {
      id: cid, type: 'challengeNode',
      position: { x: (src.position?.x ?? 100) + 280, y: (src.position?.y ?? 100) + i * 100 },
      data: {
        label: c.text.slice(0, 40), text: c.text, claim: c.text, angle, tag: c.tag,
        severity: c.severity === 'critical' ? 'high' : c.severity,
        source_id: c.source, source_node_id: c.source,
        source_title: extractText(src).title, created_at: ts,
      },
    }
    const newEdge = {
      id: `edge-${ts}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      source: c.source, target: cid, type: 'curved', label: '反驳',
      data: { relationType: '反驳' },
      style: { stroke: sevColor(c.severity), strokeWidth: 1.5, strokeDasharray: '4 4' },
    }
    // 用 setNodes/setEdges 触发 yjsSync subscribe (push 不会触发引用变化)
    const cur = snap()
    cur.setNodes(cur.nodes.concat([newNode]))
    cur.setEdges(cur.edges.concat([newEdge]))
    newChallengeIds.push(cid)

    emit({ stage: 'refute', count: i + 1, total: challenges.length, current: c.text.slice(0, 30),
      message: `反驳 ${i + 1}/${challenges.length}: ${c.text.slice(0, 24)}...` })
    const role = personaId === 'audit' ? '审计师' : personaId === 'socratic' ? '苏格拉底' : '杠精'
    try { ales.pushDebate({ role, text: c.text, severity: c.severity }) } catch {}
    if (i < challenges.length - 1) await sleep(600)
  }

  // 5) 综合
  emit({ stage: 'synthesize', message: '综合反驳与提议, 产出 Action Plan...' })
  const cur = snap()
  let r
  try { r = await synthesize(cur.nodes, cur.edges, weights) }
  catch (err) { r = { actionPlan: `综合调用异常: ${err.message || err}`, summary: '综合失败', healthScore: 50, ts: Date.now() } }

  // 6) 加 SynthesisNode + 把 proposer/challenge 都连过来
  const avgX = proposers.reduce((s, n) => s + (n.position?.x ?? 0), 0) / proposers.length
  const avgY = proposers.reduce((s, n) => s + (n.position?.y ?? 0), 0) / proposers.length
  const synId = `synthesis-${ts}-${Math.random().toString(36).slice(2, 7)}`
  const synNode = {
    id: synId, type: 'synthesisNode',
    position: { x: avgX + 300, y: avgY + 300 },
    data: {
      label: 'Aletheia 综合', summary: r.summary, actionPlan: r.actionPlan, healthScore: r.healthScore,
      sourceProposerIds: proposers.map((p) => p.id), sourceRefuterIds: newChallengeIds,
      ts: r.ts, round: round + 1, mock: usedMock,
    },
  }
  const synEdges = [...proposers.map((p) => p.id), ...newChallengeIds].map((srcId, idx) => ({
    id: `edge-${ts}-syn-${idx}-${Math.random().toString(36).slice(2, 5)}`,
    source: srcId, target: synId, type: 'curved', label: '吸收',
    data: { relationType: '吸收' },
    style: { stroke: '#a07cb8', strokeWidth: 1, strokeDasharray: '2 4', opacity: 0.6 },
  }))
  const after = snap()
  after.setNodes(after.nodes.concat([synNode]))
  after.setEdges(after.edges.concat(synEdges))

  // 7) 回写 Aletheia store
  try {
    ales.setHealthScore(r.healthScore)
    ales.setRound(round + 1)
    if (typeof ales.setSynthesis === 'function') ales.setSynthesis(r)
  } catch {}

  emit({
    stage: 'done', healthScore: r.healthScore, summary: r.summary,
    message: `本轮完成 · HealthScore=${r.healthScore} · ${r.summary || ''}`.trim(),
  })
  return { ok: true, healthScore: r.healthScore, challengeCount: newChallengeIds.length }
}
