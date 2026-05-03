// 场景切换器 - 顶部水平 tab，三选项 ToB/ToC/ToG，并显示当前场景描述
import React from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';

// 场景列表（顺序固定：ToB / ToC / ToG）
const SCENARIO_TABS = [
  { id: 'tob', label: 'ToB' },
  { id: 'toc', label: 'ToC' },
  { id: 'tog', label: 'ToG' },
];

// 默认描述（仅作 fallback：scenarios.js 还没 ready 时用）
const FALLBACK_DESCRIPTION = {
  tob: '面向企业 - 关注功能稳健与成本控制',
  toc: '面向消费者 - 关注功能体验与变现能力',
  tog: '面向政府 - 关注效率合规与公信力',
};

/**
 * 场景切换器
 * - 当前激活：暖色背景 + 白字
 * - 非激活：透明背景 + 灰字 + 1px 边框
 * - 点击调用 useAletheiaStore.setScenario
 * - 下方一行小字读 scenarios[current].description
 */
export default function ScenarioSwitcher() {
  // 当前场景（fallback tob）
  const scenario = useAletheiaStore
    ? useAletheiaStore((s) => s?.scenario || 'tob')
    : 'tob';

  // 场景配置（用于读 description）
  const scenariosMap = useAletheiaStore
    ? useAletheiaStore((s) => s?.scenarios)
    : null;

  // 读取当前场景的描述：优先 store.scenarios，否则用 fallback
  const description =
    (scenariosMap && scenariosMap[scenario] && scenariosMap[scenario].description) ||
    FALLBACK_DESCRIPTION[scenario] ||
    '';

  // 切换场景 - 用 getState 写入，避免依赖 hook
  const handleSwitch = (id) => {
    if (id === scenario) return;
    try {
      const setScenario = useAletheiaStore?.getState?.()?.setScenario;
      if (typeof setScenario === 'function') setScenario(id);
    } catch (err) {
      // store 还没 ready 时静默忽略，避免崩 UI
      console.warn('[ScenarioSwitcher] setScenario 不可用：', err?.message);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
        padding: '14px 24px',
        background: 'var(--surface)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid #e8e8e8',
        userSelect: 'none',
      }}
    >
      {/* tab 行 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {SCENARIO_TABS.map((tab) => {
          const active = tab.id === scenario;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSwitch(tab.id)}
              style={{
                minWidth: '92px',
                padding: '8px 22px',
                fontFamily: '"Noto Sans SC", system-ui, sans-serif',
                fontSize: '0.78rem',
                letterSpacing: '0.2em',
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? 'var(--surface)' : 'var(--text-faint)',
                border: active ? '1px solid #c8a882' : '1px solid #e8e8e8',
                borderRadius: '2px',
                cursor: 'pointer',
                transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.color = 'var(--accent)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.color = 'var(--text-faint)';
                }
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 场景描述 */}
      <div
        style={{
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
          fontSize: '0.72rem',
          color: 'var(--text-faint)',
          letterSpacing: '0.05em',
          textAlign: 'center',
          minHeight: '1em',
          transition: 'color 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {description}
      </div>
    </div>
  );
}
