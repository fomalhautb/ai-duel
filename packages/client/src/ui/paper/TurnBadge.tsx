export type TurnBadgeProps = {
  turn: number
  className?: string
}

/**
 * 回合徽章：一条横贯细线，中间嵌一块深蓝小匾。纸面主题的组件，现在只有设计稿页在用。
 *
 * 两侧的线是外层的 ::before / ::after 用 flex: 1 撑出来的，所以小匾永远居中，
 * 回合数从个位涨到两位也不会把线推歪。
 *
 * 对局页那条敌我分界中线是同一个样式思路，但没有复用它：那边是深蓝底、要拉满整块战场，
 * 而这套是浅纸底的深色线加 max-width: 320px，两处的配色和宽度约束正好相反
 * （见 styles.css 的 .battle__midline）。
 */
export function TurnBadge({ turn, className = '' }: TurnBadgeProps) {
  return (
    <div className={`paper-turn-line ${className}`.trim()}>
      <span className="paper-turn-badge">
        第 <b className="paper-turn-badge__num">{turn}</b> 回合
      </span>
    </div>
  )
}
