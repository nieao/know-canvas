// 辩论流弹幕面板 - 左侧贴边显示对抗过程，倒序滚动展示 PROPOSER / REFUTER / SUPERVISOR / SYNTHESIS 发言
import React, { useEffect, useRef, useState } from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';

// 角色样式映射 (颜色 + 标签 + 描边)
const ROLE_META = {
  PROPOSER: { color: '#3a6ea5', bg: 'rgba(58,110,165,0.08)', label: 'PROPOSER' },
  REFUTER: { color: '#b27c8b', bg: 'rgba(178,124,139,0.08)', label: 'REFUTER' },
  SUPERVISOR: { color: 'var(--accent)', bg: 'rgba(200,168,130,0.10)', label: 'SUPERVISOR' },
  SYNTHESIS: { color: '#a07cb8', bg: 'rgba(160,124,184,0.10)', label: 'SYNTHESIS' },
};

// 时间戳格式化为 HH:mm:ss
function formatTs(ts) {
  if (!ts) return '--:--:--';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 取角色 meta，未知角色 fallback 灰色
function getRoleMeta(role) {
  if (!role) return { color: 'var(--text-faint)', bg: 'rgba(136,136,136,0.08)', label: 'AGENT' };
  const upper = String(role).toUpperCase();
  return ROLE_META[upper] || { color: 'var(--text-faint)', bg: 'rgba(136,136,136,0.08)', label: upper };
}

// 单条弹幕项 - 处理首次渲染滑入动画
function StreamItem({ item, isNew }) {
  const meta = getRoleMeta(item.role);
  const [entered, setEntered] = useState(!isNew);

  useEffect(() => {
    if (!isNew) return;
    // 下一帧切换到目标位置触发 transition
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [isNew]);

  return (
    <div
      style={{
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(-10px)',
        transition: 'opacity 300ms cubic-bezier(0.22,1,0.36,1), transform 300ms cubic-bezier(0.22,1,0.36,1)',
        padding: '10px 12px',
        marginBottom: '8px',
        background: meta.bg,
        borderLeft: `2px solid ${meta.color}`,
        borderRadius: '2px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span
          style={{
            fontFamily: '"Noto Sans SC", system-ui, sans-serif',
            fontSize: '9px',
            letterSpacing: '0.25em',
            fontWeight: 600,
            color: meta.color,
          }}
        >
          {meta.label}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontFamily: 'Georgia, serif' }}>
          {formatTs(item.ts)}
        </span>
      </div>
      <div
        style={{
          fontSize: '12px',
          lineHeight: 1.55,
          color: 'var(--text-secondary)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={item.text}
      >
        {item.text}
      </div>
    </div>
  );
}

/**
 * 辩论流弹幕面板
 * - 左侧贴边 320px 宽
 * - 倒序展示 useAletheiaStore.debateStream
 * - 新增条目从顶部滑入
 * - 底部"清空"按钮
 */
export default function DebateStreamPanel() {
  // 安全读取 store
  const stream = useAletheiaStore
    ? useAletheiaStore((s) => (Array.isArray(s?.debateStream) ? s.debateStream : []))
    : [];
  const round = useAletheiaStore
    ? useAletheiaStore((s) => (typeof s?.currentRound === 'number' ? s.currentRound : 0))
    : 0;
  const clearDebate = useAletheiaStore
    ? useAletheiaStore((s) => s?.clearDebate)
    : null;

  // 跟踪上一次长度，用于判断哪些条目是"新"的（仅顶部新增触发动画）
  const prevLenRef = useRef(stream.length);
  const newCountRef = useRef(0);

  useEffect(() => {
    const delta = stream.length - prevLenRef.current;
    newCountRef.current = delta > 0 ? delta : 0;
    prevLenRef.current = stream.length;
  }, [stream.length]);

  // 倒序: 最新在上 (假设 store 内是按时间追加的, 反转一下)
  const reversed = [...stream].reverse();
  const newCount = newCountRef.current;

  return (
    <div
      style={{
        position: 'fixed',
        top: '64px',
        left: 0,
        bottom: 0,
        width: '320px',
        background: 'var(--surface)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 30,
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
      }}
    >
      {/* 顶部 */}
      <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div
              style={{
                fontFamily: '"Noto Serif SC", Georgia, serif',
                fontSize: '18px',
                color: 'var(--text-primary)',
                letterSpacing: '0.05em',
              }}
            >
              辩论流
            </div>
            <div
              style={{
                marginTop: '4px',
                width: '32px',
                height: '1px',
                background: 'var(--accent)',
              }}
            />
          </div>
          <div
            style={{
              fontSize: '10px',
              letterSpacing: '0.25em',
              color: 'var(--text-faint)',
            }}
          >
            ROUND {round}
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 16px',
        }}
      >
        {reversed.length === 0 ? (
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-faint)',
              textAlign: 'center',
              marginTop: '40px',
              fontStyle: 'italic',
            }}
          >
            等待对抗开始...
          </div>
        ) : (
          reversed.map((item, idx) => {
            // 倒序后, 前 newCount 条是本次新增的
            const isNew = idx < newCount;
            const key = item.id || `${item.ts || ''}-${idx}-${item.role || ''}`;
            return <StreamItem key={key} item={item} isNew={isNew} />;
          })
        )}
      </div>

      {/* 底部清空按钮 */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => {
            if (typeof clearDebate === 'function') clearDebate();
          }}
          disabled={!clearDebate || reversed.length === 0}
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: '11px',
            letterSpacing: '0.25em',
            color: reversed.length === 0 ? 'var(--text-faint)' : 'var(--text-muted)',
            background: 'transparent',
            border: '1px solid var(--border-subtle)',
            borderRadius: '2px',
            cursor: !clearDebate || reversed.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s cubic-bezier(0.22,1,0.36,1)',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            if (reversed.length === 0) return;
            e.currentTarget.style.borderColor = 'var(--accent)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            e.currentTarget.style.color = reversed.length === 0 ? 'var(--text-faint)' : 'var(--text-muted)';
          }}
        >
          清空
        </button>
      </div>
    </div>
  );
}
