/**
 * 本地 driver：规则就在这台机器上跑，没有网络。
 *
 * 教程用的是它的兄弟 tutorialDriver（多一个脚本对手）；
 * 这个是给"一台电脑上双方轮流操作"的热座对局用的，也是调试规则最快的入口。
 */

import { createGame, execute } from '@ai-duel/core'
import type { Command, GameSetup, PlayerId } from '@ai-duel/core'
import { createDriverCore, rejectionOf, statusOf } from './driver'
import type { MatchDriver } from './driver'

export interface LocalDriverOptions {
  setup: GameSetup
  /**
   * 本端座位。'active' 表示视角跟着行动方走，也就是热座——
   * 轮到谁，界面就把谁画成"我方"。
   */
  seat: PlayerId | 'active'
}

export function createLocalDriver({ setup, seat }: LocalDriverOptions): MatchDriver {
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

  return {
    subscribe: core.subscribe,
    getSnapshot: core.getSnapshot,
    subscribeEvents: core.subscribeEvents,

    send(command: Command) {
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
    },

    dispose() {
      // 纯本地，没有连接和定时器要清。
    },
  }
}
