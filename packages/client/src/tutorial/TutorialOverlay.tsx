/**
 * 教程引导层：压暗无关区域 + 给目标元素挖个洞 + 一句话提示气泡。
 *
 * 三条约定：
 *
 * - **整层不吃指针事件**。洞里的真实 UI 照常点得到、拖得动（手牌是 pointer capture，
 *   拖出洞也不受影响）；"这一步不许点什么"由 MatchStage 的限制负责，不靠遮罩挡。
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

export interface TutorialOverlayProps {
  /** 一句话提示。null 或空串就不画气泡。 */
  instruction: string | null
  /** 要挖洞高亮的元素（CSS 选择器）。查不到的会被跳过。 */
  selectors: readonly string[]
  /** 压暗无关区域。第 3 轮的弱引导只描边不压暗（规格 §9）。 */
  dim: boolean
  /** 这一步的提示可以出场了（readyOn 都到齐）。为 false 时整层什么都不画。 */
  active: boolean
}

/** 舞台尺寸（舞台内坐标）。有缩放层时是设计稿尺寸，没有时就是视口尺寸。 */
interface StageSize {
  w: number
  h: number
}

export function TutorialOverlay({ instruction, selectors, dim, active }: TutorialOverlayProps) {
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
        const rect = node.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
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
  const tip = active && instruction ? tipPosition(holes, stage) : null

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
      {tip === null || instruction === null ? null : (
        <p
          className="tutorial-overlay__tip"
          style={{ left: `${tip.x}px`, top: `${tip.y}px`, width: `${TIP_WIDTH}px` }}
          // 提示是给玩家读的，屏幕阅读器该念出来；换一句就重念一遍。
          role="status"
        >
          {instruction}
        </p>
      )}
    </div>
  )
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
 */
function tipPosition(holes: readonly OverlayRect[], stage: StageSize): { x: number; y: number } {
  const anchor = holes[0]
  if (anchor === undefined) {
    return { x: (stage.w - TIP_WIDTH) / 2, y: stage.h * 0.18 }
  }
  const centerY = anchor.y + anchor.h / 2
  const below = centerY < stage.h / 2
  const rawY = below ? anchor.y + anchor.h + TIP_GAP : anchor.y - TIP_GAP - TIP_HEIGHT_GUESS
  const rawX = anchor.x + anchor.w / 2 - TIP_WIDTH / 2
  return {
    x: clamp(rawX, TIP_MARGIN, stage.w - TIP_WIDTH - TIP_MARGIN),
    y: clamp(rawY, TIP_MARGIN, stage.h - TIP_HEIGHT_GUESS - TIP_MARGIN),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
