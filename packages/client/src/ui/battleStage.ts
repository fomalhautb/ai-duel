/**
 * 16:9 舞台的坐标换算。对局页（.battle-scaler）和卡组页（.deck-scaler）共用这一套。
 *
 * 这两页的排版都永远按设计稿的 1672×941 走，整块画面再由缩放层上的 transform: scale()
 * 等比缩到窗口里（做法和理由见 styles.css 里"对局界面的 16:9 舞台"）。
 * 缩放层统一带一个 stage-scaler 类，下面几个函数就照它查，页面自己的类名只用来写样式。
 * 两页是两条路由，同一时刻 DOM 里只会有一个缩放层，所以查到第一个就是当前这页的。
 * 于是页面里同时存在两套长度：
 *
 * - **舞台内坐标**：CSS 写的、GSAP 的 x / y 写的、fanMath 算出来的，全是这一套，
 *   单位就是设计稿上的像素，和窗口大小无关；
 * - **视口坐标**：指针事件的 clientX / clientY、getBoundingClientRect 返回的矩形，
 *   全是缩放之后的屏幕像素。
 *
 * 两套之间差一个 scale 和一个原点偏移。凡是"拿视口坐标算出一个值，再写回 GSAP / CSS"的地方
 * 都必须过一次这里，否则窗口一旦不是设计尺寸，牌就跟不上光标、飞行就落不到格子上。
 * 反过来，纯粹拿视口坐标互相比较（比如判断指针落在哪个矩形里）不用换算。
 */

/** 设计稿尺寸，必须和 .battle-scaler（styles.css）、.deck-scaler（screens/deck.css）的 width / height 一致。 */
export const BATTLE_STAGE_WIDTH = 1672
export const BATTLE_STAGE_HEIGHT = 941

export interface BattleStageMetrics {
  /** 舞台左上角在视口里的位置（视口坐标）。 */
  left: number
  top: number
  /** 视口像素 ÷ 舞台内像素。窗口正好是设计尺寸时是 1。 */
  scale: number
}

/**
 * 量一次当前舞台。
 *
 * 每次现量而不是缓存：窗口大小、开发面板、浏览器缩放都会改这几个数，
 * 而调用点本来就都发生在指针事件或动画起手那一刻，一次 getBoundingClientRect 的开销可以忽略。
 *
 * 找不到舞台（手牌、拖拽这类组件被搬到别的页面上单独用）时退回"没有舞台"的口径：
 * 原点是视口左上角、scale 为 1，也就是改造之前的行为。
 * 视口宽高用 documentElement 的 clientWidth / clientHeight，因为它不含滚动条，
 * 和 clientX / clientY 以及 fixed 元素的百分比宽度是同一个矩形。
 */
export function battleStageMetrics(): BattleStageMetrics {
  const scaler = document.querySelector<HTMLElement>('.stage-scaler')
  if (scaler === null) {
    return { left: 0, top: 0, scale: 1 }
  }
  const rect = scaler.getBoundingClientRect()
  // 宽度为 0 说明舞台这一帧还没排版（刚挂载）。按 scale 1 处理，下一帧量到真值就对了。
  const scale = rect.width === 0 ? 1 : rect.width / BATTLE_STAGE_WIDTH
  return { left: rect.left, top: rect.top, scale }
}

/** 舞台的宽（舞台内坐标）。没有舞台时退回视口宽。 */
export function battleStageWidth(): number {
  return document.querySelector('.stage-scaler') === null
    ? document.documentElement.clientWidth
    : BATTLE_STAGE_WIDTH
}

/** 舞台的高（舞台内坐标）。没有舞台时退回视口高。 */
export function battleStageHeight(): number {
  return document.querySelector('.stage-scaler') === null
    ? document.documentElement.clientHeight
    : BATTLE_STAGE_HEIGHT
}

/** 把视口坐标里的一个点换算成舞台内坐标。 */
export function toStagePoint(
  clientX: number,
  clientY: number,
  metrics: BattleStageMetrics = battleStageMetrics(),
): { x: number; y: number } {
  return {
    x: (clientX - metrics.left) / metrics.scale,
    y: (clientY - metrics.top) / metrics.scale,
  }
}
