import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installViewportVars } from './ui/viewportVars'
import './styles.css'
// 纸面组件库的 token 和样式。排在 styles.css 之后：两边都会写 :root，
// 后加载的这份负责补上纸张色板和纸纹变量，不覆盖 styles.css 已有的设定。
import './ui/paper/paper.css'

// 视口尺寸变量（--vp-w / --vp-h）要在首帧之前写好，舞台第一次排版就用得上真值。
// 它同时负责修安卓 Chrome 进全屏时偶发的黑底边，见 ui/viewportVars.ts。
installViewportVars()

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
