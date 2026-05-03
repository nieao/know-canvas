/**
 * Know-Canvas - 实时算钱面板 Store (Zustand + Immer + persist)
 *
 * 监听全局 `cost-meter:record` 事件并维护成本数据。
 * 接口契约（A agent 产出，本 store 消费）：
 *   detail = {
 *     taskId, stage, provider, model,
 *     inputTokens, outputTokens, costUsd, costCny,
 *     timestamp, pricingSource, estimated?
 *   }
 *
 * 提供给 C agent（成本面板 UI）消费的 API：
 *   useCostMeterStore: {
 *     events, totalCostUsd, totalCostCny, totalTokens,
 *     recordCost, getCostByTaskId, getRecentTasks, resetCost
 *   }
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// events 上限：超出后从最旧的开始裁剪，避免长跑泄漏内存
const MAX_EVENTS = 1000

const useCostMeterStore = create(
  persist(
    immer((set, get) => ({
      // ========== state ==========

      events: [],
      totalCostUsd: 0,
      totalCostCny: 0,
      totalTokens: { input: 0, output: 0 },

      // ========== actions ==========

      /**
       * 追加一条 cost 事件并累加 totals
       * @param {object} event - cost-meter:record 事件 detail
       */
      recordCost: (event) =>
        set((state) => {
          if (!event || typeof event !== 'object') return

          // 标准化字段（容错），上游可能字段缺失
          const normalized = {
            taskId: String(event.taskId || 'unknown'),
            stage: String(event.stage || 'unknown'),
            provider: String(event.provider || 'unknown'),
            model: String(event.model || 'unknown'),
            inputTokens: Number(event.inputTokens) || 0,
            outputTokens: Number(event.outputTokens) || 0,
            costUsd: Number(event.costUsd) || 0,
            costCny: Number(event.costCny) || 0,
            timestamp: Number(event.timestamp) || Date.now(),
            pricingSource: String(event.pricingSource || 'unknown'),
            estimated: !!event.estimated,
          }

          state.events.push(normalized)

          // 砍掉最旧的，保持 events 长度不超过 MAX_EVENTS
          if (state.events.length > MAX_EVENTS) {
            state.events.splice(0, state.events.length - MAX_EVENTS)
          }

          state.totalCostUsd += normalized.costUsd
          state.totalCostCny += normalized.costCny
          state.totalTokens.input += normalized.inputTokens
          state.totalTokens.output += normalized.outputTokens
        }),

      /**
       * 按 taskId 聚合该 task 所有事件，按 stage 分组累加
       * @param {string} taskId
       * @returns {{ stages: Record<string, {costUsd, costCny, tokens, count}>, total: {...}, events: [] }}
       */
      getCostByTaskId: (taskId) => {
        const all = get().events.filter((e) => e.taskId === taskId)
        const stages = {}
        const total = {
          costUsd: 0,
          costCny: 0,
          tokens: { input: 0, output: 0 },
          count: 0,
        }

        for (const e of all) {
          if (!stages[e.stage]) {
            stages[e.stage] = {
              costUsd: 0,
              costCny: 0,
              tokens: { input: 0, output: 0 },
              count: 0,
            }
          }
          const s = stages[e.stage]
          s.costUsd += e.costUsd
          s.costCny += e.costCny
          s.tokens.input += e.inputTokens
          s.tokens.output += e.outputTokens
          s.count += 1

          total.costUsd += e.costUsd
          total.costCny += e.costCny
          total.tokens.input += e.inputTokens
          total.tokens.output += e.outputTokens
          total.count += 1
        }

        return { stages, total, events: all }
      },

      /**
       * 取最近 N 个不同 taskId 的汇总（按最新事件时间倒序）
       * @param {number} limit - 默认 5
       * @returns {Array<{ taskId, total, lastTs, eventCount }>}
       */
      getRecentTasks: (limit = 5) => {
        const grouped = new Map()
        // 倒序遍历，先遇到的就是最新的事件，初始化 lastTs
        const events = get().events
        for (let i = events.length - 1; i >= 0; i--) {
          const e = events[i]
          if (!grouped.has(e.taskId)) {
            grouped.set(e.taskId, {
              taskId: e.taskId,
              total: {
                costUsd: 0,
                costCny: 0,
                tokens: { input: 0, output: 0 },
                count: 0,
              },
              lastTs: e.timestamp,
              eventCount: 0,
            })
          }
          const g = grouped.get(e.taskId)
          g.total.costUsd += e.costUsd
          g.total.costCny += e.costCny
          g.total.tokens.input += e.inputTokens
          g.total.tokens.output += e.outputTokens
          g.total.count += 1
          g.eventCount += 1
          if (e.timestamp > g.lastTs) g.lastTs = e.timestamp
        }

        return Array.from(grouped.values())
          .sort((a, b) => b.lastTs - a.lastTs)
          .slice(0, Math.max(0, Number(limit) || 0))
      },

      /**
       * 清空 events 和所有 totals
       */
      resetCost: () =>
        set((state) => {
          state.events = []
          state.totalCostUsd = 0
          state.totalCostCny = 0
          state.totalTokens = { input: 0, output: 0 }
        }),
    })),
    {
      name: 'know_canvas_cost_meter',
      // 持久化全部累积数据，刷新页面后能看到历史
      partialize: (state) => ({
        events: state.events,
        totalCostUsd: state.totalCostUsd,
        totalCostCny: state.totalCostCny,
        totalTokens: state.totalTokens,
      }),
    }
  )
)

// ========== 全局事件监听挂载（只挂一次） ==========
// 用 module-level 标志位 + window 标志位双重防护，避免 HMR 重复挂载
if (typeof window !== 'undefined') {
  const FLAG = '__know_canvas_cost_meter_listener_attached__'
  if (!window[FLAG]) {
    window[FLAG] = true
    window.addEventListener('cost-meter:record', (e) => {
      try {
        useCostMeterStore.getState().recordCost(e.detail)
      } catch (err) {
        // 不要因为一条坏事件把流冲掉
        // eslint-disable-next-line no-console
        console.warn('[CostMeter] recordCost 失败:', err)
      }
    })
  }
}

// 兼容 default 与命名导入两种风格
export { useCostMeterStore }
export default useCostMeterStore
