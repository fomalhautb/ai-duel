/**
 * 卡牌放大查看：点开一张卡，遮罩淡入，卡从原位 Flip 飞到屏幕中央放大，落位后轻轻上下浮动；
 * 点遮罩（放大期间点屏幕任意处都会落在遮罩上）再飞回原位、遮罩淡出。
 *
 * 组件**不**持有"现在看的是哪张"这份状态：调用方通常还要拿它把原位那个元素藏起来
 * （不然屏幕中央和原位会同时出现两张一模一样的卡），状态归调用方才能和"隐藏原位"
 * 落在同一次 React 提交里，中间不会闪一帧两张卡。组件只在 target 变化的那次提交里补动画。
 *
 * 屏幕中央那套 DOM 和样式（.reveal-overlay / .reveal-clip / .reveal-card）与 MatchStage 的
 * 强制展示 / 放大查看共用，见 styles.css 的「屏幕中央的展示层」一节。
 *
 * 但代码眼下没共用：MatchStage 自己内联了一份同样的结构和同样数值的时长 / 缓动 / 层级常量
 * （OVERLAY_IN_DUR、REVEAL_IN_DUR、REVEAL_FLIGHT_Z……），新对局流程刚落地，还没迁到这里来。
 * 所以改本文件这批常量时要连 MatchStage 那份一起改，否则同一个展示层会演出两种观感。
 * 现在只有 /deck 用这个组件。
 */

import { useEffect, useImperativeHandle, useRef } from 'react'
import type { ReactNode, Ref, RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { HandCardFace } from './HandFan'
import type { HandCardData } from './HandFan'
import { setFlipAngle } from './flipCard'

gsap.registerPlugin(useGSAP, Flip)

/** 遮罩淡入 / 淡出。淡出比淡入慢一点，让"看完了"这一下收得柔和些。 */
export const VEIL_IN_DUR = 0.25
export const VEIL_OUT_DUR = 0.3
/** 卡飞进展示位的时长。强制展示的翻面补间也用这个值，落位和翻正正好一起收。 */
export const ZOOM_IN_DUR = 0.55
/** 卡离开展示位（飞回原位、或强制展示接着飞向战场）的时长。 */
export const ZOOM_OUT_DUR = 0.6
/** 飞进 / 飞出展示位的缓动。进来用 inOut 更重的那条，停下的那一下才有分量。 */
export const ZOOM_IN_EASE = 'power3.inOut'
export const ZOOM_OUT_EASE = 'power2.inOut'
/**
 * 离开展示位那段飞行的层级：必须压过遮罩（.reveal-overlay 是 1100），
 * 不然卡会被正在淡出的遮罩糊住。
 */
export const ZOOM_FLIGHT_Z = 1200

/**
 * 遮罩淡入。**所有**改这块遮罩的补间都必须走这里或 fadeVeilOut，一律 overwrite: 'auto'。
 *
 * 遮罩是常驻节点，可能同时有两条链路想改它：比如刚点关闭、飞回的淡出还在跑（0.3s），
 * 对手就出了牌，强制展示的淡入随即起跑。默认不 overwrite 的话两条一起改 autoAlpha，
 * 后结束的那条说了算——淡出赢了遮罩就停在 0（visibility: hidden），强制展示期间玩家能点穿遮罩。
 * 让新补间干净接管旧的就没有这回事。
 *
 * 用 autoAlpha 而不是 opacity：它顺手改 visibility，遮罩看不见时就不吃指针事件。
 */
export function fadeVeilIn(veil: HTMLElement): void {
  gsap.to(veil, { autoAlpha: 1, duration: VEIL_IN_DUR, ease: 'power2.out', overwrite: 'auto' })
}

/** 遮罩淡出。overwrite 和 autoAlpha 的理由同 fadeVeilIn。 */
export function fadeVeilOut(veil: HTMLElement, onComplete?: () => void): void {
  gsap.to(veil, {
    autoAlpha: 0,
    duration: VEIL_OUT_DUR,
    ease: 'power2.in',
    overwrite: 'auto',
    onComplete,
  })
}

/**
 * 停留期间极轻微的上下浮动，免得画面完全定住像卡住了。
 *
 * 浮动写在展示卡自己的 y 上没问题：Flip 落位时已经把飞行用的内联 transform 收干净了，
 * 收尾时也会先 kill 掉这条补间再取位置，两者不会抢同一个属性。
 * 返回补间是为了让调用方收尾时 kill——不停的话它会继续去改一个马上要卸载的节点。
 */
export function startZoomFloat(card: HTMLElement): gsap.core.Tween {
  return gsap.to(card, { y: '-=8', duration: 1.15, repeat: -1, yoyo: true, ease: 'sine.inOut' })
}

export interface ShowcaseCardProps {
  card: HandCardData
  /**
   * Flip 的配对键，必须和起点 / 落点元素的 data-flip-id 一致：
   * 跨容器 FLIP 时新旧节点根本不是同一个元素，Flip 靠这个属性把它们对上号。
   */
  flipId: string
  /** 裁剪层，撤裁剪要用（见 .reveal-clip 的 CSS 注释）。 */
  clipRef?: Ref<HTMLDivElement>
  /** 展示卡本体：飞行、浮动、取飞回起点都对着它。 */
  cardRef?: Ref<HTMLDivElement>
  /**
   * 背面内容。只有整段要翻面的链路才传（强制展示：牌背朝上飞过来的路上翻正）；
   * 不传就不渲染背面那一层——放大查看的卡本来就正面朝上，整段不翻面。
   */
  back?: ReactNode
}

/**
 * 屏幕中央那张放大的展示卡。强制展示和放大查看共用同一份结构，
 * 因为 Flip 量的是真实 DOM，两条链路的卡长得不一样的话飞行的落点就不一样。
 */
export function ShowcaseCard({ card, flipId, clipRef, cardRef, back }: ShowcaseCardProps) {
  return (
    <div className="reveal-clip" ref={clipRef}>
      <div className="reveal-card" ref={cardRef} data-flip-id={flipId}>
        {/* 翻面层，结构和手牌一致：两面重叠、由 flipTo 按角度切 opacity（见 ui/flipCard.ts）。 */}
        <div className="reveal-card__inner">
          <div className="reveal-card__face" data-flip-face="front">
            {/* 卡面布局尺寸仍是 150×225，靠这一层整体放大，字和描边才一起变大而不是被拉伸。 */}
            <div className="reveal-card__scale">
              <HandCardFace card={card} />
            </div>
          </div>
          {back == null ? null : (
            <div className="reveal-card__face reveal-card__face--back" data-flip-face="back">
              <div className="reveal-card__scale">{back}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 正在放大查看的那张卡。 */
export interface CardZoomTarget {
  card: HandCardData
  /**
   * Flip 配对键，同 ShowcaseCardProps.flipId：必须等于原位元素的 data-flip-id。
   */
  flipId: string
  /**
   * 取"飞回去的那个元素"。写成函数而不是直接传元素：飞回时原位那个节点很可能已经被 React
   * 换成新的了（列表重排、数值变化都会重渲染），存着旧引用就会把卡补间到一个脱离文档的
   * 元素上，画面上什么都不动。所以每次要用时现查。
   */
  getOrigin: () => HTMLElement | null
}

export interface CardZoomHandle {
  /**
   * 截下起飞位置。必须在调用方把原位元素隐藏**之前**同步调用——那一刻量到的才是卡真正的起点。
   * 调完要紧接着把 target 设上，否则这份状态会一直挂着（hasPendingFlip 恒为 true）。
   */
  captureOrigin: (origin: Element) => void
  /**
   * 请求关闭（点遮罩、ESC）。组件先量下展示卡此刻的位置当飞回的起点，再回调 onClose；
   * 飞入还没落位、以及已经在飞回路上时不受理。
   */
  requestClose: () => void
  /**
   * 立即中止：停浮动、丢掉飞回、回调 onClose，但**不播飞回、也不淡出遮罩**。
   * 给"别的链路要抢这块遮罩、等不了飞回那 0.6 秒"的场景用，遮罩交给抢占方接着淡入。
   */
  abort: () => void
  /**
   * 还有没有截下来、没交给 Flip 的飞行状态（飞入或飞回）。
   *
   * 抢占方（abort 的调用方）要先问一下：这一拍是"点击已经受理、对应的 effect 还没跑"的中间态，
   * 此时抢过去就把那份状态丢了，卡会留在半路。
   */
  hasPendingFlip: () => boolean
}

export interface CardZoomOverlayProps {
  /** 正在放大的卡；null = 关闭。对象身份要稳定（useMemo / useState 持有），变一次就补一段动画。 */
  target: CardZoomTarget | null
  /** 组件要求调用方把 target 置空。requestClose / abort / ESC 都会调，调用方必须真的清掉。 */
  onClose: () => void
  /**
   * 外部遮罩节点。传了就补间它、组件不再自己渲染遮罩（点击关闭也得由外部那块自己接，
   * 转手调 requestClose）。
   *
   * 为什么要开这个口子：同一页里再有第二条动遮罩的链路（对局的强制展示就是），两条必须共用
   * **同一个**常驻遮罩节点，靠 overwrite: 'auto' 互相接管（见 fadeVeilIn 的说明）。各渲染一块
   * 的话，两块都是 z-index 1100 的全屏压暗层，交替时会同时半透明可见 = 压暗和模糊翻倍；
   * 更要命的是 abort()：它按约定不淡出遮罩，因为紧接着的那条链路会用同一条补间把同一个节点
   * 接管过去继续压暗——换成两块遮罩，被抢占的那块就再没人管，会永远停在全黑上吃掉所有点击。
   *
   * 对局侧暂未接入（MatchStage 眼下自己内联了展示层），等新流程稳定后迁移；这个口子先留着，
   * 现在唯一的调用方 /deck 只有一条链路，所以不传，用组件自带的那块遮罩。
   */
  veilRef?: RefObject<HTMLElement | null>
  /** 按 ESC 关闭。默认关：对局侧接进来时不该凭空多出一个 ESC 行为（强制展示本来就不给跳过）。 */
  closeOnEscape?: boolean
  ref?: Ref<CardZoomHandle>
}

export function CardZoomOverlay({
  target,
  onClose,
  veilRef,
  closeOnEscape = false,
  ref,
}: CardZoomOverlayProps) {
  const clipRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  /** 组件自带的遮罩。只有没传 veilRef 时才渲染，见 CardZoomOverlayProps.veilRef。 */
  const ownVeilRef = useRef<HTMLDivElement>(null)
  /** 待播的"飞进展示位"，记的是原位元素起飞前的位置。 */
  const flipInRef = useRef<Flip.FlipState | null>(null)
  /**
   * 待播的"飞回原位"。要连 getOrigin 一起存：展示卡马上就被摘掉了，
   * 而落点是调用方那边刚恢复可见的新节点，只能现查。
   */
  const flipBackRef = useRef<{ state: Flip.FlipState; getOrigin: () => HTMLElement | null } | null>(
    null,
  )
  /**
   * 卡是否已经飞到位。飞入途中的关闭一律忽略：半路把飞入换成飞回，起点就是一个还在被 Flip
   * 改写的元素，容易留下收不干净的补间。
   */
  const heldRef = useRef(false)
  /** 停留期间的呼吸浮动，收尾时要停掉，免得它继续改一个马上要卸载的节点。 */
  const floatRef = useRef<gsap.core.Tween | null>(null)
  /**
   * target 的同步副本。
   *
   * requestClose / abort 可能是从 React 之外的回调里调进来的（对局侧接进来会是对局事件回调），
   * 那时调用方刚 setState 还没提交，读 props 拿到的是上一次渲染的旧值。所以关闭时在这里
   * 先一步置空，判"还开着吗"一律读它。
   */
  const targetRef = useRef<CardZoomTarget | null>(target)
  targetRef.current = target

  /** 遮罩：外部传了就用外部那块，否则用自带的。 */
  const resolveVeil = (): HTMLElement | null => veilRef?.current ?? ownVeilRef.current

  const requestClose = () => {
    if (targetRef.current === null || !heldRef.current || flipBackRef.current !== null) return
    heldRef.current = false
    floatRef.current?.kill()
    floatRef.current = null
    const el = cardRef.current
    // 趁展示卡还在屏幕中央、还没被调用方摘掉，量下它此刻的位置当飞回的起点。
    if (el !== null) {
      flipBackRef.current = { state: Flip.getState(el), getOrigin: targetRef.current.getOrigin }
    }
    targetRef.current = null
    onClose()
  }
  /** ESC 监听里要调最新的那份 requestClose，但它每次渲染都是新函数，进依赖会让监听每帧重挂。 */
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose

  useImperativeHandle(ref, () => ({
    captureOrigin: (origin: Element) => {
      flipInRef.current = Flip.getState(origin)
    },
    requestClose,
    abort: () => {
      if (targetRef.current === null) return
      heldRef.current = false
      floatRef.current?.kill()
      floatRef.current = null
      flipBackRef.current = null
      targetRef.current = null
      onClose()
    },
    hasPendingFlip: () => flipInRef.current !== null || flipBackRef.current !== null,
  }))

  useEffect(() => {
    if (!closeOnEscape || target === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      requestCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeOnEscape, target])

  // 两个分支各管一程：target 从空变成有牌时飞进展示位，从有牌变回空时飞回原位。
  useGSAP(
    (_context, safe) => {
      const pending = flipInRef.current
      if (pending !== null && target !== null) {
        flipInRef.current = null
        const card = cardRef.current
        const veil = resolveVeil()
        if (card === null || veil === null) return

        fadeVeilIn(veil)

        // 卡本来就正面朝上，这条链路整段不翻面，直接把翻面层定死在正面。
        // 仍然走 setFlipAngle 而不是裸 gsap.set：正反两面谁可见是由角度切 opacity 决定的。
        const inner = card.querySelector<HTMLElement>('.reveal-card__inner')
        if (inner !== null) setFlipAngle(inner, 0)

        // 裁剪层直接撤掉。那份裁剪是给"从顶栏后面起飞"的卡准备的（见 .reveal-clip），
        // 放大查看的起点整个在顶栏下方，从头到尾用不着；留着反而会在呼吸浮动擦到顶栏
        // 那条线时把卡裁掉一截。
        const clip = clipRef.current
        if (clip !== null) gsap.set(clip, { clipPath: 'none' })

        // onComplete 是飞完才跑的，出了 useGSAP 回调的同步区间，
        // 里面新建的浮动补间不包一层就不归 context 管，组件卸载时 revert 不掉。
        const landed = () => {
          // 飞到一半被 abort 掉的话这段飞行并不会被 kill（卡已经脱离文档，改它也画不出来），
          // onComplete 照样会在 0.55 秒后跑一次。那时再起一条浮动就是往一个死节点上挂补间，
          // 还会把 floatRef 占住（下一次真正的收尾就 kill 错了对象），所以认一下卡还是不是当前那张。
          if (cardRef.current !== card) return
          heldRef.current = true
          floatRef.current = startZoomFloat(card)
        }

        Flip.from(pending, {
          targets: card,
          duration: ZOOM_IN_DUR,
          ease: ZOOM_IN_EASE,
          // 用 scale 而不是 width/height，卡面里的字会跟着一起放大，看起来才像同一张卡在变大。
          scale: true,
          onComplete: safe ? safe(landed) : landed,
        })
        return
      }

      const back = flipBackRef.current
      if (back === null || target !== null) return
      flipBackRef.current = null
      const veil = resolveVeil()
      if (veil === null) return
      fadeVeilOut(veil)
      // 原位那个元素此刻已经跟着调用方的状态恢复可见了。useGSAP 是 layout effect，
      // 恢复可见和 Flip 把它摆到起飞位置发生在同一次绘制之前，中间不会闪一下。
      const origin = back.getOrigin()
      if (origin === null) return
      Flip.from(back.state, {
        targets: origin,
        duration: ZOOM_OUT_DUR,
        ease: ZOOM_OUT_EASE,
        scale: true,
        // 层级必须给：飞回途中要压过正在淡出的遮罩。
        zIndex: ZOOM_FLIGHT_Z,
      })
    },
    { dependencies: [target] },
  )

  return (
    <>
      {veilRef === undefined ? (
        <div
          className={target !== null ? 'reveal-overlay reveal-overlay--closable' : 'reveal-overlay'}
          ref={ownVeilRef}
          aria-hidden="true"
          onClick={requestClose}
        />
      ) : null}
      {target === null ? null : (
        // key 让每次打开都是一个新挂载的节点：浮动写在展示卡自己的 y 上，
        // 复用旧节点的话上一轮停下时那点偏移会留到下一轮的起飞位置上。
        <ShowcaseCard
          key={target.flipId}
          card={target.card}
          flipId={target.flipId}
          clipRef={clipRef}
          cardRef={cardRef}
        />
      )}
    </>
  )
}
