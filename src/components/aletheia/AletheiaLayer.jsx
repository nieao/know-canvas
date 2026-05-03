/**
 * AletheiaLayer - Aletheia 决策引擎 UI 总叠加层
 *
 * 默认收起 (右下角浮动入口按钮 + 自我说明), 不干扰画布;
 * 点击「启动 Aletheia」激活后, 全屏接管:
 *   - 顶部 banner: "ALETHEIA · 逻辑对抗决策引擎" + 关闭 ×
 *   - 顶部场景切换 (ToB/ToC/ToG)
 *   - 左侧辩论流弹幕
 *   - 右侧 HealthScore 大圆环 + 综合按钮
 *   - 中央不可能三角 (装饰浮窗, 鼠标穿透)
 *   - 底部循环条 + 齿轮入口
 *   - 齿轮抽屉 (反驳人格 / 对抗权重 / 循环阈值)
 *   - ActionPlan 弹窗
 */

import { useState, useEffect } from 'react'
import { useAletheiaStore } from '../../stores/useAletheiaStore'
import useCanvasStore from '../../stores/useCanvasStore'
import { runAletheiaCycle } from '../../services/aletheia/runner'
import HealthScoreRing from './HealthScoreRing'
import LoopStatusBar from './LoopStatusBar'
import ScenarioSwitcher from './ScenarioSwitcher'
import DebateStreamPanel from './DebateStreamPanel'
import ActionPlanModal from './ActionPlanModal'
import AdvancedPanel from './AdvancedPanel'

export default function AletheiaLayer() {
  const active = useAletheiaStore((s) => s?.aletheiaActive ?? false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [actionPlanOpen, setActionPlanOpen] = useState(false)
  // 推导循环状态 — 跑一轮反驳 + 综合时的实时进度提示
  const [running, setRunning] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')

  // 监听 SynthesisNode 触发的 "查看完整方案" 事件
  useEffect(() => {
    const onShowPlan = () => setActionPlanOpen(true)
    window.addEventListener('aletheia:show-action-plan', onShowPlan)
    return () => window.removeEventListener('aletheia:show-action-plan', onShowPlan)
  }, [])

  // 触发一轮 Aletheia 推导 — 扫画布 → LLM 反驳 → ChallengeNode 一条条长出 → 综合
  const handleRunCycle = async () => {
    if (running) return
    setRunning(true)
    setProgressMsg('启动 Aletheia 推导...')
    const store = useCanvasStore.getState()
    try {
      await runAletheiaCycle({
        canvasNodes: store.nodes,
        canvasEdges: store.edges,
        store,
        onProgress: (p) => {
          const tag = p?.stage ? `[${p.stage}]` : ''
          const msg = p?.message
            || `${p?.stage || ''} ${p?.count != null ? p.count + '/' + p.total : ''} ${p?.current || ''}`.trim()
          setProgressMsg(`${tag} ${msg}`.trim())
        },
      })
    } catch (e) {
      setProgressMsg(`推导失败: ${e?.message || e}`)
    } finally {
      setRunning(false)
      setTimeout(() => setProgressMsg(''), 5000)
    }
  }

  // 默认 (未激活) — 只显示右下角浮动入口
  if (!active) {
    return <AletheiaLauncher />
  }

  // 激活后 — 全屏 Aletheia 决策引擎
  return (
    <>
      {/* 顶部 banner — 标识当前是 Aletheia 模式 + 关闭入口
          z-[60] 必须高于 SaveExportToolbar (z-50), 否则工具栏的"排序"按钮会拦截"对画布跑一轮"的点击 */}
      <div
        className="absolute top-0 left-0 right-0 z-[60] flex items-center justify-between px-6 py-3"
        style={{
          background: 'linear-gradient(180deg, rgba(26,26,26,0.92) 0%, rgba(26,26,26,0.6) 100%)',
          backdropFilter: 'blur(16px)',
          pointerEvents: 'auto',
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="inline-block w-2 h-2 rounded-full animate-pulse"
            style={{ backgroundColor: '#c8a882' }}
          />
          <div>
            <div
              className="text-xs font-medium"
              style={{ color: '#c8a882', letterSpacing: '0.35em' }}
            >
              ALETHEIA
            </div>
            <div
              className="text-sm"
              style={{ color: '#fafafa', fontFamily: '"Noto Serif SC", Georgia, serif' }}
            >
              逻辑对抗决策引擎 · 本体拆解 + 多 agent 反驳 + 共识综合
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 开始推导 — 对画布跑一轮反驳 + 综合 */}
          <button
            onClick={handleRunCycle}
            disabled={running}
            className="px-3 py-1.5 text-xs rounded transition-all"
            style={{
              color: running ? 'rgba(250,250,250,0.55)' : '#1a1a1a',
              background: running ? 'transparent' : '#c8a882',
              border: running ? '1px solid rgba(200,168,130,0.45)' : '1px solid #c8a882',
              letterSpacing: '0.15em',
              cursor: running ? 'wait' : 'pointer',
              fontWeight: 500,
            }}
            title="扫描画布提议 → 调反驳 agent 产出 ChallengeNode → 综合方案"
          >
            {running ? '推导中...' : '⚔ 对画布跑一轮'}
          </button>
          <button
            onClick={() => useAletheiaStore.getState().toggleAletheia()}
            className="px-3 py-1.5 text-xs rounded transition-colors"
            style={{
              color: '#fafafa',
              border: '1px solid rgba(250,250,250,0.3)',
              letterSpacing: '0.15em',
            }}
          >
            关闭 Aletheia
          </button>
        </div>
      </div>

      {/* 推导进度提示条 — 只在 progressMsg 非空时显示 */}
      {progressMsg && (
        <div
          className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded text-xs"
          style={{
            background: 'rgba(26,26,26,0.92)',
            color: '#fafafa',
            border: '1px solid #c8a882',
            backdropFilter: 'blur(12px)',
            letterSpacing: '0.05em',
            pointerEvents: 'auto',
            maxWidth: '70vw',
            animation: 'aletheia-progress-pulse 1.6s ease-in-out infinite',
            boxShadow: '0 4px 18px rgba(200,168,130,0.18)',
          }}
        >
          {progressMsg}
        </div>
      )}
      <style>{`
        @keyframes aletheia-progress-pulse {
          0%, 100% { box-shadow: 0 4px 18px rgba(200,168,130,0.18); }
          50%      { box-shadow: 0 4px 24px rgba(200,168,130,0.42); }
        }
      `}</style>

      {/* 顶部场景切换 (在 banner 下) */}
      <div
        className="absolute top-20 left-1/2 -translate-x-1/2 z-30"
        style={{ pointerEvents: 'auto' }}
      >
        <ScenarioSwitcher />
      </div>

      {/* 左侧 - 辩论流弹幕 (避开 LeftPanel 的位置, 用透明背景) */}
      <div
        className="absolute top-44 left-3 bottom-20 z-20"
        style={{ pointerEvents: 'auto' }}
      >
        <DebateStreamPanel />
      </div>

      {/* 中央装饰图 (ImpossibleTriangle) 已移除 — 用户反馈干扰画布观察 */}

      {/* 右侧 - Health Score 圆环 (在 banner 下, 避开 RightPanel) */}
      <div
        className="absolute top-32 right-6 z-20"
        style={{ pointerEvents: 'auto' }}
      >
        <HealthScoreRing />
      </div>

      {/* 底部 - 循环状态条 + 齿轮入口 */}
      <div
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30"
        style={{ pointerEvents: 'auto' }}
      >
        <LoopStatusBar onOpenAdvanced={() => setAdvancedOpen(true)} />
      </div>

      {/* 齿轮抽屉 - 高级参数中心 */}
      <AdvancedPanel open={advancedOpen} onClose={() => setAdvancedOpen(false)} />

      {/* Action Plan 弹窗 */}
      <ActionPlanModal open={actionPlanOpen} onClose={() => setActionPlanOpen(false)} />
    </>
  )
}

/** 右下角浮动入口 — 默认状态显示, 一句话讲清楚是干啥的 */
function AletheiaLauncher() {
  const healthScore = useAletheiaStore((s) => s?.healthScore ?? 0)
  const handleStart = () => {
    useAletheiaStore.getState().toggleAletheia()
  }
  return (
    <div
      className="absolute bottom-20 right-6 z-30"
      style={{ pointerEvents: 'auto' }}
    >
      <button
        onClick={handleStart}
        className="group flex items-center gap-3 pl-4 pr-5 py-3 rounded-md transition-all hover:translate-y-[-2px]"
        style={{
          background: '#1a1a1a',
          color: '#fafafa',
          border: '1px solid #1a1a1a',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          letterSpacing: '0.05em',
        }}
        title="点击进入 Aletheia 决策引擎: 一句话 → 多 agent 提议 / 反驳 / 共识 / 输出 Action Plan"
      >
        {/* 暖色脉冲圆点 */}
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{
            backgroundColor: '#c8a882',
            boxShadow: '0 0 8px #c8a882',
            animation: 'aletheia-launcher-pulse 2s ease-in-out infinite',
          }}
        />
        <div className="text-left">
          <div
            className="text-[10px]"
            style={{ color: '#c8a882', letterSpacing: '0.35em' }}
          >
            ALETHEIA
          </div>
          <div className="text-sm font-medium">启动决策引擎</div>
        </div>
        <span
          className="ml-1 text-xs"
          style={{
            color: 'rgba(250,250,250,0.5)',
            transition: 'transform 0.3s',
          }}
        >
          ⚔
        </span>
      </button>
      {/* 副标题: 一句话说清楚是干啥的 */}
      <div
        className="mt-2 text-[10px] text-right"
        style={{ color: '#888', letterSpacing: '0.05em' }}
      >
        本体拆解 + 多 agent 对抗 + 共识综合
      </div>

      {/* 脉冲动画 keyframes (内联 CSS) */}
      <style>{`
        @keyframes aletheia-launcher-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}
