/**
 * 教学对战的剧本对账。
 *
 * 这里只测 driver 那一层（引擎 + 对手脚本 + 真实模型回答表），不碰 UI：
 * 教程"可预测"这件事全靠这三样，把它们钉住，引导层就只剩排版问题。
 * 两个延迟（对手每一步、答题自动提交）都注入成 0，再配假定时器，整份测试是同步跑完的。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CARD_POOL,
  HEROES,
  INITIAL_TOKEN_MAX,
  QUESTION_POOL,
  TOKEN_MAX_GROWTH,
  getCard,
  scriptedAnswers,
} from '@ai-duel/core'
import type { CardId, GameEvent, GameState, InstanceId } from '@ai-duel/core'
import { createTutorialDriver } from '../src/match/tutorialDriver'
import type { TutorialDriver } from '../src/match/tutorialDriver'
import {
  TUTORIAL_CARDS,
  TUTORIAL_FOE_DECK,
  TUTORIAL_QUESTIONS,
  TUTORIAL_PLAYER_DRAW_ORDER,
  TUTORIAL_FOE_HERO,
  TUTORIAL_FOE_OPENING_HAND,
  TUTORIAL_FOE_PLAYS,
  TUTORIAL_PLAYER_DECK,
  TUTORIAL_PLAYER_OPENING_HAND,
  tutorialCardCost,
} from '../src/tutorial/content'
import { TUTORIAL_HERO } from '../src/tutorial/heroSteps'
import { enterTutorialStep, pumpTutorial, signalSatisfied } from '../src/tutorial/steps'
import type { TutorialSignalContext } from '../src/tutorial/steps'

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

/**
 * 玩家在结算层上点「进入下一轮」。
 *
 * 对手那一下由 driver 自己代点（见 tutorialDriver 的 pumpFoeConfirm），
 * 玩家这一下在真界面上是结算层按钮的一次点击，测试里只能手动补。
 * 双方都确认之后才会推进下一轮，所以每一轮结算后都要调它一次。
 */
function confirmRound(driver: TutorialDriver): void {
  driver.send({ type: 'CONFIRM_ROUND', player: PLAYER })
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
 * 走完第 1 轮（玩家打指定 AI → 结束出牌 → 对手 gpt-4o → 答题 → 双方确认结算），
 * 停在第 2 轮玩家可以出牌的那一刻（对手已经派出 deepseek-r1 并结束了出牌）。
 */
function playThroughRoundOne(run: TutorialRun): void {
  flush()
  play(run.driver, TUTORIAL_CARDS.firstAi)
  endPlay(run.driver)
  flush()
  confirmRound(run.driver)
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

    // 第 2 轮由对手先手，它已经把 deepseek-r1 派上场了，玩家的干扰技能才有目标。
    expect(stateOf(run.driver).round).toBe(2)
    expect(stateOf(run.driver).players[FOE].board.map((ai) => ai.cardId)).toEqual(['deepseek-r1'])
    // 这一轮只打技能牌：教程不放行增派 AI（见 TUTORIAL_CARDS.optionalAi）。
    play(run.driver, TUTORIAL_CARDS.skill, foeAiId(run.driver))
    endPlay(run.driver)
    flush()
    confirmRound(run.driver)
    flush()

    // 第 3 轮回到玩家先手，随便派一张都不影响结果。
    expect(stateOf(run.driver).round).toBe(3)
    play(run.driver, 'gemini')
    endPlay(run.driver)
    flush()
    confirmRound(run.driver)
    flush()

    // 三轮都是"只有一方答对"：第 1 轮和第 3 轮对手自己答错，第 2 轮是被复读机干扰答错。
    // 这三条对错全部来自那张真实模型回答表，不是教学局自己写死的（见 tutorial/content.ts）。
    // 「答对数相同才比 Token」那一档在教学局里刻意不出现，所以三条都该是 more-correct。
    const scored = scoredEvents(run.events)
    expect(scored.map((event) => event.verdict)).toEqual([
      'more-correct',
      'more-correct',
      'more-correct',
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

  // 第 2 轮那一课的全部内容：复读机命中之后，对手那张 AI 真的只会答「香蕉」并判错。
  // 这条断言直接盯着揭晓出来的那句话，卡面写的和玩家看到的对不上时会当场红。
  // 玩家这一轮只有这一条路可走：教程不放行增派 AI（见 TUTORIAL_CARDS.optionalAi）。
  it('第 2 轮：被复读机干扰的对手 AI 只答「香蕉」，判错后被罚下', () => {
    const run = start()
    playThroughRoundOne(run)
    const foeAi = foeAiId(run.driver)
    play(run.driver, TUTORIAL_CARDS.skill, foeAi)
    endPlay(run.driver)
    flush()

    const answered = run.events.filter(
      (event) => event.type === 'AI_ANSWERED' && event.instanceId === foeAi,
    )
    expect(answered).toHaveLength(1)
    expect(answered[0]).toMatchObject({ correct: false, answer: '香蕉' })
    // 答错就罚下，所以第 3 轮对手场上只剩它新派的那一张。
    expect(run.events).toContainEqual({ type: 'AI_ELIMINATED', instanceId: foeAi, owner: FOE })

    const round2 = scoredEvents(run.events)[1]
    expect(round2?.verdict).toBe('more-correct')
    expect(round2?.correctCounts).toEqual([1, 0])
    // 只花了复读机那 4 点，对手 3 点——这一分和消耗无关，但数字仍旧记在事件里。
    expect(round2?.spent).toEqual([
      tutorialCardCost(TUTORIAL_CARDS.skill),
      tutorialCardCost('deepseek-r1'),
    ])
    expect(round2?.scores).toEqual([2, 0])
  })

  it('挡住对手脚本：放行之前它一张牌都不出', () => {
    const run = start()
    flush()
    // 教程在讲提示的时候会把对手挡下来（第 2 轮对手先手，不挡的话它的出牌演出会盖住引导）。
    run.driver.setFoeHold(true)
    play(run.driver, TUTORIAL_CARDS.firstAi)
    endPlay(run.driver)
    flush()
    expect(stateOf(run.driver).players[FOE].board).toEqual([])
    expect(stateOf(run.driver).phase).toBe('play')

    run.driver.setFoeHold(false)
    flush()
    // 放行之后它把整轮补完：出牌 → 结束出牌 → 答题 → 它自己那下结算确认。
    // 玩家那下确认还没点，所以局面停在结算阶段等着。
    expect(stateOf(run.driver).phase).toBe('settle')
    expect(stateOf(run.driver).settleConfirmed).toEqual([false, true])
    confirmRound(run.driver)
    flush()
    // 双方都确认了才进第 2 轮，对手又先手派出那张要被复读机干扰的 AI。
    expect(stateOf(run.driver).round).toBe(2)
    expect(stateOf(run.driver).players[FOE].board.map((ai) => ai.cardId)).toEqual(['deepseek-r1'])
  })

  it('第 1 轮对手最后一张牌落场后可以暂停，玩家确认后才进入答题', () => {
    const run = start()
    // 教程控制器收到对手落场事件时，会同步关上这道闸并显示确认提示。
    run.driver.onEvents((batch) => {
      run.events.push(...batch)
      if (batch.some((event) => event.type === 'AI_DEPLOYED' && event.player === FOE)) {
        run.driver.setFoeHold(true)
      }
    })

    flush()
    play(run.driver, TUTORIAL_CARDS.firstAi)
    endPlay(run.driver)
    flush()

    expect(stateOf(run.driver).phase).toBe('play')
    expect(stateOf(run.driver).activePlayer).toBe(FOE)
    expect(stateOf(run.driver).players[FOE].board.map((ai) => ai.cardId)).toEqual(['gpt-4o'])
    expect(run.events.some((event) => event.type === 'QUESTION_REVEALED')).toBe(false)

    // 玩家点完提示后，控制器重新放开脚本；对手结束出牌，答题才真正开始。
    run.driver.setFoeHold(false)
    flush()
    expect(run.events.some((event) => event.type === 'QUESTION_REVEALED')).toBe(true)
    expect(stateOf(run.driver).phase).toBe('settle')
  })

  it('第 3 轮什么都不打直接结束：场上的老 AI 照样答对，3:0 收场', () => {
    const run = start()
    playThroughRoundOne(run)
    play(run.driver, TUTORIAL_CARDS.skill, foeAiId(run.driver))
    endPlay(run.driver)
    flush()
    confirmRound(run.driver)
    flush()

    expect(stateOf(run.driver).round).toBe(3)
    endPlay(run.driver)
    flush()
    confirmRound(run.driver)
    flush()

    const scored = scoredEvents(run.events)
    expect(scored[2]?.verdict).toBe('more-correct')
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

  // 教学牌组必须整副都在 CARD_POOL 里，没有例外：第 3 轮玩家可以自由出牌
  // （步骤表那一步 playableCards 是 null），混进一张卡池外的牌——「即将上线」的技能牌，
  // 或者 GPT-2、文心一言那种调不到模型的 AI——玩家就能把它打上牌桌，
  // 学完回到牌组页却发现那张是灰的、自己拼不出这副牌。
  // core 不校验牌组内容，教学 driver 也直接把这两副牌塞给引擎，所以只有这条测试守着。
  it('教学双方牌组里的每张牌都在已开放的卡池里', () => {
    for (const deck of [TUTORIAL_PLAYER_DECK, TUTORIAL_FOE_DECK]) {
      for (const cardId of deck) {
        expect(CARD_POOL, `${cardId} 不在卡池里`).toContain(cardId)
      }
    }
  })

  // 教学局的每一步都是照脚本对好的，对手身上多一条会生效的技能就可能把它顶歪
  // （霍珀的 Debug 会抵消玩家第 2 轮那张教学技能牌，阿达的 +2 会让下面那本 Token 账对不上）。
  // 挑一位 comingSoon 的英雄就等于"这一位在引擎里什么都不做"，是最省心的做法；
  // 等这三位陆续实装、这条测试再也找不到人选时，得回来给教学局另想一个不干扰脚本的对手。
  it('教学对手的英雄技能没有实装，不会掺和进脚本', () => {
    expect(HEROES[TUTORIAL_FOE_HERO].comingSoon).toBe(true)
  })

  // 反过来的一半：教程说"英雄自带独特技能"，引导玩家去选的那位必须真有技能，
  // 而且不能是被选英雄页置灰的那三位之一——引导层的高亮会正好圈在一张点不开的卡上。
  it('教程引导玩家选的英雄技能已实装，选英雄页不会把她置灰', () => {
    expect(HEROES[TUTORIAL_HERO].comingSoon).toBeUndefined()
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

  // 教学题现在从正式题库里挑（core 的 QUESTION_POOL），回答也走正式那张真实模型回答表。
  // 一旦题库改了 id、或者预生成表重跑出别的结果，教学剧本就会静悄悄地崩——
  // 主线那条端到端测试会红，但报出来的是"比分不对"，看不出是哪一格变了。
  // 这条按格子对，直接指出是哪一轮、哪张卡、答对还是答错。
  it('三轮的对错都是从真实模型回答表里查出来的', () => {
    for (const question of TUTORIAL_QUESTIONS) {
      expect(QUESTION_POOL, `${question.id} 不在正式题库里`).toContain(question)
    }

    TUTORIAL_FOE_PLAYS.forEach((plays, index) => {
      const question = TUTORIAL_QUESTIONS[index]
      if (question === undefined) throw new Error(`第 ${index + 1} 轮没有题目`)
      const foeCard = plays[0]
      if (foeCard === undefined) throw new Error(`第 ${index + 1} 轮对手没有出牌`)

      // 玩家场上那张 AI 从第 1 轮活到底，三轮都要答对，那三分全靠它。
      const [mine] = scriptedAnswers(question, [
        { instanceId: 'mine', cardId: TUTORIAL_CARDS.firstAi, owner: PLAYER },
      ])
      expect(mine?.correct, `第 ${index + 1} 轮 ${TUTORIAL_CARDS.firstAi} 该答对`).toBe(true)

      // 对手那张要答错。第 2 轮是靠复读机把它从"答对"改成"答香蕉"，所以两档都要对上：
      // 没被干扰时答对（不然那张技能牌就没改变任何结果，这一课当场落空），干扰后答错。
      const interfered = index === 1
      const [theirs] = scriptedAnswers(question, [
        {
          instanceId: 'theirs',
          cardId: foeCard,
          owner: FOE,
          ...(interfered ? { interference: 'fixed-answer' as const } : {}),
        },
      ])
      expect(theirs?.correct, `第 ${index + 1} 轮 ${foeCard} 该答错`).toBe(false)
      if (interfered) {
        const [clean] = scriptedAnswers(question, [
          { instanceId: 'theirs', cardId: foeCard, owner: FOE },
        ])
        expect(clean?.correct, `${foeCard} 没被干扰时本该答对`).toBe(true)
        expect(theirs?.answer, '被复读机干扰之后该改口答香蕉').toContain('香蕉')
      }
    })
  })

  // 第 3 轮是放手轮：玩家想派谁就派谁，而回答查的是真实模型表。
  // 手上留着一张会答错那道题的 AI，玩家照着"随便派"派出去就会当场看着它被罚下——
  // 教程刚教完"答错要下场"，这时候演一遍只会让人以为自己做错了。
  it('第 3 轮玩家摸得到的每一张 AI 都答得对那道题', () => {
    const question = TUTORIAL_QUESTIONS[2]
    if (question === undefined) throw new Error('教学局没有第 3 道题')
    for (const cardId of new Set(TUTORIAL_PLAYER_DRAW_ORDER)) {
      if (getCard(cardId).kind !== 'ai') continue
      const [answer] = scriptedAnswers(question, [
        { instanceId: 'x', cardId, owner: PLAYER },
      ])
      expect(answer?.correct, `${cardId} 在第 3 轮那道题上会答错`).toBe(true)
    }
  })

  it('对手每一轮的脚本都付得起 Token', () => {
    TUTORIAL_FOE_PLAYS.forEach((plays, index) => {
      const limit = INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH * index
      const cost = plays.reduce((sum, cardId) => sum + tutorialCardCost(cardId), 0)
      expect(cost, `第 ${index + 1} 轮对手要花 ${cost} 点`).toBeLessThanOrEqual(limit)
    })
  })

  it('第 2 轮双方最贵的那条路都买得起', () => {
    // 教学第 2 轮强制打复读机，之后按 optionalAi 还可能再增派一张（现在是空的）。
    // 加起来必须在当轮额度内，否则玩家照着引导点下去会被引擎回一句「Token 不够」，教程当场卡住。
    // Math.max 补一个 0 兜底：名单空着时展开成 Math.max() 会得到 -Infinity。
    const optionalCosts = TUTORIAL_CARDS.optionalAi.map(tutorialCardCost)
    const playerMax = tutorialCardCost(TUTORIAL_CARDS.skill) + Math.max(0, ...optionalCosts)
    expect(playerMax).toBeLessThanOrEqual(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
    // 对手那一轮也得付得起。
    const foeSpend = (TUTORIAL_FOE_PLAYS[1] ?? []).reduce(
      (sum, cardId) => sum + tutorialCardCost(cardId),
      0,
    )
    expect(foeSpend).toBeLessThanOrEqual(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
  })

  it('第 2 轮一张增派的 AI 都不放行', () => {
    // 空名单的理由见 TUTORIAL_CARDS.optionalAi：原来放这里的 1 费 GPT-2 调不到模型、
    // 已经不在卡池里，而这一步要教的是"技能真的会改结果"，不该再塞一个可选动作分散注意力。
    // 它**不是** Token 对账逼出来的——第 2 轮那一分靠"只有玩家答对"拿到，和消耗无关。
    expect(TUTORIAL_CARDS.optionalAi).toEqual([])
    // 哪天想把这个可选动作加回来，唯一那条硬约束在这里守着：打完复读机剩下的额度得买得起它。
    const left = INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH - tutorialCardCost(TUTORIAL_CARDS.skill)
    for (const cardId of TUTORIAL_CARDS.optionalAi) {
      const card = getCard(cardId)
      expect(card.kind).toBe('ai')
      expect(card.tokenCost).toBeLessThanOrEqual(left)
    }
  })
})

describe('步骤表的完成条件判定', () => {
  const context = {
    seenCues: new Set<'quiz-open'>(['quiz-open']),
    elapsedMs: 1200,
    events: [{ type: 'AI_DEPLOYED', player: 0, ai: { instanceId: 'x', cardId: 'gpt-2', owner: 0 } }],
    tapped: false,
    playerSeat: PLAYER,
  } as const

  it('tap 认这批输入里有没有玩家点的那一下', () => {
    expect(signalSatisfied({ kind: 'tap' }, context)).toBe(false)
    expect(signalSatisfied({ kind: 'tap' }, { ...context, tapped: true })).toBe(true)
  })

  it('cue 只认本轮已经出现过的信号', () => {
    expect(signalSatisfied({ kind: 'cue', cue: 'quiz-open' }, context)).toBe(true)
    expect(signalSatisfied({ kind: 'cue', cue: 'quiz-closed' }, context)).toBe(false)
  })

  // delay 现在只出现在 readyOn 里（等一段没有收尾信号的演出），按进入这一步之后过了多久算。
  it('delay 按进入这一步之后过了多久算', () => {
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

/**
 * 讲解步骤的推进：全靠玩家点一下（steps.ts 的 `advance: tap()`）。
 * 这里直接跑状态机本体 pumpTutorial，不渲染 React——控制器那层只是把它的结果落到 state 上。
 */
describe('讲解步骤靠点击推进', () => {
  /** 一批"什么都没发生"的输入，用参数按需覆盖其中一两项。 */
  function inputs(overrides: Partial<TutorialSignalContext> = {}): TutorialSignalContext {
    return {
      seenCues: new Set(),
      elapsedMs: 0,
      events: [],
      tapped: false,
      playerSeat: PLAYER,
      ...overrides,
    }
  }

  it('没点就不动，点了才走下一步', () => {
    // 泵一次让提示出场（这一步没有 readyOn，进入即就绪），但没人点，所以还停在原地。
    const idle = pumpTutorial(enterTutorialStep('TUTORIAL_R2_REFRESH'), inputs())
    expect(idle.ready).toBe(true)
    expect(idle.stepId).toBe('TUTORIAL_R2_REFRESH')

    expect(pumpTutorial(idle, inputs({ tapped: true })).stepId).toBe('TUTORIAL_R2_TOKEN')
  })

  it('一次点击只推一步：连着三步讲解要点三下', () => {
    // 这三步 readyOn 都是空的、进入即就绪，最容易被同一下点击一口气翻完。
    let state = pumpTutorial(enterTutorialStep('TUTORIAL_R2_REFRESH'), inputs())
    const visited = [state.stepId]
    for (let i = 0; i < 3; i += 1) {
      state = pumpTutorial(state, inputs({ tapped: true }))
      visited.push(state.stepId)
    }
    expect(visited).toEqual([
      'TUTORIAL_R2_REFRESH',
      'TUTORIAL_R2_TOKEN',
      'TUTORIAL_R2_DRAW',
      // 第三下之后进入过渡态（放行对手脚本），它等的是引擎事件，不再吃点击。
      'TUTORIAL_R2_FOE_PLAY',
    ])
  })

  it('提示还没出场时点的那一下不算数', () => {
    // R1_STAY 要等上场特效演完（readyOn 里的 delay(1600)）提示才出来。
    const early = pumpTutorial(enterTutorialStep('TUTORIAL_R1_STAY'), inputs({ tapped: true }))
    expect(early.ready).toBe(false)
    expect(early.stepId).toBe('TUTORIAL_R1_STAY')

    // 演出走完，提示出场——刚才那一下没被记着，还停在这一步等玩家重新点。
    const shown = pumpTutorial(early, inputs({ elapsedMs: 1600 }))
    expect(shown.ready).toBe(true)
    expect(shown.stepId).toBe('TUTORIAL_R1_STAY')
    expect(pumpTutorial(shown, inputs({ tapped: true })).stepId).toBe('TUTORIAL_R1_END_PLAY')
  })

  it('第 1 轮对手最后一张牌落场后，必须再点一下才放行答题', () => {
    const deployed: GameEvent = {
      type: 'AI_DEPLOYED',
      player: FOE,
      ai: { instanceId: 'foe-ai', cardId: 'gpt-4o', owner: FOE },
    }
    const paused = pumpTutorial(
      enterTutorialStep('TUTORIAL_R1_FOE_PLAY'),
      inputs({ events: [deployed] }),
    )

    expect(paused.ready).toBe(true)
    expect(paused.stepId).toBe('TUTORIAL_R1_FOE_DONE')
    expect(pumpTutorial(paused, inputs()).stepId).toBe('TUTORIAL_R1_FOE_DONE')
    expect(pumpTutorial(paused, inputs({ tapped: true })).stepId).toBe('TUTORIAL_R1_ANSWER')
  })

  it('要玩家出牌的步骤不吃点击，只认引擎事件', () => {
    const state = pumpTutorial(enterTutorialStep('TUTORIAL_R1_PLAY_AI'), inputs({ tapped: true }))
    expect(state.stepId).toBe('TUTORIAL_R1_PLAY_AI')
    const played = pumpTutorial(
      state,
      inputs({
        events: [
          { type: 'AI_DEPLOYED', player: PLAYER, ai: { instanceId: 'x', cardId: 'gpt-2', owner: PLAYER } },
        ],
      }),
    )
    expect(played.stepId).toBe('TUTORIAL_R1_STAY')
  })
})
