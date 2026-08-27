import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // 优先读 PORT 环境变量：多个 worktree 同时开 dev server 时 5173 会被占用，
    // 预览工具会通过 PORT 分配一个空闲端口（见 .claude/launch.json 的 autoPort）。
    port: Number(process.env.PORT) || 5173,
  },
})
