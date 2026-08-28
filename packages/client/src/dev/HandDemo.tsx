/**
 * 手牌动画演示页（访问 /dev/hand 进入）。
 *
 * 这页不接规则引擎，只用占位数据把手牌和上场特效的各种边界跑一遍：
 * 0 张、1 张、20 张、动画播到一半再加减牌。
 * 中间那块虚线区是"战场"的占位，同时也是拖拽出牌的落点区（把 ref 交给 HandFan）——
 * 之后接真对局时，它就是真正的战场容器。战场分上下两行：上面是对方的，下面是我方的。
 *
 * 演示的三条动画链路：
 * 1. 我方出牌：拖进战场（或原地点一下）→ Flip 飞到我方行 → 上场特效；
 * 2. 对方出牌：点对手那排倒扣的牌 → 遮罩压暗、卡飞到屏幕中央翻正、强制看 1.5 秒
 *    → 飞到对方行 → 上场特效；
 * 3. 加减牌：两侧手牌各自重排，新牌从屏幕外滑入。
 */

import { useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { HandCardFace, HandFan } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { OpponentFan } from '../ui/OpponentFan'
import { CardBackHidden } from '../ui/CardBackHidden'
import { attachCardTilt } from '../ui/cardTilt'
import type { CardTiltHandle } from '../ui/cardTilt'
import { flipTo, setFlipAngle } from '../ui/flipCard'
import { playSummonFx } from '../ui/playSummonFx'
import { BattleTopBar } from '../ui/BattleTopBar'
import { HandDrawnFilterDefs } from '../ui/HandDrawnFilterDefs'
import { OrnateFrame } from '../ui/OrnateFrame'
import { PlaqueButton } from '../ui/PlaqueButton'

gsap.registerPlugin(useGSAP, Flip)

const MAX_HAND = 20
const INITIAL_HAND = 5
/** 对手手牌的初始张数和上限。上限比我方小：倒扇形被顶栏压掉一截，堆太多就只剩一排边。 */
const INITIAL_OPPONENT_HAND = 5
const MAX_OPPONENT_HAND = 12
/**
 * 战场小卡跟着指针倾斜的最大角度。
 *
 * 比手牌大卡（10°）大一点：小卡在屏幕上只占 110×154，同样的角度看起来位移小得多，
 * 要稍微加点量才看得出来。小卡不放大也不位移，倾斜就是它唯一的 hover 反馈。
 */
const TILE_TILT_DEG = 12

/** 我方出牌飞向战场的时长与层级：飞行途中要盖住手牌。 */
const PLAY_FLIGHT_DUR = 0.65
const PLAY_FLIGHT_Z = 60
/** 遮罩淡入 / 淡出。淡出比淡入慢一点，让"看完了"这一下收得柔和些。 */
const OVERLAY_IN_DUR = 0.25
const OVERLAY_OUT_DUR = 0.3
/** 对手牌从手里飞到屏幕中央的时长；翻面补间用同一个值，落位和翻正正好一起收。 */
const REVEAL_IN_DUR = 0.55
/** 强制观看的停留时长。不可跳过——这就是这条链路要演示的东西。 */
const REVEAL_HOLD = 1.5
/** 展示卡飞向对方战场行的时长与层级：要压过遮罩（1100），不然会被正在淡出的遮罩糊住。 */
const REVEAL_OUT_DUR = 0.6
const REVEAL_FLIGHT_Z = 1200

/**
 * 落到战场上的这张牌是谁打的。只影响那段飞行的时长和层级（对方那张是从展示位出发的，
 * 还得压过正在淡出的遮罩），落地特效双方完全一样，不看这个值。
 */
type BoardSide = 'ally' | 'enemy'

/** 自增序号，保证每张占位卡的 id 和名字都不重样。 */
let nextSeq = 0

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** 造一张随机占位卡。演示页在客户端跑，用 Math.random 没问题。 */
function createCard(): HandCardData {
  nextSeq += 1
  const seq = nextSeq
  const kind: HandCardData['kind'] = Math.random() < 0.5 ? 'model' : 'prompt'
  const rarity = randInt(1, 3)
  const base = {
    id: `demo-${seq}`,
    cost: randInt(0, 9),
    backText: `稀有度 ${'★'.repeat(rarity)}${'☆'.repeat(3 - rarity)} · 这是背面的占位说明文字，用来验证翻转之后的排版够不够放得下几行字。`,
  }
  if (kind === 'model') {
    return {
      ...base,
      kind,
      name: `占位模型 ${seq}号`,
      power: randInt(1, 9),
      integrity: randInt(1, 9),
      text: '占位描述：打出后留在场上，等着被对手的提示卡挑弱点。',
    }
  }
  return {
    ...base,
    kind,
    name: `占位提示 ${seq}号`,
    damage: randInt(1, 6),
    text: '占位描述：一次性结算，专挑目标最脆的那一维打。',
  }
}

function createCards(count: number): HandCardData[] {
  return Array.from({ length: count }, () => createCard())
}

/** 加减牌的公共改法：少了从末尾砍、多了往末尾补，已有的牌 id 不变，正在播的补间不会被打断。 */
function resizeCards(current: HandCardData[], next: number): HandCardData[] {
  if (next === current.length) return current
  if (next < current.length) return current.slice(0, next)
  return [...current, ...createCards(next - current.length)]
}

/**
 * 战场上的一张小卡。
 *
 * 三层结构各管一件事，谁也不能挪到别人身上：
 * tile 的 transform 归 Flip 飞行，tilt 做指针倾斜兼裁剪，
 * inner 有 CSS 写死的 scale(var(--tile-scale)) 负责把 150×210 的卡面缩成小卡。
 * 小卡本身不分阵营：上场特效双方同款，配色也一样，所以这里不需要知道自己是哪边的。
 */
function BoardTile({ card }: { card: HandCardData }) {
  return (
    <div className="demo__tile" data-flip-id={card.id}>
      <div className="demo__tile-tilt">
        <div className="demo__tile-inner">
          <HandCardFace card={card} />
        </div>
      </div>
      {/*
        上场时沿卡牌边缘跑一圈的金色追光。放在裁剪层外面：那一层 overflow: hidden，
        会把环外的辉光整圈切掉。里外两层的分工见 styles.css 的 .demo__tile-edge。
      */}
      <div className="demo__tile-edge" aria-hidden="true">
        <div className="demo__tile-edge-ring" />
      </div>
    </div>
  )
}

export function HandDemo() {
  const [hand, setHand] = useState<HandCardData[]>(() => createCards(INITIAL_HAND))
  const [opponentHand, setOpponentHand] = useState<HandCardData[]>(() =>
    createCards(INITIAL_OPPONENT_HAND),
  )
  const [allyBoard, setAllyBoard] = useState<HandCardData[]>([])
  const [enemyBoard, setEnemyBoard] = useState<HandCardData[]>([])
  /**
   * 正在被强制展示的那张对手牌：它已经从对手手牌里摘掉、还没落到对方战场行，
   * 这段时间由展示层单独渲染。非空就等于"展示中"，用来挡住第二次点击。
   */
  const [revealing, setRevealing] = useState<HandCardData | null>(null)

  /** 手牌上方的取消落点，只负责显示“放回手牌”的拖拽反馈。 */
  const returnZoneRef = useRef<HTMLDivElement>(null)
  /**
   * 战场容器，一个 ref 两用：
   * 既是下面那段倾斜跟随的 useGSAP scope（用来查场上的 tile），
   * 也是交给 HandFan 的拖拽落点区——指针在它的矩形范围里松手才算打出。
   * 分成上下两行之后这两件事都不用改：查询用的是 .demo__tile，落点判的是整块矩形。
   */
  const boardRef = useRef<HTMLDivElement>(null)
  /** 上场特效的粒子容器。卸载时要把里面动态插的 DOM 一次清干净。 */
  const fxLayerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const revealCardRef = useRef<HTMLDivElement>(null)
  /** 展示卡的裁剪层。飞行途中它把顶栏那一截挡住，落位后由 JS 撤掉（原因见 .reveal-clip）。 */
  const revealClipRef = useRef<HTMLDivElement>(null)
  /**
   * 战场上每张小卡的倾斜跟随，按 tile 元素存着。
   * 用元素当键是因为 tile 上没有别的稳定标识可用，而 React 按 card.id 复用节点，
   * 同一张卡每次渲染拿到的就是同一个元素。
   */
  const tiltsRef = useRef(new Map<HTMLElement, CardTiltHandle>())
  /**
   * 待播的"飞进战场"动画：记下起飞那一刻的位置，等 React 把 DOM 换好之后再补上飞行。
   * 连 id 和来源方一起存：起飞的那个节点马上就没了，之后只能靠 id 去战场里找新元素，
   * 而来源方决定这段飞行的时长和层级。我方出牌和对手展示落场共用这一条通道。
   */
  const boardFlipRef = useRef<{ state: Flip.FlipState; id: string; side: BoardSide } | null>(null)
  /** 待播的"飞向展示位"动画，记的是对手手牌里那张牌起飞前的位置。 */
  const revealFlipRef = useRef<Flip.FlipState | null>(null)
  /** 展示停留期间的呼吸浮动，收尾时要停掉，免得它继续改一个马上要卸载的节点。 */
  const floatRef = useRef<gsap.core.Tween | null>(null)

  const resizeHand = (count: number) => {
    const next = Math.max(0, Math.min(MAX_HAND, count))
    setHand((current) => resizeCards(current, next))
  }

  const resizeOpponentHand = (count: number) => {
    const next = Math.max(0, Math.min(MAX_OPPONENT_HAND, count))
    setOpponentHand((current) => resizeCards(current, next))
  }

  /**
   * 摘掉战场上所有小卡的倾斜跟随（监听 + 补间）。只在组件卸载时用；
   * 战场增减走的是下面按元素增量挂/摘的那段。重复调用是安全的。
   */
  const detachTilts = () => {
    for (const handle of tiltsRef.current.values()) handle.detach()
    tiltsRef.current.clear()
  }

  const handlePlay = (id: string) => {
    const card = hand.find((item) => item.id === id)
    if (!card) return
    // 此刻手牌那张卡还在 DOM 里、还停在松手那一刻的拖拽位置，正好当飞行的起点。
    // 查询限定在 .hand-fan 里：战场小卡、对手手牌、展示卡用的是同一套 data-flip-id，
    // 不限定就会抓错元素。
    const slot = document.querySelector(`.hand-fan [data-flip-id="${CSS.escape(id)}"]`)
    boardFlipRef.current = slot === null ? null : { state: Flip.getState(slot), id, side: 'ally' }
    setHand((current) => current.filter((item) => item.id !== id))
    setAllyBoard((current) => [...current, card])
  }

  /**
   * 玩家点了对手的一张牌：把它从对手手牌里摘下来交给展示层。
   *
   * 一次只展示一张，展示期间的点击一律忽略——遮罩本来就吃掉了所有指针事件，
   * 这里再挡一道是为了不依赖遮罩的时序（淡入要 0.25s）。
   */
  const handleReveal = (id: string) => {
    if (revealing !== null || revealFlipRef.current !== null) return
    const card = opponentHand.find((item) => item.id === id)
    if (!card) return
    // 起飞点是倒扇形里那张牌此刻的位置。它在一个 rotate(180deg) 的容器里，
    // Flip 记的是元素的全局矩阵，所以这份 state 自带 180° 的旋转；
    // 飞向正置的展示位时，Flip 会把这 180° 一路转正（rotation 是它必然补间的属性之一），
    // 观感上就是"牌从对面翻转着飞过来"，这正是想要的，不用额外补一段旋转。
    const slot = document.querySelector(`.opponent-fan [data-flip-id="${CSS.escape(id)}"]`)
    if (slot === null) return
    revealFlipRef.current = Flip.getState(slot)
    setOpponentHand((current) => current.filter((item) => item.id !== id))
    setRevealing(card)
  }

  // 飞进战场：我方出牌和对手展示落场共用这一段，只有时长和层级按来源方分，落地特效同款。
  useGSAP(
    (_context, safe) => {
      const pending = boardFlipRef.current
      if (pending === null) return
      boardFlipRef.current = null
      // 必须显式把战场上的新元素交给 Flip。不传 targets 的话 Flip 会退回用
      // state.targets——也就是起飞前那个已经被 React 摘掉的旧节点，
      // 于是补间挂在一个脱离文档的 div 上，战场小卡一动不动，飞行等于没跑。
      // Flip 不会自己按 data-flip-id 去全文档找新元素。
      const target = document.querySelector<HTMLElement>(
        `.demo__board [data-flip-id="${CSS.escape(pending.id)}"]`,
      )
      if (target === null) return
      const isAlly = pending.side === 'ally'
      // 落地特效是在 onComplete 里才建的补间，出了 useGSAP 回调的同步区间，
      // 不用 contextSafe 包一层就不归 context 管，组件卸载时 revert 不掉。
      const landed = () => playSummonFx(target)
      // 新旧两个元素靠 data-flip-id 对上号，
      // Flip 负责把新元素从旧元素的位置和大小补间过来，中间不会跳一下。
      Flip.from(pending.state, {
        targets: target,
        duration: isAlly ? PLAY_FLIGHT_DUR : REVEAL_OUT_DUR,
        ease: 'power2.inOut',
        // 用 scale 而不是 width/height，卡面里的字会跟着一起缩，看起来才像同一张卡在变小。
        scale: true,
        // 飞行途中要压在手牌（20）和工具条（40）之上；对手那张还得压过正在淡出的遮罩（1100）。
        // 战场容器本身没有层叠上下文，所以这个层级是全局有效的。
        zIndex: isAlly ? PLAY_FLIGHT_Z : REVEAL_FLIGHT_Z,
        onComplete: safe ? safe(landed) : landed,
      })
    },
    { dependencies: [allyBoard, enemyBoard] },
  )

  // 强制展示：遮罩淡入 + 卡从对手手牌飞到屏幕中央并翻正 + 停留 1.5 秒 + 收尾飞向对方战场行。
  useGSAP(
    (_context, safe) => {
      const pending = revealFlipRef.current
      if (pending === null || revealing === null) return
      revealFlipRef.current = null
      const card = revealCardRef.current
      const overlay = overlayRef.current
      if (card === null || overlay === null) return
      const shown = revealing

      // 遮罩接管所有指针事件：强制动画期间玩家什么都点不了。
      // 用 autoAlpha 而不是 opacity——它顺手改 visibility，遮罩看不见时就不吃指针事件。
      gsap.to(overlay, { autoAlpha: 1, duration: OVERLAY_IN_DUR, ease: 'power2.out' })

      const inner = card.querySelector<HTMLElement>('.reveal-card__inner')
      // 起飞那一瞬间必须还是牌背，而且要和对手手牌里看到的完全一致，不能跳变。
      // 走 setFlipAngle 而不是裸 gsap.set：正反两面谁可见是按角度切 opacity 决定的。
      if (inner !== null) setFlipAngle(inner, 180)

      /** 停留到点：停浮动、记下展示卡此刻的位置、遮罩淡出、把牌交给对方战场行。 */
      const finish = () => {
        floatRef.current?.kill()
        floatRef.current = null
        const el = revealCardRef.current
        // 在卡还停在屏幕中央、还没被 React 摘掉的这一帧取位置，下一段飞行就从这儿接着走。
        if (el !== null) {
          boardFlipRef.current = { state: Flip.getState(el), id: shown.id, side: 'enemy' }
        }
        gsap.to(overlay, { autoAlpha: 0, duration: OVERLAY_OUT_DUR, ease: 'power2.in' })
        setRevealing(null)
        setEnemyBoard((current) => [...current, shown])
      }
      // delayedCall 的回调是 1.5 秒后才跑的，那时早已出了 useGSAP 回调的同步区间，
      // 里面新建的遮罩淡出补间不包一层就不归 context 管。
      const finishSafe = safe ? safe(finish) : finish

      const revealed = () => {
        // 卡已经整张落在顶栏下方，裁剪层可以撤了——留着的话呼吸浮动和之后的落场飞行
        // 万一擦到顶栏那条线还会被裁一下。这一刻裁剪本来就没裁到任何东西，撤掉看不出变化。
        const clip = revealClipRef.current
        if (clip !== null) gsap.set(clip, { clipPath: 'none' })
        // 停留期间极轻微地上下浮，免得画面完全定住像卡住了。
        // 浮动写在展示卡自己的 y 上没问题：Flip 落位时已经把飞行用的内联 transform 收干净了，
        // 收尾时也会先 kill 掉它再取位置，两者不会抢同一个属性。
        floatRef.current = gsap.to(card, {
          y: '-=8',
          duration: 1.15,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
        })
        gsap.delayedCall(REVEAL_HOLD, finishSafe)
      }

      Flip.from(pending, {
        targets: card,
        duration: REVEAL_IN_DUR,
        ease: 'power3.inOut',
        scale: true,
        onComplete: safe ? safe(revealed) : revealed,
      })
      // 和飞行同时进行的背面→正面翻转。从 180 转到 360 而不是转回 0：
      // 两条路都经过"侧对观察者"的那一瞬间，但同向续转不会出现半路掉头的观感。
      if (inner !== null) flipTo(inner, 360, REVEAL_IN_DUR)
    },
    { dependencies: [revealing] },
  )

  // 战场小卡的倾斜跟随。tile 是纯 React 渲染的，没有现成的 GSAP 管理，所以在这里逐个挂。
  // 单独开一个 useGSAP 而不是并进上面那些：那些都有"没有待播的动画就直接 return"的早退，
  // 挂在它们后面会被跳过。
  useGSAP(
    () => {
      // 只给新落到战场上的 tile 挂、只摘掉已经不在场上的，其余原样留着。
      // 不能图省事整批重挂：detach 会把倾斜和高光硬切回零，而指针很可能正停在
      // 一张早就在场上的小卡上——再打出一张牌，那张卡的倾斜就会突然弹平、高光凭空消失，
      // 指针不动就不再有 pointermove，也就再也回不来。
      //
      // 另外，依赖数组非空时 useGSAP 只在**卸载**时 revert，下面 return 的清理函数
      // 在战场变化时根本不会跑，所以离场的 tile 必须在这里自己摘。
      // "清场"就是走这条路：两行都变成空数组，这里把所有 tile 都摘掉。
      //
      // 查询用的仍是 .demo__tile，所以上下两行一起覆盖，分行没有增加这里的负担。
      const root = boardRef.current
      const tiles = root === null ? [] : root.querySelectorAll<HTMLElement>('.demo__tile')
      const alive = new Set<HTMLElement>(tiles)
      for (const tile of tiles) {
        if (tiltsRef.current.has(tile)) continue
        // 倾斜写在 tile 内层：飞行途中 tile 自己的 transform 归 Flip 管，
        // 往上面再写 rotationX 就是两边抢同一个属性。挂在内层的话飞行中被 hover 也不会出怪相。
        tiltsRef.current.set(
          tile,
          attachCardTilt(tile, { tiltLayer: '.demo__tile-tilt', maxTilt: TILE_TILT_DEG }),
        )
      }
      for (const [tile, handle] of tiltsRef.current) {
        if (alive.has(tile)) continue
        handle.detach()
        tiltsRef.current.delete(tile)
      }
      // 只有卸载会走到这里，但还是要留着：卸载时得把监听和补间一起收掉。
      return detachTilts
    },
    { scope: boardRef, dependencies: [allyBoard, enemyBoard] },
  )

  // 上场特效里只有烟尘是直接 appendChild 进特效层的，React 不认识它们
  // （追光那两层归 React 渲染，跟着 tile 一起卸载，不用管）。
  // 正常情况下每团烟尘在自己的 onComplete 里自杀，但卸载时补间是被 revert 掉的、
  // onComplete 不会跑，所以这里兜底把整层清空。
  useEffect(() => {
    const layer = fxLayerRef.current
    return () => layer?.replaceChildren()
  }, [])

  return (
    <div className="demo">
      <HandDrawnFilterDefs />
      <BattleTopBar />

      <div className="demo__layout">
        <aside className="demo__sidebar demo__sidebar--left" aria-label="左侧信息栏">
          <OrnateFrame className="demo__sidebar-frame" />
        </aside>

        <main className="demo__battlefield">
          <div className="demo__bar" aria-label="手牌演示控制">
            <span className="demo__title">手牌演示</span>
            <span className="demo__group">我方</span>
            <button type="button" className="demo__btn" onClick={() => resizeHand(hand.length - 1)}>
              −1
            </button>
            <button type="button" className="demo__btn" onClick={() => resizeHand(hand.length + 1)}>
              +1
            </button>
            <input
              className="demo__slider"
              aria-label="我方手牌数量"
              type="range"
              min={0}
              max={MAX_HAND}
              value={hand.length}
              onChange={(event) => resizeHand(Number(event.target.value))}
            />
            <span className="demo__count">{hand.length} 张</span>
            <span className="demo__bar-sep" aria-hidden="true" />
            <span className="demo__group">对手</span>
            <button
              type="button"
              className="demo__btn"
              onClick={() => resizeOpponentHand(opponentHand.length - 1)}
            >
              −1
            </button>
            <button
              type="button"
              className="demo__btn"
              onClick={() => resizeOpponentHand(opponentHand.length + 1)}
            >
              +1
            </button>
            <span className="demo__count">{opponentHand.length} 张</span>
            <span className="demo__bar-sep" aria-hidden="true" />
            <button
              type="button"
              className="demo__btn"
              onClick={() => {
                setAllyBoard([])
                setEnemyBoard([])
              }}
            >
              清场
            </button>
          </div>

          <div className="demo__board" ref={boardRef}>
            <span className="demo__drop-cue demo__drop-cue--board" aria-hidden="true">
              <strong>松手</strong>
              放到场上
            </span>
            {/* 烟尘挂在这一层，不塞进 tile：tile 的裁剪层 overflow: hidden 会把它切掉。
                刻意不给它 z-index，飞行中的卡（zIndex 60 / 1200）才压得住它。 */}
            <div className="demo__fx-layer" ref={fxLayerRef} aria-hidden="true" />
            <div className="demo__board-row demo__board-row--enemy">
              {enemyBoard.length === 0 && (
                <span className="demo__board-hint">点击上方对手手牌，看它落到这里</span>
              )}
              {enemyBoard.map((card) => (
                <BoardTile key={card.id} card={card} />
              ))}
            </div>
            <div className="demo__board-row demo__board-row--ally">
              {allyBoard.length === 0 && <span className="demo__board-hint">将手牌拖入战场</span>}
              {allyBoard.map((card) => (
                <BoardTile key={card.id} card={card} />
              ))}
            </div>
          </div>

          <div className="demo__return-zone" ref={returnZoneRef} aria-hidden="true">
            <span className="demo__drop-cue demo__drop-cue--return">
              <strong>松手</strong>
              放回手牌
            </span>
          </div>
        </main>

        <aside className="demo__sidebar demo__sidebar--right" aria-label="右侧信息栏">
          <OrnateFrame className="demo__sidebar-frame demo__sidebar-frame--actions">
            <PlaqueButton aria-label="结束当前回合">结束回合</PlaqueButton>
          </OrnateFrame>
        </aside>
      </div>

      <OpponentFan
        cards={opponentHand}
        onReveal={handleReveal}
        disabled={revealing !== null}
      />

      <HandFan
        cards={hand}
        dropZoneRef={boardRef}
        returnZoneRef={returnZoneRef}
        onPlay={handlePlay}
        disabled={revealing !== null}
      />

      {/*
        强制展示层。遮罩常驻 DOM（默认 visibility: hidden，不吃指针事件），
        这样停留结束后它能自己淡出去——挂在 revealing 上的话，state 一清元素就没了，淡出无从谈起。
        展示卡则跟着 revealing 存亡：它要作为 Flip 的起点被摘掉，才能把飞行接力给战场上的新 tile。
      */}
      <div className="reveal-overlay" ref={overlayRef} aria-hidden="true" />
      {revealing !== null && (
        // 裁剪层每次展示都跟着展示卡重新挂载，所以 CSS 里那份"挡住顶栏"的裁剪
        // 每次都是新的，上一轮撤裁剪时写的内联样式不会留到下一轮。
        <div className="reveal-clip" ref={revealClipRef}>
          <div className="reveal-card" ref={revealCardRef} data-flip-id={revealing.id}>
            {/* 翻面层，结构和手牌一致：两面重叠、由 flipTo 按角度切 opacity（见 ui/flipCard.ts）。 */}
            <div className="reveal-card__inner">
              <div className="reveal-card__face" data-flip-face="front">
                {/* 卡面布局尺寸仍是 150×210，靠这一层整体放大，字和描边才一起变大而不是被拉伸。 */}
                <div className="reveal-card__scale">
                  <HandCardFace card={revealing} />
                </div>
              </div>
              <div className="reveal-card__face reveal-card__face--back" data-flip-face="back">
                {/* 背面必须是对手手牌里那张一模一样的隐藏牌背，起飞瞬间才不会跳变。 */}
                <div className="reveal-card__scale">
                  <CardBackHidden />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
