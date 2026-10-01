import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'

// 版本号唯一来源是根 package.json，构建时注入前端（顶栏徽标自动跟随，免去双处手改）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8300' }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
