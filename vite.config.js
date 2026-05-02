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
  },
  build: {
    sourcemap: mode !== 'production',
  },
}))
