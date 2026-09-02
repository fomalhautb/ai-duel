import type { CSSProperties } from 'react'
import './cardFaceOverlay.css'

export interface CardCostBadgeProps {
  cost: number
  /**
   * 圆章的圆心（百分比，x 按卡宽、y 按卡高）。不传就用 CSS 里的默认位置——
   * 那是技能牌原画上印着的那枚圆章的位置，24 张几乎都摆在同一处。
   */
  center?: { x: number; y: number }
  /**
   * 盘底色。技能牌传的是从原画那枚圆章上采下来的颜色，盖上去才看不出接缝；
   * 不传就按插画主色调（AI 牌走这条）。
   */
  fill?: string
}

/**
 * 卡面左上角那枚「N TOKEN」圆章。
 *
 * 两类牌都用它，但要盖的东西不一样：AI 牌盖的是原画角上那枚星章，技能牌盖的是原画上
 * 已经印好的同一枚费用圆章。技能牌那枚是烘焙进图里的，费用一改数字就对不上了，
 * 所以宁可原样再画一遍盖住——以后调平衡不用重出原画。
 *
 * 直径不由调用方给，全场统一写在 cardFaceOverlay.css 里。
 */
export function CardCostBadge({ cost, center, fill }: CardCostBadgeProps) {
  // 自定义属性写成一张字符串表再整体断言：直接在 JSX 里拼字面量的话，带展开的对象过不了 CSSProperties 的检查。
  const style: Record<string, string> = {}
  if (center !== undefined) {
    style['--cost-x'] = `${center.x}%`
    style['--cost-y'] = `${center.y}%`
  }
  if (fill !== undefined) style['--cost-fill'] = fill
  return (
    <div
      className="card-overlay__cost grain on-dark"
      style={style as CSSProperties}
      aria-label={`消耗 ${cost} Token`}
    >
      <svg className="card-overlay__cost-art" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="card-overlay__rim" cx="50" cy="50" r="48" strokeWidth="2.5" />
        <circle className="card-overlay__rim-light" cx="50" cy="50" r="44" strokeWidth="1" />
        <circle className="card-overlay__rim" cx="50" cy="50" r="40.5" strokeWidth="0.6" />
        <path className="card-overlay__rim-light" d="M22 16Q50 0 78 16M22 84Q50 100 78 84" />
        <text className="card-overlay__cost-number" x="50" y="62" textAnchor="middle"
          fontSize={String(cost).length > 1 ? 48 : 60} aria-hidden="true">{cost}</text>
        <text className="card-overlay__cost-unit" x="50" y="80" textAnchor="middle" aria-hidden="true">TOKEN</text>
      </svg>
    </div>
  )
}
