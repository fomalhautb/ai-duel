/**
 * 教学对战的步骤表：一张纯数据的状态清单，照规格 §17 排。
 *
 * 教程本身是一台状态机，**不依赖任何屏幕坐标**：每一步只说"高亮哪个语义元素、
 * 现在允许玩家做什么、等哪个信号就往下走"。UI 改版时只要那几个语义锚点还在，
 * 这张表一行都不用动（锚点清单见 TutorialAnchorName）。
 *
 * 推进这张表的是 TutorialController，它把三种输入喂进来：
 * 引擎事件（旁路自 tutorialDriver）、舞台演出信号（MatchStage 的 onStageCue）、玩家点击。
 * 纯讲解的那几步一律等玩家点一下才走，不自己跳——玩家读一句话的快慢差得很远，
 * 定时推进只会有人没读完就被翻页、有人读完了干等着。
 * 所有判定都写成下面那几个纯函数，测试可以直接断言。
 */

import type { CardId, GameEvent, PlayerId } from '@ai-duel/core'
import type { MatchStageCue } from '../ui/matchStageTutorial'
import { TUTORIAL_CARDS } from './content'

/**
 * 步骤 id。前 17 个照规格 §17 的清单，另外几个是把规格里"一步说两句话"的地方拆开
 * ——每一步只解释一个概念（§2.1），而且每一句提示都要单独等一个演出信号才敢出场。
 * 组牌 / 选英雄 / 完成页是下一个任务，这里到 TUTORIAL_VICTORY 为止。
 */
export type TutorialStepId =
  | 'TUTORIAL_INITIAL_DRAW'
  | 'TUTORIAL_R1_KEYWORD'
  | 'TUTORIAL_R1_PLAY_AI'
  /** 拆自 Step 03 的第二句：AI 牌会留场。 */
  | 'TUTORIAL_R1_STAY'
  | 'TUTORIAL_R1_END_PLAY'
  | 'TUTORIAL_R1_REVEAL'
  /** 拆出来的过渡态：放行对手脚本，等它出完牌进答题。 */
  | 'TUTORIAL_R1_FOE_PLAY'
  | 'TUTORIAL_R1_ANSWER'
  | 'TUTORIAL_R1_SCORE'
  | 'TUTORIAL_R2_REFRESH'
  /** 拆自 Step 09：Token 恢复与上限成长单独说一句。 */
  | 'TUTORIAL_R2_TOKEN'
  | 'TUTORIAL_R2_DRAW'
  /** 拆出来的过渡态：本轮对手先手，放行它派出新 AI，玩家的干扰技能才有目标。 */
  | 'TUTORIAL_R2_FOE_PLAY'
  | 'TUTORIAL_R2_SKILL'
  /** 拆自 Step 12 的收尾：技能命中之后那句「立即生效」。 */
  | 'TUTORIAL_R2_SKILL_HIT'
  | 'TUTORIAL_R2_PLAY'
  | 'TUTORIAL_R2_REVEAL'
  | 'TUTORIAL_R2_SCORE'
  /** 「同结果就比 Token」那条规则：教学局排不出一个自然的平局，所以只讲不演（见 §8）。 */
  | 'TUTORIAL_R2_TOKEN_RULE'
  | 'TUTORIAL_R3_FREE_PLAY'
  | 'TUTORIAL_R3_REVEAL'
  | 'TUTORIAL_R3_SCORE'
  | 'TUTORIAL_VICTORY'

/**
 * 教程认得的语义锚点，对应界面上打了 `data-tutorial-anchor` 的那几个元素。
 * 名字照规格 §17 给的清单取，UI 重构时只要把属性挂到新元素上即可。
 */
export type TutorialAnchorName =
  | 'endTurnButton'
  | 'tokenCounter'
  | 'keywordPanel'
  | 'scoreBoard'
  | 'hand'
  | 'battlefieldMine'
  | 'battlefieldFoe'

/**
 * 一个高亮目标。手牌那一档按**卡牌定义 id**写，控制器再从局面里把它换算成实例 id
 * ——实例 id 取决于发牌顺序，写进步骤表太脆。
 */
export type TutorialHighlight =
  | { kind: 'anchor'; name: TutorialAnchorName }
  | { kind: 'card'; cardId: CardId }

/** 事件信号：`by` 不填就是不分敌我。 */
export interface TutorialEventSignal {
  type: GameEvent['type']
  by?: 'me' | 'foe'
}

/**
 * 一个"什么时候算数"的信号。
 *
 * `delay` 只用在 readyOn 上，从进入这一步那一刻起算——它等的是一段没有收尾信号的演出。
 * 推进（advance）一律不用 delay：讲解步骤等 `tap`（玩家点一下），其余等对局流程或演出信号。
 */
export type TutorialSignal =
  | { kind: 'cue'; cue: MatchStageCue }
  | { kind: 'event'; event: TutorialEventSignal }
  | { kind: 'delay'; ms: number }
  | { kind: 'tap' }

/**
 * 能当推进条件用的信号：把 `delay` 排除在外，从类型上钉死"讲解步骤不会自己跳"。
 * 想加一步纯讲解就写 `advance: tap()`。
 */
export type TutorialAdvanceSignal = Exclude<TutorialSignal, { kind: 'delay' }>

/** 这一步玩家能做什么（规格 §15）。 */
export interface TutorialAllowance {
  /** 只有这些卡牌定义 id 的手牌打得出去；null = 不限制（第 3 轮放手）。 */
  playableCards: CardId[] | null
  /** 被锁住的那些手牌点上去弹哪句话。锁必须有话说，否则玩家只会觉得界面坏了。 */
  blockTip: string
  /** 「结束出牌」按钮能不能点。 */
  endPlay: boolean
}

export interface TutorialStep {
  id: TutorialStepId
  /**
   * 这些信号全部到齐，这一步的提示才出场（不填 = 进入即出场）。
   *
   * 存在的理由只有一个：提示在 z-index 1000，全屏过场在 1100，过场演着的时候
   * 提示是看不见的。所以凡是紧接在一段过场后面的提示，都要等那段过场的收尾信号。
   */
  readyOn?: TutorialSignal[]
  /** 一句话提示。null = 这一步不出提示（纯粹在等一段演出走完的过渡态）。 */
  instruction: string | null
  /** 要挖洞高亮的元素。空 / 不填 = 只压暗不挖洞。 */
  highlight?: TutorialHighlight[]
  /** 压暗无关区域，默认 true。第 3 轮的弱引导不压暗（规格 §9）。 */
  dim?: boolean
  /** 玩家能做什么。不填 = 什么都不许做（过渡态，界面本来多半也锁着）。 */
  allow?: TutorialAllowance
  /**
   * 放行对手脚本。默认挡着——对手的出牌演出是全屏过场，
   * 不挡的话第 2 轮它会在教程还没讲完的时候直接盖上来（见 tutorialDriver.setFoeHold）。
   */
  releaseFoe?: boolean
  /** 规格 §9 的弱引导：玩家长时间没动作才轻微高亮这几处，不压暗也不弹规则。 */
  idleHint?: { afterMs: number; highlight: TutorialHighlight[] }
  /** 满足它就进入 next。next 为 null 的终点步不填。 */
  advance?: TutorialAdvanceSignal
  next: TutorialStepId | null
}

/** 过渡态里手牌一律锁着时点上去弹的话。 */
const CUTSCENE_TIP = '教学演出还没走完，先看这一段'

const cue = (name: MatchStageCue): TutorialAdvanceSignal => ({ kind: 'cue', cue: name })
const delay = (ms: number): TutorialSignal => ({ kind: 'delay', ms })
/** 等玩家点一下屏幕或「下一步」按钮。纯讲解的步骤全用它。 */
const tap = (): TutorialAdvanceSignal => ({ kind: 'tap' })
const onEvent = (type: GameEvent['type'], by?: 'me' | 'foe'): TutorialAdvanceSignal => ({
  kind: 'event',
  event: by === undefined ? { type } : { type, by },
})
const anchor = (name: TutorialAnchorName): TutorialHighlight => ({ kind: 'anchor', name })
const card = (cardId: CardId): TutorialHighlight => ({ kind: 'card', cardId })

/**
 * 步骤表本体。顺序就是流程顺序，`next` 写成显式字段而不是"下一条"，
 * 是为了将来插分支（比如加赛）时不用重排数组。
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  // ---------- 阶段一：开局抽牌（规格 §4） ----------
  {
    id: 'TUTORIAL_INITIAL_DRAW',
    // 等发牌落地 + 开场那两条横幅播完：抛硬币和横幅都盖在提示上面。
    readyOn: [cue('deal-done'), cue('round-banner-done')],
    instruction: '这是你的手牌。你的牌组共 20 张，开局抽 5 张。',
    highlight: [anchor('hand')],
    advance: tap(),
    next: 'TUTORIAL_R1_KEYWORD',
  },

  // ---------- 第 1 轮：最基本的出牌循环（规格 §5） ----------
  {
    id: 'TUTORIAL_R1_KEYWORD',
    instruction: '正式题目还没揭晓。先根据关键词判断该派谁上场。',
    highlight: [anchor('keywordPanel')],
    advance: tap(),
    next: 'TUTORIAL_R1_PLAY_AI',
  },
  {
    id: 'TUTORIAL_R1_PLAY_AI',
    instruction: '这次先派它——打出 AI 牌会消耗 Token。',
    highlight: [card(TUTORIAL_CARDS.firstAi), anchor('tokenCounter')],
    allow: {
      playableCards: [TUTORIAL_CARDS.firstAi],
      blockTip: '教学第 1 轮：先打出高亮的那张 AI 牌',
      endPlay: false,
    },
    advance: onEvent('AI_DEPLOYED', 'me'),
    next: 'TUTORIAL_R1_STAY',
  },
  {
    id: 'TUTORIAL_R1_STAY',
    // 等上场那段飞行和落地特效演完再说话，否则提示会压在正在冒烟的那张小卡上。
    readyOn: [delay(1600)],
    instruction: 'AI 牌上场后会留在场上，直到它答错题目。',
    highlight: [anchor('battlefieldMine')],
    advance: tap(),
    next: 'TUTORIAL_R1_END_PLAY',
  },
  {
    id: 'TUTORIAL_R1_END_PLAY',
    instruction: '准备好了，结束出牌。',
    highlight: [anchor('endTurnButton')],
    allow: {
      playableCards: [],
      blockTip: '这一轮的牌已经出完了，点「结束出牌」继续',
      endPlay: true,
    },
    advance: onEvent('PLAY_TURN_STARTED', 'foe'),
    next: 'TUTORIAL_R1_REVEAL',
  },
  {
    id: 'TUTORIAL_R1_REVEAL',
    // 这句话趁对手还没动手时说：对手的出牌演出也是全屏过场，一上来提示就看不见了。
    instruction: '双方都结束出牌后，完整题目才会揭晓。',
    highlight: [anchor('battlefieldFoe')],
    advance: tap(),
    next: 'TUTORIAL_R1_FOE_PLAY',
  },
  {
    id: 'TUTORIAL_R1_FOE_PLAY',
    instruction: null,
    releaseFoe: true,
    advance: cue('quiz-open'),
    next: 'TUTORIAL_R1_ANSWER',
  },
  {
    id: 'TUTORIAL_R1_ANSWER',
    instruction: null,
    advance: cue('quiz-rows-done'),
    next: 'TUTORIAL_R1_SCORE',
  },
  {
    id: 'TUTORIAL_R1_SCORE',
    // 比分先在揭晓层里亮一次，等那层退场、下一轮的横幅也播完，再指着顶栏说一遍为什么。
    readyOn: [cue('quiz-score-shown'), cue('round-banner-done')],
    instruction: '只有你答对，这一分属于你。',
    highlight: [anchor('scoreBoard')],
    advance: tap(),
    next: 'TUTORIAL_R2_REFRESH',
  },

  // ---------- 第 2 轮：留场、Token 成长、抽牌（规格 §6） ----------
  {
    id: 'TUTORIAL_R2_REFRESH',
    instruction: '上一轮答对的 AI 还在场上，它会自动参加这一轮，不需要重新付 Token。',
    highlight: [anchor('battlefieldMine')],
    advance: tap(),
    next: 'TUTORIAL_R2_TOKEN',
  },
  {
    id: 'TUTORIAL_R2_TOKEN',
    instruction: '每轮结束后 Token 会恢复，并且下一轮上限 +1。',
    highlight: [anchor('tokenCounter')],
    advance: tap(),
    next: 'TUTORIAL_R2_DRAW',
  },
  {
    id: 'TUTORIAL_R2_DRAW',
    instruction: '从第 2 轮开始，每轮抽 2 张牌。',
    highlight: [anchor('hand')],
    advance: tap(),
    next: 'TUTORIAL_R2_FOE_PLAY',
  },

  // ---------- 第 2 轮：技能牌真的会改结果（规格 §7 / §8） ----------
  {
    id: 'TUTORIAL_R2_FOE_PLAY',
    // 本轮对手先手：先让它派出新 AI，玩家的干扰技能才有目标（规格 §7）。
    instruction: null,
    releaseFoe: true,
    advance: onEvent('PLAY_TURN_STARTED', 'me'),
    next: 'TUTORIAL_R2_SKILL',
  },
  {
    id: 'TUTORIAL_R2_SKILL',
    instruction: '除了派 AI，你还可以使用技能干扰对手——这次就用这张。',
    highlight: [card(TUTORIAL_CARDS.skill), anchor('battlefieldFoe')],
    allow: {
      playableCards: [TUTORIAL_CARDS.skill],
      blockTip: '先用高亮的技能牌干扰对手刚上场的 AI',
      endPlay: false,
    },
    advance: onEvent('SKILL_PLAYED', 'me'),
    next: 'TUTORIAL_R2_SKILL_HIT',
  },
  {
    id: 'TUTORIAL_R2_SKILL_HIT',
    readyOn: [cue('skill-hit')],
    // 这句只说"生效了"，不剧透它会答成什么样：那一下留到揭晓时自己演，
    // 玩家看见对手张口就是「香蕉」，比先讲一遍再看一遍有力得多。
    instruction: '技能牌使用后立即生效，它这一轮已经被干扰了。',
    highlight: [anchor('battlefieldFoe')],
    advance: tap(),
    next: 'TUTORIAL_R2_PLAY',
  },
  {
    id: 'TUTORIAL_R2_PLAY',
    // 这一轮不放行任何增派的 AI（optionalAi 是空的），所以这一步只剩"结束出牌"一个动作。
    // 不是付不起：打完 4 费的复读机还剩 2 点，卡池里最便宜的 AI 正好 2 费。
    // 是这一课要教的是"技能真的会改结果"，同一步里再塞一个可选动作会把注意力引开
    //（原委见 TUTORIAL_CARDS.optionalAi）。
    // optionalAi 将来填回牌时，这里的文案和 highlight 要一起改回"你也可以再派一张"。
    instruction: '场上的 AI 会继续作答，这一轮不用再派新的。',
    highlight: [...TUTORIAL_CARDS.optionalAi.map(card), anchor('endTurnButton')],
    allow: {
      playableCards: [...TUTORIAL_CARDS.optionalAi],
      blockTip: '这一轮的牌已经打完了，直接结束出牌',
      endPlay: true,
    },
    advance: cue('quiz-open'),
    next: 'TUTORIAL_R2_REVEAL',
  },
  {
    id: 'TUTORIAL_R2_REVEAL',
    instruction: null,
    advance: cue('quiz-score-shown'),
    next: 'TUTORIAL_R2_SCORE',
  },
  {
    id: 'TUTORIAL_R2_SCORE',
    readyOn: [cue('round-banner-done')],
    instruction: '被干扰的 AI 只会回答「香蕉」，它答错了——这一分又是你的。',
    highlight: [anchor('scoreBoard')],
    advance: tap(),
    next: 'TUTORIAL_R2_TOKEN_RULE',
  },
  {
    id: 'TUTORIAL_R2_TOKEN_RULE',
    // 「同结果就比 Token」这条规则只讲不演：三轮都是"只有一方答对"，教学局排不出一个
    // 自然的平局，硬凑一轮会把第 3 轮那个放手轮改得别扭（玩家花多少 Token 是不可控的）。
    // 讲的时机挑在这里，是因为玩家刚看完一轮完整结算，脑子里还装着"这一分凭什么给谁"。
    // 真遇上平局时结算层自己会把判定理由和双方消耗写出来（见 RoundSettleLayer 的 verdict）。
    instruction: '要是双方都答对、或者都答错，就比这一轮消耗的 Token，少的一方得分。',
    highlight: [anchor('tokenCounter')],
    advance: tap(),
    next: 'TUTORIAL_R3_FREE_PLAY',
  },

  // ---------- 第 3 轮：放手（规格 §9） ----------
  {
    id: 'TUTORIAL_R3_FREE_PLAY',
    readyOn: [cue('deal-done'), cue('round-banner-done')],
    instruction: '现在由你决定这一轮怎么出牌。',
    // 不压暗、不指哪张牌：这一轮要验证玩家自己能走完一整轮（规格 §9）。
    dim: false,
    allow: { playableCards: null, blockTip: '', endPlay: true },
    releaseFoe: true,
    idleHint: { afterMs: 12000, highlight: [anchor('hand'), anchor('endTurnButton')] },
    advance: cue('quiz-open'),
    next: 'TUTORIAL_R3_REVEAL',
  },
  {
    id: 'TUTORIAL_R3_REVEAL',
    instruction: null,
    advance: cue('quiz-score-shown'),
    next: 'TUTORIAL_R3_SCORE',
  },
  {
    id: 'TUTORIAL_R3_SCORE',
    // 终局的结算面板（z-index 90）会在揭晓层退场后自己盖上来，这里不再多说一句。
    instruction: null,
    advance: cue('quiz-closed'),
    next: 'TUTORIAL_VICTORY',
  },
  {
    id: 'TUTORIAL_VICTORY',
    instruction: null,
    next: null,
  },
]

/** 步骤表的第一步。 */
export const TUTORIAL_FIRST_STEP: TutorialStepId = 'TUTORIAL_INITIAL_DRAW'

const STEP_BY_ID = new Map(TUTORIAL_STEPS.map((step) => [step.id, step]))

/** 按 id 取一步。取不到说明步骤表里的 next 写错了，直接抛错。 */
export function tutorialStep(id: TutorialStepId): TutorialStep {
  const step = STEP_BY_ID.get(id)
  if (step === undefined) throw new Error(`步骤表里没有这一步：${id}`)
  return step
}

/** 过渡态的默认限制：什么都不许做。 */
export const CUTSCENE_ALLOWANCE: TutorialAllowance = {
  playableCards: [],
  blockTip: CUTSCENE_TIP,
  endPlay: false,
}

/** 这一步允许玩家做什么。没写 allow 的过渡态一律锁死。 */
export function allowanceOf(step: TutorialStep): TutorialAllowance {
  return step.allow ?? CUTSCENE_ALLOWANCE
}

/**
 * 一条事件符不符合信号里写的条件。
 *
 * `by` 要拿本端座位换算：步骤表只说"我方 / 对方"，不写座位号——
 * 教程虽然固定坐 0 号，但这条判定没必要跟着那个约定走。
 */
export function eventMatches(
  signal: TutorialEventSignal,
  event: GameEvent,
  playerSeat: PlayerId,
): boolean {
  if (event.type !== signal.type) return false
  if (signal.by === undefined) return true
  if (!('player' in event)) return false
  const mine = event.player === playerSeat
  return signal.by === 'me' ? mine : !mine
}

/** 判定一个信号要用到的全部上下文，全是"到目前为止发生了什么"。 */
export interface TutorialSignalContext {
  /**
   * 本轮已经出现过的舞台信号。
   *
   * 之所以要记而不是只认"刚到的那一条"：好几步是在信号已经过去之后才被切进来的
   * （比如第 3 轮的补牌和横幅早就演完了，教程还在念第 2 轮的结算），
   * 认不出"已经发生过"就会卡在那儿等一条永远不会再来的信号。
   * 每轮 `ROUND_STARTED` 清空一次，跨轮的同名信号才不会互相顶替。
   */
  seenCues: ReadonlySet<MatchStageCue>
  /** 进入这一步之后过了多久（毫秒）。只有 readyOn 里的 delay 会看它。 */
  elapsedMs: number
  /** 这一批新到的引擎事件。 */
  events: readonly GameEvent[]
  /**
   * 这批输入里有没有一次玩家点击（点屏幕或点「下一步」）。
   *
   * 一次点击只算数一次：推完一步 tap 就把它划掉再往下判，
   * 否则连着几步纯讲解会被同一下点击一口气翻完（见 pumpTutorial）。
   */
  tapped: boolean
  playerSeat: PlayerId
}

/** 一个信号现在成立没有。四种信号各查各的来源，互不相干。 */
export function signalSatisfied(
  signal: TutorialSignal,
  context: TutorialSignalContext,
): boolean {
  switch (signal.kind) {
    case 'cue':
      return context.seenCues.has(signal.cue)
    case 'delay':
      return context.elapsedMs >= signal.ms
    case 'tap':
      return context.tapped
    case 'event':
      return context.events.some((event) =>
        eventMatches(signal.event, event, context.playerSeat),
      )
  }
}

/** 这一步走得动的话，往哪走、这一下点击是不是被它吃掉了。 */
interface TutorialAdvanceResult {
  next: TutorialStepId
  /** 这一步是被点击推走的，那这一下点击就用完了（见 pumpTutorial）。 */
  tapConsumed: boolean
}

/** 当前这一步现在能不能往下走。走不动（含终点步）返回 null。 */
function tryAdvance(
  step: TutorialStep,
  context: TutorialSignalContext,
): TutorialAdvanceResult | null {
  const advance = step.advance
  if (advance === undefined || step.next === null) return null
  if (!signalSatisfied(advance, context)) return null
  return { next: step.next, tapConsumed: advance.kind === 'tap' }
}

/**
 * 状态机跑到哪了。控制器把它存在 ref 里，推进本身是下面那个纯函数。
 * 拆成"纯状态 + 纯函数"是为了让整条推进逻辑不用渲染 React 就能测。
 */
export interface TutorialMachineState {
  stepId: TutorialStepId
  /** 这一步的 readyOn 都到齐了，提示已经出场。 */
  ready: boolean
  /** 还差哪几个 readyOn 没到。拷贝出来的，不会动到步骤表里那个数组。 */
  pendingReady: readonly TutorialSignal[]
}

/** 刚进入某一步时的状态：readyOn 原样抄一份当待办清单。 */
export function enterTutorialStep(stepId: TutorialStepId): TutorialMachineState {
  return { stepId, ready: false, pendingReady: [...(tutorialStep(stepId).readyOn ?? [])] }
}

/**
 * 把一批输入喂给状态机，能推几步推几步。
 *
 * 循环是必要的：一批事件（或一条信号）可能同时满足"这一步就绪"和"这一步走完"，
 * 甚至连着满足下一步的就绪条件。上限取步骤表长度，防着数据写错时空转。
 *
 * 两条不显然的规矩：
 *
 * - **一次点击只推一步**。推走一步 tap 之后就把这一下点击划掉，后面的步骤看到的是
 *   "没人点"。纯讲解的步骤有连着三步的（R2_REFRESH→R2_TOKEN→R2_DRAW），
 *   而且它们 readyOn 为空、进入即就绪，不划掉的话一下点击会把三句话一口气翻完。
 * - **没就绪就不看推进条件**。提示还没出场（多半在等一段全屏过场）时玩家点的那一下不算数。
 */
export function pumpTutorial(
  state: TutorialMachineState,
  context: TutorialSignalContext,
): TutorialMachineState {
  let current = state
  let tapped = context.tapped
  // 每往前进一步就是"刚进来"，计时归零：readyOn 的 delay 说的是进入这一步之后等多久。
  let elapsedMs = context.elapsedMs
  for (let guard = 0; guard < TUTORIAL_STEPS.length; guard += 1) {
    const now: TutorialSignalContext = { ...context, tapped, elapsedMs }
    if (!current.ready) {
      const pendingReady = current.pendingReady.filter(
        (signal) => !signalSatisfied(signal, now),
      )
      current = { ...current, pendingReady, ready: pendingReady.length === 0 }
    }
    if (!current.ready) return current

    const move = tryAdvance(tutorialStep(current.stepId), now)
    if (move === null) return current
    if (move.tapConsumed) tapped = false
    elapsedMs = 0
    current = enterTutorialStep(move.next)
  }
  return current
}
