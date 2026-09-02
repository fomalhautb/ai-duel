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
 *   对手出牌的强制展示（reveal，不可打断）和玩家点开一张卡的放大查看（inspect，点遮罩关闭；
 *   战场小卡和左侧栏那两张英雄牌都走它）；
 * - 轻量提示（第几轮、轮到谁出牌）走中央横幅，一次只播一条，多条排队。
 * 视觉全是占位，只求节奏顺、看得懂，美术另做。
 */

import { useRef, useState, useEffect, useLayoutEffect, useMemo } from 'react'
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import {
  downgradeTargetOf,
  effectivePlayCost,
  getCard,
  getHero,
  other,
  upgradeTargetOf,
} from '@ai-duel/core'
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
  QuestionCategory,
} from '@ai-duel/core'
import { useMatch, useMatchEvents } from '../match/useMatch'
import type { MatchDriver, MatchView } from '../match/driver'
import { battleStageMetrics } from './battleStage'
import { BattleTopBar } from './BattleTopBar'
import { CardBackHidden } from './CardBackHidden'
import { HandCardFace, HandFan } from './HandFan'
import type { CardPlayVia, HandCardData, HandLockReason } from './HandFan'
import { MatchResult } from './MatchResult'
import type { MatchStageCue, MatchStageTutorial } from './matchStageTutorial'
import { OpponentFan } from './OpponentFan'
import { OrnateFrame } from './OrnateFrame'
import { PlaqueButton } from './PlaqueButton'
import { playSkillTargetingSound, playUrgeSound } from './soundEffects'
import { pickRandomUrgeId, urgeLineOf } from './urgeLines'
import type { UrgeLine } from './urgeLines'
import { cardBackText } from './cardText'
import { attachCardTilt } from './cardTilt'
import type { CardTiltHandle } from './cardTilt'
import { CARD_HEIGHT, CARD_WIDTH } from './fanMath'
import { flipTo, setFlipAngle, syncFlipFaces } from './flipCard'
import { heroArtSrc } from './heroArt'
import { heroCardData } from './heroCard'
import { QUESTION_CATEGORY_LABELS } from './labels'
import {
  EVOLVE_STAGGER,
  playEvolveFx,
  playRemovalFx,
  playSkillHitFx,
  playSummonFx,
} from './playSummonFx'
import { RoundSettleLayer } from './RoundSettleLayer'
import type { RoundSettle, SettleAiResult, SettleScore } from './RoundSettleLayer'
import { boardTargetsOf, handTargetsOf } from './skillTargets'
import type { SkillTargetMode } from './skillTargets'
import { affectedCaptionOf, tileMarksOf } from './tileMarks'
import { useStageScale } from './useStageScale'

gsap.registerPlugin(useGSAP, Flip)

/**
 * 战场小卡跟着指针倾斜的最大角度。
 *
 * 比手牌大卡（10°）大一点：小卡在屏幕上只占 110×165（见 styles.css 的 --tile-w / --tile-h），
 * 同样的角度看起来位移小得多，要稍微加点量才看得出来。
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

/**
 * 开局发牌的兜底放行时间（秒）。
 *
 * 发牌默认憋着，正常由抛硬币过场的收尾放开（见 dealHeld）。要是这一局压根没有 GAME_STARTED
 *（联机客人接手一局打到一半的对局就是这样），那条收尾永远不会来，牌会一直压在卡堆上。
 * 开局事件是 driver 构造时就发出来的、挂载后第一个 effect 就送到（架构 5.2），
 * 所以只要这个时间盖得住"挂载到第一批事件"这一小会儿就够，取多长不影响正常开局。
 */
const DEAL_HOLD_FALLBACK = 0.8
/**
 * 回合末补牌的兜底放行时间（秒）。
 *
 * 双方都确认之后那批事件一到就把补牌憋住，正常由回合结算层的退场放行（见 dealHeld）。
 * 那条路要是没走到（比如结算层被别的路径提前换掉、退场动画的 onComplete 不会再来），
 * 牌就会一直压在卡堆上、操作也跟着一直锁着，所以另配一条兜底。
 *
 * 要盖住的时间很短：憋牌和"阶段离开 settle"是同一批事件带来的，结算层下一帧就开始退场，
 * 只有整层淡出的 EXIT_DUR（0.45 秒，见 RoundSettleLayer）这一段。2 秒是四倍余量。
 *
 * 注意这条兜底不能取长：它一到点就放行，而那时结算层要是还立着，牌就跑到遮罩后面去飞了，
 * 正是这条兜底本来要防的事情反过来发生。所以宁可短一点、宁可偶尔早放行，也不留大余量。
 */
const ROUND_DEAL_HOLD_FALLBACK = 2

/** 一条中央横幅从淡入到淡出的总时长（秒），排队时按它算下一条什么时候上。 */
const BANNER_IN = 0.3
const BANNER_HOLD = 0.75
const BANNER_OUT = 0.35

/**
 * 放大查看的那张卡原来摆在哪：战场上的一个格子，还是左侧栏里的英雄牌。
 * 飞回时要按它决定去哪个容器里找原位（见 inspectOriginOf）。
 */
type InspectSource = 'tile' | 'hero'

/**
 * 正在被放大查看的那张卡（战场小卡或侧栏英雄牌）。
 *
 * 这张卡**没有**离开原位：原位还占着地方（只是隐藏着，见 .battle__tile--held /
 * .battle__hero--held），展示层只是多渲染了一份放大的副本。
 * flipId 同时是飞回原位时 Flip 的配对键：战场小卡用实例 id，英雄牌用 heroFlipId 拼的键。
 */
interface InspectTarget {
  card: HandCardData
  flipId: string
  source: InspectSource
  /**
   * 英雄原画卡的图片地址（见 ui/heroArt.ts）。非空时展示层画的是这张整图，
   * 不是 card 拼出来的文字卡面；card 仍然要给，图取不到时还得靠它兜底。
   */
  art: string | null
  /**
   * 放大态卡下方那行字幕，没什么可说的就为 null，整行不渲染。
   *
   * 两条链路各用它说一件卡面上写不下的事：
   * - 英雄牌：原画上没印技能，而"点开英雄牌看技能"正是这条链路存在的理由，
   *   所以把「技能名：技能说明」补在卡下面。
   * - 战场小卡：卡面自带说明，但说不出这个单位本轮被哪几张技能牌影响过
   *   （小卡上的角标只写状态，见 affectedCaptionOf）。
   */
  caption: string | null
}

/** 左侧栏两块玩家面板各是谁的。卡堆和发牌动画靠它对上号。 */
type DealSide = 'mine' | 'foe'

/**
 * 英雄牌上那颗主动技能按钮的全部内容。只有我方那块面板会拿到，对方那块恒为 null——
 * 对手的技能什么时候发是他自己的事，这边只看得到"用没用过"（卡面灰化 + 角标）。
 */
interface HeroSkillButton {
  /** 按钮上印的字，就是技能名（如「精准检索」）。 */
  label: string
  disabled: boolean
  onActivate: () => void
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
   * 这张技能命中的那个 AI（打向战场格子的那几档目标才有，其余为 null）。
   * 展示停留结束后卡不再原地淡出，而是飞向这个 instanceId 对应的战场格子并播命中特效。
   * 和 landingId 的区别：landingId 是"这张牌自己变成那个格子"（AI 卡上场），
   * hitId 是"飞过去打在一个本来就在场上的格子上"，那个格子不动。
   */
  hitId: InstanceId | null
  key: number
}

/**
 * 每一档选目标态下，顶边那条提示说的话（「选择目标：…」后面那半句）。
 * 四档的合法目标各不相同，光说"选一个目标"玩家会点错人。
 */
const TARGET_HINTS: Record<SkillTargetMode, string> = {
  'foe-ai': '对方一个未被干扰的 AI',
  'own-ai': '己方一个还没被保送的 AI',
  'own-affected-ai': '己方一个正被干扰的 AI',
  'own-hand-ai': '手牌里一张要弃掉的 AI 牌',
}

/** 一个合法目标都没有时的提示。这时候怎么打都是白打，干脆不受理这次出牌。 */
const NO_TARGET_TIPS: Record<SkillTargetMode, string> = {
  'foe-ai': '对方没有可干扰的 AI',
  'own-ai': '你场上没有可保送的 AI',
  'own-affected-ai': '你场上没有正被干扰的 AI',
  'own-hand-ai': '你手牌里没有 AI 牌',
}

/** 拖着技能牌松手却没落在合法目标上时的提示。手牌那一档不走拖拽，所以没有它。 */
const DROP_MISS_TIPS: Record<Exclude<SkillTargetMode, 'own-hand-ai'>, string> = {
  'foe-ai': '松手要落在对方 AI 上',
  'own-ai': '松手要落在己方 AI 上',
  'own-affected-ai': '松手要落在己方被干扰的 AI 上',
}

/**
 * 正在挑一个目标。非空即"选目标态"：全屏压暗，只有合法目标亮着可点，点别处都是取消。
 *
 * 两条链路共用这一套压暗 + 呼吸描边 + 顶部提示条，只有"谁是合法目标"和"选完发什么指令"不同：
 *
 * - `'skill-card'` 一张要选目标的技能牌（点击路；拖拽路松手当场就定了，用不着这个状态）。
 *   instanceId 是那张已经点出去、正抬在扇形里等目标的手牌
 *   （选完就带着目标发出去，取消就落回扇形，见 HandFanProps.castingId）；cardId 给提示条印卡名。
 *   `mode` 决定亮的是哪一批：三档打战场（对方行 / 己方行），'own-hand-ai' 那档改亮压暗层上
 *   单独铺开的一排手牌 AI 牌（见渲染处的 .battle__hand-pick）。
 * - `'hero-skill'` 主动英雄技能（陈丹琦升己方一个、梅拉妮·珀金斯降对方一个）。
 *   目标在哪一行由英雄决定（见 heroSkillDirectionOf），手牌完全不参与，所以只记 heroId。
 *   它不走 `mode`：英雄技能不是技能牌，合法目标另有一套判据（见 isLegalTarget）。
 */
type TargetingState =
  | { kind: 'skill-card'; instanceId: InstanceId; cardId: CardId; mode: SkillTargetMode }
  | { kind: 'hero-skill'; heroId: HeroId }

/**
 * 战场上下两行各是谁的。
 *
 * 选目标时必须连"这张卡在哪一行"一起判：干扰和降级只打对面，升级只打自己，
 * 光看单位本身分不出合不合法。
 */
type BoardSide = 'mine' | 'foe'

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
  /**
   * 顶栏右端那一格控件（静音、离开、教程的「跳过教程」），由各个界面自己决定摆哪几个。
   * 对局页给静音加离开，教程给静音加跳过，/test、/result 这些调试页一个都不给。
   */
  topBarActions?: ReactNode
  /**
   * 新手教程挂上来的限制与回调（见 ui/matchStageTutorial.ts）。正式对局不传。
   *
   * 这个 prop 只做两件事：把逐张手牌的锁和「结束出牌」的锁并进现有的判据里，
   * 以及在几段演出的收尾处喊一声。界面的其余部分对教程一无所知。
   */
  tutorial?: MatchStageTutorial
  /**
   * 盖在对局画面上的额外一层，现在只有教程的引导层。
   *
   * 必须由这里渲染而不是让调用方并排放在 MatchStage 外面：`.battle-scaler` 带 transform，
   * 是个层叠上下文，挂在外面的浮层不管写多大的 z-index 都会整块盖住全屏过场。
   */
  overlay?: ReactNode
}

export function MatchStage({
  driver,
  testMode = false,
  resultActions,
  topBarActions,
  tutorial,
  overlay,
}: MatchStageProps) {
  const view = useMatch(driver)

  // 还没拿到局面（联机客人在等房主开局），或者开局前就断了。
  // 下面那个组件的一整套 hook 都要求 state 存在，所以拆成两个组件而不是在中间早退。
  if (view.state === null) {
    return (
      <BattleFrame>
        <div className="battle battle--waiting">
          <BattleTopBar />
          <BattleActions>{topBarActions}</BattleActions>
          <div className="battle__waiting">
            <p className="battle__waiting-text">
              {view.status === 'aborted'
                ? view.abortReason
                : view.link === 'down'
                  ? '网络不稳，正在重连…'
                  : '正在等房主开局…'}
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
        topBarActions={topBarActions}
        tutorial={tutorial}
        overlay={overlay}
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
 *
 * 缩放层上那个 stage-scaler 是给 JS 认的：ui/battleStage.ts 照它查当前舞台，
 * 卡组页的 .deck-scaler 也带同一个类，两页共用同一套坐标换算。样式仍写在 .battle-scaler 上。
 *
 * 缩放系数由 useStageScale 量 .battle-stage 的宽算出来写进 --battle-scale，
 * 不在 CSS 里算（Safari 上会整块塌掉，原因见 ui/useStageScale.ts）。
 *
 * 导出给结算测试页（screens/SettleTestScreen.tsx）复用：那一页也要把结算层放进同一套
 * 舞台里才对得上排版，抄一份的话两边迟早会漂。
 */
export function BattleFrame({ children }: { children: ReactNode }) {
  const scalerRef = useStageScale<HTMLDivElement>('--battle-scale')
  return (
    <div className="battle-frame">
      <div className="battle-stage">
        <div className="battle-scaler stage-scaler" ref={scalerRef}>
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * 顶栏右端那一格控件（静音、离开、教程的「跳过教程」）。
 *
 * 它画在顶栏那一行上，但**不是顶栏的子节点**，而是和顶栏并排、绝对定位盖上去的。
 * 两个原因：
 * - 顶栏本身是 z-index 70 的层叠上下文，装在里面的东西再怎么写 z-index 也钻不出去，
 *   而教程的引导层（1000）会把整条顶栏压暗、纯讲解的那几步还会铺一层吃掉所有点击的捕获层——
 *   「跳过教程」正是那时候最该点得到的按钮。排在 1150 就压过引导层和全屏过场（1100~1101）。
 * - 顶栏中间那块比分是靠自身居中算出来的，图标要是当成网格列，多一个少一个都会把比分推偏。
 */
function BattleActions({ children }: { children?: ReactNode }) {
  if (children === undefined) return null
  return <div className="battle-actions">{children}</div>
}

/** 气泡挂多久。够读完最长那句（「快点啊，我等的花都谢了」），又不至于赖在屏幕上。 */
const URGE_BUBBLE_MS = 3200

/**
 * 「催一催」的喊话：一句话同时变成录音和右下角的气泡。
 *
 * 本端点的和对面发来的走同一条订阅（driver.urge 自己也会回调回来），所以两台电脑上
 * 弹的是同一句、放的是同一段录音，不用在按钮那边另写一份"自己这一下"的分支。
 *
 * nonce 是"第几次喊"，只用来重启计时和重播气泡动画：连点同一句时 line 不变，
 * 光靠它当依赖的话气泡会停在半路不动，计时也不会重置。
 */
function useUrgeShout(driver: MatchDriver): { line: UrgeLine; nonce: number } | null {
  const [shout, setShout] = useState<{ line: UrgeLine; nonce: number } | null>(null)

  useEffect(() => {
    let count = 0
    return driver.subscribeUrge((id) => {
      const line = urgeLineOf(id)
      // 对面发来的 id 理论上不会错（两端同一份代码），认不出就当没收到，别弹个空气泡。
      if (line === null) return
      playUrgeSound(id)
      count += 1
      setShout({ line, nonce: count })
    })
  }, [driver])

  const nonce = shout?.nonce
  useEffect(() => {
    if (nonce === undefined) return
    const timer = window.setTimeout(() => setShout(null), URGE_BUBBLE_MS)
    return () => window.clearTimeout(timer)
  }, [nonce])

  return shout
}

function BattleField({
  driver,
  view,
  state,
  testMode,
  resultActions,
  topBarActions,
  tutorial,
  overlay,
}: {
  driver: MatchDriver
  view: MatchView
  /** 就是 view.state，由上面判过空之后传进来，省得这里到处写 ?. */
  state: GameState
  testMode: boolean
  resultActions?: ReactNode
  topBarActions?: ReactNode
  tutorial?: MatchStageTutorial
  overlay?: ReactNode
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
   * targetInstanceId 非空（打向战场某个格子的技能）时，亮相完还要接着飞向那个格子。
   * 「模型蒸馏」打的是手牌，引擎刻意不在事件里带这个字段（见 core 的 SKILL_PLAYED），所以为 null。
   */
  const [skillShow, setSkillShow] = useState<{
    cardId: CardId
    targetInstanceId: InstanceId | null
    key: number
  } | null>(null)
  /** 开局抛硬币过场；播完置回 null 把整层卸载掉。 */
  const [coinToss, setCoinToss] = useState<{ firstPlayer: PlayerId; key: number } | null>(null)
  /**
   * 回合结算全屏层：答题揭晓、每个 AI 答了什么、本轮计分和确认按钮全在里面。
   *
   * 内容**只**存在这里，不去战场上找被罚下的那张小卡：事件是在 React 提交新快照之前送到的，
   * 提交一完成，答错的 tile 立刻就从战场上消失了，没有机会在它身上播罚下动画。
   * 所以这一层刻意盖住整个战场，把那次跳变藏在自己后面。
   * 收层由它自己的 onExited 回调触发（双方都确认、阶段离开 settle 之后）。
   */
  const [roundSettle, setRoundSettle] = useState<RoundSettle | null>(null)
  /**
   * 英雄技能抵消的全屏提示（现在只有 Debug 一种）。
   * 两行文案在收到 SKILL_CANCELED 那一刻就按当时的座位拼好，演的时候不再回头读局面。
   */
  const [skillCancel, setSkillCancel] = useState<(SkillCancelText & { key: number }) | null>(null)
  /** 正在放大查看的那张卡（战场小卡或侧栏英雄牌）；非空即"查看中"，同时也是遮罩可点关闭的开关。 */
  const [inspecting, setInspecting] = useState<InspectTarget | null>(null)
  /**
   * 发牌先憋着，等盖住屏幕的那层过场演完再放。全屏过场在 z-index 1100，
   * 它演的时候发牌等于发给遮罩看，玩家一张都瞧不见。两处会憋：
   *
   * - **开局**：初值就是 true。开局事件是挂载之后的 effect 才送到的（架构 5.2），
   *   那时两排扇形已经把开局手牌摆好、动画都排上了，等 coinToss 立起来再拦就晚了一拍。
   *   所以默认拦着，由抛硬币的收尾放开，另有一条兜底定时器防着"这一局根本没有过场"
   *  （见 DEAL_HOLD_FALLBACK）。
   * - **每轮结算后的补牌**：双方都确认之后，ROUND_CONFIRMED 和 CARD_DRAWN 是同一批事件，
   *   收到时回合结算层还立在屏幕上（它要等这批事件带来的 phase 变化才开始退场）；
   *   不拦的话那两张牌就在遮罩后面飞完了。所以在事件回调里当场重新拦上
   *  （见 useMatchEvents 里的 holdRoundDeal），由结算层的退场收尾放开
   *  （RoundSettleLayer 的 onExited），兜底见 ROUND_DEAL_HOLD_FALLBACK。
   */
  const [dealHeld, setDealHeld] = useState(true)
  /**
   * 两排扇形各自还压在卡堆上、没起飞的新牌张数。
   *
   * 卡堆上显示的是"局面里的剩余张数 + 这个数"：开局那 5 张牌一张张飞出去时，
   * 数字才会从 20 慢慢数到 15，而不是一上来就跳到 15。
   * 测试房里对方那排扇形不渲染（换成了摊开的手牌条），foe 恒为 0，卡堆直接显示局面里的数。
   */
  const [dealPending, setDealPending] = useState({ mine: 0, foe: 0 })
  /**
   * 两排扇形各自"进场动画还没全部落地"。
   *
   * 和上面的 dealPending 是两个信号：那个在牌起飞的瞬间就减（卡堆的数字要那时候变），
   * 这个要等最后一张真的落进扇形才清（见 HandFanProps.onDealBusyChange）。
   * 它只有一个用途——发牌全程锁住操作，见下面的 actionsLocked。
   * 测试房里对方那排扇形不渲染，foe 恒为 false（同 dealPending）。
   */
  const [dealBusy, setDealBusy] = useState({ mine: false, foe: false })
  /** 对手正打出的那张牌，强制展示在屏幕中央。 */
  const [reveal, setReveal] = useState<RevealTarget | null>(null)
  /** 正在给一张要选目标的技能牌挑目标（点击路）；非空即选目标态。 */
  const [targeting, setTargeting] = useState<TargetingState | null>(null)
  /**
   * 手上正拖着的那张手牌（HandFan 通知的，见它的 onDragStateChange）。
   * 只为一件事存在：拖着要选目标的技能牌时把场上的合法目标标出来。
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
  const skillCancelRef = useRef<HTMLDivElement>(null)
  /** 上场特效的烟尘容器。卸载时要把里面动态插的 DOM 一次清干净。 */
  const smokeLayerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const revealCardRef = useRef<HTMLDivElement>(null)
  /** 展示卡的裁剪层。飞行途中它把顶栏那一截挡住，落位后由 JS 撤掉（原因见 .reveal-clip）。 */
  const revealClipRef = useRef<HTMLDivElement>(null)
  /** 放大英雄牌时卡下方那行技能字幕。只有那条链路会挂上，别的展示为 null。 */
  const revealCaptionRef = useRef<HTMLParagraphElement>(null)
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
  /** 发牌憋着的兜底放行定时器。抛硬币一起来就把它撤掉，放行交给过场的收尾。 */
  const dealHoldFallbackRef = useRef<gsap.core.Tween | null>(null)
  /**
   * 回合末补牌憋着的兜底放行定时器，正常由回合结算层的退场收尾撤掉。
   * 和上面那条分开两个 ref：开局那条是挂载时就上、收到 GAME_STARTED 就撤，
   * 两条的生命周期不重叠但归属完全不同，共用一个 ref 只会让"现在等的是哪一条"说不清楚。
   */
  const roundDealFallbackRef = useRef<gsap.core.Tween | null>(null)
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
   * 待播的"进化变身"（AI_TRANSFORMED）。
   *
   * 和 popQueue 同一个套路：收到事件那一刻快照还没提交，格子上画的还是旧卡面，
   * 当场演就成了"旧卡面闪一下才换图"。攒到下一次提交后再播，闪的就是新卡面。
   */
  const evolveQueueRef = useRef<InstanceId[]>([])
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
  /** 待播的"原位那张卡飞向展示位"动画，记的是它起飞前的位置。 */
  const inspectFlipRef = useRef<Flip.FlipState | null>(null)
  /**
   * 待播的"从展示位飞回原位"动画。
   * 除了起飞状态和演出锁的编号，还要连"回哪儿"一起存：战场小卡和侧栏英雄牌不在同一个容器里。
   */
  const inspectReturnRef = useRef<{
    state: Flip.FlipState
    flipId: string
    source: InspectSource
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
  /**
   * 教程挂上来的那一份 prop。走 ref 的理由同 seatRef：
   * 报信号的地方全是动画收尾这类延迟回调，闭包捕获到的是好几秒前那次渲染的值。
   */
  const tutorialRef = useRef(tutorial)
  tutorialRef.current = tutorial

  /** 报一声舞台演出信号。没挂教程时整个是空操作，正式对局一分钱都不花。 */
  const stageCue = (name: MatchStageCue): void => {
    tutorialRef.current?.onStageCue?.(name)
  }

  /** 还没播的横幅文案，先进先出。 */
  const bannerQueueRef = useRef<string[]>([])
  /** 现在有一条横幅正在播，它播完才轮到下一条。 */
  const bannerBusyRef = useRef(false)
  /**
   * 有全屏过场正在演。这两个标志一起决定横幅要不要先憋着。
   *
   * 横幅在特效层（z-index 80），全屏过场和展示遮罩都在 1100，它们演的时候播横幅
   * 等于播给遮罩看——抛硬币那批里的第 1 轮宣告就是这么被盖掉的。
   * 所以过场期间只入队不播，等过场淡出的 onComplete 再把攒着的一起放出来。
   *
   * 用 ref 而不是读上面那两个 state：一批事件是在同一次回调里同步处理完的，
   * 这中间 React 还没重渲染，读 state 拿到的还是"过场没开始"的旧值。
   * 强制展示那一档的闸门是 revealBusyRef，理由一样。
   *
   * quizUpRef 盖的是整个回合结算层：从题目揭晓一直到双方确认完退场，中间横幅全憋着。
   */
  const coinUpRef = useRef(false)
  const quizUpRef = useRef(false)
  /*
   * 这里原先还有一个 quizRevealKeyRef，给旧揭晓层的收尾时间线判活用：那条线建在 MatchStage
   * 自己的 useGSAP 里，依赖变化时**不会**被 revert（架构 5.5），于是被顶替的旧收尾可能在新一层
   * 立起来之后才跑完，把 quizUpRef 和补牌闸门替新的那层提前收掉。
   *
   * 换成 RoundSettleLayer 之后这个问题结构上就没有了：整层带 React key，换一轮就是换一个组件实例，
   * 旧实例卸载时它自己那个 useGSAP context 直接 revert，退场补间被 kill、onComplete 不会再来，
   * 过气的收尾根本没有机会执行。所以那个 ref 一并删掉，不留一个永远为真的判活。
   */
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

  /**
   * 发牌憋着的兜底放行：这一局要是根本没有抛硬币过场，也得让开局手牌飞出来。
   * 收到 GAME_STARTED 时会把它撤掉（见那条 case），放行改由过场的收尾负责。
   *
   * 到点了还要再看一眼 coinUpRef——**光靠"收到 GAME_STARTED 就撤掉"是不够的**，
   * 开发模式下的 StrictMode 会让这条 effect 跑两遍，而开局事件只送得到第一遍：
   * 第一次挂载建定时器①，useMatchEvents 一订阅，driver 就把攒着的开局事件补发过来
   *（buffered 只补发给第一个订阅者、而且只发一次，见 driver.ts），GAME_STARTED 撤掉①；
   * StrictMode 接着卸载重挂，这里又建了定时器②，可重新订阅时 buffered 已经空了，
   * GAME_STARTED 不会再来，②就没人撤——0.8 秒后它把牌放出去，而硬币要转满 3 秒，
   * 于是"抛硬币和发牌同时播"。ref 跨 StrictMode 的重挂载是活的，所以②到点时
   * 靠 coinUpRef 认得出"硬币正演着"，直接不放行，放行仍旧交给硬币时间线的收尾。
   * 真正需要兜底的场景（联机客人中途接手，压根没有 GAME_STARTED）coinUpRef 恒为 false，不受影响。
   */
  useEffect(() => {
    const fallback = gsap.delayedCall(DEAL_HOLD_FALLBACK, () => {
      if (coinUpRef.current) return
      setDealHeld(false)
    })
    dealHoldFallbackRef.current = fallback
    return () => {
      fallback.kill()
      if (dealHoldFallbackRef.current === fallback) dealHoldFallbackRef.current = null
    }
  }, [])

  /**
   * 把回合末的补牌重新憋住，同时上一条兜底放行。
   *
   * 事件回调里调，那时早出了 useGSAP 回调的同步区间，delayedCall 建的补间不包一层
   * 就不归 context 管，组件卸载时 revert 不掉（架构 5.5）。
   */
  const holdRoundDeal = contextSafe(() => {
    setDealHeld(true)
    roundDealFallbackRef.current?.kill()
    roundDealFallbackRef.current = gsap.delayedCall(ROUND_DEAL_HOLD_FALLBACK, () =>
      setDealHeld(false),
    )
  })

  /**
   * 放行憋着的补牌，顺手撤掉兜底。由回合结算层的退场收尾调（onExited）。
   * 没在憋也照调不误（多一次同值 setState，React 自己会短路），
   * 所以不必判"这一轮到底憋没憋"——最后一轮和中途接手那两种不憋的情况照样走这里。
   */
  const releaseRoundDeal = () => {
    roundDealFallbackRef.current?.kill()
    roundDealFallbackRef.current = null
    setDealHeld(false)
  }

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
          // 队列彻底空了才算"这一轮的横幅播完"（教程的提示要等它，否则会和横幅糊在一起）。
          // pumpBanner 已经把下一条起起来了的话 bannerBusy 是开着的，这一下不成立。
          if (!bannerBusyRef.current && bannerQueueRef.current.length === 0) {
            stageCue('round-banner-done')
          }
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

  /**
   * 在战场上某个格子上闪一次命中特效（技能牌命中之外，主动英雄技能换卡也用这一下）。
   *
   * 事件回调早出了 useGSAP 回调的同步区间，里面新建的补间不包一层就不归 context 管，
   * 组件卸载时 revert 不掉（架构 5.5）。
   * 那个格子在事件到达时就已经在场上了（英雄技能换的是场上现成的单位，不是新上场的），
   * 所以这里当场就能查到、当场就能播——不像对方新上场的 AI 得排队等下一次提交。
   */
  const hitTileFx = contextSafe((instanceId: InstanceId) => {
    const tile = boardRef.current?.querySelector<HTMLElement>(
      `[data-ai-id="${CSS.escape(instanceId)}"]`,
    )
    if (tile == null) return
    playSkillHitFx(tile)
  })

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
   * 那两条指令挨得很近，回合结算层（1100）会直接盖在还没演完的展示（同样 1100）上。
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

  /**
   * 把一张即将从场上消失的小卡演成"化掉"（被内存紧缺 / 国产替代罚下）。
   *
   * 事件回调里调，那时早出了 useGSAP 回调的同步区间，里面新建的补间不包一层就不归 context 管，
   * 组件卸载时 revert 不掉（架构 5.5）。
   */
  const removeTile = contextSafe((tile: HTMLElement) => playRemovalFx(tile))

  useMatchEvents(driver, (events) => {
    // 回合末的补牌要憋到回合结算层退场再飞。推进轮次的是后手确认的那一下：引擎在一次
    // execute 里把 [ROUND_CONFIRMED, CARD_DRAWN×双方各 2, ROUND_STARTED, PLAY_TURN_STARTED]
    // 整批发过来（见 core 的 confirmRound），收到时结算层（z-index 1100）还整个立在屏幕上——
    // 它要等这批事件带来的 phase 变化才开始退场——不拦的话牌就在遮罩后面飞完了。
    //
    // 判据是"结算层真的立着，且这一批里 ROUND_CONFIRMED 后面还跟着 CARD_DRAWN"，三个条件缺一不可：
    // 先手确认的那一批只有 ROUND_CONFIRMED、没有补牌，局面根本没推进；
    // 最后一轮双方确认后跟的是 GAME_OVER、同样没有补牌，拦了就永远等不到退场来放行；
    // 测试面板的"加1张"那一批里没有 ROUND_CONFIRMED，属于玩家自己点出来的加牌，该当场就飞。
    // 牌堆抽空时 CARD_DRAWN 一条都不发，同样不该拦。
    //
    // 这条判据刻意保持简单，代价是有一个已知的边角没照顾到：结算层立着的那段时间里
    // 点测试面板的"加1张"，那一批只有 CARD_DRAWN、没有 ROUND_CONFIRMED，于是不拦，
    // 牌就在结算层后面飞完了。只有测试房的调试工具能造出这个时机，
    // 正式对局里玩家没有任何入口在答题 / 结算期间加牌，所以接受现状，不为它把判据变复杂。
    //
    // quizUpRef 那一条挡的是"没看见过 QUESTION_REVEALED 的那一端"：联机客人在答题 / 结算阶段
    // 中途接手时，match:start 直接给的是 quiz / settle 期的快照，结算层从来没立起来过
    //（roundSettle 恒为 null），也就没有退场来放行——拦了的话只能干等兜底超时。
    // 没有遮罩要等就当场发牌。
    // 事件回调里读 ref 拿到的正是现值：quizUpRef 是更早那批事件（QUESTION_REVEALED）置的，
    // 那之后 React 已经重渲染过了。
    //
    // 这一下必须和新手牌同一次提交送到两排扇形：事件回调和 driver 的快照 patch 在同一个同步块里，
    // React 的自动批处理会把它们合成一次重渲染，扇形第一次看到新牌时 dealHold 就已经是 true 了。
    // 就算哪天两边分成了两次提交也还兜得住：扇形那边 dealHold 变化沿上还会再重排一次，
    // 把已经排出去、还没跑过一帧的进场补间收回卡堆（见 HandFan 里那个 [dealHold] 的 layout effect）。
    const confirmedAt = events.findIndex((event) => event.type === 'ROUND_CONFIRMED')
    if (
      quizUpRef.current &&
      confirmedAt >= 0 &&
      events.slice(confirmedAt + 1).some((event) => event.type === 'CARD_DRAWN')
    ) {
      holdRoundDeal()
    }
    /**
     * 这一批里「鸡犬升天」升了哪些单位，循环跑完拿它拼一条横幅。
     *
     * 攒起来一起报而不是每个单位报一条：一张牌一口气升一片，一格一条横幅要排队播到下一轮。
     * `risingTidePlayed` 单独记一笔是为了报"一个都没升"那种情况——
     * 那时引擎一条 AI_TRANSFORMED 都不发，画面上什么都不动，
     * 玩家会以为牌打丢了（这张牌的效果本来就可能落空：场上全是链尾单位）。
     */
    const evolved: { owner: PlayerId; fromCardId: CardId; toCardId: CardId }[] = []
    let risingTidePlayed = false
    for (const event of events) {
      switch (event.type) {
        case 'GAME_STARTED':
          // 抛硬币定先手。开局事件是 driver 构造时就发出来的，靠 subscribeEvents 的补发机制
          // 送到这里（架构 5.2），所以组件刚挂载就能开播。
          // 全屏过场会盖住战场，选目标态一律先收掉（同 QUESTION_REVEALED 那条）。
          setTargeting(null)
          coinUpRef.current = true
          // 过场真的要演了，发牌的兜底放行可以撤了：改由下面那条时间线的收尾放行，
          // 开局手牌才不会在硬币还转着的时候飞出来（那时整个屏幕被 1100 那层盖着）。
          dealHoldFallbackRef.current?.kill()
          dealHoldFallbackRef.current = null
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
          // 记一笔"这一批里有人打了鸡犬升天"，循环跑完才知道它到底升了几个（见循环外那条横幅）。
          if (event.cardId === 'rising-tide') risingTidePlayed = true
          // 技能牌不上场，不亮出来的话画面上根本看不出有人打过牌，所以双方都要亮一次，
          // 只是亮法不同：我方那张刚从自己手里飞走，知道打的是什么，中央淡入一下就够；
          // 对方那张要从他手牌里飞到中央翻正，否则画面上什么都没发生过。
          // 打向战场格子的那几张（干扰、保送、玉净瓶）多一段：亮相完还要飞向被命中的那个格子。
          // 「模型蒸馏」不带 targetInstanceId（它打的是手牌），照旧只亮个相。
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
          // 被抵消就不再报"一个都没升"了：没升是因为效果整个作废，抵消那一层已经说清楚了。
          if (event.cardId === 'rising-tide') risingTidePlayed = false
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
        case 'HERO_SKILL_USED': {
          // 换卡这件事在快照里只剩换完的 cardId，所以前后两张卡名都从事件里取
          // （事件特意把 fromCardId / toCardId 一起报了出来，见 core 的 types.ts）。
          // 敌我共用这一句：谁发动的从技能名就看得出来，而战场上哪一格闪了光已经说明打的是谁。
          // 两个模型名都长的时候（「ChatGPT 5.6 Sol」这种）这条会在 860px 的横幅槽里折成两行，
          // 不截断也不缩字号：横幅底下是空的，两行居中大字照样读得顺。
          const hero = getHero(event.heroId)
          const from = getCard(event.fromCardId).name
          const to = getCard(event.toCardId).name
          showBanner(`${hero.skillName}！${from} → ${to}`)
          // 目标格上闪一下，和技能牌命中同一档特效：那一格的卡面下一次提交就换了脸，
          // 不闪一下的话画面上就是无缘无故地跳变。
          hitTileFx(event.targetInstanceId)
          break
        }
        case 'QUESTION_REVEALED': {
          // 全屏结算层开场：题目和标准答案先亮出来，等 driver 那边的自动驾驶把结果提交上来
          // （默认 2.5 秒后，那批事件不在这一批里），再往这一层里填结果和计分。
          // 结算层和展示层同在 1100，先把还没演完的展示收掉再开这一层（见 abortReveal）。
          abortReveal()
          // 进答题就出不了牌了，正选着目标的那张技能牌一并收掉（它会自己落回扇形）。
          setTargeting(null)
          // 还憋着没演的抵消提示直接丢掉：它说的是刚才那次出牌，等结算层演完再补一遍，
          // 就成了下一轮开头凭空冒出来的一句话，比不演更让人糊涂。
          pendingCancelRef.current = null
          quizUpRef.current = true
          // 轮次和计分前的总分在这一刻按快照采样：事件是在 React 提交新快照之前送到的，
          // 读的正是"这一轮还没结算"的那份，也就是结算层顶栏该显示的起点。
          const before = driver.getSnapshot().state
          const seat = seatRef.current
          setRoundSettle((current) => ({
            key: (current?.key ?? 0) + 1,
            question: event.question,
            round: before?.round ?? 1,
            scoresBefore: {
              mine: before?.players[seat].score ?? 0,
              theirs: before?.players[other(seat)].score ?? 0,
            },
            results: [],
            score: null,
          }))
          stageCue('quiz-open')
          break
        }
        case 'AI_ANSWERED': {
          // 结果渲染在结算层内部，不去动战场上那张即将被 React 移除的小卡。
          // 卡面身份直接读事件里的 cardId：答错的那个单位马上就被罚下，回头查快照会查空。
          const result: SettleAiResult = {
            instanceId: event.instanceId,
            cardId: event.cardId,
            mine: event.owner === seatRef.current,
            correct: event.correct,
            answer: event.answer,
            reasoning: event.reasoning,
          }
          setRoundSettle((current) =>
            current === null ? current : { ...current, results: [...current.results, result] },
          )
          break
        }
        case 'ROUND_SCORED': {
          // 事件里所有成对的字段都按座位号排，这里一次换算成结算层要的"我方 / 对方"。
          // verdict 一并带上：三档判定各配一句结论文案，光有 gains 说不出"为什么是他得分"，
          // 而那恰恰是这一版规则最需要讲给玩家的东西（见 core 的 RoundVerdict）。
          const seat = seatRef.current
          const foe = other(seat)
          const score: SettleScore = {
            correctCounts: {
              mine: event.correctCounts[seat],
              theirs: event.correctCounts[foe],
            },
            spent: { mine: event.spent[seat], theirs: event.spent[foe] },
            gains: { mine: event.gains[seat], theirs: event.gains[foe] },
            totals: { mine: event.scores[seat], theirs: event.scores[foe] },
            verdict: event.verdict,
          }
          setRoundSettle((current) => (current === null ? current : { ...current, score }))
          break
        }
        case 'AI_SAFE_PASSED': {
          // 这个 AI 答错了但被「保送」留在场上。它自己那条 AI_ANSWERED 刚刚才把结果卡建起来，
          // 这里只补一个标记：卡还是按"答错"画（红章、正文压暗），旁边多一枚「保送」说明它没下场。
          setRoundSettle((current) =>
            current === null
              ? current
              : {
                  ...current,
                  results: current.results.map((result) =>
                    result.instanceId === event.instanceId
                      ? { ...result, safePassed: true }
                      : result,
                  ),
                },
          )
          break
        }
        case 'AI_REMOVED': {
          // 被技能牌罚下（内存紧缺 / 国产替代）。事件是在 React 提交新快照之前送到的，
          // 所以此刻那张小卡还在战场上——趁这一下把它复制成一个幽灵留在特效层里演消失，
          // 真正的格子随下一次提交无声无息地没掉（详见 playRemovalFx）。
          const tile = boardRef.current?.querySelector<HTMLElement>(
            `[data-ai-id="${CSS.escape(event.instanceId)}"]`,
          )
          if (tile != null) removeTile(tile)
          break
        }
        case 'AI_TRANSFORMED':
          // 「鸡犬升天」的进化：还是同一个单位，卡面身份换了一张。换图这件事 React 跟着快照
          // 自己就做了，这里攒着 id 是为了在提交之后补一段"变身"的演出（见下面消费它的那段）。
          evolveQueueRef.current.push(event.instanceId)
          evolved.push({
            owner: event.owner,
            fromCardId: event.fromCardId,
            toCardId: event.toCardId,
          })
          break
        default:
          // AI_ELIMINATED 不单独播：结算层里那张卡的红叉和压暗样式已经说明了，
          // 而且被罚下的小卡会随着新快照直接从战场上消失（正好被结算层盖住）。
          // ROUND_CONFIRMED 也不用管：确认态由结算层直接读快照（见 RoundSettleLayer 的两路口径）。
          // CARD_DRAWN 的进场动画归 HandFan 自己管（这一批要不要先憋着已经在循环外判过了）；
          // GAME_OVER 由终局结算层接管；
          // COMMAND_REJECTED 走 view.lastRejection 那条提示。
          break
      }
    }

    // 「鸡犬升天」的总结横幅，排在所有事件之后：小卡上那一圈绿光只说得清"这一格升了"，
    // 说不清"这一下一共升了几个、双方各几个"，而这张牌最容易让人以为没生效的正是这一点。
    if (risingTidePlayed) {
      const mine = evolved.filter((one) => one.owner === seatRef.current).length
      const theirs = evolved.length - mine
      if (evolved.length === 0) {
        showBanner('鸡犬升天！场上没有可进化的 Agent')
      } else if (evolved.length === 1) {
        // 只升了一个就直接报是谁变成了谁：比"1 个 Agent 进化"具体，同英雄技能那条横幅。
        const only = evolved[0]!
        showBanner(
          `鸡犬升天！${getCard(only.fromCardId).name} → ${getCard(only.toCardId).name}`,
        )
      } else {
        const parts: string[] = []
        if (mine > 0) parts.push(`我方 ${mine} 个`)
        if (theirs > 0) parts.push(`对方 ${theirs} 个`)
        showBanner(`鸡犬升天！${parts.join('、')} Agent 进化`)
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

      // 有战场目标的技能：亮相完接着飞向目标格。飞行要等停留结束才起跑，那时早出了 useGSAP 回调的
      // 同步区间，里面新建的补间（飞行本身、以及命中特效那几条）都得包一层才归 context 管（架构 5.5）。
      const hit = () => {
        playSkillHitFx(target)
        // 教程的「技能牌使用后立即生效」要等这一下：命中特效之前说，玩家还没看见任何变化。
        stageCue('skill-hit')
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
            // 屏幕空出来了，开局那两手牌这才从各自的卡堆一张张飞出去（见 dealHeld）。
            setDealHeld(false)
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

  /**
   * 对局中断（对手断线）时把还在演的全屏过场收掉。
   *
   * 回合结算层要等双方确认、阶段离开 settle 才会自己退场，而中断时对面再也不会确认了；
   * 终局结算层在它下面（z-index 90 < 1100），不清掉的话玩家会被一层退不掉的遮罩挡死。
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
    // 抛硬币和回合结算层都被收掉了，放行发牌的那两条收尾也就不会来了；牌不该一直压在卡堆上。
    // 兜底定时器一起撤掉：它到点只会再喊一次同样的放行，留着没意义。
    roundDealFallbackRef.current?.kill()
    roundDealFallbackRef.current = null
    setDealHeld(false)
    // 发牌的锁也一并松开。牌照样会飞完并各自报一次 false，但那要等一整段动画；
    // 对局都中断了，锁着的界面没有任何意义（status 不是 playing，actionsLocked 本来就恒真）。
    setDealBusy({ mine: false, foe: false })
    setCoinToss(null)
    setRoundSettle(null)
    setSkillCancel(null)
    abortReveal()
    abortInspect()
    // 刻意只跟着 status 走：abortReveal / abortInspect 每次渲染都是新函数，
    // 进依赖数组会让这段每帧重跑，而它们读的全是 ref，闭包旧不旧无所谓。
  }, [view.status])

  // ---------- 选目标 ----------

  /**
   * 这张手牌打出时要选哪一档目标；不用选目标就是 null。
   * 判据完全照 core 的卡牌定义走（`SkillCard.target`），客户端不自己列名单。
   */
  const targetModeOf = (instanceId: string): SkillTargetMode | null => {
    const instance = me.hand.find((item) => item.instanceId === instanceId)
    if (instance === undefined) return null
    const card = getCard(instance.cardId)
    return card.kind === 'skill' ? (card.target ?? null) : null
  }

  /**
   * 某一档目标此刻在战场上的全部合法单位（规则在 ui/skillTargets.ts，那边有测试对着引擎守）。
   * 这里只是把"我"和"对手"填进去。
   */
  const targetsOnBoard = (mode: SkillTargetMode): AiInstance[] => boardTargetsOf(mode, me, foe)

  /** 「模型蒸馏」能弃掉的那些手牌：自己手上的 AI 牌，技能牌不算。 */
  const handTargets = handTargetsOf(me.hand)

  /**
   * 现在正在为哪一档目标做选择：点击路看正在施放的那张牌，拖拽路看手上拖着的那张。
   * 两条路都没有就是 null，战场上什么都不亮。
   */
  const activeTargetMode: SkillTargetMode | null =
    targeting?.kind === 'skill-card'
      ? targeting.mode
      : // 英雄技能那一档不走 mode（它不是技能牌），战场上亮谁由 isLegalTarget 单独判。
        targeting === null && draggingId !== null
        ? targetModeOf(draggingId)
        : null

  /**
   * 现在要不要把场上的合法目标标出来，标成哪一档：
   *
   * - `'pick'` 点击路的选目标态：全屏压暗，目标要抬到压暗层之上，而且得点得动；
   * - `'drag'` 手上正拖着一张要选目标的技能牌：只亮橙圈、不压暗，**也绝不能抬层级**
   *   ——拖着的牌在扇形里（z-index 20 那一层），把小卡抬上去会盖在它前面；
   * - `'none'` 都不是。
   */
  const targetMode: 'none' | 'drag' | 'pick' =
    targeting !== null ? 'pick' : activeTargetMode !== null ? 'drag' : 'none'

  /**
   * 此刻亮着的那批战场目标的实例 id。
   *
   * 敌我两行都要查它：现在四档里有三档打战场，其中两档（保送、玉净瓶）打的是**自己**这一行。
   * 收成一个集合而不是每张小卡各判一遍规则，是为了让"哪些能点"和"点了算不算数"
   * （confirmTarget / dropTargetOf）读的是同一份判断。
   */
  const targetIds = new Set(
    activeTargetMode === null ? [] : targetsOnBoard(activeTargetMode).map((ai) => ai.instanceId),
  )

  /** 我方英雄的主动技能往哪个方向换卡（没有主动技能就是 null）。 */
  const myHeroSkill = heroSkillDirectionOf(me.hero)

  /**
   * 我方英雄技能现在能打的全部单位。
   *
   * 引擎那边有同一条规则（见 core 的 useHeroSkill）：升级只挑己方、降级只挑对方，
   * 而且那张卡在升级链上得真有相邻的一代——链顶、链底和只有一代的那 8 张都打不了
   * （见 core 的 AI_UPGRADE_CHAINS）。这里提前算一遍，是为了让按钮在一个目标都没有时就灰掉，
   * 而不是让玩家点进选目标态才发现整场没有一张亮着。
   * 技能已经用掉时直接算空：那时按钮压根不渲染，这份列表也没人读。
   */
  const heroSkillTargets =
    myHeroSkill === null || me.heroSkillUsed
      ? []
      : myHeroSkill === 'upgrade'
        ? me.board.filter((ai) => upgradeTargetOf(ai.cardId) !== null)
        : foe.board.filter((ai) => downgradeTargetOf(ai.cardId) !== null)

  /**
   * 这一行里的这个 AI 现在是不是合法目标。两行小卡共用这一份口径。
   *
   * 技能牌那条按卡面的 `target` 分四档（对方行 / 己方行 / 手牌），规则在 targetIds；
   * 英雄技能按发动者定方向和边，判据和上面 heroSkillTargets 那份列表一致。
   * 拖拽态（targeting 为 null）走的一定是技能牌那条：英雄技能没有可拖的牌。
   */
  const isLegalTarget = (ai: AiInstance, side: BoardSide): boolean => {
    if (targeting?.kind === 'hero-skill') {
      return heroSkillDirectionOf(targeting.heroId) === 'upgrade'
        ? side === 'mine' && upgradeTargetOf(ai.cardId) !== null
        : side === 'foe' && downgradeTargetOf(ai.cardId) !== null
    }
    // 技能牌那条（点击路和拖拽路都走这里）：四档目标的规则只写在 targetIds 一处，
    // 这里不重判一遍，免得"哪些亮着"和"点了算不算数"两边的口径慢慢分家。
    // 那份集合本身已经区分了敌我行（boardTargetsOf 各从对应的 board 里挑），
    // 而实例 id 全局唯一，所以这一支用不上 side。
    return targetIds.has(ai.instanceId)
  }

  /** 这张小卡在选目标里的角色，直接喂给 BoardTile 的 target。 */
  const targetRoleOf = (ai: AiInstance, side: BoardSide): 'none' | 'drag' | 'pick' =>
    targetMode === 'none' || !isLegalTarget(ai, side) ? 'none' : targetMode

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
   * 量的是**牌自己的中心**而不是指针：鼠标下两者本来就重合（见 HandFan 的 dragTargetOf），
   * 而触屏下牌被特意抬到了手指上方半张卡，两者差了一截——那时候更得看牌，
   * 玩家瞄的是"这张牌盖住了谁"，不是自己指尖底下压着谁。判定还刻意放宽了 TARGET_SNAP，
   * 擦着小卡边缘松手也算命中，照炉石那种"差不多就行"的手感来。
   * 契约保证这时那张牌还停在松手位置（见 HandFanProps.onPlay）。
   */
  const dropTargetOf = (instanceId: string, mode: SkillTargetMode): AiInstance | null => {
    // 打自己人的那两张（保送、玉净瓶）量的是我方那一行，其余量对面那一行。
    const row = mode === 'foe-ai' ? foe.board : me.board
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
    // 只挑合法的话，松手在一张不能选的小卡上会打中旁边那张，玩家眼里就是"我明明放在它身上"。
    let best: { ai: AiInstance; distance: number } | null = null
    for (const ai of row) {
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
    if (best === null || !targetIds.has(best.ai.instanceId)) return null
    return best.ai
  }

  /**
   * 带着目标把一张技能牌发出去。拖拽路（松手命中）、点击路（点中目标）、
   * 以及模型蒸馏那条"点中自己手牌里一张 AI 牌"共用这一处。
   *
   * targetInstanceId 指的是场上单位还是手牌实例由卡牌定义那一档 `target` 决定
   * （见 core 的 `SkillCard.target`），这里只负责把 id 原样带上。
   *
   * 上的锁和无目标技能牌那条完全一样：技能牌不飞进战场，锁挂到中央亮相（以及亮相之后
   * 那段飞向目标的命中）演完为止，解锁在展示时间线的末尾。
   */
  const castSkillAt = contextSafe((instanceId: InstanceId, targetInstanceId: InstanceId) => {
    skillLockTokenRef.current = acquirePlayLanding()
    sendMine({
      type: 'PLAY_CARD',
      player: mySeat,
      instanceId,
      targetInstanceId,
    })
  })

  /**
   * 手牌被打出（拖进战场松手，或者轻点选中之后点那颗「打出」）。
   *
   * AI 牌和无目标技能牌两条路照旧：前者要飞进战场，所以先截 Flip 状态；
   * 后者打完就进弃牌堆，战场上没有它的落点，靠 SKILL_PLAYED 在中央亮相。
   *
   * 要选目标的技能牌按触发方式分两条：
   * - 拖出来的（via 'drag'）：松手落在哪张合法目标上就打谁，落在空处就当没打过（牌飞回手牌）；
   * - 点按钮打出的（via 'tap'）：进选目标态，全屏压暗，等玩家再点一次目标。
   *
   * 「模型蒸馏」（'own-hand-ai'）两条路都进选目标态：它要选的是自己手牌里的一张 AI 牌，
   * 战场上根本没有能松手的落点，拖到场上再喊一句"松手要落在 AI 上"只会把人骗进死路。
   */
  const handlePlay = contextSafe((instanceId: string, via: CardPlayVia) => {
    const instance = me.hand.find((item) => item.instanceId === instanceId)
    if (instance === undefined) return
    const card = getCard(instance.cardId)
    const mode = card.kind === 'skill' ? (card.target ?? null) : null

    if (mode !== null) {
      const pool = mode === 'own-hand-ai' ? handTargets : targetsOnBoard(mode)
      if (pool.length === 0) {
        // 一个合法目标都没有，怎么打都是白打。这里不受理这次出牌（不锁 disabled、也不上演出锁），
        // 于是 HandFan 下一帧就把牌送回扇形（见 HandFanProps.onPlay 的约定）。
        showBanner(NO_TARGET_TIPS[mode])
        return
      }
      if (via === 'drag' && mode !== 'own-hand-ai') {
        const target = dropTargetOf(instanceId, mode)
        // 落在战场空处 = 取消，同样靠"不受理"让牌自己飞回手牌。
        // 不退回选目标态：玩家已经用拖拽表达过意图了，半路换一套交互只会更懵。
        if (target === null) {
          showBanner(DROP_MISS_TIPS[mode])
          return
        }
        castSkillAt(instanceId, target.instanceId)
        return
      }
      // 选目标态必须在 onPlay 里**同步**开起来：它会把 actionsLocked 打开，
      // HandFan 才知道这次出牌被受理了（在等玩家选目标），不会把牌当成"父组件没受理"。
      // 这张牌本身留在扇形里，只是抬起来亮着（见 HandFanProps.castingId）。
      // 这里刻意不上演出锁：指令还没发出去，屏幕上也没有任何演出，
      // 冻手牌那件事由 targeting 自己喂给 handFrozen。
      playSkillTargetingSound()
      setTargeting({ kind: 'skill-card', instanceId, cardId: card.id, mode })
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

  /**
   * 选目标态下点中了一张小卡：把这一下发出去。技能牌和英雄技能各发各的指令。
   *
   * 还要再判一次合法：压暗层挡得住鼠标，挡不住键盘——小卡是 tabIndex=0 的 role="button"，
   * 回车照样点得到不亮的那几张，不判的话会白发一条被引擎拒掉的指令。
   */
  const confirmTarget = (ai: AiInstance, side: BoardSide) => {
    if (targeting === null || !isLegalTarget(ai, side)) return
    if (targeting.kind === 'hero-skill') {
      // 英雄技能不动手牌、也没有牌要飞，所以不上演出锁：屏幕上要演的只有一条横幅
      // 和目标格上闪一下，都由 HERO_SKILL_USED 那条事件负责（见 useMatchEvents）。
      setTargeting(null)
      sendMine({ type: 'USE_HERO_SKILL', player: mySeat, targetInstanceId: ai.instanceId })
      return
    }
    const { instanceId } = targeting
    // 两个 setState 在同一次事件里合成一次重渲染，actionsLocked 中途不会松开，
    // 扇形里那张抬着的牌也就不会先掉回去再飞走。
    setTargeting(null)
    castSkillAt(instanceId, ai.instanceId)
  }

  /**
   * 「模型蒸馏」的选目标：点中压暗层上摊开的那排手牌 AI 牌里的一张，把它弃掉换 Token。
   * 和上面那条的分别只在目标是手牌实例而不是场上单位，指令形状完全一样。
   */
  const confirmHandTarget = (instance: CardInstance) => {
    if (targeting?.kind !== 'skill-card' || targeting.mode !== 'own-hand-ai') return
    const { instanceId } = targeting
    setTargeting(null)
    castSkillAt(instanceId, instance.instanceId)
  }

  /** 取消选目标：不发指令，技能牌那条链路里那张牌跟着 actionsLocked 松开自己落回扇形。 */
  const cancelTargeting = () => setTargeting(null)

  /**
   * 点侧栏英雄牌上那颗技能按钮：进选目标态，等玩家点战场上的一个 AI。
   *
   * 和技能牌的点击路完全同一套交互（压暗 + 橙圈 + 顶部提示条），只是这一下不动手牌。
   * 按不动的情况全部由按钮自己的 disabled 拦下（见渲染处的 heroSkillButton），
   * 这里只兜一道类型上的判空。
   */
  const startHeroSkill = () => {
    if (me.hero === null || myHeroSkill === null) return
    setTargeting({ kind: 'hero-skill', heroId: me.hero })
  }

  /** 测试房里点对方手牌：无视出牌轮次替对方打出去，其余结算和正常出牌完全一致。 */
  const playForFoe = (instance: CardInstance) => {
    const card = getCard(instance.cardId)
    // 替对方打要选目标的技能牌时不做一套对手视角的选目标 UI：直接按那一档挑第一个合法目标。
    // 注意这里的视角是**对方**：他的 'foe-ai' 指的是我方场上那一行，'own-*' 才是他自己那行。
    // 一个都没有就照发不误（target 为 undefined），引擎会回一条 COMMAND_REJECTED，
    // 走 view.lastRejection 那条提示，正好也能在测试房里试出"没有合法目标"这条分支。
    const mode = card.kind === 'skill' ? card.target : undefined
    const target =
      mode === 'foe-ai'
        ? me.board.find((ai) => ai.interference === undefined)
        : mode === 'own-ai'
          ? foe.board.find((ai) => ai.safePassed !== true)
          : mode === 'own-affected-ai'
            ? foe.board.find((ai) => ai.interference !== undefined)
            : mode === 'own-hand-ai'
              ? foe.hand.find((item) => getCard(item.cardId).kind === 'ai')
              : undefined
    driver.send({
      type: 'DEBUG_PLAY_CARD',
      player: foeSeat,
      instanceId: instance.instanceId,
      ...(target === undefined ? {} : { targetInstanceId: target.instanceId }),
    })
  }

  /**
   * 放大查看那张卡的原位元素：战场小卡在战场容器里，英雄牌在左侧栏里。
   *
   * 查询必须限定容器：手牌、战场小卡、侧栏英雄牌、展示卡共用同一套 data-flip-id，
   * 满文档找会抓错元素（同 startReveal / tileOf 那几处查询）。
   */
  const inspectOriginOf = (flipId: string, source: InspectSource): HTMLElement | null => {
    const selector = `[data-flip-id="${CSS.escape(flipId)}"]`
    if (source === 'hero') {
      return document.querySelector<HTMLElement>(`.battle__sidebar--left ${selector}`)
    }
    return boardRef.current?.querySelector<HTMLElement>(selector) ?? null
  }

  /**
   * 现在能不能开一次放大查看。战场小卡和侧栏英雄牌共用这一份口径。
   *
   * 展示层同一时刻只归一条链路用，所以对手正在强制展示、或者上一次查看还没收干净时都不受理。
   */
  const canInspect = (): boolean => {
    if (reveal !== null || inspecting !== null) return false
    // 选目标态下点小卡的含义是"选中它"，不该再弹出放大查看。
    // 鼠标走不到这儿（压暗层挡着，可选的那几张也另走 confirmTarget），但键盘能：
    // 小卡是 tabIndex=0 的 role="button"，压暗层拦不住回车。侧栏英雄牌同理。
    if (targeting !== null) return false
    // 有牌正在飞或刚落地时也不受理：点开的很可能正是那张还被 Flip 改写着的格子。
    if (flyingRef.current) return false
    if (
      revealBusyRef.current ||
      inspectFlipRef.current !== null ||
      inspectReturnRef.current !== null
    ) {
      return false
    }
    return true
  }

  /**
   * 点战场小卡：把它放大到屏幕中央看清楚。
   * 卡下面那行字幕报本轮它被哪几张技能牌影响了——小卡上的角标只说得出状态，
   * 说不出是谁干的（见 affectedCaptionOf）。
   */
  const handleInspect = (ai: AiInstance) => {
    if (!canInspect()) return
    // 此刻这张小卡还是可见的（held 要等下一次渲染才为 true），正好当飞行起点。
    // 而 Flip 把它和展示卡对上号靠的是两边同一个 data-flip-id（就是 instanceId）。
    const slot = inspectOriginOf(ai.instanceId, 'tile')
    if (slot === null) return
    inspectFlipRef.current = Flip.getState(slot)
    openInspect({
      card: handCardOfAi(ai),
      flipId: ai.instanceId,
      source: 'tile',
      art: null,
      caption: affectedCaptionOf(ai, state.players[ai.owner].shielded === true),
    })
  }

  /**
   * 点侧栏的英雄牌：走和战场小卡完全同一条链路飞到屏幕中央放大，再点一下收回。
   *
   * 侧栏画的是英雄原画（见 ui/heroArt.ts），放大的也得是同一张图，否则飞到一半会换脸；
   * 原画上没有技能文字，所以另外给一行字幕补上「技能名：技能说明」——
   * "看英雄技能"这件事就靠这一下，不另做界面。
   * 侧栏那张是靠 CSS 的 transform scale 缩小画出来的，Flip 那边必须开 scale: true
   *（和战场小卡一样，见下面消费 inspectFlipRef 的那段）。
   */
  const handleInspectHero = (player: PlayerState) => {
    if (player.hero === null) return
    if (!canInspect()) return
    const flipId = heroFlipId(player.id)
    const slot = inspectOriginOf(flipId, 'hero')
    if (slot === null) return
    const hero = getHero(player.hero)
    inspectFlipRef.current = Flip.getState(slot)
    openInspect({
      card: heroCardData(hero),
      flipId,
      source: 'hero',
      art: heroArtSrc(hero.id),
      caption: `${hero.skillName}：${hero.skillText}`,
    })
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
        flipId: inspecting.flipId,
        source: inspecting.source,
        token: acquireLanding(),
      }
    }
    closeInspect()
  }

  // 展示层演着的时候玩家什么都不该点得动（遮罩本来就吃掉了指针事件，这里是让手牌和
  // 「结束出牌」按钮在视觉上也是关着的）。
  const showcasing = reveal !== null || inspecting !== null
  /**
   * 发牌还没演完：牌压在卡堆上等放行（dealHeld），或者已经在飞、还没全部落地（dealBusy）。
   * 两排扇形谁在演都算——回合末双方是同一批补牌，同时起飞也同时落地。
   *
   * 下面的 actionsLocked 和 handLockReason 都读这一份，不许各写一遍：
   * 两者必须在同一次提交里一起松开，否则手牌那边"锁解开了抖一下整排牌"的判据会落空
   *（它在 lockReason 变 null 那一刻回头看 effectiveDisabled，见 HandFan 那个 effect）。
   */
  const dealing = dealHeld || dealBusy.mine || dealBusy.foe
  // 出牌和「结束出牌」同一个口径：不是我的出牌轮、对局已结束、正在等回包、展示层演着、
  // 有牌正在飞、正在给一张技能牌选目标时都锁住。
  // 选目标那一档还兼着另一件事：锁上 HandFan 的 disabled，它才知道这次出牌被受理了
  //（在等玩家选目标），不会把那张牌当成"父组件没受理"送回扇形（见 HandFanProps.onPlay）。
  //
  // 最后那项是发牌：开局的 5 张和每轮结算后的补牌都是强制过场，牌还压在卡堆上、
  // 或者还在半空中的时候玩家不该出得了牌——不锁的话手牌会一边飞一边被打出去，
  // 飞行补间和出牌那段 Flip 抢同一批属性，画面直接乱掉。
  // 刻意只喂 disabled 不喂 handFrozen：frozen 一变就要重排一遍手牌，
  // 而重排会亲手掐掉正在飞的进场补间（见 HandFan 的 dealTweensRef），等于自己打断发牌动画；
  // 挡住出牌和「结束出牌」按钮已经够了，发牌期间 hover 看牌不算操作。
  const actionsLocked =
    !myPlayTurn ||
    view.status !== 'playing' ||
    awaiting ||
    showcasing ||
    landing ||
    targeting !== null ||
    dealing
  /**
   * 「结束出牌」比手牌多一道教程的闸：教学前两轮要求玩家先完成指定操作才能结束出牌
   *（规格 §15）。刻意不并进 actionsLocked——那个还喂给 HandFan 的 disabled，
   * 并进去会把手牌一起锁死，而那两步恰恰要玩家去打某一张牌。
   */
  const endPlayLocked = actionsLocked || tutorial?.endPlayBlocked === true
  /**
   * 发牌演完那一下报一次信号（开局 5 张和每轮补的 2 张都算）。
   * 只认下降沿：教程要等的是"牌已经躺进手里"这个时刻，牌还在飞的时候说什么都没用。
   *
   * 一轮里可能报两次：放行（dealHeld 转 false）和扇形报上 dealBusy 差着一次提交，
   * 中间那一帧两个都是 false，这条 effect 会先报一次，等牌真落地再报一次。
   * 不去修那一帧是因为没必要——信号只是"到过没有"，重复到达不产生任何额外动作，
   * 而等它的两步同时还等着「轮次横幅播完」，那条比发牌晚得多。
   */
  const dealingRef = useRef(dealing)
  useEffect(() => {
    const was = dealingRef.current
    dealingRef.current = dealing
    if (was && !dealing) stageCue('deal-done')
    // stageCue 读的是 ref，闭包旧不旧都无所谓，所以依赖只列 dealing。
  }, [dealing])
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
  const urgeShout = useUrgeShout(driver)
  /**
   * 答题和随后的回合结算：这两段双方都出不了牌，手牌一律灰着。
   * 结算（settle）也算进来，是因为它同样是"等着，什么都点不了"的一段。
   */
  const quizWait =
    view.status === 'playing' && (state.phase === 'quiz' || state.phase === 'settle')
  /**
   * 交给 HandFan 的"为什么出不了牌"。它不挡操作（那仍归上面的 actionsLocked），
   * 只决定手牌要不要进灰墨态、点上去弹哪句提示（见 HandFanProps.lockReason）。
   *
   * 前两档优先：发牌和"轮到对方 / 在答题"撞上时，玩家更该知道的是后者
   *（每轮补牌那次，对方先手的话整段等待里一直是「对方出牌中」，中途插一句「发牌中」反而碎）。
   * 排掉选目标态是为了守住"data-locked 和 data-casting 不同时出现"这条（见下面 HandFan 的
   * data-locked）：正常对局里两者撞不上（进答题就会 setTargeting(null)），
   * 但测试房的 DevPanel 能在选目标时凭空加一张手牌，那一下会同时满足。
   *
   * 发牌落地那一刻这一档变回 null，而 actionsLocked 里的 dealHeld / dealBusy 是同一批账，
   * 同一次提交里一起松开——HandFan 那边"锁解开了抖一下整排牌"的判据要读 effectiveDisabled，
   * 差一次提交就不弹了（见它那个 [lockReason] 的 effect）。
   */
  const handLockReason: HandLockReason | null = waitingForFoe
    ? 'foe-turn'
    : quizWait
      ? 'quiz'
      : dealing && targeting === null
        ? 'deal'
        : null

  /**
   * 我方英雄牌上那颗技能按钮要不要画、画成什么样；null 就是整颗不渲染。
   *
   * 只有两位主动英雄有这颗按钮，用掉之后整颗撤走——那时卡面已经灰下来、角上挂着「技能已用」，
   * 再留一颗按不动的按钮只会挡住卡面。
   *
   * 灰掉的口径两条：actionsLocked（不是我的出牌轮、演出正在放、正在选目标……，
   * 和「结束出牌」同一份口径）和"场上一个打得着的单位都没有"——后者引擎那边也会拒，
   * 但让玩家点完才收到一句拒绝太糟。
   *
   * 新手教程不用为这颗按钮补特判：教学局玩家用的是格蕾丝·霍珀，被动技能，
   * myHeroSkill 就是 null，整颗按钮天然不渲染（见 tutorial/content.ts 挑英雄的理由）。
   * 哪天教学局换成主动技能的英雄，得先决定它在教学里该不该出现，再来这里加一档。
   */
  const heroSkillButton: HeroSkillButton | null =
    me.hero === null || myHeroSkill === null || me.heroSkillUsed
      ? null
      : {
          label: getHero(me.hero).skillName,
          disabled: actionsLocked || heroSkillTargets.length === 0,
          onActivate: startHeroSkill,
        }

  /**
   * 现算的话每次渲染都是个新数组，两个 Fan 的 useGSAP 会跟着重跑一遍归位补间；
   * 而这个组件光是 awaiting / skillShow / reveal 变一下就要重渲染好几次，
   * 手牌根本没动却在那儿反复补间。按 hand 记住，手牌真换了才重建。
   */
  const handCards = useMemo(() => me.hand.map(handCardOfInstance), [me.hand])
  const foeHandCards = useMemo(() => foe.hand.map(handCardOfInstance), [foe.hand])

  /**
   * 这张手牌现在实际要扣多少 Token，交给 HandFan 判"打不起就变灰"。
   *
   * 卡面印的永远是原价（`tokenCost`），自己打过核电站时真正扣的是打折价，两者可能差好几点。
   * 所以这里问的是引擎那个函数（core 的 `effectivePlayCost`）而不是自己减一遍：
   * 最低封底 1 点这类边界只写在那一处，客户端另算一份迟早会和引擎的扣费对不上。
   */
  const myPlayCostOf = (card: HandCardData): number =>
    effectivePlayCost(me, getCard(card.definitionId ?? card.id))

  // ---------- 发牌 ----------

  /**
   * 两排扇形的发牌起点。每次要摆新牌时它们会现调一次，所以这里每次渲染换个新函数没关系
   *（函数体里只有一次 DOM 查询，闭包里什么都没捕获）。
   */
  const myDealOrigin = () => dealOriginOf('mine')
  const foeDealOrigin = () => dealOriginOf('foe')

  /**
   * 扇形报上来"还压着几张没起飞"。相等时原样返回，免得每次报同一个数都白重渲染一遍。
   * 这两个回调会被 GSAP 的 onStart 延迟调到，所以不能假设它跑在 React 的事件里。
   */
  const setMyDealPending = (count: number) =>
    setDealPending((current) => (current.mine === count ? current : { ...current, mine: count }))
  const setFoeDealPending = (count: number) =>
    setDealPending((current) => (current.foe === count ? current : { ...current, foe: count }))

  /**
   * 扇形报上来"进场动画演完没有"。两个扇形只在变化沿报，这里再判一次相等是为了中断路径：
   * 那边强行把两个都清成 false 之后，扇形迟到的那次 false 不该再惊动一次渲染。
   * 这两个回调既会在布局（layout effect）里被同步调到，也会被 GSAP 的 onComplete 延迟调到。
   */
  const setMyDealBusy = (busy: boolean) =>
    setDealBusy((current) => (current.mine === busy ? current : { ...current, mine: busy }))
  const setFoeDealBusy = (busy: boolean) =>
    setDealBusy((current) => (current.foe === busy ? current : { ...current, foe: busy }))

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

      // 进化：卡面已经跟着新快照换好了，这里补一段边缘追光 + 弹一下，
      // 让"这张卡刚变了个身份"这件事在画面上留个交代（见 playEvolveFx）。
      const evolves = evolveQueueRef.current
      if (evolves.length > 0) {
        evolveQueueRef.current = []
        // 一批里的每一格错开一点点起（见 EVOLVE_STAGGER）：一张牌能一口气升好几个单位，
        // 同时闪就成了一次整屏的亮，数不清到底升了几个。
        let index = 0
        for (const id of evolves) {
          const tile = boardRef.current?.querySelector<HTMLElement>(
            `[data-ai-id="${CSS.escape(id)}"]`,
          )
          if (tile == null) continue
          playEvolveFx(tile, index * EVOLVE_STAGGER)
          index += 1
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
            // 有战场目标的技能：从展示位接着飞到被命中的格子上，落点播命中特效。
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

        // 卡下面那行字幕（英雄牌是技能说明，战场小卡是本轮受了哪些技能牌影响；
        // 都没有可说的时它根本不渲染）等卡快飞到位再淡上来，起飞那一刻就亮着的话，
        // 字会先在半空中和飞行的卡各说各话。
        // fromTo 默认 immediateRender: true，所以哪怕带着 delay，隐藏也是这一帧就生效；
        // CSS 里不写初始 opacity，是为了万一这段没跑到，字幕仍然是看得见的那一档。
        const caption = revealCaptionRef.current
        if (caption !== null) {
          gsap.fromTo(
            caption,
            { autoAlpha: 0 },
            {
              autoAlpha: 1,
              duration: 0.28,
              delay: REVEAL_IN_DUR * 0.6,
              ease: 'power2.out',
              overwrite: 'auto',
            },
          )
        }

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
      // 原位那张卡此刻已经跟着 held 变 false 恢复可见了。useGSAP 是 layout effect，
      // 恢复可见和 Flip 把它摆到起飞位置发生在同一次绘制之前，中间不会闪一下空位。
      const target = inspectOriginOf(back.flipId, back.source)
      if (target === null) {
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
  // 牌匾在出牌阶段只展示题目类别；题面全文要等 QUESTION_REVEALED 才揭晓。
  const nextQuestion = state.questions[state.round - 1]
  const category = nextQuestion?.category

  /**
   * 展示层当前要渲染的那张卡：强制展示优先（它不可打断），否则是正在放大查看的那张。
   * 两条链路互斥，实际上不会同时非空，这个分支只是把"到底渲染谁"收成一处。
   *
   * key 让两条链路各自持有一份展示卡（对手出牌会中止正在进行的查看，两者相接时
   * DOM 不能被复用）：裁剪层每次都是新挂载的，上一轮撤裁剪时写的内联样式不会留到下一轮。
   *
   * art / caption 只有查看英雄牌那条会填（见 InspectTarget）：强制展示的永远是一张手牌，
   * 画的是文字卡面、也不配字幕。
   */
  const showcase =
    reveal !== null
      ? {
          card: reveal.card,
          flipId: reveal.flipId,
          key: `reveal-${reveal.key}`,
          art: null,
          caption: null,
        }
      : inspecting !== null
        ? {
            card: inspecting.card,
            flipId: inspecting.flipId,
            key: `inspect-${inspecting.flipId}`,
            art: inspecting.art,
            caption: inspecting.caption,
          }
        : null

  const turnHint = turnHintOf(view, state, mySeat)

  return (
    <div className="battle">
      <BattleTopBar status={{ round: state.round, myScore: me.score, foeScore: foe.score }} />
      <BattleActions>{topBarActions}</BattleActions>

      <div className="battle__layout">
        {/* 左侧栏上下两块：上=对方、下=我方。每块一张大英雄牌加一摞卡堆，
            卡堆同时是发牌飞行的起点（两排扇形靠 data-deck-side 找它）。
            中间那条分界线是第三行网格，把"这是两个人"分清楚（见 .battle__player-divider）。 */}
        <aside className="battle__sidebar battle__sidebar--left" aria-label="双方状态">
          <OrnateFrame className="battle__sidebar-frame battle__sidebar-frame--players">
            <PlayerPanel
              player={foe}
              side="foe"
              deckCount={foe.deck.length + dealPending.foe}
              heroHeld={inspecting?.flipId === heroFlipId(foe.id)}
              onInspectHero={handleInspectHero}
              skill={null}
            />
            <div className="battle__player-divider" aria-hidden="true">
              <span className="battle__player-divider-line" />
              <span className="battle__player-divider-gem" />
            </div>
            <PlayerPanel
              player={me}
              side="mine"
              deckCount={me.deck.length + dealPending.mine}
              heroHeld={inspecting?.flipId === heroFlipId(me.id)}
              onInspectHero={handleInspectHero}
              skill={heroSkillButton}
            />
          </OrnateFrame>
        </aside>

        <main className={`battle__battlefield${testMode ? ' battle__battlefield--test' : ''}`}>
          {testMode ? (
            <FoeHand hand={foe.hand} tokens={foe.tokens} onPlay={playForFoe} />
          ) : null}

          {/*
            「核电站」的减费提示，常驻挂到本轮结束（进下一轮 costReduction 清零，它自己就没了）。
            只读我方那一份：减费各记各的，对手打的核电站不影响我这边的费用（见 core 的
            effectivePlayCost）。手牌变灰的判据也是同一个函数，两边永远说的是同一件事。
          */}
          {me.costReduction > 0 ? (
            <div className="battle__cost-cut">核电站生效：本轮出牌费用 -{me.costReduction}</div>
          ) : null}

          {/* data-picking 只管一件事：拖着要选目标的技能牌时把「松手 放到场上」那颗提示药丸收起来
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

            {/* 每张小卡都套一层 slot：真正排在行里的是 slot，它可以被挤得比卡还窄，
                卡在里面居中溢出，于是场面摆满时相邻两张对称地互相压边，而不是折行
                （行已改成永不换行，理由见 .battle__row）。 */}
            <div className="battle__row battle__row--foe" data-tutorial-anchor="battlefieldFoe">
              {foe.board.map((ai) => (
                <div className="battle__board-slot" key={ai.instanceId}>
                  <BoardTile
                    ai={ai}
                    shielded={foe.shielded === true}
                    // 对方的 AI 有两种"由展示层代管"：玩家点开查看，或者它正停在展示位上等落场。
                    // 查看那一路认的是 flipId：展示层现在也管侧栏英雄牌，那两张的键是拼出来的
                    // （见 heroFlipId），不是实例 id。
                    held={
                      inspecting?.flipId === ai.instanceId ||
                      reveal?.landingId === ai.instanceId
                    }
                    // 合法目标的口径见 isLegalTarget：技能牌按卡面那一档挑（复读机 / 黑白颠倒
                    // 挑的正是这一行没被干扰过的），珀金斯的降级是"降得动的对手小卡"，
                    // 陈丹琦的升级则整行都不是目标。
                    // 点击路（'pick'）还要把它抬到压暗层之上才点得动；不亮的小卡留在压暗层底下，
                    // 点它们等于点空白 = 取消。
                    target={targetRoleOf(ai, 'foe')}
                    onActivate={() =>
                      targeting === null ? handleInspect(ai) : confirmTarget(ai, 'foe')
                    }
                  />
                </div>
              ))}
            </div>

            {/*
              敌我分界的中线：一条横贯细线，中间嵌一块深蓝小匾，报第几回合、轮到谁出牌。
              顶栏的回合数也说了一遍，这里再说是因为位置本身就是信息——
              线两边就是双方的场面，匾正压在分界上，视线不用离开战场。

              线和小匾各自套了手绘滤镜（见 styles.css 的 .battle__midline），
              这是战场这几层里唯一一处建层叠上下文的地方：其余各层都守着"一处都不建"的规矩
              （见 .battle__board 上面那段注释），中线能破例是因为它只是两行场面的兄弟节点、
              不是任何飞行卡的祖先——层叠上下文只圈住它自己的线和匾，
              带 z-index 的飞行卡照样画在它上面。外层的 .battle__midline 容器本身仍然不写
              transform / z-index / isolation / filter；照抄这块时别把滤镜提到容器上去。
            */}
            <div className="battle__midline">
              <span className="battle__midline-badge">
                第 <b className="battle__midline-num">{state.round}</b> 回合
                {turnHint === null ? null : ` · ${turnHint}`}
              </span>
            </div>

            <div className="battle__row battle__row--mine" data-tutorial-anchor="battlefieldMine">
              {me.board.map((ai) => (
                <div className="battle__board-slot" key={ai.instanceId}>
                  <BoardTile
                    ai={ai}
                    shielded={me.shielded === true}
                    held={inspecting?.flipId === ai.instanceId}
                    // 我方这一行也会亮：「保送」「玉净瓶」选的正是自己的 AI，
                    // 陈丹琦的「精准检索」挑的也是自家 Agent（见 isLegalTarget）。
                    target={targetRoleOf(ai, 'mine')}
                    onActivate={() =>
                      targeting === null ? handleInspect(ai) : confirmTarget(ai, 'mine')
                    }
                  />
                </div>
              ))}
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

        {/*
          回合操作的四块：「下一题」牌匾、Token 细条、催促按钮、结束按钮。

          它们原来挤在一条羊皮纸右侧栏里，现在拆开各自贴着屏幕边悬浮在战场上方
          （牌匾右上吊着、细条贴最右缘居中、两颗按钮叠在右下角，定位全在 styles.css 里）。
          写成 .battle__layout 的绝对定位子元素而不是 fixed：基准框的上边沿正好是顶栏下沿，
          牌匾"从顶边吊下来"直接 top: 0 就行。

          教程的三个语义锚点（questionCategoryPanel / tokenCounter / endTurnButton）就落在这三块上，
          拆散之后各自成了独立元素，挖洞高亮反而比原来圈住整条侧栏更准。
        */}

        {/*
          终局后整块匾不渲染：state.round 停在最后一轮，照常画的话会一直挂着
          最后一题的类别，看着像还有一题要考。
        */}
        {finished || category === undefined ? null : <NextQuestionPlaque category={category} />}
        <TokenTrack tokens={me.tokens} max={me.tokenMax} />
        {/*
          「催一催」只在等对方出牌那段时间挂出来：别的时候要么该自己动手、要么两边都在等答题，
          催谁都不成立。整块条件渲染而不是照回合牌匾那样用 data-on 常驻：那是一块不吃指针的
          装饰，这里是颗真按钮，留在 DOM 里就还能被 Tab 走到、还会挨到全局那颗点击音。

          喊出去的这一句同时发给对面（见 driver.urge），两台电脑一起放录音、一起弹下面那个气泡。
          随机数只在这里摇一次：两端各摇各的就会一个人听「快点啊」、另一个人听「抓紧吧」。
        */}
        {waitingForFoe ? (
          <div className="battle__urge">
            <PlaqueButton onClick={() => driver.urge(pickRandomUrgeId())}>催一催</PlaqueButton>
          </div>
        ) : null}

        {/*
          喊话气泡：显示录音里念的那句话，给没开声音或没听清的人当字幕。

          位置卡在右下角一小块空地里（右缘让开 Token 细条、上边压着「催一催」，
          定位算法见 styles.css 的 .battle__urge-bubble），刻意不遮任何按钮；
          再加一层 pointer-events: none 兜底，免得它罩住底下的手牌。
          key 用 nonce：连点同一句时元素会重建，弹出动画才会重放。
        */}
        {urgeShout === null ? null : (
          <div className="battle__urge-bubble" key={urgeShout.nonce} role="status">
            {urgeShout.line.text}
          </div>
        )}
        {/* 在等别人的时候按钮换个说法：它照旧是灰的，但"结束出牌"在这时读起来像是还能点。
            三句都是四五个字，按钮宽度写死 184px 且 overflow: hidden，换文案撑不破框。 */}
        <div className="battle__end-turn">
          <PlaqueButton
            data-tutorial-anchor="endTurnButton"
            disabled={endPlayLocked}
            onClick={() => sendMine({ type: 'END_PLAY', player: mySeat })}
          >
            {waitingForFoe ? '等待对方…' : quizWait ? '答题中…' : '结束出牌'}
          </PlaqueButton>
        </div>
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
      {testMode ? null : (
        <OpponentFan
          cards={foeHandCards}
          onReveal={noopReveal}
          disabled
          getDealOrigin={foeDealOrigin}
          dealHold={dealHeld}
          onDealPendingChange={setFoeDealPending}
          onDealBusyChange={setFoeDealBusy}
        />
      )}

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
        // 这一轮的额度买不起的牌单独压暗、拖不动，免得拖到一半才被引擎回一句 Token 不够。
        // 轮到对方时这几张同样是打不起的，压暗叠在灰墨态上不冲突（两边写的属性不一样）。
        // 判据必须是实际费用而不是卡面印的数字：自己开着核电站的时候卡面写 4 点的牌只扣 3 点，
        // 按卡面判会把打得起的牌画成灰的（见下面的 myPlayCostOf）。
        tokens={me.tokens}
        playCostOf={myPlayCostOf}
        // 教程这一步只放行指定的那几张，其余的和"打不起"同一套压暗 + 摇头 + 弹提示。
        extraBlocked={tutorial?.blockedCards ?? null}
        frozen={handFrozen}
        lockReason={handLockReason}
        // 选目标态下这张牌留在扇形里抬起来亮着，整排其余的压暗（不接指针那件事归 frozen，
        // 上面那行已经把选目标态算进去了）。
        // 英雄技能那条链路没有牌在施放，整排一律照常压着，所以只有技能牌那一档给值。
        castingId={targeting?.kind === 'skill-card' ? targeting.instanceId : null}
        onDragStateChange={setDraggingId}
        // 新牌从我方卡堆飞进扇形；开局那 5 张憋到抛硬币演完、每轮的补牌憋到回合结算层
        // 退场再飞（见 dealHeld）。整段发牌期间上面那个 disabled 是锁着的（见 actionsLocked）。
        getDealOrigin={myDealOrigin}
        dealHold={dealHeld}
        onDealPendingChange={setMyDealPending}
        onDealBusyChange={setMyDealBusy}
      />

      {/*
        选目标态（点击路）的全屏压暗：战场、手牌、侧栏、顶栏一起暗下去，
        只有可选目标的小卡（抬到 76）和正在施放的那张手牌（扇形整层抬到 77）留在亮处。
        选手牌那一档（模型蒸馏）战场上一张都不亮，候选卡直接摊在这一层里面（见下面的 .battle__hand-pick）。
        点这一层的任何位置都是取消，所以它必须**吃**指针事件。
        拖拽路不铺这一层——拖着的牌在扇形里（z-index 20），压暗层会连它一起压黑。
      */}
      {targeting !== null ? (
        <div className="battle__targeting" onClick={cancelTargeting}>
          <div className="battle__targeting-hint">
            <span className="battle__targeting-text">
              {targeting.kind === 'skill-card' ? (
                <>
                  选择目标：{TARGET_HINTS[targeting.mode]}
                  {/* 括注单独包一层：卡名要么整块跟在后面，要么整块折到下一行，不能被劈开 */}
                  <span className="battle__targeting-card">
                    （{getCard(targeting.cardId).name}）
                  </span>
                </>
              ) : (
                // 英雄技能这一档不印卡名：要选的是场上的单位，而技能名已经在句首了。
                heroTargetingHintOf(targeting.heroId)
              )}
            </span>
            {/* 整层都能点着取消，这个按钮只是把"能取消"明写出来；重复调一次没有副作用。 */}
            <button type="button" className="battle__targeting-cancel" onClick={cancelTargeting}>
              取消
            </button>
          </div>
          {/*
            「模型蒸馏」专用的选手牌一排：把手上的 AI 牌摊在压暗层正中，点一张就弃它。

            刻意不去点亮扇形里的原牌：选目标态下整排手牌是冻着的（frozen，否则指针底下那张
            会一直放大挡住半个屏幕），要在扇形里点选就得在 HandFan 里另开一条交互路径，
            而这里要玩家做的判断只有"弃哪一张"，摊开成一排反而看得最清楚。
            按下即选（pointerdown，同战场小卡）：触屏上也是一下就中，不用先选中再确认。
            阻止冒泡，否则这一下会穿到压暗层身上被当成取消。
          */}
          {targeting.kind === 'skill-card' && targeting.mode === 'own-hand-ai' ? (
            <div className="battle__hand-pick" onClick={(event) => event.stopPropagation()}>
              {handTargets.map((instance) => (
                <div
                  key={instance.instanceId}
                  className="battle__hand-pick-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`弃置 ${getCard(instance.cardId).name}`}
                  onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
                    event.stopPropagation()
                    confirmHandTarget(instance)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    // 空格默认会把页面滚一屏，回车可能被外层当成提交，都不要。
                    event.preventDefault()
                    confirmHandTarget(instance)
                  }}
                >
                  <div className="battle__hand-pick-inner">
                    <HandCardFace card={handCardOfInstance(instance)} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
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
        // 英雄牌那条链路要换一档更大的倍率，理由见 .reveal-clip--hero。
        <div
          className={showcase.art === null ? 'reveal-clip' : 'reveal-clip reveal-clip--hero'}
          key={showcase.key}
          ref={revealClipRef}
        >
          <div className="reveal-card" ref={revealCardRef} data-flip-id={showcase.flipId}>
            {/* 翻面层，结构和手牌一致：两面重叠、由 flipTo 按角度切 opacity（见 ui/flipCard.ts）。
                放大查看不翻面，只用 setFlipAngle 把它定死在正面。 */}
            <div className="reveal-card__inner">
              <div className="reveal-card__face" data-flip-face="front">
                {showcase.art === null ? (
                  // 卡面布局尺寸仍是 150×225，靠这一层整体放大，字和描边才一起变大而不是被拉伸。
                  <div className="reveal-card__scale">
                    <HandCardFace card={showcase.card} />
                  </div>
                ) : (
                  // 英雄原画是一张 2:3 的整图，没有需要跟着放大的排版，直接铺满这一面就行。
                  <img
                    className="reveal-card__art"
                    src={showcase.art}
                    alt={showcase.card.name}
                    draggable={false}
                  />
                )}
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
          {/* 技能字幕。挂在裁剪层里、当展示卡的兄弟节点，不能塞进 .reveal-card：
              那一层的 transform 归 Flip 和呼吸浮动管，字幕跟着飞进来会一起被缩放和摇晃。
              收回时整个裁剪层随 showcase 卸载，字幕不用另外清理。 */}
          {showcase.caption === null ? null : (
            <p className="reveal-caption" ref={revealCaptionRef}>
              <span className="reveal-caption__text">{showcase.caption}</span>
            </p>
          )}
        </div>
      ) : null}

      {finished ? (
        <MatchResult
          variant={
            view.status === 'aborted'
              ? 'victory'
              : state.winner === 'draw'
                ? 'draw'
                : state.winner === mySeat
                  ? 'victory'
                  : 'defeat'
          }
          title={resultTitleOf(view, state, mySeat)}
          score={view.status === 'aborted' ? null : { mine: me.score, foe: foe.score }}
          actions={resultActions}
        />
      ) : null}

      {/*
        额外浮层的插槽，现在只有教程的引导层。它自己写 z-index（1000 那一档）：
        比顶栏、手牌、结算层都高，但低于下面那三个全屏过场，过场演的时候它自动让位。
        必须挂在这里而不是 MatchStage 外面，理由见 MatchStageProps.overlay。
      */}
      {overlay}

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

      {roundSettle !== null ? (
        // key 让下一轮结算拿到一套全新的 DOM：上一轮那些卡片上还会留着 GSAP 写的内联样式，
        // 复用同一批节点的话新一轮的 fromTo 要和它们打架。
        // 顺带把层内那个"我点过确认了"的本地标志也重置掉。
        <RoundSettleLayer
          key={roundSettle.key}
          settle={roundSettle}
          totalRounds={state.totalRounds}
          phase={state.phase}
          myConfirmed={state.settleConfirmed[mySeat]}
          foeConfirmed={state.settleConfirmed[foeSeat]}
          onConfirm={() => driver.send({ type: 'CONFIRM_ROUND', player: mySeat })}
          onExited={() => {
            quizUpRef.current = false
            setRoundSettle(null)
            // 结算层退场了，教程的提示这才有地方站（它在 1000，这一层在 1100）。
            stageCue('quiz-closed')
            // 结算层立着的这段时间里憋下的横幅（下一轮的宣告），到这里才放出来。
            pumpBanner()
            // 屏幕空出来了，这一轮的补牌这才从各自的卡堆飞出去（见 dealHeld）。
            releaseRoundDeal()
          }}
          onStage={(name) => {
            // 结算层的演出节点翻译成教程的舞台信号。两个名字分属两套词汇：
            // 结算层说的是自己演到哪儿（results-done / score-shown），
            // 教程说的是"哪一句话该出场了"（quiz-rows-done / quiz-score-shown）。
            // 另外两个信号不在这里：整层立起来是收到 QUESTION_REVEALED 那一刻发的，
            // 整层退场完毕在上面的 onExited 里发。
            stageCue(name === 'results-done' ? 'quiz-rows-done' : 'quiz-score-shown')
          }}
        />
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
 * 这位英雄的主动技能把目标往哪个方向换卡，没有主动技能就是 null。
 *
 * 和引擎那边是同一条判断（见 core 的 useHeroSkill）：`USE_HERO_SKILL` 指令里不带方向，
 * 升还是降、目标该在哪一行，全看发动的是谁。所以客户端也只能照英雄 id 反推。
 * 霍珀和阿达是被动（引擎自己算，没有发动这一步），其余三位还没实装
 *（见 heroes.ts 的 comingSoon），这五位一律返回 null。
 */
function heroSkillDirectionOf(heroId: HeroId | null): 'upgrade' | 'downgrade' | null {
  if (heroId === 'danqi-chen') return 'upgrade'
  if (heroId === 'melanie-perkins') return 'downgrade'
  return null
}

/**
 * 英雄技能选目标时顶部提示条上那一句。
 *
 * 句首是技能名，后半句把"点谁"说死：升级挑自己那一行、降级挑对方那一行。
 * 沿用卡面和英雄文案里的叫法「Agent」，别在这儿改口叫「AI」。
 */
function heroTargetingHintOf(heroId: HeroId): string {
  const hero = getHero(heroId)
  const what =
    heroSkillDirectionOf(heroId) === 'upgrade' ? '点击要升级的己方 Agent' : '点击要降级的对方 Agent'
  return `${hero.skillName}：${what}`
}

/**
 * 侧栏英雄牌的 Flip 配对键。
 *
 * 加个前缀是因为这套键是全场共用的：手牌、战场小卡、展示卡都挂着 data-flip-id，
 * 实例 id 形如 p1-c7，和 hero-0 撞不上。
 */
function heroFlipId(playerId: PlayerId): string {
  return `hero-${playerId}`
}

/**
 * 某一侧卡堆最上面那张牌此刻在屏幕上的位置，交给两排扇形当发牌飞行的起点。
 *
 * 侧栏还没挂上时返回 null，那时两排扇形会退回原来的"从基准位下方淡入"（见 HandFanProps）。
 * 每次要摆新牌时现查一次，不缓存：窗口一变，16:9 舞台的缩放就变，这个矩形跟着变。
 *
 * 返回的是 getBoundingClientRect 的**视口**矩形（缩放之后的屏幕像素），
 * 换算成舞台内坐标是两排扇形自己的事（各自的 dealStartVars，口径见 ui/battleStage.ts）：
 * 那两处还要照各自的坐标系翻方向，换算没法在这里一次做完。
 */
function dealOriginOf(side: DealSide): DOMRect | null {
  const node = document.querySelector<HTMLElement>(
    `.battle__deck[data-deck-side="${side}"] .battle__deck-top`,
  )
  return node === null ? null : node.getBoundingClientRect()
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

/**
 * 战场中线小匾上跟在回合数后面的那半句：现在轮到谁。
 *
 * 措辞比侧栏那行（statusTextOf）短一半：小匾夹在两行小卡中间，只有一行的高度，
 * 长句会把匾撑得比中线还显眼。
 * 对局结束或中断后返回 null，匾上只留回合数——那时候已经没有"谁出牌"这回事了。
 */
function turnHintOf(view: MatchView, state: GameState, mySeat: PlayerId): string | null {
  if (view.status !== 'playing') return null
  /*
   * 链路断着的时候，"该谁出牌"已经不是玩家最需要知道的事了。
   *
   * 这一档要排在最前面：网络断了还照常显示「对方出牌」，玩家会一直等一个永远不会到的动作，
   * 而且看不出问题出在网络上——这正是原来最让人困惑的那个现象。
   *
   * 手牌不跟着锁：轮到自己时照样能出，指令会先攒在重发队列里，链路一通就送到（见 socket.ts）。
   */
  if (view.link === 'down') return '网络不稳，正在重连…'
  if (state.phase === 'quiz') return '答题中'
  if (state.phase === 'settle') return '结算中'
  return state.activePlayer === mySeat ? '你出牌' : '对方出牌'
}

/**
 * 结算层的大标题。
 * 平局是正经结果之一，不是异常——只是现在只可能出自"题库出完了双方还同分"这一种保底情况
 *（先到 3 分那条路要求分数不相等，双方同时到分会继续加赛，见 core 的 WIN_TARGET）。
 */
function resultTitleOf(view: MatchView, state: GameState, mySeat: PlayerId): string {
  if (view.status === 'aborted') return view.abortReason ?? '对局中断'
  if (state.winner === 'draw') return '平局'
  return state.winner === mySeat ? '你赢了' : '你输了'
}

/**
 * 「下一题」牌匾的全部图形，画在 168×118 的坐标系里（就是匾体的设计尺寸）。
 *
 * 三道框线由外到内依次收紧 5px 和 9px，越靠里越细，这是「繁复」看着有层次的关键：
 * 只画一道线的话不管加多少卷草都还是一块普通的圆角牌子。
 */
const PLAQUE_OUTLINE =
  'M22 6H146C155 6 162 13 162 22V96C162 105 155 112 146 112H22C13 112 6 105 6 96V22C6 13 13 6 22 6Z'
const PLAQUE_MID =
  'M25 11H143C151 11 157 17 157 25V93C157 101 151 107 143 107H25C17 107 11 101 11 93V25C11 17 17 11 25 11Z'
const PLAQUE_INNER =
  'M28 15H140C147 15 153 21 153 28V90C153 97 147 103 140 103H28C21 103 15 97 15 90V28C15 21 21 15 28 15Z'

/** 四个角的卷草：只画左上角这一份，另外三个靠下面的镜像变换摆出来。 */
const PLAQUE_CORNER_ARC = 'M18 34C18 25 25 18 34 18'
const PLAQUE_CORNER_LEAF = 'M23 31C25 25 29 22 34 23C30 26 26 30 24 34Z'

/**
 * 把左上角那份卷草分别摆到四个角。
 *
 * 用镜像而不是旋转：旋转会让卷草的卷曲方向绕着圈走，四个角看起来像在转风车；
 * 镜像出来的是左右上下对称，才是牌匾该有的样子。
 * 第一项是不动的左上角，写成 translate(0,0) 而不是省略，是为了拿它当 React 的 key。
 */
const PLAQUE_CORNER_TRANSFORMS = [
  'translate(0,0)',
  'translate(168,0) scale(-1,1)',
  'translate(0,118) scale(1,-1)',
  'translate(168,118) scale(-1,-1)',
]

/** 上下正中骑在框线上的冠饰：一颗菱形宝石加两撇卷须。填充和描边分开画，卷须才不会被填成楔形。 */
const PLAQUE_CREST_GEM = 'M84 0L89.5 6L84 12L78.5 6Z'
const PLAQUE_CREST_WING = 'M66 6C71 1 76.5 2 78 6M102 6C97 1 91.5 2 90 6'

/** 左右两侧腰线上的小菱形铆钉，正好骑在外框线上。 */
const PLAQUE_SIDE_STUDS = 'M6 53L10 59L6 65L2 59ZM162 53L166 59L162 65L158 59Z'

/**
 * Token 那颗四芒星，和站点图标（public/favicon.svg）是同一份路径。
 * 尖端留了 1 单位宽的平口而不是收成一个点，缩小之后边缘才不会被抗锯齿抹掉。
 */
const TOKEN_STAR_PATH =
  'M49.5 4L50.5 4L57 43L96 49.5L96 50.5L57 57L50.5 96L49.5 96L43 57L4 50.5L4 49.5L43 43Z'

/**
 * Token 细条里留给星星那一列的高度预算（px）。
 *
 * 这个数是从 styles.css 的 .battle__token-rail 推出来的：细条高 470，减去上下内边距 26、
 * 落款那两行约 28、以及它和星星之间的 10，剩下约 406，取个整 400。
 * 改细条高度或落款字号要回来跟着改。
 */
const TOKEN_STACK_H = 400

/** 一颗星星的边长（px）。同 styles.css 的 .battle__token-star，两处必须一致。 */
const TOKEN_STAR_SIZE = 30

/** 星星之间最松和最紧的间距（px）。负数就是让星星互相压边——见 TokenTrack。 */
const TOKEN_GAP_MAX = 18
const TOKEN_GAP_MIN = -18

/**
 * 右上角吊着的那块「下一题」牌匾。
 *
 * 只报类别不报题面：题目全文要到答题阶段才揭晓，这里说的是"下一题考什么方向"。
 *
 * 整块匾是画出来的而不是一张切图：类别名有三个字也有五个字（见 ui/labels.ts），
 * 位图就得为每种长度各出一张，而且换一版题库分类就要重新导出。
 * 框线走 SVG 才好套手绘滤镜——直接给 div 加 border 再 filter，里面的字会跟着抖歪
 *（PlaqueButton 和回合牌匾同理，见各自的 __frame）。
 */
function NextQuestionPlaque({ category }: { category: QuestionCategory }) {
  return (
    // data-tutorial-anchor 是新手教程的语义锚点（见 tutorial/steps.ts）。
    <div className="battle__next-plaque" data-tutorial-anchor="questionCategoryPanel">
      {/* 两根挂绳，让匾看着是吊在侧栏顶上的。一个容器加两个伪元素，比两个空 span 省 DOM。 */}
      <span className="battle__next-plaque-cords" aria-hidden="true" />
      <div className="battle__next-plaque-body">
        <svg className="battle__next-plaque-art" viewBox="0 0 168 118" aria-hidden="true">
          <path className="battle__next-plaque-paper" d={PLAQUE_OUTLINE} />
          <path className="battle__next-plaque-rim" d={PLAQUE_OUTLINE} />
          <path className="battle__next-plaque-rim battle__next-plaque-rim--thin" d={PLAQUE_MID} />
          <path className="battle__next-plaque-rim battle__next-plaque-rim--hair" d={PLAQUE_INNER} />
          {/* 四个角的卷草各画一份，靠镜像变换摆位：同一段路径写四遍太长，也容易改漏其中一个。 */}
          {PLAQUE_CORNER_TRANSFORMS.map((transform) => (
            <g key={transform} className="battle__next-plaque-scroll" transform={transform}>
              <path className="battle__next-plaque-scroll-arc" d={PLAQUE_CORNER_ARC} />
              <path className="battle__next-plaque-scroll-leaf" d={PLAQUE_CORNER_LEAF} />
            </g>
          ))}
          {/* 上下中央那颗骑在框线上的菱形冠饰，同样靠镜像摆下面那颗。 */}
          {['translate(0,0)', 'translate(0,118) scale(1,-1)'].map((transform) => (
            <g key={transform} className="battle__next-plaque-crest" transform={transform}>
              <path className="battle__next-plaque-crest-gem" d={PLAQUE_CREST_GEM} />
              <path className="battle__next-plaque-crest-wing" d={PLAQUE_CREST_WING} />
            </g>
          ))}
          <path className="battle__next-plaque-stud" d={PLAQUE_SIDE_STUDS} />
        </svg>
        <span className="battle__next-plaque-eyebrow">下一题</span>
        <span className="battle__next-plaque-title">{QUESTION_CATEGORY_LABELS[category]}</span>
      </div>
    </div>
  )
}

/**
 * 剩余 Token：贴着屏幕最右缘那条细板，一颗四芒星＝一点，
 * 发着黄光的是还剩的，灰下去的是这一轮已经花掉的。
 *
 * 星星**从下往上**烧：最底下那颗是第 1 点，越往上编号越大，花钱是从顶上往下灭的，
 * 像一格格烧下去的蜡烛。数字那行照旧压在星星底下，当这一块的落款。
 *
 * **永远单列**。上限从 5 起、每轮 +1（见 core 的 INITIAL_TOKEN_MAX / TOKEN_MAX_GROWTH），
 * 点数一多就只压间距不换列：换成两列的话"从下往上烧"会断成两段，读不出还剩几点。
 * 间距在这里算好交给 CSS（--token-gap）：细条高度是写死的，CSS 自己算不出一列该留多宽。
 * 挤到极限时间距是负的，星星互相压边——这时靠每颗星星那圈深色描边分开彼此
 *（见 styles.css 的 .battle__token-star）。
 *
 * 压边也有极限：TOKEN_GAP_MIN 那一档下，一列最多排得下约 30 颗。题库现在 5 道题，
 * 就算一路同分加赛打满 5 轮，常规上限也才 9 点；顶格是选阿达·洛芙莱斯再全程 +2
 *（见 core 的 ADA_TOKEN_MAX_BONUS）的 11 点，算出来的间距还有 7px，星星根本没挨上，很宽裕。
 * 题库要是扩到十几道以上、加赛真打到那么久，得回来把星星缩小。
 */
function TokenTrack({ tokens, max }: { tokens: number; max: number }) {
  /**
   * 这一列要画几颗星。
   *
   * 平时就是本轮上限，但「模型蒸馏」换来的 Token 可以顶到上限之上（见 core 的 playCard），
   * 那时按上限画会得到一列全亮的星星加一行「13/12」，多出来的那几点在画面上没有着落。
   * 所以超出的部分照样各画一颗，只是换个颜色（见 TokenStar 的 extra）。
   * 下一轮补满时 tokens 回到 tokenMax，这一列自己就缩回去了。
   */
  const shown = Math.max(max, tokens)
  // 只有一颗星时没有间隔，除数兜到 1 免得算出 Infinity。
  const gapCount = Math.max(shown - 1, 1)
  const gap = Math.min(
    TOKEN_GAP_MAX,
    Math.max(TOKEN_GAP_MIN, (TOKEN_STACK_H - shown * TOKEN_STAR_SIZE) / gapCount),
  )
  return (
    // data-tutorial-anchor 是新手教程的语义锚点（见 tutorial/steps.ts）。
    <div className="battle__token-rail" data-tutorial-anchor="tokenCounter">
      <div
        className="battle__token-stack"
        style={{ '--token-gap': `${gap.toFixed(2)}px` } as CSSProperties}
      >
        {Array.from({ length: shown }, (_, index) => {
          // index 是从上往下的行号，Token 却是从下往上数的，翻一下：
          // 最上面那颗编号最大，也就是最先被花掉的那点。
          const point = shown - 1 - index
          return <TokenStar key={point} spent={point >= tokens} extra={point >= max} />
        })}
      </div>
      <span className="battle__token-count">
        <span className="battle__token-count-value">
          {tokens}/{max}
        </span>
        <span className="battle__token-count-unit">token</span>
      </span>
    </div>
  )
}

/**
 * 一颗 Token。图形就是站点图标那颗四芒星（public/favicon.svg），只按状态换色。
 * 整排星星都不进无障碍树：底下那行「7/12 token」已经把同一件事说全了。
 *
 * extra = 这一点超出了本轮上限（只可能来自「模型蒸馏」）：换一档冷色，
 * 让"这几点是白捡的、下一轮就没了"和上限之内的额度区分开。
 */
function TokenStar({ spent, extra }: { spent: boolean; extra: boolean }) {
  return (
    <svg
      className="battle__token-star"
      data-spent={spent ? 'true' : undefined}
      data-extra={extra ? 'true' : undefined}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <path d={TOKEN_STAR_PATH} />
    </svg>
  )
}

/**
 * 侧栏里的一块玩家面板：一张占满整块的英雄牌，卡堆压在卡面一角
 *（我方在右下、对方在右上，上下镜像，见 styles.css 的 .battle__deck），
 * 我方那张卡的左下角另有一颗发动主动技能的按钮。
 *
 * 面板上只有这几样东西。得分和手牌张数不画：比分顶栏正中已经有一份，手牌张数看两排扇形就够。
 * 玩家名也不画：上下两块本来就是"上面是对方、下面是我"的固定分工，
 * 再压一条名字在原画上只会挡住脸。谁是谁由中间那条分界线和位置说清楚。
 */
function PlayerPanel({
  player,
  side,
  deckCount,
  heroHeld,
  onInspectHero,
  skill,
}: {
  player: PlayerState
  /** 这块面板是谁的。卡堆靠它被发牌动画找到（见 BattleField 的 dealOriginOf）。 */
  side: DealSide
  /** 卡堆上要显示的张数，含还压在堆上没起飞的新牌（见 BattleField 的 dealPending）。 */
  deckCount: number
  /** 这张英雄牌此刻正被放大查看，原位要让出来（同战场小卡的 held）。 */
  heroHeld: boolean
  onInspectHero: (player: PlayerState) => void
  /** 发动主动技能那颗按钮；只有我方那块面板给得出，见 HeroSkillButton。 */
  skill: HeroSkillButton | null
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useHeroCardScale(panelRef)
  const hero = player.hero === null ? null : getHero(player.hero)
  const art = hero === null ? null : heroArtSrc(hero.id)
  return (
    <div className="battle__player-panel" data-player={player.id} ref={panelRef}>
      <div className={heroHeld ? 'battle__hero battle__hero--held' : 'battle__hero'}>
        {hero === null ? null : (
          <>
            <div
              className={
                player.heroSkillUsed
                  ? 'battle__hero-card battle__hero-card--used'
                  : 'battle__hero-card'
              }
              // 放大查看是一次跨容器的 FLIP，父组件靠这个 id 把侧栏这张和展示卡对上号。
              data-flip-id={heroFlipId(player.id)}
              role="button"
              tabIndex={0}
              aria-label={`查看英雄 ${hero.name}`}
              // 原画卡上没有技能文字，鼠标停一下能看全文；
              // 点开放大则是把同一张原画飞到中央，技能写在卡下方的字幕里（见 handleInspectHero）。
              title={`${hero.name}（${hero.enName}）｜${hero.skillName}：${hero.skillText}`}
              // 走 pointerdown 而不是 click，理由同战场小卡：按下就该有反应。
              onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
                event.stopPropagation()
                onInspectHero(player)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                // 空格在这个位置的默认行为是把页面往下滚一屏，回车也可能被外层当成提交，都不要。
                event.preventDefault()
                onInspectHero(player)
              }}
            >
              {/* 有原画就直接铺整张图（名字和英文名已经画在图里）；
                  没配图的英雄退回通用的文字卡面，至少还看得出是谁、技能是什么。 */}
              {art === null ? (
                <HandCardFace card={heroCardData(hero)} />
              ) : (
                <img className="battle__hero-art" src={art} alt="" draggable={false} />
              )}
            </div>
            {/* 技能用掉之后卡面压灰，再加这枚角标点明原因——只压灰的话会被当成"这张卡没启用"。
                英雄技能一局只发动一次，玩家得能一眼看出还能不能指望上它。
                两位主动英雄同样吃这一档：技能一发完 heroSkillUsed 就为真，下面那颗按钮跟着撤走。 */}
            {player.heroSkillUsed ? <span className="battle__hero-used">技能已用</span> : null}
            {/* 发动主动技能。压在卡面左下角，按下就进选目标态。
                这张卡的四个角各有主人，谁都别挤谁：左上「技能已用」、右上「金钟罩」、
                右下卡堆、左下这颗按钮。
                它是卡面盒子的**兄弟**节点，不是子节点，所以点它不会冒泡到卡面那次放大查看；
                stopPropagation 是给日后挪位置的人留的一道保险——这颗按钮一旦被塞进卡面里，
                少了这一行就会变成"点技能顺带把卡放大"。pointerdown 也要拦：卡面认的是它，不是 click。 */}
            {skill === null ? null : (
              <button
                type="button"
                className="battle__hero-skill"
                disabled={skill.disabled}
                title={`发动英雄技能：${skill.label}`}
                onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) =>
                  event.stopPropagation()
                }
                onClick={(event) => {
                  event.stopPropagation()
                  skill.onActivate()
                }}
              >
                {skill.label}
              </button>
            )}
          </>
        )}
        {/*
          「金钟罩」挂在这一方的面板上而不是某张小卡上：它罩的是整个人（这一方和他场上所有 AI），
          场上一个 AI 都没有时也照样生效，挂在小卡上就没地方可挂了。
          位置在英雄牌右上角，避开左下那颗发动技能的按钮——自己带着陈丹琦/珀金斯又打了金钟罩时，
          两者会同时出现（英雄技能不是技能牌，罩子挡不住它，见 core 的 useHeroSkill）。
          进下一轮自动清掉（见 core 的 confirmRound），所以不用管它什么时候消失。
        */}
        {player.shielded === true ? <span className="battle__shield-mark">金钟罩</span> : null}
        <DeckPile side={side} count={deckCount} />
      </div>
    </div>
  )
}

/**
 * 把面板量出来的大小换算成英雄牌的缩放系数，写成 CSS 变量 --hero-card-scale。
 *
 * 卡面排版是照 150×225 写死的，所以这里和战场小卡一个路子：外面那个盒子按换算后的尺寸占位，
 * 里面那张卡整体 scale，字和插画跟着一起变，而不是另画一套卡面。
 *（换成原画之后卡面里其实只有一张图，缩放这条路仍然留着——没配图的英雄还要退回文字卡面。）
 *
 * 取宽高两边能容下的较小值，也就是"2:3 塞满这块面板"。不给卡堆留位：卡堆现在整个压在
 * 卡面里面（见 styles.css 的 .battle__deck），不再往外探出去顶雕花框。
 *
 * 系数直接写在 DOM 节点的 style 上、不走 React state：走 state 的话每量一次都要重渲染
 * 整个对局界面。这个变量只喂给 CSS 的宽高和 scale，而 GSAP 从头到尾不碰这几个元素的
 * transform，两边不会抢同一个属性。CSS 那边给了默认值，所以第一帧量出来之前也不会画成 0。
 *
 * 对局界面现在锁在 16:9 舞台里（见 styles.css 的"对局界面的 16:9 舞台"），面板尺寸恒定，
 * 这一段实际上只会在挂载时算一次。仍然留着 ResizeObserver 而不是写死一个数：
 * 量出来的口径不依赖"侧栏多宽、内边距多少"，改版式时这里不用跟着手工对表。
 * clientWidth / clientHeight 量的是**布局**尺寸，祖先身上那个 transform: scale() 不影响它，
 * 拿到的已经是舞台内像素，和 CARD_WIDTH / CARD_HEIGHT 同一套口径，不需要再过 battleStage 换算。
 */
function useHeroCardScale(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const apply = () => {
      // 面板自己的大小由左侧栏那张 1fr / 1fr 的网格定死，和里面这张卡画多大无关，
      // 所以改这个变量不会反过来改面板尺寸，ResizeObserver 不会陷进循环。
      const scale = Math.min(node.clientWidth / CARD_WIDTH, node.clientHeight / CARD_HEIGHT)
      node.style.setProperty('--hero-card-scale', String(Math.max(scale, 0)))
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
}

/**
 * 卡堆：几张错位叠着的牌背，剩余张数用一个大数字压在最上面那张的正中间。
 *
 * 最上面那张不是装饰，它同时是发牌飞行的起点：两排扇形靠 data-deck-side 找到这块，
 * 量它的位置当新牌的起飞点（见 BattleField 的 dealOriginOf）。所以它必须是一个真实尺寸的盒子。
 * 它是素面的（样式全在 .battle__deck-top），刻意不用对手手牌那张带纹章的隐藏牌背
 *（CardBackHidden）：那套花纹和压在上面的大数字抢眼，读数要费一下劲。
 *
 * 数字放中间而不是做成角上的小徽章：卡堆整个压在英雄牌上，边上没地方挂徽章，
 * 而"还剩几张"是对局里要一眼扫到的数（字号和配色见 .battle__deck-count）。
 * 张数为 0 时变红：牌堆空了之后每轮补牌都会白抽一次（引擎里 drawCards 直接返回），
 * 这件事画面上没有别的地方说得出来。
 */
function DeckPile({ side, count }: { side: DealSide; count: number }) {
  return (
    <div className="battle__deck" data-deck-side={side} aria-label={`牌堆剩余 ${count} 张`}>
      {/* 底下两张只画出"这摞有厚度"，位置和圆角全在 CSS 里，不带任何牌面信息。 */}
      <span className="battle__deck-stack battle__deck-stack--far" aria-hidden="true" />
      <span className="battle__deck-stack battle__deck-stack--near" aria-hidden="true" />
      <div className="battle__deck-top" aria-hidden="true" />
      <span
        className={
          count === 0 ? 'battle__deck-count battle__deck-count--empty' : 'battle__deck-count'
        }
      >
        {count}
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
 * - `'drag'` 玩家正拖着一张要选目标的技能牌，这张卡是合法目标：只亮一圈呼吸的橙色描边。
 *   **不能抬层级**：拖着的那张牌在扇形里（z-index 20），抬上去会盖在它前面。
 * - `'pick'` 点击路的选目标态：同一圈描边，外加抬到全屏压暗层之上，这样它才亮着、也点得动。
 * 这时点击的含义变了，所以回调叫 onActivate 而不是 onInspect——
 * 由父组件按当前状态决定这一下是放大查看还是选中目标。
 */
function BoardTile({
  ai,
  shielded,
  held,
  target,
  onActivate,
}: {
  ai: AiInstance
  /** 这个单位的主人本轮打过金钟罩。它罩的是整个人，只能从外面传进来（见 tileMarksOf）。 */
  shielded: boolean
  held: boolean
  target: 'none' | 'drag' | 'pick'
  onActivate: () => void
}) {
  const card = handCardOfAi(ai)
  const marks = tileMarksOf(ai, shielded)
  const targetable = target !== 'none'
  const classes = ['battle__tile']
  if (held) classes.push('battle__tile--held')
  if (targetable) classes.push('battle__tile--targetable')
  if (target === 'pick') classes.push('battle__tile--target-lift')
  return (
    <div
      className={classes.join(' ')}
      // data-ai-id 全场唯一，事件层靠它定位这个单位（对方上场的简易进场、
      // 主动英雄技能换卡时那一下命中特效都靠它）。
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
      {/* 常驻角标，全部跟着快照里的状态走而不是靠动画残留：本轮打在这个单位身上的每一张技能牌
          都占一枚，它们既是记号，也解释了这张卡为什么不能再被某些技能选中；
          「已升级 / 已降级」则说明这张卡为什么和打出去时不是同一张脸。
          好几枚可能同时挂在一张卡上（被干扰的单位照样能被保送、被升降级），所以由容器排成一列。
          具体挂哪几枚见 ui/tileMarks.ts 的 tileMarksOf。 */}
      {marks.length === 0 ? null : (
        <div className="battle__tile-marks">
          {marks.map((mark) => (
            <span key={mark.text} className={mark.className}>
              {mark.text}
            </span>
          ))}
        </div>
      )}
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
  tokens,
  onPlay,
}: {
  hand: readonly CardInstance[]
  /** 对方这一轮还剩多少 Token。买不起的牌压暗，免得点了半天只收到一句"Token 不够"。 */
  tokens: number
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
          // 只是压暗，不拦点击：测试房本来就是拿来试各种被拒场景的。
          data-unplayable={foeCardBlocked(instance, tokens) ? 'true' : undefined}
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

/**
 * 测试房里那张对方手牌现在打不打得出去（判据和 HandFan 的 blocked 一致）。
 * 只用来压暗，点击照旧放行——测试房本来就要能试出被拒的场景。
 */
function foeCardBlocked(instance: CardInstance, tokens: number): boolean {
  return getCard(instance.cardId).tokenCost > tokens
}

/** 从手牌实例拼出卡面数据。id 用实例 id：Flip 和事件定位都靠它对号。 */
function handCardOfInstance(instance: CardInstance): HandCardData {
  return { ...handCardOfDefinition(instance.cardId), id: instance.instanceId }
}

/** 从卡牌定义拼出卡面数据。id 只是给 React 当 key 用，不参与 Flip。 */
function handCardOfDefinition(cardId: CardId): HandCardData {
  const card = getCard(cardId)
  // backText 走 ui/cardText.ts 那一份：牌组页也显示同一段话，拼法只留一处。
  const base = {
    id: card.id,
    definitionId: card.id,
    name: card.name,
    text: card.text,
    backText: cardBackText(card),
    tokenCost: card.tokenCost,
  }
  if (card.kind === 'ai') {
    return {
      ...base,
      kind: 'ai',
      model: card.model,
      skillName: card.skillName,
      skillText: card.skillText,
    }
  }
  return { ...base, kind: 'skill' }
}

/**
 * 从场上的 AI 单位拼出卡面数据。
 *
 * **必须读实例当前的 cardId**，不能拿它上场时那张卡：主动英雄技能会当场把单位换成同系列的
 * 另一代（见 core 的 useHeroSkill），卡名、原画、费用全跟着新卡走，
 * 读定义的话战场小卡会一直停在换卡前那张脸上。
 * 单位上除此之外还没有别的会变的数值（interference / safePassed / levelShift 只画角标），
 * 哪天加了"上场后被增益/削弱"的属性，那几项也要照这个路子从实例上取。
 * backText 照常留着：战场小卡自己不翻面，但它被放大查看、或者对手打出时飞到屏幕中央，
 * 用的都是同一份数据，而展示卡是有背面的。
 */
function handCardOfAi(ai: AiInstance): HandCardData {
  return { ...handCardOfDefinition(ai.cardId), id: ai.instanceId }
}
