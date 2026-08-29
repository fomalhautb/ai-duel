/**
 * 教程引导层：压暗无关区域 + 给目标元素挖个洞 + 一句话提示气泡。
 *
 * 三条约定：
 *
 * - **整层默认不吃指针事件**。洞里的真实 UI 照常点得到、拖得动（手牌是 pointer capture，
 *   拖出洞也不受影响）；"这一步不许点什么"由 MatchStage 的限制负责，不靠遮罩挡。
 *   唯一的例外是 onNext 那几步：纯讲解的步骤本来就把界面锁死了，玩家没有别的可点，
 *   这时才铺一层点击捕获层接住"点任意处继续"。
 * - **只认语义锚点，不认坐标**。目标是一串 CSS 选择器（由控制器从步骤表换算出来），
 *   位置每帧现量，布局一动就跟着走。
 * - **层级放在 1000 档**：压过对局的常规 UI（≤90），但被全屏过场（1100）盖住——
 *   抛硬币、答题揭晓、技能抵消演的时候提示自然让位，不跟它们抢画面。
 *
 * 这一层必须挂在 `.battle` 里面（由 MatchStage 的 overlay 插槽渲染）：
 * `.battle-scaler` 有 transform，是个层叠上下文，挂在外面的话 1000 会盖到 1100 上去。
 * 同一个 transform 也让这里的 `position: fixed` 以舞台为包含块，所以下面所有坐标
 * 都写**舞台内坐标**（1672×941 那套），量到的视口矩形要先过一次 battleStage 的换算。
 *
 * 组牌页（`.deck-scaler`）走的是同一套：它带同一个 `stage-scaler` 类，换算完全一致。
 * 选英雄页没有缩放层——那一页的排版是 cqi，不做整体 scale——这时 battleStage 那几个函数
 * 自动退回"没有舞台"的口径（原点是视口左上角、scale 为 1、尺寸取视口），
 * 所以下面的舞台尺寸必须现查而不是用常量，否则在那一页会按 1672×941 去铺压暗块。
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { battleStageHeight, battleStageMetrics, battleStageWidth } from '../ui/battleStage'
import { prefersReducedMotion } from '../ui/reducedMotion'
import { dimRects } from './overlayGeometry'
import type { OverlayRect } from './overlayGeometry'
import './tutorial.css'

/** 洞比目标本身四边各放宽这么多（舞台内像素），免得描边正压在元素边缘上。 */
const HOLE_PADDING = 10
/** 提示气泡的宽度和它与洞之间的间距（舞台内像素）。 */
const TIP_WIDTH = 430
const TIP_GAP = 18
/** 气泡离舞台边至少留这么多，四角不会被切掉。 */
const TIP_MARGIN = 24
/** 气泡的估算高度，只用来判断"上面放不放得下"，真实高度由内容撑开。 */
const TIP_HEIGHT_GUESS = 84
/** 多出来的「下一步」按钮占的高度，气泡放在洞上方时要一起让开。 */
const TIP_NEXT_HEIGHT = 46

export interface TutorialOverlayProps {
  /** 一句话提示。null 或空串就不画气泡。 */
  instruction: string | null
  /** 要挖洞高亮的元素（CSS 选择器）。查不到的会被跳过。 */
  selectors: readonly string[]
  /** 压暗无关区域。第 3 轮的弱引导只描边不压暗（规格 §9）。 */
  dim: boolean
  /** 这一步的提示可以出场了（readyOn 都到齐）。为 false 时整层什么都不画。 */
  active: boolean
  /**
   * 这一步要玩家点一下才往前走，点了就调它。
   * null / 不传 = 这一步由对局流程或玩家的实际操作推进，不铺点击捕获层、也不画「下一步」。
   */
  onNext?: (() => void) | null
}

/** 舞台尺寸（舞台内坐标）。有缩放层时是设计稿尺寸，没有时就是视口尺寸。 */
interface StageSize {
  w: number
  h: number
}

export function TutorialOverlay({
  instruction,
  selectors,
  dim,
  active,
  onNext = null,
}: TutorialOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [holes, setHoles] = useState<OverlayRect[]>([])
  /**
   * 舞台多大也要跟着量：压暗块铺的是"舞台减去洞"，而选英雄页没有缩放层，
   * 那一页的舞台尺寸就是视口尺寸，会随窗口变。初值随便给，第一帧就会被量准。
   */
  const [stage, setStage] = useState<StageSize>({ w: 0, h: 0 })

  /**
   * 每帧量一次目标的位置。
   *
   * 不用 ResizeObserver / resize 监听：要跟的不只是窗口大小，还有手牌重排、卡牌飞行、
   * 侧栏数字变化这些由 GSAP 逐帧改出来的位移，只有跟着帧走才不会掉队。
   * 量完先比一遍，真的变了才 setState，静止时一次重渲染都不会发生。
   */
  useEffect(() => {
    if (!active) {
      setHoles((current) => (current.length === 0 ? current : []))
      return
    }
    let handle = 0
    let last = ''

    const measure = () => {
      handle = requestAnimationFrame(measure)
      const metrics = battleStageMetrics()
      const size: StageSize = { w: battleStageWidth(), h: battleStageHeight() }
      const next: OverlayRect[] = []
      for (const selector of selectors) {
        const node = document.querySelector<HTMLElement>(selector)
        if (node === null) continue
        const rect = anchorRect(node)
        if (rect === null) continue
        next.push({
          x: (rect.left - metrics.left) / metrics.scale - HOLE_PADDING,
          y: (rect.top - metrics.top) / metrics.scale - HOLE_PADDING,
          w: rect.width / metrics.scale + HOLE_PADDING * 2,
          h: rect.height / metrics.scale + HOLE_PADDING * 2,
        })
      }
      const signature = [
        `${size.w | 0}x${size.h | 0}`,
        ...next.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`),
      ].join('|')
      if (signature === last) return
      last = signature
      setStage(size)
      setHoles(next)
    }

    measure()
    return () => cancelAnimationFrame(handle)
    // selectors 每次渲染都是新数组，所以按内容比：内容没变就不该重启这条 rAF。
  }, [active, selectors.join('|')])

  const shades = active && dim ? dimRects(holes, stage.w, stage.h) : []
  const tip = active && instruction ? tipPosition(holes, stage, onNext !== null) : null

  /**
   * 描边的呼吸。只补间 opacity，位置归 React 的行内样式管，两边不抢同一个属性。
   * 依赖只列洞的个数：位置一变就重建补间的话，手牌重排期间会一直被打断。
   */
  useGSAP(
    () => {
      if (holes.length === 0 || prefersReducedMotion()) return
      gsap.fromTo(
        '.tutorial-overlay__ring',
        { opacity: 0.45 },
        {
          opacity: 1,
          duration: 0.85,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
          overwrite: 'auto',
        },
      )
    },
    { scope: rootRef, dependencies: [holes.length] },
  )

  /** 提示气泡换一句话就淡入一次。key 换新节点，上一句留下的内联样式跟着一起走。 */
  useGSAP(
    () => {
      if (tip === null || prefersReducedMotion()) return
      gsap.fromTo(
        '.tutorial-overlay__tip',
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, duration: 0.28, ease: 'power2.out', overwrite: 'auto' },
      )
    },
    { scope: rootRef, dependencies: [instruction] },
  )

  if (!active) return <div className="tutorial-overlay" ref={rootRef} aria-hidden="true" />

  return (
    <div className="tutorial-overlay" ref={rootRef}>
      {shades.map((rect, index) => (
        <div
          // 同下面的描边：按序号当 key，位置每帧都可能变，用位置当 key 会白白重建整批节点。
          key={index}
          className="tutorial-overlay__shade"
          style={rectStyle(rect)}
          aria-hidden="true"
        />
      ))}
      {holes.map((rect, index) => (
        <div
          // 按序号当 key：洞的位置每帧都可能变，用位置当 key 会每帧重建节点，
          // 呼吸补间刚挂上就被拆掉。个数不变时节点就稳定复用。
          key={index}
          className="tutorial-overlay__ring"
          style={rectStyle(rect)}
          aria-hidden="true"
        />
      ))}
      {onNext === null ? null : (
        // 「点任意处继续」的接盘手。铺在压暗块之上、气泡之下，和气泡是兄弟节点，
        // 所以点「下一步」按钮不会顺带触发这里（事件冒泡只往父节点走）。
        <div
          className="tutorial-overlay__catcher"
          onClick={onNext}
          // 键盘用户走气泡里那颗真按钮，这层只是给鼠标用的，别出现在辅助树里。
          aria-hidden="true"
        />
      )}
      {tip === null || instruction === null ? null : (
        <div
          className="tutorial-overlay__tip"
          style={{ left: `${tip.x}px`, top: `${tip.y}px`, width: `${TIP_WIDTH}px` }}
        >
          {/* 提示是给玩家读的，屏幕阅读器该念出来；换一句就重念一遍。 */}
          <p className="tutorial-overlay__text" role="status">
            {instruction}
          </p>
          {onNext === null ? null : (
            <button type="button" className="tutorial-overlay__next" onClick={onNext}>
              下一步 <span aria-hidden="true">▸</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** 视口坐标下的一个矩形。换算成舞台内坐标是调用处的事。 */
interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 量一个高亮目标占了视口里的哪一块，量不出来返回 null。
 *
 * 多一条"退到直接子元素的并集"是因为有的锚点自己是**零面积的定位基线**：
 * 手牌的 `data-tutorial-anchor="hand"` 挂在 `.hand-fan` 上，那个盒子宽一千来像素但高是 0，
 * 每张牌都靠绝对定位溢出摆出去（扇形几何是这么排的）。直接量容器只会得到零高矩形，
 * 按零面积跳过的话手牌那几步就永远挖不出洞，气泡只能退到"一个洞都没有"的兜底位。
 * 所以这里不动 `.hand-fan` 的布局，改成从孩子身上把这排牌实际占的地方拼出来。
 *
 * 只往下退一层，不递归：再往下会把卡面里每个小块都算进来，而这里要的就是"这排牌占多大地方"。
 * 子元素里同样零面积的（纯装饰的空节点之类）跳过；一个都没量到就当这个目标不存在。
 *
 * 最后再并进后代里标了 `data-tutorial-extend` 的元素：它们绝对定位到盒子外面，
 * getBoundingClientRect 量不到（目前只有触屏轻点选中后浮在卡**上方**的那颗「打出」）。
 * 不并进来的话，那颗按钮既在洞外被压暗层盖灰，又正好被提示气泡压住——气泡就贴着洞的
 * 上沿放，而按钮离卡顶只有 12px，比气泡还靠下。手机上出牌全靠它，挡住就等于卡住教程。
 */
function anchorRect(node: HTMLElement): ViewportRect | null {
  const boxes: DOMRect[] = []
  const own = node.getBoundingClientRect()
  if (own.width > 0 && own.height > 0) {
    boxes.push(own)
  } else {
    for (const child of Array.from(node.children)) {
      const box = child.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      boxes.push(box)
    }
  }
  // 溢出到盒子外面的那些（说明见上）。零面积的当作不存在，正在淡出的元素不会把洞撑歪。
  for (const extra of Array.from(node.querySelectorAll('[data-tutorial-extend]'))) {
    const box = extra.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    boxes.push(box)
  }
  if (boxes.length === 0) return null
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const box of boxes) {
    left = Math.min(left, box.left)
    top = Math.min(top, box.top)
    right = Math.max(right, box.right)
    bottom = Math.max(bottom, box.bottom)
  }
  return { left, top, width: right - left, height: bottom - top }
}

function rectStyle(rect: OverlayRect): CSSProperties {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
  }
}

/**
 * 气泡摆在哪：贴着第一个洞放，洞在上半屏就放它下面、在下半屏就放它上面，
 * 一个洞都没有时摆在舞台上方居中（那种步骤只压暗、不指具体元素）。
 * 最后统一夹回舞台内，靠边的目标不会把气泡挤出画面。
 *
 * `withNext` 说的是气泡里多了一颗「下一步」：往上放的时候要多让开这颗按钮的高度，
 * 否则气泡底边会压到它指着的那个洞上。
 */
function tipPosition(
  holes: readonly OverlayRect[],
  stage: StageSize,
  withNext: boolean,
): { x: number; y: number } {
  const height = TIP_HEIGHT_GUESS + (withNext ? TIP_NEXT_HEIGHT : 0)
  const anchor = holes[0]
  if (anchor === undefined) {
    return { x: (stage.w - TIP_WIDTH) / 2, y: stage.h * 0.18 }
  }
  const centerY = anchor.y + anchor.h / 2
  const below = centerY < stage.h / 2
  const rawY = below ? anchor.y + anchor.h + TIP_GAP : anchor.y - TIP_GAP - height
  const rawX = anchor.x + anchor.w / 2 - TIP_WIDTH / 2
  return {
    x: clamp(rawX, TIP_MARGIN, stage.w - TIP_WIDTH - TIP_MARGIN),
    y: clamp(rawY, TIP_MARGIN, stage.h - height - TIP_MARGIN),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
