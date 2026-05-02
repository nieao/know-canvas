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
    },
  },
  build: {
    sourcemap: mode !== 'production',
  },
}))
