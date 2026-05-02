/**
 * 知识图谱 AI 服务
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
export const SYSTEM_PROMPT = `你是知识图谱助手。分析用户输入的文本，提取关键概念和它们之间的关系。输出严格的 JSON 格式，不要包含 markdown 代码块。

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
  const system = '你是知识图谱关系推断助手。给定一组概念，推断它们之间最有价值的连接关系。'
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
