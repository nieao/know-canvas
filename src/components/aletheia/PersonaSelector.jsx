// 反驳人格三选一卡片选择器（Aletheia 高级面板用）
import React from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';
import { PERSONAS } from '../../services/aletheia/personas';

/**
 * 反驳人格选择器
 * - 三选一卡片纵向排列
 * - 点击切换 useAletheiaStore.persona
 * - 选中: 暖色 2px 边框 + 顶部暖色细线
 * - 未选中: 灰色 1px 边框, hover 变暖色
 */
export default function PersonaSelector() {
  // 当前选中人格 id
  const persona = useAletheiaStore((s) => s.persona);
  const setPersona = useAletheiaStore((s) => s.setPersona);

  // 兜底: 服务模块如果还没就绪, 给一份默认人格列表保证 UI 可见
  const personas = Array.isArray(PERSONAS) && PERSONAS.length > 0
    ? PERSONAS
    : [
        { id: 'reddit', label: 'Reddit 杠精', description: '尖锐直接, 专挑漏洞', icon: '⚡' },
        { id: 'audit', label: '风险审计师', description: '合规视角, 严守底线', icon: '⊟' },
        { id: 'socratic', label: '苏格拉底', description: '层层追问, 逼近本质', icon: '○' },
      ];

  return (
    <div className="flex flex-col gap-3">
      {personas.map((p) => {
        const selected = persona === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setPersona && setPersona(p.id)}
            className={[
              'group relative w-full text-left',
              'px-5 py-4 transition-all duration-300',
            ].join(' ')}
            style={{
              cursor: 'pointer',
              background: 'var(--surface)',
              border: selected ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
            }}
            onMouseEnter={(e) => {
              if (!selected) e.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              if (!selected) e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            {/* 选中态: 顶部暖色细线 */}
            {selected && (
              <span
                className="absolute left-0 top-0 h-[2px] w-full"
                style={{ background: 'var(--accent)' }}
              />
            )}
            <div className="flex items-start gap-4">
              {/* 图标 (字符或符号, 不用 emoji) */}
              <span
                className="mt-1 flex h-8 w-8 flex-none items-center justify-center text-lg"
                style={{
                  fontFamily: 'Noto Serif SC, Georgia, serif',
                  color: selected ? 'var(--accent)' : 'var(--text-faint)',
                }}
              >
                {p.icon || '·'}
              </span>
              <div className="flex-1 min-w-0">
                <div
                  className="text-base font-medium"
                  style={{
                    fontFamily: 'Noto Serif SC, Georgia, serif',
                    color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    letterSpacing: '0.02em',
                  }}
                >
                  {p.label}
                </div>
                <div
                  className="mt-1 text-xs leading-relaxed"
                  style={{
                    color: 'var(--text-faint)',
                    fontFamily: 'Noto Sans SC, system-ui, sans-serif',
                  }}
                >
                  {p.description}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
