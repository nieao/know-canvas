/**
 * LocalTaskExecutor — 本地任务执行引擎
 *
 * 职责：调用 active provider 的 callLLM 执行单个本地任务，
 * 并通过 onUpdate 回调把状态机变化写回 store（不直接依赖 store）。
 *
 * 接口契约（不可变）：runLocalTask({ nodeId, taskId, prompt, system, onUpdate })
 */

import { callLLM } from './aiProvider'

// 默认 system prompt（中文、结构化、限制长度）
const DEFAULT_SYSTEM = `你是一个本地任务执行助手。用户的输入是关于知识画布上某个节点的任务请求。
请用中文简洁直接地回复，结构化输出，不超过 800 字。`

// 单任务超时（毫秒）
const TIMEOUT_MS = 120_000

/** 超时 Promise，到点 reject */
function timeoutPromise(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`本地任务超时（${ms / 1000}s）`)), ms)
  })
}

/**
 * 执行本地任务
 * @param {{nodeId:string, taskId:string, prompt:string, system?:string, onUpdate:(patch:object)=>void}} args
 * @returns {Promise<void>} 不抛异常，错误已通过 onUpdate 通知
 */
export async function runLocalTask({ nodeId, taskId, prompt, system, onUpdate }) {
  // 入参基础校验（防止 store 传错）
  if (typeof onUpdate !== 'function') return
  if (!prompt || typeof prompt !== 'string') {
    onUpdate({ status: 'failed', error: '空 prompt', finishedAt: Date.now() })
    return
  }

  const startedAt = Date.now()
  // 立即标记为运行中（UI 可立刻显示 loading）
  onUpdate({ status: 'running', startedAt })

  try {
    // callLLM 与超时赛跑
    const text = await Promise.race([
      callLLM({ system: system || DEFAULT_SYSTEM, prompt, temperature: 0.3 }),
      timeoutPromise(TIMEOUT_MS),
    ])

    const finishedAt = Date.now()
    onUpdate({
      status: 'done',
      result: typeof text === 'string' ? text : String(text ?? ''),
      finishedAt,
      durationMs: finishedAt - startedAt,
    })
  } catch (err) {
    // 网络错 / provider 未配置 / 超时 — 都走这里，统一通过 onUpdate 通知
    const finishedAt = Date.now()
    onUpdate({
      status: 'failed',
      error: (err && err.message) || String(err) || '未知错误',
      finishedAt,
      durationMs: finishedAt - startedAt,
    })
  }
}
