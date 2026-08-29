/**
 * 对局界面。只认一个 MatchDriver，不知道自己在打热座、联机还是 dev 测试房。
 *
 * 画面骨架照设计稿来：顶栏 + 左右两块纸面侧栏 + 中间战场，底部一排扇形手牌，
 * 顶边吊着对手的倒扇形手牌。
 * 位置和动画一律交给 GSAP 直接改 DOM（架构 5.5），React 只负责"有哪些元素、它们是什么状态"。
 *
 * 两条订阅各司其职：
 * - `useMatch` 拿快照，渲染"事件全部应用完"的结果；
 * - `useMatchEvents` 拿事件流，播过程动画（回合横幅、抛硬币、答题揭晓、对手出牌的强制展示：
 *   牌从对手手里飞到屏幕中央翻正停一会儿，AI 牌接着飞向对方战场行并播上场特效）。
 *   事件订阅者全局只允许一个（架构 5.2），所以整个应用里只能有这一处 useMatchEvents。
 *
 * 阶段动画分三档：
 * - 全屏过场（开局抛硬币、答题揭晓、英雄技能抵消）挂在 React 状态上，压暗整个战场演一段再退场；
 * - 屏幕中央那套展示层（.reveal-*）由两条链路共用，它们严格互斥（共用同一张展示卡、同一条浮动）：
 *   对手出牌的强制展示（reveal，不可打断）和玩家点战场小卡的放大查看（inspect，点遮罩关闭）；
 * - 轻量提示（第几轮、轮到谁出牌）走中央横幅，一次只播一条，多条排队。
 * 视觉全是占位，只求节奏顺、看得懂，美术另做。
 */

import { useRef, useState, useEffect, useMemo } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { getCard, getHero, other } from '@ai-duel/core'
import type {
  AiInstance,
  CardId,
  CardInstance,
  Command,
  GameState,
  HeroId,
  InstanceId,
  PlayerId,
  PlayerState,
  Question,
} from '@ai-duel/core'
import { useMatch, useMatchEvents } from '../match/useMatch'
import type { MatchDriver, MatchView } from '../match/driver'
import { battleStageMetrics } from './battleStage'
import { BattleTopBar } from './BattleTopBar'
import { CardBackHidden } from './CardBackHidden'
import { HandCardFace, HandFan } from './HandFan'
import type { CardPlayVia, HandCardData, HandLockReason } from './HandFan'
import { HandDrawnFilterDefs } from './HandDrawnFilterDefs'
import { OpponentFan } from './OpponentFan'
import { OrnateFrame } from './OrnateFrame'
import { PlaqueButton } from './PlaqueButton'
import { cardBackText } from './cardText'
import { attachCardTilt } from './cardTilt'
import type { CardTiltHandle } from './cardTilt'
import { flipTo, setFlipAngle, syncFlipFaces } from './flipCard'
import { heroCardData } from './heroCard'
import { QUESTION_CATEGORY_LABELS } from './labels'
import { playSkillHitFx, playSummonFx } from './playSummonFx'

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
/** 我方打出的技能牌在战场中央停留多久（秒），停完淡出。 */
const SKILL_SHOWCASE_HOLD = 1.2
/**
 * 指定了目标的技能卡在中央停留多久（秒）再飞向目标格。
 * 比无目标那档短一截：后面还接着一段飞行和命中，整条加起来才和"亮个相"差不多长。
 */
const SKILL_TARGET_HOLD = 0.5
/** 技能卡从展示位飞到目标格的时长（秒）。 */
const SKILL_FLIGHT_DUR = 0.42
/**
 * 拖着技能牌松手时，牌心离目标小卡多远还算命中（像素，四边各放宽这么多）。
 *
 * 小卡只有 110×154，要求牌心正正压在上面太苛刻；放宽一圈之后擦着边松手也认，
 * 相邻两张的判定区重叠了就取最近的那张（见 dropTargetOf）。
 */
const TARGET_SNAP = 44

/**
 * 落地特效（震屏 + 烟尘 + 追光）从落地那一刻起还要再演这么久（秒）。
 * 演出锁要一直挂到这段演完：Flip 一到位就解锁的话，手牌立刻能 hover，
 * 抬起来的下一张牌会盖住还在冒烟的那张。
 * 我方出牌和对手的牌落场用同一段尾巴，两边的手感才一致。
 */
const SUMMON_FX_TAIL = 0.8
/**
 * 出牌演出的兜底解锁时间（秒）。两条出牌链路（AI 牌飞向战场、技能牌中央亮相）共用。
 *
 * 两条链路都是同一个套路：出牌那一刻先上锁，等对面回来的新局面/事件把演出起起来，
 * 最后由演出收尾解锁。要是那一步压根没来（联机丢包，或者房主标签页被冻住而 socket 没断、
 * onPeerLeft 也不触发），锁就再没人放了——手牌会连 hover 抬牌都做不到，只能刷新页面。
 * 所以出牌时一并挂上这个定时器：演出真的起来了就把它撤掉（解锁交回给演出收尾），
 * 到点还没起来就把锁放开，退回"出不了牌但还能把牌抬起来看"这个能忍的状态。
 *
 * 取值只要盖得住一次联机往返，演出本身有多长不影响（演出一起来定时器就撤了）。
 */
const PLAY_LOCK_FALLBACK = 2.5

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
const COIN_HOLD = 1.3

/** 英雄技能抵消那一层，大字停留多久（秒）再整层淡出。 */
const CANCEL_HOLD = 1.3

/** 答题结果逐条淡入的间隔（秒）。 */
const QUIZ_ROW_STAGGER = 0.16
/** 计分那行出来之后停留多久（秒）再整层淡出，露出已经更新的战场和比分。 */
const QUIZ_HOLD = 1.1

/** 一条中央横幅从淡入到淡出的总时长（秒），排队时按它算下一条什么时候上。 */
const BANNER_IN = 0.3
const BANNER_HOLD = 0.75
const BANNER_OUT = 0.35

/** 答题揭晓层里的一行结果，全部由 AI_ANSWERED 事件当场攒出来。 */
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
  /** AI_ANSWERED 逐条追加。 */
  rows: QuizAnswerRow[]
  /** ROUND_SCORED 到了才有；它一到就说明这一轮播完了，可以走收尾。 */
  gains: { mine: number; theirs: number } | null
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
 * landingId 非空 = AI 牌，展示完要飞到对方战场行上那个 instanceId 对应的格子；
 * 为 null = 技能牌，没有落点，展示完原地淡出。
 * flipId 是这张牌在对手手牌里的实例 id，也就是 Flip 用来把"手牌里的旧节点"和"展示卡"
 * 对上号的键——技能牌的卡面数据是按卡牌定义拼的（id 是 cardId），对不上，所以单独存一份。
 * key 让连着展示两张牌也能各播各的（同一张卡也不会被上一轮的收尾掐掉）。
 */
interface RevealTarget {
  card: HandCardData
  landingId: InstanceId | null
  flipId: InstanceId
  /**
   * 这张技能命中的那个 AI（干扰类技能才有，其余为 null）。
   * 展示停留结束后卡不再原地淡出，而是飞向这个 instanceId 对应的战场格子并播命中特效。
   * 和 landingId 的区别：landingId 是"这张牌自己变成那个格子"（AI 卡上场），
   * hitId 是"飞过去打在一个本来就在场上的格子上"，那个格子不动。
   */
  hitId: InstanceId | null
  key: number
}

/**
 * 正在为一张要选目标的技能牌挑目标（点击路；拖拽路松手当场就定了，用不着这个状态）。
 *
 * instanceId 是那张已经点出去、正抬在扇形里等目标的手牌
 * （选完就带着目标发出去，取消就落回扇形，见 HandFanProps.castingId）。
 * 非空即"选目标态"：全屏压暗，只有对手行里没被干扰过的小卡亮着可点，点别处都是取消。
 */
interface TargetingState {
  instanceId: InstanceId
  cardId: CardId
}

/** 抵消提示那一层的两行字：大字是技能名，小字说清楚谁抵消了谁的哪张牌。 */
interface SkillCancelText {
  title: string
  text: string
}

/** 正式对局里对手手牌只能看不能点（点着看牌是原演示页的行为），所以 onReveal 是个空函数。 */
const noopReveal = () => {}

export interface MatchStageProps {
  driver: MatchDriver
  /**
   * dev 测试房模式：对方手牌摊开显示真实卡面，点一下就替对方打出去（走 DEBUG_PLAY_CARD，
   * 无视出牌轮次）。正式对局一律为 false，那时对方手牌是顶边的倒扇形牌背。
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
      <BattleFrame>
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
      </BattleFrame>
    )
  }

  return (
    <BattleFrame>
      <BattleField
        driver={driver}
        view={view}
        state={view.state}
        testMode={testMode}
        resultActions={resultActions}
      />
    </BattleFrame>
  )
}

/**
 * 16:9 舞台外壳：把整个对局界面锁进设计稿的比例里，窗口太宽留左右边、太窄留上下边。
 *
 * 三层各管一件事（样式和取舍见 styles.css 里"对局界面的 16:9 舞台"）：
 * .battle-frame 铺留边并把舞台居中，.battle-stage 定下 16:9 的那块地方，
 * .battle-scaler 永远是 1672×941 的盒子、再整体缩到舞台大小。
 * 等待页和正式对局都要套上：它们共用同一套写死像素的排版，也共用 .battle 的顶栏。
 */
function BattleFrame({ children }: { children: ReactNode }) {
  return (
    <div className="battle-frame">
      <div className="battle-stage">
        <div className="battle-scaler">{children}</div>
      </div>
    </div>
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
  /**
   * 屏幕上有牌正在飞或刚落地，演出还没收尾。
   *
   * 三条链路共用这一个锁：我方出牌（AI 牌飞向战场并落地冒烟，技能牌在中央亮相）、
   * 对手的牌从展示位飞向他的战场行、以及放大查看结束后飞回原格。
   * 只有"我方出牌"那条会先经过 awaiting，而 awaiting 只管到"新局面到手"为止，
   * 那时动画才刚开始，所以必须另有这个锁接着挂。
   *
   * 它同时喂给 HandFan 的 frozen：这段时间手牌只要还能 hover，抬起来的下一张牌
   * 就会盖住正在演的那张（放大后的手牌必然戳进我方战场行，见 HandFanProps.frozen）。
   * 和 flyingRef 是一对：ref 给动画回调判活，state 只负责触发重渲染去更新 actionsLocked。
   */
  const [landing, setLanding] = useState(false)
  /**
   * 我方刚打出的技能牌，短暂展示在战场中央。key 让连打同一张卡也能重新播一遍。
   * targetInstanceId 非空（干扰类技能）时，亮相完还要接着飞向那个战场格子。
   */
  const [skillShow, setSkillShow] = useState<{
    cardId: CardId
    targetInstanceId: InstanceId | null
    key: number
  } | null>(null)
  /** 开局抛硬币过场；播完置回 null 把整层卸载掉。 */
  const [coinToss, setCoinToss] = useState<{ firstPlayer: PlayerId; key: number } | null>(null)
  /** 答题全屏揭晓层；同样播完置回 null。 */
  const [quizReveal, setQuizReveal] = useState<QuizReveal | null>(null)
  /**
   * 英雄技能抵消的全屏提示（现在只有 Debug 一种）。
   * 两行文案在收到 SKILL_CANCELED 那一刻就按当时的座位拼好，演的时候不再回头读局面。
   */
  const [skillCancel, setSkillCancel] = useState<(SkillCancelText & { key: number }) | null>(null)
  /** 正在放大查看的战场小卡；非空即"查看中"，同时也是遮罩可点关闭的开关。 */
  const [inspecting, setInspecting] = useState<InspectTarget | null>(null)
  /** 对手正打出的那张牌，强制展示在屏幕中央。 */
  const [reveal, setReveal] = useState<RevealTarget | null>(null)
  /** 正在给一张干扰技能选目标（点击路）；非空即选目标态。 */
  const [targeting, setTargeting] = useState<TargetingState | null>(null)
  /**
   * 手上正拖着的那张手牌（HandFan 通知的，见它的 onDragStateChange）。
   * 只为一件事存在：拖着干扰技能时把场上的合法目标标出来。
   */
  const [draggingId, setDraggingId] = useState<string | null>(null)

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
  const skillCancelRef = useRef<HTMLDivElement>(null)
  /** 上场特效的烟尘容器。卸载时要把里面动态插的 DOM 一次清干净。 */
  const smokeLayerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const revealCardRef = useRef<HTMLDivElement>(null)
  /** 展示卡的裁剪层。飞行途中它把顶栏那一截挡住，落位后由 JS 撤掉（原因见 .reveal-clip）。 */
  const revealClipRef = useRef<HTMLDivElement>(null)
  /** 战场上每张小卡的倾斜跟随，按 tile 元素存着（tile 上没有别的稳定标识可用）。 */
  const tiltsRef = useRef(new Map<HTMLElement, CardTiltHandle>())
  /** 上面那段演出是否还在进行中。事件回调和延迟回调读它判活，见 landing。 */
  const flyingRef = useRef(false)
  /**
   * 演出锁的持有者编号，每上一次锁 +1。
   *
   * 解锁的回调常常延迟很久才跑（落地特效的尾巴、出牌的兜底定时器），中间锁很可能
   * 已经易主给下一次演出了——比如联机时技能牌的兜底先到点放了锁，玩家立刻又打出一张 AI 牌，
   * 迟到的技能展示时间线跑完时放掉的就是别人的锁。带着编号解锁，对不上号就不放。
   */
  const landingTokenRef = useRef(0)
  /**
   * 出牌那把锁的兜底解锁定时器，演出真的起来了就把它撤掉。见 PLAY_LOCK_FALLBACK。
   *
   * 两条出牌链路共用一个 ref 是安全的：锁一上手牌就冻住了，不解开就打不出下一张牌，
   * 所以同一时刻最多只有一条兜底在等。
   */
  const lockFallbackRef = useRef<gsap.core.Tween | null>(null)
  /** 这次技能牌展示持有的是哪一号锁。展示时间线演完时凭它解锁（见 landingTokenRef）。 */
  const skillLockTokenRef = useRef(0)
  /** 当前正在展示的那张技能牌的 key。连打时用它认出"我这条时间线是不是已经过气了"。 */
  const skillShowKeyRef = useRef<number | null>(null)
  /** 松手那一刻记下的手牌位置，等 React 把 DOM 换好之后再拿它补飞行动画。 */
  const flipStateRef = useRef<{ state: Flip.FlipState; id: string; token: number } | null>(null)
  /**
   * 兜底：展示链路被占用（连着出牌）或找不到起飞点时，对方新上场的 AI 只播一段简易进场。
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
   * 它同时是横幅队列的闸门：为 true 期间的横幅先排队，等遮罩淡出再补播。
   */
  const revealBusyRef = useRef(false)
  /**
   * 待播的"从展示位飞向战场格子"动画。展示卡马上要被摘掉，只能靠 id 找落点那个新格子。
   * token 是这段飞行占着的那把演出锁（见 landingTokenRef），飞完或者半路作废时凭它解锁。
   */
  const landingFlipRef = useRef<{
    state: Flip.FlipState
    id: InstanceId
    token: number
  } | null>(null)
  /** 待播的"小卡飞向展示位"动画，记的是战场上那个格子起飞前的位置。 */
  const inspectFlipRef = useRef<Flip.FlipState | null>(null)
  /** 待播的"从展示位飞回战场格子"动画，同样要连 id 和演出锁的编号一起存。 */
  const inspectReturnRef = useRef<{
    state: Flip.FlipState
    id: InstanceId
    token: number
  } | null>(null)
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
   * 选目标态下"可选目标"那圈金色描边的呼吸补间。
   * 存下来是为了退出选目标态时能亲手停掉：它是无限循环的，而描边那层会被 React 卸掉，
   * 不停的话补间会一直改一个脱离文档的节点（依赖变化时 useGSAP 不 revert，见架构 5.5）。
   */
  const targetPulseRef = useRef<gsap.core.Tween | null>(null)
  /** 同 seatRef：事件回调要判"现在是不是正在放大查看"，读 state 拿到的是旧值。 */
  const inspectingRef = useRef<InspectTarget | null>(null)
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
   * 横幅在特效层（z-index 80），全屏过场和展示遮罩都在 1100，它们演的时候播横幅
   * 等于播给遮罩看。而且事件是一整批到的——结算那批里 ROUND_SCORED 后面紧跟着就是下一轮的
   * ROUND_STARTED / PLAY_TURN_STARTED，正常播的话会在揭晓层还没退场时就白白用掉。
   * 所以过场期间只入队不播，等过场淡出的 onComplete 再把攒着的一起放出来。
   *
   * 用 ref 而不是读上面那两个 state：一批事件是在同一次回调里同步处理完的，
   * 这中间 React 还没重渲染，读 state 拿到的还是"过场没开始"的旧值。
   * 强制展示那一档的闸门是 revealBusyRef，理由一样。
   */
  const coinUpRef = useRef(false)
  const quizUpRef = useRef(false)
  /** 抵消层正演着。和上面两个同一档（全屏 1100、吃指针事件），闸门作用也一样。 */
  const cancelUpRef = useRef(false)
  /**
   * 待演的抵消提示。
   *
   * SKILL_CANCELED 和它对应的 SKILL_PLAYED 是同一批事件，收到时那张技能牌的亮相
   * （我方 skillShow / 对方强制展示）刚刚开始演，抵消层这时上去会盖在牌面上，
   * 玩家根本没看清被抵消的是什么牌。所以先在这里存着，等亮相收尾时再放（见 pumpSkillCancel）。
   */
  const pendingCancelRef = useRef<SkillCancelText | null>(null)
  /**
   * 我方技能牌亮相还有几段在演（连打两张时上一张的时间线还没跑完，会同时有两段）。
   *
   * 用计数而不是布尔：每次 setSkillShow 建一条时间线、每条时间线收尾减一次，
   * 布尔的话第一条收尾就会把"还在演的第二条"一起当成演完了。
   */
  const skillShowBusyRef = useRef(0)

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
    if (bannerBusyRef.current || coinUpRef.current || quizUpRef.current || cancelUpRef.current) {
      return
    }
    if (revealBusyRef.current) return
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

  // ---------- 英雄技能抵消的全屏提示 ----------

  /**
   * 放出憋着的抵消提示。
   *
   * 三处调用：收到事件时试一次（那一刻没有演出在放就直接上），
   * 我方技能牌亮相收尾时、对方强制展示收尾时各试一次。
   * 判"有没有演出在放"只能读 ref：事件是在 React 提交新快照之前同步送达的（架构 5.8）。
   */
  const pumpSkillCancel = () => {
    const pending = pendingCancelRef.current
    if (pending === null) return
    if (skillShowBusyRef.current > 0 || revealBusyRef.current) return
    // 抛硬币和答题揭晓同在 1100 那一档且不可打断，撞上就继续等它们的收尾来喊。
    if (coinUpRef.current || quizUpRef.current || cancelUpRef.current) return
    pendingCancelRef.current = null
    cancelUpRef.current = true
    setSkillCancel((current) => ({ ...pending, key: (current?.key ?? 0) + 1 }))
  }

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
    // 飞回那段已经上了锁、却还没起跑就被打断，锁得还回去，否则手牌永远解不开。
    if (inspectReturnRef.current !== null) releaseLanding(inspectReturnRef.current.token)
    inspectReturnRef.current = null
    closeInspect()
  }

  /**
   * 受理一次对手出牌的强制展示：截下起飞位置，把牌交给展示层。
   *
   * 返回 false 表示这次不播展示，调用方自己降级（AI 牌退回 popQueue 的简易进场，
   * 技能牌就只剩什么都不播）。requireOrigin 为 true 时找不到起飞的那张手牌也算不受理：
   * AI 牌还有 popQueue 兜底，而技能牌没有别的地方能看到牌面，宁可从屏幕中央淡入
   * （见展示 useGSAP 里 revealFlipRef 为空的那条分支）。
   */
  const startReveal = (
    card: HandCardData,
    landingId: InstanceId | null,
    handInstanceId: InstanceId,
    requireOrigin: boolean,
    /** 技能命中的那个战场格子，见 RevealTarget.hitId。 */
    hitId: InstanceId | null = null,
  ): boolean => {
    // 展示层只有一张展示卡、一条浮动，正在展示（含收尾还没跑完）时第二条一律不受理。
    if (revealBusyRef.current) return false
    // 全屏过场压在展示层同一档（都是 1100），抛硬币或答题揭晓演着的时候插一次展示，
    // 两层会糊在一起。这两档都不可打断，所以展示这边让路。
    if (coinUpRef.current || quizUpRef.current || cancelUpRef.current) return false
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
    // 选目标态也让位：展示层会盖住整个战场，玩家看不见自己正在选的那些格子。
    // 那张技能牌会跟着 disabled 关掉自己落回扇形（见 HandFanProps.onPlay 的约定）。
    setTargeting(null)
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
      hitId,
      key: (current?.key ?? 0) + 1,
    }))
    return true
  }

  /**
   * 强行收掉正在进行的强制展示，不播收尾。
   *
   * 只有一个调用方：答题阶段开始。展示要停 1.5 秒，而对手"出完最后一张牌就结束出牌"时
   * 那两条指令挨得很近，揭晓层（1100）会直接盖在还没演完的展示（同样 1100）上。
   * 与其让两层打架，不如让展示让位——它想说的"对手打了这张牌"已经看到一部分了。
   * 遮罩要显式关掉：它是常驻节点，展示卡被卸载并不会把它带走。
   */
  const abortReveal = contextSafe(() => {
    if (!revealBusyRef.current) return
    revealBusyRef.current = false
    floatRef.current?.kill()
    floatRef.current = null
    revealFlipRef.current = null
    // 同 abortInspect：落场那段飞行已经上了锁却不会再跑了，锁得还回去。
    if (landingFlipRef.current !== null) releaseLanding(landingFlipRef.current.token)
    landingFlipRef.current = null
    const overlay = overlayRef.current
    if (overlay !== null) gsap.to(overlay, { autoAlpha: 0, duration: 0.2, overwrite: 'auto' })
    setReveal(null)
  })

  useMatchEvents(driver, (events) => {
    for (const event of events) {
      switch (event.type) {
        case 'GAME_STARTED':
          // 抛硬币定先手。开局事件是 driver 构造时就发出来的，靠 subscribeEvents 的补发机制
          // 送到这里（架构 5.2），所以组件刚挂载就能开播。
          // 全屏过场会盖住战场，选目标态一律先收掉（同 QUESTION_REVEALED 那条）。
          setTargeting(null)
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
        case 'AI_DEPLOYED': {
          // 我方 AI 走 Flip 从手牌飞过去，不要再叠一层进场动画。
          if (event.player === seatRef.current) break
          // 对方的 AI 先强制展示、再从展示位飞到战场行；受理不了才退回简易进场。
          // 落场用的 id 和手牌里那张是同一个（playCard 沿用了手牌实例的 instanceId）。
          const id = event.ai.instanceId
          if (!startReveal(handCardOfAi(event.ai), id, id, true)) {
            popQueueRef.current.push(id)
          }
          break
        }
        case 'SKILL_PLAYED':
          // 技能牌不上场，不亮出来的话画面上根本看不出有人打过牌，所以双方都要亮一次，
          // 只是亮法不同：我方那张刚从自己手里飞走，知道打的是什么，中央淡入一下就够；
          // 对方那张要从他手牌里飞到中央翻正，否则画面上什么都没发生过。
          // 干扰类技能多一段：亮相完还要飞向被命中的那个格子（event.targetInstanceId）。
          if (event.player === seatRef.current) {
            skillShowBusyRef.current += 1
            setSkillShow((current) => ({
              cardId: event.cardId,
              targetInstanceId: event.targetInstanceId ?? null,
              key: (current?.key ?? 0) + 1,
            }))
          } else {
            // 受理不了（上一张还在展示）就跳过这一次展示：技能牌没有落场，
            // 少看一眼牌面是这条链路唯一的降级代价。
            startReveal(
              handCardOfDefinition(event.cardId),
              null,
              event.instanceId,
              false,
              event.targetInstanceId ?? null,
            )
          }
          break
        case 'SKILL_CANCELED': {
          // 措辞按"谁打出的那张牌被抵消了"来分：player 是出牌方，by 是发动英雄技能的一方。
          const hero = getHero(event.heroId)
          const whose = event.player === seatRef.current ? '你' : '对方'
          const cardName = getCard(event.cardId).name
          pendingCancelRef.current = {
            title: `${hero.skillName}!`,
            text: `${hero.name} 发动 ${hero.skillName}，抵消了${whose}打出的「${cardName}」`,
          }
          // 这一批里紧挨在前面的 SKILL_PLAYED 刚开了一段亮相，抵消层得等它演完再上；
          // 没有演出在放（比如亮相被降级跳过了）时这一下就直接放出去。
          pumpSkillCancel()
          break
        }
        case 'QUESTION_REVEALED':
          // 全屏揭晓：题目和正确答案先亮出来，等 driver 那边的自动驾驶把结果提交上来
          // （默认 2.5 秒后，那批事件不在这一批里），再往这一层里填结果。
          // 揭晓层和展示层同在 1100，先把还没演完的展示收掉再开这一层（见 abortReveal）。
          abortReveal()
          // 进答题就出不了牌了，正选着目标的那张技能牌一并收掉（它会自己落回扇形）。
          setTargeting(null)
          // 还憋着没演的抵消提示直接丢掉：它说的是刚才那次出牌，等揭晓层演完再补一遍，
          // 就成了下一轮开头凭空冒出来的一句话，比不演更让人糊涂。
          pendingCancelRef.current = null
          quizUpRef.current = true
          setQuizReveal((current) => ({
            key: (current?.key ?? 0) + 1,
            question: event.question,
            rows: [],
            gains: null,
          }))
          break
        case 'AI_ANSWERED': {
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
          // AI_ELIMINATED 不单独播：揭晓层里那一行的 ✗ 和罚下样式已经说明了，
          // 而且被罚下的小卡会随着新快照直接从战场上消失（正好被揭晓层盖住）。
          // CARD_DRAWN 的进场动画归 HandFan 自己管；GAME_OVER 由结算层接管；
          // COMMAND_REJECTED 走 view.lastRejection 那条提示。
          break
      }
    }
  })

  // 打出的技能牌：淡入、停一会儿、淡出，播完把 state 清掉（清掉会让这段再跑一次并直接返回）。
  // 有目标的技能牌把最后那段淡出换成"飞向目标格 + 命中特效"。
  useGSAP(
    (_context, safe) => {
      if (skillShow === null) return
      const node = skillShowRef.current
      if (node === null) {
        // 理论上到不了：skillShow 非空时那张卡就在同一次渲染里，layout effect 里 ref 必然已挂上。
        // 真到了这儿也得把计数放开，否则待演的抵消提示会永远憋着（同展示层那处兜底）。
        skillShowBusyRef.current = Math.max(0, skillShowBusyRef.current - 1)
        pumpSkillCancel()
        return
      }
      const shownKey = skillShow.key
      skillShowKeyRef.current = shownKey
      // 展示真的起来了，兜底定时器可以撤了，解锁交给这条时间线的末尾。
      lockFallbackRef.current?.kill()
      lockFallbackRef.current = null

      /**
       * 这一次亮相彻底演完（无目标的淡出完、有目标的命中完）之后的销账，两条分支共用。
       *
       * 只清掉自己这一次的展示：依赖变化时 useGSAP 默认不 revert 旧 context，
       * 连打两张技能牌时上一张的时间线还在跑，它到点后也会跑到这儿。
       * 无条件 setSkillShow(null) 的话，刚开始展示的第二张会被上一条时间线提前掐掉；
       * 演出锁同理，无条件解锁会把第二张还在展示的锁提前放掉。
       * 计数和抵消提示则不分是谁：那两样按"演完一段减一段"记账，过气的这条也得销账。
       */
      const finish = () => {
        // 亮相演完了，轮到憋着的抵消提示（如果有的话）。计数减到 0 才算全部演完。
        skillShowBusyRef.current = Math.max(0, skillShowBusyRef.current - 1)
        pumpSkillCancel()
        if (skillShowKeyRef.current !== shownKey) return
        setSkillShow((current) => (current?.key === shownKey ? null : current))
        // 凭编号解锁：兜底定时器先到点放了锁、玩家又打出下一张牌时，
        // 这条迟到的时间线放掉的会是别人的锁（见 landingTokenRef）。
        releaseLanding(skillLockTokenRef.current)
      }

      const target = tileOf(boardRef, skillShow.targetInstanceId)
      const timeline = gsap
        .timeline()
        .fromTo(
          node,
          { autoAlpha: 0, scale: 0.82, y: 24 },
          { autoAlpha: 1, scale: 1, y: 0, duration: 0.28, ease: 'back.out(1.6)' },
        )

      if (target === null) {
        timeline
          .to(
            node,
            { autoAlpha: 0, scale: 0.94, duration: 0.32, ease: 'power2.in' },
            `+=${SKILL_SHOWCASE_HOLD}`,
          )
          .call(finish)
        return
      }

      // 干扰类技能：亮相完接着飞向目标格。飞行要等停留结束才起跑，那时早出了 useGSAP 回调的
      // 同步区间，里面新建的补间（飞行本身、以及命中特效那几条）都得包一层才归 context 管（架构 5.5）。
      const hit = () => {
        playSkillHitFx(target)
        finish()
      }
      const fly = () => flyToTile(node, target, safe ? safe(hit) : hit)
      timeline.call(safe ? safe(fly) : fly, undefined, `+=${SKILL_TARGET_HOLD}`)
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
      // 落在正面（0°）还是背面（180°）就是「先手」和「后手」两张币面的区别。
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

  /**
   * 英雄技能抵消：整层淡入 → 大字弹出来 → 说明跟上 → 停一下 → 整层淡出。
   *
   * 结构和抛硬币那层同一档（全屏 1100、吃指针事件），只是没有 3D 翻转要处理。
   * 收尾里除了清 state 还要放开闸门（cancelUpRef）并补播憋着的横幅，和另外两层一致；
   * 多出来的一步是接力放憋着的下一条抵消提示（见 onComplete 里的注释）。
   */
  useGSAP(
    () => {
      const node = skillCancelRef.current
      if (skillCancel === null || node === null) return
      const shownKey = skillCancel.key
      gsap
        .timeline({
          onComplete: () => {
            cancelUpRef.current = false
            // 第二条抵消提示如果是在这层演着的时候到的，它对应的强制展示会被上面那道闸门
            // 挡掉，不会再有别的收尾来放行——所以这里放开闸门后要自己接力一次。
            // 必须排在下面那次清 state 之前：两次 setSkillCancel 会被合成一次重渲染，
            // 反过来的话先清成 null，接力算出的 key 会从 1 重新开始，撞上旧 key 就不重播了。
            pumpSkillCancel()
            setSkillCancel((current) => (current?.key === shownKey ? null : current))
            pumpBanner()
          },
        })
        .fromTo(
          node,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.22, ease: 'power2.out', overwrite: 'auto' },
        )
        .fromTo(
          node.querySelector('.skill-cancel__title'),
          { autoAlpha: 0, scale: 0.6 },
          { autoAlpha: 1, scale: 1, duration: 0.42, ease: 'back.out(2)', overwrite: 'auto' },
          0.05,
        )
        .fromTo(
          node.querySelector('.skill-cancel__text'),
          { autoAlpha: 0, y: 16 },
          { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out', overwrite: 'auto' },
          0.28,
        )
        .to(
          node,
          { autoAlpha: 0, duration: 0.38, ease: 'power2.in', overwrite: 'auto' },
          `+=${CANCEL_HOLD}`,
        )
    },
    { dependencies: [skillCancel?.key ?? null] },
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
   * 触发条件是"计分到了"而不是"有结果行了"：AI_ANSWERED×N 和 ROUND_SCORED 是同一批事件，
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
   * 强制展示会自己走完，但对手都断线了没必要再演，一并收掉。
   */
  useEffect(() => {
    if (view.status !== 'aborted') return
    coinUpRef.current = false
    quizUpRef.current = false
    // 抵消层同样是吃指针事件的全屏层，留着它玩家会被一层退不掉的遮罩挡死；
    // 待演的那条也要一起丢，否则它会在中断之后才冒出来。
    cancelUpRef.current = false
    pendingCancelRef.current = null
    skillShowBusyRef.current = 0
    setCoinToss(null)
    setQuizReveal(null)
    setSkillCancel(null)
    abortReveal()
    abortInspect()
    // 刻意只跟着 status 走：abortReveal / abortInspect 每次渲染都是新函数，
    // 进依赖数组会让这段每帧重跑，而它们读的全是 ref，闭包旧不旧无所谓。
  }, [view.status])

  // ---------- 选目标 ----------

  /**
   * 对方场上还能被干扰的 AI，也就是干扰类技能的全部合法目标。
   * 引擎那边有同一条规则（见 core 的 playCard），这里只是提前把画面和按钮对齐。
   */
  const foeTargets = foe.board.filter((ai) => ai.interfered !== true)

  /** 这张手牌是不是"打出时要点对方一个 AI"的干扰技能。 */
  const needsTarget = (instanceId: string): boolean => {
    const instance = me.hand.find((item) => item.instanceId === instanceId)
    if (instance === undefined) return false
    const card = getCard(instance.cardId)
    return card.kind === 'skill' && card.target === 'foe-ai'
  }

  /**
   * 现在要不要把场上的合法目标标出来，标成哪一档：
   *
   * - `'pick'` 点击路的选目标态：全屏压暗，目标要抬到压暗层之上，而且得点得动；
   * - `'drag'` 手上正拖着一张干扰技能：只亮橙圈、不压暗，**也绝不能抬层级**
   *   ——拖着的牌在扇形里（z-index 20 那一层），把小卡抬上去会盖在它前面；
   * - `'none'` 都不是。
   */
  const targetMode: 'none' | 'drag' | 'pick' =
    targeting !== null ? 'pick' : draggingId !== null && needsTarget(draggingId) ? 'drag' : 'none'

  /**
   * 出牌权一走（对方回合、进答题、对局结束/中断）就退出选目标态。
   *
   * 全屏过场和强制展示各自在开演时也会收一次（见那几处 setTargeting(null)），
   * 这里兜的是"局面已经变了但没有任何过场"的情况，比如测试面板直接替我结束出牌。
   */
  useEffect(() => {
    if (myPlayTurn && view.status === 'playing') return
    setTargeting(null)
  }, [myPlayTurn, view.status])

  /**
   * 可选目标那圈橙色描边的呼吸。两条路（拖拽 / 点击）共用同一圈，视觉上是同一件事。
   *
   * 只补间描边层自己的 opacity / scale：小卡的 transform 另有主人
   * （tile 归 Flip 飞行、tilt 层归 cardTilt 每帧改写），往它们身上加动画一定会打架。
   * 描边层跟着选目标态挂载卸载，所以每次进出都要亲手停掉旧补间——依赖变化时 useGSAP 不 revert。
   */
  useGSAP(
    () => {
      targetPulseRef.current?.kill()
      targetPulseRef.current = null
      if (targetMode === 'none') return
      const rings = boardRef.current?.querySelectorAll<HTMLElement>('.battle__tile-target-ring')
      if (rings === undefined || rings.length === 0) return
      targetPulseRef.current = gsap.fromTo(
        rings,
        { opacity: 0.35, scale: 0.98 },
        {
          opacity: 1,
          scale: 1.03,
          duration: 0.7,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
          overwrite: 'auto',
        },
      )
    },
    { dependencies: [targetMode, view] },
  )

  // ---------- 出牌 ----------

  /** 我方指令发出去了：打开 awaiting，让 HandFan 把牌停在落点上等结果。 */
  function sendMine(command: Command): void {
    setAwaiting(true)
    driver.send(command)
  }

  /**
   * 上一把演出锁：手牌整个冻住、「结束出牌」也按不动，直到对应的 releaseLanding。
   * 返回这次的编号，交给延迟解锁的那个回调带着（见 landingTokenRef）。
   */
  const acquireLanding = (): number => {
    landingTokenRef.current += 1
    flyingRef.current = true
    setLanding(true)
    return landingTokenRef.current
  }

  /**
   * 演出收尾，把手牌和「结束出牌」放开。见 landing。
   *
   * token 是上锁时拿到的编号：对不上号就说明锁已经易主给下一次演出了，这次不能放。
   * 不传编号是无条件强放，只给"确实该收掉一切"的场合用。
   */
  const releaseLanding = (token?: number) => {
    if (token !== undefined && token !== landingTokenRef.current) return
    lockFallbackRef.current?.kill()
    lockFallbackRef.current = null
    flyingRef.current = false
    setLanding(false)
  }

  /**
   * 出牌专用的上锁：在 acquireLanding 之上再挂一条兜底解锁定时器。
   *
   * 出牌这两条链路的解锁都要等对面把局面/事件送回来，中间隔着一次联机往返，
   * 是唯一可能"等不到解锁的人"的场合，所以只有它们需要兜底。见 PLAY_LOCK_FALLBACK。
   * （对手出牌落场、放大查看飞回那两条链路的解锁全在本地驱动，不会卡住，不用兜底。）
   *
   * 调用方（handlePlay / castSkillAt）都整个走 contextSafe：这条定时器是在 React 事件回调里
   * 建的，不包一层就不归 useGSAP 的 context 管，组件在到点前卸载时 revert 不掉，
   * 到点还会去动一个已经卸载的组件（架构 5.5）。
   */
  const acquirePlayLanding = (): number => {
    const token = acquireLanding()
    lockFallbackRef.current?.kill()
    lockFallbackRef.current = gsap.delayedCall(PLAY_LOCK_FALLBACK, () => releaseLanding(token))
    return token
  }

  /**
   * 松手时这张牌落在哪个合法目标上（拖拽路的落点判定）。
   *
   * 量的是**牌自己的中心**而不是指针：拖拽时牌心本来就跟着光标走（见 dragTargetOf），
   * 两者差不多，但玩家瞄的是那张牌盖住了谁。判定还刻意放宽了 TARGET_SNAP，
   * 擦着小卡边缘松手也算命中，照炉石那种"差不多就行"的手感来。
   * 契约保证这时那张牌还停在松手位置（见 HandFanProps.onPlay）。
   */
  const dropTargetOf = (instanceId: string): AiInstance | null => {
    const slot = document.querySelector<HTMLElement>(
      `.hand-fan [data-flip-id="${CSS.escape(instanceId)}"]`,
    )
    if (slot === null) return null
    const card = slot.getBoundingClientRect()
    const cx = card.left + card.width / 2
    const cy = card.top + card.height / 2
    // 下面全程在视口坐标里比矩形，本来不用换算；只有 TARGET_SNAP 这个放宽量是照舞台内像素
    // 定的，得跟着舞台一起缩，否则窗口越小，这圈"擦边也算命中"的余量在画面上就越大。
    const snap = TARGET_SNAP * battleStageMetrics().scale

    // 先在**整行**里找最近的那张（不是只在合法目标里找），最后才看它能不能打：
    // 只挑合法的话，松手在一张已干扰的小卡上会打中旁边那张，玩家眼里就是"我明明放在它身上"。
    let best: { ai: AiInstance; distance: number } | null = null
    for (const ai of foe.board) {
      const tile = tileOf(boardRef, ai.instanceId)
      if (tile === null) continue
      const rect = tile.getBoundingClientRect()
      if (cx < rect.left - snap || cx > rect.right + snap) continue
      if (cy < rect.top - snap || cy > rect.bottom + snap) continue
      // 放宽之后相邻两张小卡的判定区会重叠，取牌心最近的那张，和肉眼看到的一致。
      const distance = Math.hypot(
        cx - (rect.left + rect.right) / 2,
        cy - (rect.top + rect.bottom) / 2,
      )
      if (best === null || distance < best.distance) best = { ai, distance }
    }
    if (best === null || best.ai.interfered === true) return null
    return best.ai
  }

  /**
   * 带着目标把一张干扰技能发出去。拖拽路（松手命中）和点击路（点中目标）共用这一处。
   *
   * 上的锁和无目标技能牌那条完全一样：技能牌不飞进战场，锁挂到中央亮相（以及亮相之后
   * 那段飞向目标的命中）演完为止，解锁在展示时间线的末尾。
   */
  const castSkillAt = contextSafe((instanceId: InstanceId, target: AiInstance) => {
    skillLockTokenRef.current = acquirePlayLanding()
    sendMine({
      type: 'PLAY_CARD',
      player: mySeat,
      instanceId,
      targetInstanceId: target.instanceId,
    })
  })

  /**
   * 手牌被打出（拖进战场松手，或者原地点一下）。
   *
   * AI 牌和无目标技能牌两条路照旧：前者要飞进战场，所以先截 Flip 状态；
   * 后者打完就进弃牌堆，战场上没有它的落点，靠 SKILL_PLAYED 在中央亮相。
   *
   * 要选目标的技能牌按触发方式分两条：
   * - 拖出来的（via 'drag'）：松手落在哪张合法目标上就打谁，落在空处就当没打过（牌飞回手牌）；
   * - 点出来的（via 'tap'）：进选目标态，全屏压暗，等玩家再点一次战场上的目标。
   */
  const handlePlay = contextSafe((instanceId: string, via: CardPlayVia) => {
    const instance = me.hand.find((item) => item.instanceId === instanceId)
    if (instance === undefined) return
    const card = getCard(instance.cardId)

    if (card.kind === 'skill' && card.target === 'foe-ai') {
      if (foeTargets.length === 0) {
        // 一个合法目标都没有，怎么打都是白打。这里不受理这次出牌（不锁 disabled、也不上演出锁），
        // 于是 HandFan 下一帧就把牌送回扇形（见 HandFanProps.onPlay 的约定）。
        showBanner('对方没有可选目标')
        return
      }
      if (via === 'drag') {
        const target = dropTargetOf(instanceId)
        // 落在战场空处 = 取消，同样靠"不受理"让牌自己飞回手牌。
        // 不退回选目标态：玩家已经用拖拽表达过意图了，半路换一套交互只会更懵。
        if (target === null) {
          showBanner('松手要落在对方 AI 上')
          return
        }
        castSkillAt(instanceId, target)
        return
      }
      // 选目标态必须在 onPlay 里**同步**开起来：它会把 actionsLocked 打开，
      // HandFan 才知道这次出牌被受理了（在等玩家选目标），不会把牌当成"父组件没受理"。
      // 这张牌本身留在扇形里，只是抬起来亮着（见 HandFanProps.castingId）。
      // 这里刻意不上演出锁：指令还没发出去，屏幕上也没有任何演出，
      // 冻手牌那件事由 targeting 自己喂给 handFrozen。
      setTargeting({ instanceId, cardId: card.id })
      return
    }

    if (card.kind === 'ai') {
      // 此刻手牌那张卡还在 DOM 里、还停在松手那一刻的位置，正好当飞行起点。
      // 查询限定在 .hand-fan 里：战场小卡用的是同一套 data-flip-id，不限定会抓错元素。
      const slot = document.querySelector(`.hand-fan [data-flip-id="${CSS.escape(instanceId)}"]`)
      // 锁挂到新局面到手、那段飞行演完为止（解锁在下面消费 flipStateRef 那段 useGSAP 里）。
      flipStateRef.current =
        slot === null
          ? null
          : { state: Flip.getState(slot), id: instanceId, token: acquirePlayLanding() }
    } else {
      // 技能牌没有飞行，锁挂到中央展示演完为止（解锁在下面那条展示时间线的末尾）。
      skillLockTokenRef.current = acquirePlayLanding()
    }
    sendMine({ type: 'PLAY_CARD', player: mySeat, instanceId })
  })

  /** 选目标态下点中了对手一张可选的小卡：带着目标把这张技能牌发出去。 */
  const confirmTarget = (ai: AiInstance) => {
    if (targeting === null || ai.interfered === true) return
    const { instanceId } = targeting
    // 两个 setState 在同一次事件里合成一次重渲染，actionsLocked 中途不会松开，
    // 扇形里那张抬着的牌也就不会先掉回去再飞走。
    setTargeting(null)
    castSkillAt(instanceId, ai)
  }

  /** 取消选目标：不发指令，那张牌跟着 actionsLocked 松开自己落回扇形。 */
  const cancelTargeting = () => setTargeting(null)

  /** 测试房里点对方手牌：无视出牌轮次替对方打出去，其余结算和正常出牌完全一致。 */
  const playForFoe = (instance: CardInstance) => {
    const card = getCard(instance.cardId)
    // 替对方打干扰技能时不做一套对手视角的选目标 UI：直接挑我方场上第一个还没被干扰的 AI。
    // 一个都没有就照发不误，引擎会回一条 COMMAND_REJECTED，走 view.lastRejection 那条提示，
    // 正好也能在测试房里试出"没有合法目标"这条分支。
    const target =
      card.kind === 'skill' && card.target === 'foe-ai'
        ? me.board.find((ai) => ai.interfered !== true)
        : undefined
    driver.send({
      type: 'DEBUG_PLAY_CARD',
      player: foeSeat,
      instanceId: instance.instanceId,
      ...(target === undefined ? {} : { targetInstanceId: target.instanceId }),
    })
  }

  /**
   * 点战场小卡：把它放大到屏幕中央看清楚。
   *
   * 展示层同一时刻只归一条链路用，所以对手正在强制展示、或者上一次查看还没收干净时都不受理。
   */
  const handleInspect = (ai: AiInstance) => {
    if (reveal !== null || inspecting !== null) return
    // 选目标态下点小卡的含义是"选中它"，不该再弹出放大查看。
    // 鼠标走不到这儿（压暗层挡着，可选的那几张也另走 confirmTarget），但键盘能：
    // 小卡是 tabIndex=0 的 role="button"，压暗层拦不住回车。
    if (targeting !== null) return
    // 有牌正在飞或刚落地时也不受理：点开的很可能正是那张还被 Flip 改写着的格子。
    if (flyingRef.current) return
    if (
      revealBusyRef.current ||
      inspectFlipRef.current !== null ||
      inspectReturnRef.current !== null
    ) {
      return
    }
    // 此刻这张小卡还是可见的（held 要等下一次渲染才为 true），正好当飞行起点。
    // 而 Flip 把它和展示卡对上号靠的是两边同一个 data-flip-id（就是 instanceId）。
    const slot = boardRef.current?.querySelector(
      `[data-flip-id="${CSS.escape(ai.instanceId)}"]`,
    )
    if (slot == null) return
    inspectFlipRef.current = Flip.getState(slot)
    openInspect({ card: handCardOfAi(ai), instanceId: ai.instanceId })
  }

  /**
   * 点展示遮罩 = 关掉放大查看，那张卡飞回原来的格子。
   *
   * 强制展示期间同样会点到这块遮罩，但那条链路是不可跳过的，所以这里靠 inspecting 判空挡掉；
   * 飞入还没到位（inspectHeldRef 为 false）时也不理，免得半路掉头。
   */
  const handleShowcaseClick = () => {
    if (inspecting === null || !inspectHeldRef.current || inspectReturnRef.current !== null) return
    inspectHeldRef.current = false
    floatRef.current?.kill()
    floatRef.current = null
    // 在卡还停在屏幕中央、还没被 React 摘掉的这一帧取位置，飞回那段从这儿接着走。
    const el = revealCardRef.current
    if (el !== null) {
      // 飞回那 0.6 秒同样要冻住手牌：遮罩这时已经在淡出，挡不住指针了。
      inspectReturnRef.current = {
        state: Flip.getState(el),
        id: inspecting.instanceId,
        token: acquireLanding(),
      }
    }
    closeInspect()
  }

  // 展示层演着的时候玩家什么都不该点得动（遮罩本来就吃掉了指针事件，这里是让手牌和
  // 「结束出牌」按钮在视觉上也是关着的）。
  const showcasing = reveal !== null || inspecting !== null
  // 出牌和「结束出牌」同一个口径：不是我的出牌轮、对局已结束、正在等回包、展示层演着、
  // 有牌正在飞、正在给一张技能牌选目标时都锁住。
  // 选目标那一档还兼着另一件事：锁上 HandFan 的 disabled，它才知道这次出牌被受理了
  //（在等玩家选目标），不会把那张牌当成"父组件没受理"送回扇形（见 HandFanProps.onPlay）。
  const actionsLocked =
    !myPlayTurn ||
    view.status !== 'playing' ||
    awaiting ||
    showcasing ||
    landing ||
    targeting !== null
  /**
   * 手牌彻底冻住（连 hover 都不接）的时刻：屏幕上有牌在飞或刚落地、展示层正演着，
   * 或者正在给一张技能牌选目标。
   *
   * 刻意比 actionsLocked 窄一截：不是我的回合、等回包这些"只是出不了牌"的时刻
   * 玩家仍然应该能把牌抬起来看清楚，那归 HandFan 的 disabled 管（两者的分工见 HandFanProps）。
   * 展示期间遮罩本来就吃掉了指针事件，但展示开始前指针已经停在某张牌上的话
   * 它不会收到 pointerleave，那张牌会一直抬着，所以这里也一并冻上。
   * 选目标态同理，而且更要紧：那一刻指针几乎肯定还压在刚点出去的那张牌上，
   * 不冻的话它会一直保持放大，把玩家要选的战场整个挡住。
   */
  const handFrozen = landing || showcasing || targeting !== null
  /**
   * 轮到对方出牌。回合牌匾只认它，手牌的灰墨态也只认它（和下面的 quizWait）。
   *
   * 刻意不复用 actionsLocked：那个口径里还压着 awaiting / landing / showcasing 这些瞬态锁，
   * 自己回合里每打一张牌都会开关一次，拿它当灰墨态的判据，整排手牌会跟着一亮一灰地闪。
   * 这两个只跟着"该谁动"走，一整段等待里恒定不变。
   *
   * 复用 myPlayTurn 是为了让"该谁动"只有一份口径：它已经含了 phase === 'play'，
   * 所以这里再判一次 phase 之后，!myPlayTurn 就等价于 activePlayer !== mySeat。
   */
  const waitingForFoe = view.status === 'playing' && state.phase === 'play' && !myPlayTurn
  /** 答题阶段：双方都出不了牌，等场上的 AI 答完。 */
  const quizWait = view.status === 'playing' && state.phase === 'quiz'
  /**
   * 交给 HandFan 的"为什么出不了牌"。它不挡操作（那仍归上面的 actionsLocked），
   * 只决定手牌要不要进灰墨态、点上去弹哪句提示（见 HandFanProps.lockReason）。
   */
  const handLockReason: HandLockReason | null = waitingForFoe
    ? 'foe-turn'
    : quizWait
      ? 'quiz'
      : null

  /**
   * 现算的话每次渲染都是个新数组，两个 Fan 的 useGSAP 会跟着重跑一遍归位补间；
   * 而这个组件光是 awaiting / skillShow / reveal 变一下就要重渲染好几次，
   * 手牌根本没动却在那儿反复补间。按 hand 记住，手牌真换了才重建。
   */
  const handCards = useMemo(() => me.hand.map(handCardOfInstance), [me.hand])
  const foeHandCards = useMemo(() => foe.hand.map(handCardOfInstance), [foe.hand])

  // ---------- 飞行与进场 ----------

  useGSAP(
    (_context, safe) => {
      const pending = flipStateRef.current
      if (pending === null) {
        // 演出途中也会因为别的局面更新跑到这儿（包括对手的牌正在飞的时候），
        // 那时不能把锁解掉。判据是 flyingRef：它和 landing 永远同进同出。
        if (flyingRef.current === false) setLanding(false)
      } else {
        flipStateRef.current = null
        // 新局面到手了，这条链路的兜底定时器可以撤了：底下要么当场解锁，要么解锁交给这段飞行的收尾。
        // 不撤的话，往返慢一点就会被它在飞行途中把手牌放开（见 PLAY_LOCK_FALLBACK）。
        lockFallbackRef.current?.kill()
        lockFallbackRef.current = null
        // 必须显式把战场上的新元素交给 Flip：不传 targets 的话它会退回用 state.targets，
        // 也就是手牌里那个已经被 React 摘掉的旧节点，补间挂在脱离文档的 div 上，
        // 战场小卡一动不动。Flip 不会自己按 data-flip-id 去全文档找新元素（架构 5.5）。
        const target = document.querySelector<HTMLElement>(
          `.battle__board [data-flip-id="${CSS.escape(pending.id)}"]`,
        )
        if (target === null) {
          // 没有落点可飞，这次就没有飞行动画，锁当场放开。
          releaseLanding(pending.token)
        } else {
          // 落地特效是在 onComplete 里才建的补间，出了 useGSAP 回调的同步区间，
          // 不用 contextSafe 包一层就不归 context 管，组件卸载时 revert 不掉。
          const landed = () => {
            // Flip 把 zIndex 直接写死在元素的内联样式上，飞完不会自己收——
            // 不清的话这张 tile 会永久停在第 60 层，之后一直压着手牌（见 .battle__board 的注释）。
            // 只能点名清 zIndex：clearProps: true 会把落位用的 transform 一起抹掉。
            gsap.set(target, { clearProps: 'zIndex' })
            playSummonFx(target)
            // 锁再多挂一会儿，等落地特效也演完（见 SUMMON_FX_TAIL）。
            gsap.delayedCall(SUMMON_FX_TAIL, () => releaseLanding(pending.token))
          }
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
          `[data-ai-id="${CSS.escape(id)}"]`,
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
  // 从有牌变回空时（AI 牌）从展示位接着飞到对方战场行并落地。
  useGSAP(
    (_context, safe) => {
      if (reveal !== null) {
        const card = revealCardRef.current
        const overlay = overlayRef.current
        if (card === null || overlay === null) {
          // 理论上到不了：reveal 非空时展示卡就在同一次渲染里，layout effect 里 ref 必然已挂上。
          // 真到了这儿也得把闸放开，否则 revealBusyRef 会永远卡在 true，
          // 之后的横幅全堵在队列里、也再没有第二次展示。
          revealBusyRef.current = false
          pumpSkillCancel()
          pumpBanner()
          return
        }
        const pending = revealFlipRef.current
        revealFlipRef.current = null
        const { landingId, hitId, key: shownKey } = reveal

        // 遮罩接管所有指针事件：强制动画期间玩家什么都点不了。
        // 用 autoAlpha 而不是 opacity——它顺手改 visibility，遮罩看不见时就不吃指针事件。
        //
        // 遮罩上的补间（两条链路各一进一出，外加 abortReveal 那条）都必须 overwrite: 'auto'。
        // 遮罩是常驻节点，两条链路紧挨着衔接时会同时有补间活着：比如刚点关闭查看、
        // 返程的淡出还在跑（0.3s），对手就出了牌，这条淡入随即起跑。默认不 overwrite 的话
        // 两条一起改 autoAlpha，后结束的那条说了算——淡出赢了遮罩就停在 0
        //（visibility: hidden），强制展示期间玩家能点穿遮罩。让新补间干净接管旧的就没有这回事。
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

        /** 停留到点：停浮动、遮罩淡出，AI 牌把位置交给下一段飞行，技能牌原地淡出。 */
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
              // 对方那张技能牌刚看完，这才轮到"它被抵消了"这一层。
              pumpSkillCancel()
              // 展示期间憋着的横幅（比如对方出完牌轮到我）到这儿才放出来。
              pumpBanner()
            },
          })
          if (landingId !== null) {
            // 在卡还停在屏幕中央、还没被 React 摘掉的这一帧取位置，下一段飞行从这儿接着走。
            // 遮罩这时已经开始淡出、马上就不吃指针了，而牌还要飞 0.6 秒再冒 0.8 秒烟，
            // 所以这段也要上演出锁，把手牌一起冻住。
            if (el !== null) {
              landingFlipRef.current = {
                state: Flip.getState(el),
                id: landingId,
                token: acquireLanding(),
              }
            }
            setReveal(null)
            return
          }
          if (el === null) {
            setReveal(null)
            return
          }
          const hitTile = tileOf(boardRef, hitId)
          if (hitTile !== null) {
            // 干扰类技能：从展示位接着飞到被命中的格子上，落点播命中特效。
            // 那个格子本来就在场上、也不会动，所以这段不用 Flip，直接把展示卡挪过去就行。
            const hit = () => {
              playSkillHitFx(hitTile)
              setReveal((current) => (current?.key === shownKey ? null : current))
            }
            flyToTile(el, hitTile, safe ? safe(hit) : hit)
            return
          }
          // 技能牌没有落点，原地淡出。必须等淡出跑完再清 state：
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
          // 找不到起飞点时的降级路径（只有技能牌会走到这儿）：没有 Flip 起点就从中央淡入，
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

      // 局部名字用 landingFlight，别写成 landing：那是外面那个演出锁的 state。
      const landingFlight = landingFlipRef.current
      if (landingFlight === null) return
      landingFlipRef.current = null
      // 落点那个格子此刻已经跟着 held 变 false 恢复可见了。useGSAP 是 layout effect，
      // 恢复可见和 Flip 把它摆到起飞位置发生在同一次绘制之前，中间不会闪一下空格子。
      const tile = boardRef.current?.querySelector<HTMLElement>(
        `[data-flip-id="${CSS.escape(landingFlight.id)}"]`,
      )
      if (tile == null) {
        // 没有落点可飞，这次就没有飞行动画，锁当场放开（同我方出牌那条）。
        releaseLanding(landingFlight.token)
        return
      }
      // 同我方出牌：onComplete 出了同步区间，里面新建的特效补间必须包一层才归 context 管。
      const landed = () => {
        // 同我方出牌：Flip 写在内联样式上的 zIndex 飞完不会自己收，不清的话这张 tile 会
        // 永久停在 1200 层——那比展示遮罩（1100）还高，之后每次展示都会被它戳穿。
        gsap.set(tile, { clearProps: 'zIndex' })
        playSummonFx(tile)
        // 锁挂到落地特效也演完，和我方出牌一个节奏（见 SUMMON_FX_TAIL）。
        gsap.delayedCall(SUMMON_FX_TAIL, () => releaseLanding(landingFlight.token))
      }
      Flip.from(landingFlight.state, {
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
      if (overlay === null) {
        // 飞不成了，锁得还回去，否则手牌永远解不开。
        releaseLanding(back.token)
        return
      }
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
      if (target == null) {
        releaseLanding(back.token)
        return
      }
      // onComplete 出了同步区间，里面的 gsap.set 不包一层就不归 context 管。
      const settled = () => {
        // 同另外两段飞行：Flip 写在内联样式上的 zIndex 飞完不会自己收，不清的话这张 tile
        // 会永久停在 1200 层——那比展示遮罩（1100）还高，之后每次展示都会被它戳穿。
        gsap.set(target, { clearProps: 'zIndex' })
        releaseLanding(back.token)
      }
      Flip.from(back.state, {
        targets: target,
        duration: REVEAL_OUT_DUR,
        ease: 'power2.inOut',
        scale: true,
        // 层级必须给：飞回途中要压过正在淡出的遮罩（1100），同对手牌落场那段飞行。
        zIndex: REVEAL_FLIGHT_Z,
        onComplete: safe ? safe(settled) : settled,
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
  const category = state.questions[state.round - 1]?.category

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
    <div className="battle">
      <HandDrawnFilterDefs />
      <BattleTopBar status={{ round: state.round, myScore: me.score, foeScore: foe.score }} />

      <div className="battle__layout">
        <aside className="battle__sidebar battle__sidebar--left" aria-label="双方状态">
          <OrnateFrame className="battle__sidebar-frame battle__sidebar-frame--players">
            <PlayerPanel player={foe} />
            <PlayerPanel player={me} />
          </OrnateFrame>
        </aside>

        <main className={`battle__battlefield${testMode ? ' battle__battlefield--test' : ''}`}>
          {testMode ? <FoeHand hand={foe.hand} onPlay={playForFoe} /> : null}

          {/* data-picking 只管一件事：拖着干扰技能时把「松手 放到场上」那颗提示药丸收起来
              ——这张牌不是往场上放的，得松手在某张小卡身上。落点区的边框高亮照常亮着。
              和 useCardDrag 打上来的 data-drop-* 是各自独立的属性，互不覆盖。 */}
          <div
            className="battle__board"
            ref={boardRef}
            data-picking={targetMode === 'none' ? undefined : 'true'}
          >
            <span className="battle__drop-cue battle__drop-cue--board" aria-hidden="true">
              <strong>松手</strong>
              放到场上
            </span>
            {/* 烟尘挂在这一层，不塞进 tile：tile 的裁剪层 overflow: hidden 会把它切掉。
                刻意不给它 z-index，也刻意排在两行之前，飞行中的卡（zIndex 60 / 1200）
                和场上的 tile 才都压得住它。 */}
            <div className="battle__smoke-layer" ref={smokeLayerRef} aria-hidden="true" />

            <div className="battle__row battle__row--foe">
              {foe.board.map((ai) => (
                <BoardTile
                  key={ai.instanceId}
                  ai={ai}
                  // 对方的 AI 有两种"由展示层代管"：玩家点开查看，或者它正停在展示位上等落场。
                  held={
                    inspecting?.instanceId === ai.instanceId ||
                    reveal?.landingId === ai.instanceId
                  }
                  // 只有还没被干扰的对手小卡是合法目标。点击路（'pick'）还要把它抬到压暗层之上
                  // 才点得动；其余小卡（含我方那一行）留在压暗层底下，点它们等于点空白 = 取消。
                  target={targetMode === 'none' || ai.interfered === true ? 'none' : targetMode}
                  onActivate={() => (targeting === null ? handleInspect(ai) : confirmTarget(ai))}
                />
              ))}
            </div>

            <div className="battle__row battle__row--mine">
              {me.board.length === 0 ? (
                <span className="battle__board-hint">将手牌拖入战场</span>
              ) : (
                me.board.map((ai) => (
                  <BoardTile
                    key={ai.instanceId}
                    ai={ai}
                    held={inspecting?.instanceId === ai.instanceId}
                    // 干扰技能只打对面，我方这一行永远不是目标。
                    target="none"
                    onActivate={() => handleInspect(ai)}
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

          {view.lastRejection !== null ? (
            <div className="battle__reject">{view.lastRejection}</div>
          ) : null}
        </main>

        <aside className="battle__sidebar battle__sidebar--right" aria-label="回合操作">
          <OrnateFrame className="battle__sidebar-frame battle__sidebar-frame--actions">
            <div className="battle__turn">
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
            {/* 在等别人的时候按钮换个说法：它照旧是灰的，但"结束出牌"在这时读起来像是还能点。
                三句都是四五个字，匾额宽度是 min(224px, 100%) 且 overflow: hidden，
                换文案撑不破框。 */}
            <PlaqueButton
              disabled={actionsLocked}
              onClick={() => sendMine({ type: 'END_PLAY', player: mySeat })}
            >
              {waitingForFoe ? '等待对方…' : quizWait ? '答题中…' : '结束出牌'}
            </PlaqueButton>
          </OrnateFrame>
        </aside>
      </div>

      {/*
        回合牌匾：一块吊在顶栏正下方的小匾，只在对方出牌那段时间挂出来。

        常驻 DOM 靠 data-on 开关，隐藏态才淡得出去——挂在条件渲染上的话元素一没就没了，
        谈不上退场过渡。整层不吃指针事件。
        只认 waitingForFoe：答题阶段两边都不出牌，"对方回合"是句错话，那时留给手牌的
        小字提示和侧栏状态行去说；终局后更没有回合可言。

        它会盖住对手倒扇形（z-index 20）中间那一两张牌背，这是接受的：牌匾正好标在行动方
        头上，位置本身就是信息，而手牌张数侧栏的玩家面板另有一份。

        测试房整个不挂（和上面的 OpponentFan 同理）：那边顶部换成了摊开的对方手牌条，
        而且是玩家亲自替对方出牌，"对方回合"在那儿既是句错话，牌匾还会盖住那排卡面。
      */}
      {testMode ? null : (
        <div className="battle__turn-plaque" data-on={waitingForFoe ? 'true' : undefined}>
          <span className="battle__turn-plaque-cords" aria-hidden="true" />
          <div className="battle__turn-plaque-body">
            {/* 框线单独画成 SVG 才好套手绘滤镜：CSS 的 border 直接 filter 会把匾里的字一起抖歪
                （PlaqueButton 那边同理，见它的 .plaque-button__frame）。 */}
            <svg
              className="battle__turn-plaque-frame"
              viewBox="0 0 252 66"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect x="0.75" y="0.75" width="250.5" height="64.5" rx="8.25" />
            </svg>
            <span className="battle__turn-plaque-label">对方回合</span>
            {/* 三个跳动的点：静止的一行字看着像界面卡住了，这里要说的恰恰是"对方还在动"。 */}
            <span className="battle__turn-plaque-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      )}

      {/* 对手手牌：吊在视口顶边的倒扇形，只显示张数、当强制展示的起飞点。
          恒 disabled——本项目不防作弊（架构 4.1），客人手里确实有对手的牌，
          但玩家不该点得动它。张数信息侧栏的玩家面板本来就有一份。 */}
      {testMode ? null : <OpponentFan cards={foeHandCards} onReveal={noopReveal} disabled />}

      {/* 三个开关分工不同：disabled 是"出不了牌但还能 hover 看牌"（不是我的回合、等回包……），
          frozen 是演出期间整排手牌冻住连 hover 都不接，lockReason 是 disabled 加一句"为什么"，
          自带禁用，另外把"在等对方 / 在等答题"画成灰墨态和点击反馈。见 HandFanProps。
          disabled 这里照旧传 actionsLocked：它比 lockReason 宽，还含着那些瞬态锁。 */}
      <HandFan
        cards={handCards}
        dropZoneRef={boardRef}
        returnZoneRef={returnZoneRef}
        onPlay={handlePlay}
        disabled={actionsLocked}
        frozen={handFrozen}
        lockReason={handLockReason}
        // 选目标态下这张牌留在扇形里抬起来亮着，整排其余的压暗（不接指针那件事归 frozen，
        // 上面那行已经把选目标态算进去了）。
        castingId={targeting?.instanceId ?? null}
        onDragStateChange={setDraggingId}
      />

      {/*
        选目标态（点击路）的全屏压暗：战场、手牌、侧栏、顶栏一起暗下去，
        只有可选目标的小卡（抬到 76）和正在施放的那张手牌（扇形整层抬到 77）留在亮处。
        点这一层的任何位置都是取消，所以它必须**吃**指针事件。
        拖拽路不铺这一层——拖着的牌在扇形里（z-index 20），压暗层会连它一起压黑。
      */}
      {targeting !== null ? (
        <div className="battle__targeting" onClick={cancelTargeting}>
          <div className="battle__targeting-hint">
            <span className="battle__targeting-text">
              选择目标：对方一名未被干扰的 AI
              {/* 括注单独包一层：卡名要么整块跟在后面，要么整块折到下一行，不能被劈开 */}
              <span className="battle__targeting-card">（{getCard(targeting.cardId).name}）</span>
            </span>
            {/* 整层都能点着取消，这个按钮只是把"能取消"明写出来；重复调一次没有副作用。 */}
            <button type="button" className="battle__targeting-cancel" onClick={cancelTargeting}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {/* 特效层：技能牌在中央亮相、横幅一条条排队播，整层不吃指针事件。 */}
      <div className="battle__fx" aria-hidden="true">
        <div className="battle__banner-slot" ref={bannerSlotRef} />
        {skillShow !== null ? (
          <div className="battle__skill-show" key={skillShow.key} ref={skillShowRef}>
            <HandCardFace card={handCardOfDefinition(skillShow.cardId)} />
          </div>
        ) : null}
      </div>

      {/*
        展示层，强制展示和放大查看共用。遮罩常驻 DOM（默认 visibility: hidden，不吃指针事件），
        这样停留结束后它能自己淡出去——挂在 state 上的话，state 一清元素就没了，淡出无从谈起。
        展示卡则跟着 showcase 存亡：强制展示要拿它当 Flip 的起点，把飞行接力给战场上的新 tile；
        放大查看则拿它当飞回原格的起点。
        遮罩淡入之后吃掉全部指针事件：强制展示期间玩家什么都点不了，
        而放大查看期间点它（也就是点屏幕任意处）就是关闭查看。
      */}
      <div
        className={
          inspecting !== null ? 'reveal-overlay reveal-overlay--closable' : 'reveal-overlay'
        }
        ref={overlayRef}
        aria-hidden="true"
        onClick={handleShowcaseClick}
      />
      {showcase !== null ? (
        <div className="reveal-clip" key={showcase.key} ref={revealClipRef}>
          <div className="reveal-card" ref={revealCardRef} data-flip-id={showcase.flipId}>
            {/* 翻面层，结构和手牌一致：两面重叠、由 flipTo 按角度切 opacity（见 ui/flipCard.ts）。
                放大查看不翻面，只用 setFlipAngle 把它定死在正面。 */}
            <div className="reveal-card__inner">
              <div className="reveal-card__face" data-flip-face="front">
                {/* 卡面布局尺寸仍是 150×225，靠这一层整体放大，字和描边才一起变大而不是被拉伸。 */}
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
        三个全屏过场。它们和特效层不一样，是要**吃掉指针事件**的：
        演的时候玩家不能出牌，等它们退场再说。所以放在 .battle__fx 外面单独挂。
      */}
      {coinToss !== null ? (
        <div className="coin-toss" key={coinToss.key} ref={coinTossRef}>
          <div className="coin-toss__coin">
            {/* 这一层承担 rotationY，下面两面靠 data-flip-face 对号（契约见 ui/flipCard.ts）。 */}
            <div className="coin-toss__inner" ref={coinInnerRef}>
              <span className="coin-toss__face" data-flip-face="front">
                <img
                  className="coin-toss__img"
                  src="/battle/coin-first.webp"
                  alt="先手"
                  draggable={false}
                />
              </span>
              <span className="coin-toss__face coin-toss__face--back" data-flip-face="back">
                <img
                  className="coin-toss__img"
                  src="/battle/coin-second.webp"
                  alt="后手"
                  draggable={false}
                />
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

      {/* 英雄技能抵消。key 同抛硬币：每次都换一套新 DOM，上一次留下的内联样式不会跟到下一次。
          大字是技能名，下面那行说清楚"谁抵消了谁的哪张牌"。 */}
      {skillCancel !== null ? (
        <div className="skill-cancel" key={skillCancel.key} ref={skillCancelRef}>
          <p className="skill-cancel__title">{skillCancel.title}</p>
          <p className="skill-cancel__text">{skillCancel.text}</p>
        </div>
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

/**
 * 按实例 id 找战场上那个格子。
 *
 * 查询必须限定在战场容器里：手牌、战场小卡、展示卡共用同一套 data-flip-id，
 * 满文档找会抓错元素（同 startReveal / handleInspect 里那几处查询）。
 */
function tileOf(
  boardRef: RefObject<HTMLDivElement | null>,
  instanceId: InstanceId | null,
): HTMLElement | null {
  if (instanceId === null) return null
  return (
    boardRef.current?.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(instanceId)}"]`) ??
    null
  )
}

/**
 * 让一张已经停在屏幕上的技能卡飞向战场某个格子，缩到格子大小的同时淡出，落地再交给调用方。
 *
 * 不走 Flip：Flip 是"同一张牌换了个容器"，而这里目标格子本来就在场上、也不会动，
 * 飞过去的那张卡是要消失的，用普通补间反而更直白。
 * 位移写成相对量（`+=`）：起飞前那张卡身上往往还留着别的补间写下的 transform
 * （展示位的呼吸浮动就会留下一个 y），写绝对值会先跳一下再飞。
 * 缩放按两边的实际宽度比算，展示卡（放大 1.7 倍）和中央亮相的技能卡（原尺寸）
 * 各自都能正好缩成小卡那么大。
 */
function flyToTile(node: HTMLElement, tile: HTMLElement, onArrive: () => void): void {
  const from = node.getBoundingClientRect()
  const to = tile.getBoundingClientRect()
  // 位移要除以舞台缩放：两个 rect 量到的是缩放之后的屏幕像素，而 GSAP 的 x / y 写的是
  // 舞台内像素（口径见 ui/battleStage.ts）。scale 是纯比值，两个宽度相除时自然抵消，不用管。
  const { scale } = battleStageMetrics()
  gsap.to(node, {
    // 变换原点在正中，所以只要把两个矩形的中心对上，缩放多少都不影响落点。
    x: `+=${(to.left + to.width / 2 - (from.left + from.width / 2)) / scale}`,
    y: `+=${(to.top + to.height / 2 - (from.top + from.height / 2)) / scale}`,
    scale: from.width === 0 ? 1 : to.width / from.width,
    autoAlpha: 0,
    duration: SKILL_FLIGHT_DUR,
    ease: 'power2.in',
    overwrite: 'auto',
    onComplete: onArrive,
  })
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

/** 侧栏里的一块玩家面板：英雄、名字、当前总分、手牌和牌堆张数。 */
function PlayerPanel({ player }: { player: PlayerState }) {
  return (
    <div className="battle__player-panel" data-player={player.id}>
      <HeroBadge hero={player.hero} skillUsed={player.heroSkillUsed} />
      <span className="battle__player-name">{player.name}</span>
      <span className="battle__player-score">{player.score}</span>
      <span className="battle__player-piles">
        手牌 {player.hand.length} · 牌堆 {player.deck.length}
      </span>
    </div>
  )
}

/**
 * 玩家面板左边那张小英雄牌。
 *
 * 英雄牌不进牌组、不上战场，所以它不走 BoardTile 那套（没有 Flip、没有放大查看），
 * 只是把同一份卡面按 --hero-card-scale 缩小画一遍，看得到名字和技能就够了。
 * 技能用掉之后整块置灰、卡下面那行标签变成「Debug 已用」——Debug 一局只发动一次，
 * 玩家得能一眼看出这张牌还能不能指望上。
 */
function HeroBadge({ hero, skillUsed }: { hero: HeroId | null; skillUsed: boolean }) {
  if (hero === null) return null
  const card = getHero(hero)
  return (
    <div
      className={skillUsed ? 'battle__hero battle__hero--used' : 'battle__hero'}
      // 卡面缩到 60 多像素宽，技能说明那几行字实际读不清，鼠标停一下能看全文。
      title={`${card.name}（${card.enName}）｜${card.skillName}：${card.skillText}`}
    >
      <div className="battle__hero-card">
        <HandCardFace card={heroCardData(card)} />
      </div>
      <span className="battle__hero-tag">
        {skillUsed ? `${card.skillName} 已用` : card.skillName}
      </span>
    </div>
  )
}

/**
 * 场上的一个 AI。三层结构：tile 管 Flip 飞行，tilt 管倾斜和裁剪，inner 是整张卡面缩小。
 *
 * held 表示这张卡此刻由展示层代管（玩家正放大查看它，或者对手打出的 AI 牌还停在展示位）：
 * 格子还占着位置，但整张卡不可见（见 .battle__tile--held），
 * 免得屏幕中央和战场上同时出现两张一模一样的卡。
 *
 * target 表示这张卡在"选目标"里的角色（'none' 就是平时）：
 * - `'drag'` 玩家正拖着一张干扰技能，这张卡是合法目标：只亮一圈呼吸的橙色描边。
 *   **不能抬层级**：拖着的那张牌在扇形里（z-index 20），抬上去会盖在它前面。
 * - `'pick'` 点击路的选目标态：同一圈描边，外加抬到全屏压暗层之上，这样它才亮着、也点得动。
 * 这时点击的含义变了，所以回调叫 onActivate 而不是 onInspect——
 * 由父组件按当前状态决定这一下是放大查看还是选中目标。
 */
function BoardTile({
  ai,
  held,
  target,
  onActivate,
}: {
  ai: AiInstance
  held: boolean
  target: 'none' | 'drag' | 'pick'
  onActivate: () => void
}) {
  const card = handCardOfAi(ai)
  const targetable = target !== 'none'
  const classes = ['battle__tile']
  if (held) classes.push('battle__tile--held')
  if (targetable) classes.push('battle__tile--targetable')
  if (target === 'pick') classes.push('battle__tile--target-lift')
  return (
    <div
      className={classes.join(' ')}
      // data-ai-id 全场唯一，事件层靠它定位这个单位（现在只有对方上场的简易进场在用）。
      // data-flip-id 敌我两侧都要给：它是 Flip 用来把两个容器里的节点对号的键，
      // 我方靠它把手牌里的旧节点接到战场上的新节点，对方靠它把展示卡接到落场的格子，
      // 放大查看的飞回也靠它。实例 id 形如 p1-c7，本来就全局唯一，标上不会撞车。
      data-ai-id={ai.instanceId}
      data-flip-id={ai.instanceId}
      role="button"
      tabIndex={0}
      aria-label={target === 'pick' ? `选择目标 ${card.name}` : `查看 ${card.name}`}
      // 走 pointerdown 而不是 click：拖着手牌路过战场时不该顺手点开一次查看，
      // 而 pointerdown 上能立刻判断这一下是不是落在小卡上（click 要等松手才来）。
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        event.stopPropagation()
        onActivate()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        // 空格在这个位置的默认行为是把页面往下滚一屏，回车也可能被外层当成提交，都不要。
        event.preventDefault()
        onActivate()
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
      {/* 这张卡是当前的合法目标：一圈会呼吸的橙色描边（补间在 BattleField 里，见 targetPulseRef）。
          橙色是"可以打这里"的专用色，和上场追光那圈金色分得开。
          同样放在裁剪层外面，理由和上面那圈追光一样。 */}
      {targetable ? <div className="battle__tile-target-ring" aria-hidden="true" /> : null}
      {/* 「已干扰」角标常驻显示，跟着 interfered 这个状态走而不是靠动画残留：
          它既是给玩家看的记号，也解释了这张卡为什么不能再被选中。 */}
      {ai.interfered === true ? <span className="battle__tile-mark">已干扰</span> : null}
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
  // backText 走 ui/cardText.ts 那一份：图鉴页也显示同一段话，拼法只留一处。
  const base = { id: card.id, definitionId: card.id, name: card.name, text: card.text, backText: cardBackText(card) }
  if (card.kind === 'ai') {
    return { ...base, kind: 'ai', model: card.model }
  }
  return { ...base, kind: 'skill' }
}

/**
 * 从场上的 AI 单位拼出卡面数据。
 *
 * 单位上现在没有会变的数值，所以直接读卡牌定义就够了；
 * 哪天加了"上场后被增益/削弱"的属性，这里要改成读实例，否则小卡会一直显示原始数值。
 * backText 照常留着：战场小卡自己不翻面，但它被放大查看、或者对手打出时飞到屏幕中央，
 * 用的都是同一份数据，而展示卡是有背面的。
 */
function handCardOfAi(ai: AiInstance): HandCardData {
  return { ...handCardOfDefinition(ai.cardId), id: ai.instanceId }
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
    const ai = player.board.find((item) => item.instanceId === instanceId)
    if (ai !== undefined) return getCard(ai.cardId).name
  }
  return '场上 AI'
}
