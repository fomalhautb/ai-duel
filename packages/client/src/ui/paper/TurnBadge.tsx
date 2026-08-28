export type TurnBadgeProps = {
  turn: number
  className?: string
}

/**
 * 回合徽章：一条横贯细线，中间嵌一块深蓝小匾。用在战场中线上分隔敌我。
 *
 * 两侧的线是外层的 ::before / ::after 用 flex: 1 撑出来的，所以小匾永远居中，
 * 回合数从个位涨到两位也不会把线推歪。
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
