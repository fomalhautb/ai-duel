import type { ButtonHTMLAttributes, Ref } from 'react'

export type BackButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 按钮上的文字。默认「返回」，个别页面想写「返回大厅」之类的再传。 */
  label?: string
  /**
   * 拿到按钮节点。React 19 里 ref 就是普通 prop，跟着下面的展开一起传给 <button>，
   * 但 ButtonHTMLAttributes 不含它，得在这儿补一条类型。
   * /hero 的技能详情用它把焦点送进弹层。
   */
  ref?: Ref<HTMLButtonElement>
}

/**
 * 左上角那类「箭头 + 文字」的返回按钮，游戏内各页共用（/room、/hero、/deck）。
 *
 * 只负责排版（箭头和文字怎么摆、hover 时箭头往左挪一点、手绘抖动、焦点圈），
 * 定位、字号和颜色一律由使用方通过 className 决定——各页的返回按钮位置和配色都不一样，
 * 写进公共样式反而每个页面都要覆盖一遍。样式见 styles.css 的「可复用返回按钮」一节。
 *
 * 使用方所在的页面必须渲染过 <HandDrawnFilterDefs />，否则公共样式里的
 * filter: var(--rough-icon) 会指向一个不存在的滤镜（Chrome 上整颗按钮直接不画）。
 */
export function BackButton({ label = '返回', className = '', ...props }: BackButtonProps) {
  return (
    <button type="button" className={`ui-back ${className}`.trim()} {...props}>
      <BackArrow />
      {label}
    </button>
  )
}

/**
 * 返回箭头。用画的不用「←」：这个箭头在各家字体里长短粗细差得很远，落到兜底宋体上尤其难看。
 *
 * 描边取 currentColor，所以使用方只要改按钮的 color，箭头就跟着一起变（hover 变色同理）。
 *
 * 用这把细描边箭头，而不是 /room 原来那张切片素材（public/room/back-arrow.webp）上的
 * 粗实心箭头：那一版实心块在文字旁边太重，压过了「返回」两个字。素材图已经删掉。
 */
function BackArrow() {
  return (
    <svg
      className="ui-back__arrow"
      viewBox="0 0 23 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M22 7.5 H1.5" />
      <path d="M8 1.5 L1.5 7.5 L8 13.5" />
    </svg>
  )
}
