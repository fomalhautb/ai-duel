export type PaperCardBackProps = {
  /** 空槽形态：同一套结构整体退到「几乎不存在」，用在还没放牌的位置上 */
  slot?: boolean
  className?: string
}

/**
 * 卡背 / 空卡槽。两者是同一套 DOM，只靠 slot 切换：
 * 背景换成近乎透明的墨蓝、边框改虚线、罗盘不透明度从 0.62 降到 0.28。
 *
 * 实体卡背叠 .grain.on-dark（深色面上纸纹要换成提亮的那一份，否则墨蓝上
 * 会出现一块块黑斑）；空槽不叠——它本来就该淡到看不见，再加纹理只会变脏。
 *
 * 罗盘用 #ai-duel-rough-compass 而不是图标那几个滤镜：同心圆的线又长又细，
 * 位移放大一点就会被扯断，所以那个滤镜的 scale 特意压到 2。
 */
export function PaperCardBack({ slot, className = '' }: PaperCardBackProps) {
  return (
    <div
      className={`paper-back ${slot ? 'paper-back--slot' : 'grain on-dark'} ${className}`
        .replace(/\s+/g, ' ')
        .trim()}
    >
      <i className="paper-back__frame" aria-hidden="true" />
      <i className="paper-back__corner paper-back__corner--tl" aria-hidden="true" />
      <i className="paper-back__corner paper-back__corner--tr" aria-hidden="true" />
      <i className="paper-back__corner paper-back__corner--bl" aria-hidden="true" />
      <i className="paper-back__corner paper-back__corner--br" aria-hidden="true" />
      <svg
        className="paper-back__compass"
        viewBox="0 0 120 120"
        style={{ filter: 'var(--rough-compass)' }}
        aria-hidden="true"
      >
        <g fill="none" stroke="currentColor" strokeLinecap="round">
          <circle cx="60" cy="60" r="47" strokeWidth="1" />
          <circle cx="60" cy="60" r="42" strokeWidth="0.7" opacity="0.7" />
          <circle cx="60" cy="60" r="26" strokeWidth="0.8" opacity="0.85" />
          {/* 十字刻度 */}
          <path d="M60 6 L60 20 M60 100 L60 114 M6 60 L20 60 M100 60 L114 60" strokeWidth="1" />
          {/* 斜向短刻度 */}
          <g strokeWidth="0.7" opacity="0.75">
            <path d="M22 22 L31 31" />
            <path d="M98 22 L89 31" />
            <path d="M22 98 L31 89" />
            <path d="M98 98 L89 89" />
          </g>
          {/* 中央四角星 */}
          <path
            d="M60 26 C62.5 51 69 57.5 94 60 C69 62.5 62.5 69 60 94
               C57.5 69 51 62.5 26 60 C51 57.5 57.5 51 60 26 Z"
            strokeWidth="1"
            fill="currentColor"
            fillOpacity="0.13"
          />
        </g>
      </svg>
    </div>
  )
}
