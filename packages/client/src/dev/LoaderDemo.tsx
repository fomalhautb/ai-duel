/**
 * 加载动画演示页（访问 /loader 进入）。
 *
 * 上半屏是"真实用法"：整屏就一个默认参数的 CardLoader 加一行提示，
 * 和 index.html 的首屏 loader 是同一副样子，用来判断整体观感。
 * 往下滚是变体墙，把 size / speed / color 三个 prop 的取值范围各挑几档摆开对比，
 * 最后一格特意换成纸色底 + 深色线，验证这套线框在浅色背景上同样成立
 * ——之后对局界面是纸面配色，loader 迟早要放上去。
 */

import { useLocation } from 'wouter'
import { CardLoader } from '../ui/CardLoader'
import type { CardLoaderProps } from '../ui/CardLoader'

interface Variant {
  /** 格子下面那行小字，直接写清楚这一格改了哪个 prop。 */
  label: string
  /** 传给 CardLoader 的参数，没写的走组件默认值。 */
  loader: CardLoaderProps
  /** 是否换成纸色底。只有验证浅色背景的那一格需要。 */
  paper?: boolean
}

const VARIANTS: Variant[] = [
  { label: '小号 · size 48', loader: { size: 48 } },
  { label: '默认 · size 72', loader: {} },
  { label: '大号 · size 110', loader: { size: 110 } },
  { label: '慢 · speed 2.8', loader: { speed: 2.8 } },
  { label: '快 · speed 1', loader: { speed: 1 } },
  { label: '强调色 · #38bdf8', loader: { color: '#38bdf8' } },
  { label: '纸色底 · 深色线 #2c2926', loader: { color: '#2c2926' }, paper: true },
]

export function LoaderDemo() {
  const [, navigate] = useLocation()

  return (
    <div className="loader-demo">
      <section className="loader-demo__hero">
        <CardLoader />
        <p className="page-loader__text">加载中…</p>
      </section>

      <section>
        <h2 className="loader-demo__heading">参数变体</h2>
        <p className="loader-demo__note">
          纯 CSS 动画，不依赖 GSAP。系统开了"减弱动态效果"时全部变体都会停掉弹跳，改成明暗呼吸。
        </p>
        <div className="loader-demo__grid">
          {VARIANTS.map((variant) => (
            <div
              key={variant.label}
              className={
                variant.paper === true
                  ? 'loader-demo__cell loader-demo__cell--paper'
                  : 'loader-demo__cell'
              }
            >
              <CardLoader {...variant.loader} />
              <span className="loader-demo__label">{variant.label}</span>
            </div>
          ))}
        </div>

        <button type="button" className="loader-demo__back" onClick={() => navigate('/')}>
          回首页
        </button>
      </section>
    </div>
  )
}
