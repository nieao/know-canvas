import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './themes/blackgold.css'
import './themes/cyberpunk.css'
import './themes/macaron.css'
import './themes/mistblue.css'
import './themes/forest.css'
import { attachConsoleBridge, pushLog } from './utils/logBus'

// 启动时根据 localStorage 应用主题
// 支持: default(白底) / blackgold(黑金) / cyberpunk(赛博朋克) / macaron(马卡龙Q版)
//       / mistblue(雾蓝) / forest(森林苔影)
const savedTheme = typeof window !== 'undefined' ? localStorage.getItem('know_canvas_theme') : null
const THEME_CLASSES = ['theme-blackgold', 'theme-cyberpunk', 'theme-macaron', 'theme-mistblue', 'theme-forest']
if (savedTheme && THEME_CLASSES.includes(`theme-${savedTheme}`)) {
  document.body.classList.add(`theme-${savedTheme}`)
}

// 启动时桥接 console.log 到 CliMonitor + 一行启动日志
attachConsoleBridge()
pushLog({ level: 'info', source: 'bus', msg: 'ALETHEIA 启动 · ' + new Date().toLocaleString() })

// Dev / E2E：把所有核心 store 暴露到 window 便于调试和测试
// 全部从 page bundle import (而不是测试脚本里 dynamic import) 共享同一个 module instance, 避免 HMR 双实例
if (import.meta.env.DEV || (typeof window !== 'undefined' && window.location.search.includes('e2e'))) {
  Promise.all([
    import('./stores/useCanvasStore'),
    import('./stores/useAletheiaStore'),
    import('./stores/useCostMeterStore'),
    import('./stores/useProjectLibraryStore'),
    import('./services/aletheia/runner'),
  ]).then(([canvas, ale, cms, pls, runner]) => {
    window.__canvasStore = canvas.default
    window.__aletheiaStore = ale.default
    window.__costMeterStore = cms.default
    window.__projectLibraryStore = pls.default
    window.__runAletheiaCycle = runner.runAletheiaCycle
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
