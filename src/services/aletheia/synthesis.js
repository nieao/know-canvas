/**
 * Aletheia 共识综合器：把"提议节点 + 反驳节点 + 当前权重"喂给 LLM，产出行动方案
 * 输出 { actionPlan, healthScore, summary, ts } — Agent E 的 worker 会调本函数
 */

import { callLLM } from '../aiProvider'
import { calcHealth } from './healthScore'

/**
 * 把节点和边压缩成 LLM 友好的精简文本
 * 避免把整个 yjs doc 喂进去爆 token
 */
function compactGraph(nodes, edges) {
  const proposers = nodes
    .filter((n) => ['ontologyNode', 'proposerNode', 'conceptNode', 'taskNode'].includes(n.type))
    .map((n) => ({
      id: n.id,
      label: n.data?.label || n.data?.title || n.data?.name || '提议',
      summary: (n.data?.summary || n.data?.content || n.data?.description || n.data?.claim || '').slice(0, 200),
    }))

  const refuters = nodes
    .filter((n) => n.type === 'challengeNode' || n.type === 'refuterNode')
    .map((n) => ({
      id: n.id,
      label: n.data?.label || '反驳',
      severity: n.data?.severity || 'medium',
      text: (n.data?.text || n.data?.content || n.data?.claim || '').slice(0, 200),
      // 把分项的 evidence/todos 也喂给综合官, 让 actionPlan 更精准
      evidence: Array.isArray(n.data?.evidence) ? n.data.evidence.slice(0, 5) : [],
      todos: Array.isArray(n.data?.todos) ? n.data.todos.slice(0, 5) : [],
    }))

  const links = (edges || []).map((e) => ({
    from: e.source,
    to: e.target,
    type: e.data?.kind || e.label || 'related',
  }))

  return { proposers, refuters, links }
}

/**
 * 解析 LLM JSON 输出，容错处理
 */
function parseLLMJson(raw) {
  if (!raw) return null
  // 优先：从代码块中抽取
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  const candidate = fenced ? fenced[1] : raw
  try {
    return JSON.parse(candidate)
  } catch {
    // 回退：抓第一个 { ... } 区间
    const first = candidate.indexOf('{')
    const last = candidate.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(candidate.slice(first, last + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * 共识综合主函数
 * @param {Array} nodes - 当前画布节点（含 proposer + refuter）
 * @param {Array} edges - 节点之间的关系
 * @param {{ logic: number, compliance: number, business: number }} weights - 三维度权重
 * @returns {Promise<{ actionPlan: string, healthScore: number, summary: string, ts: number }>}
 */
export async function synthesize(nodes = [], edges = [], weights = { logic: 1, compliance: 1, business: 1 }) {
  const ts = Date.now()
  const { proposers, refuters, links } = compactGraph(nodes, edges)

  // 没东西可综合的情况
  if (proposers.length === 0 && refuters.length === 0) {
    return {
      actionPlan: '当前画布无可综合的提议与反驳节点，请先通过 Ontology / Challenge 流程产出素材。',
      healthScore: calcHealth(nodes, edges, weights),
      summary: '空场景',
      ts,
    }
  }

  const system = [
    '你是 Aletheia 共识综合官，负责在多轮提议与反驳之间提炼可执行的行动方案。',
    '原则：',
    '1. 对反驳认真采纳，不要敷衍式调和',
    '2. 行动方案必须具体到"谁、何时、做什么、用什么判据验证"',
    '3. 必须严格输出 JSON，不要任何额外文字',
    '4. 输出语言：中文',
  ].join('\n')

  const userPrompt = [
    '基于下列素材产出共识方案：',
    '',
    '【提议节点】',
    JSON.stringify(proposers, null, 2),
    '',
    '【反驳节点】',
    JSON.stringify(refuters, null, 2),
    '',
    '【关系】',
    JSON.stringify(links, null, 2),
    '',
    '【对抗权重】',
    JSON.stringify(weights, null, 2),
    '',
    '【输出 JSON schema】',
    JSON.stringify(
      {
        summary: 'string，本轮共识的一句话核心结论，不超过 60 字',
        actionItems: [
          {
            priority: 'P0|P1|P2',
            action: 'string，动词开头，限 50 字',
            owner: 'string，谁负责，限 20 字',
            deadline: 'string，何时完成，限 20 字',
            validation: 'string，用什么判据验证，限 40 字',
          },
        ],
        risks: ['string，风险条目, 限 50 字'],
        healthScoreHint: 'number，0-100，综合官对本轮整体方案健康度的主观评分（仅参考）',
      },
      null,
      2
    ),
    '',
    '硬要求: actionItems 必须 3-5 条, 必须含 priority/action/owner/deadline/validation 五个字段, 不能为空.',
    'risks 必须 2-4 条, 直接对应反驳节点中最严重的反驳点.',
  ].join('\n')

  let actionItems = []
  let risks = []
  let summary = ''
  let actionPlanText = ''
  let healthHint = null

  try {
    const raw = await callLLM({
      system,
      prompt: userPrompt,
      temperature: 0.4,
      jsonMode: true,
    })
    const parsed = parseLLMJson(raw)
    if (parsed) {
      summary = parsed.summary || summary
      if (Array.isArray(parsed.actionItems)) actionItems = parsed.actionItems
      if (Array.isArray(parsed.risks)) risks = parsed.risks
      // 兼容老 prompt 直接产出 actionPlan 字符串的情况
      if (!actionItems.length && typeof parsed.actionPlan === 'string') actionPlanText = parsed.actionPlan
      if (typeof parsed.healthScoreHint === 'number') healthHint = parsed.healthScoreHint
    } else if (raw) {
      actionPlanText = raw.slice(0, 2000)
      summary = '原始文本 (未结构化)'
    }
  } catch (err) {
    // mock 已彻底移除, LLM 失败直接 throw 让上层 runner 显示错误 banner
    throw new Error(`综合官 LLM 调用失败: ${err.message || err}`)
  }

  if (actionItems.length === 0 && !actionPlanText) {
    throw new Error('综合官 LLM 返回空, actionItems/actionPlan 都没有')
  }
  if (risks.length === 0) {
    risks = refuters.slice(0, 3).map((r) => `[${r.severity}] ${r.text || r.label}`.slice(0, 80))
  }
  // actionPlan 字符串保持兼容 (ActionPlanModal 渲染会用)
  const actionPlan = actionItems.length
    ? actionItems
        .map((it) => `[${it.priority || 'P1'}] ${it.action} (负责人: ${it.owner || '-'} · ${it.deadline || '-'} · 验收: ${it.validation || '-'})`)
        .join('\n')
    : actionPlanText

  // 健康分：以本地启发式为准，LLM hint 只做轻量混合（30/70）
  const localHealth = calcHealth(nodes, edges, weights)
  const healthScore =
    typeof healthHint === 'number'
      ? Math.round(localHealth * 0.7 + Math.max(0, Math.min(100, healthHint)) * 0.3)
      : localHealth

  return {
    actionPlan,        // string 兼容字段
    actionItems,       // 结构化 [{priority, action, owner, deadline, validation}]
    risks,             // [string]
    healthScore,
    summary,
    ts,
  }
}
