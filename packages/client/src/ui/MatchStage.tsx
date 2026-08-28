/**
 * 对局界面。只认一个 MatchDriver，不知道自己在打热座、联机还是 dev 测试房。
 *
 * 画面骨架照设计稿来：顶栏 + 左右两块纸面侧栏 + 中间战场，底部一排扇形手牌，
 * 顶边吊着对手的倒扇形手牌。
 * 位置和动画一律交给 GSAP 直接改 DOM（架构 5.5），React 只负责"有哪些元素、它们是什么状态"。
 *
 * 两条订阅各司其职：
 * - `useMatch` 拿快照，渲染"事件全部应用完"的结果；
 * - `useMatchEvents` 拿事件流，播过程动画（回合横幅、伤害飘字、对手出牌的强制展示：
 *   牌从对手手里飞到屏幕中央翻正停一会儿，模型卡接着飞向对方战场行并播上场特效）。
 *   事件订阅者全局只允许一个（架构 5.2），所以整个应用里只能有这一处 useMatchEvents。
 *
 * 屏幕中央那套展示层（.reveal-*）由两条链路共用，它们严格互斥（共用同一张展示卡、同一条浮动）：
 * 对手出牌的强制展示（reveal，不可打断）和玩家点战场小卡的放大查看（inspect，点遮罩关闭）。
 */

import { useRef, useState, useEffect, useMemo } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { getCard, other, WEAKNESS_KINDS } from '@ai-duel/core'
import type {
  Card,
  CardId,
  CardInstance,
  Command,
  GameState,
  InstanceId,
  ModelInstance,
  PlayerState,
  WeaknessKind,
} from '@ai-duel/core'
import { useMatch, useMatchEvents } from '../match/useMatch'
import type { MatchDriver, MatchView } from '../match/driver'
import { BattleTopBar } from './BattleTopBar'
import { CardBackHidden } from './CardBackHidden'
import { HandCardFace, HandFan } from './HandFan'
import { cardPresentation } from './cardPresentation'
import type { HandCardData } from './HandFan'
import { HandDrawnFilterDefs } from './HandDrawnFilterDefs'
import { OpponentFan } from './OpponentFan'
import { OrnateFrame } from './OrnateFrame'
import { PlaqueButton } from './PlaqueButton'
import { cardBackText } from './cardText'
import { attachCardTilt } from './cardTilt'
import type { CardTiltHandle } from './cardTilt'
import { flipTo, setFlipAngle } from './flipCard'
import { playSummonFx } from './playSummonFx'

gsap.registerPlugin(useGSAP, Flip)

/**
 * 战场小卡跟着指针倾斜的最大角度。
 *
 * 比手牌大卡（10°）大一点：小卡在屏幕上只占 110×154，同样的角度看起来位移小得多，
 * 要稍微加点量才看得出来。
 */
const TILE_TILT_DEG = 12
/**
 * 战场小卡 hover 时放大的倍数，和倾斜一起构成"这张卡可以点"的反馈。
 *
 * 只有 5%：小卡是紧挨着排的，放大太多会压到旁边那张身上。
 * 放大必须和倾斜一样交给 cardTilt 用 GSAP 做，CSS 写了也没用（原因见 ui/cardTilt.ts 的文件头）。
 */
const TILE_HOVER_SCALE = 1.05

/** 遮罩淡入 / 淡出。淡出比淡入慢一点，让"看完了"这一下收得柔和些。 */
const OVERLAY_IN_DUR = 0.25
const OVERLAY_OUT_DUR = 0.3
/** 对手牌从手里飞到屏幕中央的时长；翻面补间用同一个值，落位和翻正正好一起收。 */
const REVEAL_IN_DUR = 0.55
/** 强制观看的停留时长。不可跳过——玩家必须看清对手打的是什么。 */
const REVEAL_HOLD = 1.5
/** 展示卡飞向战场（或飞回原格）的时长与层级：要压过遮罩（1100），不然会被正在淡出的遮罩糊住。 */
const REVEAL_OUT_DUR = 0.6
const REVEAL_FLIGHT_Z = 1200

export interface MatchStageProps {
  driver: MatchDriver
  /**
   * dev 测试房模式：对方手牌摊开显示真实卡面，点一下就替对方打出去（走 DEBUG_PLAY_CARD，
   * 提示卡不选目标、直击我方本体）。正式对局一律为 false，那时对方手牌是顶边的倒扇形牌背。
   */
  testMode?: boolean
  /** 结算层里的按钮，由各个界面自己决定是"再来一局"还是"回首页"。 */
  resultActions?: ReactNode
}

/**
 * 正在等玩家选目标的提示卡。
 *
 * 只有本端自己出牌会进这个状态（测试房替对方出牌不选目标，见 playForFoe），
 * 所以出牌方恒为本端座位、目标恒在对方那一侧，这里只记牌是哪张。
 */
interface PendingPrompt {
  instanceId: InstanceId
}

/**
 * 正在被放大查看的那张战场小卡。
 *
 * 这张卡**没有**离开战场：格子还在（只是隐藏着占位，见 .battle__tile--held），
 * 展示层只是多渲染了一份放大的副本。instanceId 同时是飞回原格时 Flip 的配对键。
 */
interface InspectTarget {
  card: HandCardData
  instanceId: InstanceId
}

/**
 * 正在被强制展示的那张对手牌。
 *
 * landingId 非空 = 模型卡，展示完要飞到对方战场行上那个 instanceId 对应的格子；
 * 为 null = 提示卡，没有落点，展示完原地淡出。
 * flipId 是这张牌在对手手牌里的实例 id，也就是 Flip 用来把"手牌里的旧节点"和"展示卡"
 * 对上号的键——提示卡的卡面数据是按卡牌定义拼的（id 是 cardId），对不上，所以单独存一份。
 * key 让连着展示两张牌也能各播各的（同一张卡也不会被上一轮的收尾掐掉）。
 */
interface RevealTarget {
  card: HandCardData
  landingId: InstanceId | null
  flipId: InstanceId
  key: number
}

/** 正式对局里对手手牌只能看不能点（点着看牌是原演示页的行为），所以 onReveal 是个空函数。 */
const noopReveal = () => {}

export function MatchStage({ driver, testMode = false, resultActions }: MatchStageProps) {
  const view = useMatch(driver)

  // 还没拿到局面（联机客人在等房主开局），或者开局前就断了。
  // 下面那个组件的一整套 hook 都要求 state 存在，所以拆成两个组件而不是在中间早退。
  if (view.state === null) {
    return (
      <div className="battle battle--waiting">
        <HandDrawnFilterDefs />
        <BattleTopBar />
        <div className="battle__waiting">
          <p className="battle__waiting-text">
            {view.status === 'aborted' ? view.abortReason : '正在等房主开局…'}
          </p>
          {view.status === 'aborted' ? (
            <div className="battle__result-actions">{resultActions}</div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <BattleField
      driver={driver}
      view={view}
      state={view.state}
      testMode={testMode}
      resultActions={resultActions}
    />
  )
}

function BattleField({
  driver,
  view,
  state,
  testMode,
  resultActions,
}: {
  driver: MatchDriver
  view: MatchView
  /** 就是 view.state，由上面判过空之后传进来，省得这里到处写 ?. */
  state: GameState
  testMode: boolean
  resultActions?: ReactNode
}) {
  const mySeat = view.seat
  const foeSeat = other(mySeat)
  const me = state.players[mySeat]
  const foe = state.players[foeSeat]
  const myTurn = state.activePlayer === mySeat && state.phase === 'playing'

  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null)
  /**
   * 已经发出我方指令、还没等到新局面。
   *
   * 只有联机客人真的会停在这个状态（send 只是把指令丢给房主，要等回包）；
   * 本地和房主 driver 下 send 是同步的，下面那个 effect 当场就把它清掉，只闪一帧。
   * 它的作用是把 HandFan 的 disabled 打开，让打出去的牌按 HandFanProps 的约定
   * 停在落点上等结果，而不是被当成"父组件没受理"立刻飞回手牌。
   */
  const [awaiting, setAwaiting] = useState(false)
  /** 正在放大查看的战场小卡；非空即"查看中"，同时也是遮罩可点关闭的开关。 */
  const [inspecting, setInspecting] = useState<InspectTarget | null>(null)
  /** 对手正打出的那张牌，强制展示在屏幕中央。 */
  const [reveal, setReveal] = useState<RevealTarget | null>(null)

  /**
   * 战场容器，一个 ref 三用：
   * 交给 HandFan 当拖拽落点区、当战场小卡倾斜跟随的 useGSAP scope、以及查 Flip 的落点元素。
   */
  const boardRef = useRef<HTMLDivElement>(null)
  /** 手牌上方的取消落点，只负责显示"放回手牌"的拖拽反馈。 */
  const returnZoneRef = useRef<HTMLDivElement>(null)
  /** 特效层：横幅和飘字都由 GSAP 直接往里塞节点，pointer-events: none，不参与交互。 */
  const fxRef = useRef<HTMLDivElement>(null)
  /** 上场特效的烟尘容器。卸载时要把里面动态插的 DOM 一次清干净。 */
  const smokeLayerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const revealCardRef = useRef<HTMLDivElement>(null)
  /** 展示卡的裁剪层。飞行途中它把顶栏那一截挡住，落位后由 JS 撤掉（原因见 .reveal-clip）。 */
  const revealClipRef = useRef<HTMLDivElement>(null)
  /** 战场上每张小卡的倾斜跟随，按 tile 元素存着（tile 上没有别的稳定标识可用）。 */
  const tiltsRef = useRef(new Map<HTMLElement, CardTiltHandle>())
  /** 松手那一刻记下的手牌位置，等 React 把 DOM 换好之后再拿它补飞行动画。 */
  const flipStateRef = useRef<{ state: Flip.FlipState; id: string } | null>(null)
  /**
   * 兜底：展示链路被占用（连着出牌）或找不到起飞点时，对方新上场的模型只播一段简易进场。
   * 收到事件那一刻它的 DOM 还不存在，所以攒到下一次提交后再播。
   */
  const popQueueRef = useRef<InstanceId[]>([])
  /**
   * 待播的"飞向展示位"动画，记的是对手手牌里那张牌起飞前的位置。
   * fromBack = 起点是倒扇形里那张背面朝上的牌，飞的路上要翻正；
   * 测试房摊开的那条手牌本来就是正面，不翻。
   */
  const revealFlipRef = useRef<{ state: Flip.FlipState; fromBack: boolean } | null>(null)
  /**
   * 强制展示占着展示层。从受理事件那一刻起为 true，到遮罩淡出完毕才复位。
   *
   * 必须是 ref 不能是 state：事件回调在 React 提交新局面**之前**同步送达，
   * 读 state 拿到的是上一次渲染的旧值（同 seatRef 的理由）。
   * 它同时是特效队列的闸门：为 true 期间的横幅和飘字都先排队，等遮罩淡出再补播。
   */
  const revealBusyRef = useRef(false)
  /** 待播的"从展示位飞向战场格子"动画。展示卡马上要被摘掉，只能靠 id 找落点那个新格子。 */
  const landingFlipRef = useRef<{ state: Flip.FlipState; id: InstanceId } | null>(null)
  /** 待播的"小卡飞向展示位"动画，记的是战场上那个格子起飞前的位置。 */
  const inspectFlipRef = useRef<Flip.FlipState | null>(null)
  /** 待播的"从展示位飞回战场格子"动画，同样要连 id 一起存。 */
  const inspectReturnRef = useRef<{ state: Flip.FlipState; id: InstanceId } | null>(null)
  /**
   * 查看的卡是否已经飞到位。飞入途中的点击一律忽略：
   * 半路把飞入换成飞回，起点就是一个还在被 Flip 改写的元素，容易留下收不干净的补间。
   */
  const inspectHeldRef = useRef(false)
  /**
   * 展示停留期间的呼吸浮动，收尾时要停掉，免得它继续改一个马上要卸载的节点。
   * 强制展示和放大查看共用这一个 ref——两条链路互斥，不会同时有浮动在跑。
   */
  const floatRef = useRef<gsap.core.Tween | null>(null)
  /**
   * 事件回调要读最新的座位号。
   * 不能直接闭包捕获：useMatchEvents 把 handler 存在 ref 里就是为了不重新订阅
   * （重订会丢掉 driver 攒着的那批开局事件，见架构 5.2），所以这里也走 ref。
   */
  const seatRef = useRef(mySeat)
  seatRef.current = mySeat
  /** 同 seatRef：事件回调要判"现在是不是正在放大查看"，读 state 拿到的是旧值。 */
  const inspectingRef = useRef<InspectTarget | null>(null)
  /**
   * 强制展示期间攒下的特效（横幅、伤害飘字），等遮罩淡出后再逐个补播。
   *
   * 展示遮罩（z 1100）压在特效层（z 80）之上，展示期间播的横幅和飘字会被压暗模糊；
   * 叙事顺序也不对——应该先看清对手打的是什么牌，再看到掉了多少血。
   */
  const fxQueueRef = useRef<(() => void)[]>([])

  /**
   * 只为了拿 contextSafe：事件回调、定时回调里新建的补间必须包一层，
   * 否则不归 useGSAP 的 context 管，组件卸载时 revert 不掉，会继续去改脱离文档的节点（架构 5.5）。
   */
  const { contextSafe } = useGSAP()

  /** 局面一变就说明上一条指令有结果了（成功或被拒都会换一个新的 view 对象）。 */
  useEffect(() => {
    setAwaiting(false)
  }, [view])

  // ---------- 事件动画 ----------

  /** 中央横幅：回合交接时闪一下"你的回合"/"对方回合"。 */
  const playBanner = contextSafe((text: string) => {
    const layer = fxRef.current
    if (layer === null) return
    const node = document.createElement('div')
    node.className = 'battle__banner'
    node.textContent = text
    layer.appendChild(node)
    gsap
      .timeline({ onComplete: () => node.remove() })
      .fromTo(
        node,
        { autoAlpha: 0, scale: 0.86 },
        { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(1.6)', overwrite: 'auto' },
      )
      .to(node, { autoAlpha: 0, scale: 1.05, duration: 0.35, ease: 'power2.in' }, '+=0.75')
  })

  /**
   * 在某个元素上方飘一个「-N」并让它抖一下。
   *
   * fallbackRect 只有补播时才传：排队那会儿量下的矩形。等到补播时目标可能已经碎了、
   * 从 DOM 里没了，那就拿这份旧矩形把飘字摆回它当时的位置，抖动只能跳过。
   */
  const playHit = contextSafe((selector: string, amount: number, fallbackRect: DOMRect | null) => {
    const layer = fxRef.current
    if (layer === null) return
    const target = document.querySelector<HTMLElement>(selector)
    const rect = target?.getBoundingClientRect() ?? fallbackRect
    if (rect === null) return
    const origin = layer.getBoundingClientRect()
    const node = document.createElement('span')
    node.className = 'battle__damage'
    node.textContent = `-${amount}`
    node.style.left = `${rect.left + rect.width / 2 - origin.left}px`
    node.style.top = `${rect.top - origin.top}px`
    layer.appendChild(node)
    gsap
      .timeline({ onComplete: () => node.remove() })
      .fromTo(
        node,
        { y: 0, autoAlpha: 0, scale: 0.7 },
        { y: -44, autoAlpha: 1, scale: 1, duration: 0.32, ease: 'back.out(2)' },
      )
      .to(node, { y: -70, autoAlpha: 0, duration: 0.4, ease: 'power1.in' }, '+=0.3')
    // 目标已经不在了（补播时它早被打碎）就只剩飘字，没什么可抖的。
    if (target === null) return
    // 抖的是倾斜层而不是 tile 本身：tile 的 transform 归 Flip 飞行管，两边写一层就是互相覆盖。
    // 玩家面板没有这一层，就直接抖它自己。
    const shaken = target.querySelector<HTMLElement>('.battle__tile-tilt') ?? target
    gsap.fromTo(
      shaken,
      { x: -5 },
      {
        x: 5,
        duration: 0.05,
        repeat: 5,
        yoyo: true,
        ease: 'none',
        overwrite: 'auto',
        // 抖完必须把 x 归零：yoyo 来回跑完最后停在 -5，留着的话这张卡会一直歪在旁边几个像素。
        //
        // 归零只能用 gsap.set，不能用 clearProps: 'x'——GSAP 清任何一个 transform 分量都会
        // 把元素整条内联 transform 删掉，连这一层上 cardTilt 正在写的 rotationX / rotationY
        // 一起清掉。指针要是正停在这张卡上，倾斜会突然弹平，而且指针不动就没有下一次
        // pointermove，再也恢复不了。gsap.set 只写 x，GSAP 的 transform 缓存会保留其余分量。
        //
        // 这个回调在 contextSafe 包住的同步执行期之外才触发，但它只是一次性写值、不新建补间，
        // 没有需要 context 回收的东西，所以不用再包一层 contextSafe。
        onComplete: () => gsap.set(shaken, { x: 0 }),
      },
    )
  })

  /** 受理一次横幅：展示期间先排队，别被遮罩压暗。 */
  const showBanner = (text: string) => {
    if (revealBusyRef.current) {
      fxQueueRef.current.push(() => playBanner(text))
      return
    }
    playBanner(text)
  }

  /**
   * 受理一次伤害飘字。
   *
   * 目标元素和它的矩形必须在**受理这一刻**就量好：事件是在 React 提交新局面之前送到的，
   * 即将被打碎的那张卡此刻还在 DOM 里，等到补播时就找不到了。
   */
  const showHit = (selector: string, amount: number) => {
    const target = document.querySelector<HTMLElement>(selector)
    if (target === null) return
    if (revealBusyRef.current) {
      const rect = target.getBoundingClientRect()
      fxQueueRef.current.push(() => playHit(selector, amount, rect))
      return
    }
    playHit(selector, amount, null)
  }

  /**
   * 把攒着的特效一次性补播完。只在遮罩淡出的 onComplete 里调。
   *
   * 包一层 contextSafe 是给队列兜底：眼下入队的 thunk 调的是 playBanner / playHit，
   * 它们自己已经包过，但队列是通用的，将来塞进来的补间也得归 context 管。
   */
  const flushFx = contextSafe(() => {
    const queued = fxQueueRef.current
    fxQueueRef.current = []
    for (const play of queued) play()
  })

  // ---------- 展示层（强制展示 + 放大查看） ----------

  // 查看状态和 ref 必须一起改：事件回调读的是 ref（见 inspectingRef）。
  const openInspect = (target: InspectTarget) => {
    inspectingRef.current = target
    setInspecting(target)
  }

  const closeInspect = () => {
    inspectingRef.current = null
    setInspecting(null)
  }

  /**
   * 中止正在进行的放大查看：停浮动、丢掉飞回、让格子恢复可见。
   *
   * 对手出牌等不了，所以不播飞回那段动画，卡直接归位。遮罩不用管——
   * 紧接着的强制展示会自己把它开着。
   */
  const abortInspect = () => {
    if (inspectingRef.current === null) return
    inspectHeldRef.current = false
    floatRef.current?.kill()
    floatRef.current = null
    inspectReturnRef.current = null
    closeInspect()
  }

  /**
   * 受理一次对手出牌的强制展示：截下起飞位置，把牌交给展示层。
   *
   * 返回 false 表示这次不播展示，调用方自己降级（模型卡退回 popQueue 的简易进场，
   * 提示卡就只剩伤害飘字）。requireOrigin 为 true 时找不到起飞的那张手牌也算不受理：
   * 模型卡还有 popQueue 兜底，而提示卡没有别的地方能看到牌面，宁可从屏幕中央淡入
   * （见展示 useGSAP 里 revealFlipRef 为空的那条分支）。
   */
  const startReveal = (
    card: HandCardData,
    landingId: InstanceId | null,
    handInstanceId: InstanceId,
    requireOrigin: boolean,
  ): boolean => {
    // 展示层只有一张展示卡、一条浮动，正在展示（含收尾还没跑完）时第二条一律不受理。
    if (revealBusyRef.current) return false
    // 挡的是"查看那边刚受理了一次点击、对应的 effect 还没跑"的那一拍：
    // 那时展示卡的起飞状态已经截好、却还没交给 Flip，横插一次展示就把它丢了。
    // 真正的飞行途中反倒不用挡——两个 ref 在各自 effect 开头就被消费成 null，
    // 而展示卡会跟着 showcase 的 key 重新挂载，旧的那条 Flip 只是继续改一个
    // 已经脱离文档的节点，改不到画面上（遮罩上的补间另有 overwrite 兜着，见下面两条链路）。
    if (inspectFlipRef.current !== null || inspectReturnRef.current !== null) return false

    // 事件是在 React 提交新局面之前送到的，所以那张牌此刻还在对手手牌的 DOM 里：
    // 正式对局是倒扇形里的一张牌背，测试房是摊开条里的真实卡面。
    // 查询限定在这两个容器里：手牌、战场小卡、展示卡共用同一套 data-flip-id，
    // 不限定就会抓错元素。
    const escaped = CSS.escape(handInstanceId)
    const slot = document.querySelector(
      `.opponent-fan [data-flip-id="${escaped}"], .battle__foe-hand [data-flip-id="${escaped}"]`,
    )
    if (slot === null && requireOrigin) return false

    abortInspect()
    revealBusyRef.current = true
    revealFlipRef.current =
      slot === null
        ? null
        : {
            // 倒扇形里那张牌在一个 rotate(180deg) 的容器里，Flip 记的是元素的全局矩阵，
            // 所以这份 state 自带 180° 的旋转；飞向正置的展示位时 Flip 会把它一路转正
            // （rotation 是它必然补间的属性之一），观感上就是"牌从对面翻转着飞过来"。
            state: Flip.getState(slot),
            fromBack: slot.closest('.opponent-fan') !== null,
          }
    setReveal((current) => ({
      card,
      landingId,
      flipId: handInstanceId,
      key: (current?.key ?? 0) + 1,
    }))
    return true
  }

  useMatchEvents(driver, (events) => {
    for (const event of events) {
      switch (event.type) {
        case 'TURN_STARTED':
          showBanner(event.player === seatRef.current ? '你的回合' : '对方回合')
          break
        case 'MODEL_DAMAGED':
          // 事件是在 React 提交新局面之前送到的，所以被打的那张卡即使马上就要碎，
          // 此刻 DOM 里也还在，飘字正好落在它当时的位置上。
          showHit(`[data-model-id="${CSS.escape(event.instanceId)}"]`, event.amount)
          break
        case 'PLAYER_DAMAGED':
          showHit(`[data-player="${event.player}"]`, event.amount)
          break
        case 'MODEL_DEPLOYED': {
          // 我方模型走 Flip 从手牌飞过去，不要再叠一层进场动画。
          if (event.player === seatRef.current) break
          // 对方的模型先强制展示、再从展示位飞到战场行；受理不了才退回简易进场。
          // 落场用的 id 和手牌里那张是同一个（deployModel 沿用了手牌实例的 instanceId）。
          const id = event.model.instanceId
          if (!startReveal(handCardOfModel(event.model), id, id, true)) {
            popQueueRef.current.push(id)
          }
          break
        }
        case 'PROMPT_RESOLVED':
          // 对手打提示卡时画面上只有数字跳一下，根本看不出他打了什么，所以把卡面亮出来。
          // 受理不了（上一张还在展示）就跳过这一次展示：伤害飘字已经排进队列，稍后照播，
          // 玩家只是少看一眼牌面——这是连打时的降级路径。
          if (event.player !== seatRef.current) {
            startReveal(handCardOfDefinition(event.cardId), null, event.instanceId, false)
          }
          break
        default:
          break
      }
    }
  })

  // ---------- 出牌与选目标 ----------

  /** 我方指令发出去了：打开 awaiting，让 HandFan 把牌停在落点上等结果。 */
  function sendMine(command: Command): void {
    setAwaiting(true)
    driver.send(command)
  }

  /**
   * 手牌被打出（拖进战场松手，或者原地点一下）。
   *
   * 模型卡：先截 Flip 状态再发指令，牌一离开手牌就从原位飞到战场。
   * 提示卡：这一步只进入选目标态、不发指令。setPendingPrompt 会在本轮事件处理结束前
   * 同步 flush，于是 HandFan 的 disabled 当场变成 true，那张牌按 HandFanProps 的约定
   * 停在落点上等着——取消选目标时 disabled 回到 false，HandFan 自己会把它送回扇形；
   * 确认目标则发指令，牌离开手牌，什么都不用收拾。
   */
  const handlePlay = (instanceId: string) => {
    const instance = me.hand.find((item) => item.instanceId === instanceId)
    if (instance === undefined) return
    if (getCard(instance.cardId).kind === 'prompt') {
      setPendingPrompt({ instanceId })
      return
    }
    // 此刻手牌那张卡还在 DOM 里、还停在松手那一刻的位置，正好当飞行起点。
    // 查询限定在 .hand-fan 里：战场小卡、对手手牌、展示卡用的是同一套 data-flip-id，
    // 不限定会抓错元素。
    const slot = document.querySelector(`.hand-fan [data-flip-id="${CSS.escape(instanceId)}"]`)
    flipStateRef.current = slot === null ? null : { state: Flip.getState(slot), id: instanceId }
    sendMine({ type: 'PLAY_CARD', player: mySeat, instanceId })
  }

  /** 选中了一个目标（不传 instanceId 就是打本体）。 */
  const confirmTarget = (targetInstanceId?: InstanceId) => {
    const pending = pendingPrompt
    if (pending === null) return
    setPendingPrompt(null)
    sendMine({
      type: 'PLAY_CARD',
      player: mySeat,
      instanceId: pending.instanceId,
      targetInstanceId,
    })
  }

  /**
   * 测试房里点对方手牌：不管什么卡都当场打出去，提示卡不传 targetInstanceId，
   * 按引擎语义直击我方本体。
   *
   * 刻意简化：替对方出牌只是为了快速摆局面，让它也走一遍选目标，
   * 等于在测试房里多养一条"目标在我方这一侧"的分支，而这条分支真实对局里根本不存在。
   * 选目标只留给本端真实出牌那条路，测的才是玩家真会走的流程。
   */
  const playForFoe = (instance: CardInstance) => {
    // 展示或查看进行中一律不受理：这一下打出去必然带来一次强制展示，
    // 而两条链路共用展示卡这一个节点，抢起来就是两条 Flip 改同一个元素。
    if (revealBusyRef.current || reveal !== null || inspecting !== null) return
    driver.send({ type: 'DEBUG_PLAY_CARD', player: foeSeat, instanceId: instance.instanceId })
  }

  // 选目标时只放行对方那一侧：出牌方恒是本端，我方的小卡和面板永远不是提示卡的目标，
  // 所以下面我方侧的 targetable 一律写死 false。
  const picking = pendingPrompt !== null
  const pendingCard = findPendingCard(me, pendingPrompt)

  /**
   * 点空白处取消选目标。
   *
   * 绑 pointerdown 而不是 click：拖着提示卡在战场上松手时，pointerup 之后浏览器还会补一发
   * click，它会一路冒泡到根节点，用 click 的话刚进入的选目标态当场就被自己取消掉。
   * 与之配套，所有自己响应 pointerdown 的元素（战场小卡、玩家面板、测试房里的对方手牌、
   * 展示遮罩）都要 stopPropagation，否则点它们会先被这里取消。
   */
  const cancelPick = () => {
    if (pendingPrompt !== null) setPendingPrompt(null)
  }

  /**
   * 点战场上的一张小卡：交给展示层放大看，敌我两行一视同仁。
   *
   * 强制展示进行中（哪怕只是待播的 Flip 还挂着）一概不受理，反过来也一样：
   * 展示层只有一张卡、一条浮动，两条链路必须严格互斥。
   * 选目标时也不受理——那一下点击的含义是选目标或取消选目标，不是看牌。
   */
  const handleInspect = (model: ModelInstance) => {
    if (picking || reveal !== null || inspecting !== null) return
    if (
      revealBusyRef.current ||
      revealFlipRef.current !== null ||
      inspectFlipRef.current !== null ||
      inspectReturnRef.current !== null
    ) {
      return
    }
    // 查询限定在战场容器里，理由同 handlePlay。找到的是 tile 那一层，
    // 而 Flip 把它和展示卡对上号靠的是两边同一个 data-flip-id（就是 instanceId）。
    const slot = boardRef.current?.querySelector(
      `[data-model-id="${CSS.escape(model.instanceId)}"]`,
    )
    if (slot == null) return
    // 此刻格子还是可见的（held 要等这次 setState 之后才生效），量到的正是起飞位置。
    inspectFlipRef.current = Flip.getState(slot)
    openInspect({ card: handCardOfModel(model), instanceId: model.instanceId })
  }

  /**
   * 点遮罩（放大查看时点屏幕任意处都会落在它上面）就把查看关掉。
   *
   * 强制展示期间同样会点到这块遮罩，但那条链路是不可跳过的，所以这里靠 inspecting 判空挡掉；
   * 飞入还没落位、以及已经在飞回路上时也都不受理，免得重复触发。
   */
  const handleShowcaseClick = () => {
    if (inspecting === null || !inspectHeldRef.current || inspectReturnRef.current !== null) return
    inspectHeldRef.current = false
    floatRef.current?.kill()
    floatRef.current = null
    const el = revealCardRef.current
    // 趁展示卡还在屏幕中央、还没被 React 摘掉，量下它此刻的位置当飞回的起点。
    if (el !== null) {
      inspectReturnRef.current = { state: Flip.getState(el), id: inspecting.instanceId }
    }
    closeInspect()
  }

  // 展示和查看期间遮罩本来就吃掉了全部指针事件，这两个 disabled 只是兜底
  // （也顺带让手牌和结束回合按钮在视觉上就是关着的）。
  const showcasing = reveal !== null || inspecting !== null
  const handDisabled = !myTurn || picking || view.status !== 'playing' || awaiting || showcasing
  const endTurnDisabled = !myTurn || picking || awaiting || view.status !== 'playing' || showcasing

  /**
   * 现算的话每次渲染都是个新数组，两个 Fan 的 useGSAP 会跟着重跑一遍归位补间；
   * 而这个组件光是 awaiting / reveal / pendingPrompt 变一下就要重渲染好几次，
   * 手牌根本没动却在那儿反复补间。按 hand 记住，手牌真换了才重建。
   */
  const handCards = useMemo(() => me.hand.map(handCardOfInstance), [me.hand])
  const foeHandCards = useMemo(() => foe.hand.map(handCardOfInstance), [foe.hand])

  // ---------- 飞行与进场 ----------

  useGSAP(
    (_context, safe) => {
      const pending = flipStateRef.current
      if (pending !== null) {
        flipStateRef.current = null
        // 必须显式把战场上的新元素交给 Flip：不传 targets 的话它会退回用 state.targets，
        // 也就是手牌里那个已经被 React 摘掉的旧节点，补间挂在脱离文档的 div 上，
        // 战场小卡一动不动。Flip 不会自己按 data-flip-id 去全文档找新元素（架构 5.5）。
        const target = document.querySelector<HTMLElement>(
          `.battle__board [data-flip-id="${CSS.escape(pending.id)}"]`,
        )
        if (target !== null) {
          // 落地特效是在 onComplete 里才建的补间，出了 useGSAP 回调的同步区间，
          // 不用 contextSafe 包一层就不归 context 管，组件卸载时 revert 不掉。
          const landed = () => playSummonFx(target)
          Flip.from(pending.state, {
            targets: target,
            duration: 0.65,
            ease: 'power2.inOut',
            // 用 scale 而不是 width/height，卡面里的字会跟着一起缩，看起来才像同一张卡在变小。
            scale: true,
            // 飞行途中盖住手牌；战场容器本身没有层叠上下文，所以这个层级是全局有效的。
            zIndex: 60,
            onComplete: safe ? safe(landed) : landed,
          })
        }
      }

      const pops = popQueueRef.current
      if (pops.length === 0) return
      popQueueRef.current = []
      for (const id of pops) {
        const tile = boardRef.current?.querySelector<HTMLElement>(
          `[data-model-id="${CSS.escape(id)}"]`,
        )
        if (tile == null) continue
        gsap.fromTo(
          tile,
          { scale: 0.6, autoAlpha: 0 },
          { scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(1.7)', overwrite: 'auto' },
        )
      }
    },
    { dependencies: [view] },
  )

  // 强制展示：遮罩淡入 + 卡从对手手牌飞到屏幕中央并翻正 + 停 1.5 秒 + 收尾。
  // 两个分支各管一程：reveal 从空变成有牌时飞进展示位，
  // 从有牌变回空时（模型卡）从展示位接着飞到对方战场行并落地。
  useGSAP(
    (_context, safe) => {
      if (reveal !== null) {
        const card = revealCardRef.current
        const overlay = overlayRef.current
        if (card === null || overlay === null) {
          // 理论上到不了：reveal 非空时展示卡就在同一次渲染里，layout effect 里 ref 必然已挂上。
          // 真到了这儿也得把闸放开，否则 revealBusyRef 会永远卡在 true，
          // 之后的特效全堵在队列里、也再没有第二次展示。
          revealBusyRef.current = false
          flushFx()
          return
        }
        const pending = revealFlipRef.current
        revealFlipRef.current = null
        const { landingId, key: shownKey } = reveal

        // 遮罩接管所有指针事件：强制动画期间玩家什么都点不了。
        // 用 autoAlpha 而不是 opacity——它顺手改 visibility，遮罩看不见时就不吃指针事件。
        //
        // 遮罩上的四条补间（两条链路各一进一出）都必须 overwrite: 'auto'。遮罩是常驻节点，
        // 两条链路紧挨着衔接时会同时有补间活着：比如刚点关闭查看、返程的淡出还在跑（0.3s），
        // 对手就出了牌，这条淡入随即起跑。默认不 overwrite 的话两条一起改 autoAlpha，
        // 后结束的那条说了算——淡出赢了遮罩就停在 0（visibility: hidden），
        // 强制展示期间玩家能点穿遮罩。让新补间干净接管旧的就没有这回事。
        gsap.to(overlay, {
          autoAlpha: 1,
          duration: OVERLAY_IN_DUR,
          ease: 'power2.out',
          overwrite: 'auto',
        })

        const inner = card.querySelector<HTMLElement>('.reveal-card__inner')
        // 起飞那一瞬间必须和起飞点长得一模一样，不能跳变：倒扇形里是牌背，测试房摊开条是正面。
        // 走 setFlipAngle 而不是裸 gsap.set：正反两面谁可见是按角度切 opacity 决定的。
        const fromBack = pending?.fromBack === true
        if (inner !== null) setFlipAngle(inner, fromBack ? 180 : 0)

        /** 停留到点：停浮动、遮罩淡出，模型卡把位置交给下一段飞行，提示卡原地淡出。 */
        const finish = () => {
          floatRef.current?.kill()
          floatRef.current = null
          const el = revealCardRef.current
          gsap.to(overlay, {
            autoAlpha: 0,
            duration: OVERLAY_OUT_DUR,
            ease: 'power2.in',
            // 同上面那条淡入：遮罩上的补间一律 overwrite: 'auto'。
            overwrite: 'auto',
            onComplete: () => {
              revealBusyRef.current = false
              flushFx()
            },
          })
          if (landingId !== null) {
            // 在卡还停在屏幕中央、还没被 React 摘掉的这一帧取位置，下一段飞行从这儿接着走。
            if (el !== null) landingFlipRef.current = { state: Flip.getState(el), id: landingId }
            setReveal(null)
            return
          }
          if (el === null) {
            setReveal(null)
            return
          }
          // 提示卡没有落点，原地淡出。必须等淡出跑完再清 state：
          // 先清的话元素当场就没了，这段淡出根本演不出来。
          gsap.to(el, {
            autoAlpha: 0,
            scale: 0.94,
            duration: 0.32,
            ease: 'power2.in',
            // 只清掉自己这一次的展示：淡出（0.32s）比遮罩淡出（0.3s）收得晚，
            // 中间那一小会儿 revealBusyRef 已经放开，理论上够下一张牌插进来。
            onComplete: () => setReveal((current) => (current?.key === shownKey ? null : current)),
          })
        }
        // delayedCall 的回调是 1.5 秒后才跑的，那时早已出了 useGSAP 回调的同步区间，
        // 里面新建的补间不包一层就不归 context 管。
        const finishSafe = safe ? safe(finish) : finish

        const revealed = () => {
          // 卡已经整张落在顶栏下方，裁剪层可以撤了——留着的话呼吸浮动和之后的落场飞行
          // 万一擦到顶栏那条线还会被裁一下。这一刻裁剪本来就没裁到任何东西，撤掉看不出变化。
          const clip = revealClipRef.current
          if (clip !== null) gsap.set(clip, { clipPath: 'none' })
          // 停留期间极轻微地上下浮，免得画面完全定住像卡住了。
          // 浮动写在展示卡自己的 y 上没问题：Flip 落位时已经把飞行用的内联 transform 收干净了，
          // 收尾时也会先 kill 掉它再取位置，两者不会抢同一个属性。
          // 参数和放大查看那条链路完全一致，两处停留的观感必须一样。
          floatRef.current = gsap.to(card, {
            y: '-=8',
            duration: 1.15,
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut',
          })
          gsap.delayedCall(REVEAL_HOLD, finishSafe)
        }
        const revealedSafe = safe ? safe(revealed) : revealed

        if (pending === null) {
          // 找不到起飞点时的降级路径（只有提示卡会走到这儿）：没有 Flip 起点就从中央淡入，
          // 裁剪也就没有意义了，直接撤掉。
          const clip = revealClipRef.current
          if (clip !== null) gsap.set(clip, { clipPath: 'none' })
          gsap.fromTo(
            card,
            { autoAlpha: 0, scale: 0.82, y: 24 },
            {
              autoAlpha: 1,
              scale: 1,
              y: 0,
              duration: 0.28,
              ease: 'back.out(1.6)',
              onComplete: revealedSafe,
            },
          )
          return
        }

        Flip.from(pending.state, {
          targets: card,
          duration: REVEAL_IN_DUR,
          ease: 'power3.inOut',
          scale: true,
          onComplete: revealedSafe,
        })
        // 和飞行同时进行的背面→正面翻转。从 180 转到 360 而不是转回 0：
        // 两条路都经过"侧对观察者"的那一瞬间，但同向续转不会出现半路掉头的观感。
        if (inner !== null && fromBack) flipTo(inner, 360, REVEAL_IN_DUR)
        return
      }

      const landing = landingFlipRef.current
      if (landing === null) return
      landingFlipRef.current = null
      // 落点那个格子此刻已经跟着 held 变 false 恢复可见了。useGSAP 是 layout effect，
      // 恢复可见和 Flip 把它摆到起飞位置发生在同一次绘制之前，中间不会闪一下空格子。
      const tile = boardRef.current?.querySelector<HTMLElement>(
        `[data-flip-id="${CSS.escape(landing.id)}"]`,
      )
      if (tile == null) return
      // 同我方出牌：onComplete 出了同步区间，里面新建的特效补间必须包一层才归 context 管。
      const landed = () => playSummonFx(tile)
      Flip.from(landing.state, {
        targets: tile,
        duration: REVEAL_OUT_DUR,
        ease: 'power2.inOut',
        scale: true,
        // 层级必须给：飞行途中要压过正在淡出的遮罩（1100）。
        zIndex: REVEAL_FLIGHT_Z,
        onComplete: safe ? safe(landed) : landed,
      })
    },
    { dependencies: [reveal] },
  )

  // 放大查看战场小卡。两个分支各管一程：inspecting 从空变成有牌时飞进展示位，
  // 从有牌变回空时飞回原来的格子。时长和层级全部复用强制展示那套，两条链路的手感才一致。
  useGSAP(
    (_context, safe) => {
      const pending = inspectFlipRef.current
      if (pending !== null && inspecting !== null) {
        inspectFlipRef.current = null
        const card = revealCardRef.current
        const overlay = overlayRef.current
        if (card === null || overlay === null) return

        // 同强制展示：autoAlpha 顺手改 visibility，遮罩看不见时不吃指针事件；
        // overwrite 的理由也一样（见那边淡入上面的说明）。
        gsap.to(overlay, {
          autoAlpha: 1,
          duration: OVERLAY_IN_DUR,
          ease: 'power2.out',
          overwrite: 'auto',
        })

        // 战场上的牌本来就正面朝上，这条链路整段不翻面，直接把翻面层定死在正面。
        // 仍然走 setFlipAngle 而不是裸 gsap.set：正反两面谁可见是由角度切 opacity 决定的。
        const inner = card.querySelector<HTMLElement>('.reveal-card__inner')
        if (inner !== null) setFlipAngle(inner, 0)

        // 裁剪层直接撤掉，不像强制展示那样留到落位。那份裁剪是给"从顶栏后面起飞"的对手牌准备的，
        // 而战场格子整个在顶栏下方，这条链路从头到尾都用不着；留着反而会在呼吸浮动
        // 擦到顶栏那条线时把卡裁掉一截（同 .reveal-clip 的 CSS 注释里说的那个问题）。
        const clip = revealClipRef.current
        if (clip !== null) gsap.set(clip, { clipPath: 'none' })

        // onComplete 是飞完才跑的，出了 useGSAP 回调的同步区间，
        // 里面新建的浮动补间不包一层就不归 context 管，组件卸载时 revert 不掉。
        const landed = () => {
          inspectHeldRef.current = true
          // 浮动参数和强制展示的 revealed() 完全一致，两处停留的观感必须一样。
          floatRef.current = gsap.to(card, {
            y: '-=8',
            duration: 1.15,
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut',
          })
        }

        Flip.from(pending, {
          targets: card,
          duration: REVEAL_IN_DUR,
          ease: 'power3.inOut',
          scale: true,
          onComplete: safe ? safe(landed) : landed,
        })
        return
      }

      const back = inspectReturnRef.current
      if (back === null || inspecting !== null) return
      inspectReturnRef.current = null
      const overlay = overlayRef.current
      if (overlay === null) return
      gsap.to(overlay, {
        autoAlpha: 0,
        duration: OVERLAY_OUT_DUR,
        ease: 'power2.in',
        overwrite: 'auto',
      })
      // 原来那个格子此刻已经跟着 held 变 false 恢复可见了。useGSAP 是 layout effect，
      // 恢复可见和 Flip 把它摆到起飞位置发生在同一次绘制之前，中间不会闪一下空格子。
      const target = boardRef.current?.querySelector<HTMLElement>(
        `[data-flip-id="${CSS.escape(back.id)}"]`,
      )
      if (target == null) return
      Flip.from(back.state, {
        targets: target,
        duration: REVEAL_OUT_DUR,
        ease: 'power2.inOut',
        scale: true,
        // 层级必须给：飞回途中要压过正在淡出的遮罩（1100），同对手牌落场那段飞行。
        zIndex: REVEAL_FLIGHT_Z,
      })
    },
    { dependencies: [inspecting] },
  )

  // 战场小卡的倾斜跟随。单独开一个 useGSAP 而不是并进上面那些：
  // 那些都有"没有待播的动画就直接 return"的早退，挂在它们后面会被跳过。
  useGSAP(
    () => {
      // 只给新落到战场上的 tile 挂、只摘掉已经不在场上的，其余原样留着。
      // 不能图省事整批重挂：detach 会把倾斜和高光硬切回零，而指针很可能正停在一张
      // 早就在场上的小卡上——再打出一张牌，那张卡的倾斜就会突然弹平、高光凭空消失，
      // 指针不动就不再有 pointermove，也就再也回不来（架构 5.7）。
      //
      // 另外，依赖数组非空时 useGSAP 只在**卸载**时 revert，下面 return 的清理函数
      // 在 view 变化时根本不会跑，所以离场的 tile 必须在这里自己摘。
      const root = boardRef.current
      const tiles = root === null ? [] : root.querySelectorAll<HTMLElement>('.battle__tile')
      const alive = new Set<HTMLElement>(tiles)
      for (const tile of tiles) {
        if (tiltsRef.current.has(tile)) continue
        // 倾斜和 hover 放大都写在 tile 内层：飞行途中 tile 自己的 transform 归 Flip 管，
        // 往上面再写 rotationX / scale 就是两边抢同一个属性。
        // 挂在内层的话飞行中被 hover 也不会出怪相。
        tiltsRef.current.set(
          tile,
          attachCardTilt(tile, {
            tiltLayer: '.battle__tile-tilt',
            maxTilt: TILE_TILT_DEG,
            hoverScale: TILE_HOVER_SCALE,
          }),
        )
      }
      for (const [tile, handle] of tiltsRef.current) {
        if (alive.has(tile)) continue
        handle.detach()
        tiltsRef.current.delete(tile)
      }
      // 只有卸载会走到这里，但还是要留着：卸载时得把监听和补间一起收掉。
      return () => {
        for (const handle of tiltsRef.current.values()) handle.detach()
        tiltsRef.current.clear()
      }
    },
    { scope: boardRef, dependencies: [view] },
  )

  // 上场特效里只有烟尘是直接 appendChild 进烟尘层的，React 不认识它们
  // （追光那两层归 React 渲染，跟着 tile 一起卸载，不用管）。
  // 正常情况下每团烟尘在自己的 onComplete 里自杀，但卸载时补间是被 revert 掉的、
  // onComplete 不会跑，所以这里兜底把整层清空。
  useEffect(() => {
    const layer = smokeLayerRef.current
    return () => layer?.replaceChildren()
  }, [])

  const finished = view.status === 'finished' || view.status === 'aborted'

  /**
   * 展示层当前要渲染的那张卡：强制展示优先（它不可打断），否则是正在放大查看的那张。
   * 两条链路互斥，实际上不会同时非空，这个分支只是把"到底渲染谁"收成一处。
   *
   * key 让两条链路各自持有一份展示卡（对手出牌会中止正在进行的查看，两者相接时
   * DOM 不能被复用）：裁剪层每次都是新挂载的，上一轮撤裁剪时写的内联样式不会留到下一轮。
   */
  const showcase =
    reveal !== null
      ? { card: reveal.card, flipId: reveal.flipId, key: `reveal-${reveal.key}` }
      : inspecting !== null
        ? {
            card: inspecting.card,
            flipId: inspecting.instanceId,
            key: `inspect-${inspecting.instanceId}`,
          }
        : null

  return (
    <div className="battle" onPointerDown={cancelPick}>
      <HandDrawnFilterDefs />
      <BattleTopBar />

      <div className="battle__layout">
        <aside className="battle__sidebar battle__sidebar--left" aria-label="双方状态">
          <OrnateFrame className="battle__sidebar-frame battle__sidebar-frame--players">
            <PlayerPanel player={foe} targetable={picking} onPick={() => confirmTarget()} />
            <PlayerPanel player={me} targetable={false} onPick={() => confirmTarget()} />
          </OrnateFrame>
        </aside>

        <main className={`battle__battlefield${testMode ? ' battle__battlefield--test' : ''}`}>
          {testMode ? <FoeHand hand={foe.hand} onPlay={playForFoe} /> : null}

          <div className="battle__board" ref={boardRef}>
            <span className="battle__drop-cue battle__drop-cue--board" aria-hidden="true">
              <strong>松手</strong>
              放到场上
            </span>
            {/* 烟尘挂在这一层，不塞进 tile：tile 的裁剪层 overflow: hidden 会把它切掉。
                刻意不给它 z-index，也刻意排在两行之前，飞行中的卡（zIndex 60 / 1200）
                和场上的 tile 才都压得住它。 */}
            <div className="battle__smoke-layer" ref={smokeLayerRef} aria-hidden="true" />

            <div className="battle__row battle__row--foe">
              {foe.board.map((model) => (
                <BoardTile
                  key={model.instanceId}
                  model={model}
                  targetable={picking}
                  picking={picking}
                  // 对方的模型有两种"由展示层代管"：玩家点开查看，或者它正停在展示位上等落场。
                  held={
                    inspecting?.instanceId === model.instanceId ||
                    reveal?.landingId === model.instanceId
                  }
                  onPick={() => confirmTarget(model.instanceId)}
                  onInspect={() => handleInspect(model)}
                />
              ))}
            </div>

            <div className="battle__row battle__row--mine">
              {me.board.length === 0 ? (
                <span className="battle__board-hint">将手牌拖入战场</span>
              ) : (
                me.board.map((model) => (
                  <BoardTile
                    key={model.instanceId}
                    model={model}
                    targetable={false}
                    picking={picking}
                    held={inspecting?.instanceId === model.instanceId}
                    onPick={() => confirmTarget(model.instanceId)}
                    onInspect={() => handleInspect(model)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="battle__return-zone" ref={returnZoneRef} aria-hidden="true">
            <span className="battle__drop-cue battle__drop-cue--return">
              <strong>松手</strong>
              放回手牌
            </span>
          </div>

          {picking ? (
            <div className="battle__pick-hint">
              <span>选一个目标打出「{pendingCard?.name ?? '这张牌'}」</span>
              <button type="button" className="battle__pick-cancel" onClick={cancelPick}>
                取消
              </button>
            </div>
          ) : null}
          {view.lastRejection !== null ? (
            <div className="battle__reject">{view.lastRejection}</div>
          ) : null}
        </main>

        <aside className="battle__sidebar battle__sidebar--right" aria-label="回合操作">
          <OrnateFrame className="battle__sidebar-frame battle__sidebar-frame--actions">
            <div className="battle__turn">
              <span className="battle__turn-round">第 {state.turn} 回合</span>
              <span className="battle__turn-who">
                {view.status !== 'playing'
                  ? '对局结束'
                  : myTurn
                    ? '轮到你了'
                    : `${state.players[state.activePlayer].name} 行动中…`}
              </span>
            </div>
            <PlaqueButton
              disabled={endTurnDisabled}
              onClick={() => sendMine({ type: 'END_TURN', player: mySeat })}
            >
              结束回合
            </PlaqueButton>
          </OrnateFrame>
        </aside>
      </div>

      {/* 对手手牌：吊在视口顶边的倒扇形，只显示张数、当强制展示的起飞点。
          恒 disabled——本项目不防作弊（架构 4.1），客人手里确实有对手的牌，
          但玩家不该点得动它。张数信息侧栏的玩家面板本来就有一份。 */}
      {testMode ? null : <OpponentFan cards={foeHandCards} onReveal={noopReveal} disabled />}

      <HandFan
        cards={handCards}
        dropZoneRef={boardRef}
        returnZoneRef={returnZoneRef}
        onPlay={handlePlay}
        disabled={handDisabled}
      />

      <div className="battle__fx" ref={fxRef} aria-hidden="true" />

      {/*
        展示层，强制展示和放大查看共用。遮罩常驻 DOM（默认 visibility: hidden，不吃指针事件），
        这样停留结束后它能自己淡出去——挂在 state 上的话，state 一清元素就没了，淡出无从谈起。
        展示卡则跟着 showcase 存亡：强制展示要拿它当 Flip 的起点，把飞行接力给战场上的新 tile；
        放大查看则拿它当飞回原格的起点。
        遮罩淡入之后吃掉全部指针事件：强制展示期间玩家什么都点不了，
        而放大查看期间点它（也就是点屏幕任意处）就是关闭查看。

        遮罩（z 1100）也压着结算层（90）：对手用提示卡打死我方本体时，
        结算画面会在展示的这两秒里被压暗模糊，遮罩淡出后恢复。这一档可以接受，
        不为它给强制展示加快进——那两秒本来就是"看清楚对手打了什么"的。
      */}
      <div
        className={
          inspecting !== null ? 'reveal-overlay reveal-overlay--closable' : 'reveal-overlay'
        }
        ref={overlayRef}
        aria-hidden="true"
        onClick={handleShowcaseClick}
        // 挡住冒泡，理由同别的自己响应 pointerdown 的元素（见 cancelPick）：
        // 不挡的话展示期间点一下会顺手把还挂着的选目标态取消掉。
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => event.stopPropagation()}
      />
      {showcase !== null ? (
        <div className="reveal-clip" key={showcase.key} ref={revealClipRef}>
          <div className="reveal-card" ref={revealCardRef} data-flip-id={showcase.flipId}>
            {/* 翻面层，结构和手牌一致：两面重叠、由 flipTo 按角度切 opacity（见 ui/flipCard.ts）。
                放大查看不翻面，只用 setFlipAngle 把它定死在正面。 */}
            <div className="reveal-card__inner">
              <div className="reveal-card__face" data-flip-face="front">
                {/* 卡面布局尺寸仍是 150×210，靠这一层整体放大，字和描边才一起变大而不是被拉伸。 */}
                <div className="reveal-card__scale">
                  <HandCardFace card={showcase.card} />
                </div>
              </div>
              <div className="reveal-card__face reveal-card__face--back" data-flip-face="back">
                {/* 背面必须是对手手牌里那张一模一样的隐藏牌背，起飞瞬间才不会跳变。
                    放大查看和测试房的摊开手牌用不到这一面，那两条路整段都是正面朝上。 */}
                <div className="reveal-card__scale">
                  <CardBackHidden />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {finished ? (
        <div className="battle__result">
          <p className="battle__result-title">
            {view.status === 'aborted'
              ? view.abortReason
              : state.winner === mySeat
                ? '你赢了'
                : '你输了'}
          </p>
          <div className="battle__result-actions">{resultActions}</div>
        </div>
      ) : null}
    </div>
  )
}

/** 侧栏里的一块玩家面板，同时是"打本体"的目标和 PLAYER_DAMAGED 飘字的定位锚。 */
function PlayerPanel({
  player,
  targetable,
  onPick,
}: {
  player: PlayerState
  targetable: boolean
  onPick: () => void
}) {
  return (
    <div
      className="battle__player-panel"
      data-player={player.id}
      data-targetable={targetable ? 'true' : undefined}
      // 目标一律绑 pointerdown 并挡住冒泡，原因见 cancelPick 上的说明。
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (!targetable) return
        event.stopPropagation()
        onPick()
      }}
    >
      <span className="battle__player-name">{player.name}</span>
      <span className="battle__player-integrity">{player.integrity}</span>
      <span className="battle__player-compute">
        算力 {player.compute}/{player.computeMax}
      </span>
      <span className="battle__player-piles">
        手牌 {player.hand.length} · 牌堆 {player.deck.length}
      </span>
    </div>
  )
}

/**
 * 场上的一张小卡。三层结构：tile 管 Flip 飞行，tilt 管倾斜和裁剪，inner 是整张卡面缩小。
 *
 * held 表示这张卡此刻由展示层代管（玩家正放大查看它，或者对手打出的模型还停在展示位）：
 * 格子还占着位置，但整张卡不可见（见 .battle__tile--held），
 * 免得屏幕中央和战场上同时出现两张一模一样的卡。
 */
function BoardTile({
  model,
  targetable,
  picking,
  held,
  onPick,
  onInspect,
}: {
  model: ModelInstance
  targetable: boolean
  /** 正在选目标。此时点小卡的含义是选目标或取消选目标，都不该打开放大查看。 */
  picking: boolean
  held: boolean
  onPick: () => void
  onInspect: () => void
}) {
  const card = handCardOfModel(model)
  return (
    <div
      className={held ? 'battle__tile battle__tile--held' : 'battle__tile'}
      // data-model-id 全场唯一，事件层靠它定位伤害飘字和抖动。
      // data-flip-id 敌我两侧都要给：它是 Flip 用来把两个容器里的节点对号的键，
      // 我方靠它把手牌里的旧节点接到战场上的新节点，对方靠它把展示卡接到落场的格子，
      // 放大查看的飞回也靠它。实例 id 形如 p1-c7，本来就全局唯一，标上不会撞车。
      data-model-id={model.instanceId}
      data-flip-id={model.instanceId}
      data-targetable={targetable ? 'true' : undefined}
      role="button"
      tabIndex={0}
      aria-label={`查看 ${card.name}`}
      // 打开查看走 pointerdown 而不是 click，和选目标同一套时序考虑：
      // 选目标时 pointerdown 里的 confirmTarget 会同步清掉 pendingPrompt，随后浏览器补发的
      // click 拿到的已经是 picking = false 的新 props，用 click 就会在选完目标那一瞬间
      // 误开一次放大查看；同理我方小卡在选目标态下 pointerdown 冒泡到根节点取消选目标，
      // 那一下补发的 click 也不能再开查看。所以这条路上一个 click 处理器都不能留。
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (targetable) {
          event.stopPropagation()
          onPick()
          return
        }
        // 选目标时这一下要冒泡到根节点去取消选目标（见 cancelPick），什么都不做。
        if (picking) return
        event.stopPropagation()
        onInspect()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        // 空格在这个位置的默认行为是把页面往下滚一屏，回车也可能被外层当成提交，都不要。
        event.preventDefault()
        if (targetable) {
          onPick()
          return
        }
        if (picking) return
        onInspect()
      }}
    >
      <div className="battle__tile-tilt">
        <div className="battle__tile-inner">
          <HandCardFace card={card} />
        </div>
      </div>
      {/*
        上场时沿卡牌边缘跑一圈的金色追光。放在裁剪层外面：那一层 overflow: hidden，
        会把环外的辉光整圈切掉。里外两层的分工见 styles.css 的 .battle__tile-edge。
      */}
      <div className="battle__tile-edge" aria-hidden="true">
        <div className="battle__tile-edge-ring" />
      </div>
    </div>
  )
}

/**
 * 测试房里摊开的对方手牌：真实卡面，点一下就替对方打出去，方便一个人调试双方的出牌流程。
 *
 * 只有测试房才渲染它。正式对局用的是顶边的倒扇形牌背（OpponentFan）——
 * 本项目不防作弊（架构 4.1），客人手里其实有对手的完整手牌数据，
 * 但把它明晃晃摊在屏幕上没法玩。
 */
function FoeHand({
  hand,
  onPlay,
}: {
  hand: readonly CardInstance[]
  onPlay: (instance: CardInstance) => void
}) {
  return (
    <div className="battle__foe-hand battle__foe-hand--open" aria-label="对方手牌（测试房）">
      {hand.length === 0 ? <span className="battle__foe-count">对方没有手牌</span> : null}
      {hand.map((instance) => (
        <div
          key={instance.instanceId}
          className="battle__foe-card"
          // 强制展示是一次跨容器的 FLIP，这张牌打出去时就是从这个位置起飞的（见 startReveal）。
          data-flip-id={instance.instanceId}
          title="点一下替对方打出这张牌"
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
            // 同样要挡冒泡：这一下要是传到根节点，会被当成"点空白处取消"，
            // 把我方正在进行的选目标态顺手清掉。
            event.stopPropagation()
            onPlay(instance)
          }}
        >
          <div className="battle__foe-card-inner">
            <HandCardFace card={handCardOfInstance(instance)} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 从手牌实例拼出卡面数据。id 用实例 id：Flip 和事件定位都靠它对号。 */
function handCardOfInstance(instance: CardInstance): HandCardData {
  return { ...handCardOfDefinition(instance.cardId), id: instance.instanceId }
}

/** 从卡牌定义拼出卡面数据。id 只是给 React 当 key 用，不参与 Flip。 */
function handCardOfDefinition(cardId: CardId): HandCardData {
  const card = getCard(cardId)
  if (card.kind === 'model') {
    return {
      ...cardPresentation(card),
      id: card.id,
      name: card.name,
      cost: card.cost,
      kind: 'model',
      power: card.power,
      integrity: card.integrity,
      weaknesses: exposedWeaknesses(card.weaknesses),
      text: card.text,
      backText: cardBackText(card),
    }
  }
  return {
    ...cardPresentation(card),
    id: card.id,
    name: card.name,
    cost: card.cost,
    kind: 'prompt',
    damage: card.damage,
    targetWeakness: card.targetWeakness,
    text: card.text,
    backText: cardBackText(card),
  }
}

/**
 * 从场上的模型实例拼出卡面数据。
 *
 * 数值一律读实例：受伤和增益都写在实例上，读卡牌定义的话战场小卡会永远显示满血。
 */
function handCardOfModel(model: ModelInstance): HandCardData {
  const card = getCard(model.cardId)
  return {
    ...cardPresentation(card),
    id: model.instanceId,
    name: card.name,
    cost: card.cost,
    kind: 'model',
    power: model.power,
    integrity: model.integrity,
    weaknesses: exposedWeaknesses(model.weaknesses),
    text: card.text,
    // 战场小卡和放大查看都只看正面，这份文案没有地方会显示出来。
    backText: '',
  }
}

/** 只留下大于 0 的维度，卡面上那一行才不会被六个 0 撑满。 */
function exposedWeaknesses(profile: Record<WeaknessKind, number>): Partial<Record<WeaknessKind, number>> {
  const exposed: Partial<Record<WeaknessKind, number>> = {}
  for (const kind of WEAKNESS_KINDS) {
    if (profile[kind] > 0) exposed[kind] = profile[kind]
  }
  return exposed
}

/** 正在选目标的那张提示卡，用来在提示条上写卡名。它还在我方手里，没离开手牌。 */
function findPendingCard(me: PlayerState, pending: PendingPrompt | null): Card | null {
  if (pending === null) return null
  const instance = me.hand.find((item) => item.instanceId === pending.instanceId)
  return instance === undefined ? null : getCard(instance.cardId)
}
