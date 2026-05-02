// SynthesisNode - 紫色融合节点 (React Flow node), 展示对抗收敛后的 Action Plan + Health Score
import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';

// 紫色主色调 (融合 PROPOSER 蓝 + REFUTER 红)
const PURPLE = '#a07cb8';
const PURPLE_DEEP = '#7e5b96';
const WARM = '#c8a882';

function SynthesisNodeImpl({ id, data, selected }) {
  const summary = data?.summary || '';
  const healthScore =
    typeof data?.healthScore === 'number' ? Math.round(data.healthScore) : null;
  const sourceProposers = Array.isArray(data?.sourceProposerIds)
    ? data.sourceProposerIds.length
    : 0;
  const sourceRefuters = Array.isArray(data?.sourceRefuterIds)
    ? data.sourceRefuterIds.length
    : 0;

  // 触发外层弹窗 - 用 CustomEvent 解耦, AletheiaLayer / 父级组件监听该事件
  const onShowActionPlan = (e) => {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('aletheia:show-action-plan', {
        detail: { nodeId: id, data },
      })
    );
  };

  // 根据 healthScore 决定数字颜色 (高分暖白, 低分暖灰)
  const scoreColor =
    healthScore === null
      ? '#fafafa'
      : healthScore >= 80
      ? '#fffaf2'
      : healthScore >= 50
      ? '#f5e8d4'
      : '#e0c8a8';

  return (
    <div
      className="aletheia-synthesis-node"
      style={{
        width: 260,
        background: `linear-gradient(160deg, ${PURPLE} 0%, ${PURPLE_DEEP} 100%)`,
        color: '#fafafa',
        borderRadius: 4,
        border: selected ? `2px solid ${WARM}` : '1px solid rgba(160,124,184,0.6)',
        boxShadow: selected
          ? `0 0 0 4px rgba(200,168,130,0.18), 0 8px 24px rgba(126,91,150,0.32)`
          : '0 4px 14px rgba(126,91,150,0.22)',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        transition: 'all 0.4s cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      {/* 顶部暖色细线 */}
      <div
        style={{
          height: '2px',
          background: WARM,
          width: '100%',
        }}
      />

      {/* 四向 Handle */}
      <Handle type="target" position={Position.Top} style={{ background: WARM }} />
      <Handle type="target" position={Position.Left} style={{ background: WARM }} />
      <Handle type="source" position={Position.Right} style={{ background: WARM }} />
      <Handle type="source" position={Position.Bottom} style={{ background: WARM }} />

      <div style={{ padding: '16px 18px 14px' }}>
        {/* 顶部标签 + 来源数 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '10px',
          }}
        >
          <span
            style={{
              fontSize: '9px',
              letterSpacing: '0.35em',
              fontWeight: 600,
              color: WARM,
            }}
          >
            SYNTHESIS
          </span>
          <span style={{ fontSize: '9px', color: 'rgba(250,250,250,0.55)', letterSpacing: '0.1em' }}>
            {sourceProposers}P · {sourceRefuters}R
          </span>
        </div>

        {/* 中央 healthScore 大数字 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px 0 10px',
          }}
        >
          {healthScore !== null ? (
            <>
              <div
                style={{
                  fontFamily: '"Noto Serif SC", Georgia, serif',
                  fontSize: '64px',
                  lineHeight: 1,
                  color: scoreColor,
                  fontWeight: 500,
                  letterSpacing: '0.02em',
                  textShadow: '0 2px 8px rgba(0,0,0,0.18)',
                }}
              >
                {healthScore}
              </div>
              <div
                style={{
                  marginTop: '6px',
                  fontSize: '8px',
                  letterSpacing: '0.3em',
                  color: 'rgba(250,250,250,0.6)',
                }}
              >
                HEALTH SCORE
              </div>
            </>
          ) : (
            <div
              style={{
                fontFamily: '"Noto Serif SC", Georgia, serif',
                fontSize: '36px',
                color: 'rgba(250,250,250,0.4)',
                fontStyle: 'italic',
                padding: '12px 0',
              }}
            >
              ...
            </div>
          )}
        </div>

        {/* summary - 2 行截断 */}
        {summary ? (
          <div
            style={{
              fontSize: '11.5px',
              lineHeight: 1.55,
              color: 'rgba(250,250,250,0.85)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: '12px',
              minHeight: '36px',
              textAlign: 'center',
              fontStyle: 'italic',
              paddingLeft: '8px',
              paddingRight: '8px',
            }}
            title={summary}
          >
            {summary}
          </div>
        ) : (
          <div
            style={{
              fontSize: '11px',
              color: 'rgba(250,250,250,0.4)',
              textAlign: 'center',
              marginBottom: '12px',
              minHeight: '36px',
              fontStyle: 'italic',
            }}
          >
            等待综合输出...
          </div>
        )}

        {/* 底部按钮 */}
        <button
          onClick={onShowActionPlan}
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: '10px',
            letterSpacing: '0.3em',
            color: '#fafafa',
            background: 'rgba(250,250,250,0.08)',
            border: `1px solid rgba(250,250,250,0.25)`,
            borderRadius: '2px',
            cursor: 'pointer',
            transition: 'all 0.3s cubic-bezier(0.22,1,0.36,1)',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = WARM;
            e.currentTarget.style.borderColor = WARM;
            e.currentTarget.style.color = '#1a1a1a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(250,250,250,0.08)';
            e.currentTarget.style.borderColor = 'rgba(250,250,250,0.25)';
            e.currentTarget.style.color = '#fafafa';
          }}
        >
          查看完整方案
        </button>
      </div>
    </div>
  );
}

export default memo(SynthesisNodeImpl);
