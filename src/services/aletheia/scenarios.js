/**
 * Aletheia 场景库：ToB / ToC / ToG 三套行业 ontology 与上下文注入
 * 用于在共识对抗循环中切换"评判维度"和"权重提示"
 */

// 场景清单（UI 渲染用 + ontology 元数据）
export const SCENARIOS = [
  {
    id: 'tob',
    label: '业务侧 (ToB)',
    description: '面向企业客户：CapEx、ROI、合规、NPS、系统稳健',
    color: '#2563eb', // 蓝
    ontologyKeys: [
      'CapEx',
      'ROI',
      'Compliance',
      'NPS',
      'SystemStability',
      'TimeToValue',
      'TCO',
    ],
    weightHints: {
      logic: 1.0,
      compliance: 1.2,
      business: 1.3,
    },
  },
  {
    id: 'toc',
    label: '用户侧 (ToC)',
    description: '面向终端消费者：爽点、留存、传播、不可能三角(功能-体验-变现)',
    color: '#c8a882', // 暖色
    ontologyKeys: [
      'Delight',
      'Retention',
      'Virality',
      'Engagement',
      'Monetization',
      'Onboarding',
      'ImpossibleTriangle',
    ],
    weightHints: {
      logic: 0.8,
      compliance: 0.9,
      business: 1.1,
    },
  },
  {
    id: 'tog',
    label: '政府侧 (ToG)',
    description: '面向公共部门：执行效率、合规风险、舆情、公信力',
    color: '#7c3aed', // 紫
    ontologyKeys: [
      'ExecutionEfficiency',
      'ComplianceRisk',
      'PublicOpinion',
      'Credibility',
      'Equity',
      'Auditability',
      'PoliticalRisk',
    ],
    weightHints: {
      logic: 1.1,
      compliance: 1.5,
      business: 0.7,
    },
  },
]

/**
 * 把场景上下文注入到原始 prompt 之前
 * @param {string} scenarioId - tob/toc/tog
 * @param {string} basePrompt - 原始任务 prompt
 * @returns {string} 注入了场景头部的最终 prompt
 */
export function getScenarioPrompt(scenarioId, basePrompt) {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)
  // 找不到时降级 tob（最常用）
  const target = scenario || SCENARIOS[0]

  const ontologyList = target.ontologyKeys.map((k) => `- ${k}`).join('\n')
  const header = [
    `【场景】${target.label}`,
    `【说明】${target.description}`,
    '【关键评判维度（ontology）】',
    ontologyList,
    '【权重提示】',
    `- 逻辑严密度 × ${target.weightHints.logic}`,
    `- 合规风险度 × ${target.weightHints.compliance}`,
    `- 商业可行度 × ${target.weightHints.business}`,
    '',
    '请在上述场景框架内回答以下任务：',
    '---',
    (basePrompt || '').trim(),
    '---',
  ].join('\n')

  return header
}

/**
 * 获取某场景的 domain config 元数据
 * 参考 wiki: Domain_Config.json — 给 SynthesisNode / ImpossibleTriangle 等组件用
 * @param {string} scenarioId
 * @returns {{ id, label, ontologyKeys, weightHints, color }}
 */
export function getDomainConfig(scenarioId) {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0]
  return {
    id: scenario.id,
    label: scenario.label,
    description: scenario.description,
    color: scenario.color,
    ontologyKeys: [...scenario.ontologyKeys],
    weightHints: { ...scenario.weightHints },
  }
}
