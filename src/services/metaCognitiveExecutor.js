/**
 * MetaCognitive Executor — 元认知 skill 执行引擎
 *
 * 替代原"本地任务"的简单 callLLM, 走 5 步元认知工作流, 每一步在画布上长出一个
 * metaStepNode. 当前 running 步有脉冲 + border 流光动画, 完成后定格暖色.
 *
 * 步骤认知规范 (system prompt 见 STEP_PROMPTS):
 *   1. Intent      — 意图理解: 核心问题 + 隐含目标 + 歧义点
 *   2. Decompose   — 任务拆解: 子任务清单 + 关键路径
 *   3. Execute     — 逐步执行: 每子任务给结果 + confidence + evidence
 *   4. Reflect     — 反思校验: verdict + 薄弱点 + 改进建议
 *   5. Synthesize  — 综合输出: 最终答复 + 关键洞察 + 元认知教训
 *
 * 接口契约:
 *   runMetaCognitiveTask({ nodeId, taskId, prompt, store, onUpdate })
 *   onUpdate(patch) — 把整体任务状态更新写回 store (status / currentStep / steps)
 */

import { callLLM } from './aiProvider'
import useCanvasStore from '../stores/useCanvasStore'
import { saveCurrentCanvasAsProject } from './projectLibraryActions'

const STEP_DEFS = [
  { id: 'intent',     label: '意图理解',  icon: '🧠', en: 'INTENT' },
  { id: 'decompose',  label: '任务拆解',  icon: '🔧', en: 'DECOMPOSE' },
  { id: 'execute',    label: '逐步执行',  icon: '⚡', en: 'EXECUTE' },
  { id: 'reflect',    label: '反思校验',  icon: '🔍', en: 'REFLECT' },
  { id: 'synthesize', label: '综合输出',  icon: '✨', en: 'SYNTHESIZE' },
]

const STEP_PROMPTS = {
  intent: `你是元认知任务流的"意图理解"角色。任务: 把用户原始一句话需求拆开, 抽出本质问题、隐含目标、可能的歧义.

认知规范:
- 不要复读用户的话, 要往下挖一层
- 隐含目标必须 3 条, 都是用户想要但没说出口的东西
- 歧义点 2-3 条, 是后续拆解前必须澄清的关键点

严格输出 JSON 不要任何额外文字:
{
  "core_question": "本质问题一句话, 限 40 字",
  "implicit_goals": ["隐含目标 1", "隐含目标 2", "隐含目标 3"],
  "context_assumptions": ["默认前提 1", "默认前提 2"],
  "ambiguities": ["可能歧义 1, 限 40 字", "可能歧义 2", "可能歧义 3"]
}`,

  decompose: `你是元认知任务流的"任务拆解"角色. 基于上一步意图理解的输出, 把任务拆成 3-5 个可执行子步骤.

认知规范:
- 每个子任务必须可独立执行 (有明确输入和输出形式)
- 标出关键路径 (critical_path) — 哪几步是最重要的
- depends_on 写清楚步骤间依赖, 没依赖留空数组

严格输出 JSON 不要任何额外文字:
{
  "strategy": "整体策略一句话, 50 字内",
  "subtasks": [
    {
      "id": "s1",
      "name": "子任务名, 限 20 字",
      "input": "需要的输入, 限 40 字",
      "output_format": "期望输出形式 (清单/方案/对比表/...), 限 30 字",
      "depends_on": []
    }
  ],
  "critical_path": ["s1", "s3"]
}`,

  execute: `你是元认知任务流的"执行"角色. 基于上一步拆解, 对每个子任务给出实质性结果.

认知规范:
- 不要泛泛而谈, 每条 output 必须 100-300 字, 含具体内容/数字/实例
- confidence 评估自己对这条结果的把握 (0.0-1.0)
- evidence 给 2-3 条论据 (引用原则/数据/案例)
- 不会做的子任务也要诚实说"信息不足", 不要编

严格输出 JSON 不要任何额外文字:
{
  "results": [
    {
      "subtask_id": "s1",
      "output": "具体内容 100-300 字, 用 markdown",
      "confidence": 0.85,
      "evidence": ["论据 1", "论据 2", "论据 3"]
    }
  ]
}`,

  reflect: `你是元认知任务流的"反思"角色. 严格审视上一步执行的输出, 是否真的回应了第一步的核心问题.

认知规范:
- 不要装好人, 找漏洞才有价值
- verdict 三选一: passed (>=80% 解决) / partial (50-80%) / failed (<50%)
- weaknesses 至少 2 条, 不能是"还可以再深入"这种废话
- missing_evidence 列出 Execute 没给但本来该有的论据
- suggested_revision 给 1-2 条具体改进路径

严格输出 JSON 不要任何额外文字:
{
  "verdict": "passed|partial|failed",
  "checks": [
    { "criterion": "是否覆盖核心问题", "result": "yes|no|partial", "note": "限 40 字" },
    { "criterion": "是否处理了歧义点", "result": "yes|no|partial", "note": "限 40 字" },
    { "criterion": "evidence 是否充分", "result": "yes|no|partial", "note": "限 40 字" }
  ],
  "weaknesses": ["薄弱点 1, 限 50 字", "薄弱点 2"],
  "missing_evidence": ["缺什么论据 1", "缺什么 2"],
  "suggested_revision": "如果要改进, 改哪里 (限 60 字)"
}`,

  synthesize: `你是元认知任务流的"综合输出"角色. 基于前 4 步 (意图/拆解/执行/反思), 给用户一份干净的最终答复.

认知规范:
- final_answer 是用户最终拿走的东西, markdown 格式, 限 600 字
- 必须采纳 Reflect 的 weaknesses 和 suggested_revision, 不要敷衍
- key_insights 3 条最有价值的洞察 (不是流水账)
- lessons_learned 是元认知层的教训 — "这种问题以后这样想" (1-2 条)

严格输出 JSON 不要任何额外文字:
{
  "final_answer": "用户最终答案, markdown 600 字内",
  "key_insights": ["洞察 1, 限 50 字", "洞察 2", "洞察 3"],
  "lessons_learned": ["元认知教训 1, 限 60 字", "教训 2"]
}`,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const STEP_TIMEOUT_MS = 60_000  // 单步超时 60s

/** 解析 JSON, 抗 ```json``` 围栏 + 抗前后缀 */
function parseJson(raw) {
  if (!raw) return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  const cand = fenced ? fenced[1] : raw
  try { return JSON.parse(cand) } catch {}
  const a = cand.indexOf('{'), b = cand.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try { return JSON.parse(cand.slice(a, b + 1)) } catch {}
  }
  return null
}

function timeoutPromise(ms, label) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 超时 (${ms / 1000}s)`)), ms))
}

/**
 * 主 runner — 5 步元认知工作流
 * @param {{ nodeId:string, taskId:string, prompt:string, onUpdate:(p)=>void }} args
 */
export async function runMetaCognitiveTask({ nodeId, taskId, prompt, onUpdate }) {
  if (typeof onUpdate !== 'function') return
  if (!prompt || typeof prompt !== 'string') {
    onUpdate({ status: 'failed', error: '空 prompt', finishedAt: Date.now() })
    return
  }

  const startedAt = Date.now()
  // 整体进度: 把 5 步元数据先初始化, UI 立刻看到 5 个 pending 占位
  const initialSteps = STEP_DEFS.map((d) => ({
    id: d.id, label: d.label, icon: d.icon, en: d.en,
    status: 'pending',  // pending | running | done | failed
    output: null, raw: null, startedAt: null, finishedAt: null,
  }))
  onUpdate({ status: 'running', startedAt, currentStep: null, steps: initialSteps })

  // 在画布上为每一步创建一个占位 metaStepNode (用 store action)
  const store = useCanvasStore.getState()
  const sourceNode = store.nodes.find((n) => n.id === nodeId)
  if (!sourceNode) {
    onUpdate({ status: 'failed', error: `找不到源节点 ${nodeId}`, finishedAt: Date.now() })
    return
  }

  const stepNodeIds = []
  if (typeof store.addMetaStepNode === 'function') {
    for (let i = 0; i < STEP_DEFS.length; i++) {
      const d = STEP_DEFS[i]
      const id = store.addMetaStepNode({
        sourceNodeId: nodeId,
        taskId,
        stepId: d.id,
        index: i,
        label: d.label,
        icon: d.icon,
        en: d.en,
      })
      stepNodeIds.push(id)
    }
  }

  // 执行链: 上下文逐步累积传给下一步
  const ctx = { user_prompt: prompt }

  for (let i = 0; i < STEP_DEFS.length; i++) {
    const def = STEP_DEFS[i]
    const stepNodeId = stepNodeIds[i]
    const stepStartedAt = Date.now()

    // 标记当前步 running (UI 脉冲 + 流光动画)
    onUpdate({ currentStep: def.id })
    if (typeof store.updateMetaStepNodeStatus === 'function' && stepNodeId) {
      store.updateMetaStepNodeStatus(stepNodeId, { status: 'running', startedAt: stepStartedAt })
    }
    onUpdate({ steps: updateStepInList(initialSteps, def.id, { status: 'running', startedAt: stepStartedAt }) })

    // 组装 user prompt: 把累积上下文喂给当前步
    const userPrompt = [
      `【元认知任务流 ${i + 1}/5 · ${def.label}】`,
      '',
      '【用户原始需求】',
      ctx.user_prompt,
      '',
      ...(ctx.intent ? ['【上一步 - 意图理解输出】', JSON.stringify(ctx.intent, null, 2), ''] : []),
      ...(ctx.decompose ? ['【上一步 - 任务拆解输出】', JSON.stringify(ctx.decompose, null, 2), ''] : []),
      ...(ctx.execute ? ['【上一步 - 执行输出】', JSON.stringify(ctx.execute, null, 2), ''] : []),
      ...(ctx.reflect ? ['【上一步 - 反思输出】', JSON.stringify(ctx.reflect, null, 2), ''] : []),
      `请按【${def.label}】的认知规范输出 JSON.`,
    ].join('\n')

    let raw = ''
    let parsed = null
    let stepError = null

    try {
      raw = await Promise.race([
        callLLM(
          { system: STEP_PROMPTS[def.id], prompt: userPrompt, temperature: 0.4, jsonMode: true },
          { taskId, stage: def.id }
        ),
        timeoutPromise(STEP_TIMEOUT_MS, `Step ${i + 1} ${def.label}`),
      ])
      parsed = parseJson(raw)
      if (!parsed) throw new Error('LLM 输出无法解析为 JSON')
    } catch (err) {
      stepError = err?.message || String(err)
    }

    const stepFinishedAt = Date.now()

    if (stepError) {
      // 当前步失败 — 标记 failed, 终止后续
      if (typeof store.updateMetaStepNodeStatus === 'function' && stepNodeId) {
        store.updateMetaStepNodeStatus(stepNodeId, {
          status: 'failed',
          error: stepError,
          finishedAt: stepFinishedAt,
        })
      }
      onUpdate({
        status: 'failed',
        error: `第 ${i + 1} 步 (${def.label}) 失败: ${stepError}`,
        currentStep: def.id,
        finishedAt: stepFinishedAt,
        steps: updateStepInList(
          initialSteps, def.id,
          { status: 'failed', error: stepError, finishedAt: stepFinishedAt }
        ),
      })
      return
    }

    // 成功 — 累积上下文 + 标记 done + UI 节点定格
    ctx[def.id] = parsed
    if (typeof store.updateMetaStepNodeStatus === 'function' && stepNodeId) {
      store.updateMetaStepNodeStatus(stepNodeId, {
        status: 'done',
        output: parsed,
        finishedAt: stepFinishedAt,
        durationMs: stepFinishedAt - stepStartedAt,
      })
    }
    onUpdate({
      currentStep: def.id,
      steps: updateStepInList(
        initialSteps, def.id,
        { status: 'done', output: parsed, raw, finishedAt: stepFinishedAt, durationMs: stepFinishedAt - stepStartedAt }
      ),
    })

    // 步骤之间留一个短间隔, 让用户看清楚 "current → next" 的切换
    if (i < STEP_DEFS.length - 1) await sleep(400)
  }

  // 全部完成 — 整体状态 done, 提取 final_answer 作为 task.result
  const finishedAt = Date.now()
  const finalAnswer = ctx.synthesize?.final_answer
    || JSON.stringify(ctx.synthesize, null, 2)
    || '元认知流程完成, 但 Synthesize 未返回 final_answer'
  onUpdate({
    status: 'done',
    result: finalAnswer,
    metaContext: ctx,
    finishedAt,
    durationMs: finishedAt - startedAt,
  })

  // 通知画布 fitView, 让用户一眼看到所有 5 步节点
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('meta-task:done', { detail: { taskId, nodeId } })) } catch {}
  }

  // 5 步元认知全部完成 — 自动把当前画布作为一个新项目保存到项目库
  // (失败不抛, 不影响主流程)
  try {
    const titleSeed = (prompt || '').trim().replace(/\s+/g, ' ').slice(0, 30) || '元认知任务'
    const finalSummary = typeof finalAnswer === 'string'
      ? finalAnswer.replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)
      : ''
    saveCurrentCanvasAsProject({
      title: `元认知 · ${titleSeed}`,
      summary: finalSummary,
      taskId,
      source: 'meta-cognitive',
    })
  } catch (err) {
    // 静默 — 项目库保存失败不应中断元认知流程
    console.warn('[metaCognitive] 项目库自动保存失败:', err?.message || err)
  }
}

// 帮助函数: immutable 更新 steps 数组里某一步的字段
function updateStepInList(steps, stepId, patch) {
  return steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s))
}

export { STEP_DEFS, STEP_PROMPTS }
