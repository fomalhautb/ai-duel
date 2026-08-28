export type ManaMeterProps = {
  current: number
  max: number
  className?: string
}

/**
 * 法力计：衬线数字 + 一排点。点的总数就是 max，点亮 current 个。
 *
 * 数字和点都画一遍是故意的：点适合一眼看出「还剩几格」，具体数值还是数字快。
 * max 很大时这排点会一直横向长下去，调用处要自己控制上限（游戏里是 12）。
 */
export function ManaMeter({ current, max, className = '' }: ManaMeterProps) {
  const pips = Array.from({ length: Math.max(0, max) }, (_, i) => i < current)
  return (
    <div className={`paper-mana-meter ${className}`.trim()}>
      <span className="paper-mana-meter__num">
        {current}
        <span className="paper-mana-meter__max"> / {max}</span>
      </span>
      <span className="paper-mana-meter__pips" aria-hidden="true">
        {pips.map((on, i) => (
          <i
            key={i}
            className={`paper-mana-meter__pip ${on ? 'paper-mana-meter__pip--on' : ''}`.trim()}
          />
        ))}
      </span>
    </div>
  )
}
