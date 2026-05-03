// 逻辑对抗参数中心 抽屉式高级面板 (Aletheia Agent C)
import React, { useEffect } from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';
import { SCENARIOS } from '../../services/aletheia/scenarios';
import PersonaSelector from './PersonaSelector';
import WeightSliders from './WeightSliders';
import ThresholdSliders from './ThresholdSliders';

/**
 * AdvancedPanel
 * - 右侧滑入式抽屉, 宽 420px
 * - 三大 section: 对抗权重 / 反驳人格 / 循环阈值
 * - 顶部隐藏 section: 当前场景 (展示 store.scenario)
 * @param {{ open: boolean, onClose: () => void }} props
 */
export default function AdvancedPanel({ open, onClose }) {
  // 场景显示用 (隐藏 section)
  const scenario = useAletheiaStore((s) => s.scenario) || 'tob';

  // 兜底场景描述
  const scenarioMeta = (() => {
    const list = Array.isArray(SCENARIOS) && SCENARIOS.length > 0 ? SCENARIOS : [
      { id: 'tob', label: 'ToB · 企业服务', description: '面向企业客户的方案推演' },
      { id: 'toc', label: 'ToC · 消费者', description: '面向终端用户的体验拷打' },
      { id: 'tog', label: 'ToG · 政企/政府', description: '面向公共部门的合规审视' },
    ];
    return list.find((x) => x.id === scenario) || list[0];
  })();

  // 按下 Esc 关闭
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* 半透明遮罩 */}
      <div
        onClick={onClose}
        aria-hidden={!open}
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{
          background: 'rgba(26, 26, 26, 0.32)',
          backdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
      />

      {/* 抽屉本体 */}
      <aside
        role="dialog"
        aria-label="逻辑对抗参数中心"
        aria-hidden={!open}
        className="fixed right-0 top-0 z-50 h-full overflow-y-auto"
        style={{
          width: '420px',
          maxWidth: '100vw',
          background: 'var(--surface)',
          borderLeft: '1px solid #e8e8e8',
          boxShadow: open ? '-12px 0 40px rgba(26,26,26,0.08)' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 400ms cubic-bezier(0.22, 1, 0.36, 1)',
          fontFamily: 'Noto Sans SC, system-ui, sans-serif',
        }}
      >
        {/* 顶部装饰暖色细线 */}
        <div className="h-[2px] w-full" style={{ background: 'var(--accent)' }} />

        {/* 标题区 */}
        <header
          className="flex items-start justify-between px-8 pt-8 pb-6"
          style={{ borderBottom: '1px solid #e8e8e8' }}
        >
          <div className="min-w-0">
            <div
              className="mb-2 text-[11px] uppercase"
              style={{
                color: 'var(--accent)',
                letterSpacing: '0.35em',
                fontFamily: 'Noto Sans SC, system-ui, sans-serif',
              }}
            >
              ALETHEIA / ADVANCED
            </div>
            <h2
              className="m-0"
              style={{
                fontFamily: 'Noto Serif SC, Georgia, serif',
                fontSize: '28px',
                lineHeight: 1.2,
                color: 'var(--text-primary)',
                letterSpacing: '0.02em',
              }}
            >
              逻辑对抗参数中心
            </h2>
          </div>
          {/* 关闭按钮 (X) */}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="ml-4 flex h-9 w-9 flex-none items-center justify-center transition-all duration-300"
            style={{
              border: '1px solid #e8e8e8',
              background: 'var(--surface)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            ×
          </button>
        </header>

        {/* 隐藏 section: 当前场景 */}
        <section
          className="px-8 py-5"
          style={{
            background: 'var(--accent-bg)',
            borderBottom: '1px solid #e8e8e8',
          }}
        >
          <div
            className="mb-1 text-[10px] uppercase"
            style={{
              color: 'var(--accent)',
              letterSpacing: '0.35em',
            }}
          >
            当前场景
          </div>
          <div className="flex items-baseline gap-3">
            <span
              style={{
                fontFamily: 'Noto Serif SC, Georgia, serif',
                fontSize: '15px',
                color: 'var(--text-primary)',
                letterSpacing: '0.02em',
              }}
            >
              {scenarioMeta?.label || scenario.toUpperCase()}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {scenarioMeta?.description || ''}
            </span>
          </div>
        </section>

        {/* Section 1: 对抗引擎权重 */}
        <Section index="01" title="对抗引擎权重">
          <WeightSliders />
        </Section>

        {/* Section 2: 反驳人格 */}
        <Section index="02" title="反驳人格">
          <PersonaSelector />
        </Section>

        {/* Section 3: 循环阈值 */}
        <Section index="03" title="循环阈值" last>
          <ThresholdSliders />
        </Section>

        {/* 底部小字 */}
        <div
          className="px-8 py-6 text-[11px]"
          style={{
            color: 'var(--text-faint)',
            letterSpacing: '0.05em',
            borderTop: '1px solid #e8e8e8',
          }}
        >
          ESC 关闭 · 设置自动保存
        </div>
      </aside>
    </>
  );
}

/**
 * 内部 section 组件 (1px 细线分隔)
 */
function Section({ index, title, last = false, children }) {
  return (
    <section
      className="px-8 py-7"
      style={last ? undefined : { borderBottom: '1px solid #e8e8e8' }}
    >
      <header className="mb-5">
        <div
          className="mb-1 text-[10px] uppercase"
          style={{
            color: 'var(--accent)',
            letterSpacing: '0.35em',
          }}
        >
          {index} / SECTION
        </div>
        <h3
          className="m-0"
          style={{
            fontFamily: 'Noto Serif SC, Georgia, serif',
            fontSize: '18px',
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
            fontWeight: 500,
          }}
        >
          {title}
        </h3>
      </header>
      <div>{children}</div>
    </section>
  );
}
