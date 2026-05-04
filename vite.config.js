import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  // 部署到 ha2.digitalvio.shop/canvas/ 子路径时，build 用 BUILD_BASE=/canvas/
  // 默认根路径 / 适用于本地 dev
  base: process.env.BUILD_BASE || '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    open: true,
    // 本地 dev 时, 把 /canvas/api/llm/* 反代到线上 VPS daemon, 让 dev 行为跟线上对齐.
    // (线上是 nginx 在 ha2.digitalvio.shop 反代 17082 的同源 daemon)
    // dev 不用启本地 LLM proxy / 不用切 provider, 改一行配置就齐.
    proxy: {
      '/canvas/api/llm': {
        target: 'https://ha2.digitalvio.shop',
        changeOrigin: true,
        secure: true,
      },
      // 外部源中转 (飞书 / 得到 / Notion) — 本地 dev 时反代到 source-proxy daemon (port 17090)
      // 浏览器调 /canvas/api/source/feishu/search → vite proxy → http://127.0.0.1:17090/feishu/search
      // 线上 Caddy 同样把 /canvas/api/source/* 反代到 17090, 行为一致
      '/canvas/api/source': {
        target: 'http://127.0.0.1:17090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/canvas\/api\/source/, ''),
      },
    },
  },
  build: {
    sourcemap: mode !== 'production',
  },
}))
