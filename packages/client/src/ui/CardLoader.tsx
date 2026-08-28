/**
 * 线框卡片加载动画，API 照着 ldrs（uiball loaders）那套来：size / speed / color 三个 prop。
 *
 * 刻意不用 GSAP，全靠 CSS 动画。原因是同一套视觉还要在 index.html 里当首屏 loader 用：
 * 那一刻整个 JS bundle（React、GSAP 都在里面）还没下载完，只有纯 CSS 能立刻动起来。
 * 两处必须长得一模一样，所以这边也不许依赖任何运行时库。
 *
 * 组件本身只做一件事：把三个 prop 翻译成内联 CSS 自定义属性。
 * 真正的尺寸推导、keyframes 全在 styles.css 的「卡片加载动画」一节。
 */

import type { CSSProperties } from 'react'

export interface CardLoaderProps {
  /**
   * 卡片高度，单位 px。宽度按 2:3 自动算出来，和游戏卡面 150:225 同比例。
   * 默认 72，比 ldrs 默认的 45 大一档——这张卡上面有内框和菱形，太小就糊成一团了。
   */
  size?: number
  /** 一次完整弹跳的周期，单位秒。数越大弹得越慢。 */
  speed?: number
  /** 线框颜色。影子也是拿它加透明度画的，所以只有这一个颜色旋钮。 */
  color?: string
}

export function CardLoader({ size = 72, speed = 1.75, color = '#ddcab7' }: CardLoaderProps) {
  return (
    <div
      className="card-loader"
      // role="status" 让读屏软件知道这里是一处"状态播报"；文字全在 aria-label 上，
      // 所以里面两个 span 纯装饰，不需要也不应该被读出来。
      role="status"
      aria-label="加载中"
      style={
        {
          '--cl-size': `${size}px`,
          '--cl-speed': `${speed}s`,
          '--cl-color': color,
        } as CSSProperties
      }
    >
      <span className="card-loader__card" aria-hidden="true" />
      <span className="card-loader__shadow" aria-hidden="true" />
    </div>
  )
}
