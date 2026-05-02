import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

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
