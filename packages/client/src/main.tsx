import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { HandDemo } from './HandDemo'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 挂载点')

// 动画调试页走查询参数进：?demo=hand。
// 不引路由库是因为整个应用目前只有"对局"一个界面，加一层路由不划算。
const isHandDemo = new URLSearchParams(window.location.search).get('demo') === 'hand'

createRoot(container).render(<StrictMode>{isHandDemo ? <HandDemo /> : <App />}</StrictMode>)
