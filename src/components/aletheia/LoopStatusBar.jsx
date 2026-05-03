// 循环状态栏 - 底部细长进度条，显示 Round x/N + Δ% + 收敛状态 + 齿轮按钮
import React from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';

/**
 * 计算最近一次的 delta 值（占位实现：从 store 取，store 未提供则 0）
 * 真实算法在 Agent A 的 healthScore.js / synthesis.js 中
 */
function readLastDelta(s) {
  if (!s) return 0;
  if (typeof s.lastDelta === 'number') return s.lastDelta;
  // 尝试从 debateStream 推断（最后一条 severity）
  return 0;
}

/**
 * 循环状态栏
 * - 显示 Round x/N · Δ=y%
 * - 进度条按 currentRound / maxRounds 推进
 * - Δ 大于 exitDelta 显示"继续"（灰），小于显示"收敛"（暖色）
 * - 右侧齿轮按钮 onClick 触发 props.onOpenAdvanced
 */
export default function LoopStatusBar({ onOpenAdvanced }) {
  // 安全读取 store；未就绪时全部 fallback
  const currentRound = useAletheiaStore
    ? useAletheiaStore((s) => s?.currentRound ?? 0)
    : 0;
  const maxRounds = useAletheiaStore
    ? useAletheiaStore((s) => s?.maxRounds ?? 5)
    : 5;
  const exitDelta = useAletheiaStore
    ? useAletheiaStore((s) => s?.exitDelta ?? 0.01)
    : 0.01;
  const lastDelta = useAletheiaStore
    ? useAletheiaStore((s) => readLastDelta(s))
    : 0;
  const isRunning = useAletheiaStore
    ? useAletheiaStore((s) => !!s?.isRunning)
    : false;

  // 进度百分比（0-100）
  const progressPct = Math.max(
    0,
    Math.min(100, (currentRound / Math.max(1, maxRounds)) * 100)
  );

  // 是否已收敛：当前 delta < exitDelta 且 round > 0
  const isConverged = currentRound > 0 && lastDelta > 0 && lastDelta < exitDelta;
  const statusText = isConverged ? '收敛' : '继续';
  const statusColor = isConverged ? 'var(--accent)' : 'var(--text-faint)';

  // 显示百分比的 delta（exitDelta 是 0-1 小数，乘 100 显示）
  const deltaPct = (lastDelta * 100).toFixed(2);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '10px 24px',
        background: 'var(--surface)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--border-subtle)',
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        fontSize: '0.78rem',
        color: 'var(--text-muted)',
        userSelect: 'none',
      }}
    >
      {/* 左侧：轮次 + 状态 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexShrink: 0,
          minWidth: '180px',
        }}
      >
        {/* 状态圆点 */}
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isRunning ? 'var(--accent)' : 'var(--text-faint)',
            transition: 'background 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
        <span style={{ letterSpacing: '0.1em' }}>
          Round{' '}
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {currentRound}/{maxRounds}
          </span>
        </span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span style={{ letterSpacing: '0.1em' }}>
          Δ={' '}
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{deltaPct}%</span>
        </span>
      </div>

      {/* 中间：进度条 */}
      <div
        style={{
          flex: 1,
          height: '2px',
          background: 'var(--border-subtle)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressPct}%`,
            background: 'var(--accent)',
            transition: 'width 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </div>

      {/* 右侧：状态文字 + 齿轮按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: statusColor,
            letterSpacing: '0.2em',
            fontSize: '0.72rem',
            transition: 'color 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {statusText}
        </span>

        {/* 齿轮按钮 - 不写交互逻辑，只触发 props 回调 */}
        <button
          type="button"
          onClick={() => {
            if (typeof onOpenAdvanced === 'function') onOpenAdvanced();
          }}
          aria-label="高级设置"
          title="高级设置"
          style={{
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
            padding: 0,
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
          {/* 齿轮 SVG */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
