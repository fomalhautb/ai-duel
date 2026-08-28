/**
 * 对局界面。只认一个 MatchDriver，不知道自己在打热座、联机还是 dev 测试房。
 *
 * 画面骨架照设计稿来：顶栏 + 左右两块纸面侧栏 + 中间战场，底部一排扇形手牌。
 * 位置和动画一律交给 GSAP 直接改 DOM（架构 5.5），React 只负责"有哪些元素、它们是什么状态"。
 *
 * 两条订阅各司其职：
 * - `useMatch` 拿快照，渲染"事件全部应用完"的结果；
 * - `useMatchEvents` 拿事件流，播过程动画（回合横幅、抛硬币、答题揭晓、打出的技能牌）。
 *   事件订阅者全局只允许一个（架构 5.2），所以整个应用里只能有这一处 useMatchEvents。
 *
 * 阶段动画分两档：
 * - 全屏过场（开局抛硬币、答题揭晓）挂在 React 状态上，压暗整个战场演一段再退场；
 * - 轻量提示（第几轮、轮到谁出牌）走中央横幅，一次只播一条，多条排队。
 * 视觉全是占位，只求节奏顺、看得懂，美术另做。
 */

import { useRef, useState, useEffect, useMemo } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { getCard, other } from '@ai-duel/core'
import type {
  AgentInstance,
  CardId,
  CardInstance,
  Command,
  GameState,
  InstanceId,
  PlayerId,
  PlayerState,
  Question,
} from '@ai-duel/core'
import { useMatch, useMatchEvents } from '../match/useMatch'
import type { MatchDriver, MatchView } from '../match/driver'
import { BattleTopBar } from './BattleTopBar'
import { HandCardFace, HandFan } from './HandFan'
import type { HandCardData } from './HandFan'
import { HandDrawnFilterDefs } from './HandDrawnFilterDefs'
import { OrnateFrame } from './OrnateFrame'
import { PlaqueButton } from './PlaqueButton'
import { attachCardTilt } from './cardTilt'
import type { CardTiltHandle } from './cardTilt'
import { syncFlipFaces } from './flipCard'
import { QUESTION_CATEGORY_LABELS } from './labels'

gsap.registerPlugin(useGSAP, Flip)

/**
 * 战场小卡跟着指针倾斜的最大角度。
 *
 * 比手牌大卡（10°）大一点：小卡在屏幕上只占 110×154，同样的角度看起来位移小得多，
 * 要稍微加点量才看得出来。小卡不放大也不位移，倾斜就是它唯一的 hover 反馈。
 */
const TILE_TILT_DEG = 12
/** 打出的技能卡在战场中央停留多久（秒），停完淡出。 */
const SKILL_SHOWCASE_HOLD = 1.2

/** 硬币转多久（秒）落定。 */
const COIN_SPIN = 1.6
/**
 * 硬币转几整圈之后才停到该停的那一面。
 *
 * 整圈数决定"转"的观感；落到哪一面是另外加的 180°（背面）或 0°（正面），
 * 所以这个数只影响转多久看着够不够劲，不影响结果。
 */
const COIN_SPINS = 4
/** 硬币停稳后停留多久（秒）再整层淡出，留出看清「谁先出牌」的时间。 */
const COIN_HOLD = 0.8

/** 答题结果逐条淡入的间隔（秒）。 */
const QUIZ_ROW_STAGGER = 0.16
/** 计分那行出来之后停留多久（秒）再整层淡出，露出已经更新的战场和比分。 */
const QUIZ_HOLD = 1.1

/** 一条中央横幅从淡入到淡出的总时长（秒），排队时按它算下一条什么时候上。 */
const BANNER_IN = 0.3
const BANNER_HOLD = 0.75
const BANNER_OUT = 0.35

/** 答题揭晓层里的一行结果，全部由 AGENT_ANSWERED 事件当场攒出来。 */
interface QuizAnswerRow {
  instanceId: InstanceId
  /** 这个 AI 是我方的还是对方的。收到事件时就按当时的座位算好，渲染时不用再查局面。 */
  mine: boolean
  name: string
  correct: boolean
  answerText: string
}

/**
 * 答题全屏揭晓层的全部内容。
 *
 * 结果**只**存在这里，不去战场上找被罚下的那张小卡：事件是在 React 提交新快照之前送到的，
 * 提交一完成，答错的 tile 立刻就从战场上消失了，没有机会在它身上播罚下动画。
 * 所以这一层刻意盖住整个战场，把那次跳变藏在自己后面（见计划的"关键陷阱"）。
 */
interface QuizReveal {
  /** 每次揭晓换一个新的 key，用来重新触发下面几段 useGSAP，并识别"这条时间线是不是自己的"。 */
  key: number
  question: Question
  /** AGENT_ANSWERED 逐条追加。 */
  rows: QuizAnswerRow[]
  /** ROUND_SCORED 到了才有；它一到就说明这一轮播完了，可以走收尾。 */
  gains: { mine: number; theirs: number } | null
}

export interface MatchStageProps {
  driver: MatchDriver
  /**
   * dev 测试房模式：对方手牌摊开显示真实卡面，点一下就替对方打出去（走 DEBUG_PLAY_CARD，
   * 无视出牌轮次）。正式对局一律为 false，那时对方手牌只是一叠卡背。
   */
  testMode?: boolean
  /** 结算层里的按钮，由各个界面自己决定是"再来一局"还是"回首页"。 */
  resultActions?: ReactNode
}

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
  /** 现在轮到我出牌。答题阶段双方都不能动手，所以还要判 phase。 */
  const myPlayTurn = state.phase === 'play' && state.activePlayer === mySeat

  /**
   * 已经发出我方指令、还没等到新局面。
   *
   * 只有联机客人真的会停在这个状态（send 只是把指令丢给房主，要等回包）；
   * 本地和房主 driver 下 send 是同步的，下面那个 effect 当场就把它清掉，只闪一帧。
   * 它的作用是把 HandFan 的 disabled 打开，让打出去的牌按 HandFanProps 的约定
   * 停在落点上等结果，而不是被当成"父组件没受理"立刻飞回手牌。
   */
  const [awaiting, setAwaiting] = useState(false)
  /** 刚打出的技能牌，短暂展示在战场中央。key 让连打同一张卡也能重新播一遍。 */
  const [skillShow, setSkillShow] = useState<{ cardId: CardId; key: number } | null>(null)
  /** 开局抛硬币过场；播完置回 null 把整层卸载掉。 */
  const [coinToss, setCoinToss] = useState<{ firstPlayer: PlayerId; key: number } | null>(null)
  /** 答题全屏揭晓层；同样播完置回 null。 */
  const [quizReveal, setQuizReveal] = useState<QuizReveal | null>(null)

  /**
   * 战场容器，一个 ref 三用：
   * 交给 HandFan 当拖拽落点区、当战场小卡倾斜跟随的 useGSAP scope、以及查 Flip 的落点元素。
   */
  const boardRef = useRef<HTMLDivElement>(null)
  /** 手牌上方的取消落点，只负责显示"放回手牌"的拖拽反馈。 */
  const returnZoneRef = useRef<HTMLDivElement>(null)
  /** 中央横幅的挂载位。一次只有一条横幅在里面，多的排队等（见下面的 showBanner）。 */
  const bannerSlotRef = useRef<HTMLDivElement>(null)
  const skillShowRef = useRef<HTMLDivElement>(null)
  const coinTossRef = useRef<HTMLDivElement>(null)
  const coinInnerRef = useRef<HTMLDivElement>(null)
  const quizRevealRef = useRef<HTMLDivElement>(null)
  /** 战场上每张小卡的倾斜跟随，按 tile 元素存着（tile 上没有别的稳定标识可用）。 */
  const tiltsRef = useRef(new Map<HTMLElement, CardTiltHandle>())
  /** 松手那一刻记下的手牌位置，等 React 把 DOM 换好之后再拿它补飞行动画。 */
  const flipStateRef = useRef<{ state: Flip.FlipState; id: string } | null>(null)
  /** 对方新上场、等下一次提交后才播进场动画的 AI（收到事件那一刻它的 DOM 还不存在）。 */
  const popQueueRef = useRef<InstanceId[]>([])
  /**
   * 事件回调要读最新的座位号。
   * 不能直接闭包捕获：useMatchEvents 把 handler 存在 ref 里就是为了不重新订阅
   * （重订会丢掉 driver 攒着的那批开局事件，见架构 5.2），所以这里也走 ref。
   */
  const seatRef = useRef(mySeat)
  seatRef.current = mySeat

  /** 还没播的横幅文案，先进先出。 */
  const bannerQueueRef = useRef<string[]>([])
  /** 现在有一条横幅正在播，它播完才轮到下一条。 */
  const bannerBusyRef = useRef(false)
  /**
   * 有全屏过场正在演。这两个标志一起决定横幅要不要先憋着。
   *
   * 横幅在特效层（z-index 80），全屏过场在 1100，过场期间播横幅等于播给遮罩看。
   * 而且事件是一整批到的——结算那批里 ROUND_SCORED 后面紧跟着就是下一轮的
   * ROUND_STARTED / PLAY_TURN_STARTED，正常播的话会在揭晓层还没退场时就白白用掉。
   * 所以过场期间只入队不播，等过场淡出的 onComplete 再把攒着的一起放出来。
   *
   * 用 ref 而不是读上面那两个 state：一批事件是在同一次回调里同步处理完的，
   * 这中间 React 还没重渲染，读 state 拿到的还是"过场没开始"的旧值。
   */
  const coinUpRef = useRef(false)
  const quizUpRef = useRef(false)

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

  /**
   * 播队列里的下一条横幅。已经有一条在播、或者全屏过场正演着，就先不动。
   *
   * 自己在时间线的 onComplete 里再调自己接着播下一条——所以整个函数必须 contextSafe，
   * onComplete 是延迟回调，在里面新建的补间不包一层就不归 useGSAP 的 context 管（架构 5.5）。
   */
  const pumpBanner = contextSafe(() => {
    if (bannerBusyRef.current || coinUpRef.current || quizUpRef.current) return
    const slot = bannerSlotRef.current
    if (slot === null) return
    const text = bannerQueueRef.current.shift()
    if (text === undefined) return
    bannerBusyRef.current = true
    const node = document.createElement('div')
    node.className = 'battle__banner'
    node.textContent = text
    slot.appendChild(node)
    gsap
      .timeline({
        onComplete: () => {
          node.remove()
          bannerBusyRef.current = false
          pumpBanner()
        },
      })
      .fromTo(
        node,
        { autoAlpha: 0, scale: 0.86 },
        { autoAlpha: 1, scale: 1, duration: BANNER_IN, ease: 'back.out(1.6)', overwrite: 'auto' },
      )
      .to(
        node,
        { autoAlpha: 0, scale: 1.05, duration: BANNER_OUT, ease: 'power2.in' },
        `+=${BANNER_HOLD}`,
      )
  })

  /**
   * 中央横幅：把"第几轮了、该谁出牌"这类轻量提示用一行大字念出来。
   *
   * 一次只显示一条。一批事件里常常连着来两条（每轮开头的 ROUND_STARTED + PLAY_TURN_STARTED），
   * 同时画在屏幕正中会糊成一团，所以排队一条条播。
   */
  function showBanner(text: string): void {
    bannerQueueRef.current.push(text)
    pumpBanner()
  }

  useMatchEvents(driver, (events) => {
    for (const event of events) {
      switch (event.type) {
        case 'GAME_STARTED':
          // 抛硬币定先手。开局事件是 driver 构造时就发出来的，靠 subscribeEvents 的补发机制
          // 送到这里（架构 5.2），所以组件刚挂载就能开播。
          coinUpRef.current = true
          setCoinToss((current) => ({
            firstPlayer: event.firstPlayer,
            key: (current?.key ?? 0) + 1,
          }))
          break
        case 'ROUND_STARTED':
          showBanner(`第 ${event.round} 轮 · ${QUESTION_CATEGORY_LABELS[event.category]}`)
          break
        case 'PLAY_TURN_STARTED':
          showBanner(event.player === seatRef.current ? '轮到你出牌' : '对方出牌中')
          break
        case 'AGENT_DEPLOYED':
          // 我方 AI 走 Flip 从手牌飞过去，不要再叠一层进场动画。
          if (event.player !== seatRef.current) popQueueRef.current.push(event.agent.instanceId)
          break
        case 'SKILL_PLAYED':
          // 技能牌不上场，不亮出来的话画面上根本看不出有人打过牌，所以双方都播一次。
          setSkillShow((current) => ({ cardId: event.cardId, key: (current?.key ?? 0) + 1 }))
          break
        case 'QUESTION_REVEALED':
          // 全屏揭晓：题目和正确答案先亮出来，等 driver 那边的自动驾驶把结果提交上来
          // （默认 2.5 秒后，那批事件不在这一批里），再往这一层里填结果。
          quizUpRef.current = true
          setQuizReveal((current) => ({
            key: (current?.key ?? 0) + 1,
            question: event.question,
            rows: [],
            gains: null,
          }))
          break
        case 'AGENT_ANSWERED': {
          // 结果渲染在揭晓层内部，不去动战场上那张即将被 React 移除的小卡。
          const row: QuizAnswerRow = {
            instanceId: event.instanceId,
            mine: event.owner === seatRef.current,
            name: nameOfCard(event.instanceId, state),
            correct: event.correct,
            answerText: event.answerText,
          }
          setQuizReveal((current) =>
            current === null ? current : { ...current, rows: [...current.rows, row] },
          )
          break
        }
        case 'ROUND_SCORED': {
          const gains = {
            mine: event.gains[seatRef.current],
            theirs: event.gains[other(seatRef.current)],
          }
          setQuizReveal((current) => (current === null ? current : { ...current, gains }))
          break
        }
        default:
          // AGENT_ELIMINATED 不单独播：揭晓层里那一行的 ✗ 和罚下样式已经说明了，
          // 而且被罚下的小卡会随着新快照直接从战场上消失（正好被揭晓层盖住）。
          // CARD_DRAWN 的进场动画归 HandFan 自己管；GAME_OVER 由结算层接管；
          // COMMAND_REJECTED 走 view.lastRejection 那条提示。
          break
      }
    }
  })

  // 打出的技能卡：淡入、停一会儿、淡出，播完把 state 清掉（清掉会让这段再跑一次并直接返回）。
  useGSAP(
    () => {
      const node = skillShowRef.current
      if (skillShow === null || node === null) return
      const shownKey = skillShow.key
      gsap
        .timeline()
        .fromTo(
          node,
          { autoAlpha: 0, scale: 0.82, y: 24 },
          { autoAlpha: 1, scale: 1, y: 0, duration: 0.28, ease: 'back.out(1.6)' },
        )
        .to(
          node,
          { autoAlpha: 0, scale: 0.94, duration: 0.32, ease: 'power2.in' },
          `+=${SKILL_SHOWCASE_HOLD}`,
        )
        // 只清掉自己这一次的展示：依赖变化时 useGSAP 默认不 revert 旧 context，
        // 连打两张技能牌时上一张的时间线还在跑，它到点后也会来执行这个 call。
        // 无条件 setSkillShow(null) 的话，刚开始展示的第二张会被上一条时间线提前掐掉。
        .call(() => setSkillShow((current) => (current?.key === shownKey ? null : current)))
    },
    { dependencies: [skillShow] },
  )

  /**
   * 抛硬币：整层淡入 → 圆片弹出来同时连转数圈落到该停的那一面 → 停一下 → 整层淡出。
   *
   * 正反两面靠角度驱动 opacity 硬切，**不用 backface-visibility**：Chrome 在逐帧补间期间
   * 对合成层的朝向判断不可靠，会出现"全程正面、结尾闪一下"（原因见 ui/flipCard.ts）。
   * 这里自己写 rotationY 补间是为了把转动和淡入淡出排进同一条时间线，
   * 硬切逻辑仍然复用 flipCard 的 syncFlipFaces，不另写一份。
   */
  useGSAP(
    () => {
      const node = coinTossRef.current
      const inner = coinInnerRef.current
      if (coinToss === null || node === null || inner === null) return
      const shownKey = coinToss.key
      // 落在正面（0°）还是背面（180°）就是「你先出牌」和「对方先出牌」的区别。
      const landing = COIN_SPINS * 360 + (coinToss.firstPlayer === seatRef.current ? 0 : 180)
      const coin = node.querySelector<HTMLElement>('.coin-toss__coin')
      gsap
        .timeline({
          onComplete: () => {
            coinUpRef.current = false
            setCoinToss((current) => (current?.key === shownKey ? null : current))
            // 开局这一批里，硬币后面紧跟着还有「第 1 轮」和「轮到你出牌」两条横幅憋着。
            pumpBanner()
          },
        })
        .fromTo(
          node,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.25, ease: 'power2.out', overwrite: 'auto' },
        )
        .fromTo(
          coin,
          { scale: 0.4, autoAlpha: 0 },
          { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(1.8)', overwrite: 'auto' },
          0,
        )
        .fromTo(
          inner,
          { rotationY: 0 },
          {
            rotationY: landing,
            duration: COIN_SPIN,
            ease: 'power3.out',
            overwrite: 'auto',
            onUpdate: () => syncFlipFaces(inner),
          },
          0,
        )
        // 落定那一下的回弹，让"停住"这件事有个交代，不然转完就干等着。
        .to(coin, {
          scale: 1.06,
          duration: 0.12,
          yoyo: true,
          repeat: 1,
          ease: 'power2.out',
          overwrite: 'auto',
        })
        .to(
          node,
          { autoAlpha: 0, duration: 0.4, ease: 'power2.in', overwrite: 'auto' },
          `+=${COIN_HOLD}`,
        )
    },
    { dependencies: [coinToss?.key ?? null] },
  )

  /** 答题揭晓层出场：整层淡入、题面从下方升起。只在新的一轮揭晓时跑。 */
  useGSAP(
    () => {
      const node = quizRevealRef.current
      if (quizReveal === null || node === null) return
      gsap
        .timeline()
        .fromTo(
          node,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.3, ease: 'power2.out', overwrite: 'auto' },
        )
        .fromTo(
          node.querySelector('.quiz-reveal__panel'),
          { autoAlpha: 0, y: 26 },
          { autoAlpha: 1, y: 0, duration: 0.45, ease: 'back.out(1.3)', overwrite: 'auto' },
          0.08,
        )
    },
    { dependencies: [quizReveal?.key ?? null] },
  )

  /**
   * 答题揭晓层收尾：结果逐条淡入 → 计分 → 停一下 → 整层淡出。
   *
   * 触发条件是"计分到了"而不是"有结果行了"：AGENT_ANSWERED×N 和 ROUND_SCORED 是同一批事件，
   * React 把这一批合成一次重渲染，所以这段跑起来时结果行已经全在 DOM 里了，一次排完就行。
   */
  const quizScored = quizReveal !== null && quizReveal.gains !== null
  useGSAP(
    () => {
      const node = quizRevealRef.current
      if (!quizScored || quizReveal === null || node === null) return
      const shownKey = quizReveal.key
      gsap
        .timeline({
          onComplete: () => {
            quizUpRef.current = false
            setQuizReveal((current) => (current?.key === shownKey ? null : current))
            // 同一批里跟在 ROUND_SCORED 后面的下一轮横幅一直憋到这里才放出来。
            pumpBanner()
          },
        })
        .to(node.querySelector('.quiz-reveal__waiting'), {
          autoAlpha: 0,
          duration: 0.25,
          ease: 'power2.in',
          overwrite: 'auto',
        })
        .fromTo(
          node.querySelectorAll('.quiz-reveal__row'),
          { autoAlpha: 0, x: -16 },
          {
            autoAlpha: 1,
            x: 0,
            duration: 0.3,
            ease: 'power2.out',
            stagger: QUIZ_ROW_STAGGER,
            overwrite: 'auto',
          },
          0.12,
        )
        .fromTo(
          node.querySelector('.quiz-reveal__score'),
          { autoAlpha: 0, scale: 0.88 },
          { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(1.6)', overwrite: 'auto' },
          '+=0.2',
        )
        .to(
          node,
          { autoAlpha: 0, duration: 0.45, ease: 'power2.in', overwrite: 'auto' },
          `+=${QUIZ_HOLD}`,
        )
    },
    { dependencies: [quizScored, quizReveal?.key ?? null] },
  )

  /**
   * 对局中断（对手断线）时把还在演的全屏过场收掉。
   *
   * 答题揭晓层要等 ROUND_SCORED 才会自己退场，而中断时那条事件永远不会来了；
   * 结算层在它下面（z-index 90 < 1100），不清掉的话玩家会被一层退不掉的遮罩挡死。
   */
  useEffect(() => {
    if (view.status !== 'aborted') return
    coinUpRef.current = false
    quizUpRef.current = false
    setCoinToss(null)
    setQuizReveal(null)
  }, [view.status])

  // ---------- 出牌 ----------

  /** 我方指令发出去了：打开 awaiting，让 HandFan 把牌停在落点上等结果。 */
  function sendMine(command: Command): void {
    setAwaiting(true)
    driver.send(command)
  }

  /**
   * 手牌被打出（拖进战场松手，或者原地点一下）。
   *
   * 两种牌都是直接发 PLAY_CARD，没有费用也不选目标。差别只在动画：
   * AI 卡要飞进战场，所以先截 Flip 状态；技能牌打完就进弃牌堆，战场上没有它的落点，
   * 截了也没有目标元素可飞，它靠 SKILL_PLAYED 在中央亮相。
   */
  const handlePlay = (instanceId: string) => {
    const instance = me.hand.find((item) => item.instanceId === instanceId)
    if (instance === undefined) return
    if (getCard(instance.cardId).kind === 'agent') {
      // 此刻手牌那张卡还在 DOM 里、还停在松手那一刻的位置，正好当飞行起点。
      // 查询限定在 .hand-fan 里：战场小卡用的是同一套 data-flip-id，不限定会抓错元素。
      const slot = document.querySelector(`.hand-fan [data-flip-id="${CSS.escape(instanceId)}"]`)
      flipStateRef.current = slot === null ? null : { state: Flip.getState(slot), id: instanceId }
    }
    sendMine({ type: 'PLAY_CARD', player: mySeat, instanceId })
  }

  /** 测试房里点对方手牌：无视出牌轮次替对方打出去，其余结算和正常出牌完全一致。 */
  const playForFoe = (instance: CardInstance) => {
    driver.send({ type: 'DEBUG_PLAY_CARD', player: foeSeat, instanceId: instance.instanceId })
  }

  // 出牌和「结束出牌」同一个口径：不是我的出牌轮、对局已结束、或者正在等回包时都锁住。
  const actionsLocked = !myPlayTurn || view.status !== 'playing' || awaiting

  /**
   * 现算的话每次渲染都是个新数组，HandFan 的 useGSAP 会跟着重跑一遍归位补间；
   * 而这个组件光是 awaiting / skillShow 变一下就要重渲染好几次，
   * 手牌根本没动却在那儿反复补间。按 me.hand 记住，手牌真换了才重建。
   */
  const handCards = useMemo(() => me.hand.map(handCardOfInstance), [me.hand])

  // ---------- 飞行与进场 ----------

  useGSAP(
    () => {
      const pending = flipStateRef.current
      if (pending !== null) {
        flipStateRef.current = null
        // 必须显式把战场上的新元素交给 Flip：不传 targets 的话它会退回用 state.targets，
        // 也就是手牌里那个已经被 React 摘掉的旧节点，补间挂在脱离文档的 div 上，
        // 战场小卡一动不动。Flip 不会自己按 data-flip-id 去全文档找新元素（架构 5.5）。
        const target = document.querySelector(
          `.battle__board [data-flip-id="${CSS.escape(pending.id)}"]`,
        )
        if (target !== null) {
          Flip.from(pending.state, {
            targets: target,
            duration: 0.65,
            ease: 'power2.inOut',
            // 用 scale 而不是 width/height，卡面里的字会跟着一起缩，看起来才像同一张卡在变小。
            scale: true,
            // 飞行途中盖住手牌；战场容器本身没有层叠上下文，所以这个层级是全局有效的。
            zIndex: 60,
          })
        }
      }

      const pops = popQueueRef.current
      if (pops.length === 0) return
      popQueueRef.current = []
      for (const id of pops) {
        const tile = boardRef.current?.querySelector<HTMLElement>(
          `[data-agent-id="${CSS.escape(id)}"]`,
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

  // 战场小卡的倾斜跟随。单独开一个 useGSAP 而不是并进上面那个：
  // 那边有"没有待播的进场动画就直接 return"的早退，挂在它后面会被跳过。
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
        // 倾斜写在 tile 内层：飞行途中 tile 自己的 transform 归 Flip 管，
        // 往上面再写 rotationX 就是两边抢同一个属性。
        tiltsRef.current.set(
          tile,
          attachCardTilt(tile, { tiltLayer: '.battle__tile-tilt', maxTilt: TILE_TILT_DEG }),
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

  const finished = view.status === 'finished' || view.status === 'aborted'
  const category = state.questions[state.round - 1]?.category

  return (
    <div className="battle">
      <HandDrawnFilterDefs />
      <BattleTopBar />

      <div className="battle__layout">
        <aside className="battle__sidebar battle__sidebar--left" aria-label="双方状态">
          <OrnateFrame className="battle__sidebar-frame battle__sidebar-frame--players">
            <PlayerPanel player={foe} />
            <PlayerPanel player={me} />
          </OrnateFrame>
        </aside>

        <main className={`battle__battlefield${testMode ? ' battle__battlefield--test' : ''}`}>
          <FoeHand hand={foe.hand} testMode={testMode} onPlay={playForFoe} />

          <div className="battle__board" ref={boardRef}>
            <span className="battle__drop-cue battle__drop-cue--board" aria-hidden="true">
              <strong>松手</strong>
              放到场上
            </span>

            <div className="battle__row battle__row--foe">
              {foe.board.map((agent) => (
                <BoardTile key={agent.instanceId} agent={agent} mine={false} />
              ))}
            </div>

            <div className="battle__row battle__row--mine">
              {me.board.length === 0 ? (
                <span className="battle__board-hint">将手牌拖入战场</span>
              ) : (
                me.board.map((agent) => (
                  <BoardTile key={agent.instanceId} agent={agent} mine />
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

          {view.lastRejection !== null ? (
            <div className="battle__reject">{view.lastRejection}</div>
          ) : null}
        </main>

        <aside className="battle__sidebar battle__sidebar--right" aria-label="回合操作">
          <OrnateFrame className="battle__sidebar-frame battle__sidebar-frame--actions">
            <div className="battle__turn">
              <span className="battle__turn-round">
                第 {state.round}/{state.totalRounds} 轮
              </span>
              <span className="battle__turn-score">
                你 {me.score} : {foe.score} 对方
              </span>
              {/*
                只报类别不报题面：题目全文要到答题阶段才揭晓，这里是"下一题考什么方向"。
                终局后没有下一题了，整行不渲染——state.round 停在最后一轮，
                照常渲染的话会一直挂着最后一题的类别，看着像还有一题要考。
              */}
              {finished || category === undefined ? null : (
                <span className="battle__turn-next">
                  下一题：{QUESTION_CATEGORY_LABELS[category]}
                </span>
              )}
              <span className="battle__turn-who">{statusTextOf(view, state, mySeat)}</span>
            </div>
            <PlaqueButton
              disabled={actionsLocked}
              onClick={() => sendMine({ type: 'END_PLAY', player: mySeat })}
            >
              结束出牌
            </PlaqueButton>
          </OrnateFrame>
        </aside>
      </div>

      <HandFan
        cards={handCards}
        dropZoneRef={boardRef}
        returnZoneRef={returnZoneRef}
        onPlay={handlePlay}
        disabled={actionsLocked}
      />

      {/* 特效层：技能卡在中央亮相、横幅一条条排队播，整层不吃指针事件。 */}
      <div className="battle__fx" aria-hidden="true">
        <div className="battle__banner-slot" ref={bannerSlotRef} />
        {skillShow !== null ? (
          <div className="battle__skill-show" key={skillShow.key} ref={skillShowRef}>
            <HandCardFace card={handCardOfDefinition(skillShow.cardId)} />
          </div>
        ) : null}
      </div>

      {finished ? (
        <div className="battle__result">
          <p className="battle__result-title">{resultTitleOf(view, state, mySeat)}</p>
          {view.status === 'aborted' ? null : (
            <p className="battle__result-score">
              最终比分 {me.score} : {foe.score}
            </p>
          )}
          <div className="battle__result-actions">{resultActions}</div>
        </div>
      ) : null}

      {/*
        两个全屏过场。它们和特效层不一样，是要**吃掉指针事件**的：
        演的时候玩家不能出牌，等它们退场再说。所以放在 .battle__fx 外面单独挂。
      */}
      {coinToss !== null ? (
        <div className="coin-toss" key={coinToss.key} ref={coinTossRef}>
          <div className="coin-toss__coin">
            {/* 这一层承担 rotationY，下面两面靠 data-flip-face 对号（契约见 ui/flipCard.ts）。 */}
            <div className="coin-toss__inner" ref={coinInnerRef}>
              <span className="coin-toss__face" data-flip-face="front">
                你先出牌
              </span>
              <span className="coin-toss__face coin-toss__face--back" data-flip-face="back">
                对方先出牌
              </span>
            </div>
          </div>
          <p className="coin-toss__caption">抛硬币定先手</p>
        </div>
      ) : null}

      {quizReveal !== null ? (
        // key 让下一轮揭晓拿到一套全新的 DOM：上一轮那些结果行上还留着 GSAP 写的内联样式，
        // 复用同一批节点的话新一轮的 fromTo 要和它们打架。
        <QuizRevealLayer key={quizReveal.key} reveal={quizReveal} rootRef={quizRevealRef} />
      ) : null}
    </div>
  )
}

/**
 * 答题全屏揭晓层：题目 + 正确答案 + 每个在场 AI 的作答结果 + 本轮计分。
 *
 * 内容全部来自事件（`QuizReveal`），不读局面快照——答错的 AI 在新快照里已经被罚下、
 * 从战场上消失了，只有事件里还留着它答了什么。
 *
 * 动画归上面 BattleField 的两段 useGSAP 管，这里只负责结构：
 * 那两段靠类名（.quiz-reveal__panel / __waiting / __row / __score）找元素，改类名要一起改。
 */
function QuizRevealLayer({
  reveal,
  rootRef,
}: {
  reveal: QuizReveal
  rootRef: RefObject<HTMLDivElement | null>
}) {
  const { question, rows, gains } = reveal
  return (
    <div className="quiz-reveal" ref={rootRef}>
      <div className="quiz-reveal__panel">
        <span className="quiz-reveal__category">{QUESTION_CATEGORY_LABELS[question.category]}</span>
        <p className="quiz-reveal__question">{question.text}</p>
        <p className="quiz-reveal__answer">
          <span className="quiz-reveal__answer-label">正确答案</span>
          {question.answer}
        </p>

        <div className="quiz-reveal__body">
          {/*
            「作答中」和结果行叠在同一块地方交叉淡入淡出，所以这一行常驻 DOM 且脱离文档流：
            条件渲染的话它一消失就会把下面的结果行整体往上拽一截。
          */}
          <p className="quiz-reveal__waiting">场上 AI 作答中…</p>
          <div className="quiz-reveal__rows">
            {rows.length === 0 ? (
              // 双方场上一个 AI 都没有时也要有句交代，否则揭晓层看着像卡住了。
              // 顶着 __row 的类名是为了跟着同一段 stagger 淡入。
              gains === null ? null : (
                <p className="quiz-reveal__row quiz-reveal__row--none">场上没有 AI 作答</p>
              )
            ) : (
              rows.map((row) => (
                <p
                  key={row.instanceId}
                  className={`quiz-reveal__row${row.correct ? '' : ' quiz-reveal__row--wrong'}`}
                >
                  <span className="quiz-reveal__row-side">{row.mine ? '我方' : '对方'}</span>
                  <span className="quiz-reveal__row-name">{row.name}</span>
                  <span className="quiz-reveal__row-mark">{row.correct ? '✓' : '✗'}</span>
                  <span className="quiz-reveal__row-text">{row.answerText}</span>
                </p>
              ))
            )}
          </div>
        </div>

        {gains === null ? null : (
          <p className="quiz-reveal__score">
            本轮 你 +{gains.mine} / 对方 +{gains.theirs}
          </p>
        )}
      </div>
    </div>
  )
}

/** 右侧栏那行状态提示：现在该干什么。 */
function statusTextOf(view: MatchView, state: GameState, mySeat: PlayerId): string {
  if (view.status !== 'playing') return '对局结束'
  if (state.phase === 'quiz') return '场上 AI 答题中…'
  if (state.activePlayer === mySeat) return '轮到你出牌'
  return `${state.players[state.activePlayer].name} 出牌中…`
}

/** 结算层的大标题。平局是正经结果之一（总分相同），不是异常。 */
function resultTitleOf(view: MatchView, state: GameState, mySeat: PlayerId): string {
  if (view.status === 'aborted') return view.abortReason ?? '对局中断'
  if (state.winner === 'draw') return '平局'
  return state.winner === mySeat ? '你赢了' : '你输了'
}

/** 侧栏里的一块玩家面板：名字、当前总分、手牌和牌堆张数。 */
function PlayerPanel({ player }: { player: PlayerState }) {
  return (
    <div className="battle__player-panel" data-player={player.id}>
      <span className="battle__player-name">{player.name}</span>
      <span className="battle__player-score">{player.score}</span>
      <span className="battle__player-piles">
        手牌 {player.hand.length} · 牌堆 {player.deck.length}
      </span>
    </div>
  )
}

/** 场上的一个 AI。三层结构：tile 管 Flip 飞行，tilt 管倾斜和裁剪，inner 是整张卡面缩小。 */
function BoardTile({ agent, mine }: { agent: AgentInstance; mine: boolean }) {
  return (
    <div
      className="battle__tile"
      // data-agent-id 全场唯一，事件层靠它定位这个单位（现在只有对方上场的进场动画在用）。
      // data-flip-id 只给我方：它是 Flip 用来把"手牌里的旧节点"和"战场上的新节点"对号的键，
      // 对方的卡不从我的手牌飞出来，标了只是白白多一份撞车风险（这个 id 必须全局唯一）。
      data-agent-id={agent.instanceId}
      data-flip-id={mine ? agent.instanceId : undefined}
    >
      <div className="battle__tile-tilt">
        <div className="battle__tile-inner">
          <HandCardFace card={handCardOfAgent(agent)} />
        </div>
      </div>
    </div>
  )
}

/**
 * 对方手牌条。
 *
 * 正常模式只是一叠重叠的卡背加一个张数。本项目不防作弊（架构 4.1），
 * 客人手里其实有对手的完整手牌数据，但把它明晃晃摊在屏幕上没法玩，所以这里只画卡背。
 * 测试房里换成真实卡面并且能点，方便一个人调试双方的出牌流程。
 */
function FoeHand({
  hand,
  testMode,
  onPlay,
}: {
  hand: readonly CardInstance[]
  testMode: boolean
  onPlay: (instance: CardInstance) => void
}) {
  if (!testMode) {
    return (
      <div className="battle__foe-hand" aria-label={`对方手牌 ${hand.length} 张`}>
        <div className="battle__foe-stack">
          {hand.map((instance) => (
            <span key={instance.instanceId} className="battle__foe-back" aria-hidden="true" />
          ))}
        </div>
        <span className="battle__foe-count">{hand.length} 张</span>
      </div>
    )
  }
  return (
    <div className="battle__foe-hand battle__foe-hand--open" aria-label="对方手牌（测试房）">
      {hand.length === 0 ? <span className="battle__foe-count">对方没有手牌</span> : null}
      {hand.map((instance) => (
        <div
          key={instance.instanceId}
          className="battle__foe-card"
          title="点一下替对方打出这张牌"
          onPointerDown={() => onPlay(instance)}
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
  if (card.kind === 'agent') {
    return {
      id: card.id,
      name: card.name,
      kind: 'agent',
      model: card.model,
      text: card.text,
      backText: `模型：${card.model}。打出后留在场上，每轮跟着一起答题，答错才被罚下。`,
    }
  }
  return {
    id: card.id,
    name: card.name,
    kind: 'skill',
    text: card.text,
    backText: '技能牌：打出后亮个相就进弃牌堆，本迭代还没有任何实际效果。',
  }
}

/**
 * 从场上的 AI 单位拼出卡面数据。
 *
 * 单位上现在没有会变的数值，所以直接读卡牌定义就够了；
 * 哪天加了"上场后被增益/削弱"的属性，这里要改成读实例，否则小卡会一直显示原始数值。
 */
function handCardOfAgent(agent: AgentInstance): HandCardData {
  return {
    ...handCardOfDefinition(agent.cardId),
    id: agent.instanceId,
    // 战场小卡不翻面，这份文案没有地方会显示出来。
    backText: '',
  }
}

/**
 * 按实例 id 查这个 AI 的卡名，给答题揭晓层的结果行用。
 *
 * 事件是在 React 提交新局面**之前**送到的，所以答错被罚下的那个单位这时还在 state 里，
 * 名字查得到——查完就存进 QuizAnswerRow，之后不再回头读局面。
 * 查不到（理论上不该发生）就退回一个中性称呼，不为了一行字把界面搞崩。
 */
function nameOfCard(instanceId: InstanceId, state: GameState): string {
  for (const player of state.players) {
    const agent = player.board.find((item) => item.instanceId === instanceId)
    if (agent !== undefined) return getCard(agent.cardId).name
  }
  return '场上 AI'
}
