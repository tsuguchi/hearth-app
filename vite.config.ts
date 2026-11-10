import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 画面（React）と Workers（worker/index.ts）を、1 つの開発サーバーで同じ URL から動かす
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
})
