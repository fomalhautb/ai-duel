/**
 * 教程 driver：规则在本地跑，对手完全按关卡脚本出牌。
 *
 * 对手这边写死，玩家那边由界面锁死（MatchStage 的 restriction 只放行引导指定的那一个动作），
 * 两头都定死，整局就是一段可预测的剧本，引导文案里的数字才敢写实数。
 */

import { createGame, execute, other } from '@ai-duel/core'
import type { Command, GameState, InstanceId, PlayerId } from '@ai-duel/core'
import { createDriverCore, rejectionOf, statusOf } from './driver'
import type { MatchDriver } from './driver'
import type { ScriptedPlay, TutorialLevel } from '../tutorial/levels'

/** 对手每个动作之间停一下，玩家才看得清它做了什么。 */
const OPPONENT_STEP_MS = 700

export function createTutorialDriver(level: TutorialLevel): MatchDriver {
  const playerSeat = level.playerSeat
  const opponentSeat = other(playerSeat)

  // 引擎固定 0 号座位先手，所以"谁先手"是靠关卡把玩家排在 0 号还是 1 号决定的。
  const opening = createGame({
    seed: level.seed,
    players: seatOrder(playerSeat, {
      player: {
        name: '你',
        deck: [...level.playerDeck],
        integrity: level.playerIntegrity,
      },
      opponent: {
        name: '教学对手',
        deck: [...level.opponentDeck],
        integrity: level.opponentIntegrity,
      },
    }),
  })

  const core = createDriverCore({
    state: opening.state,
    seat: playerSeat,
    status: statusOf(opening.state),
    lastRejection: null,
    abortReason: null,
  })
  core.emitEvents(opening.events)

  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 对手轮到第几次了，用来取 level.opponentTurns 里对应的那一回合。 */
  let opponentTurnIndex = 0
  /** 对手的脚本正在跑，避免同一个回合被重复触发。 */
  let opponentBusy = false

  function schedule(fn: () => void): void {
    timer = setTimeout(() => {
      timer = null
      if (!disposed) fn()
    }, OPPONENT_STEP_MS)
  }

  function apply(command: Command): void {
    const { state } = core.getSnapshot()
    if (!state) return
    const result = execute(state, command)
    core.patch({
      state: result.state,
      status: statusOf(result.state),
      lastRejection: rejectionOf(result.events),
    })
    core.emitEvents(result.events)
  }

  /**
   * 把脚本里的一次出牌翻译成引擎指令。
   *
   * 手牌和目标都是按 cardId 找的，不是按 instanceId——instanceId 取决于发牌顺序，
   * 写进脚本太脆。找不到就返回 null 跳过这一手：卡池改了脚本会失效，
   * 但失效表现是"对手少出一张牌"，而不是整关卡死。
   */
  function buildCommand(state: GameState, play: ScriptedPlay): Command | null {
    const instance = state.players[opponentSeat].hand.find((c) => c.cardId === play.cardId)
    if (!instance) return null

    let targetInstanceId: InstanceId | undefined
    const target = play.target
    if (target?.kind === 'model') {
      const victim = state.players[playerSeat].board.find((m) => m.cardId === target.cardId)
      if (!victim) return null
      targetInstanceId = victim.instanceId
    }
    return {
      type: 'PLAY_CARD',
      player: opponentSeat,
      instanceId: instance.instanceId,
      targetInstanceId,
    }
  }

  function runPlays(plays: readonly ScriptedPlay[], index: number): void {
    if (index >= plays.length) {
      schedule(() => {
        const { state } = core.getSnapshot()
        // 对局已经在这个回合里结束了就别再结束回合，否则引擎会回一条"对局已结束"。
        if (state && state.phase === 'playing') apply({ type: 'END_TURN', player: opponentSeat })
        opponentBusy = false
      })
      return
    }
    schedule(() => {
      const { state } = core.getSnapshot()
      if (state && state.phase === 'playing') {
        const command = buildCommand(state, plays[index]!)
        if (command) apply(command)
      }
      runPlays(plays, index + 1)
    })
  }

  /** 轮到对手就开始跑它这一回合的脚本；脚本用完之后它只会结束回合。 */
  function maybeTakeOpponentTurn(): void {
    if (disposed || opponentBusy) return
    const { state } = core.getSnapshot()
    if (!state || state.phase !== 'playing') return
    if (state.activePlayer !== opponentSeat) return

    opponentBusy = true
    const plays = level.opponentTurns[opponentTurnIndex] ?? []
    opponentTurnIndex += 1
    runPlays(plays, 0)
  }

  // 关卡可能是对手先手（第 2 关就是），这时候一创建就得让它先动。
  maybeTakeOpponentTurn()

  return {
    subscribe: core.subscribe,
    getSnapshot: core.getSnapshot,
    subscribeEvents: core.subscribeEvents,

    send(command: Command) {
      if (disposed) return
      apply(command)
      maybeTakeOpponentTurn()
    },

    dispose() {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}

/** 按座位号把"玩家/对手"摆进引擎要的 [0 号, 1 号] 数组里。 */
function seatOrder<T>(playerSeat: PlayerId, sides: { player: T; opponent: T }): [T, T] {
  return playerSeat === 0 ? [sides.player, sides.opponent] : [sides.opponent, sides.player]
}
