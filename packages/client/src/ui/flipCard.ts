/**
 * 绕 Y 轴翻面的公共实现。手牌的"问号看详情"（HandFan）、对手牌的强制展示
 * （.reveal-card 那一层，眼下还没有页面用）和开局抛硬币的那枚圆片都走这里，
 * 几处的翻面观感和正反互斥逻辑必须完全一致。
 *
 * 翻面层的 DOM 约定：传进来的 inner 元素自己承担 rotationY，它下面必须各有一个
 * data-flip-face="front" / "back" 的子元素，两层完全重叠、靠 opacity 互斥。
 * 用 data 属性而不是类名当契约，是因为几处的样式类名都不一样
 * （.hand-fan__face / .reveal-card__face / .coin-toss__face），
 * 而"谁是正面谁是背面"这件事跟长什么样无关。
 *
 * 正反互斥**不能**交给 backface-visibility。Chrome 实测：静止时它判断得对，
 * 可一旦逐帧的 JS 补间跑起来，对合成层的朝向判断就失效了——转过 90° 之后正面不消失，
 * 连同水平镜像一起继续显示，直到补间结束那一刻才突然切成背面（"全程正面、结尾闪一下"）。
 * 卡面里那些被提成独立图层的子元素（absolute + z-index 的问号圆圈、
 * absolute + mix-blend-mode 的高光层）漏面也是同一族问题：它们逃出了所在 face 的拍扁，
 * face 上那份 backface-visibility 罩不住。逐个元素补一份 backface-visibility 补不完这类 bug，
 * 而且补上之后动画途中的误判还会和这里的 opacity 打架、闪烁，所以整条路都不走了。
 *
 * 现在的分工：立体旋转的观感仍然来自 rotationY 补间，谁可见则由角度驱动的 opacity 决定。
 * 角度归一到 [0, 360) 后落在 (90°, 270°) 区间就显示背面，否则显示正面。
 * 0/1 硬切、不做过渡：90° 时卡正好侧对观察者、投影宽度趋近于零，切换那一瞬间看不见。
 */

import gsap from 'gsap'

const FRONT_SELECTOR = '[data-flip-face="front"]'
const BACK_SELECTOR = '[data-flip-face="back"]'

/**
 * 按 inner 当前的实际角度，硬切正反两面的 opacity。
 *
 * 读的是元素**当前的实际角度**而不是补间进度，所以翻过去和翻回来是同一套逻辑，
 * 新补间接管旧补间时也不用额外记状态。
 *
 * 对外导出是给"自己写 rotationY 补间"的地方用的（抛硬币那种要连转数圈、
 * 还要和淡入淡出排进同一条时间线的场景，套不进下面 flipTo 的单条补间）：
 * 在自己那条补间的 onUpdate 里调一次，就能复用同一套硬切逻辑。
 */
export function syncFlipFaces(inner: HTMLElement) {
  const front = inner.querySelector<HTMLElement>(FRONT_SELECTOR)
  const back = inner.querySelector<HTMLElement>(BACK_SELECTOR)
  const angle = ((Number(gsap.getProperty(inner, 'rotationY')) % 360) + 360) % 360
  const showBack = angle > 90 && angle < 270
  // 每帧都要跑，所以直接写 style，不绕 gsap.set。
  if (front) front.style.opacity = showBack ? '0' : '1'
  if (back) back.style.opacity = showBack ? '1' : '0'
}

/**
 * 不补间、直接把翻面层摆到某个角度。
 *
 * 用来给"一上来就该是背面"的场景定初值（对手牌的展示卡就是这样起飞的）。
 * 必须走这里而不是裸 gsap.set：CSS 里正面的 opacity 默认是 1，
 * 只转角度不同步 opacity 的话，卡明明转到了背面那一侧，画面上还是一张镜像的正面。
 */
export function setFlipAngle(inner: HTMLElement, rotationY: number) {
  gsap.set(inner, { rotationY })
  syncFlipFaces(inner)
}

/**
 * 翻面：转动 inner 的 rotationY，同时在补间途中按当前角度硬切正反两面的 opacity。
 * 所有会动 inner 的 rotationY 的地方都必须走这个函数、setFlipAngle，
 * 或者自己在补间的 onUpdate 里调 syncFlipFaces，
 * 漏一处那张牌就会卡在正反都显示的样子。
 */
export function flipTo(inner: HTMLElement, rotationY: number, duration: number) {
  gsap.to(inner, {
    rotationY,
    duration,
    ease: 'power2.inOut',
    // 快速来回 hover 时，旧补间要被新补间干净地接管，不能各改各的。
    overwrite: 'auto',
    onUpdate: () => syncFlipFaces(inner),
  })
}
