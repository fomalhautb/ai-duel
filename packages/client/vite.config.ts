import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // 默认 5173；同时开着多个工作树时端口会撞，用 PORT 换一个即可。
    port: Number(process.env.PORT ?? 5173),
    // 黑客松是两台电脑联机，另一台要用局域网 IP 打开这个页面，所以不能只监听 localhost。
    host: true,
  },
})
