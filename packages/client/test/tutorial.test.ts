/**
 * 把三关教程整段跑一遍，确认剧本和引擎对得上。
 *
 * 教程是写死的剧本：引导文案里写着"伤害 = 2 + 2 = 4，一击就碎"这种实数，
 * 而这些数字依赖卡牌的费用、伤害和弱点画像。卡池一改，剧本会**静默**失效——
 * 界面上表现为某一步点不动，玩家直接卡死在教程里。这个测试就是守着这件事的。
 *
 * 测试模拟的是玩家按引导点击的过程，判断条件和 MatchStage 里那套一致：
 * 手牌里得有这张卡、算力够、指定的目标在场上。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCard, other } from '@ai-duel/core'
import type { GameState, InstanceId, PlayerId } from '@ai-duel/core'
import { createTutorialDriver } from '../src/match/tutorialDriver'
import { TUTORIAL_LEVELS } from '../src/tutorial/levels'
import type { ScriptTarget, TutorialLevel } from '../src/tutorial/levels'

/**
 * 对手每个动作间隔 700ms 且是一个接一个排的定时器。
 * 给足余量一次推完整个回合，省得测试里去数它排了几步。
 */
const OPPONENT_TURN_MS = 10_000

describe('教程关卡', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  for (const level of TUTORIAL_LEVELS) {
    it(`${level.title}：引导每一步都走得通`, () => {
      const { finalState, seat, rejections } = playThrough(level)
      expect(rejections).toEqual([])
      expect(finalState.players[seat]).toBeDefined()
    })
  }

  it('第二关最后一击真的能秒掉刻板鹦鹉', () => {
    const level = TUTORIAL_LEVELS[1]!
    const { finalState, seat } = playThrough(level)
    // 引导文案承诺"伤害 = 卡面 2 + 误判暴露 2 = 4，它只有 3 点完整度，一击就碎"。
    expect(finalState.players[other(seat)].board).toHaveLength(0)
  })

  it('第三关打完最后一步就分出胜负，赢的是玩家', () => {
    const level = TUTORIAL_LEVELS[2]!
    const { finalState, seat } = playThrough(level)
    expect(finalState.phase).toBe('finished')
    expect(finalState.winner).toBe(seat)
  })
})

interface PlayThroughResult {
  finalState: GameState
  seat: PlayerId
  rejections: string[]
}

/** 照着引导一步步打完一关，返回最终局面和期间所有被拒的指令。 */
function playThrough(level: TutorialLevel): PlayThroughResult {
  const driver = createTutorialDriver(level)
  const rejections: string[] = []
  driver.subscribeEvents((events) => {
    for (const event of events) {
      if (event.type === 'COMMAND_REJECTED') rejections.push(event.reason)
    }
  })

  try {
    for (const [index, step] of level.steps.entries()) {
      const where = `${level.title} 第 ${index + 1} 步`
      const seat = driver.getSnapshot().seat

      // 轮到对手时界面是锁住的，这里等它把脚本跑完再继续。
      if (currentState(driver, where).activePlayer !== seat) {
        vi.advanceTimersByTime(OPPONENT_TURN_MS)
      }
      const state = currentState(driver, where)
      expect(state.activePlayer, `${where}：还没轮到玩家`).toBe(seat)

      if (step.action.kind === 'continue') continue

      if (step.action.kind === 'end-turn') {
        driver.send({ type: 'END_TURN', player: seat })
      } else {
        const { cardId, target } = step.action
        const instance = state.players[seat].hand.find((c) => c.cardId === cardId)
        expect(instance, `${where}：手牌里没有「${getCard(cardId).name}」`).toBeDefined()
        expect(getCard(cardId).cost, `${where}：算力不够出「${getCard(cardId).name}」`)
          .toBeLessThanOrEqual(state.players[seat].compute)

        driver.send({
          type: 'PLAY_CARD',
          player: seat,
          instanceId: instance!.instanceId,
          targetInstanceId: resolveTarget(state, seat, target, where),
        })
      }
      expect(driver.getSnapshot().lastRejection, `${where}：指令被引擎拒绝`).toBeNull()
    }

    const seat = driver.getSnapshot().seat
    return { finalState: currentState(driver, level.title), seat, rejections }
  } finally {
    driver.dispose()
  }
}

function currentState(driver: ReturnType<typeof createTutorialDriver>, where: string): GameState {
  const { state } = driver.getSnapshot()
  if (!state) throw new Error(`${where}：本地 driver 不该出现没有局面的情况`)
  return state
}

function resolveTarget(
  state: GameState,
  seat: PlayerId,
  target: ScriptTarget | undefined,
  where: string,
): InstanceId | undefined {
  if (!target || target.kind === 'face') return undefined
  const victim = state.players[other(seat)].board.find((m) => m.cardId === target.cardId)
  expect(victim, `${where}：对面场上没有「${getCard(target.cardId).name}」可打`).toBeDefined()
  return victim!.instanceId
}
