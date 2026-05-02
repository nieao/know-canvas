/**
 * @file taskRouter.js
 * @description 任务路由器 — 纯函数判断 prompt 走本地还是 Hermes
 *
 * 判断逻辑（auto 模式打分制，>= 50 分走 Hermes）：
 *   +20  含"对比/方案/全方位/产业链/调研/分阶段/拆解/规划/策划"
 *   +15  含"分析/研究/评估/优化/比较/论证"
 *   +20  文本 > 200 字符
 *   +20  文本 > 500 字符（叠加，最多再 +20）
 *   +10  动词或句号 >= 3 个（多句结构）
 *   +20  含"步骤/逻辑/结构/流程/阶段"
 *
 * 强制模式：
 *   mode='local'  → target=local，score=0
 *   mode='hermes' → target=hermes，score=100
 */

// 复杂关键词：建筑级议题、调研、产业链拆解 → 强信号
const HEAVY_KEYWORDS = /对比|方案|全方位|产业链|调研|分阶段|拆解|规划|策划/;
// 中等关键词：分析评估类，单独不足以触发 Hermes
const MEDIUM_KEYWORDS = /分析|研究|评估|优化|比较|论证/;
// 结构关键词：暗示分步骤思考
const STRUCTURE_KEYWORDS = /步骤|逻辑|结构|流程|阶段/;

/**
 * 路由判断
 * @param {object} args
 * @param {string} args.text - 用户 prompt
 * @param {'auto'|'local'|'hermes'} args.mode - 全局模式
 * @returns {{ target: 'local'|'hermes', reason: string, score: number }}
 */
export function routeTask({ text, mode }) {
  // 强制模式：跳过打分
  if (mode === 'local') {
    return { target: 'local', reason: '用户强制本地模型', score: 0 };
  }
  if (mode === 'hermes') {
    return { target: 'hermes', reason: '用户强制 Hermes', score: 100 };
  }

  // auto 模式：累加分数 + 收集触发原因
  const t = String(text || '');
  const len = t.length;
  let score = 0;
  const hits = [];

  if (HEAVY_KEYWORDS.test(t)) { score += 20; hits.push('复杂关键词'); }
  if (MEDIUM_KEYWORDS.test(t)) { score += 15; hits.push('分析类关键词'); }
  if (STRUCTURE_KEYWORDS.test(t)) { score += 20; hits.push('结构化关键词'); }

  if (len > 200) { score += 20; hits.push('长文本(>200)'); }
  if (len > 500) { score += 20; hits.push('超长文本(>500)'); }

  // 多句/多动词信号：句号(中英) + 顿号 计数
  const sentenceCount = (t.match(/[。.！!？?；;]/g) || []).length;
  if (sentenceCount >= 3) { score += 10; hits.push('多句结构'); }

  const target = score >= 50 ? 'hermes' : 'local';
  const reason = target === 'hermes'
    ? `命中 ${hits.join('、') || '无'} → 复杂任务，建议 Hermes (score=${score})`
    : `${hits.length ? '仅命中 ' + hits.join('、') : '无复杂特征'} → 简单任务，走本地模型 (score=${score})`;

  return { target, reason, score };
}
