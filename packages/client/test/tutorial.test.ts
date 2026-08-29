/**
 * 教学对战的剧本对账。
 *
 * 这里只测 driver 那一层（引擎 + 对手脚本 + 预设答案），不碰 UI：
 * 教程"可预测"这件事全靠这三样，把它们钉住，引导层就只剩排版问题。
 * 两个延迟（对手每一步、答题自动提交）都注入成 0，再配假定时器，整份测试是同步跑完的。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INITIAL_TOKEN_MAX, TOKEN_MAX_GROWTH, getCard } from '@ai-duel/core'
import type { CardId, GameEvent, GameState, InstanceId } from '@ai-duel/core'
import { createTutorialDriver } from '../src/match/tutorialDriver'
import type { TutorialDriver } from '../src/match/tutorialDriver'
import {
  TUTORIAL_CARDS,
  TUTORIAL_FOE_DECK,
  TUTORIAL_FOE_OPENING_HAND,
  TUTORIAL_FOE_PLAYS,
  TUTORIAL_PLAYER_DECK,
  TUTORIAL_PLAYER_OPENING_HAND,
  tutorialCardCost,
} from '../src/tutorial/content'
import { signalSatisfied } from '../src/tutorial/steps'

const PLAYER = 0
const FOE = 1

/** 一局教学对战，外加一份按顺序攒下来的事件流。 */
interface TutorialRun {
  driver: TutorialDriver
  events: GameEvent[]
}

function start(): TutorialRun {
  const driver = createTutorialDriver({ stepDelayMs: 0, quizDelayMs: 0 })
  const events: GameEvent[] = []
  // 事件旁路就是教程控制器用的那条，顺手也让测试盯着同一份事件流。
  driver.onEvents((batch) => events.push(...batch))
  return { driver, events }
}

/**
 * 把所有到点的定时器跑完，直到一个都不剩。
 *
 * 对手脚本和答题自动提交是一条互相触发的链（出牌 → 结束出牌 → 答题 → 下一轮 → 再出牌），
 * 一次 runOnlyPendingTimers 只推得动一环，所以要循环。上限纯粹是防死循环。
 */
function flush(): void {
  for (let guard = 0; guard < 100 && vi.getTimerCount() > 0; guard += 1) {
    vi.runOnlyPendingTimers()
  }
}

function stateOf(driver: TutorialDriver): GameState {
  const { state } = driver.getSnapshot()
  if (state === null) throw new Error('教学局没有局面')
  return state
}

function handInstance(driver: TutorialDriver, cardId: CardId): InstanceId {
  const instance = stateOf(driver).players[PLAYER].hand.find((item) => item.cardId === cardId)
  if (instance === undefined) throw new Error(`手牌里没有 ${cardId}`)
  return instance.instanceId
}

function play(driver: TutorialDriver, cardId: CardId, targetInstanceId?: InstanceId): void {
  driver.send({
    type: 'PLAY_CARD',
    player: PLAYER,
    instanceId: handInstance(driver, cardId),
    ...(targetInstanceId === undefined ? {} : { targetInstanceId }),
  })
}

function endPlay(driver: TutorialDriver): void {
  driver.send({ type: 'END_PLAY', player: PLAYER })
}

/** 对手场上唯一那个 AI（教学脚本保证每轮至多一个）。 */
function foeAiId(driver: TutorialDriver): InstanceId {
  const ai = stateOf(driver).players[FOE].board[0]
  if (ai === undefined) throw new Error('对手场上没有 AI')
  return ai.instanceId
}

function scoredEvents(events: readonly GameEvent[]) {
  return events.filter((event) => event.type === 'ROUND_SCORED')
}

/**
 * 走完第 1 轮（玩家打指定 AI → 结束出牌 → 对手 minimax → 答题结算），
 * 停在第 2 轮玩家可以出牌的那一刻（对手已经派出 deepseek-v4 并结束了出牌）。
 */
function playThroughRoundOne(run: TutorialRun): void {
  flush()
  play(run.driver, TUTORIAL_CARDS.firstAi)
  endPlay(run.driver)
  flush()
}

describe('教学对战剧本', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('主线：三轮都归玩家，3:0 拿下', () => {
    const run = start()
    playThroughRoundOne(run)

    // 第 2 轮由对手先手，它已经把 deepseek-v4 派上场了，玩家的干扰技能才有目标。
    expect(stateOf(run.driver).round).toBe(2)
    expect(stateOf(run.driver).players[FOE].board.map((ai) => ai.cardId)).toEqual(['deepseek-v4'])
    play(run.driver, TUTORIAL_CARDS.skill, foeAiId(run.driver))
    play(run.driver, 'doubao')
    endPlay(run.driver)
    flush()

    // 第 3 轮回到玩家先手，随便派一张都不影响结果。
    expect(stateOf(run.driver).round).toBe(3)
    play(run.driver, 'gemini')
    endPlay(run.driver)
    flush()

    const scored = scoredEvents(run.events)
    expect(scored.map((event) => event.verdict)).toEqual([
      'sole-correct',
      'fewer-tokens',
      'sole-correct',
    ])
    expect(scored.map((event) => event.scores)).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ])
    expect(run.events.filter((event) => event.type === 'GAME_OVER')).toEqual([
      { type: 'GAME_OVER', winner: PLAYER },
    ])
  })

  it('第 2 轮只打技能、不增派：仍然靠 Token 更省拿下这一分', () => {
    const run = start()
    playThroughRoundOne(run)
    play(run.driver, TUTORIAL_CARDS.skill, foeAiId(run.driver))
    endPlay(run.driver)
    flush()

    const round2 = scoredEvents(run.events)[1]
    expect(round2?.verdict).toBe('fewer-tokens')
    // 只花了技能牌那 2 点，对手 5 点。
    expect(round2?.spent).toEqual([tutorialCardCost(TUTORIAL_CARDS.skill), 5])
    expect(round2?.scores).toEqual([2, 0])
  })

  it('第 2 轮增派 GPT-2：消耗 3 点，这一分照样是玩家的', () => {
    const run = start()
    playThroughRoundOne(run)
    play(run.driver, TUTORIAL_CARDS.skill, foeAiId(run.driver))
    play(run.driver, 'gpt-2')
    endPlay(run.driver)
    flush()

    const round2 = scoredEvents(run.events)[1]
    expect(round2?.verdict).toBe('fewer-tokens')
    expect(round2?.spent).toEqual([3, 5])
    expect(round2?.scores).toEqual([2, 0])
  })

  it('第 3 轮什么都不打直接结束：场上的老 AI 照样答对，3:0 收场', () => {
    const run = start()
    playThroughRoundOne(run)
    play(run.driver, TUTORIAL_CARDS.skill, foeAiId(run.driver))
    endPlay(run.driver)
    flush()

    expect(stateOf(run.driver).round).toBe(3)
    endPlay(run.driver)
    flush()

    const scored = scoredEvents(run.events)
    expect(scored[2]?.verdict).toBe('sole-correct')
    expect(scored[2]?.scores).toEqual([3, 0])
    expect(stateOf(run.driver).winner).toBe(PLAYER)
  })
})

describe('教学内容自检', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('双方牌组各 20 张，每张卡至多两份', () => {
    for (const deck of [TUTORIAL_PLAYER_DECK, TUTORIAL_FOE_DECK]) {
      expect(deck).toHaveLength(20)
      const counts = new Map<CardId, number>()
      for (const cardId of deck) counts.set(cardId, (counts.get(cardId) ?? 0) + 1)
      for (const [cardId, count] of counts) {
        expect(count, `${cardId} 放了 ${count} 份`).toBeLessThanOrEqual(2)
      }
    }
  })

  it('起手 5 张正好是教学点名要用的那几张', () => {
    const run = start()
    flush()
    const state = stateOf(run.driver)
    expect(state.players[PLAYER].hand.map((item) => item.cardId)).toEqual(
      TUTORIAL_PLAYER_OPENING_HAND,
    )
    expect(state.players[FOE].hand.map((item) => item.cardId)).toEqual(TUTORIAL_FOE_OPENING_HAND)
    // 教程点名的四张牌一张都不能少，否则前两轮的强制引导会指向一张不存在的牌。
    for (const cardId of [TUTORIAL_CARDS.firstAi, TUTORIAL_CARDS.skill, ...TUTORIAL_CARDS.optionalAi]) {
      expect(TUTORIAL_PLAYER_OPENING_HAND).toContain(cardId)
    }
  })

  it('对手每一轮的脚本都付得起 Token', () => {
    TUTORIAL_FOE_PLAYS.forEach((plays, index) => {
      const limit = INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH * index
      const cost = plays.reduce((sum, cardId) => sum + tutorialCardCost(cardId), 0)
      expect(cost, `第 ${index + 1} 轮对手要花 ${cost} 点`).toBeLessThanOrEqual(limit)
    })
  })

  it('第 2 轮玩家怎么选都比对手省 Token，掉不进「消耗相同」那一档', () => {
    const optionalCosts = TUTORIAL_CARDS.optionalAi.map(tutorialCardCost)
    const playerMax = tutorialCardCost(TUTORIAL_CARDS.skill) + Math.max(...optionalCosts)
    const foeSpend = (TUTORIAL_FOE_PLAYS[1] ?? []).reduce(
      (sum, cardId) => sum + tutorialCardCost(cardId),
      0,
    )
    expect(playerMax).toBeLessThan(foeSpend)
    // 顺带守住"最贵那条路也买得起"：第 2 轮上限是 6 点。
    expect(playerMax).toBeLessThanOrEqual(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
  })

  it('第 2 轮可选的两张都是低费 AI 牌', () => {
    for (const cardId of TUTORIAL_CARDS.optionalAi) {
      const card = getCard(cardId)
      expect(card.kind).toBe('ai')
      expect(card.tokenCost).toBeLessThanOrEqual(2)
    }
  })
})

describe('步骤表的完成条件判定', () => {
  const context = {
    seenCues: new Set<'quiz-open'>(['quiz-open']),
    elapsedMs: 1200,
    events: [{ type: 'AI_DEPLOYED', player: 0, ai: { instanceId: 'x', cardId: 'gpt-2', owner: 0 } }],
    playerSeat: PLAYER,
  } as const

  it('cue 只认本轮已经出现过的信号', () => {
    expect(signalSatisfied({ kind: 'cue', cue: 'quiz-open' }, context)).toBe(true)
    expect(signalSatisfied({ kind: 'cue', cue: 'quiz-closed' }, context)).toBe(false)
  })

  it('delay 按就绪之后过了多久算', () => {
    expect(signalSatisfied({ kind: 'delay', ms: 1200 }, context)).toBe(true)
    expect(signalSatisfied({ kind: 'delay', ms: 1201 }, context)).toBe(false)
  })

  it('event 认类型，也认是谁干的', () => {
    expect(signalSatisfied({ kind: 'event', event: { type: 'AI_DEPLOYED' } }, context)).toBe(true)
    expect(
      signalSatisfied({ kind: 'event', event: { type: 'AI_DEPLOYED', by: 'me' } }, context),
    ).toBe(true)
    expect(
      signalSatisfied({ kind: 'event', event: { type: 'AI_DEPLOYED', by: 'foe' } }, context),
    ).toBe(false)
    expect(signalSatisfied({ kind: 'event', event: { type: 'GAME_OVER' } }, context)).toBe(false)
  })
})
