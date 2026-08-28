/**
 * 对手的倒扇形手牌：吊在视口顶边、牌面朝下的一排牌背。
 *
 * 布局数学一个字都没重写，用的就是玩家手牌那一套（ui/fanMath.ts）：
 * 锚点 .opponent-fan 高度为 0、钉在视口顶边，内部 slot 仍然 bottom: 0、
 * 变换原点仍然是底边中点、y 仍然向下为正——然后给整个锚点容器来一个 rotate(180deg)。
 * 容器一转，"往下沉"就变成"往上沉"、"两端向下垂"就变成"两端向上垂"、卡面内容也自然倒了过来，
 * 正好是"对面那个人握着牌，我们从背后看"的样子。
 * 所以改这里的位置计算之前先想清楚：屏幕上的方向和代码里的 y 是反的
 * （代码里 y 减小 = 屏幕上往下走 = 往视口中央走）。
 * 唯一多出来的一笔是整排按 CARD_SCALE 缩了一号：卡面缩放和牌心间距（x）都乘这个系数，
 * 转角和下垂（rotation / y）不乘。它不属于布局数学，只是恒定跟在每次补间里。
 *
 * 交互只保留"能点"这一件事：没有 hover 放大、没有拖拽、没有问号热区。
 * 对手的牌本来就不该让玩家看清楚，放大和翻面都无从谈起；
 * 只留一点朝屏幕中心的抬起，表示这张牌是可以点的。
 *
 * 正式对局（MatchStage）把它渲染成恒 disabled 的一排：玩家点不动对手的手牌，
 * 这排扇形只干两件事——显示对手有几张牌，以及当对手出牌时强制展示的起飞点
 * （靠每张 slot 上的 data-flip-id 对号，见 MatchStage 的 startReveal）。
 * 能点的那条路眼下没有调用方，留着是因为它是这个组件本来的交互形态。
 */

import { useEffect, useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { CardBackHidden } from './CardBackHidden'
import type { HandCardData } from './HandFan'
import { LAYOUT_DUR, OPPONENT_FAN, fanTransform } from './fanMath'

gsap.registerPlugin(useGSAP)

/**
 * 对手手牌整体缩小的倍数。
 *
 * 对家的牌只是"看得出有几张、能点"，不需要看清内容，缩一号能给中间的战场让出更多画面。
 * 0.64 是玩家牌的 0.8 × 0.8：先前那一版按 0.8 缩过一次，实际摆上去还是偏大压画面，
 * 于是在它的基础上又收了一档，两次都是同一个比例，所以直接写成乘完的结果。
 * 缩放恒定写在每一次布局补间里（包括进场那一次），不写在 CSS 上：写 CSS 的话
 * GSAP 每帧覆盖 transform 就会把它冲掉。变换原点仍是底边中点，所以卡是朝屏幕内侧缩的，
 * 露出量的推导见 fanMath.ts 的 OPPONENT_FAN。
 */
const CARD_SCALE = 0.64
/**
 * hover 时朝屏幕中心（也就是向下）挪的像素数。
 *
 * 代码里的 y 向下为正，但容器整体转了 180°，所以"屏幕上往下"要**减** y。
 * 位移在父坐标系里，不跟着 CARD_SCALE 一起缩，所以整排每收紧一档，这里就要手动按同样的
 * 比例折算一次（10 × 0.8 = 8），抬起相对于缩小后的卡看起来才和以前一样明显。
 */
const HOVER_LIFT = 8
/** hover 进出的时长，要比重排更干脆。 */
const HOVER_DUR = 0.22
/**
 * 新牌进场的起始偏移：先在基准位再"沉"这么多，再滑进来。
 * 和玩家手牌用同一个量，两边抽牌的观感才是一套的。
 * 缩到 0.64 之后卡只剩 134.4 高，而基准位已经贴着视口顶边（sink 为 0），
 * 再沉 140 时整张牌的最低点还在视口顶边上方约 5px，连顶栏都不用帮忙挡，起点必然看不见。
 */
const ENTER_OFFSET = 140

/** hover 引起的补间要更快，重排则用统一的慢一点的节奏。 */
type LayoutMode = 'hover' | 'reflow'

export interface OpponentFanProps {
  cards: HandCardData[]
  /**
   * 玩家点了对手的某张牌。父组件负责把这张牌从对手手牌里移走、接着播强制展示。
   *
   * 组件自己不做"一次只能展示一张"的判重：那件事只有父组件知道（它管着展示状态），
   * 这里最多能挡住 disabled。
   */
  onReveal: (id: string) => void
  /** 为 true 时点不动、也不给 hover 反馈（比如正在强制展示另一张牌）。 */
  disabled?: boolean
}

export function OpponentFan({ cards, onReveal, disabled = false }: OpponentFanProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef(new Map<string, HTMLDivElement>())
  /** 当前被 hover 的牌。放在 ref 里而不是 state，避免每次移入移出都重渲染整排手牌。 */
  const hoverRef = useRef<string | null>(null)
  /** 已经摆过位置的牌；不在这里面的是新加入的，要先放到起始位再补间进场。 */
  const placedRef = useRef(new Set<string>())
  /** 给 resize 监听用：它要拿到最新一次渲染的布局函数。 */
  const layoutRef = useRef<(mode: LayoutMode) => void>(() => {})

  const applyLayout = (mode: LayoutMode) => {
    // 锚点 .opponent-fan 是 fixed + width: 100%，宽度就是初始包含块的宽（不含滚动条），别混用 innerWidth。
    // 这排牌可以按整个视口宽摊开：它贴在顶栏那条，左右侧栏够不到，不像玩家手牌那样要让着中栏
    //（玩家那边量的是战场中栏，见 HandFan 的 fanAreaWidth）。
    const viewportWidth = document.documentElement.clientWidth
    const count = cards.length

    if (mode === 'reflow') {
      const ids = new Set(cards.map((card) => card.id))
      // 只清理"已经不在手牌里"的记录：被点走的那张牌，DOM 这一帧就没了，
      // hover 记录留着的话下一张顶上来的牌会莫名其妙带着抬起状态。
      if (hoverRef.current !== null && !ids.has(hoverRef.current)) hoverRef.current = null
      for (const id of placedRef.current) if (!ids.has(id)) placedRef.current.delete(id)
    }

    cards.forEach((card, index) => {
      const slot = slotsRef.current.get(card.id)
      if (!slot) return

      const base = fanTransform(index, count, viewportWidth, OPPONENT_FAN)
      // 牌心间距跟着卡面一起收紧。缩放是以每张牌自己的底边中点为原点做的，只缩卡面不动 x，
      // 相邻两张之间就会平白多出空隙，一排牌从"叠在手里"散成"排在架子上"；乘上同一个系数，
      // 重叠比例才和缩放前一样。只有 x 乘：rotation 和 y（sink + 下垂）保持原样，
      // 扇形的张角和弧度不跟着缩小。算一次给下面两处补间共用，免得改一处漏一处。
      const x = base.x * CARD_SCALE
      const isNew = !placedRef.current.has(card.id)
      if (isNew) {
        placedRef.current.add(card.id)
        // 新牌先退到视口外再滑进来。这里用 opacity 而不是 autoAlpha：
        // autoAlpha 会把 visibility 也改掉，万一补间被打断，牌就会一直是隐藏的。
        gsap.set(slot, {
          transformOrigin: '50% 100%',
          x,
          y: base.y + ENTER_OFFSET,
          rotation: base.rotation,
          scale: CARD_SCALE,
          opacity: 0,
        })
      }

      // 层级固定为"下标大的压住下标小的"，和玩家手牌同一个规则。
      // 牌背长得都一样，层级只影响相邻两张的压叠方向，hover 时也不改它。
      gsap.set(slot, { zIndex: index + 1 })

      const lifted = !disabled && hoverRef.current === card.id
      const vars: gsap.TweenVars = {
        x,
        y: lifted ? base.y - HOVER_LIFT : base.y,
        rotation: base.rotation,
        // 缩放是个常数，但每次布局都跟着 x/y/rotation 一起写一遍：
        // 这条补间是 slot 上 transform 的唯一出处，少列一个属性就等于假设"没人会碰它"，
        // 哪天牌上多出别的补间，重排就再也纠不回原来的大小。
        scale: CARD_SCALE,
        duration: mode === 'hover' ? HOVER_DUR : LAYOUT_DUR,
        ease: mode === 'hover' ? 'power2.out' : 'power3.out',
        // 快速扫过多张牌时，旧补间要被新补间干净地接管，不能各改各的。
        overwrite: 'auto',
      }
      if (isNew) vars.opacity = 1
      gsap.to(slot, vars)
    })
  }

  const { contextSafe } = useGSAP(
    (_context, safe) => {
      // resize 监听在这个回调之外触发，里面新建的补间默认不归 useGSAP 的 context 管，
      // 组件卸载时 revert 不掉，会继续去改已经脱离文档的节点。用 contextSafe 包一层就回来了。
      layoutRef.current = safe ? safe(applyLayout) : applyLayout
      applyLayout('reflow')

      // 组件卸载时 useGSAP 会 revert 掉所有内联样式，"已经摆过位"的记录也得跟着清空，
      // 否则严格模式下的二次挂载会以为牌都摆好了，跳过进场那一步。
      return () => {
        placedRef.current.clear()
        hoverRef.current = null
      }
    },
    { scope: rootRef, dependencies: [cards] },
  )

  useEffect(() => {
    const onResize = () => layoutRef.current('reflow')
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleEnter = contextSafe((id: string) => {
    if (disabled || hoverRef.current === id) return
    hoverRef.current = id
    applyLayout('hover')
  })

  const handleLeave = contextSafe((id: string) => {
    if (hoverRef.current !== id) return
    hoverRef.current = null
    applyLayout('hover')
  })

  return (
    // data-disabled 只影响光标形状（见 styles.css）：点不动的牌不该给手指光标。
    <div className="opponent-fan" ref={rootRef} data-disabled={disabled ? 'true' : undefined}>
      {cards.map((card) => (
        <div
          key={card.id}
          className="opponent-fan__slot"
          // 强制展示是一次跨容器的 FLIP，父组件靠这个 id 把手牌里的这张和展示卡对上号。
          data-flip-id={card.id}
          ref={(el) => {
            if (el) slotsRef.current.set(card.id, el)
            else slotsRef.current.delete(card.id)
          }}
          onPointerEnter={() => handleEnter(card.id)}
          onPointerLeave={() => handleLeave(card.id)}
          onClick={() => {
            if (disabled) return
            onReveal(card.id)
          }}
        >
          <CardBackHidden />
        </div>
      ))}
    </div>
  )
}
