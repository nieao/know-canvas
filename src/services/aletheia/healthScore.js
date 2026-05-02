/**
 * Aletheia 健康分启发式算法：纯同步、不调 LLM
 * 用于 HealthScoreRing 实时显示 + synthesize 调用前的本地估算
 */

// 节点类型分类（兼容 ui-cc 已有命名）
const PROPOSER_TYPES = new Set(['ontologyNode', 'proposerNode'])
const REFUTER_TYPES = new Set(['challengeNode', 'refuterNode'])
const SYNTHESIS_TYPES = new Set(['synthesisNode'])

// severity → 扣分系数
const SEVERITY_PENALTY = {
  low: 2,
  medium: 5,
  high: 10,
  critical: 18,
}

/**
 * 计算共识方案的健康分（0..100）
 *
 * 启发式：
 * - base 50：默认中性起点
 * - 每个 proposer 加 3 分（产出基础物料是好事），上限 +24
 * - 每个 refuter 节点扣分（按 severity 区分），代表未消化的对抗压力
 * - 每个 synthesis 节点加 10 分（已综合 = 释放压力），上限 +30
 * - 反驳与综合的关联（reside-by-refuter 边）会额外加 2 分（说明反驳被吸收）
 * - 权重影响：合规权重高时合规类反驳惩罚更重；商业权重高时 ROI 类反驳惩罚更重
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {{logic:number, compliance:number, business:number}} weights
 * @returns {number} 0..100 整数
 */
export function calcHealth(nodes = [], edges = [], weights = { logic: 1, compliance: 1, business: 1 }) {
  let score = 50

  const proposers = []
  const refuters = []
  const synthesisNodes = []

  for (const n of nodes) {
    if (!n || !n.type) continue
    if (PROPOSER_TYPES.has(n.type)) proposers.push(n)
    else if (REFUTER_TYPES.has(n.type)) refuters.push(n)
    else if (SYNTHESIS_TYPES.has(n.type)) synthesisNodes.push(n)
  }

  // 1) proposer 加分（封顶）
  score += Math.min(24, proposers.length * 3)

  // 2) refuter 扣分（按严重度 + 权重）
  const wCompliance = weights?.compliance ?? 1
  const wBusiness = weights?.business ?? 1
  const wLogic = weights?.logic ?? 1

  for (const r of refuters) {
    const sev = r.data?.severity || 'medium'
    const basePenalty = SEVERITY_PENALTY[sev] ?? SEVERITY_PENALTY.medium

    // 反驳种类（如果有 tag 字段）会乘上对应权重
    const tag = String(r.data?.tag || r.data?.kind || '').toLowerCase()
    let weightMul = wLogic
    if (tag.includes('compliance') || tag.includes('合规')) weightMul = wCompliance
    else if (tag.includes('business') || tag.includes('roi') || tag.includes('商业')) weightMul = wBusiness

    score -= basePenalty * weightMul
  }

  // 3) synthesis 加分（封顶 +30）
  score += Math.min(30, synthesisNodes.length * 10)

  // 4) "反驳被综合吸收"边奖励：synthesis 节点引用 refuter 即视为消化
  const synIds = new Set(synthesisNodes.map((n) => n.id))
  const refuterIds = new Set(refuters.map((n) => n.id))

  let absorbed = 0
  for (const e of edges || []) {
    if (!e) continue
    const aIsSyn = synIds.has(e.source)
    const bIsSyn = synIds.has(e.target)
    const aIsRef = refuterIds.has(e.source)
    const bIsRef = refuterIds.has(e.target)
    if ((aIsSyn && bIsRef) || (bIsSyn && aIsRef)) absorbed++
  }
  score += Math.min(15, absorbed * 2)

  // 5) 兜底夹紧到 0..100
  if (!Number.isFinite(score)) score = 0
  return Math.max(0, Math.min(100, Math.round(score)))
}
