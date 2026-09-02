/**
 * 把「当前视口的宽和高」量成两个全局 CSS 变量（--vp-w / --vp-h），
 * 给全站那几块 16:9 舞台的 width: min(...) 用，替掉原来直接写的 100vw / 100dvh。
 *
 * 起因是安卓 Chrome 上「一键全屏」偶发的一条黑底边：那个动作其实是两步——
 * 先 requestFullscreen 收掉浏览器自己的栏，再 screen.orientation.lock 把屏幕转成横屏
 *（见 ui/fullscreen.ts）。两步之间浏览器会连着改好几次视口尺寸，
 * 而 dvh 这类动态视口单位在 Chrome 上是攒着更新的，有时候最后一次排版用的还是收栏之前的高度：
 * 舞台因此比屏幕矮一截，底下露出一条没画到的黑边。退出去重来一次又好了，正是这种偶发。
 *
 * 改成 JS 来量能治两件事：
 * 1. window.innerHeight 是当场读的，不吃 dvh 那份延迟更新；
 * 2. 进全屏 / 转屏之后再连着复查一段时间（settle），浏览器什么时候把尺寸报对，
 *    变量就什么时候跟上，顺带逼舞台重排一次，把那条黑边补掉。
 *
 * 变量没写上之前，CSS 那边的兜底值仍是原来的 100vw / 100dvh，所以首帧不会闪。
 */

import { onFullscreenChange } from './fullscreen'

const WIDTH_VAR = '--vp-w'
const HEIGHT_VAR = '--vp-h'

/**
 * 进全屏 / 转屏之后继续复查视口尺寸的时长。
 * 安卓上「收浏览器栏 + 转屏」要好几帧才稳，resize 事件也不保证在最后那次尺寸变化时补发一遍，
 * 所以这段时间里每帧都自己量。一秒多足够覆盖转屏动画，又不会长到白烧电。
 */
const SETTLE_MS = 1200

let lastWidth = 0
let lastHeight = 0
let settleDeadline = 0
let settleFrame = 0

function write(): void {
  const width = window.innerWidth
  const height = window.innerHeight
  // 0 说明这一帧还量不出东西（有些浏览器在转屏中途会报 0），写进去整块画面会塌掉。
  if (width === 0 || height === 0) return
  if (width === lastWidth && height === lastHeight) return
  lastWidth = width
  lastHeight = height
  const root = document.documentElement
  root.style.setProperty(WIDTH_VAR, `${width}px`)
  root.style.setProperty(HEIGHT_VAR, `${height}px`)
}

function tick(): void {
  write()
  if (performance.now() >= settleDeadline) {
    settleFrame = 0
    return
  }
  settleFrame = requestAnimationFrame(tick)
}

/**
 * 开始（或续上）一轮复查。视口尺寸即将连着变好几次时调用——目前是进出全屏和转屏。
 * 重复调用只是把截止时间往后推，不会开出第二条 rAF 链。
 */
export function resettleViewportVars(): void {
  settleDeadline = performance.now() + SETTLE_MS
  if (settleFrame === 0) settleFrame = requestAnimationFrame(tick)
}

/** 装上监听并立刻量一次。整个应用只该调一次（main.tsx），返回卸载函数备用。 */
export function installViewportVars(): () => void {
  if (typeof window === 'undefined') return () => {}

  write()

  const onResize = () => {
    write()
  }
  window.addEventListener('resize', onResize)
  // 转屏和进出全屏之后尺寸还会再抖几帧，光靠 resize 会停在中途那个尺寸上。
  window.addEventListener('orientationchange', resettleViewportVars)
  const offFullscreen = onFullscreenChange(resettleViewportVars)

  return () => {
    window.removeEventListener('resize', onResize)
    window.removeEventListener('orientationchange', resettleViewportVars)
    offFullscreen()
    if (settleFrame !== 0) {
      cancelAnimationFrame(settleFrame)
      settleFrame = 0
    }
  }
}
