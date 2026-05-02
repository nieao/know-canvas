import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './themes/blackgold.css'
import { attachConsoleBridge, pushLog } from './utils/logBus'

// 启动时根据 localStorage 应用主题（黑金极简02 / 默认建筑极简）
const savedTheme = typeof window !== 'undefined' ? localStorage.getItem('know_canvas_theme') : null
if (savedTheme === 'blackgold') {
  document.body.classList.add('theme-blackgold')
}

// 启动时桥接 console.log 到 CliMonitor + 一行启动日志
attachConsoleBridge()
pushLog({ level: 'info', source: 'bus', msg: 'ALETHEIA 启动 · ' + new Date().toLocaleString() })

// Dev / E2E：把 store 暴露到 window 便于调试和测试
if (import.meta.env.DEV || (typeof window !== 'undefined' && window.location.search.includes('e2e'))) {
  import('./stores/useCanvasStore').then((m) => {
    window.__canvasStore = m.default
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
