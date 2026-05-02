// 不可能三角浮窗 - 中央装饰，顶点根据 scenario 切换、按 weights 实时塌陷
import React, { useMemo } from 'react';
import { useAletheiaStore } from '../../stores/useAletheiaStore';

// 三个场景对应的三个顶点文案（顺序：top, bottomLeft, bottomRight）
const VERTEX_TEXT = {
  tob: ['功能', '稳健', '成本'],
  toc: ['功能', '体验', '变现'],
  tog: ['效率', '合规', '公信'],
};

// weights（logic / compliance / business）映射到三个顶点的"拉力"
// - top 顶点 = 功能/效率 类（由 logic 主导）
// - bottomLeft 顶点 = 稳健/体验/合规 类（由 compliance 主导）
// - bottomRight 顶点 = 成本/变现/公信 类（由 business 主导）
function mapWeightsToPulls(weights) {
  const safe = weights || { logic: 1, compliance: 1, business: 1 };
  return {
    top: typeof safe.logic === 'number' ? safe.logic : 1,
    bottomLeft: typeof safe.compliance === 'number' ? safe.compliance : 1,
    bottomRight: typeof safe.business === 'number' ? safe.business : 1,
  };
}

/**
 * 不可能三角组件
 * - 三角形 SVG，三个顶点按 weights 实时偏移（拉扯感）
 * - 中心显示当前主导维度
 * - 边框 1px solid，hover 时变暖色
 */
export default function ImpossibleTriangle() {
  const scenario = useAletheiaStore
    ? useAletheiaStore((s) => s?.scenario || 'tob')
    : 'tob';
  const weights = useAletheiaStore
    ? useAletheiaStore((s) => s?.weights || { logic: 1, compliance: 1, business: 1 })
    : { logic: 1, compliance: 1, business: 1 };

  const labels = VERTEX_TEXT[scenario] || VERTEX_TEXT.tob;
  const pulls = mapWeightsToPulls(weights);

  // SVG 视图基准
  const size = 240;
  const cx = size / 2;
  const cy = size / 2 + 14; // 略向下偏，给顶部文字留空间
  const baseRadius = 78; // 三角外接圆基础半径

  // 偏移量：weight 高 → 该顶点向外突出，最多再多推 18px
  const offsetMax = 18;
  // 计算三个顶点的实际半径（基础 + weight 比例 * 最大偏移）
  // 归一化（用各自值，相对 1 为基准）
  const radii = {
    top: baseRadius + Math.min(1.5, pulls.top) * offsetMax * 0.55,
    bottomLeft: baseRadius + Math.min(1.5, pulls.bottomLeft) * offsetMax * 0.55,
    bottomRight: baseRadius + Math.min(1.5, pulls.bottomRight) * offsetMax * 0.55,
  };

  // 三个顶点角度（度）：top=270°(-90), bottomLeft=150°, bottomRight=30°
  const points = useMemo(() => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    return {
      top: {
        x: cx + radii.top * Math.cos(toRad(-90)),
        y: cy + radii.top * Math.sin(toRad(-90)),
      },
      bottomLeft: {
        x: cx + radii.bottomLeft * Math.cos(toRad(150)),
        y: cy + radii.bottomLeft * Math.sin(toRad(150)),
      },
      bottomRight: {
        x: cx + radii.bottomRight * Math.cos(toRad(30)),
        y: cy + radii.bottomRight * Math.sin(toRad(30)),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radii.top, radii.bottomLeft, radii.bottomRight, cx, cy]);

  // 主导维度
  const dominantKey = (() => {
    const entries = [
      ['top', pulls.top],
      ['bottomLeft', pulls.bottomLeft],
      ['bottomRight', pulls.bottomRight],
    ];
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  })();
  const dominantLabel =
    dominantKey === 'top'
      ? labels[0]
      : dominantKey === 'bottomLeft'
      ? labels[1]
      : labels[2];

  const polygonPoints = `${points.top.x},${points.top.y} ${points.bottomRight.x},${points.bottomRight.y} ${points.bottomLeft.x},${points.bottomLeft.y}`;

  return (
    <div
      className="aletheia-impossible-triangle"
      style={{
        position: 'relative',
        width: size,
        height: size + 32,
        padding: '12px',
        background: 'rgba(250, 250, 250, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid #e8e8e8',
        borderRadius: '4px',
        transition: 'border-color 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#c8a882')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#e8e8e8')}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: 'block' }}
      >
        {/* 三角形主体 - 顶点位置随 weights 偏移，带过渡动画 */}
        <polygon
          points={polygonPoints}
          fill="none"
          stroke="#1a1a1a"
          strokeWidth={1.2}
          style={{
            transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />

        {/* 三个顶点的小圆点（暖色） */}
        {[points.top, points.bottomLeft, points.bottomRight].map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3.5}
            fill="#c8a882"
            style={{
              transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        ))}

        {/* 顶点文字 */}
        <text
          x={points.top.x}
          y={points.top.y - 10}
          textAnchor="middle"
          fontFamily='"Noto Serif SC", Georgia, serif'
          fontSize="14"
          fill="#1a1a1a"
          style={{ transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)' }}
        >
          {labels[0]}
        </text>
        <text
          x={points.bottomLeft.x - 10}
          y={points.bottomLeft.y + 16}
          textAnchor="end"
          fontFamily='"Noto Serif SC", Georgia, serif'
          fontSize="14"
          fill="#1a1a1a"
          style={{ transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)' }}
        >
          {labels[1]}
        </text>
        <text
          x={points.bottomRight.x + 10}
          y={points.bottomRight.y + 16}
          textAnchor="start"
          fontFamily='"Noto Serif SC", Georgia, serif'
          fontSize="14"
          fill="#1a1a1a"
          style={{ transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)' }}
        >
          {labels[2]}
        </text>

        {/* 中心点 */}
        <circle cx={cx} cy={cy} r={2} fill="#bbb" />
      </svg>

      {/* 中心主导标签 - 绝对定位在三角中心 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: cy + 18,
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontSize: '0.62rem',
            letterSpacing: '0.35em',
            color: '#888',
            marginBottom: '4px',
          }}
        >
          DOMINANT
        </div>
        <div
          style={{
            fontFamily: '"Noto Serif SC", Georgia, serif',
            fontSize: '0.95rem',
            color: '#c8a882',
            letterSpacing: '0.05em',
          }}
        >
          {dominantLabel}
        </div>
      </div>
    </div>
  );
}
