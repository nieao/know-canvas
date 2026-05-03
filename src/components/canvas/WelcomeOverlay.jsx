/**
 * WelcomeOverlay — 画布空状态欢迎覆盖层
 *
 * 当 nodes.length === 0 时显示在画布上层，引导用户导入文件 / 添加节点。
 * Aletheia 激活时自动隐藏，避免遮挡 banner / ScenarioSwitcher / 决策 UI。
 */

import useAletheiaStore from '../../stores/useAletheiaStore'

const STEPS = [
  { step: '01', text: '一句话目标 / 想法 / 问题', desc: '在底部输入框给出, 默认走 6 阶段元认知' },
  { step: '02', text: '上下文 → 任务 → 角色涌现', desc: '画布上看着拆分结构和 Agent 一个个长出来' },
  { step: '03', text: '逻辑对抗 + 反驳引擎', desc: 'Devil\'s Advocate · 共识综合 · 反思循环' },
  { step: '04', text: '派 Hermes / 联调 telegram', desc: '画布产出 → CLI 接口 → 远端 worker' },
]

export default function WelcomeOverlay({ onShowShortcuts }) {
  // Aletheia 激活时自动隐藏 — 避免顶部 banner / ScenarioSwitcher 挡住 ALETHEIA 大字
  const aletheiaActive = useAletheiaStore((s) => s?.aletheiaActive ?? false)
  if (aletheiaActive) return null

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="text-center max-w-md mx-auto px-8 pointer-events-none">
        {/* 建筑网格装饰 */}
        <div className="fixed inset-0 pointer-events-none z-0" style={{ opacity: 0.03 }}>
          <div className="absolute top-1/2 left-0 right-0 h-px" style={{ background: 'var(--text-primary)' }} />
          <div className="absolute top-0 bottom-0 left-1/2 w-px" style={{ background: 'var(--text-primary)' }} />
        </div>

        <div
          className="mb-6"
          style={{
            fontSize: '0.72rem',
            letterSpacing: '0.45em',
            color: 'var(--accent, #c8a882)',
            fontWeight: 500,
          }}
        >
          A · L · E · T · H · E · I · A
        </div>
        <h1
          className="heading-serif font-light mb-4"
          style={{
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-serif), Georgia, serif',
            fontSize: '3rem',
            letterSpacing: '0.04em',
            lineHeight: 1.1,
          }}
        >
          ALETHEIA
        </h1>
        <div
          className="mb-6 text-xs"
          style={{
            color: 'var(--text-muted, #888)',
            letterSpacing: '0.2em',
            fontFamily: 'var(--font-serif), Georgia, serif',
            fontStyle: 'italic',
          }}
        >
          逻辑对抗决策引擎
        </div>
        <p className="text-sm leading-relaxed mb-8" style={{ color: 'var(--text-muted)' }}>
          一句话给出目标, 看 6 阶段元认知在画布上展开,<br />
          上下文 → 拆解 → 角色涌现 → 拓扑 → 执行 → 反思.<br />
          画布是过程, 不是结果.
        </p>

        {/* 操作引导 */}
        <div className="space-y-3 text-left max-w-xs mx-auto">
          {STEPS.map(item => (
            <div
              key={item.step}
              className="flex items-start gap-3 p-3 rounded-md transition-all duration-300"
              style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface)' }}
            >
              <span className="text-xs font-light mt-0.5" style={{ color: 'var(--accent)', fontFamily: 'var(--font-serif)' }}>
                {item.step}
              </span>
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{item.text}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 拖拽提示 */}
        <div className="mt-8 py-6 px-8 rounded-lg border-dashed" style={{ border: '2px dashed var(--border-subtle)', background: 'rgba(250,250,250,0.8)' }}>
          <svg className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-faint)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>拖拽文件到此处开始</p>
        </div>

        {/* 快捷键提示 */}
        <button
          onClick={onShowShortcuts}
          className="mt-6 text-[10px] tracking-wider transition-colors duration-300 pointer-events-auto"
          style={{ color: 'var(--text-faint)' }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-faint)'}
        >
          按 ? 查看快捷键
        </button>
      </div>
    </div>
  )
}
