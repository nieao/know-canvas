// 对抗引擎权重三滑块: 逻辑一致性 / 合规性 / 商业敏锐度
import React from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';

/**
 * 三个 0~1 权重的横向滑块组
 * - 显示值乘以 100 (0~100 区间)
 * - 滑动时调用 setWeights 合并更新
 * - 底部显示当前总倾向 (取最大权重的标签)
 */

const ITEMS = [
  { key: 'logic', label: '逻辑一致性', hint: '内部矛盾、推理漏洞' },
  { key: 'compliance', label: '合规性', hint: '风险点、监管红线' },
  { key: 'business', label: '商业敏锐度', hint: '市场机会、ROI 漏洞' },
];

const TENDENCY_LABEL = {
  logic: '逻辑优先',
  compliance: '合规优先',
  business: '商业优先',
};

export default function WeightSliders() {
  const weights = useAletheiaStore((s) => s.weights) || { logic: 1, compliance: 1, business: 1 };
  const setWeights = useAletheiaStore((s) => s.setWeights);

  // 计算当前总倾向: 三个权重最大那一项
  const dominant = (() => {
    let best = 'logic';
    let bestVal = -Infinity;
    for (const it of ITEMS) {
      const v = Number(weights[it.key] ?? 0);
      if (v > bestVal) {
        bestVal = v;
        best = it.key;
      }
    }
    return best;
  })();

  // 滑块统一回调: 把 0~100 还原成 0~1
  const onChange = (key) => (e) => {
    const next = Math.max(0, Math.min(100, Number(e.target.value)));
    if (setWeights) {
      setWeights({ ...weights, [key]: next / 100 });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 暖色滑块样式 (作用域内) */}
      <style>{`
        .aletheia-range {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 2px;
          background: var(--border-subtle);
          outline: none;
          border-radius: 1px;
          cursor: pointer;
        }
        .aletheia-range::-webkit-slider-runnable-track {
          height: 2px;
          background: var(--border-subtle);
          border-radius: 1px;
        }
        .aletheia-range::-webkit-slider-thumb {
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
        .aletheia-range::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        .aletheia-range::-moz-range-track {
          height: 2px;
          background: var(--border-subtle);
          border-radius: 1px;
        }
        .aletheia-range::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent);
          border: 2px solid var(--surface);
          box-shadow: 0 0 0 1px var(--accent);
          cursor: pointer;
        }
      `}</style>

      {ITEMS.map((it) => {
        const v01 = Number(weights[it.key] ?? 0);
        const v100 = Math.round(v01 * 100);
        return (
          <div key={it.key} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span
                className="text-xs uppercase"
                style={{
                  letterSpacing: '0.15em',
                  color: 'var(--text-muted)',
                  fontFamily: 'Noto Sans SC, system-ui, sans-serif',
                }}
              >
                {it.label}
              </span>
              <span
                className="text-sm tabular-nums"
                style={{
                  color: 'var(--text-primary)',
                  fontFamily: 'Noto Serif SC, Georgia, serif',
                }}
              >
                {v100}
              </span>
            </div>
            <input
              className="aletheia-range"
              type="range"
              min={0}
              max={100}
              step={1}
              value={v100}
              onChange={onChange(it.key)}
            />
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {it.hint}
            </span>
          </div>
        );
      })}

      {/* 当前总倾向 */}
      <div
        className="mt-1 pt-3 text-xs"
        style={{
          borderTop: '1px solid var(--border-subtle)',
          color: 'var(--text-muted)',
          fontFamily: 'Noto Sans SC, system-ui, sans-serif',
          letterSpacing: '0.05em',
        }}
      >
        总倾向:{' '}
        <span style={{ color: 'var(--accent)', fontWeight: 500 }}>
          {TENDENCY_LABEL[dominant] || '逻辑优先'}
        </span>
      </div>
    </div>
  );
}
