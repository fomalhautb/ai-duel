/**
 * 系统的「减少动效」开关，给 JS 里的动画用。
 *
 * CSS 那边的 @media (prefers-reduced-motion) 只管得到 CSS 过渡和 @keyframes，
 * GSAP 直接写进内联样式的位移它一点都拦不住，所以每处 JS 动画都得自己读一次这个开关让路。
 */

/**
 * 缓存的是 MediaQueryList 对象，不是布尔值：这个对象的 matches 会跟着系统设置实时变，
 * 每次现读它拿到的就是当前值（玩家开着页面改设置也算数），而 matchMedia() 不必反复建。
 *
 * 判 window 是给 node 环境留的：vitest 默认跑在 node 下，没有 window，
 * 模块一被 import 就会在这一行炸掉。那边本来也不放动画，当成"不需要减少动效"即可。
 */
const reduceMotionQuery =
  typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)')

/** 玩家是否要求减少动效。为真时动画要么整段跳过，要么把时长压到 0。 */
export function prefersReducedMotion(): boolean {
  return reduceMotionQuery?.matches ?? false
}
