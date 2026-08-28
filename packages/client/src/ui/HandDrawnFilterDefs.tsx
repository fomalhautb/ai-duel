/**
 * 视觉设计共用的手绘线条滤镜。
 *
 * 各滤镜使用相同的噪声尺度、不同的 seed，让相邻组件不会歪成同一条线。
 * 定义本身不占布局空间；页面只需要渲染一次，组件通过 CSS 的 url(#id) 使用。
 *
 * 噪声只叠两个八度。第三个八度的振幅只有第一个的四分之一，配上 scale≈3 的位移，
 * 落到画面上不到 ±0.4px，和"手绘的抖"分不出来；而 WebKit 是在 CPU 上逐像素算这条噪声的，
 * 少一个八度就省掉大约三分之一的计算量。
 */
export function HandDrawnFilterDefs() {
  return (
    <svg className="hand-drawn-filter-defs" width="0" height="0" aria-hidden="true">
      <defs>
        <filter id="ai-duel-rough-frame" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05"
            numOctaves="2"
            seed="23"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="3"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter id="ai-duel-rough-button" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05"
            numOctaves="2"
            seed="11"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="3.6"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter id="ai-duel-rough-icon" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05"
            numOctaves="2"
            seed="2"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="3.2"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}
