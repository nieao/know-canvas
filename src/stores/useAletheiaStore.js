/**
 * Aletheia 共识对抗状态管理 (Zustand + Immer)
 * 不使用 persist：避免污染 yjs 协作流；运行时状态短暂、跟随会话
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// 默认权重：逻辑 / 合规 / 商业 三维度均衡
const DEFAULT_WEIGHTS = { logic: 1, compliance: 1, business: 1 }

const useAletheiaStore = create(
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
  }))
)

// 同时导出 default 和命名 — 各 agent 写组件时风格不一,
// 兼容 `import useAletheiaStore from ...` 与 `import { useAletheiaStore } from ...` 两种写法
export { useAletheiaStore }
export default useAletheiaStore
