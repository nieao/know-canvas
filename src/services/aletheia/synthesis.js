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
    .filter((n) => n.type === 'ontologyNode' || n.type === 'proposerNode')
    .map((n) => ({
      id: n.id,
      label: n.data?.label || n.data?.title || '提议',
      summary: (n.data?.summary || n.data?.content || '').slice(0, 200),
    }))

  const refuters = nodes
    .filter((n) => n.type === 'challengeNode' || n.type === 'refuterNode')
    .map((n) => ({
      id: n.id,
      label: n.data?.label || '反驳',
      severity: n.data?.severity || 'medium',
      text: (n.data?.text || n.data?.content || '').slice(0, 200),
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
        actionPlan: 'string，3-5 条带优先级的具体行动，每条不超过 80 字',
        summary: 'string，本轮共识的一句话核心结论，不超过 60 字',
        healthScoreHint: 'number，0-100，综合官对本轮整体方案健康度的主观评分（仅参考）',
      },
      null,
      2
    ),
  ].join('\n')

  let actionPlan = '（LLM 调用失败，未能产出行动方案）'
  let summary = '综合失败'
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
      actionPlan = parsed.actionPlan || actionPlan
      summary = parsed.summary || summary
      if (typeof parsed.healthScoreHint === 'number') {
        healthHint = parsed.healthScoreHint
      }
    } else if (raw) {
      // LLM 没遵守 JSON 格式但有内容，至少把原文塞进 actionPlan
      actionPlan = raw.slice(0, 2000)
      summary = '原始文本（未结构化）'
    }
  } catch (err) {
    summary = `综合调用异常：${err.message || err}`
  }

  // 健康分：以本地启发式为准，LLM hint 只做轻量混合（30/70）
  const localHealth = calcHealth(nodes, edges, weights)
  const healthScore =
    typeof healthHint === 'number'
      ? Math.round(localHealth * 0.7 + Math.max(0, Math.min(100, healthHint)) * 0.3)
      : localHealth

  return {
    actionPlan,
    healthScore,
    summary,
    ts,
  }
}
