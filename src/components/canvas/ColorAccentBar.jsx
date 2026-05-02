/**
 * ColorAccentBar - 节点顶部色带
 * 读取节点 data.color，渲染 4px 顶部色带作为视觉标识
 * 不传 color 则不渲染
 */

function ColorAccentBar({ color, position = 'top' }) {
  if (!color) return null
  const baseStyle = {
    position: 'absolute',
    backgroundColor: color,
    zIndex: 5,
    pointerEvents: 'none',
  }
  const layout = position === 'left'
    ? { top: 0, left: 0, bottom: 0, width: 4, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }
    : { top: 0, left: 0, right: 0, height: 4, borderTopLeftRadius: 8, borderTopRightRadius: 8 }
  return <div style={{ ...baseStyle, ...layout }} />
}

export default ColorAccentBar
