/**
 * ALETHEIA 画布 AI 服务
 * v0.2: provider 工厂模式
 *  - extractConcepts / suggestRelations / parseMarkdown 等沿用客户端规则解析（不烧 API）
 *  - 新增 extractConceptsLLM / suggestRelationsLLM 走配置的 provider（claude-cli / openai-like）
 *
 * 业务调用方按需选用。BottomAIBar 默认走客户端解析，"AI 深度分析"按钮走 LLM。
 */

import { callLLM } from './aiProvider'

// ============================================================
// 系统提示词（供 LLM 调用使用）
// ============================================================
export const SYSTEM_PROMPT = `你是 ALETHEIA 画布概念抽取助手。分析用户输入的文本，提取关键概念和它们之间的关系。输出严格的 JSON 格式，不要包含 markdown 代码块。

输出格式要求（JSON）：
{
  "concepts": [
    { "title": "概念名称", "description": "简要描述（不超过 50 字）", "tags": ["标签1", "标签2"], "importance": "high|medium|low" }
  ],
  "relations": [
    { "source": "概念A", "target": "概念B", "type": "因果|组成|依赖|相似|对比|顺序|引用", "reason": "关系说明" }
  ],
  "summary": "整体知识摘要（不超过 100 字）"
}

要求：
- concepts 不超过 12 条；优先选信息量大、可独立成节点的核心概念
- relations 中的 source/target 必须出自 concepts 中的 title
- 全程使用中文`

// ============================================================
// 客户端文本解析工具函数
// ============================================================

/**
 * 将文本按段落拆分
 */
function splitParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

/**
 * 提取 Markdown 标题
 */
function extractHeadings(text) {
  const headings = []
  const lines = text.split('\n')
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
      })
    }
  }
  return headings
}

/**
 * 提取加粗/斜体关键词
 */
function extractEmphasis(text) {
  const terms = new Set()
  // 加粗 **text** 或 __text__
  const boldRegex = /\*\*(.+?)\*\*|__(.+?)__/g
  let match
  while ((match = boldRegex.exec(text)) !== null) {
    terms.add(match[1] || match[2])
  }
  // 斜体 *text* 或 _text_（排除已匹配的加粗）
  const italicRegex = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g
  while ((match = italicRegex.exec(text)) !== null) {
    terms.add(match[1] || match[2])
  }
  return [...terms]
}

/**
 * 提取中文关键词（基于词频，简易版）
 */
function extractChineseKeywords(text, topN = 10) {
  // 移除标点和特殊字符
  const clean = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
  // 简单按2-4字切词（非常粗略，v0.1 足够）
  const words = {}
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= clean.length - len; i++) {
      const word = clean.substring(i, i + len)
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(word)) {
        words[word] = (words[word] || 0) + 1
      }
    }
  }
  return Object.entries(words)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word)
}

/**
 * 提取英文关键词（基于词频，排除停用词）
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'and', 'but', 'or', 'nor', 'if', 'this',
  'that', 'these', 'those', 'it', 'its', 'my', 'your', 'his', 'her',
  'their', 'our', 'what', 'which', 'who', 'whom',
])

function extractEnglishKeywords(text, topN = 10) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))

  const freq = {}
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1
  }
  return Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word)
}

// ============================================================
// 导出 API
// ============================================================

/**
 * 从文本提取概念
 * v0.1: 客户端解析（标题 + 加粗关键词 + 词频分析）
 * @param {string} text - 输入文本
 * @returns {Array<{title: string, description: string, tags: string[]}>}
 */
export async function extractConcepts(text) {
  if (!text || text.trim().length === 0) return []

  const concepts = []
  const seen = new Set()

  // 1. 从 Markdown 标题提取概念
  const headings = extractHeadings(text)
  for (const h of headings) {
    if (!seen.has(h.text.toLowerCase())) {
      seen.add(h.text.toLowerCase())
      concepts.push({
        title: h.text,
        description: `标题层级 H${h.level}`,
        tags: ['标题', `H${h.level}`],
        importance: h.level <= 2 ? 'high' : h.level <= 4 ? 'medium' : 'low',
      })
    }
  }

  // 2. 从加粗/斜体提取关键术语
  const emphasis = extractEmphasis(text)
  for (const term of emphasis) {
    const lower = term.toLowerCase()
    if (!seen.has(lower) && term.length > 1) {
      seen.add(lower)
      concepts.push({
        title: term,
        description: '文本中的强调术语',
        tags: ['关键词'],
        importance: 'medium',
      })
    }
  }

  // 3. 从词频提取关键词
  const cnKeywords = extractChineseKeywords(text, 8)
  const enKeywords = extractEnglishKeywords(text, 8)
  const keywords = [...cnKeywords, ...enKeywords]

  for (const kw of keywords) {
    const lower = kw.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      concepts.push({
        title: kw,
        description: '高频关键词',
        tags: ['词频'],
        importance: 'low',
      })
    }
  }

  // 4. 从段落首句提取主题（如果标题不够多）
  if (concepts.length < 5) {
    const paragraphs = splitParagraphs(text)
    for (const p of paragraphs.slice(0, 5)) {
      const firstSentence = p.split(/[。！？.!?]/)[0]?.trim()
      if (firstSentence && firstSentence.length > 4 && firstSentence.length < 60) {
        const lower = firstSentence.toLowerCase()
        if (!seen.has(lower)) {
          seen.add(lower)
          concepts.push({
            title: firstSentence,
            description: '段落主题句',
            tags: ['主题'],
            importance: 'low',
          })
        }
      }
    }
  }

  return concepts
}

/**
 * 发现概念间的关系
 * v0.1: 基于共现和层级关系的简单推断
 * @param {Array<{title: string}>} concepts - 概念列表
 * @param {string} originalText - 原始文本（用于共现分析）
 * @returns {Array<{source: string, target: string, type: string, reason: string}>}
 */
export async function suggestRelations(concepts, originalText = '') {
  if (!concepts || concepts.length < 2) return []

  const relations = []
  const paragraphs = originalText ? splitParagraphs(originalText) : []

  // 1. 基于标题层级的包含关系
  const headingConcepts = concepts.filter(c => c.tags?.includes('标题'))
  for (let i = 0; i < headingConcepts.length - 1; i++) {
    const current = headingConcepts[i]
    const next = headingConcepts[i + 1]
    const currentLevel = parseInt(current.tags?.find(t => t.startsWith('H'))?.slice(1) || '1')
    const nextLevel = parseInt(next.tags?.find(t => t.startsWith('H'))?.slice(1) || '1')

    if (nextLevel > currentLevel) {
      relations.push({
        source: current.title,
        target: next.title,
        type: '包含',
        reason: `${current.title} 是 ${next.title} 的上级章节`,
      })
    } else if (nextLevel === currentLevel) {
      relations.push({
        source: current.title,
        target: next.title,
        type: '并列',
        reason: '同级章节',
      })
    }
  }

  // 2. 基于段落共现的关联关系
  if (paragraphs.length > 0) {
    for (let i = 0; i < concepts.length; i++) {
      for (let j = i + 1; j < concepts.length; j++) {
        const a = concepts[i].title
        const b = concepts[j].title
        // 检查是否在同一段落中共现
        const cooccurrence = paragraphs.filter(
          p => p.includes(a) && p.includes(b)
        ).length
        if (cooccurrence > 0) {
          relations.push({
            source: a,
            target: b,
            type: '相关',
            reason: `在 ${cooccurrence} 个段落中共现`,
          })
        }
      }
    }
  }

  // 3. 基于关键词包含的关系
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const a = concepts[i].title.toLowerCase()
      const b = concepts[j].title.toLowerCase()
      if (a.includes(b) || b.includes(a)) {
        relations.push({
          source: concepts[i].title,
          target: concepts[j].title,
          type: '相关',
          reason: '名称包含关系',
        })
      }
    }
  }

  // 去重
  const uniqueRelations = []
  const seen = new Set()
  for (const r of relations) {
    const key = `${r.source}|${r.target}|${r.type}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueRelations.push(r)
    }
  }

  return uniqueRelations
}

/**
 * 生成知识摘要
 * v0.1: 客户端拼接摘要
 * @param {Array<{title: string, description: string}>} concepts
 * @returns {string}
 */
export async function summarizeKnowledge(concepts) {
  if (!concepts || concepts.length === 0) return '暂无概念可供摘要。'

  const highImportance = concepts.filter(c => c.importance === 'high')
  const medImportance = concepts.filter(c => c.importance === 'medium')

  let summary = `共提取 ${concepts.length} 个概念。`

  if (highImportance.length > 0) {
    summary += `\n\n核心概念（${highImportance.length} 个）：${highImportance.map(c => c.title).join('、')}。`
  }
  if (medImportance.length > 0) {
    summary += `\n\n重要术语（${medImportance.length} 个）：${medImportance.map(c => c.title).join('、')}。`
  }

  const tags = [...new Set(concepts.flatMap(c => c.tags || []))]
  if (tags.length > 0) {
    summary += `\n\n涉及分类：${tags.join('、')}。`
  }

  return summary
}

/**
 * 解析 Markdown 文件为概念和关系
 * 便捷方法：一次性完成提取+关系推断
 */
export async function parseMarkdown(text) {
  const concepts = await extractConcepts(text)
  const relations = await suggestRelations(concepts, text)
  const summary = await summarizeKnowledge(concepts)
  return { concepts, relations, summary }
}

/**
 * 解析 CSV 文本为概念列表
 * 假设首行为表头，第一列为概念名称
 */
export async function parseCSV(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"(.*)"$/, '$1'))
  const concepts = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"(.*)"$/, '$1'))
    if (values[0]) {
      concepts.push({
        title: values[0],
        description: values[1] || '',
        tags: values.slice(2).filter(Boolean),
        importance: 'medium',
      })
    }
  }

  return concepts
}

/**
 * 解析 JSON 格式的知识数据
 * 支持 [{title, description, tags}] 或 {concepts: [...], relations: [...]}
 */
export async function parseJSON(text) {
  const data = JSON.parse(text)

  if (Array.isArray(data)) {
    return {
      concepts: data.map(item => ({
        title: item.title || item.name || item.label || '',
        description: item.description || item.desc || '',
        tags: item.tags || [],
        importance: item.importance || 'medium',
      })),
      relations: [],
    }
  }

  return {
    concepts: (data.concepts || []).map(item => ({
      title: item.title || item.name || '',
      description: item.description || '',
      tags: item.tags || [],
      importance: item.importance || 'medium',
    })),
    relations: (data.relations || []).map(item => ({
      source: item.source || item.from || '',
      target: item.target || item.to || '',
      type: item.type || item.label || '相关',
      reason: item.reason || '',
    })),
  }
}

// ============================================================
// LLM 增强分析（走 provider 工厂）
// ============================================================

/**
 * 把 LLM 输出的 JSON 字符串解析出来，容忍 markdown 代码块包裹
 */
function tryParseLLMJson(text) {
  if (!text) return null
  // 去掉 ```json ... ``` 包裹
  let s = text.trim()
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) s = fenceMatch[1].trim()
  // 找第一个 { 到最后一个 }（处理前后有寒暄文字的情况）
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1)
  try {
    return JSON.parse(s)
  } catch (_e) {
    return null
  }
}

/**
 * 用 LLM 提取概念 + 关系
 * @param {string} text 待分析文本
 * @returns {Promise<{concepts, relations, summary}>}
 */
export async function analyzeWithLLM(text) {
  if (!text || text.trim().length === 0) {
    return { concepts: [], relations: [], summary: '' }
  }
  const prompt = `请分析以下文本，提取关键概念与关系，按上方 JSON schema 输出：\n\n---\n${text.slice(0, 8000)}`
  const raw = await callLLM({ system: SYSTEM_PROMPT, prompt, jsonMode: true })
  const parsed = tryParseLLMJson(raw)
  if (!parsed) {
    // LLM 输出解析失败 → 退回客户端规则解析
    console.warn('[aiService] LLM 输出无法解析为 JSON，回退到规则解析')
    return parseMarkdown(text)
  }
  return {
    concepts: (parsed.concepts || []).map((c) => ({
      title: c.title || c.name || '',
      description: c.description || '',
      tags: c.tags || [],
      importance: c.importance || 'medium',
    })).filter((c) => c.title),
    relations: (parsed.relations || []).map((r) => ({
      source: r.source || r.from || '',
      target: r.target || r.to || '',
      type: r.type || '相关',
      reason: r.reason || '',
    })).filter((r) => r.source && r.target),
    summary: parsed.summary || '',
  }
}

// ============================================================
// Aletheia: 本体拆解 + 反驳引擎 (元认知 + Hermes 合作)
// 来源: 飞书 wiki 0501-黑客松比赛-Aletheia
//   - Onto-Parser: 一句话 → 本体结构(Goal/Entity/Constraint/Assumption)
//   - Antithesis Engine: 节点 → 6 种 Devil's Advocate 攻击
// ============================================================

const ONTOLOGY_SYSTEM_PROMPT = `你是 Aletheia 决策引擎的本体拆解器 (Onto-Parser).
将用户的一句话目标拆解为本体论结构, 输出严格 JSON.

输出 schema:
{
  "goal": "顶层目标的精炼陈述 (10-30 字)",
  "entities": [
    { "title": "实体名称", "description": "30 字内说明" }
  ],
  "constraints": [
    { "title": "硬约束 (资源/时间/合规/物理)", "description": "为什么必须满足" }
  ],
  "assumptions": [
    { "title": "隐含假设", "description": "如果不成立后果是什么" }
  ],
  "edges": [
    { "from": "Goal | entity/constraint/assumption 的 title", "to": "另一个 title", "label": "拆解|依赖|约束|假设" }
  ]
}

要求:
- entities 3-6 个 (核心实体, 不堆砌)
- constraints 1-3 个 (硬约束)
- assumptions 1-3 个 (没明说但方案站立的前提)
- edges 必须包括 Goal → 各 entity 的"拆解"边, 以及 entity 之间的依赖
- 全程中文
- 只输出 JSON, 不要 markdown 代码块, 不要任何前言`

const CHALLENGE_SYSTEM_PROMPT = `你是 Aletheia 反驳引擎 (Antithesis Engine), 模拟红队攻击.
针对给定的方案 / 节点, 从 6 种攻击角度生成反驳论点.

6 种攻击 (Devil's Advocate):
1. 资源短缺: 时间/资金/人力是否够
2. 外部风险: 监管/竞争/市场变化
3. 逻辑矛盾: 内部假设是否互相冲突
4. 反例: 历史上有没有反向案例
5. 逆向激励: 长期是否制造道德风险或扭曲行为
6. 二阶效应: 解决 A 后是否制造 B

输出 JSON schema:
{
  "challenges": [
    { "angle": "攻击角度名 (上述 6 种之一)", "claim": "反驳论点 (40 字内, 必须具体)", "severity": "high|medium|low" }
  ]
}

要求:
- 选 2-4 个最锋利的攻击 (不凑数)
- claim 必须具体: 引数据 / 引判例 / 引反例, 禁止空话
- severity 反映对方案的实际威胁
- 全程中文, 只输出 JSON`

/**
 * Aletheia 本体拆解: 一句话 → 多节点框架
 * @param {string} sentence
 * @returns {Promise<{goal:string, entities:[], constraints:[], assumptions:[], edges:[]}>}
 */
export async function decomposeToOntology(sentence) {
  if (!sentence || sentence.trim().length === 0) {
    return { goal: '', entities: [], constraints: [], assumptions: [], edges: [] }
  }
  const prompt = `请把下列目标拆解为本体结构:\n\n"${sentence.trim()}"\n\n按 schema 输出 JSON.`
  const raw = await callLLM({ system: ONTOLOGY_SYSTEM_PROMPT, prompt, jsonMode: true })
  const parsed = tryParseLLMJson(raw)
  if (!parsed) {
    console.warn('[aiService] decomposeToOntology LLM 输出无法解析')
    return { goal: sentence.slice(0, 30), entities: [], constraints: [], assumptions: [], edges: [] }
  }
  return {
    goal: parsed.goal || sentence.slice(0, 30),
    entities: (parsed.entities || []).map((e) => ({
      title: e.title || e.name || '',
      description: e.description || e.desc || '',
    })).filter((e) => e.title),
    constraints: (parsed.constraints || []).map((c) => ({
      title: c.title || c.name || '',
      description: c.description || c.desc || '',
    })).filter((c) => c.title),
    assumptions: (parsed.assumptions || []).map((a) => ({
      title: a.title || a.name || '',
      description: a.description || a.desc || '',
    })).filter((a) => a.title),
    edges: (parsed.edges || []).map((e) => ({
      from: e.from || e.source || '',
      to: e.to || e.target || '',
      label: e.label || e.type || '拆解',
    })).filter((e) => e.from && e.to),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 圈选组合元认知分析 — 多个节点当成一个系统看, 输出 5 维度组合分析
// 用在 SelectionToolbar 的"组合分析"按钮 — 用户圈选 N 个节点, 让 LLM 看大局
// ─────────────────────────────────────────────────────────────────────────────
const GROUP_META_ANALYSIS_SYSTEM_PROMPT = `你是元认知组合分析引擎. 给定 N 个相关节点 (实体/概念/约束 等), 把它们当成一个系统看, 输出整组的 5 维度元认知分析.

跟单节点分析的区别:
- 不是逐个分析, 而是"这一组节点放在一起想做什么"
- 必须挖出"组合涌现"的洞察 (节点 A+B+C 一起带来了什么 A/B/C 单独没有的东西)
- core_intent 必须是这一组的总目标, 而不是某个节点的目标
- key_risks 重点找跨节点的依赖断裂 / 优先级冲突 / 资源竞争

5 维度认知规范:
1. core_intent: 这组节点放一起想达成的总目标, 1 句 30 字内
2. implicit_goals: 跨节点的共同隐含目标 (2-3 条)
3. key_risks: 这组节点组合后的关键风险 — 重点是依赖断裂/冲突/竞争 (2-3 条)
4. dependencies: 推进这组之前必须先确认/完成的前置项 (2-3 条)
5. next_actions: 推进整组的下一步具体动作 (1-3 条)

严格输出 JSON 不要 markdown 围栏:
{
  "core_intent": "1 句",
  "implicit_goals": ["..."],
  "key_risks": ["..."],
  "dependencies": ["..."],
  "next_actions": ["..."]
}`

/**
 * 圈选组合元认知 — 一组节点输入, 返回组合的 5 维度分析
 * @param {Array<{title:string, description?:string, variant?:string}>} nodes
 * @returns {Promise<object|null>} 跟 analyzeNodeMeta 相同 schema
 */
export async function analyzeGroupMeta(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return null
  const list = nodes.map((n, i) => {
    const v = n.variant ? `(${n.variant})` : ''
    return `${i + 1}. ${n.title}${v}${n.description ? ' — ' + n.description : ''}`
  }).join('\n')
  const prompt = `下列 ${nodes.length} 个节点是用户在画布上圈选的一组, 请做组合元认知分析:

${list}

按 schema 输出 JSON.`
  const raw = await callLLM({ system: GROUP_META_ANALYSIS_SYSTEM_PROMPT, prompt, jsonMode: true })
  const parsed = tryParseLLMJson(raw)
  if (!parsed) return null
  return {
    core_intent: parsed.core_intent || '',
    implicit_goals: Array.isArray(parsed.implicit_goals) ? parsed.implicit_goals.filter(Boolean).slice(0, 4) : [],
    key_risks: Array.isArray(parsed.key_risks) ? parsed.key_risks.filter(Boolean).slice(0, 4) : [],
    dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies.filter(Boolean).slice(0, 4) : [],
    next_actions: Array.isArray(parsed.next_actions) ? parsed.next_actions.filter(Boolean).slice(0, 4) : [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 节点级"元认知分析" — 一次 LLM 调用返回 5 维度简版分析
// 用在 OntologyNode 的"⚡ 元认知"按钮: 不长 5 个步骤节点, 直接 inline 显示在节点内
// ─────────────────────────────────────────────────────────────────────────────
const META_ANALYSIS_SYSTEM_PROMPT = `你是元认知分析引擎. 给定一个本体节点, 一次性输出 5 维度简版分析, 让用户立刻看清这个节点的全貌.

5 维度认知规范:
1. core_intent (核心意图): 这个节点真正想解决什么问题, 一句话 30 字内, 不要复读节点描述
2. implicit_goals (隐含目标): 用户没明说但想要的, 2-3 条, 每条 20 字内
3. key_risks (关键风险): 这个节点最容易翻车的点, 2-3 条, 必须具体 (不要"风险大""不确定"这种空话)
4. dependencies (前置依赖): 推进这个节点之前必须先确认/完成的, 2-3 条
5. next_actions (下一步行动): 接下来该做什么, 1-3 条具体动作 (不是抽象建议)

输出严格 JSON, 不要 markdown 围栏, 不要前言后语:
{
  "core_intent": "一句话",
  "implicit_goals": ["目标1", "目标2"],
  "key_risks": ["风险1", "风险2"],
  "dependencies": ["依赖1", "依赖2"],
  "next_actions": ["行动1", "行动2"]
}`

/**
 * 节点级元认知分析 — 一次调用返回 5 维度
 * @param {{title:string, description?:string, variant?:string}} node
 * @returns {Promise<{core_intent:string, implicit_goals:string[], key_risks:string[], dependencies:string[], next_actions:string[]} | null>}
 */
export async function analyzeNodeMeta(node) {
  if (!node?.title) return null
  const variant = node.variant ? ` (${node.variant})` : ''
  const prompt = `请对下列本体节点${variant}做 5 维度元认知分析:

标题: ${node.title}
${node.description ? '描述: ' + node.description : ''}

按 schema 输出 JSON.`
  const raw = await callLLM({ system: META_ANALYSIS_SYSTEM_PROMPT, prompt, jsonMode: true })
  const parsed = tryParseLLMJson(raw)
  if (!parsed) return null
  return {
    core_intent: parsed.core_intent || '',
    implicit_goals: Array.isArray(parsed.implicit_goals) ? parsed.implicit_goals.filter(Boolean).slice(0, 4) : [],
    key_risks: Array.isArray(parsed.key_risks) ? parsed.key_risks.filter(Boolean).slice(0, 4) : [],
    dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies.filter(Boolean).slice(0, 4) : [],
    next_actions: Array.isArray(parsed.next_actions) ? parsed.next_actions.filter(Boolean).slice(0, 4) : [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 节点级"拆解" — 把单个节点 (entity/constraint/assumption) 进一步拆成 3-5 个子实体
// 用在 OntologyNode 的"拆解"按钮: 用户觉得某个节点还太抽象, 让 LLM 再下一层
// ─────────────────────────────────────────────────────────────────────────────
const FURTHER_DECOMPOSE_SYSTEM_PROMPT = `你是 Aletheia 二级拆解引擎. 给定一个本体节点 (实体/约束/假设), 把它再下一层拆成 3-5 个更具体的子实体.

认知规范:
- 不要重复原节点的话, 必须更具体一层
- 子实体之间应当有清晰的功能划分 (不是同义词不同表述)
- 每个子实体的 description 必须给出"它在原节点里负责什么"

严格输出 JSON 不要 markdown 围栏:
{
  "subitems": [
    { "title": "子实体名 (10 字内)", "description": "30 字内说明它的职责 / 范围" }
  ]
}`

/**
 * 节点级二次拆解: 给一个 OntologyNode → 3-5 个子节点
 * @param {{title:string, description?:string, variant?:string}} node
 * @returns {Promise<Array<{title:string, description:string}>>}
 */
export async function decomposeNodeFurther(node) {
  if (!node?.title) return []
  const variant = node.variant || 'entity'
  const prompt = `把下列 ${variant === 'constraint' ? '约束' : variant === 'assumption' ? '假设' : '实体'} 进一步拆成 3-5 个更具体的子实体:

标题: ${node.title}
${node.description ? '描述: ' + node.description : ''}

按 schema 输出 JSON.`
  const raw = await callLLM({ system: FURTHER_DECOMPOSE_SYSTEM_PROMPT, prompt, jsonMode: true })
  const parsed = tryParseLLMJson(raw)
  if (!parsed?.subitems) return []
  return parsed.subitems
    .map((s) => ({
      title: (s.title || s.name || '').trim(),
      description: (s.description || s.desc || '').trim(),
    }))
    .filter((s) => s.title)
    .slice(0, 6)
}

/**
 * Aletheia 反驳引擎: 节点 → 多个 Devil's Advocate 反驳论点
 * @param {{title:string, description?:string}} node
 * @returns {Promise<Array<{angle:string, claim:string, severity:string}>>}
 */
export async function challengeNode(node) {
  if (!node?.title) return []
  const prompt = `针对下列方案 / 节点生成反驳:\n\n标题: ${node.title}${node.description ? '\n描述: ' + node.description : ''}\n\n按 schema 输出 JSON.`
  const raw = await callLLM({ system: CHALLENGE_SYSTEM_PROMPT, prompt, jsonMode: true })
  const parsed = tryParseLLMJson(raw)
  if (!parsed?.challenges) return []
  return parsed.challenges
    .filter((c) => c.claim)
    .map((c) => ({
      angle: c.angle || '反驳',
      claim: c.claim,
      severity: c.severity || 'medium',
    }))
}

/**
 * 让 LLM 给现有节点推荐新关系
 * @param {Array<{title:string, description?:string}>} concepts
 * @returns {Promise<Array>}
 */
export async function suggestRelationsLLM(concepts) {
  if (!concepts || concepts.length < 2) return []
  const list = concepts.map((c, i) => `${i + 1}. ${c.title}${c.description ? ' — ' + c.description : ''}`).join('\n')
  const system = '你是画布关系推断助手。给定一组概念，推断它们之间最有价值的连接关系。'
  const prompt = `下列是用户画布上的概念列表，请推断它们之间最值得连线的关系（最多 12 条），输出 JSON：

${list}

输出格式（严格 JSON，不要 markdown）：
{ "relations": [ { "source": "概念A", "target": "概念B", "type": "因果|组成|依赖|相似|对比|顺序|引用", "reason": "理由" } ] }

注意：source 和 target 必须从上方列表的概念名中选，type 从给定的 7 种关系里选。`
  const raw = await callLLM({ system, prompt, jsonMode: true })
  const parsed = tryParseLLMJson(raw)
  if (!parsed?.relations) return []
  return parsed.relations
    .filter((r) => r.source && r.target && r.source !== r.target)
    .map((r) => ({
      source: r.source,
      target: r.target,
      type: r.type || '相关',
      reason: r.reason || '',
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 一句话 → HTML 页面 (元认知洞察)
// 用在 BottomAIBar: 输入一句话, LLM 直接产出建筑极简风格 HTML 页面, 落画布渲染
// ─────────────────────────────────────────────────────────────────────────────
const ANSWER_HTML_SYSTEM_PROMPT = `你是元认知洞察引擎. 给定用户的一句话输入 (问题/目标/想法), 直接产出一份**完整的 HTML 页面字符串**, 把 5 维度元认知分析渲染成建筑极简风格的页面. 用户会把这个页面作为画布节点查看.

5 维度内容必须涵盖:
1. 核心意图 (core_intent) — 一句话点破用户真正想解决的问题
2. 隐含目标 (implicit_goals) — 2-3 条用户没明说但想要的
3. 关键风险 (key_risks) — 2-3 条最容易翻车的点 (具体, 不要"风险大"这种空话)
4. 前置依赖 (dependencies) — 2-3 条推进前必须先确认/完成的
5. 下一步行动 (next_actions) — 1-3 条具体动作

设计风格 (建筑极简唯美):
- 配色: 黑白基调 (#1a1a1a 主文字, #fafafa 背景, #888 辅助), 暖色点缀 (#c8a882) 仅用于强调元素
- 字体: 标题用 'Noto Serif SC', Georgia, serif; 正文用 'Noto Sans SC', system-ui, sans-serif
- 标题 letter-spacing 0.02em, 标签 letter-spacing 0.15-0.35em
- 间距: 8px 倍数, 大量留白
- 段落标签: 'CORE_INTENT' '01' '02' 这种带序号的全大写英文标签 (font-size 0.7rem, letter-spacing 0.35em, color #c8a882)
- 段落编号格式: '01 / CORE INTENT'
- 关键风险用左侧 2px 暖色边线 + 微红 (#7a3a4a) 文字
- 卡片式分块, border 1px solid #e8e8e8

输出严格要求:
- 只输出 HTML, 从 <!DOCTYPE html> 开始, 到 </html> 结束
- HTML 内联 <style>, 不要外部 CSS / JS
- 不要 markdown 围栏 (没有 \`\`\`html 这种), 不要前言后语解释
- 全程中文文案
- 页面宽度自适应, 内容居中 max-width 720px
- 顶部一行细暖色横线作装饰`

// ─────────────────────────────────────────────────────────────────────────────
// 决策引擎 — HtmlPageNode 完成后追加一步, 给最终评判
// 输出 verdict (go/hold/pivot) + score + summary + key_insights + improvements + next_steps
// ─────────────────────────────────────────────────────────────────────────────
const DECISION_ENGINE_SYSTEM_PROMPT = `你是 ALETHEIA 决策引擎. 给定一个用户输入和它的元认知/Hermes 产出页面, 给出**严格、保守**的决策评判.

判定规则:
- verdict 三选一:
    'go'    = 推荐立即推进 (可行性高, 信息完整, 风险可控)
    'hold'  = 暂缓, 前置条件 ok 后再推进 (信息缺、有风险或假设未验证)
    'pivot' = 建议调整方向 (产出本身路径有偏差, 或回答了错的问题)

- score: 0-100 整数, **保守评分**. 严格遵守区间:
    90-100 = 极少给, 几乎所有维度都到位且有明确数据支撑 (含具体数字 / 引用 / 实测)
    75-89  = 推荐推进, 但仍能找到 1-2 处可改进
    60-74  = 方向对但信息不足或假设多, 建议 hold + 补完
    40-59  = 有明显缺口或风险, 必须 pivot 或大改
    0-39   = 答非所问 / 几乎无信息密度 / 严重逻辑错

  ⚠ 默认锚定**不要**给 80+. 没看到 (a) 具体数字/数据 (b) 多场景对比 (c) 风险已识别+有缓解方案 — 三者都到位前不给 80+.
  ⚠ verdict=hold 时 score 必须 < 75. verdict=pivot 时 score 必须 < 60.

- summary: 一句决策结论, 30 字内, 直接说"推进/暂缓/转向" + 最关键原因 + 最大短板
- key_insights: 2-3 条核心洞察, 每条 20 字内, 必须是这次产出**新发现**的, 不是复读输入
- improvements: 1-3 条具体改进建议, 必须可执行 (不要"加强 xx""完善 yy", 必须 "把 X 替换成 Y" 这种)
- next_steps: 1-3 条下一步动作, 每条带**可量化标准** (例: "24h 内列出 3 个候选库", 不是"调研一下")

输出严格 JSON, 不要 markdown 围栏:
{
  "verdict": "go|hold|pivot",
  "score": 0-100,
  "summary": "...",
  "key_insights": ["..."],
  "improvements": ["..."],
  "next_steps": ["..."]
}`

/**
 * 决策引擎 — 给一个 HtmlPageNode 的产出做最终评判.
 * @param {string} prompt 用户的一句话输入
 * @param {string} html  产出的 HTML 页面 (会截前 3000 字符喂 LLM, 防 token 爆)
 * @returns {Promise<{verdict:string, score:number, summary:string, key_insights:string[], improvements:string[], next_steps:string[]} | null>}
 */
export async function runDecisionEngine(prompt, html) {
  if (!prompt || !html) return null
  const stripped = String(html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2400)
  const promptText = `用户输入:
${prompt}

产出页面纯文本摘要 (HTML 标签已剥离):
${stripped}

按 schema 输出决策 JSON.`
  const raw = await callLLM({ system: DECISION_ENGINE_SYSTEM_PROMPT, prompt: promptText, jsonMode: true })
  const parsed = tryParseLLMJson(raw)
  if (!parsed) return null
  const allowed = ['go', 'hold', 'pivot']
  return {
    verdict: allowed.includes(parsed.verdict) ? parsed.verdict : 'hold',
    score: Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0)),
    summary: String(parsed.summary || '').slice(0, 100),
    key_insights: Array.isArray(parsed.key_insights) ? parsed.key_insights.filter(Boolean).slice(0, 4) : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements.filter(Boolean).slice(0, 4) : [],
    next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps.filter(Boolean).slice(0, 4) : [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ALETHEIA Project — 一句话 → 6 stage 项目拆解结构
// 一次 LLM 调用产出整个结构 (project_profile / task_dag / roles / topology / reflection),
// 前端拿到后串行揭示 (CONTEXT → DECOMPOSE → EMERGE → TOPOLOGY → EXECUTE → REFLECT).
// ─────────────────────────────────────────────────────────────────────────────
const META_PROJECT_SYSTEM_PROMPT = `你是 ALETHEIA 元认知项目拆解引擎. 给定用户的一句话目标 (问题/项目/想法), 输出整个项目的 6 阶段元认知拆解 JSON.

阶段语义:
- CONTEXT (project_profile): 把目标抽象成 target/domain/complexity/key_constraints
- DECOMPOSE (task_dag): 把目标拆成 3-5 个串行/并行的可执行任务, 任务之间有依赖
- EMERGE (roles): 涌现 2-4 个 agent 角色, 每个角色承担 1+ 任务, 有具体工具
- TOPOLOGY (execution_topology): 角色按 stage 分组, parallel / serial 执行顺序
- REFLECT (reflection_hint): 1-2 句对这次拆解的元思考

输出 schema (严格 JSON, 不要 markdown 代码块, 不要前言后语):
{
  "project_profile": {
    "target": "一句话项目目标 (30 字内)",
    "domain": "领域分类 (e.g. 电商/SaaS/线下零售/创作)",
    "complexity": "low|medium|high",
    "key_constraints": ["关键约束 1", "关键约束 2"]
  },
  "task_dag": [
    {
      "id": "T1",
      "title": "任务标题 (15 字内)",
      "desc": "任务描述 (40 字内)",
      "deps": []
    }
  ],
  "roles": [
    {
      "id": "R1",
      "name": "角色名称 (e.g. 选址调研员/财务建模师)",
      "responsibility": "一句话职责 (30 字内)",
      "assigned_tasks": ["T1"],
      "tools": ["实地踩点", "Excel 建模"]
    }
  ],
  "execution_topology": {
    "stages": [
      { "stage_index": 1, "role_ids": ["R1", "R2"], "kind": "parallel" },
      { "stage_index": 2, "role_ids": ["R3"], "kind": "serial" }
    ]
  },
  "reflection_hint": "1-2 句对这次拆解的元思考 (50 字内)"
}

约束:
- task_dag 3-5 条, 不要超过 5
- roles 2-4 个 (跟 task_dag 大致对应, 每个角色至少承担 1 个任务)
- task id 用 T1/T2..., role id 用 R1/R2...
- assigned_tasks 必须从 task_dag 的 id 里选
- execution_topology.stages 至少 1 个 stage, role_ids 必须从 roles 的 id 里选, 同一 role 只能出现在一个 stage
- tools 每个角色 1-3 个具体工具/方法
- 字段名英文 (按 schema), 字段值全部中文`

/**
 * 一句话 → ALETHEIA 项目 6 stage 结构
 * @param {string} input 用户一句话
 * @returns {Promise<object>} { project_profile, task_dag, roles, execution_topology, reflection_hint }
 */
export async function generateMetaProjectStructure(input) {
  if (!input || !input.trim()) throw new Error('generateMetaProjectStructure: 输入为空')
  const prompt = `用户输入: ${input.trim()}

请按 system 中的 schema 输出完整 JSON.`
  const raw = await callLLM({ system: META_PROJECT_SYSTEM_PROMPT, prompt, jsonMode: true })
  const parsed = tryParseLLMJson(raw)
  if (!parsed) throw new Error('generateMetaProjectStructure: LLM 输出无法解析为 JSON')

  // 容错归一化, 防止下游 store 崩溃
  const profile = parsed.project_profile || {}
  const tasks = Array.isArray(parsed.task_dag) ? parsed.task_dag : []
  const roles = Array.isArray(parsed.roles) ? parsed.roles : []
  const topology = parsed.execution_topology || {}
  const stages = Array.isArray(topology.stages) ? topology.stages : []

  // 任务 id 集合, 用来过滤无效 deps
  const validTaskIds = new Set(tasks.map((t) => t?.id).filter(Boolean))
  const validRoleIds = new Set(roles.map((r) => r?.id).filter(Boolean))

  return {
    project_profile: {
      target: String(profile.target || input).slice(0, 60),
      domain: String(profile.domain || '通用').slice(0, 20),
      complexity: ['low', 'medium', 'high'].includes(profile.complexity) ? profile.complexity : 'medium',
      key_constraints: Array.isArray(profile.key_constraints) ? profile.key_constraints.filter(Boolean).slice(0, 4) : [],
    },
    task_dag: tasks
      .map((t, i) => ({
        id: String(t?.id || `T${i + 1}`),
        title: String(t?.title || '').slice(0, 30),
        desc: String(t?.desc || t?.description || '').slice(0, 80),
        deps: Array.isArray(t?.deps) ? t.deps.filter((d) => validTaskIds.has(d)) : [],
      }))
      .filter((t) => t.title)
      .slice(0, 5),
    roles: roles
      .map((r, i) => ({
        id: String(r?.id || `R${i + 1}`),
        name: String(r?.name || '').slice(0, 20),
        responsibility: String(r?.responsibility || r?.desc || '').slice(0, 60),
        assigned_tasks: Array.isArray(r?.assigned_tasks) ? r.assigned_tasks.filter((t) => validTaskIds.has(t)) : [],
        tools: Array.isArray(r?.tools) ? r.tools.filter(Boolean).slice(0, 3) : [],
      }))
      .filter((r) => r.name)
      .slice(0, 4),
    execution_topology: {
      stages: stages
        .map((s, i) => ({
          stage_index: Number.isInteger(s?.stage_index) ? s.stage_index : i + 1,
          role_ids: Array.isArray(s?.role_ids) ? s.role_ids.filter((rid) => validRoleIds.has(rid)) : [],
          kind: ['parallel', 'serial'].includes(s?.kind) ? s.kind : 'parallel',
        }))
        .filter((s) => s.role_ids.length > 0),
    },
    reflection_hint: String(parsed.reflection_hint || '').slice(0, 120),
  }
}

/**
 * 一句话 → 完整 HTML 页面字符串 (元认知洞察).
 * @param {string} input 用户一句话
 * @returns {Promise<string>} 完整 HTML 页面字符串
 */
export async function generateAnswerHtml(input) {
  if (!input || !input.trim()) throw new Error('generateAnswerHtml: 输入为空')
  const prompt = `用户输入: ${input.trim()}

请按 system 里的 5 维度规范, 直接输出完整 HTML 页面.`
  const raw = await callLLM({ system: ANSWER_HTML_SYSTEM_PROMPT, prompt, jsonMode: false })
  // 兼容 LLM 偶尔加 ``` 围栏的情况
  let html = String(raw || '').trim()
  if (html.startsWith('```')) {
    html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim()
  }
  // 没有 <!DOCTYPE 时, 包一个最小骨架兜底 (LLM 偶尔忘记)
  if (!/<!DOCTYPE/i.test(html) && !/^<html/i.test(html)) {
    html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>body{font-family:'Noto Sans SC',system-ui;background:#fafafa;color:#1a1a1a;padding:48px;max-width:720px;margin:0 auto;line-height:1.7}</style></head><body>${html}</body></html>`
  }
  return html
}
