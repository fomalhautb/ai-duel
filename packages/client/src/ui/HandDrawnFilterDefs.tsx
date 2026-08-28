/**
 * 视觉设计共用的手绘线条滤镜。
 *
 * 各滤镜使用相同的噪声尺度、不同的 seed，让相邻组件不会歪成同一条线。
 * 定义本身不占布局空间；页面只需要渲染一次，组件通过 CSS 的 url(#id) 使用。
 *
 * 噪声只叠两个八度。第三个八度的振幅只有第一个的四分之一，配上 scale≈3 的位移，
 * 落到画面上不到 ±0.4px，和"手绘的抖"分不出来；而 WebKit 是在 CPU 上逐像素算这条噪声的，
 * 少一个八度就省掉大约三分之一的计算量。最初的设计稿里写的是三个八度，
 * 这里统一降到两个——新加滤镜也要照此办理，别按设计稿原样抄 numOctaves。
 *
 * 和设计稿的对应关系（设计稿里叫 rough-N，现在这套滤镜在 /design 页上能逐个看到）：
 *   icon    = rough-1（seed 2）    button = rough-2（seed 11）
 *   frame   = rough-3（seed 23）   alt    = rough-4（seed 37）
 *   rays / compass 同名。
 * PaperIcon 的 rough 属性 1|2|3|4 就是按这张表映射的。
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
        {/* 第四种抖法。上面三个 seed 分别是 2 / 11 / 23，同屏出现四个以上图标时
            （比如卡牌的费用、logo、攻、防）光靠三个会开始看出重复。 */}
        <filter id="ai-duel-rough-alt" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05"
            numOctaves="2"
            seed="37"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="3.4"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        {/*
         * 放射线 / 罗盘专用：图形本身更大、线更长更细，位移放大后容易被扯断，
         * 所以噪声频率调低（波长更长，一整段线一起歪，而不是沿线抖成锯齿）、
         * scale 也比图标那几个小。滤镜区域只放到 130%：这两个图形本来就快占满
         * 各自的 viewBox，边距留太多等于白算一圈透明像素。
         */}
        <filter id="ai-duel-rough-rays" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.035"
            numOctaves="2"
            seed="53"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="2.4"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter id="ai-duel-rough-compass" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.03"
            numOctaves="2"
            seed="71"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="2"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}
