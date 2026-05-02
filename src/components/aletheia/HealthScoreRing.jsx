// 健康分圆环 - 显示对抗收敛后的综合健康分（0-100），含数字爬升动画
import React, { useEffect, useRef, useState } from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';

// 缓动函数 easeOutCubic（用于数字爬升）
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// 根据分数挑选填充色：0-50 灰，50-80 暖色，80-100 深暖
function pickStrokeColor(score) {
  if (score < 50) return '#888';
  if (score < 80) return '#c8a882';
  return '#b08d5f';
}

/**
 * 健康分圆环
 * - 从 useAletheiaStore 读取 healthScore（fallback 0）
 * - 数字爬升动画 800ms，easeOutCubic
 * - 圆环 SVG ≥ 160px，背景细线 + 前景按分数色
 */
export default function HealthScoreRing() {
  // 安全读取 store；store 还没就绪时 fallback 0
  const healthScore = useAletheiaStore
    ? useAletheiaStore((s) => (typeof s?.healthScore === 'number' ? s.healthScore : 0))
    : 0;

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

  // 圆环几何参数
  const size = 180; // 总尺寸（≥160）
  const stroke = 6; // 线条宽度
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  const clamped = Math.max(0, Math.min(100, displayScore));
  const dashOffset = circumference * (1 - clamped / 100);
  const strokeColor = pickStrokeColor(clamped);

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px',
      }}
    >
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ display: 'block' }}
        >
          {/* 背景圆环 - 1px 细线 */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="#e8e8e8"
            strokeWidth={1}
          />
          {/* 前景填充圆环 - 旋转到 12 点方向起始 */}
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
            style={{
              transition: 'stroke 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
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
              color: '#1a1a1a',
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}
          >
            {Math.round(clamped)}
          </div>
          <div
            style={{
              marginTop: '10px',
              fontFamily: '"Noto Sans SC", system-ui, sans-serif',
              fontSize: '0.68rem',
              letterSpacing: '0.35em',
              color: '#888',
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
