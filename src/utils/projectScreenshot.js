/**
 * projectScreenshot — 元认知项目截图工具
 *
 * 流程:
 *   1) 等 React Flow 把新节点渲染到 DOM
 *   2) 算项目所有节点 (rootId + 同 projectRootId) 的 bbox
 *   3) 用 react-flow getTransformForBounds 算"刚好框住这片"的 viewport 变换
 *   4) html-to-image.toPng + toSvg 在 .react-flow__viewport 上施加变换截图
 *   5) base64 dataUrl POST 到 source-proxy /canvas/screenshot
 *   6) 拿回 pngUrl / svgUrl, 写到 conclusion 节点 data 上 — bot 反馈卡读这里
 *
 * 关键细节:
 *   - PNG 用于飞书 IM 卡片内嵌 (需 lark-cli upload 拿 image_key)
 *   - SVG 用于"矢量大图"按钮跳转 (浏览器原生支持 SVG 缩放)
 *   - 不动用户当前视口 (不调 setViewport / fitView), 只在 toPng 内部 transform
 */

import { getRectOfNodes, getTransformForBounds } from 'reactflow'
import { toPng, toSvg } from 'html-to-image'

const SCREENSHOT_WIDTH = 1920
const SCREENSHOT_HEIGHT = 1080

/** 算 conclusion 所属项目的所有节点 bbox 并截图上传 */
export async function captureAndUploadProjectScreenshot({ rootId, conclusionId, allNodes, prompt, decision, score, room }) {
  // 收集这次项目相关节点 — root + 同 projectRootId
  const projectNodes = allNodes.filter((n) =>
    n.id === rootId || n.data?.projectRootId === rootId
  )
  if (projectNodes.length === 0) return null

  // 等 React Flow render 新节点 — 实测 250-500ms 够
  await new Promise((r) => setTimeout(r, 600))

  // 计算 bbox + 用于框住整个项目的视口变换
  const bounds = getRectOfNodes(projectNodes)
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
  const transform = getTransformForBounds(bounds, SCREENSHOT_WIDTH, SCREENSHOT_HEIGHT, 0.3, 1.6)

  const viewport = document.querySelector('.react-flow__viewport')
  if (!viewport) {
    console.warn('[projectScreenshot] .react-flow__viewport 不在 DOM, 跳过截图')
    return null
  }

  // 共享配置 — 框死 SCREENSHOT_WIDTH x SCREENSHOT_HEIGHT, 内部用 transform 框住目标 bbox
  const captureOpts = {
    backgroundColor: '#fafafa',
    width: SCREENSHOT_WIDTH,
    height: SCREENSHOT_HEIGHT,
    style: {
      width: `${SCREENSHOT_WIDTH}px`,
      height: `${SCREENSHOT_HEIGHT}px`,
      transform: `translate(${transform[0]}px, ${transform[1]}px) scale(${transform[2]})`,
    },
    pixelRatio: 1.5,
    cacheBust: true,
    // 过滤: 只截 react-flow 内的节点/边, 跳过 minimap/controls/panel
    filter: (node) => {
      if (!(node instanceof Element)) return true
      const cls = node.classList
      if (cls?.contains('react-flow__minimap')) return false
      if (cls?.contains('react-flow__controls')) return false
      if (cls?.contains('react-flow__panel')) return false
      if (cls?.contains('react-flow__attribution')) return false
      return true
    },
  }

  let pngDataUrl = null
  let svgDataUrl = null

  try {
    pngDataUrl = await toPng(viewport, captureOpts)
  } catch (e) {
    console.error('[projectScreenshot] toPng 失败:', e?.message || e)
  }

  try {
    svgDataUrl = await toSvg(viewport, captureOpts)
  } catch (e) {
    console.error('[projectScreenshot] toSvg 失败:', e?.message || e)
  }

  if (!pngDataUrl && !svgDataUrl) return null

  // POST 到 source-proxy
  const ssId = conclusionId || rootId
  try {
    const r = await fetch('/canvas/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        id: ssId,
        room,
        rootId,
        prompt,
        decision,
        score,
        pngDataUrl,
        svgDataUrl,
      }),
    })
    const j = await r.json()
    if (!j.ok) {
      console.warn('[projectScreenshot] upload 返回错误:', j.error)
      return null
    }
    console.log('[projectScreenshot] 上传成功 id=' + ssId, 'pngUrl=' + j.pngUrl)
    return { id: ssId, pngUrl: j.pngUrl, svgUrl: j.svgUrl, pngPath: j.pngPath }
  } catch (e) {
    console.error('[projectScreenshot] 上传失败:', e?.message || e)
    return null
  }
}
