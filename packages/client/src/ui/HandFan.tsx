/**
 * 炉石式扇形手牌：纯 DOM + GSAP，没有画布。
 *
 * 组件只管"一排牌怎么摆、怎么 hover、点了通知谁"，不关心牌从哪来、打出去之后发生什么。
 * 打出的卡要飞到哪个容器由父组件决定（见 HandDemo 里的 Flip 用法），
 * 因为跨容器的 FLIP 必须由同时看得见"手牌"和"战场"的那一层来做。
 */

import { useEffect, useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)

/**
 * 一张手牌的展示数据。
 *
 * 字段照着 core 的 Card 取名，将来接真对局时可以直接从 Card + CardInstance 拼出来；
 * power/integrity 只有模型卡有，damage 只有提示卡有，所以都是可选的。
 *
 * 注意这里还缺核心机制要用的两项：模型卡的六维弱点画像（ModelCard.weaknesses）
 * 和提示卡的目标维度（PromptCard.targetWeakness）。卡面上现在也没有给它们留版面，
 * 接真对局时得先扩字段、再重排卡面，不是加两个 props 就完事。
 * backText 是演示用的占位文案，core 里没有对应字段。
 */
export interface HandCardData {
  id: string
  name: string
  cost: number
  kind: 'model' | 'prompt'
  power?: number
  integrity?: number
  damage?: number
  /** 卡面正面的描述文案。 */
  text: string
  /** 翻到背面时展示的补充说明。 */
  backText: string
}

export interface HandFanProps {
  cards: HandCardData[]
  /**
   * 玩家点了某张牌的卡面。父组件负责把这张牌从手牌里移走。
   *
   * 同步受理（当场改手牌数组）的话不用管防连点，这张牌会立刻从 DOM 里消失。
   * 要等网络回包再决定的话，请在等待期间把 disabled 打开：
   * HandFan 只挡得住"父组件没受理"之外的重复点击，挡不住异步确认那段空窗。
   */
  onPlay: (id: string) => void
  /** 为 true 时点击不出牌（比如不是自己的回合、正在等对方确认），但仍然可以 hover 看牌。 */
  disabled?: boolean
}

/**
 * 卡面基准尺寸，必须和 styles.css 里的 --card-w / --card-h 一致。
 * 不一致的后果不是"卡画歪了"这么简单：下面的 SINK 和 MIN_HOVER_SCALE 都按它算，
 * 对不上号 hover 防抖动的几何前提就不成立了。
 */
const CARD_WIDTH = 150
const CARD_HEIGHT = 210

/** 默认状态下卡牌沉到视口下方的高度：露出 85%，剩下的藏在屏幕外。 */
const SINK = Math.round(CARD_HEIGHT * 0.15)
/**
 * hover 时卡底仍然留在视口下方 6px。
 *
 * 这 6px 是防抖动的安全余量：back 缓动会冲过目标位再弹回来，
 * 冲过头的那一瞬间卡底会比目标位再高几个像素，留出余量才能保证卡底始终在视口外。
 */
const HOVER_BOTTOM = 6
/** 扇形下垂用的虚拟半径，越大弧线越平。 */
const ARC_RADIUS = 800
/** 手牌张开的总角度上限。 */
const MAX_SPREAD_DEG = 40
/** 每多一张牌多张开的角度，和上限一起决定小手牌不会张得太开。 */
const DEG_PER_CARD = 5
/** 每张牌理想的水平间距；卡宽 150，所以到这个间距时相邻卡已经互相压住一部分。 */
const GAP_PER_CARD = 95
/** 手牌总宽上限，超过就压缩间距让牌重叠。 */
const MAX_SPAN = 900
/**
 * 放大倍数的下限，由扇形最大倾角和卡面尺寸算出来，不是拍脑袋定的。
 *
 * 以底边中点为轴、倾斜 θ 的卡牌，最远的那个上角横向伸到
 * (卡宽/2)·cos θ + 卡高·sin θ。放大后的卡半宽必须够到这个距离，
 * 否则扇形两端那张牌的外上角会露在放大后的卡外面（40° 时露出约 11px，
 * 而且这一块正好在视口里）。指针停在那一小块上就会
 * 「放大 → 指针掉到卡外 → 缩回 → 又被 hover 到」无限循环，
 * LEAVE_DELAY_MS 只挡得住扫过去又折返的指针，挡不住停着不动的。
 * 写成公式而不是常数，是为了改 MAX_SPREAD_DEG 时不用手工重新对表。
 */
const MAX_TILT_RAD = ((MAX_SPREAD_DEG / 2) * Math.PI) / 180
const MIN_HOVER_SCALE =
  ((CARD_WIDTH / 2) * Math.cos(MAX_TILT_RAD) + CARD_HEIGHT * Math.sin(MAX_TILT_RAD)) / (CARD_WIDTH / 2)
/** hover 放大的倍数：想要 1.75，但不能低于上面那条几何下限（40° 时下限约 1.9）。 */
const HOVER_SCALE = Math.max(1.75, MIN_HOVER_SCALE)
/** 邻牌让位的幅度，按到 hover 卡的距离衰减；超出这个数组长度的牌不动。 */
const NEIGHBOR_PUSH = [60, 30, 12]
/** 重排（加牌/减牌/改窗口大小）的时长。 */
const LAYOUT_DUR = 0.4
/** hover 进出的时长，要比重排更干脆。 */
const HOVER_DUR = 0.28
/**
 * 指针离开卡牌后延迟这么久才缩回去。
 *
 * 几何上放大后的卡已经盖住了自己原来的位置（见 fanTransform 上方的说明），
 * 但补间途中卡还没长到最大，卡角附近会短暂空出几个像素。
 * 这点延迟让"扫过空档又立刻回来"的指针不会触发一次缩放，肉眼察觉不到延迟。
 */
const LEAVE_DELAY_MS = 50

/** hover 引起的补间要更快，重排则用统一的慢一点的节奏。 */
type LayoutMode = 'hover' | 'reflow'

interface SlotTransform {
  x: number
  y: number
  rotation: number
}

/**
 * 算出第 index 张牌在扇形里的基准位置。
 *
 * 坐标原点是"视口底边中点"，y 向下为正，旋转以卡牌底边中点为轴。
 * 以底边中点为轴是防抖动的第一步：hover 时只放大、只往上长，绝不往下移，
 * 卡底始终留在视口底边以下（默认沉 SINK，hover 时也还差 HOVER_BOTTOM）。
 * 第二步是 HOVER_SCALE 的下限（见常量区）：只有横向也盖过倾斜卡牌最远的那个角，
 * 放大后的卡才真的盖住了原来那张卡露在屏幕里的全部像素，
 * 指针不会因为卡变大而掉到卡外面，也就不会出现"放大→缩回→又放大"的循环。
 */
function fanTransform(index: number, count: number, viewportWidth: number): SlotTransform {
  if (count <= 1) return { x: 0, y: SINK, rotation: 0 }

  const spread = Math.min(MAX_SPREAD_DEG, count * DEG_PER_CARD)
  const rotation = -spread / 2 + (spread / (count - 1)) * index

  const span = Math.min(viewportWidth * 0.7, MAX_SPAN, count * GAP_PER_CARD)
  const gap = span / count
  const x = (index - (count - 1) / 2) * gap

  // 让扇形的两端往下垂，像一叠握在手里的牌，而不是排在一条直线上。
  const droop = ARC_RADIUS * (1 - Math.cos((rotation * Math.PI) / 180))
  return { x, y: SINK + droop, rotation }
}

export function HandFan({ cards, onPlay, disabled = false }: HandFanProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef(new Map<string, HTMLDivElement>())
  /** 当前被 hover 的牌。放在 ref 里而不是 state，避免每次移入移出都重渲染整排手牌。 */
  const hoverRef = useRef<string | null>(null)
  /** 上一次被 hover 的牌，用来让它缩回去的过程中先别掉到邻牌下面。 */
  const prevHoverRef = useRef<string | null>(null)
  /** 已经摆过位置的牌；不在这里面的是新加入的，要先放到起始位再补间进场。 */
  const placedRef = useRef(new Set<string>())
  /**
   * 已经点过、正在等父组件移走的牌，用来防连点。
   * 记录只在这张牌真的离开 cards（或者下一帧发现父组件根本没受理）时才删掉。
   */
  const playedRef = useRef(new Set<string>())
  const leaveTimerRef = useRef<number | null>(null)
  /** 给 resize 监听和延迟回位用：它们要拿到最新一次渲染的布局函数。 */
  const layoutRef = useRef<(mode: LayoutMode) => void>(() => {})

  const innerOf = (id: string) =>
    slotsRef.current.get(id)?.querySelector<HTMLElement>('.hand-fan__inner') ?? null
  const helpOf = (id: string) =>
    slotsRef.current.get(id)?.querySelector<HTMLElement>('.hand-fan__help') ?? null

  /** 把每张牌补间到它当前应该在的位置（基准位、被推开的位、或者放大的 hover 位）。 */
  const applyLayout = (mode: LayoutMode) => {
    const count = cards.length
    const viewportWidth = window.innerWidth
    const ids = new Set(cards.map((card) => card.id))

    if (mode === 'reflow') {
      // 只清理"已经不在手牌里"的记录。hover 期间调用得太频繁，不该顺手改这些状态。
      // 注意 reflow 也会被 resize 触发，所以这里不能把整份记录一股脑清空：
      // 拖一下窗口就把防连点的记录抹掉，同一张牌会被打出两次。
      if (hoverRef.current !== null && !ids.has(hoverRef.current)) hoverRef.current = null
      for (const id of placedRef.current) if (!ids.has(id)) placedRef.current.delete(id)
      for (const id of playedRef.current) if (!ids.has(id)) playedRef.current.delete(id)
    }

    const hoveredId = hoverRef.current
    const hoverIndex = hoveredId === null ? -1 : cards.findIndex((card) => card.id === hoveredId)

    cards.forEach((card, index) => {
      const slot = slotsRef.current.get(card.id)
      if (!slot) return

      const base = fanTransform(index, count, viewportWidth)
      const isHovered = index === hoverIndex
      const isNew = !placedRef.current.has(card.id)
      if (isNew) {
        placedRef.current.add(card.id)
        // 新牌从基准位下方淡入，看起来像从牌堆抽上来。
        // 这里用 opacity 而不是 autoAlpha：autoAlpha 会把 visibility 也改掉，
        // 万一补间被打断，牌就会一直是隐藏的。
        gsap.set(slot, {
          transformOrigin: '50% 100%',
          x: base.x,
          y: base.y + 140,
          rotation: base.rotation,
          scale: 0.85,
          opacity: 0,
        })
      }

      // 邻牌往远离 hover 卡的方向让开，幅度随距离衰减。
      let push = 0
      if (hoverIndex >= 0 && !isHovered) {
        const distance = Math.abs(index - hoverIndex)
        const amount = NEIGHBOR_PUSH[distance - 1] ?? 0
        push = index < hoverIndex ? -amount : amount
      }

      // 右边的牌压住左边的（和炉石一致），hover 的牌置顶。
      const baseZ = index + 1
      const isLeaving = !isHovered && prevHoverRef.current === card.id
      gsap.set(slot, { zIndex: isHovered ? 999 : isLeaving ? 900 : baseZ })

      const vars: gsap.TweenVars = isHovered
        ? { x: base.x, y: HOVER_BOTTOM, rotation: 0, scale: HOVER_SCALE }
        : { x: base.x + push, y: base.y, rotation: base.rotation, scale: 1 }
      vars.duration = mode === 'hover' ? HOVER_DUR : LAYOUT_DUR
      vars.ease = isHovered ? 'back.out(1.4)' : 'power3.out'
      // 快速扫过多张牌时，旧补间要被新补间干净地接管，不能各改各的。
      vars.overwrite = 'auto'
      if (isNew) vars.opacity = 1
      // 缩回去的过程中先顶在高层，落位了再掉回自己那一层，免得中途被邻牌盖住一下。
      if (isLeaving) vars.onComplete = () => gsap.set(slot, { zIndex: baseZ })
      gsap.to(slot, vars)

      const help = helpOf(card.id)
      // autoAlpha 到 0 会顺手把 visibility 关掉，问号跟着就不再吃指针事件。
      if (help) gsap.to(help, { autoAlpha: isHovered ? 1 : 0, duration: 0.2, overwrite: 'auto' })

      const inner = innerOf(card.id)
      // 离开 hover 时把翻到背面的牌转回正面；已经是正面就别白建一个补间。
      if (inner && !isHovered && Number(gsap.getProperty(inner, 'rotationY')) !== 0) {
        gsap.to(inner, { rotationY: 0, duration: 0.3, ease: 'power2.inOut', overwrite: 'auto' })
      }
    })

    prevHoverRef.current = hoveredId
  }

  const { contextSafe } = useGSAP(
    (_context, safe) => {
      // resize 监听和延迟回位都在这个回调之外触发，里面新建的补间默认不归 useGSAP 的
      // context 管，组件卸载时 revert 不掉，会继续去改已经脱离文档的节点。
      // 用 useGSAP 传进来的 contextSafe 包一层，它们就回到同一个 context 里了。
      layoutRef.current = safe ? safe(applyLayout) : applyLayout
      applyLayout('reflow')
      // 组件卸载时 useGSAP 会 revert 掉所有内联样式，这些"已经摆过位"的记录也得跟着清空，
      // 否则严格模式下的二次挂载会以为牌都摆好了，跳过进场那一步。
      return () => {
        placedRef.current.clear()
        prevHoverRef.current = null
      }
    },
    { scope: rootRef, dependencies: [cards] },
  )

  useEffect(() => {
    const onResize = () => layoutRef.current('reflow')
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current)
    }
  }, [])

  const cancelLeaveTimer = () => {
    if (leaveTimerRef.current === null) return
    clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = null
  }

  const handleEnter = contextSafe((id: string) => {
    cancelLeaveTimer()
    if (hoverRef.current === id) return
    hoverRef.current = id
    applyLayout('hover')
  })

  const handleLeave = contextSafe((id: string) => {
    if (hoverRef.current !== id) return
    cancelLeaveTimer()
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null
      // 这段延迟里指针可能已经移到别的牌上了，那时 hover 已经换人，这里就不该再动手。
      if (hoverRef.current !== id) return
      hoverRef.current = null
      layoutRef.current('hover')
    }, LEAVE_DELAY_MS)
  })

  const handleHelpEnter = contextSafe((id: string) => {
    const inner = innerOf(id)
    if (inner) gsap.to(inner, { rotationY: 180, duration: 0.4, ease: 'power2.inOut', overwrite: 'auto' })
  })

  const handleHelpLeave = contextSafe((id: string) => {
    const inner = innerOf(id)
    if (inner) gsap.to(inner, { rotationY: 0, duration: 0.4, ease: 'power2.inOut', overwrite: 'auto' })
  })

  const handleClick = (id: string) => {
    if (disabled || playedRef.current.has(id)) return
    const inner = innerOf(id)
    // 牌正翻着背面时点卡面不出牌：飞出去的小卡画的是正面，
    // 从背面直接跳成正面会闪一下，正好破坏"飞行途中前后是同一份排版"。
    // 指针离开问号后牌会自己转回正面，那时再点就行。
    if (inner && Math.abs(Number(gsap.getProperty(inner, 'rotationY'))) > 90) return

    playedRef.current.add(id)
    cancelLeaveTimer()
    hoverRef.current = null
    // 父组件在这一步里同步截取 Flip 状态，所以此刻 DOM 还必须是放大的 hover 样子。
    onPlay(id)
    // 出牌被受理的话，React 会在这一帧结束前把这张牌从 DOM 里摘掉，slotsRef 的记录跟着没。
    // 下一帧它还在，说明父组件没接受这次出牌（算力不够、不是自己的回合……），
    // 那就把防连点解除，否则这张牌会永远点不动——reflow 兜不住这条路，
    // 父组件拒绝时往往根本不改 state，也就不会有下一次 reflow。
    requestAnimationFrame(() => {
      if (slotsRef.current.has(id)) playedRef.current.delete(id)
    })
  }

  return (
    <div className="hand-fan" ref={rootRef}>
      {cards.map((card) => (
        <div
          key={card.id}
          className="hand-fan__slot"
          data-flip-id={card.id}
          ref={(el) => {
            if (el) slotsRef.current.set(card.id, el)
            else slotsRef.current.delete(card.id)
          }}
          onPointerEnter={() => handleEnter(card.id)}
          onPointerLeave={() => handleLeave(card.id)}
          onClick={() => handleClick(card.id)}
        >
          {/* 内层负责 3D 翻转，外层负责扇形摆位，两件事分开才不会互相覆盖 transform。 */}
          <div className="hand-fan__inner">
            <div className="hand-fan__face hand-fan__face--front">
              <HandCardFace card={card} />
            </div>
            <div className="hand-fan__face hand-fan__face--back">
              <div className="card-back">
                <span className="card-back__title">{card.name}</span>
                <p className="card-back__text">{card.backText}</p>
              </div>
            </div>
          </div>
          {/* 问号放在翻转层外面：翻到背面时它还在，指针一离开就能转回正面。 */}
          <button
            type="button"
            className="hand-fan__help"
            aria-label="查看卡牌详情"
            onPointerEnter={() => handleHelpEnter(card.id)}
            onPointerLeave={() => handleHelpLeave(card.id)}
            onClick={(event) => event.stopPropagation()}
          >
            ?
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * 卡牌正面。
 *
 * 战场上的小卡也用它渲染（外面套一个缩放容器），这样打出时的 FLIP 飞行里
 * 画面前后是同一份排版，落位时不会突然换一套内容。
 */
export function HandCardFace({ card }: { card: HandCardData }) {
  return (
    <div className={`card-face card-face--${card.kind}`}>
      <div className="card-face__cost">{card.cost}</div>
      <div className="card-face__art">{card.kind === 'model' ? '模型' : '提示'}</div>
      <div className="card-face__name">{card.name}</div>
      <p className="card-face__text">{card.text}</p>
      <div className="card-face__stats">
        {card.kind === 'model' ? (
          <>
            <span>算力 {card.power ?? 0}</span>
            <span>完整度 {card.integrity ?? 0}</span>
          </>
        ) : (
          <span>伤害 {card.damage ?? 0}</span>
        )}
      </div>
    </div>
  )
}
