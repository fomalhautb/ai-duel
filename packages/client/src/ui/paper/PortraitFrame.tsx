import type { ReactNode } from 'react'
import { PaperIcon } from './PaperIcons'

/**
 * 头像画面的默认占位：星图蓝底上几颗星点和连线。
 * 正式项目里 children 传 AI 生成的人物肖像，把它换掉。
 */
function StarsPlaceholder() {
  return (
    <svg
      className="paper-portrait__art"
      viewBox="0 0 140 180"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g fill="#e8e2cf">
        <circle cx="28" cy="34" r="1.5" opacity="0.9" />
        <circle cx="104" cy="26" r="1.1" opacity="0.7" />
        <circle cx="62" cy="18" r="1.8" opacity="0.85" />
        <circle cx="118" cy="66" r="1.3" opacity="0.6" />
        <circle cx="20" cy="88" r="1" opacity="0.55" />
        <circle cx="86" cy="52" r="1.2" opacity="0.75" />
        <circle cx="46" cy="70" r="0.9" opacity="0.5" />
        <circle cx="112" cy="118" r="1.4" opacity="0.7" />
        <circle cx="34" cy="132" r="1.1" opacity="0.6" />
        <circle cx="74" cy="104" r="1" opacity="0.5" />
      </g>
      <g stroke="#e8e2cf" strokeWidth="0.5" opacity="0.35" fill="none">
        <path d="M28 34 L62 18 L86 52 L28 34" />
        <path d="M112 118 L74 104 L34 132" />
      </g>
    </svg>
  )
}

export type PortraitFrameProps = {
  name: string
  hp: number
  mp: number
  /** 头像画面。缺省用星空占位；传入的元素要自己铺满拱窗（可挂 .paper-portrait__art） */
  children?: ReactNode
  className?: string
}

/**
 * 拱窗头像框：上两角 70px 圆角做成拱形，双线框跟着圆角内缩，
 * 底下压一块纸白名牌，再下面是生命 / 法力两个数。
 *
 * 名牌用负 margin 压在框底，靠 z-index 盖住拱窗的边框——它是从画框里探出来的
 * 一块铭牌，不是画框下面另起的一行。所以 .paper-portrait 必须 overflow: hidden
 * （画面不能溢出拱形），而名牌在它外面，才不会跟着被裁掉。
 */
export function PortraitFrame({ name, hp, mp, children, className = '' }: PortraitFrameProps) {
  return (
    <div className={`paper-portrait-wrap ${className}`.trim()}>
      <div className="paper-portrait">{children ?? <StarsPlaceholder />}</div>
      <div className="paper-nameplate">{name}</div>
      <div className="paper-portrait-stats">
        <span className="paper-portrait-stats__hp">
          <PaperIcon name="heart" size="xs" rough={3} />
          {hp}
        </span>
        <span className="paper-portrait-stats__mp">
          <PaperIcon name="mana" size="xs" rough={1} />
          {mp}
        </span>
      </div>
    </div>
  )
}
