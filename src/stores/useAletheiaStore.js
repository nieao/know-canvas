/**
 * Aletheia 共识对抗状态管理 (Zustand + Immer)
 * 运行时态（debateStream / lastSynthesis 等）不持久化：避免污染 yjs 协作流；
 * 仅持久化用户级"成本反馈"偏好（costWeight / costFeedbackHistory），见底部 partialize。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// 默认权重：逻辑 / 合规 / 商业 三维度均衡
const DEFAULT_WEIGHTS = { logic: 1, compliance: 1, business: 1 }

// 成本反馈相关常量
const COST_FEEDBACK_STEP = 0.15 * 0.5 // 0.075，每次反馈对 costWeight 的 delta 绝对值
const COST_FEEDBACK_HISTORY_MAX = 50 // history 上限

const useAletheiaStore = create(
  persist(
    immer((set, get) => ({
    // ========== 模式开关 ==========

    // Aletheia 模式: false = 画布默认视图 (左右 panel 正常显示, AletheiaLayer 只显示右下角入口按钮)
    //                true = Aletheia 决策引擎激活 (全屏接管, 顶部 banner + 三角 + 圆环 + 辩论流 + 齿轮)
    aletheiaActive: false,
    toggleAletheia: () =>
      set((state) => {
        state.aletheiaActive = !state.aletheiaActive
      }),
    setAletheiaActive: (b) =>
      set((state) => {
        state.aletheiaActive = !!b
      }),

    // ========== 配置态（用户可调） ==========

    // 场景模式：业务侧 / 用户侧 / 政府侧
    scenario: 'tob',
    setScenario: (s) =>
      set((state) => {
        state.scenario = s
      }),

    // 反驳人格：Reddit 杠精 / 风险审计师 / 苏格拉底
    persona: 'reddit',
    setPersona: (p) =>
      set((state) => {
        state.persona = p
      }),

    // 对抗权重：逻辑 / 合规 / 商业（不强求 sum=3）
    weights: { ...DEFAULT_WEIGHTS },
    setWeights: (w) =>
      set((state) => {
        state.weights = { ...state.weights, ...w }
      }),

    // 循环阈值：最大轮数 1-10
    maxRounds: 5,
    setMaxRounds: (n) =>
      set((state) => {
        const clamped = Math.max(1, Math.min(10, Number(n) || 1))
        state.maxRounds = clamped
      }),

    // 退出阈值：本轮共识增量小于该值即提前退出 0.005-0.1
    exitDelta: 0.01,
    setExitDelta: (d) =>
      set((state) => {
        const clamped = Math.max(0.005, Math.min(0.1, Number(d) || 0.01))
        state.exitDelta = clamped
      }),

    // ========== 运行时态（agent 写入） ==========

    // 当前轮次 0..maxRounds
    currentRound: 0,
    setRound: (n) =>
      set((state) => {
        state.currentRound = Math.max(0, Number(n) || 0)
      }),

    // 健康分 0..100
    healthScore: 0,
    setHealthScore: (s) =>
      set((state) => {
        state.healthScore = Math.max(0, Math.min(100, Number(s) || 0))
      }),

    // 辩论流弹幕：[{ ts, role, text, severity? }]
    debateStream: [],
    pushDebate: (item) =>
      set((state) => {
        // 默认补时间戳，避免上游遗漏
        const enriched = {
          ts: item.ts || Date.now(),
          role: item.role || 'system',
          text: item.text || '',
          ...item,
        }
        state.debateStream.push(enriched)
        // 弹幕封顶 500 条，避免长跑泄漏内存
        if (state.debateStream.length > 500) {
          state.debateStream.splice(0, state.debateStream.length - 500)
        }
      }),
    clearDebate: () =>
      set((state) => {
        state.debateStream = []
      }),

    // 是否正在跑共识对抗循环
    isRunning: false,
    setRunning: (b) =>
      set((state) => {
        state.isRunning = !!b
      }),

    // 上一次共识综合产出 { actionPlan, summary, healthScore, ts }
    lastSynthesis: null,
    setSynthesis: (syn) =>
      set((state) => {
        state.lastSynthesis = syn
          ? {
              ts: syn.ts || Date.now(),
              ...syn,
            }
          : null
      }),

    // ========== 复合操作 ==========

    // 重置运行时态（保留用户配置）
    resetRuntime: () =>
      set((state) => {
        state.currentRound = 0
        state.healthScore = 0
        state.debateStream = []
        state.isRunning = false
        state.lastSynthesis = null
      }),

    // ========== 成本反馈回路 (cost balance feedback loop) ==========
    // costWeight ∈ [0, 1]：用户对"成本"维度的敏感度
    //   0.5 = 中性；越大表示越在乎成本（贵→负反馈）；越小表示越愿意烧钱换质量
    costWeight: 0.5,

    // 反馈历史：用于审计 + UI 时间线
    // [{ taskId, type: 'expensive'|'worth_it', costAtTime, ts, costWeightAfter }]
    costFeedbackHistory: [],

    /**
     * 用户对某次任务给出"贵了"或"值"的反馈，调整 costWeight
     * @param {{ taskId: string, type: 'expensive'|'worth_it', costAtTime: number }} payload
     */
    pushCostFeedback: ({ taskId, type, costAtTime }) =>
      set((state) => {
        let delta = 0
        if (type === 'expensive') delta = +COST_FEEDBACK_STEP
        else if (type === 'worth_it') delta = -COST_FEEDBACK_STEP
        else return // 未知 type，静默丢弃

        const next = Math.max(0, Math.min(1, state.costWeight + delta))
        state.costWeight = next

        state.costFeedbackHistory.push({
          taskId: String(taskId || 'unknown'),
          type,
          costAtTime: Number(costAtTime) || 0,
          ts: Date.now(),
          costWeightAfter: next,
        })

        if (state.costFeedbackHistory.length > COST_FEEDBACK_HISTORY_MAX) {
          state.costFeedbackHistory.splice(
            0,
            state.costFeedbackHistory.length - COST_FEEDBACK_HISTORY_MAX
          )
        }

        // 调试日志（产线噪音可控，反馈频率本就低）
        // eslint-disable-next-line no-console
        console.log('[Aletheia] costWeight 更新为:', next)
      }),

    /**
     * 把 costWeight 注入"成本/效率"维度后返回新的 weights 对象（纯函数，不修改 store）
     *
     * 行为：
     *   1. 若 rawWeights 存在成本相关键（reduceCost / efficiency / costAware / cost），
     *      把 costWeight 作为系数乘上去（保留原始 0 值不被吃掉，乘 0 仍 0 是合理语义）
     *   2. 都没有的话，在返回对象里加一个新字段 _costBias: costWeight，让下游决策器自己解读
     *
     * @param {object} rawWeights - 当前 weights 快照
     * @returns {object} 新对象，不破坏入参
     */
    applyCostBiasToWeights: (rawWeights) => {
      const cw = get().costWeight
      const src = rawWeights && typeof rawWeights === 'object' ? rawWeights : {}
      const next = { ...src }

      const COST_KEYS = ['reduceCost', 'efficiency', 'costAware', 'cost']
      let hit = false
      for (const k of COST_KEYS) {
        if (Object.prototype.hasOwnProperty.call(src, k)) {
          next[k] = Number(src[k]) * cw
          hit = true
        }
      }
      if (!hit) {
        next._costBias = cw
      }
      return next
    },

    /**
     * 重置成本反馈到中性（0.5）并清空历史
     */
    resetCostBalance: () =>
      set((state) => {
        state.costWeight = 0.5
        state.costFeedbackHistory = []
      }),
  })),
    {
      name: 'know_canvas_aletheia_cost_balance',
      // 仅持久化用户对成本的偏好，不持久化 debateStream / weights 等运行时/协作态
      partialize: (state) => ({
        costWeight: state.costWeight,
        costFeedbackHistory: state.costFeedbackHistory,
      }),
    }
  )
)

// 同时导出 default 和命名 — 各 agent 写组件时风格不一,
// 兼容 `import useAletheiaStore from ...` 与 `import { useAletheiaStore } from ...` 两种写法
export { useAletheiaStore }
export default useAletheiaStore
