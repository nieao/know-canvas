// 平衡点反馈按钮 - 让用户告诉系统"贵了"还是"值这个价"
// 反馈写入 useAletheiaStore.pushCostFeedback，驱动 costWeight 滑动
import React, { useState, useRef, useEffect } from 'react';
import useAletheiaStore from '../../stores/useAletheiaStore';

/**
 * 一对反馈按钮 + 短暂 toast
 * @param {object} props
 * @param {string|null} props.taskId - 当前最近一个任务 id；为 null 时按钮 disabled
 * @param {number} props.costAtTime - 反馈时的累计花费(CNY)，用于平衡点算法记录
 */
export default function CostFeedbackButtons({ taskId, costAtTime = 0 }) {
  const [toast, setToast] = useState(null); // { text } | null
  const toastTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const disabled = !taskId;

  const handleClick = (type) => {
    if (disabled) return;
    let newWeight = null;
    try {
      const store = useAletheiaStore?.getState?.();
      if (store && typeof store.pushCostFeedback === 'function') {
        store.pushCostFeedback({ taskId, type, costAtTime });
        // 反馈后再次 getState 取最新 costWeight (immer 已写入)
        const after = useAletheiaStore.getState();
        if (typeof after?.costWeight === 'number') {
          newWeight = after.costWeight;
        }
      }
    } catch (err) {
      // store 还没就绪：静默降级，不影响 UI
      // eslint-disable-next-line no-console
      console.warn('[CostFeedbackButtons] pushCostFeedback 失败:', err);
    }

    const weightText =
      typeof newWeight === 'number'
        ? `costWeight → ${newWeight.toFixed(3)}`
        : '已记录';
    setToast({ text: `已记录到平衡点 · ${weightText}` });

    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 1600);
  };

  // 按钮基础样式
  const baseBtn = {
    flex: 1,
    padding: '10px 12px',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.74rem',
    letterSpacing: '0.08em',
    background: 'transparent',
    color: disabled ? 'var(--text-faint)' : 'var(--text-secondary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: '2px',
    transition: 'all 0.5s var(--ease-out)',
    opacity: disabled ? 0.5 : 1,
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleClick('expensive')}
          style={{
            ...baseBtn,
            border: '1px solid var(--severity-medium)',
          }}
          onMouseEnter={(e) => {
            if (disabled) return;
            e.currentTarget.style.background = 'var(--accent-bg)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            if (disabled) return;
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <span style={{ marginRight: '6px' }}>💰</span>贵了
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => handleClick('worth_it')}
          style={{
            ...baseBtn,
            border: '1px solid var(--status-success)',
          }}
          onMouseEnter={(e) => {
            if (disabled) return;
            e.currentTarget.style.background = 'rgba(90, 138, 90, 0.08)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            if (disabled) return;
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <span style={{ marginRight: '6px' }}>💎</span>值这个价
        </button>
      </div>

      {/* toast 浮层 */}
      {toast && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '-30px',
            transform: 'translateX(-50%)',
            padding: '6px 12px',
            fontSize: '0.7rem',
            letterSpacing: '0.05em',
            color: 'var(--surface)',
            background: 'var(--text-primary)',
            borderRadius: '2px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            opacity: 0.92,
            fontFamily: 'var(--font-sans)',
            transition: 'all 0.5s var(--ease-out)',
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
