import type { CSSProperties } from 'react'
import { PaperIcon } from './PaperIcons'
import type { PaperIconName } from './PaperIcons'

/** 卡牌主题色。全卡换色只改容器上的 --accent，其它样式一律读它。 */
export type PaperAccent = 'green' | 'rust' | 'blue' | 'purple' | 'gold' | 'life'

const ACCENT_VAR: Record<PaperAccent, string> = {
  green: 'var(--c-green)',
  rust: 'var(--c-rust)',
  blue: 'var(--c-blue)',
  purple: 'var(--c-purple)',
  gold: 'var(--c-gold)',
  life: 'var(--c-life)',
}

/**
 * 卡面中央的放射线底纹：从内圈 r=14 射向外圈 r=54 的 16 条线。
 *
 * 端点坐标是烘死的，不在渲染时用三角函数现算：一张卡就要算 32 个点，
 * 而这组线永远长一个样，算出来的值每次都相同。
 * 抽成组件只是为了不在每张卡的 JSX 里重复这 16 行。
 */
function CardRays() {
  return (
    <svg
      className="paper-card__rays"
      viewBox="0 0 120 120"
      style={{ filter: 'url(#ai-duel-rough-rays)' }}
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.75">
        <path d="M74 60 L114 60" />
        <path d="M72.93 65.36 L109.89 80.67" />
        <path d="M69.9 69.9 L98.18 98.18" />
        <path d="M65.36 72.93 L80.67 109.89" />
        <path d="M60 74 L60 114" />
        <path d="M54.64 72.93 L39.33 109.89" />
        <path d="M50.1 69.9 L21.82 98.18" />
        <path d="M47.07 65.36 L10.11 80.67" />
        <path d="M46 60 L6 60" />
        <path d="M47.07 54.64 L10.11 39.33" />
        <path d="M50.1 50.1 L21.82 21.82" />
        <path d="M54.64 47.07 L39.33 10.11" />
        <path d="M60 46 L60 6" />
        <path d="M65.36 47.07 L80.67 10.11" />
        <path d="M69.9 50.1 L98.18 21.82" />
        <path d="M72.93 54.64 L109.89 39.33" />
      </g>
    </svg>
  )
}

export type PaperCardProps = {
  name: string
  cost: number
  atk: number
  def: number
  /** 主题色，决定四角菱形、费用内圈、放射线和分隔线菱形的颜色。默认蓝 */
  accent?: PaperAccent
  /** 卡面中央的图标，正式项目里会换成 AI 生成的水彩 logo */
  icon?: PaperIconName
  selected?: boolean
  className?: string
}

/**
 * 150×210 的纸面卡框。
 *
 * 结构上是双线框（外框是元素自己的 border，内框是 .paper-card__frame 这个真实
 * 子元素）+ 四角菱形花饰 + 费用圆 + 放射线卡面 + 名称分隔线 + 底部攻防栏，
 * 整张卡叠 .grain 上纸纹。内框走真实元素而不是 ::before，是因为 .grain 已经
 * 把宿主的两个伪元素占用了。
 *
 * 三处图标故意用不同的 rough 编号（logo / 攻 / 防），同屏才不会歪成同一条线。
 */
export function PaperCard({
  name,
  cost,
  atk,
  def,
  accent = 'blue',
  icon = 'shield',
  selected,
  className = '',
}: PaperCardProps) {
  return (
    <div
      className={`paper-card grain ${selected ? 'paper-card--selected' : ''} ${className}`
        .replace(/\s+/g, ' ')
        .trim()}
      style={{ '--accent': ACCENT_VAR[accent] } as CSSProperties}
    >
      <i className="paper-card__frame" aria-hidden="true" />
      <i className="paper-card__corner paper-card__corner--tl" aria-hidden="true" />
      <i className="paper-card__corner paper-card__corner--tr" aria-hidden="true" />
      <i className="paper-card__corner paper-card__corner--bl" aria-hidden="true" />
      <i className="paper-card__corner paper-card__corner--br" aria-hidden="true" />

      <div className="paper-card__cost">{cost}</div>

      <div className="paper-card__art">
        <CardRays />
        <PaperIcon name={icon} rough={1} className="paper-card__logo" />
      </div>

      <div className="paper-card__name-wrap">
        <div className="paper-card__divider" aria-hidden="true">
          <i className="paper-card__divider-dia" />
        </div>
        <div className="paper-card__name">{name}</div>
      </div>

      <div className="paper-card__stats">
        <span className="paper-card__stat">
          <PaperIcon name="sword" size="sm" rough={2} />
          {atk}
        </span>
        <i className="paper-card__sep" aria-hidden="true" />
        <span className="paper-card__stat">
          <PaperIcon name="shield" size="sm" rough={3} />
          {def}
        </span>
      </div>
    </div>
  )
}
