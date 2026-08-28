/**
 * 纸面组件库的统一出口。
 *
 * 样式（paper.css）不在这里导入：它是全局 CSS，由 main.tsx 一次性引入，
 * 从组件里再 import 一遍会让样式的加载顺序取决于谁先被引用。
 *
 * 用这套组件的页面还要保证 <PaperIconDefs /> 和 <HandDrawnFilterDefs /> 各渲染一次，
 * 否则 <use> 找不到 symbol、CSS 里的 url(#...) 找不到滤镜。
 */
export { PaperIcon, PaperIconDefs } from './PaperIcons'
export type { PaperIconName, PaperIconProps, PaperIconRough, PaperIconSize } from './PaperIcons'

export { OrnateTitle } from './OrnateTitle'
export type { OrnateTitleProps } from './OrnateTitle'

export { PaperCard } from './PaperCard'
export type { PaperAccent, PaperCardProps } from './PaperCard'

export { PaperCardBack } from './PaperCardBack'
export type { PaperCardBackProps } from './PaperCardBack'

export { ManaMeter } from './ManaMeter'
export type { ManaMeterProps } from './ManaMeter'

export { TurnBadge } from './TurnBadge'
export type { TurnBadgeProps } from './TurnBadge'

export { PortraitFrame } from './PortraitFrame'
export type { PortraitFrameProps } from './PortraitFrame'

export { PaperTabs } from './PaperTabs'
export type { PaperTabsProps } from './PaperTabs'

export { PaperTuner } from './PaperTuner'
export type { PaperTunerProps } from './PaperTuner'
