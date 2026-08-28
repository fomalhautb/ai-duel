/**
 * 对手手牌的"隐藏牌背"：任何一张牌画出来都长得一模一样，看不出是什么牌。
 *
 * 和 .card-back 不是一回事，别拿那个顶替：那是玩家自己手牌翻面看详情用的**详情背面**，
 * 上面印着卡名和说明文字，用在对手手牌上等于把对方的手牌直接摊开。
 * 这里只有米白纸底 + 纸纹 + 一枚藏青徽记，一个字的牌面信息都不带。
 * 用浅色是为了在深蓝战场上看得清（配色理由见 styles.css 的 .card-back-hidden）。
 *
 * 徽记走 SVG 而不是背景图，是为了跟顶栏、雕花框一样吃 #ai-duel-rough-icon 那道手绘抖动滤镜，
 * 线条才和整页的水墨纸面对得上（滤镜定义由页面里的 HandDrawnFilterDefs 渲染一次）。
 */
export function CardBackHidden() {
  return (
    <div className="card-back-hidden" aria-hidden="true">
      <span className="card-back-hidden__rim" />
      <svg className="card-back-hidden__crest" viewBox="0 0 64 64">
        <polygon
          className="card-back-hidden__crest-outer"
          points="32,3 51,12 61,32 51,52 32,61 13,52 3,32 13,12"
        />
        <polygon className="card-back-hidden__crest-inner" points="32,15 49,32 32,49 15,32" />
        <path
          className="card-back-hidden__crest-spark"
          d="M32 21 L35.6 28.4 L43 32 L35.6 35.6 L32 43 L28.4 35.6 L21 32 L28.4 28.4 Z"
        />
      </svg>
    </div>
  )
}
