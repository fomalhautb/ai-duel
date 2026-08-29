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
 *
 * 新牌进场是"从侧栏那摞对方卡堆飞到自己的扇形槽位"，和玩家手牌是同一套机制
 *（起点由父组件通过 getDealOrigin 给，见 HandFanProps 上那几段说明）；
 * 这边不翻面——飞的本来就是牌背。
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { CardBackHidden } from './CardBackHidden'
import type { HandCardData } from './HandFan'
import { CARD_HEIGHT, CARD_WIDTH, LAYOUT_DUR, OPPONENT_FAN, fanTransform } from './fanMath'
import { prefersReducedMotion } from './reducedMotion'

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
 * 拿不到对方卡堆位置（或玩家要求减少动效）时的退路：新牌先在基准位再"沉"这么多，再滑进来。
 * 和玩家手牌用同一个量，两边抽牌的观感才是一套的。
 * 缩到 0.64 之后卡只剩 144 高，而基准位已经贴着视口顶边（sink 为 0），
 * 再沉 140 时整张牌的最低点还在视口顶边上方约 5px，连顶栏都不用帮忙挡，起点必然看不见。
 */
const ENTER_OFFSET = 140
/** 开局那几张牌依次起飞的间隔（秒）。和玩家手牌同一个值，两边发牌的节奏才是一套的。 */
const DEAL_STAGGER = 0.12

/** hover 引起的补间要更快，重排则用统一的慢一点的节奏。 */
type LayoutMode = 'hover' | 'reflow'

/**
 * 把对方卡堆在屏幕上的位置换算成 slot 的起始变换（发牌飞行的起点）。
 *
 * 整个锚点容器转了 180°，所以屏幕方向和 slot 坐标是**反**的：
 * slot 原点（锚点底边中点，转过来就是屏幕上锚点那条线的中点）往右是 x 减小、往下是 y 减小。
 * 变换原点仍是卡的底边中点，按 s 缩放之后卡心落在原点"上方" s × 卡高 / 2 处，
 * 转过来正好是屏幕上的下方，所以那一段要**加**回去（玩家手牌那边是减）。
 * anchorTop 是锚点那条线在视口里的 y（.opponent-fan 现在贴着视口顶边，也就是 0，
 * 但仍然现量一次，免得哪天它挪了位置这里跟着算错）。
 *
 * 旋转归零：屏幕上看这是"倒过来的"，可它此刻整个藏在左侧栏（z-index 30）后面，
 * 而这排牌画的又是正反几乎对称的隐藏牌背，飞出来时看不出朝向变过。
 * 换成从 180° 转到扇形角的话，整段飞行会多出一次没人要的翻滚。
 */
function dealStartVars(origin: DOMRect, anchorTop: number): gsap.TweenVars {
  const root = document.documentElement
  const shown = origin.width / CARD_WIDTH
  return {
    x: root.clientWidth / 2 - (origin.left + origin.width / 2),
    y: anchorTop - (origin.top + origin.height / 2) + (shown * CARD_HEIGHT) / 2,
    rotation: 0,
    scale: shown,
  }
}

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
  /**
   * 发牌飞行的起点：对方卡堆最上面那张牌此刻在屏幕上的位置（视口坐标）。
   * 语义和玩家手牌那边完全一样，见 HandFanProps.getDealOrigin。
   */
  getDealOrigin?: () => DOMRect | null
  /** 为 true 时新牌先压在卡堆上不动。见 HandFanProps.dealHold。 */
  dealHold?: boolean
  /** 还压在卡堆上、没起飞的新牌张数变了。见 HandFanProps.onDealPendingChange。 */
  onDealPendingChange?: (count: number) => void
}

export function OpponentFan({
  cards,
  onReveal,
  disabled = false,
  getDealOrigin,
  dealHold = false,
  onDealPendingChange,
}: OpponentFanProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef(new Map<string, HTMLDivElement>())
  /** 当前被 hover 的牌。放在 ref 里而不是 state，避免每次移入移出都重渲染整排手牌。 */
  const hoverRef = useRef<string | null>(null)
  /** 已经摆过位置的牌；不在这里面的是新加入的，要先放到起始位再补间进场。 */
  const placedRef = useRef(new Set<string>())
  /**
   * 发牌那三个 prop 的最新值。applyLayout 常常是上一次渲染留下的闭包，
   * 而 dealHold 变化时 cards 没变、闭包不会刷新，只能走 ref 拿当前值。
   */
  const dealHoldRef = useRef(dealHold)
  dealHoldRef.current = dealHold
  const dealOriginRef = useRef(getDealOrigin)
  dealOriginRef.current = getDealOrigin
  const dealPendingRef = useRef(onDealPendingChange)
  dealPendingRef.current = onDealPendingChange
  /** 还压在卡堆上、没起飞的新牌。size 就是报给父组件的张数，含义见 HandFan 的同名 ref。 */
  const dealQueueRef = useRef(new Set<string>())
  /** 已经排好队、还在等 stagger 延迟的进场补间。重排时要亲手换掉，理由见 HandFan 的同名 ref。 */
  const dealTweensRef = useRef(new Map<string, gsap.core.Tween>())
  /** 给 resize 监听用：它要拿到最新一次渲染的布局函数。 */
  const layoutRef = useRef<(mode: LayoutMode) => void>(() => {})

  /** 把"还压着几张"报给父组件。没人关心时什么都不做。 */
  const reportDealPending = () => dealPendingRef.current?.(dealQueueRef.current.size)

  /** 这张牌不再压在卡堆上了。重复调用是安全的，同 HandFan 的 finishDeal。 */
  const finishDeal = (id: string) => {
    dealTweensRef.current.delete(id)
    if (!dealQueueRef.current.delete(id)) return
    reportDealPending()
  }

  const applyLayout = (mode: LayoutMode) => {
    // 锚点 .opponent-fan 是 fixed + width: 100%，宽度就是初始包含块的宽（不含滚动条），别混用 innerWidth。
    // 这排牌可以按整个视口宽摊开：它贴在顶栏那条，左右侧栏够不到，不像玩家手牌那样要让着中栏
    //（玩家那边量的是战场中栏，见 HandFan 的 fanAreaWidth）。
    const viewportWidth = document.documentElement.clientWidth
    const count = cards.length
    // 减少动效时不做发牌飞行：新牌退回原来那段"从基准位外沉、淡入"，也不排队错开。
    const reduce = prefersReducedMotion()
    const dealOrigin = reduce ? null : (dealOriginRef.current?.() ?? null)
    // 锚点转过 180° 之后 x / y 的方向都反了，起点换算要用到它在视口里的那条线。
    const anchorTop = rootRef.current?.getBoundingClientRect().top ?? 0
    /** 这一轮排上队的新牌数；攒到最后统一报一次。 */
    let dealAdded = 0
    /** 这一轮真正安排起飞的第几张，决定各自的 stagger 延迟。 */
    let dealSeq = 0

    if (mode === 'reflow') {
      const ids = new Set(cards.map((card) => card.id))
      // 只清理"已经不在手牌里"的记录：被点走的那张牌，DOM 这一帧就没了，
      // hover 记录留着的话下一张顶上来的牌会莫名其妙带着抬起状态。
      if (hoverRef.current !== null && !ids.has(hoverRef.current)) hoverRef.current = null
      for (const id of placedRef.current) if (!ids.has(id)) placedRef.current.delete(id)
      // 还没起飞就离开手牌的：补间得亲手掐掉，否则它到点会去动一个已经被摘掉的节点。
      for (const id of dealQueueRef.current) {
        if (ids.has(id)) continue
        dealTweensRef.current.get(id)?.kill()
        finishDeal(id)
      }
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
        dealQueueRef.current.add(card.id)
        dealAdded += 1
        // 拿得到卡堆位置就从那儿起飞，拿不到就退回原来的"先退到视口外再滑进来"。
        // 从卡堆起飞的那张一开始就是不透明的：起点在左侧栏里，而侧栏（z-index 30）
        // 压在这排牌（20）之上，牌是从侧栏后面滑出来的，本来就看不见。
        // 淡入那条路用 opacity 而不是 autoAlpha：autoAlpha 会把 visibility 也改掉，
        // 万一补间被打断，牌就会一直是隐藏的。
        gsap.set(slot, {
          transformOrigin: '50% 100%',
          ...(dealOrigin === null
            ? { x, y: base.y + ENTER_OFFSET, rotation: base.rotation, scale: CARD_SCALE, opacity: 0 }
            : { ...dealStartVars(dealOrigin, anchorTop), opacity: 1 }),
        })
      }

      // 层级固定为"下标大的压住下标小的"，和玩家手牌同一个规则。
      // 牌背长得都一样，层级只影响相邻两张的压叠方向，hover 时也不改它。
      gsap.set(slot, { zIndex: index + 1 })

      /** 这张牌还在发牌队里：要么正压着卡堆等放行，要么这一轮该给它排一次起飞。 */
      const dealing = dealQueueRef.current.has(card.id)
      if (dealing && dealHoldRef.current) {
        // 过场（开局抛硬币）还盖着屏幕，这张牌先原地压在卡堆上，这一轮不给它任何补间。
        // 上一轮万一已经排过起飞（开局事件比第一次布局晚一拍到），那条补间还没跑过，
        // 得亲手掐掉并把牌退回卡堆位，否则它会在过场演着的时候自己跑起来。
        const scheduled = dealTweensRef.current.get(card.id)
        if (scheduled !== undefined) {
          scheduled.kill()
          dealTweensRef.current.delete(card.id)
          if (dealOrigin !== null) gsap.set(slot, dealStartVars(dealOrigin, anchorTop))
        }
        return
      }

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
      if (dealing) {
        // 上一条还没跑过的进场补间要亲手换掉（理由见 dealTweensRef）。
        const scheduled = dealTweensRef.current.get(card.id)
        if (scheduled !== undefined) {
          scheduled.kill()
          dealTweensRef.current.delete(card.id)
        }
        vars.delay = reduce ? 0 : dealSeq * DEAL_STAGGER
        dealSeq += 1
        // 起飞才算离开卡堆：延迟那段时间里牌还压在堆上，数字不能提前减。
        vars.onStart = () => finishDeal(card.id)
        // 从卡堆飞过来的那张一路都是不透明的，这一行是给"退回淡入"那条路准备的，
        // 两条路都要有，所以不管走哪条都补上。
        vars.opacity = 1
      }
      const tween = gsap.to(slot, vars)
      if (dealing) dealTweensRef.current.set(card.id, tween)
    })

    // 新排上队的牌攒到这儿一次报完，不用一张一张地惊动父组件。
    if (dealAdded > 0) reportDealPending()
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
        // 卸载时 useGSAP 会 revert 掉这些补间、onStart 再也不会跑，发牌的账得自己清干净。
        for (const tween of dealTweensRef.current.values()) tween.kill()
        dealTweensRef.current.clear()
        dealQueueRef.current.clear()
      }
    },
    { scope: rootRef, dependencies: [cards] },
  )

  useEffect(() => {
    const onResize = () => layoutRef.current('reflow')
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** 上一次的 dealHold，用来认出"憋着的发牌被放开"这一个瞬间。 */
  const prevDealHoldRef = useRef(dealHold)
  /**
   * 开局的抛硬币演完了：重排一次，把压在卡堆上的那几张牌依次放出去。
   * 只在这个值真的变了才动手，理由同 HandFan 的同一段。
   */
  useLayoutEffect(() => {
    if (prevDealHoldRef.current === dealHold) return
    prevDealHoldRef.current = dealHold
    layoutRef.current('reflow')
  }, [dealHold])

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
