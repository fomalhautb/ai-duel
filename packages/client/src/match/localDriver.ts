/**
 * 本地 driver：规则就在这台机器上跑，没有网络。
 *
 * 给"一台电脑上双方轮流操作"的热座对局用的，也是调试规则最快的入口。
 */

import { createGame, execute } from '@ai-duel/core'
import type { Command, GameSetup, PlayerId } from '@ai-duel/core'
import { createDriverCore, rejectionOf, statusOf } from './driver'
import type { MatchDriver } from './driver'
import { createQuizAutopilot } from './quizAutopilot'
import type { QuizAnswersFor } from './quizAutopilot'

export interface LocalDriverOptions {
  setup: GameSetup
  /**
   * 本端座位。'active' 表示视角跟着行动方走，也就是热座——
   * 轮到谁，界面就把谁画成"我方"。
   */
  seat: PlayerId | 'active'
  /**
   * 答题结果从哪来，不填就是 core 查预生成的真实模型回答（见 quizAutopilot 的 answersFor）。
   * 教学对战靠它把每一轮的对错写死。
   */
  answersFor?: QuizAnswersFor
  /**
   * 进答题后隔多久自动提交结果（毫秒），不填就是 QUIZ_AUTOPILOT_DELAY_MS。
   * 测试传 0，免得为了一轮结算真等两秒半。
   */
  quizDelayMs?: number
}

export function createLocalDriver({
  setup,
  seat,
  answersFor,
  quizDelayMs,
}: LocalDriverOptions): MatchDriver {
  const opening = createGame(setup)
  const seatOf = (activePlayer: PlayerId): PlayerId => (seat === 'active' ? activePlayer : seat)

  const core = createDriverCore({
    state: opening.state,
    seat: seatOf(opening.state.activePlayer),
    status: statusOf(opening.state),
    lastRejection: null,
    abortReason: null,
  })
  // 开局事件（发牌、第一个回合开始）也要广播，动画层才知道要发牌。
  core.emitEvents(opening.events)

  let disposed = false

  function apply(command: Command): void {
    if (disposed) return
    const { state } = core.getSnapshot()
    if (!state) return
    const result = execute(state, command)
    core.patch({
      state: result.state,
      seat: seatOf(result.state.activePlayer),
      status: statusOf(result.state),
      lastRejection: rejectionOf(result.events),
    })
    core.emitEvents(result.events)
    // 本地跑引擎的这一端负责生成答题结果，所以要接自动驾驶（联机客人那端不接）。
    autopilot.observe(result.state)
  }

  const autopilot = createQuizAutopilot({
    getState: () => core.getSnapshot().state,
    apply,
    // 两项都可能不传，autopilot 那边各自有默认值；这里不写成条件展开是因为
    // exactOptionalPropertyTypes 没开，undefined 会被默认参数正常兜住。
    answersFor,
    delayMs: quizDelayMs,
  })
  // 开局局面也过一遍：createGame 出来必定是出牌阶段，这里只是把"上一次的阶段"记上。
  autopilot.observe(opening.state)

  return {
    subscribe: core.subscribe,
    getSnapshot: core.getSnapshot,
    subscribeEvents: core.subscribeEvents,
    send: apply,
    subscribeUrge: core.subscribeUrge,

    // 热座是一台电脑上两个人轮流点，"对面"就在旁边坐着，本地放一遍就够了。
    urge: core.emitUrge,

    dispose() {
      disposed = true
      // 没有连接要断，但答题自动驾驶的定时器必须清掉，
      // 否则界面卸载之后它还会往一局已经没人看的对局里发指令。
      autopilot.dispose()
    },
  }
}
