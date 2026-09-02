/**
 * 教学对战的 driver：规则跑真引擎，对手完全按脚本出牌。
 *
 * 它只是 `localDriver` 外面的一层壳，多做三件事：
 *
 * 1. 把 `GameSetup` 焊死（不洗牌、指定先手、教学牌组、教学题、教学英雄），于是整局是一段
 *    可复现的剧本。答题结果不另开一份：和正式对局一样查 core 那张真实模型回答表，
 *    剧本靠"题和牌都是照那张表挑的"成立（见 tutorial/content.ts）；
 * 2. 轮到对手就照 `TUTORIAL_FOE_PLAYS` 逐条出牌，出完自动「结束出牌」；教程也能在
 *    最后一张牌落场后临时挡住这一步，等玩家看完提示再继续；
 *    每轮结算停在 settle 等双方确认，对手那一下也由这层代点（见 pumpFoeConfirm）；
 * 3. 给教程控制器开一条**事件旁路**（`onEvents`）。
 *
 * 玩家自己那下确认不在这里：它是结算层上真的一次点击（RoundSettleLayer 的按钮），
 * 正好合上教程「讲解步骤要玩家点一下才推进」的规矩，不需要也不该由 driver 代劳。
 *
 * 旁路必须单开一条：UI 那条 `subscribeEvents` 全局只允许一个订阅者（见 driver.ts），
 * 那个位置是 MatchStage 的，教程再挤进去就会把动画层顶掉。所以这层自己订走 localDriver
 * 的事件，再扇出给两边——两条都各自带缓冲，谁先挂上都不会漏掉开局那批事件。
 */

import { createLocalDriver } from './localDriver'
import { createDriverCore } from './driver'
import type { MatchDriver } from './driver'
import type { Command, GameEvent } from '@ai-duel/core'
import {
  TUTORIAL_FOE_DECK,
  TUTORIAL_FOE_HERO,
  TUTORIAL_FOE_PLAYS,
  TUTORIAL_FOE_SEAT,
  TUTORIAL_PLAYER_DECK,
  TUTORIAL_PLAYER_HERO,
  TUTORIAL_PLAYER_SEAT,
  TUTORIAL_QUESTIONS,
} from '../tutorial/content'

/** 对手每一步（出一张牌、结束出牌）之间停多久，玩家才看得清它做了什么。 */
export const TUTORIAL_FOE_STEP_MS = 700

export interface TutorialDriverOptions {
  /** 对手脚本每一步之间的间隔（毫秒）。测试传 0。 */
  stepDelayMs?: number
  /** 进答题后隔多久自动提交结果（毫秒）。测试传 0。 */
  quizDelayMs?: number
}

export interface TutorialDriver extends MatchDriver {
  /**
   * 事件旁路，专给教程控制器用：每批事件在扇出给 UI 的同一个同步块里也送这里一份。
   * 和 `subscribeEvents` 各订各的，互不影响。同样只允许一个监听者，没人听时攒着。
   */
  onEvents(listener: (events: GameEvent[]) => void): () => void
  /**
   * 挡住对手脚本。
   *
   * 教程要先把这一轮的提示讲完（「上一轮的 AI 还在场上」「Token 涨了」「每轮抽 2 张」）
   * 才轮到对手动手；第一轮也用同一道闸，在对手最后一张牌落场后停住，等玩家确认再结束出牌。
   * 否则对手的出牌或答题演出（全屏 1100）会盖住引导提示。
   * 默认不挡，由教程控制器按步骤表逐步开关。
   */
  setFoeHold(hold: boolean): void
}

export function createTutorialDriver(options: TutorialDriverOptions = {}): TutorialDriver {
  const stepDelayMs = options.stepDelayMs ?? TUTORIAL_FOE_STEP_MS

  const inner = createLocalDriver({
    seat: TUTORIAL_PLAYER_SEAT,
    quizDelayMs: options.quizDelayMs,
    setup: {
      // 先手和牌序都指定了、题目也直接给，随机在这局里一次都不发生，种子只是占位。
      seed: 1,
      players: [
        { name: '你', deck: [...TUTORIAL_PLAYER_DECK], hero: TUTORIAL_PLAYER_HERO },
        { name: '教学对手', deck: [...TUTORIAL_FOE_DECK], hero: TUTORIAL_FOE_HERO },
      ],
      questions: TUTORIAL_QUESTIONS,
      firstPlayer: TUTORIAL_PLAYER_SEAT,
      noShuffle: true,
    },
  })

  // 只借它的事件扇出和缓冲，快照仍旧直接透传 inner 的（这层不改局面）。
  const fanout = createDriverCore(inner.getSnapshot())
  let bypassListener: ((events: GameEvent[]) => void) | null = null
  let bypassBuffer: GameEvent[] = []

  const unsubscribeInnerEvents = inner.subscribeEvents((events) => {
    // 先喂教程：控制器要在界面重渲染之前就把步骤推到位，两边的 setState 反正会被合批。
    if (bypassListener !== null) bypassListener(events)
    else bypassBuffer = [...bypassBuffer, ...events]
    fanout.emitEvents(events)
  })

  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 结算确认单独一个句柄，见 pumpFoeConfirm。 */
  let confirmTimer: ReturnType<typeof setTimeout> | null = null
  let foeHold = false
  /** 对手这一轮的脚本正在跑，防止同一轮被重复触发。 */
  let foeBusy = false
  /** 对手这一轮打到第几张了，跨轮要清零（靠下面的 scriptedRound 认出换轮了）。 */
  let playIndex = 0
  let scriptedRound = 0

  function schedule(fn: () => void): void {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!disposed) fn()
    }, stepDelayMs)
  }

  /** 对手现在该动手吗：没被挡住、没在跑、局面确实轮到它出牌。 */
  function foeShouldAct(): boolean {
    if (disposed || foeHold) return false
    const { state } = inner.getSnapshot()
    if (state === null) return false
    return state.phase === 'play' && state.activePlayer === TUTORIAL_FOE_SEAT
  }

  /**
   * 跑对手脚本的一步：还有牌就打一张再排下一步，打完就结束出牌。
   *
   * 每一步都重新读一遍最新局面：这中间隔着一个定时器，教程可能已经把对手挡下了，
   * 也可能因为别的原因（对局结束）不该再动手。
   */
  function runFoeStep(): void {
    if (!foeShouldAct()) {
      foeBusy = false
      return
    }
    const { state } = inner.getSnapshot()
    if (state === null) {
      foeBusy = false
      return
    }
    if (state.round !== scriptedRound) {
      scriptedRound = state.round
      playIndex = 0
    }
    const plays = TUTORIAL_FOE_PLAYS[state.round - 1] ?? []
    const cardId = plays[playIndex]
    if (cardId === undefined) {
      inner.send({ type: 'END_PLAY', player: TUTORIAL_FOE_SEAT })
      foeBusy = false
      return
    }
    playIndex += 1
    // 按 cardId 在手牌里找实例：instanceId 取决于发牌顺序，写进脚本太脆。
    // 找不到说明牌组和脚本对不上（数据错误），跳过这一手继续走——
    // 表现是"对手少出一张牌"，总比整局卡死强。
    const instance = state.players[TUTORIAL_FOE_SEAT].hand.find((item) => item.cardId === cardId)
    if (instance !== undefined) {
      inner.send({ type: 'PLAY_CARD', player: TUTORIAL_FOE_SEAT, instanceId: instance.instanceId })
    }
    schedule(runFoeStep)
  }

  /** 局面变了就看一眼对手该不该动手。重复调用是安全的（foeBusy 挡着）。 */
  function pumpFoe(): void {
    if (foeBusy || !foeShouldAct()) return
    foeBusy = true
    schedule(runFoeStep)
  }

  /**
   * 结算阶段替脚本对手点一下「进入下一轮」。
   *
   * 每轮结算要**双方**都确认才推进（见 core 的 confirmRound）。教学局的"对方"不是活人，
   * 这一下没人替它点，玩家点完自己那下之后就会一直卡在结算层上等一个永远不来的确认。
   *
   * 它刻意**不受 setFoeHold 管**：那道闸挡的是对手的出牌演出盖住引导提示，
   * 而结算层本身就是全屏过场、盖着整个战场，把确认挡在外面只会把教程卡死。
   *
   * 用自己的定时器而不是共用 schedule：那一个是出牌脚本的，两边抢同一个句柄会互相取消。
   * 发之前再查一次局面：这中间隔着一个定时器，玩家可能已经点完确认把轮次推走了，
   * 那时再发一条会被引擎当成"这一轮你已经确认过了"拒掉，界面上就是一句莫名其妙的报错。
   */
  function pumpFoeConfirm(): void {
    if (disposed || confirmTimer !== null || !foeShouldConfirm()) return
    confirmTimer = setTimeout(() => {
      confirmTimer = null
      if (disposed || !foeShouldConfirm()) return
      inner.send({ type: 'CONFIRM_ROUND', player: TUTORIAL_FOE_SEAT })
    }, stepDelayMs)
  }

  /** 现在轮得到对手确认吗：局面停在结算阶段，且它自己还没确认过。 */
  function foeShouldConfirm(): boolean {
    const { state } = inner.getSnapshot()
    if (state === null) return false
    return state.phase === 'settle' && !state.settleConfirmed[TUTORIAL_FOE_SEAT]
  }

  const unsubscribeInner = inner.subscribe(() => {
    fanout.patch(inner.getSnapshot())
    pumpFoe()
    pumpFoeConfirm()
  })
  // 构造时 localDriver 不发 patch，所以开局这一次要自己喊：
  // 第 1 轮是玩家先手，正常情况下这一下什么都不会做，只是不留特例。
  pumpFoe()

  return {
    subscribe: fanout.subscribe,
    getSnapshot: fanout.getSnapshot,
    subscribeEvents: fanout.subscribeEvents,
    // 喊话这条不用扇出两份（教程控制器不听喊话），直接透传 inner 的即可。
    subscribeUrge: inner.subscribeUrge,
    urge: inner.urge,

    onEvents(listener) {
      bypassListener = listener
      if (bypassBuffer.length > 0) {
        const pending = bypassBuffer
        bypassBuffer = []
        listener(pending)
      }
      return () => {
        if (bypassListener === listener) bypassListener = null
      }
    },

    setFoeHold(hold) {
      if (foeHold === hold) return
      foeHold = hold
      // 放开的那一刻可能已经轮到对手了（教程讲完提示才放行就是这种情况）。
      if (!hold) pumpFoe()
    },

    send(command: Command) {
      if (disposed) return
      inner.send(command)
    },

    dispose() {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      if (confirmTimer !== null) clearTimeout(confirmTimer)
      confirmTimer = null
      bypassListener = null
      unsubscribeInner()
      unsubscribeInnerEvents()
      inner.dispose()
    },
  }
}
