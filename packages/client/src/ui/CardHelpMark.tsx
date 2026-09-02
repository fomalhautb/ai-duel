/**
 * 卡牌右上角那枚「看背面」的问号圆章。
 *
 * 只管样子：翻面的交互归各页自己那块透明热区（手牌是 .hand-fan__help，
 * 卡组页是 .deck-help），这枚圆章一律 pointer-events: none。
 * 拆成公共组件是因为对局手牌和卡组页的卡池卡 / 迷你卡画的是同一枚章，
 * 各写一份的话改了一处另一处就跟着走样。
 *
 * 图形用内联 SVG 而不是「?」这个字符：整套界面的线条都挂着手绘抖动滤镜
 * （见 ui/HandDrawnFilterDefs.tsx），字符画出来的是字体轮廓，位移滤镜作用在它上面会糊成一团。
 * 同理，外圈也不用 CSS 的 border——border 抖不起来，和圆章里的问号对不上。
 * 滤镜定义由 App 全局挂一份（见 ui/HandDrawnFilterDefs.tsx），使用方不用管；找不到定义时
 * Chrome 上整枚章都不画。
 *
 * 位置由调用方的类名给（各页的角落留白不一样），尺寸三处都是 22px（对局手牌、卡池卡、迷你卡
 * 共用同一块 1672×941 舞台，同数值就是同大小）。三处都常驻显示——问号是"这张牌能翻面"
 * 唯一的提示，藏到 hover 之后就等于没有；只管交互的热区仍然是 hover 才现身。
 * 这里只出公共的那层视觉：夜色圆底 + 米色线条，和卡角上另一颗圆钮（.deck-circle）同一副长相。
 */
export function CardHelpMark({ className }: { className: string }) {
  return (
    <span className={`card-help-mark ${className}`} aria-hidden="true">
      <svg className="card-help-mark__ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9.4" />
        {/* 问号的钩：从左侧起手绕过顶上一整圈（large-arc + sweep），落到圆弧底部再往下一竖。 */}
        <path d="M9 9.7 A3.1 3.1 0 1 1 12 13.2 L12 15.2" />
        {/* 下面那一点。填实而不是描边：0.85 半径的圆描出来是个小圆环，抖完更不像一个点。
            填色写在 .card-help-mark__dot 上，盖掉从外层 SVG 继承下来的 fill: none。 */}
        <circle className="card-help-mark__dot" cx="12" cy="17.6" r="0.85" />
      </svg>
    </span>
  )
}
