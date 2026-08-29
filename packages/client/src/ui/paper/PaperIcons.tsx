/**
 * 纸面风格的手绘图标：一份 <symbol> 定义 + 一个引用它们的 <PaperIcon>。
 *
 * 图形全部来自设计参考页 /design（src/screens/DesignScreen.tsx）。描边写 currentColor，所以换色只要改
 * 外层容器的 color（卡牌里由 --accent 驱动）。每个图标都叠了第二条略微偏移、
 * 更细更淡的描边，模拟运笔时的重描；fill 用 currentColor 加 12%~28% 透明度，
 * 做「水彩没涂满」的效果。真正的歪扭来自 rough 属性挂上去的位移滤镜。
 */
export type PaperIconName = 'sword' | 'shield' | 'heart' | 'mana'
export type PaperIconSize = 'lg' | 'sm' | 'xs'
export type PaperIconRough = 1 | 2 | 3 | 4 | 'none'

/**
 * 四个图标的 <symbol> 定义。整页只渲染一次，放在 App / 页面根部，
 * 和 HandDrawnFilterDefs 一样：宽高为 0，不占布局空间。
 *
 * symbol id 加 ai-duel-i- 前缀，避免和 index.html、其他内联 SVG 里的 id 撞车——
 * SVG 的 id 是全文档共享的一个命名空间，撞了会静默引用到错误的图形。
 */
export function PaperIconDefs() {
  return (
    <svg className="paper-icon-defs" width="0" height="0" aria-hidden="true">
      <defs>
        <symbol id="ai-duel-i-sword" viewBox="0 0 48 48">
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M24 4.5 L28.5 12.5 L27.5 30 L20.5 30 L19.5 12.5 Z"
              fill="currentColor"
              fillOpacity="0.16"
            />
            <path d="M24.4 5.6 L28.9 13 L27.9 29.4" opacity="0.4" strokeWidth="1.2" />
            <path d="M13 31 L35 31" />
            <path d="M13.4 32.2 L34.6 32.1" opacity="0.35" strokeWidth="1.1" />
            <path d="M24 31 L24 39.5" />
            <circle cx="24" cy="42" r="2.6" fill="currentColor" fillOpacity="0.16" />
          </g>
        </symbol>

        <symbol id="ai-duel-i-shield" viewBox="0 0 48 48">
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M24 4.5 L40 10.8 L40 24 C40 34 33 40.5 24 43.5 C15 40.5 8 34 8 24 L8 10.8 Z"
              fill="currentColor"
              fillOpacity="0.15"
            />
            <path d="M24.6 5.8 L39 11.6 L39 23.8" opacity="0.38" strokeWidth="1.2" />
            <path d="M24 11 L24 36" opacity="0.5" strokeWidth="1.3" />
            <path d="M11.5 19.5 L36.5 19.5" opacity="0.5" strokeWidth="1.3" />
          </g>
        </symbol>

        <symbol id="ai-duel-i-heart" viewBox="0 0 48 48">
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M24 41.5 C24 41.5 6.5 30 6.5 18.5 C6.5 12 11.5 7.5 16.8 7.5 C20.3 7.5 23 9.7 24 12.4
                 C25 9.7 27.7 7.5 31.2 7.5 C36.5 7.5 41.5 12 41.5 18.5 C41.5 30 24 41.5 24 41.5 Z"
              fill="currentColor"
              fillOpacity="0.17"
            />
            <path d="M24.8 40.2 C29 37 39.6 28.6 40.2 18.8" opacity="0.35" strokeWidth="1.2" />
          </g>
        </symbol>

        <symbol id="ai-duel-i-mana" viewBox="0 0 48 48">
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="24" cy="24" r="16.5" fill="currentColor" fillOpacity="0.12" />
            <circle cx="24" cy="24" r="10.5" opacity="0.55" strokeWidth="1.3" />
            {/* 中央四角星 */}
            <path
              d="M24 11 C25.1 20 27.9 22.9 37 24 C27.9 25.1 25.1 27.9 24 37
                 C22.9 27.9 20.1 25.1 11 24 C20.1 22.9 22.9 20 24 11 Z"
              fill="currentColor"
              fillOpacity="0.28"
              strokeWidth="1.4"
            />
          </g>
        </symbol>
      </defs>
    </svg>
  )
}

/**
 * rough 编号 → HandDrawnFilterDefs 里的滤镜 id。
 *
 * 四个滤镜参数完全一样、只有 seed 不同，编号本身没有语义，作用是让同屏相邻的
 * 图标各歪各的：都用同一个 seed 的话，一排图标会歪成一模一样的形状，反而更假。
 */
const ROUGH_FILTER_ID: Record<Exclude<PaperIconRough, 'none'>, string> = {
  1: 'ai-duel-rough-icon',
  2: 'ai-duel-rough-button',
  3: 'ai-duel-rough-frame',
  4: 'ai-duel-rough-alt',
}

/** 尺寸档 → 修饰类。lg 是基准 48px，不需要额外类。 */
const SIZE_CLASS: Record<PaperIconSize, string> = {
  lg: '',
  sm: 'paper-ico--sm',
  xs: 'paper-ico--xs',
}

export type PaperIconProps = {
  name: PaperIconName
  /** lg = 48px（默认）、sm = 20px、xs = 15px */
  size?: PaperIconSize
  /** 手绘歪扭的抖法，四种只差 seed；'none' 完全不套滤镜（几何感更强） */
  rough?: PaperIconRough
  className?: string
}

/**
 * 引用 PaperIconDefs 里的一个图标。
 *
 * 用之前必须保证页面上已经渲染了 <PaperIconDefs />（手绘滤镜由 App 全局挂，不用管），
 * 否则 <use> 找不到 symbol（图标整个不显示）、filter 找不到定义（在 Chrome 上
 * 会把元素当成滤镜失败直接不画）。
 */
export function PaperIcon({ name, size = 'lg', rough = 1, className = '' }: PaperIconProps) {
  const sizeClass = SIZE_CLASS[size]
  return (
    <svg
      className={`paper-ico ${sizeClass} ${className}`.replace(/\s+/g, ' ').trim()}
      style={rough === 'none' ? undefined : { filter: `url(#${ROUGH_FILTER_ID[rough]})` }}
      aria-hidden="true"
    >
      <use href={`#ai-duel-i-${name}`} />
    </svg>
  )
}
