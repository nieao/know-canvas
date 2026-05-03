// 综合方案弹窗 - 居中展示融合输出 (ACTION PLAN + Health Score 角标 + 简易 markdown 渲染)
import React, { useEffect, useState } from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';

// 极简 markdown 渲染器: 仅处理 ## 标题、空行换行、行内 code
// 返回 React 元素数组,不引入第三方依赖
function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split('\n');
  const blocks = [];
  let buffer = [];
  let key = 0;

  // 把 buffer 内累积的普通文本行作为段落 flush
  const flushParagraph = () => {
    if (buffer.length === 0) return;
    const content = buffer.join('\n');
    blocks.push(
      <p
        key={`p-${key++}`}
        style={{
          margin: '0 0 12px',
          fontSize: '14px',
          lineHeight: 1.75,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {content}
      </p>
    );
    buffer = [];
  };

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      flushParagraph();
      const heading = line.replace(/^##\s+/, '');
      blocks.push(
        <h2
          key={`h-${key++}`}
          style={{
            fontFamily: '"Noto Serif SC", Georgia, serif',
            fontSize: '18px',
            color: 'var(--text-primary)',
            margin: '24px 0 10px',
            paddingBottom: '6px',
            borderBottom: '1px solid #e8e8e8',
            letterSpacing: '0.02em',
          }}
        >
          {heading}
        </h2>
      );
    } else if (/^#\s+/.test(line)) {
      flushParagraph();
      const heading = line.replace(/^#\s+/, '');
      blocks.push(
        <h1
          key={`h1-${key++}`}
          style={{
            fontFamily: '"Noto Serif SC", Georgia, serif',
            fontSize: '22px',
            color: 'var(--text-primary)',
            margin: '24px 0 12px',
            letterSpacing: '0.02em',
          }}
        >
          {heading}
        </h1>
      );
    } else if (line.trim() === '') {
      flushParagraph();
    } else {
      buffer.push(line);
    }
  }
  flushParagraph();
  return blocks;
}

/**
 * 综合方案弹窗
 * - props.open 控制显示, 也兼容 store.lastSynthesis 自动驱动
 * - 居中卡片 + 半透明黑遮罩
 * - 入场动画: scale 0.96 → 1, opacity 0 → 1 (300ms)
 */
export default function ActionPlanModal({ open, onClose }) {
  const lastSynthesis = useAletheiaStore
    ? useAletheiaStore((s) => s?.lastSynthesis || null)
    : null;
  const healthScore = useAletheiaStore
    ? useAletheiaStore((s) => (typeof s?.healthScore === 'number' ? s.healthScore : null))
    : null;

  // 真正的可见性: 显式 open 优先, 否则看是否有 lastSynthesis
  const isVisible = open !== undefined ? !!open : !!lastSynthesis;

  // 入场动画状态
  const [entered, setEntered] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isVisible) {
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    } else {
      setEntered(false);
      setCopied(false);
    }
  }, [isVisible]);

  // ESC 关闭
  useEffect(() => {
    if (!isVisible) return;
    const handler = (e) => {
      if (e.key === 'Escape' && typeof onClose === 'function') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  const actionPlan = lastSynthesis?.actionPlan || '';
  const summary = lastSynthesis?.summary || '';
  const score =
    typeof lastSynthesis?.healthScore === 'number'
      ? lastSynthesis.healthScore
      : healthScore;

  // 复制方案到剪贴板
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(actionPlan);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error('[ActionPlanModal] 复制失败:', err);
    }
  };

  return (
    <div
      onClick={(e) => {
        // 点遮罩关闭
        if (e.target === e.currentTarget && typeof onClose === 'function') onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,26,26,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        opacity: entered ? 1 : 0,
        transition: 'opacity 300ms cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '768px',
          maxHeight: '85vh',
          background: 'var(--surface)',
          border: '1px solid #e8e8e8',
          borderRadius: '4px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          transform: entered ? 'scale(1)' : 'scale(0.96)',
          opacity: entered ? 1 : 0,
          transition:
            'transform 300ms cubic-bezier(0.22,1,0.36,1), opacity 300ms cubic-bezier(0.22,1,0.36,1)',
          fontFamily: '"Noto Sans SC", system-ui, sans-serif',
          overflow: 'hidden',
        }}
      >
        {/* 顶部细线装饰 */}
        <div style={{ height: '2px', background: 'var(--accent)' }} />

        {/* 头部 */}
        <div
          style={{
            padding: '24px 32px 18px',
            borderBottom: '1px solid #e8e8e8',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '10px',
                letterSpacing: '0.35em',
                color: 'var(--accent)',
                marginBottom: '6px',
              }}
            >
              SYNTHESIS
            </div>
            <h1
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", Georgia, serif',
                fontSize: '28px',
                color: 'var(--text-primary)',
                letterSpacing: '0.04em',
              }}
            >
              ACTION PLAN
            </h1>
            {summary && (
              <div
                style={{
                  marginTop: '10px',
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  lineHeight: 1.6,
                  fontStyle: 'italic',
                }}
              >
                {summary}
              </div>
            )}
          </div>

          {/* Health Score 角标 */}
          {typeof score === 'number' && (
            <div
              style={{
                flexShrink: 0,
                padding: '10px 14px',
                border: '1px solid #c8a882',
                borderRadius: '2px',
                textAlign: 'center',
                background: 'rgba(200,168,130,0.08)',
              }}
            >
              <div
                style={{
                  fontSize: '9px',
                  letterSpacing: '0.3em',
                  color: 'var(--text-faint)',
                  marginBottom: '2px',
                }}
              >
                HEALTH
              </div>
              <div
                style={{
                  fontFamily: '"Noto Serif SC", Georgia, serif',
                  fontSize: '28px',
                  color: 'var(--text-primary)',
                  lineHeight: 1,
                }}
              >
                {Math.round(score)}
              </div>
            </div>
          )}
        </div>

        {/* 内容区 - 滚动 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 32px',
          }}
        >
          {actionPlan ? (
            <div>{renderMarkdown(actionPlan)}</div>
          ) : (
            <div
              style={{
                fontSize: '13px',
                color: 'var(--text-faint)',
                textAlign: 'center',
                padding: '40px 0',
                fontStyle: 'italic',
              }}
            >
              暂无综合方案内容
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div
          style={{
            padding: '16px 32px',
            borderTop: '1px solid #e8e8e8',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
          }}
        >
          <button
            onClick={onCopy}
            disabled={!actionPlan}
            style={{
              padding: '10px 24px',
              fontSize: '11px',
              letterSpacing: '0.25em',
              color: actionPlan ? 'var(--text-primary)' : 'var(--text-faint)',
              background: 'transparent',
              border: `1px solid ${actionPlan ? 'var(--accent)' : 'var(--border-subtle)'}`,
              borderRadius: '2px',
              cursor: actionPlan ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s cubic-bezier(0.22,1,0.36,1)',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!actionPlan) return;
              e.currentTarget.style.background = 'rgba(200,168,130,0.10)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {copied ? '已复制' : '复制'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '10px 24px',
              fontSize: '11px',
              letterSpacing: '0.25em',
              color: 'var(--surface)',
              background: 'var(--text-primary)',
              border: '1px solid #1a1a1a',
              borderRadius: '2px',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.22,1,0.36,1)',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--text-secondary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--text-primary)';
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
