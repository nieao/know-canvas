// 循环阈值滑块: Max Rounds (1-10) + Exit Delta (0.5%-10%)
import React from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';

/**
 * 提议方与反驳方的迭代上限设置
 * - Max Rounds: 整数 1~10, 推荐 5
 * - Exit Delta: 0.005~0.1 (展示为 0.5%~10%, step 0.5%), 推荐 1%
 * - 改进量低于 Exit Delta 视为收敛, 提前退出
 */
export default function ThresholdSliders() {
  const maxRounds = useAletheiaStore((s) => s.maxRounds) ?? 5;
  const exitDelta = useAletheiaStore((s) => s.exitDelta) ?? 0.01;
  const setMaxRounds = useAletheiaStore((s) => s.setMaxRounds);
  const setExitDelta = useAletheiaStore((s) => s.setExitDelta);

  // 显示百分比: 0.01 -> 1.0
  const exitPct = Number((exitDelta * 100).toFixed(1));

  return (
    <div className="flex flex-col gap-5">
      <style>{`
        .aletheia-range-2 {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 2px;
          background: var(--border-subtle);
          outline: none;
          border-radius: 1px;
          cursor: pointer;
        }
        .aletheia-range-2::-webkit-slider-runnable-track {
          height: 2px;
          background: var(--border-subtle);
          border-radius: 1px;
        }
        .aletheia-range-2::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          margin-top: -6px;
          border-radius: 50%;
          background: var(--accent);
          border: 2px solid var(--surface);
          box-shadow: 0 0 0 1px var(--accent);
          cursor: pointer;
          transition: transform 0.2s ease;
        }
        .aletheia-range-2::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        .aletheia-range-2::-moz-range-track {
          height: 2px;
          background: var(--border-subtle);
          border-radius: 1px;
        }
        .aletheia-range-2::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent);
          border: 2px solid var(--surface);
          box-shadow: 0 0 0 1px var(--accent);
          cursor: pointer;
        }
      `}</style>

      {/* Max Rounds */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span
            className="text-xs uppercase"
            style={{
              letterSpacing: '0.15em',
              color: 'var(--text-muted)',
              fontFamily: 'Noto Sans SC, system-ui, sans-serif',
            }}
          >
            最大轮数
          </span>
          <span
            className="text-sm tabular-nums"
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'Noto Serif SC, Georgia, serif',
            }}
          >
            {maxRounds} 轮
          </span>
        </div>
        <input
          className="aletheia-range-2"
          type="range"
          min={1}
          max={10}
          step={1}
          value={maxRounds}
          onChange={(e) => setMaxRounds && setMaxRounds(Number(e.target.value))}
        />
        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          推荐 5 轮
        </span>
      </div>

      {/* Exit Delta */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span
            className="text-xs uppercase"
            style={{
              letterSpacing: '0.15em',
              color: 'var(--text-muted)',
              fontFamily: 'Noto Sans SC, system-ui, sans-serif',
            }}
          >
            退出阈值
          </span>
          <span
            className="text-sm tabular-nums"
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'Noto Serif SC, Georgia, serif',
            }}
          >
            {exitPct.toFixed(1)}%
          </span>
        </div>
        <input
          className="aletheia-range-2"
          type="range"
          min={0.5}
          max={10}
          step={0.5}
          value={exitPct}
          onChange={(e) => {
            // 还原为 0~1 区间
            const pct = Number(e.target.value);
            if (setExitDelta) setExitDelta(Math.max(0.005, Math.min(0.1, pct / 100)));
          }}
        />
        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          推荐 1%
        </span>
      </div>

      {/* 解释 */}
      <div
        className="mt-1 pt-3 text-[11px] leading-relaxed"
        style={{
          borderTop: '1px solid var(--border-subtle)',
          color: 'var(--text-faint)',
          fontFamily: 'Noto Sans SC, system-ui, sans-serif',
        }}
      >
        提议方与反驳方的迭代上限。改进量低于阈值视为收敛, 提前退出。
      </div>
    </div>
  );
}
