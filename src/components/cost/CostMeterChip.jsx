// 实时成本芯片 - 右下角折叠/展开入口
// 同一组件树内既渲染 chip 又渲染 CostMeterPanel
import React, { useState } from 'react';
import useCostMeterStore from '../../stores/useCostMeterStore';
import CostMeterPanel from './CostMeterPanel';

/**
 * 右下角实时算钱芯片 + 展开面板
 * - 默认展开 (open=true) — 用户首次能看到完整面板
 * - 点击 chip 切换展开/折叠
 * - 暖色脉冲圆点 + 总价 + 上下箭头
 */
export default function CostMeterChip() {
  const [open, setOpen] = useState(true);

  // 安全读取 cost meter store
  const totalCny = useCostMeterStore
    ? useCostMeterStore((s) => s?.totalCostCny ?? 0)
    : 0;
  const eventCount = useCostMeterStore
    ? useCostMeterStore((s) => s?.events?.length ?? 0)
    : 0;

  return (
    <>
      <CostMeterPanel open={open} onClose={() => setOpen(false)} />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? '折叠成本面板' : '展开成本面板'}
        title={open ? '折叠' : `展开成本面板 · ${eventCount} 条记录`}
        style={{
          position: 'absolute',
          bottom: '12px',
          right: '12px',
          zIndex: 30,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 14px',
          background: 'var(--surface-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '999px',
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-sans)',
          fontSize: '0.76rem',
          letterSpacing: '0.05em',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
          transition: 'all 0.5s var(--ease-out)',
          fontVariantNumeric: 'tabular-nums',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.borderColor = 'var(--accent)';
          e.currentTarget.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.08)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.borderColor = 'var(--border-subtle)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.05)';
        }}
      >
        {/* 暖色脉冲圆点 */}
        <span
          style={{
            position: 'relative',
            width: '8px',
            height: '8px',
            display: 'inline-flex',
          }}
        >
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: 'var(--accent)',
              opacity: 0.45,
              animation: 'cost-meter-pulse 1.6s var(--ease-out) infinite',
            }}
          />
          <span
            style={{
              position: 'relative',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--accent)',
            }}
          />
        </span>

        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          ¥{Number(totalCny).toFixed(4)}
        </span>

        <span style={{ color: 'var(--text-faint)' }}>·</span>

        {/* 上下箭头：折叠时显示 ↑（提示可展开），展开时显示 ↓ */}
        <span
          style={{
            color: 'var(--accent)',
            fontSize: '0.85rem',
            transition: 'transform 0.5s var(--ease-out)',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
          }}
        >
          ↑
        </span>

        {/* 关键帧注入 (一次性, 重复挂载只是覆盖同名规则, 无副作用) */}
        <style>{`
          @keyframes cost-meter-pulse {
            0%   { transform: scale(1);   opacity: 0.55; }
            70%  { transform: scale(2.2); opacity: 0;    }
            100% { transform: scale(2.2); opacity: 0;    }
          }
        `}</style>
      </button>
    </>
  );
}
