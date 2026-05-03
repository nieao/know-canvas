// 健康分圆环 - 显示对抗收敛后的综合健康分（0-100），含数字爬升动画
// 默认折叠成右上角小 chip（避免遮挡画布），点击 chip 才展开完整圆环
import React, { useEffect, useRef, useState } from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';

// 缓动函数 easeOutCubic（用于数字爬升）
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// 根据分数挑选填充色：0-50 灰，50-80 暖色，80-100 深暖
function pickStrokeColor(score) {
  if (score < 50) return 'var(--text-faint)';
  if (score < 80) return 'var(--accent)';
  return 'var(--accent)';
}

/**
 * 健康分圆环
 * - 从 useAletheiaStore 读取 healthScore（fallback 0）
 * - 数字爬升动画 800ms，easeOutCubic
 * - 默认折叠为 chip（数字 + ▾），点击展开为 180px 圆环
 */
export default function HealthScoreRing() {
  // 安全读取 store；store 还没就绪时 fallback 0
  const healthScore = useAletheiaStore
    ? useAletheiaStore((s) => (typeof s?.healthScore === 'number' ? s.healthScore : 0))
    : 0;

  // 折叠状态 — 默认折叠（避免大圆环遮挡画布右侧节点）
  const [expanded, setExpanded] = useState(false);

  // 数字爬升动画 - 显示中的分数
  const [displayScore, setDisplayScore] = useState(healthScore || 0);
  const fromRef = useRef(healthScore || 0);
  const rafRef = useRef(null);

  useEffect(() => {
    // 取消上一次动画
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const from = fromRef.current;
    const to = Math.max(0, Math.min(100, healthScore || 0));
    const duration = 800;
    const start = performance.now();

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(t);
      const current = from + (to - from) * eased;
      setDisplayScore(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        rafRef.current = null;
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [healthScore]);

  // 圆环几何参数（展开态）
  const size = 180;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  const clamped = Math.max(0, Math.min(100, displayScore));
  const dashOffset = circumference * (1 - clamped / 100);
  const strokeColor = pickStrokeColor(clamped);
  const rounded = Math.round(clamped);

  // === 折叠态: 小 chip ===
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        title={`健康度 ${rounded} · 点击展开圆环`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 12px 5px 8px',
          background: 'var(--surface)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 999,
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
          fontSize: 11,
          letterSpacing: '0.1em',
          color: 'var(--text-faint)',
          cursor: 'pointer',
          userSelect: 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        {/* 迷你圆环 28x28 */}
        <svg width={28} height={28} viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
          <circle cx={14} cy={14} r={12} fill="none" stroke="var(--border-subtle)" strokeWidth={1} />
          <circle
            cx={14} cy={14} r={12}
            fill="none"
            stroke={strokeColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 12}
            strokeDashoffset={2 * Math.PI * 12 * (1 - clamped / 100)}
            transform="rotate(-90 14 14)"
            style={{ transition: 'stroke 0.4s cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        </svg>
        <span style={{ fontFamily: '"Noto Serif SC", Georgia, serif', fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>
          {rounded}
        </span>
        <span style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--text-faint)' }}>
          HEALTH ▾
        </span>
      </button>
    );
  }

  // === 展开态: 完整圆环 ===
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px',
        position: 'relative',
        background: 'var(--surface)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
      }}
    >
      {/* 收起按钮 (右上角小 ×) */}
      <button
        type="button"
        onClick={() => setExpanded(false)}
        title="收起健康度"
        style={{
          position: 'absolute',
          top: 6,
          right: 8,
          width: 18,
          height: 18,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-faint)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ×
      </button>

      <div style={{ position: 'relative', width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ display: 'block' }}
        >
          {/* 背景圆环 */}
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--border-subtle)" strokeWidth={1} />
          {/* 前景填充圆环 */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: 'stroke 0.5s cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        </svg>

        {/* 中央数字 + 标签 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontFamily: '"Noto Serif SC", Georgia, serif',
              fontSize: '64px',
              lineHeight: 1,
              color: 'var(--text-primary)',
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}
          >
            {rounded}
          </div>
          <div
            style={{
              marginTop: '10px',
              fontFamily: '"Noto Sans SC", system-ui, sans-serif',
              fontSize: '0.68rem',
              letterSpacing: '0.35em',
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
            }}
          >
            HEALTH SCORE
          </div>
        </div>
      </div>
    </div>
  );
}
