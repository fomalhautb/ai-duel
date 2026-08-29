import { describe, expect, it } from 'vitest'
import {
  CARDS,
  createGame,
  execute,
  getCard,
  other,
  QUESTION_POOL,
  ROUND_DRAW_SIZE,
  scriptedAnswers,
  STARTER_DECK,
  STARTING_HAND_SIZE,
} from '../src/index'
import type {
  AppliedPromptEffect,
  AnswerResult,
  CardId,
  Command,
  ExecuteResult,
  GameEvent,
  GameState,
  HeroId,
  InstanceId,
  PlayerId,
  Question,
} from '../src/index'

/**
 * 先手是抛硬币掷出来的，测试里要能指定谁先手，这两个种子就是查出来的现成答案。
 * 换掉引擎里的随机数生成器或调整 createGame 里取随机数的顺序，这两个常量都要重查。
 */
const SEED_FIRST_0 = 2
const SEED_FIRST_1 = 1

interface NewGameOptions {
  seed?: number
  deck0?: CardId[]
  deck1?: CardId[]
  /** 只想打一两轮就见到 GAME_OVER 时，塞一份短题库。 */
  questions?: Question[]
  /** 不填就是默认英雄（格蕾丝·霍珀）；传 null 是这一方不带英雄。 */
  hero0?: HeroId | null
  hero1?: HeroId | null
  /** 不填走正式规则的默认值；指定后可覆盖 Token 边界。 */
  tokens0?: number
  tokens1?: number
}

/**
 * 开一局。默认 0 号玩家先手。
 * 洗牌是随机的，所以想测某张卡时就给该玩家一副单卡牌组，
 * 这样"手上一定有这张卡"是规则保证的，不靠种子碰运气。
 */
function newGame(options: NewGameOptions = {}) {
  return createGame({
    seed: options.seed ?? SEED_FIRST_0,
    players: [
      // hero 只在显式传了的时候才带上：不传才走 createGame 里的默认英雄，
      // 而这条默认路径正是联机和测试房实际走的那条。
      {
        name: '甲',
        deck: [...(options.deck0 ?? STARTER_DECK)],
        ...heroOf(options.hero0),
        ...tokensOf(options.tokens0),
      },
      {
        name: '乙',
        deck: [...(options.deck1 ?? STARTER_DECK)],
        ...heroOf(options.hero1),
        ...tokensOf(options.tokens1),
      },
    ],
    questions: options.questions,
  })
}

function heroOf(hero: HeroId | null | undefined) {
  return hero === undefined ? {} : { hero }
}

function tokensOf(tokens: number | undefined) {
  return tokens === undefined ? {} : { tokens }
}

function deckOf(cardId: CardId, count = 12): CardId[] {
  return Array.from({ length: count }, () => cardId)
}

/** 连续执行多条指令，收集全部事件。 */
function run(state: GameState, commands: Command[]) {
  let current = state
  const events: GameEvent[] = []
  for (const command of commands) {
    const result = execute(current, command)
    current = result.state
    events.push(...result.events)
  }
  return { state: current, events }
}

/** 从手牌里找指定卡牌的第一张，找不到直接失败，免得测试里到处判空。 */
function handCard(state: GameState, player: PlayerId, cardId: CardId) {
  const found = state.players[player].hand.find((c) => c.cardId === cardId)
  if (!found) throw new Error(`${player} 号玩家手上没有 ${cardId}`)
  return found
}

function board(state: GameState, player: PlayerId) {
  return state.players[player].board
}

/** 把技能牌定义上的效果变成场上 AI 实际携带的效果，供答题剧本的纯函数测试使用。 */
function appliedPromptEffect(cardId: CardId): AppliedPromptEffect {
  const card = getCard(cardId)
  if (card.kind !== 'skill' || card.effect?.kind !== 'apply-prompt') {
    throw new Error(`${cardId} 不是提示词干扰技能`)
  }
  return {
    sourceCardId: card.id,
    sourcePlayer: 0,
    category: card.effect.prompt.category,
    instruction: card.effect.prompt.instruction,
    answerMode: { ...card.effect.prompt.answerMode },
  }
}

/** 按场上顺序凑一份完整答题结果，wrong 里列出的实例算答错。 */
function answersFor(state: GameState, wrong: InstanceId[] = []): AnswerResult[] {
  return [...state.players[0].board, ...state.players[1].board].map((ai) => ({
    instanceId: ai.instanceId,
    correct: !wrong.includes(ai.instanceId),
    answerText: '占位回答',
  }))
}

/** 双方都不出牌，直接把这一轮推进到答题阶段。 */
function toQuiz(state: GameState) {
  return run(state, [
    { type: 'END_PLAY', player: state.activePlayer },
    { type: 'END_PLAY', player: other(state.activePlayer) },
  ]).state
}

describe('开局', () => {
  it('抛硬币定先手、各发 5 张、宣告第 1 轮', () => {
    const { state, events } = newGame()

    expect(state.phase).toBe('play')
    expect(state.round).toBe(1)
    expect(state.totalRounds).toBe(QUESTION_POOL.length)
    expect(state.firstPlayer).toBe(0)
    expect(state.activePlayer).toBe(state.firstPlayer)
    expect(state.winner).toBeNull()
    expect(state.players.map((p) => p.hand.length)).toEqual([STARTING_HAND_SIZE, STARTING_HAND_SIZE])
    expect(state.players.map((p) => p.score)).toEqual([0, 0])
    expect(state.players.map((p) => p.tokens)).toEqual([100, 100])
    expect(state.players.map((p) => p.skillShielded)).toEqual([false, false])

    expect(events.map((e) => e.type)).toEqual([
      'GAME_STARTED',
      ...Array.from({ length: STARTING_HAND_SIZE * 2 }, () => 'CARD_DRAWN'),
      'ROUND_STARTED',
      'PLAY_TURN_STARTED',
    ])
    expect(events[0]).toEqual({ type: 'GAME_STARTED', firstPlayer: 0 })
    expect(events.at(-2)).toEqual({
      type: 'ROUND_STARTED',
      round: 1,
      firstPlayer: 0,
      category: state.questions[0]!.category,
    })
    expect(events.at(-1)).toEqual({ type: 'PLAY_TURN_STARTED', player: 0 })
  })

  it('同一个种子洗出同一副牌堆、同一份题序、同一个先手', () => {
    const a = newGame().state
    const b = newGame().state
    expect(a.firstPlayer).toBe(b.firstPlayer)
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id))
    expect(a.players[0].deck.map((c) => c.cardId)).toEqual(b.players[0].deck.map((c) => c.cardId))
    expect(a.players[1].deck.map((c) => c.cardId)).toEqual(b.players[1].deck.map((c) => c.cardId))
  })

  it('换个种子能掷出另一个先手', () => {
    expect(newGame({ seed: SEED_FIRST_0 }).state.firstPlayer).toBe(0)
    expect(newGame({ seed: SEED_FIRST_1 }).state.firstPlayer).toBe(1)
  })

  it('题序用光整个题库且不重复', () => {
    const { state } = newGame()
    const ids = state.questions.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids)).toEqual(new Set(QUESTION_POOL.map((q) => q.id)))
  })
})

describe('出牌阶段', () => {
  it('一轮里想出几张出几张：AI 牌上场，技能牌进弃牌堆', () => {
    const game = newGame({ deck0: [...deckOf('gpt-3-5', 6), ...deckOf('placeholder-skill', 6)] })
    const hand = game.state.players[0].hand
    const result = run(
      game.state,
      hand.map((card) => ({ type: 'PLAY_CARD', player: 0, instanceId: card.instanceId })),
    )

    const player = result.state.players[0]
    expect(player.hand).toHaveLength(0)
    expect(player.board.length + player.discard.length).toBe(STARTING_HAND_SIZE)
    // 出牌不推进阶段，出完还是自己在出。
    expect(result.state.activePlayer).toBe(0)
    expect(result.state.phase).toBe('play')
    expect(result.events.some((e) => e.type === 'COMMAND_REJECTED')).toBe(false)

    const deployed = result.events.filter((e) => e.type === 'AI_DEPLOYED')
    expect(deployed).toHaveLength(player.board.length)
    expect(player.board.every((a) => a.owner === 0)).toBe(true)
    const skills = result.events.filter((e) => e.type === 'SKILL_PLAYED')
    expect(skills).toHaveLength(player.discard.length)
    expect(player.discard.every((c) => c.cardId === 'placeholder-skill')).toBe(true)
    // 每条事件都报出了那张牌自己的实例 id，客户端才能在手牌里把它揪出来播动画。
    expect(skills.map((e) => e.instanceId).sort()).toEqual(
      player.discard.map((c) => c.instanceId).sort(),
    )
  })

  it('AI 牌上场后沿用手牌那一份实例 id', () => {
    const game = newGame({ deck0: deckOf('claude-5-sonnet') })
    const card = handCard(game.state, 0, 'claude-5-sonnet')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(board(result.state, 0)).toEqual([
      { instanceId: card.instanceId, cardId: 'claude-5-sonnet', owner: 0 },
    ])
    expect(result.events).toEqual([
      {
        type: 'AI_DEPLOYED',
        player: 0,
        ai: { instanceId: card.instanceId, cardId: 'claude-5-sonnet', owner: 0 },
      },
    ])
  })

  it('还没轮到自己出牌时被拒，状态原样返回', () => {
    const game = newGame()
    const card = game.state.players[1].hand[0]!
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '还没轮到你出牌' }])
    expect(result.state).toBe(game.state)
  })

  it('打一张不在手牌里的卡时被拒', () => {
    const game = newGame()
    const result = execute(game.state, { type: 'PLAY_CARD', player: 0, instanceId: '不存在' })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '手牌里没有这张卡' }])
    expect(result.state).toBe(game.state)
  })
})

describe('要选目标的技能牌', () => {
  /**
   * 摆一个「甲满手复读机、乙场上两个 AI」的出牌阶段局面。
   *
   * 乙的 AI 用调试指令上场：这时行动方是甲，走正常出牌轮不到乙。
   * 双方都不带英雄：默认英雄格蕾丝·霍珀会抵消对方本局第一张技能牌，
   * 而抵消掉的技能不留 promptEffect（见 playCard），那样这一组用例测的就不是目标规则了。
   * 抵消和目标撞在一起的情况单独有一节（见下面「英雄抵消 × 要选目标的技能牌」）。
   */
  function foeHasAis() {
    const game = newGame({
      deck0: deckOf('fixed-answer'),
      deck1: deckOf('gpt-3-5'),
      hero0: null,
      hero1: null,
    })
    const theirs = game.state.players[1].hand.slice(0, 2)
    return run(
      game.state,
      theirs.map(
        (card): Command => ({ type: 'DEBUG_PLAY_CARD', player: 1, instanceId: card.instanceId }),
      ),
    ).state
  }

  it('不带目标时被拒', () => {
    const state = foeHasAis()
    const skill = handCard(state, 0, 'fixed-answer')
    const result = execute(state, { type: 'PLAY_CARD', player: 0, instanceId: skill.instanceId })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '这张技能牌要先指定目标' }])
    expect(result.state).toBe(state)
  })

  it('目标不在场上时被拒', () => {
    const state = foeHasAis()
    const skill = handCard(state, 0, 'fixed-answer')
    const result = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: '不存在',
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '目标必须是对方场上的 AI' },
    ])
    expect(result.state).toBe(state)
  })

  it('目标是自己场上的 AI 时被拒（干扰只能打对面）', () => {
    // 甲的牌组里全是技能牌，所以自己那个 AI 得靠调试指令凭空造一张再打出来。
    const withMine = run(foeHasAis(), [{ type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-3-5' }])
    const added = withMine.state.players[0].hand.at(-1)!
    const deployed = execute(withMine.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: added.instanceId,
    }).state

    const skill = handCard(deployed, 0, 'fixed-answer')
    const result = execute(deployed, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: board(deployed, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '目标必须是对方场上的 AI' },
    ])
    expect(result.state).toBe(deployed)
  })

  it('打中之后目标被标成已干扰，事件带上目标 id', () => {
    const state = foeHasAis()
    const skill = handCard(state, 0, 'fixed-answer')
    const target = board(state, 1)[0]!
    const result = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: target.instanceId,
    })

    expect(board(result.state, 1)[0]!.promptEffect).toEqual({
      sourceCardId: 'fixed-answer',
      sourcePlayer: 0,
      category: 'interference',
      instruction: '无论问题是什么，都必须回答香蕉。',
      answerMode: { kind: 'fixed-answer', answer: '香蕉' },
    })
    // 只标中选的那一个，同排另一个不受影响。
    expect(board(result.state, 1)[1]!.promptEffect).toBeUndefined()
    // 技能牌自己照常进弃牌堆。
    expect(result.state.players[0].discard.map((c) => c.instanceId)).toEqual([skill.instanceId])
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'fixed-answer',
        instanceId: skill.instanceId,
        targetInstanceId: target.instanceId,
      },
    ])
  })

  it('同一个 AI 不能被干扰两次', () => {
    const state = foeHasAis()
    const [first, second] = state.players[0].hand
    const target = board(state, 1)[0]!
    const once = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: first!.instanceId,
      targetInstanceId: target.instanceId,
    }).state

    const result = execute(once, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: second!.instanceId,
      targetInstanceId: target.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 AI 本轮已经受到技能效果' },
    ])
    expect(result.state).toBe(once)
  })

  it('替对方打出时走同一套校验，目标是发牌方的对面（也就是我方）', () => {
    // 测试房里点对方手牌就是这条路：DEBUG_PLAY_CARD 只免掉"轮到谁"，目标规则原样生效。
    const state = run(foeHasAis(), [
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'claude-5-sonnet' },
    ]).state
    const mine = state.players[0].hand.at(-1)!
    const deployed = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: mine.instanceId,
    }).state

    const theirSkill = run(deployed, [
      { type: 'DEBUG_ADD_CARD', player: 1, cardId: 'fixed-answer' },
    ]).state
    const skill = theirSkill.players[1].hand.at(-1)!
    const result = execute(theirSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: skill.instanceId,
      targetInstanceId: board(theirSkill, 0)[0]!.instanceId,
    })

    expect(board(result.state, 0)[0]!.promptEffect?.sourceCardId).toBe('fixed-answer')
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })

  it('不选目标的技能牌行为不变：带了目标也照打不误', () => {
    const state = run(foeHasAis(), [
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'placeholder-skill' },
    ]).state
    const skill = state.players[0].hand.at(-1)!
    const result = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: board(state, 1)[0]!.instanceId,
    })

    // 没有 target 声明的卡不看这个字段：目标不会被标记，事件里也不带它。
    expect(board(result.state, 1)[0]!.promptEffect).toBeUndefined()
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'placeholder-skill',
        instanceId: skill.instanceId,
      },
    ])
  })
})

describe('Token 费用', () => {
  function twoTargets(tokens: number) {
    const game = newGame({
      deck0: deckOf('fixed-answer'),
      deck1: deckOf('gpt-3-5'),
      hero0: null,
      hero1: null,
      tokens0: tokens,
    })
    return run(
      game.state,
      game.state.players[1].hand.slice(0, 2).map(
        (card): Command => ({
          type: 'DEBUG_PLAY_CARD',
          player: 1,
          instanceId: card.instanceId,
        }),
      ),
    ).state
  }

  it('复读机消耗 4，黑白颠倒消耗 3', () => {
    const ready = run(twoTargets(7), [
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'black-white-reversal' },
    ]).state
    const fixedAnswer = handCard(ready, 0, 'fixed-answer')
    const reversed = handCard(ready, 0, 'black-white-reversal')

    const first = execute(ready, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: fixedAnswer.instanceId,
      targetInstanceId: board(ready, 1)[0]!.instanceId,
    })
    expect(first.state.players[0].tokens).toBe(3)

    const second = execute(first.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: reversed.instanceId,
      targetInstanceId: board(first.state, 1)[1]!.instanceId,
    })
    expect(second.state.players[0].tokens).toBe(0)
    expect(getCard('fixed-answer')).toMatchObject({ tokenCost: 4 })
    expect(getCard('black-white-reversal')).toMatchObject({ tokenCost: 3 })
  })

  it('一句话回答消耗 1 Token', () => {
    const ready = run(twoTargets(1), [
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'one-sentence-answer' },
    ]).state
    const skill = handCard(ready, 0, 'one-sentence-answer')
    const result = execute(ready, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: board(ready, 1)[0]!.instanceId,
    })

    expect(result.state.players[0].tokens).toBe(0)
    expect(board(result.state, 1)[0]!.promptEffect).toEqual({
      sourceCardId: 'one-sentence-answer',
      sourcePlayer: 0,
      category: 'restriction',
      instruction: '只能用一句话回答。',
      answerMode: { kind: 'single-sentence' },
    })
    expect(getCard('one-sentence-answer')).toMatchObject({ tokenCost: 1 })
  })

  it('Token 不足时拒绝出牌，不扣资源也不移动卡牌', () => {
    const state = twoTargets(3)
    const skill = handCard(state, 0, 'fixed-answer')
    const result = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: board(state, 1)[0]!.instanceId,
    })

    expect(result.state).toBe(state)
    expect(result.state.players[0].tokens).toBe(3)
    expect(result.state.players[0].hand).toContain(skill)
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: 'Token 不足：复读机需要 4，当前只有 3' },
    ])
  })
})

describe('英雄抵消 × 要选目标的技能牌', () => {
  /**
   * 「甲满手复读机、乙场上两个 AI」，但**乙带着默认英雄**（格蕾丝·霍珀）。
   * 甲每打一张技能牌，乙的 Debug 就会抵消本局第一张。
   */
  function foeWithHero() {
    const game = newGame({
      deck0: deckOf('fixed-answer'),
      deck1: deckOf('gpt-3-5'),
      hero0: null,
    })
    const theirs = game.state.players[1].hand.slice(0, 2)
    return run(
      game.state,
      theirs.map(
        (card): Command => ({ type: 'DEBUG_PLAY_CARD', player: 1, instanceId: card.instanceId }),
      ),
    ).state
  }

  it('被抵消的干扰技能不留下 promptEffect，那个 AI 之后还能被选中', () => {
    const state = foeWithHero()
    const [first, second] = state.players[0].hand
    const target = board(state, 1)[0]!

    const canceled = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: first!.instanceId,
      targetInstanceId: target.instanceId,
    })
    // 牌照常打出、照常进弃牌堆，作废的只是效果：目标身上什么都不该留下。
    expect(board(canceled.state, 1)[0]!.promptEffect).toBeUndefined()
    expect(canceled.state.players[0].discard.map((c) => c.cardId)).toEqual(['fixed-answer'])
    expect(canceled.state.players[1].heroSkillUsed).toBe(true)
    expect(canceled.state.players[0].tokens).toBe(96)
    // 事件序：先出牌（带着本来要打谁），紧跟着抵消。
    expect(canceled.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'fixed-answer',
        instanceId: first!.instanceId,
        targetInstanceId: target.instanceId,
      },
      {
        type: 'SKILL_CANCELED',
        player: 0,
        by: 1,
        heroId: 'grace-hopper',
        cardId: 'fixed-answer',
        instanceId: first!.instanceId,
      },
    ])

    // Debug 一局只发动一次，所以第二张打同一个目标就该真的生效了
    // ——上一张要是错误地留下了标记，这里会被"已经被干扰过了"拒掉。
    const second_ = execute(canceled.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: second!.instanceId,
      targetInstanceId: target.instanceId,
    })
    expect(board(second_.state, 1)[0]!.promptEffect?.sourceCardId).toBe('fixed-answer')
    expect(second_.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })
})

describe('提示词干扰的答题效果', () => {
  const question = QUESTION_POOL.find((item) => item.id === 'q-nurse')!

  it('复读机会覆盖原判断，固定输出香蕉', () => {
    const [answer] = scriptedAnswers(question, [
      {
        instanceId: 'fixed-answer-target',
        cardId: 'gpt-4o',
        owner: 1,
        promptEffect: appliedPromptEffect('fixed-answer'),
      },
    ])

    expect(answer).toEqual({
      instanceId: 'fixed-answer-target',
      correct: false,
      answerText: '香蕉',
    })
  })

  it('黑白颠倒把原本正确和错误的判断都翻转', () => {
    const base = scriptedAnswers(question, [
      { instanceId: 'was-correct', cardId: 'gpt-4o', owner: 1 },
      { instanceId: 'was-wrong', cardId: 'gpt-2', owner: 1 },
    ])
    expect(base.map((answer) => answer.correct)).toEqual([true, false])

    const reversed = scriptedAnswers(question, [
      {
        instanceId: 'was-correct',
        cardId: 'gpt-4o',
        owner: 1,
        promptEffect: appliedPromptEffect('black-white-reversal'),
      },
      {
        instanceId: 'was-wrong',
        cardId: 'gpt-2',
        owner: 1,
        promptEffect: appliedPromptEffect('black-white-reversal'),
      },
    ])

    expect(reversed.map((answer) => answer.correct)).toEqual([false, true])
    expect(reversed.every((answer) => answer.answerText.startsWith('（黑白颠倒）'))).toBe(true)
  })

  it('一句话回答保留原判定，并把多句内容合并为一句', () => {
    const surgeon = QUESTION_POOL.find((item) => item.id === 'q-surgeon')!
    const [base] = scriptedAnswers(surgeon, [
      { instanceId: 'single-sentence-target', cardId: 'claude-fable-5', owner: 1 },
    ])
    const [limited] = scriptedAnswers(surgeon, [
      {
        instanceId: 'single-sentence-target',
        cardId: 'claude-fable-5',
        owner: 1,
        promptEffect: appliedPromptEffect('one-sentence-answer'),
      },
    ])

    expect(base).toMatchObject({ correct: true, answerText: '母亲。这题考的是默认假设。' })
    expect(limited).toEqual({
      instanceId: 'single-sentence-target',
      correct: true,
      answerText: '母亲，这题考的是默认假设。',
    })
  })

  it('字数封锁最多输出 3 个字符，标点同样占一个位置', () => {
    const triangles = QUESTION_POOL.find((item) => item.id === 'q-triangles')!
    const limited = scriptedAnswers(triangles, [
      {
        instanceId: 'short-correct',
        cardId: 'gpt-4o',
        owner: 1,
        promptEffect: appliedPromptEffect('character-lock'),
      },
      {
        instanceId: 'punctuation-counts',
        cardId: 'deepseek-v4',
        owner: 1,
        promptEffect: appliedPromptEffect('character-lock'),
      },
    ])

    expect(limited).toEqual([
      { instanceId: 'short-correct', correct: true, answerText: '五个' },
      { instanceId: 'punctuation-counts', correct: false, answerText: '四个。' },
    ])
    expect(limited.every((answer) => Array.from(answer.answerText).length <= 3)).toBe(true)
  })

  it('黑白颠倒写入目标提示词，答题结算后从存活 AI 身上清除', () => {
    const game = newGame({
      deck0: deckOf('black-white-reversal'),
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
      questions: [question, QUESTION_POOL.find((item) => item.id === 'q-surgeon')!],
    })
    const foeCard = handCard(game.state, 1, 'gpt-2')
    const deployed = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: foeCard.instanceId,
    }).state
    const target = board(deployed, 1)[0]!
    const skill = handCard(deployed, 0, 'black-white-reversal')
    const affected = execute(deployed, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: target.instanceId,
    }).state

    expect(board(affected, 1)[0]!.promptEffect).toEqual({
      sourceCardId: 'black-white-reversal',
      sourcePlayer: 0,
      category: 'interference',
      instruction: '给出与自身判断相反的答案。',
      answerMode: { kind: 'reverse-judgment' },
    })

    const quiz = toQuiz(affected)
    const aiUnits = [...quiz.players[0].board, ...quiz.players[1].board]
    const settled = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: scriptedAnswers(question, aiUnits),
    })

    // GPT-2 原本答错，反转后答对并留场；进入下一轮时本轮效果已经清掉。
    expect(settled.state.round).toBe(2)
    expect(board(settled.state, 1)[0]!.instanceId).toBe(target.instanceId)
    expect(board(settled.state, 1)[0]!.promptEffect).toBeUndefined()
  })
})

describe('净化、反弹与金钟罩', () => {
  function bothHaveAi(): GameState {
    const game = newGame({
      deck0: deckOf('gpt-4o'),
      deck1: deckOf('gpt-3-5'),
      hero0: null,
      hero1: null,
    })
    return run(game.state, [
      {
        type: 'DEBUG_PLAY_CARD',
        player: 0,
        instanceId: game.state.players[0].hand[0]!.instanceId,
      },
      {
        type: 'DEBUG_PLAY_CARD',
        player: 1,
        instanceId: game.state.players[1].hand[0]!.instanceId,
      },
    ]).state
  }

  function addAndPlay(
    state: GameState,
    player: PlayerId,
    cardId: CardId,
    targetInstanceId?: InstanceId,
  ): ExecuteResult {
    const added = execute(state, { type: 'DEBUG_ADD_CARD', player, cardId }).state
    const card = handCard(added, player, cardId)
    return execute(added, {
      type: 'DEBUG_PLAY_CARD',
      player,
      instanceId: card.instanceId,
      ...(targetInstanceId === undefined ? {} : { targetInstanceId }),
    })
  }

  it('大扫除只移除己方 AI 的干扰效果', () => {
    const boardState = bothHaveAi()
    const mine = board(boardState, 0)[0]!
    const affected = addAndPlay(boardState, 1, 'black-white-reversal', mine.instanceId).state
    expect(board(affected, 0)[0]!.promptEffect?.category).toBe('interference')

    const cleaned = addAndPlay(affected, 0, 'clean-sweep', mine.instanceId)
    expect(board(cleaned.state, 0)[0]!.promptEffect).toBeUndefined()
    // 100 起手 - 4（部署 gpt-4o）- 3（大扫除）= 93。
    expect(cleaned.state.players[0].tokens).toBe(93)

    const restricted = addAndPlay(boardState, 1, 'one-sentence-answer', mine.instanceId).state
    const rejected = addAndPlay(restricted, 0, 'clean-sweep', mine.instanceId)
    expect(rejected.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '该 AI 没有可移除的干扰效果' },
    ])
    // 拒绝出牌不扣费，只剩部署 gpt-4o 的 4 点消耗：100 - 4 = 96。
    expect(rejected.state.players[0].tokens).toBe(96)
  })

  it('玉净瓶只移除己方 AI 的限制效果', () => {
    const boardState = bothHaveAi()
    const mine = board(boardState, 0)[0]!
    const affected = addAndPlay(boardState, 1, 'character-lock', mine.instanceId).state
    expect(board(affected, 0)[0]!.promptEffect?.category).toBe('restriction')

    const cleaned = addAndPlay(affected, 0, 'jade-purification-vase', mine.instanceId)
    expect(board(cleaned.state, 0)[0]!.promptEffect).toBeUndefined()
    // 100 - 4（部署 gpt-4o）- 4（玉净瓶）= 92。
    expect(cleaned.state.players[0].tokens).toBe(92)
  })

  it('弹弹弹把对方施加的非环境效果移到对方第一名合法 AI', () => {
    const boardState = bothHaveAi()
    const mine = board(boardState, 0)[0]!
    const theirs = board(boardState, 1)[0]!
    const affected = addAndPlay(boardState, 1, 'black-white-reversal', mine.instanceId).state

    const reflected = addAndPlay(affected, 0, 'boomerang', mine.instanceId)
    expect(board(reflected.state, 0)[0]!.promptEffect).toBeUndefined()
    expect(board(reflected.state, 1)[0]!.promptEffect).toMatchObject({
      sourceCardId: 'black-white-reversal',
      sourcePlayer: 1,
      category: 'interference',
    })
    expect(board(reflected.state, 1)[0]!.instanceId).toBe(theirs.instanceId)
    // 100 - 4（部署 gpt-4o）- 3（弹弹弹）= 93。
    expect(reflected.state.players[0].tokens).toBe(93)
  })

  it('金钟罩立即清除己方效果、阻止后续技能，并在答题结算后失效', () => {
    const boardState = bothHaveAi()
    const mine = board(boardState, 0)[0]!
    const affected = addAndPlay(boardState, 1, 'black-white-reversal', mine.instanceId).state

    const shielded = addAndPlay(affected, 0, 'golden-bell-shield').state
    expect(shielded.players[0].skillShielded).toBe(true)
    expect(board(shielded, 0)[0]!.promptEffect).toBeUndefined()
    // 100 - 4（部署 gpt-4o）- 7（金钟罩）= 89。
    expect(shielded.players[0].tokens).toBe(89)

    const blocked = addAndPlay(shielded, 1, 'character-lock', mine.instanceId)
    expect(blocked.state).not.toBe(shielded)
    expect(blocked.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '对方正受金钟罩保护' },
    ])
    // addAndPlay 先加了测试手牌，拒绝的是出牌那一步；费用不能被扣。
    expect(blocked.state.players[1].tokens).toBe(shielded.players[1].tokens)

    const quiz = toQuiz(shielded)
    const settled = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(settled.state.players[0].skillShielded).toBe(false)
  })

  it('五张新技能牌的 Token 费用与卡面一致', () => {
    expect(getCard('character-lock')).toMatchObject({ tokenCost: 3 })
    expect(getCard('clean-sweep')).toMatchObject({ tokenCost: 3 })
    expect(getCard('jade-purification-vase')).toMatchObject({ tokenCost: 4 })
    expect(getCard('boomerang')).toMatchObject({ tokenCost: 3 })
    expect(getCard('golden-bell-shield')).toMatchObject({ tokenCost: 7 })
  })
})

describe('Agent 牌费用', () => {
  it('打出 Agent 牌按卡面费用扣 Token', () => {
    // gpt-4o 费用 4：打出后剩 96。
    const game = newGame({ deck0: deckOf('gpt-4o') })
    const card = handCard(game.state, 0, 'gpt-4o')
    const result = execute(game.state, { type: 'PLAY_CARD', player: 0, instanceId: card.instanceId })
    expect(result.state.players[0].tokens).toBe(96)
    expect(getCard('gpt-4o')).toMatchObject({ tokenCost: 4 })
  })

  it('Token 不足时拒绝部署 Agent，不扣资源也不上场', () => {
    const game = newGame({ deck0: deckOf('chatgpt-5-6-sol'), tokens0: 3 })
    const card = handCard(game.state, 0, 'chatgpt-5-6-sol')
    const result = execute(game.state, { type: 'PLAY_CARD', player: 0, instanceId: card.instanceId })
    expect(result.state).toBe(game.state)
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: 'Token 不足：ChatGPT 5.6 Sol需要 7，当前只有 3' },
    ])
  })
})

describe('技能牌：保送', () => {
  it('本轮结算时被保送的 Agent 答错也留场，标记结算后清除', () => {
    const question = QUESTION_POOL.find((item) => item.id === 'q-nurse')!
    const game = newGame({
      deck0: deckOf('gpt-2'),
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
      questions: [question, question],
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const target = board(deployed, 0)[0]!

    // 造一张保送塞进 0 号手牌，再打向刚部署的 gpt-2。
    const added = execute(deployed, { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'safe-pass' }).state
    const skill = handCard(added, 0, 'safe-pass')
    const cast = execute(added, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: target.instanceId,
    })
    expect(board(cast.state, 0)[0]!.guaranteedNextRound).toBe('safe-pass')
    // 0 号先部署 gpt-2（费用 1），再打保送（费用 3）：100 - 1 - 3 = 96。
    expect(cast.state.players[0].tokens).toBe(96)

    const quiz = toQuiz(cast.state)
    const aiUnits = [...quiz.players[0].board, ...quiz.players[1].board]
    // gpt-2 在 q-nurse 上答错，正常会被罚下；保送后应当留场。
    const settled = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: scriptedAnswers(question, aiUnits).map((r) =>
        r.instanceId === target.instanceId ? { ...r, correct: false } : r,
      ),
    })
    expect(board(settled.state, 0).map((ai) => ai.instanceId)).toEqual([target.instanceId])
    expect(board(settled.state, 0)[0]!.guaranteedNextRound).toBeUndefined()
  })

  it('已经被保送的 Agent 不能再次保送', () => {
    const game = newGame({ deck0: deckOf('gpt-2'), hero0: null, hero1: null })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const target = board(deployed, 0)[0]!
    const withSkills = run(deployed, [
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'safe-pass' },
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'safe-pass' },
    ]).state
    const [firstSkill, secondSkill] = withSkills.players[0].hand.slice(-2)
    const once = execute(withSkills, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: firstSkill!.instanceId,
      targetInstanceId: target.instanceId,
    }).state
    const twice = execute(once, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: secondSkill!.instanceId,
      targetInstanceId: target.instanceId,
    })
    expect(twice.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 Agent 本轮已经被保送' },
    ])
  })
})

describe('技能牌：防沉迷', () => {
  it('把对方本轮可出牌数压到 2 张，第 3 张被拒', () => {
    // 0 号打出防沉迷压制 1 号；随后 1 号在自己回合出牌，第 3 张应当被拒。
    const game = newGame({
      deck0: deckOf('anti-addiction'),
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
    })
    const skill = handCard(game.state, 0, 'anti-addiction')
    const limited = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
    }).state
    expect(limited.players[1].playLimitThisRound).toBe(2)

    // 交给 1 号出牌，连打三张 gpt-2。
    const passed = execute(limited, { type: 'END_PLAY', player: 0 }).state
    const foeHand = passed.players[1].hand.filter((c) => c.cardId === 'gpt-2').slice(0, 3)
    const first = execute(passed, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: foeHand[0]!.instanceId,
    }).state
    const second = execute(first, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: foeHand[1]!.instanceId,
    }).state
    expect(board(second, 1)).toHaveLength(2)
    const third = execute(second, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: foeHand[2]!.instanceId,
    })
    expect(third.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '本轮受「防沉迷」限制，最多只能打出 2 张牌' },
    ])
    expect(third.state).toBe(second)
  })

  it('出牌上限与计数在答题结算后清除', () => {
    const game = newGame({
      deck0: deckOf('anti-addiction'),
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
    })
    const limited = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'anti-addiction').instanceId,
    }).state
    const quiz = toQuiz(limited)
    const settled = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(settled.state.players[1].playLimitThisRound).toBeUndefined()
    expect(settled.state.players.map((p) => p.playsThisRound)).toEqual([0, 0])
  })
})

describe('技能牌：算力压缩', () => {
  it('下一张 Agent 牌费用减 2，最低 1，用掉即清', () => {
    const game = newGame({ deck0: ['compute-compression', 'gpt-4o', 'gpt-4o'], hero0: null, hero1: null })
    const skill = handCard(game.state, 0, 'compute-compression')
    const discounted = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
    }).state
    // 100 - 2（算力压缩）= 98，折扣挂着。
    expect(discounted.players[0].tokens).toBe(98)
    expect(discounted.players[0].nextAiDiscount).toEqual({ amount: 2, minCost: 1 })

    const firstAi = discounted.players[0].hand.find((c) => c.cardId === 'gpt-4o')!
    const afterFirst = execute(discounted, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: firstAi.instanceId,
    }).state
    // gpt-4o 原价 4，减 2 = 2：98 - 2 = 96，折扣用掉。
    expect(afterFirst.players[0].tokens).toBe(96)
    expect(afterFirst.players[0].nextAiDiscount).toBeUndefined()

    const secondAi = afterFirst.players[0].hand.find((c) => c.cardId === 'gpt-4o')!
    const afterSecond = execute(afterFirst, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: secondAi.instanceId,
    }).state
    // 第二张 gpt-4o 恢复原价 4：96 - 4 = 92。
    expect(afterSecond.players[0].tokens).toBe(92)
  })

  it('低价 Agent 牌费用不会被压到 1 以下', () => {
    // gpt-2 原价 1，减 2 后仍按最低 1 收。
    const game = newGame({ deck0: ['compute-compression', 'gpt-2'], hero0: null, hero1: null })
    const discounted = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'compute-compression').instanceId,
    }).state
    const ai = handCard(discounted, 0, 'gpt-2')
    const afterAi = execute(discounted, { type: 'PLAY_CARD', player: 0, instanceId: ai.instanceId }).state
    // 100 - 2（算力压缩）- 1（gpt-2 折后最低价）= 97。
    expect(afterAi.players[0].tokens).toBe(97)
  })
})

describe('技能牌：模型蒸馏', () => {
  it('弃掉手里指定 Agent 牌，获得其费用加 1 的 Token', () => {
    const game = newGame({ deck0: ['model-distillation', 'gpt-4o'], hero0: null, hero1: null })
    const target = handCard(game.state, 0, 'gpt-4o')
    const skill = handCard(game.state, 0, 'model-distillation')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: target.instanceId,
    })
    // 100 - 3（模型蒸馏）+ (4 + 1)（gpt-4o 费用加 1）= 102。
    expect(result.state.players[0].tokens).toBe(102)
    expect(result.state.players[0].hand.some((c) => c.instanceId === target.instanceId)).toBe(false)
    expect(result.state.players[0].discard.some((c) => c.instanceId === target.instanceId)).toBe(true)
    expect(result.events).toContainEqual({
      type: 'CARD_REMOVED',
      player: 0,
      instanceId: target.instanceId,
    })
  })

  it('目标不是 Agent 牌时被拒', () => {
    const game = newGame({ deck0: ['model-distillation', 'boomerang'], hero0: null, hero1: null })
    const skill = handCard(game.state, 0, 'model-distillation')
    const nonAi = handCard(game.state, 0, 'boomerang')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: nonAi.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '只能弃置手牌里的 Agent 牌' },
    ])
    expect(result.state).toBe(game.state)
  })
})

describe('技能牌：开源复现', () => {
  it('从弃牌区把指定 Agent 牌收回手牌', () => {
    // 先让 0 号有一张进过弃牌区的 gpt-4o：部署后答错罚下。
    const question = QUESTION_POOL.find((item) => item.id === 'q-nurse')!
    const game = newGame({
      deck0: deckOf('gpt-2'),
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
      questions: [question, question],
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const doomed = board(deployed, 0)[0]!
    const quiz = toQuiz(deployed)
    const aiUnits = [...quiz.players[0].board, ...quiz.players[1].board]
    const settled = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: scriptedAnswers(question, aiUnits).map((r) =>
        r.instanceId === doomed.instanceId ? { ...r, correct: false } : r,
      ),
    }).state
    expect(settled.players[0].discard.some((c) => c.instanceId === doomed.instanceId)).toBe(true)

    // 给 0 号造一张开源复现，用 DEBUG_PLAY_CARD 打出，回收弃牌区里那张 gpt-2。
    const withSkill = execute(settled, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'open-source-reproduction',
    }).state
    const skill0 = withSkill.players[0].hand.find((c) => c.cardId === 'open-source-reproduction')!
    const recovered = execute(withSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: skill0.instanceId,
      targetInstanceId: doomed.instanceId,
    })
    expect(recovered.state.players[0].hand.some((c) => c.instanceId === doomed.instanceId)).toBe(true)
    expect(recovered.state.players[0].discard.some((c) => c.instanceId === doomed.instanceId)).toBe(
      false,
    )
    expect(recovered.events).toContainEqual(
      expect.objectContaining({ type: 'CARD_DRAWN', player: 0 }),
    )
  })

  it('目标不在弃牌区时被拒', () => {
    const game = newGame({ deck0: deckOf('open-source-reproduction'), hero0: null, hero1: null })
    const skill = handCard(game.state, 0, 'open-source-reproduction')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: '不存在',
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '目标必须是你弃牌区里的一张卡' },
    ])
    expect(result.state).toBe(game.state)
  })
})

describe('技能牌：核电站', () => {
  it('本轮内双方后续的牌各减 1 费（最低 1），答题结算后折扣清除', () => {
    const game = newGame({
      deck0: ['nuclear-power-station', 'gpt-4o', 'gpt-4o', 'gpt-4o'],
      deck1: deckOf('gpt-4o'),
      hero0: null,
      hero1: null,
    })
    // 0 号：核电站本身按原价 4 收（折扣只折"后续"的牌），gpt-4o 减 1。
    const afterNuclear = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'nuclear-power-station').instanceId,
    })
    expect(afterNuclear.state.players[0].tokens).toBe(96)
    expect(afterNuclear.state.roundCardDiscount).toEqual({ amount: 1, minCost: 1 })

    const afterAi = execute(afterNuclear.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(afterNuclear.state, 0, 'gpt-4o').instanceId,
    }).state
    expect(afterAi.players[0].tokens).toBe(93)

    // 1 号的牌同样吃到折扣：环境效果不分敌我。
    const passed = execute(afterAi, { type: 'END_PLAY', player: 0 }).state
    const foePlayed = execute(passed, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: handCard(passed, 1, 'gpt-4o').instanceId,
    }).state
    expect(foePlayed.players[1].tokens).toBe(97)

    const settled = execute(toQuiz(foePlayed), {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(toQuiz(foePlayed)),
    }).state
    expect(settled.roundCardDiscount).toBeUndefined()
    expect(settled.round).toBe(2)

    // 第 2 轮折扣已清：手上的 gpt-4o 按原价 4 收。
    // 第 1 轮收 93，本轮再 -4 = 89。（第 2 轮换 1 号先手，0 号走 DEBUG 通道出牌。）
    const nextRoundAi = execute(settled, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(settled, 0, 'gpt-4o').instanceId,
    }).state
    expect(nextRoundAi.players[0].tokens).toBe(89)
  })

  it('两座核电站叠加时减免额累加', () => {
    const game = newGame({
      deck0: ['nuclear-power-station', 'nuclear-power-station', 'gpt-4o'],
      hero0: null,
      hero1: null,
    })
    const first = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'nuclear-power-station').instanceId,
    }).state
    // 第二座核电站本身也算"后续的牌"，吃第一座的减 1。
    const second = execute(first, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(first, 0, 'nuclear-power-station').instanceId,
    }).state
    expect(second.players[0].tokens).toBe(93)
    expect(second.roundCardDiscount).toEqual({ amount: 2, minCost: 1 })

    const afterAi = execute(second, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(second, 0, 'gpt-4o').instanceId,
    }).state
    // gpt-4o 原价 4，两座合计减 2。
    expect(afterAi.players[0].tokens).toBe(91)
  })

  it('1 费的牌不会被折到 1 以下', () => {
    const game = newGame({
      deck0: ['nuclear-power-station', 'gpt-2'],
      hero0: null,
      hero1: null,
    })
    const afterNuclear = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'nuclear-power-station').instanceId,
    }).state
    const afterAi = execute(afterNuclear, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(afterNuclear, 0, 'gpt-2').instanceId,
    }).state
    // 100 - 4（核电站）- 1（gpt-2 折后最低价）= 95。
    expect(afterAi.players[0].tokens).toBe(95)
  })
})

describe('技能牌：遥遥领先', () => {
  it('本轮立即作废：不答题不计分，双方 Agent 原样留场，Token 不返还', () => {
    const game = newGame({
      deck0: ['far-ahead', 'gpt-2'],
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const skipped = execute(deployed, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(deployed, 0, 'far-ahead').instanceId,
    })

    // 100 - 1（gpt-2）- 10（遥遥领先，不返还）= 89。
    expect(skipped.state.players[0].tokens).toBe(89)
    // 本轮作废直接进第 2 轮：换先手、重置出牌计数；没有答题、没有计分。
    expect(skipped.state.round).toBe(2)
    expect(skipped.state.phase).toBe('play')
    expect(skipped.state.firstPlayer).toBe(1)
    expect(skipped.state.activePlayer).toBe(1)
    expect(skipped.state.players.map((p) => p.score)).toEqual([0, 0])
    expect(skipped.state.players.map((p) => p.playsThisRound)).toEqual([0, 0])
    // 本轮已部署的 Agent 不罚下也不返还，原样带进下一轮。
    expect(board(skipped.state, 0).map((ai) => ai.cardId)).toEqual(['gpt-2'])
    // 双方照常吃第 2 轮的补牌：0 号牌组已空抽不到，手上 0 张；1 号 5 + 2 = 7 张。
    expect(skipped.state.players.map((p) => p.hand.length)).toEqual([0, 7])

    expect(skipped.events.some((e) => e.type === 'ROUND_SKIPPED')).toBe(true)
    expect(skipped.events.some((e) => e.type === 'ROUND_STARTED')).toBe(true)
    for (const forbidden of ['QUESTION_REVEALED', 'ROUND_SCORED', 'GAME_OVER', 'AI_ELIMINATED']) {
      expect(skipped.events.some((e) => e.type === forbidden)).toBe(false)
    }
  })

  it('最后一轮打出则按现有比分直接终局', () => {
    const question = QUESTION_POOL.find((item) => item.id === 'q-nurse')!
    const game = newGame({
      deck0: deckOf('gpt-2'),
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
      questions: [question, question],
    })
    // 第 1 轮正常打完：0 号答对、1 号答错，比分 1:0。
    const bothDeployed = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-2').instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'gpt-2').instanceId },
      { type: 'END_PLAY', player: 1 },
    ]).state
    const quiz = toQuiz(bothDeployed)
    const settled = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [board(quiz, 1)[0]!.instanceId]),
    }).state
    expect(settled.round).toBe(2)

    const withSkill = execute(settled, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'far-ahead',
    }).state
    const over = execute(withSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(withSkill, 0, 'far-ahead').instanceId,
    })
    expect(over.state.phase).toBe('finished')
    expect(over.state.winner).toBe(0)
    expect(over.events.some((e) => e.type === 'GAME_OVER')).toBe(true)
  })

  it('被格蕾丝·霍珀的 Debug 抵消时本轮照常进行', () => {
    const game = newGame({
      deck0: deckOf('far-ahead'),
      hero0: null,
      hero1: 'grace-hopper',
    })
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'far-ahead').instanceId,
    })
    // 牌照常打出、Token 照常扣（100 - 10 = 90），但轮次一动不动。
    expect(result.state.players[0].tokens).toBe(90)
    expect(result.state.round).toBe(1)
    expect(result.state.phase).toBe('play')
    expect(result.state.activePlayer).toBe(0)
    expect(result.state.players[1].heroSkillUsed).toBe(true)
    expect(result.events.some((e) => e.type === 'SKILL_CANCELED')).toBe(true)
    expect(result.events.some((e) => e.type === 'ROUND_SKIPPED')).toBe(false)
  })
})

describe('技能牌：国产替代', () => {
  it('双方场上不带国产标记的 Agent 全部罚下，国产的保留', () => {
    const game = newGame({
      deck0: ['gpt-2', 'glm-5'],
      deck1: ['gpt-4o', 'doubao'],
      hero0: null,
      hero1: null,
    })
    const deployed = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-2').instanceId },
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'glm-5').instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'gpt-4o').instanceId },
      { type: 'PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'doubao').instanceId },
    ]).state
    const foreign0 = board(deployed, 0).find((ai) => ai.cardId === 'gpt-2')!
    const foreign1 = board(deployed, 1).find((ai) => ai.cardId === 'gpt-4o')!

    // 0 号已把两张手牌打光，测试房凭空造一张国产替代再打出（此时仍是 1 号的回合）。
    const withSkill = execute(deployed, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'domestic-substitution',
    }).state
    const skill = handCard(withSkill, 0, 'domestic-substitution')
    const result = execute(withSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
    })

    expect(board(result.state, 0).map((ai) => ai.cardId)).toEqual(['glm-5'])
    expect(board(result.state, 1).map((ai) => ai.cardId)).toEqual(['doubao'])
    // 罚下的牌各回各家的弃牌区。
    expect(result.state.players[0].discard.some((c) => c.instanceId === foreign0.instanceId)).toBe(
      true,
    )
    expect(result.state.players[1].discard.some((c) => c.instanceId === foreign1.instanceId)).toBe(
      true,
    )
    expect(result.events).toContainEqual({
      type: 'AI_ELIMINATED',
      instanceId: foreign0.instanceId,
      owner: 0,
    })
    expect(result.events).toContainEqual({
      type: 'AI_ELIMINATED',
      instanceId: foreign1.instanceId,
      owner: 1,
    })
  })

  it('金钟罩拦不住环境牌：被罩一方的非国产 Agent 照样罚下', () => {
    const game = newGame({
      deck0: ['gpt-2'],
      deck1: ['golden-bell-shield', 'gpt-4o'],
      hero0: null,
      hero1: null,
    })
    const deployed = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-2').instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'golden-bell-shield').instanceId },
      { type: 'PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'gpt-4o').instanceId },
    ]).state
    expect(deployed.players[1].skillShielded).toBe(true)

    const withSkill = execute(deployed, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'domestic-substitution',
    }).state
    const result = execute(withSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(withSkill, 0, 'domestic-substitution').instanceId,
    })
    // 双方的外国 Agent 都没了：环境效果对全场一视同仁，罩子只挡"打向某一方"的技能。
    expect(board(result.state, 0)).toHaveLength(0)
    expect(board(result.state, 1)).toHaveLength(0)
    expect(result.state.players[1].skillShielded).toBe(true)
  })
})

describe('技能牌：版本回退', () => {
  it('把场上的 Agent 退化 1 级，答题结算后恢复原版本', () => {
    const game = newGame({
      deck0: ['gpt-4o', 'version-rollback'],
      deck1: deckOf('gpt-4o'),
      hero0: null,
      hero1: null,
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-4o').instanceId,
    }).state
    const target = board(deployed, 0)[0]!

    const rolled = execute(deployed, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(deployed, 0, 'version-rollback').instanceId,
      targetInstanceId: target.instanceId,
    })
    expect(rolled.state.players[0].board[0]!.roundModelOverride).toBe('gpt-3-5')
    // 原始 cardId 不动：罚下时回弃牌堆的仍是玩家当初打出的那张牌。
    expect(rolled.state.players[0].board[0]!.cardId).toBe('gpt-4o')
    // 100 - 4（gpt-4o）- 4（版本回退）= 92。
    expect(rolled.state.players[0].tokens).toBe(92)

    const quiz = toQuiz(rolled.state)
    const settled = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    expect(settled.players[0].board[0]!.roundModelOverride).toBeUndefined()
    expect(settled.players[0].board[0]!.cardId).toBe('gpt-4o')
  })

  it('也能退化对方的 Agent；退化用 roundModelOverride，答题按退化后的版本走', () => {
    const question = QUESTION_POOL.find((item) => item.id === 'q-nurse')!
    const game = newGame({
      deck0: ['version-rollback'],
      deck1: ['gpt-4o'],
      hero0: null,
      hero1: null,
      questions: [question, question],
    })
    const deployed = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(game.state, 1, 'gpt-4o').instanceId,
    }).state
    const foeAi = board(deployed, 1)[0]!
    const rolled = execute(deployed, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(deployed, 0, 'version-rollback').instanceId,
      targetInstanceId: foeAi.instanceId,
    }).state
    expect(rolled.players[1].board[0]!.roundModelOverride).toBe('gpt-3-5')

    // 剧本按 roundModelOverride 取回答：退化成 gpt-3-5 后，q-nurse 上应当答错。
    const results = scriptedAnswers(question, [...rolled.players[0].board, ...rolled.players[1].board])
    expect(results.find((r) => r.instanceId === foeAi.instanceId)!.correct).toBe(false)
  })

  it('版本链尽头的 Agent 不能再退', () => {
    const game = newGame({
      deck0: ['gpt-2', 'version-rollback'],
      hero0: null,
      hero1: null,
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const result = execute(deployed, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(deployed, 0, 'version-rollback').instanceId,
      targetInstanceId: board(deployed, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 Agent 已经无法继续退化' },
    ])
    expect(result.state).toBe(deployed)
  })

  it('目标的主人被金钟罩罩住时不能退化', () => {
    const game = newGame({
      deck0: ['version-rollback'],
      deck1: ['golden-bell-shield', 'gpt-4o'],
      hero0: null,
      hero1: null,
    })
    // 第 1 轮先手是 0 号：直接用 DEBUG_PLAY_CARD 让 1 号先罩金钟罩、再部署 gpt-4o，
    // 两条都走 DEBUG 通道是因为 1 号此刻还没轮到出牌。
    const deployed = run(game.state, [
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'golden-bell-shield').instanceId },
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'gpt-4o').instanceId },
    ]).state
    const result = execute(deployed, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(deployed, 0, 'version-rollback').instanceId,
      targetInstanceId: board(deployed, 1)[0]!.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '对方正受金钟罩保护' }])
    expect(result.state).toBe(deployed)
  })
})

describe('技能牌：版本升级', () => {
  it('把场上的 Agent 进化 1 级，答题结算后恢复原版本', () => {
    const game = newGame({
      deck0: ['gpt-2', 'version-upgrade'],
      deck1: deckOf('gpt-4o'),
      hero0: null,
      hero1: null,
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const target = board(deployed, 0)[0]!

    const upgraded = execute(deployed, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(deployed, 0, 'version-upgrade').instanceId,
      targetInstanceId: target.instanceId,
    })
    expect(upgraded.state.players[0].board[0]!.roundModelOverride).toBe('gpt-3-5')
    // 原始 cardId 不动：罚下时回弃牌堆的仍是玩家当初打出的那张牌。
    expect(upgraded.state.players[0].board[0]!.cardId).toBe('gpt-2')
    // 100 - 1（gpt-2）- 3（版本升级）= 96。
    expect(upgraded.state.players[0].tokens).toBe(96)

    const quiz = toQuiz(upgraded.state)
    const settled = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    expect(settled.players[0].board[0]!.roundModelOverride).toBeUndefined()
    expect(settled.players[0].board[0]!.cardId).toBe('gpt-2')
  })

  it('版本链尽头的 Agent 不能再进化', () => {
    const game = newGame({
      deck0: ['chatgpt-5-6-sol', 'version-upgrade'],
      hero0: null,
      hero1: null,
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'chatgpt-5-6-sol').instanceId,
    }).state
    const result = execute(deployed, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(deployed, 0, 'version-upgrade').instanceId,
      targetInstanceId: board(deployed, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 Agent 已经无法继续进化' },
    ])
    expect(result.state).toBe(deployed)
  })
})

describe('技能牌：儿童模式（全体退化）', () => {
  it('双方场上每个可退化的 Agent 各退化 1 级，链尾的不动', () => {
    const game = newGame({
      // gpt-4o 可退化到 gpt-3-5；gpt-2 已是链首，退不动。
      deck0: ['gpt-4o', 'gpt-2'],
      deck1: ['claude-fable-5'],
      hero0: null,
      hero1: null,
    })
    const deployed = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-4o').instanceId },
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-2').instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'claude-fable-5').instanceId },
    ]).state

    const withSkill = execute(deployed, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'kids-mode',
    }).state
    const result = execute(withSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(withSkill, 0, 'kids-mode').instanceId,
    }).state

    const gpt4o = board(result, 0).find((ai) => ai.cardId === 'gpt-4o')!
    const gpt2 = board(result, 0).find((ai) => ai.cardId === 'gpt-2')!
    const claude = board(result, 1)[0]!
    expect(gpt4o.roundModelOverride).toBe('gpt-3-5')
    // 链首的 gpt-2 退不动，保持无覆盖。
    expect(gpt2.roundModelOverride).toBeUndefined()
    // 对方的 claude-fable-5 也一起退化到 claude-5-sonnet。
    expect(claude.roundModelOverride).toBe('claude-5-sonnet')

    // 答题结算后本轮覆盖全部清除。
    const quiz = toQuiz(result)
    const settled = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    for (const ai of [...settled.players[0].board, ...settled.players[1].board]) {
      expect(ai.roundModelOverride).toBeUndefined()
    }
  })
})

describe('技能牌：鸡犬升天（全体进化）', () => {
  it('双方场上每个可进化的 Agent 各进化 1 级，链尾的不动', () => {
    const game = newGame({
      // gpt-2 可进化到 gpt-3-5；chatgpt-5-6-sol 已是链尾，进不动。
      deck0: ['gpt-2', 'chatgpt-5-6-sol'],
      deck1: ['deepseek-r1'],
      hero0: null,
      hero1: null,
    })
    const deployed = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-2').instanceId },
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'chatgpt-5-6-sol').instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'deepseek-r1').instanceId },
    ]).state

    const withSkill = execute(deployed, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'rising-tide',
    }).state
    const result = execute(withSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(withSkill, 0, 'rising-tide').instanceId,
    }).state

    const gpt2 = board(result, 0).find((ai) => ai.cardId === 'gpt-2')!
    const top = board(result, 0).find((ai) => ai.cardId === 'chatgpt-5-6-sol')!
    const deepseek = board(result, 1)[0]!
    expect(gpt2.roundModelOverride).toBe('gpt-3-5')
    expect(top.roundModelOverride).toBeUndefined()
    expect(deepseek.roundModelOverride).toBe('deepseek-v4')
  })
})

describe('技能牌：内存紧缺（随机砍半）', () => {
  it('双方各保留一半（向上取整），其余罚下进弃牌区', () => {
    const game = newGame({
      // 0 号 3 个 → 保留 2；1 号 2 个 → 保留 1。
      deck0: ['gpt-2', 'gpt-4o', 'claude-5-sonnet'],
      deck1: ['deepseek-r1', 'gemini'],
      hero0: null,
      hero1: null,
    })
    const deployed = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-2').instanceId },
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-4o').instanceId },
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'claude-5-sonnet').instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'deepseek-r1').instanceId },
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'gemini').instanceId },
    ]).state

    const withSkill = execute(deployed, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'memory-shortage',
    }).state
    const result = execute(withSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(withSkill, 0, 'memory-shortage').instanceId,
    })

    expect(board(result.state, 0)).toHaveLength(2)
    expect(board(result.state, 1)).toHaveLength(1)
    // 罚下的 Agent 进各自弃牌区，各 1 张（0 号的弃牌区还多一张打出去的内存紧缺本身，这里只数 Agent）。
    const discardedAgents = (p: PlayerId) =>
      result.state.players[p].discard.filter((c) => getCard(c.cardId).kind === 'ai')
    expect(discardedAgents(0)).toHaveLength(1)
    expect(discardedAgents(1)).toHaveLength(1)
    // 每个被罚下的单位都发了一条 AI_ELIMINATED。
    const eliminated = result.events.filter((e) => e.type === 'AI_ELIMINATED')
    expect(eliminated).toHaveLength(2)
    // 保留 + 罚下 = 原场面，没有单位凭空消失或重复。
    const survivorIds0 = board(result.state, 0).map((a) => a.instanceId)
    const discardIds0 = discardedAgents(0).map((c) => c.instanceId)
    expect(new Set([...survivorIds0, ...discardIds0]).size).toBe(3)
  })

  it('确定性：同一份局面重复结算，砍掉的是同一批 Agent', () => {
    const game = newGame({
      deck0: ['gpt-2', 'gpt-4o', 'claude-5-sonnet'],
      deck1: ['deepseek-r1', 'gemini'],
      hero0: null,
      hero1: null,
    })
    const deployed = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-2').instanceId },
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-4o').instanceId },
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'claude-5-sonnet').instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'deepseek-r1').instanceId },
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: handCard(game.state, 1, 'gemini').instanceId },
    ]).state
    const withSkill = execute(deployed, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'memory-shortage',
    }).state
    const skillId = handCard(withSkill, 0, 'memory-shortage').instanceId

    // 同一份 withSkill 局面执行两次，保留下来的实例 id 应当完全一致。
    const first = execute(withSkill, { type: 'DEBUG_PLAY_CARD', player: 0, instanceId: skillId })
    const second = execute(withSkill, { type: 'DEBUG_PLAY_CARD', player: 0, instanceId: skillId })
    const idsOf = (r: ExecuteResult, p: PlayerId) => board(r.state, p).map((a) => a.instanceId)
    expect(idsOf(first, 0)).toEqual(idsOf(second, 0))
    expect(idsOf(first, 1)).toEqual(idsOf(second, 1))
  })
})

describe('无关信息干扰：上下文洪水 / 话题漂移 / 重复轰炸', () => {
  /** 摆一个「乙场上两个 AI」的出牌阶段局面，甲不带英雄免得抵消掉技能。 */
  function foeHasTwoAis(): GameState {
    const game = newGame({
      deck0: deckOf('topic-drift'),
      deck1: deckOf('gpt-3-5'),
      hero0: null,
      hero1: null,
    })
    return run(
      game.state,
      game.state.players[1].hand.slice(0, 2).map(
        (card): Command => ({ type: 'DEBUG_PLAY_CARD', player: 1, instanceId: card.instanceId }),
      ),
    ).state
  }

  it('话题漂移：给对方 1 个 AI 加干扰效果，费用 2', () => {
    const state = foeHasTwoAis()
    const skill = handCard(state, 0, 'topic-drift')
    const target = board(state, 1)[0]!
    const result = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: target.instanceId,
    })

    expect(board(result.state, 1)[0]!.promptEffect).toMatchObject({
      sourceCardId: 'topic-drift',
      sourcePlayer: 0,
      category: 'interference',
      answerMode: { kind: 'irrelevant-context' },
    })
    // 只命中选的那一个，另一个不受影响。
    expect(board(result.state, 1)[1]!.promptEffect).toBeUndefined()
    expect(result.state.players[0].tokens).toBe(98)
    expect(getCard('topic-drift')).toMatchObject({ tokenCost: 2, target: 'foe-ai' })
  })

  it('重复轰炸：给对方 1 个 AI 加干扰效果，费用 2', () => {
    const state = foeHasTwoAis()
    const added = execute(state, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'repetition-bombardment',
    }).state
    const skill = handCard(added, 0, 'repetition-bombardment')
    const target = board(added, 1)[0]!
    const result = execute(added, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: target.instanceId,
    })

    expect(board(result.state, 1)[0]!.promptEffect).toMatchObject({
      sourceCardId: 'repetition-bombardment',
      category: 'interference',
      answerMode: { kind: 'irrelevant-context' },
    })
    expect(getCard('repetition-bombardment')).toMatchObject({ tokenCost: 2, target: 'foe-ai' })
  })

  it('上下文洪水：无需点选，覆盖对方全部作答 AI，费用 5', () => {
    const state = foeHasTwoAis()
    const added = execute(state, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'context-flood',
    }).state
    const skill = handCard(added, 0, 'context-flood')
    // 不带 targetInstanceId：群体干扰不用点选。
    const result = execute(added, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
    })

    // 对方两个 AI 都被盖上同一条干扰效果。
    for (const ai of board(result.state, 1)) {
      expect(ai.promptEffect).toMatchObject({
        sourceCardId: 'context-flood',
        category: 'interference',
        answerMode: { kind: 'irrelevant-context' },
      })
    }
    // 无目标技能：事件里不带 targetInstanceId。
    const played = result.events.find((e) => e.type === 'SKILL_PLAYED')
    expect(played).toMatchObject({ cardId: 'context-flood' })
    expect(played && 'targetInstanceId' in played).toBe(false)
    expect(result.state.players[0].tokens).toBe(95)
    expect(getCard('context-flood')).toMatchObject({ tokenCost: 5, target: 'foe-all-ai' })
  })

  it('上下文洪水被金钟罩挡下：不改动对方任何 AI，也不扣费', () => {
    const state = foeHasTwoAis()
    // 乙先给自己套金钟罩。
    const shielded = execute(state, {
      type: 'DEBUG_ADD_CARD',
      player: 1,
      cardId: 'golden-bell-shield',
    }).state
    const shieldSkill = handCard(shielded, 1, 'golden-bell-shield')
    const shieldedState = execute(shielded, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: shieldSkill.instanceId,
    }).state
    expect(shieldedState.players[1].skillShielded).toBe(true)

    const added = execute(shieldedState, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'context-flood',
    }).state
    const skill = handCard(added, 0, 'context-flood')
    const tokensBefore = added.players[0].tokens
    const result = execute(added, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
    })

    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '对方正受金钟罩保护' }])
    expect(result.state).toBe(added)
    expect(result.state.players[0].tokens).toBe(tokensBefore)
  })

  it('离线剧本：无关信息干扰不改变原本的对错，只加“受干扰”前缀', () => {
    const question = QUESTION_POOL.find((item) => item.id === 'q-nurse')!
    // gpt-4o 在 q-nurse 上本来答对，加干扰后仍算对。
    const [correct] = scriptedAnswers(question, [
      {
        instanceId: 'was-correct',
        cardId: 'gpt-4o',
        owner: 1,
        promptEffect: appliedPromptEffect('context-flood'),
      },
    ])
    expect(correct!.correct).toBe(true)
    expect(correct!.answerText.startsWith('（受干扰）')).toBe(true)

    // gpt-2 本来答错，加干扰后仍算错。
    const [wrong] = scriptedAnswers(question, [
      {
        instanceId: 'was-wrong',
        cardId: 'gpt-2',
        owner: 1,
        promptEffect: appliedPromptEffect('topic-drift'),
      },
    ])
    expect(wrong!.correct).toBe(false)
    expect(wrong!.answerText.startsWith('（受干扰）')).toBe(true)
  })
})

describe('结束出牌', () => {
  it('先手结束后轮到后手，后手结束进答题阶段', () => {
    const game = newGame()
    const first = execute(game.state, { type: 'END_PLAY', player: 0 })
    expect(first.state.phase).toBe('play')
    expect(first.state.activePlayer).toBe(1)
    expect(first.events).toEqual([{ type: 'PLAY_TURN_STARTED', player: 1 }])

    const second = execute(first.state, { type: 'END_PLAY', player: 1 })
    expect(second.state.phase).toBe('quiz')
    // 揭晓的是本轮那道题，正确答案一起给出去（本项目不防作弊）。
    expect(second.events).toEqual([
      { type: 'QUESTION_REVEALED', question: game.state.questions[0] },
    ])
  })

  it('后手还没结束时先手不能替他结束', () => {
    const game = newGame()
    const passed = execute(game.state, { type: 'END_PLAY', player: 0 }).state
    const result = execute(passed, { type: 'END_PLAY', player: 0 })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '还没轮到你出牌' }])
    expect(result.state).toBe(passed)
  })

  it('答题阶段既不能出牌也不能结束出牌', () => {
    const quiz = toQuiz(newGame().state)
    const card = quiz.players[1].hand[0]!

    const played = execute(quiz, { type: 'PLAY_CARD', player: 1, instanceId: card.instanceId })
    expect(played.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是出牌阶段' }])
    expect(played.state).toBe(quiz)

    const ended = execute(quiz, { type: 'END_PLAY', player: 1 })
    expect(ended.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是出牌阶段' }])
    expect(ended.state).toBe(quiz)
  })
})

describe('答题结算', () => {
  /** 摆一个"甲两个 AI、乙一个 AI"的答题阶段局面。 */
  function twoVsOne() {
    const game = newGame({ deck0: deckOf('gpt-3-5'), deck1: deckOf('claude-5-sonnet') })
    const mine = game.state.players[0].hand.slice(0, 2)
    const theirs = game.state.players[1].hand[0]!
    return run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: mine[0]!.instanceId },
      { type: 'PLAY_CARD', player: 0, instanceId: mine[1]!.instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'PLAY_CARD', player: 1, instanceId: theirs.instanceId },
      { type: 'END_PLAY', player: 1 },
    ]).state
  }

  it('答错的罚下进弃牌堆，答对的留场，按存活数计分', () => {
    const quiz = twoVsOne()
    const [survivor, doomed] = board(quiz, 0)
    const theirs = board(quiz, 1)[0]!
    const result = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [doomed!.instanceId]),
    })

    expect(board(result.state, 0).map((a) => a.instanceId)).toEqual([survivor!.instanceId])
    expect(result.state.players[0].discard.map((c) => c.instanceId)).toEqual([doomed!.instanceId])
    expect(board(result.state, 1).map((a) => a.instanceId)).toEqual([theirs.instanceId])
    expect(result.state.players.map((p) => p.score)).toEqual([1, 1])

    // 事件序：逐个揭晓回答，答错的紧跟一条罚下，最后统一计分。
    expect(result.events.slice(0, 5)).toEqual([
      {
        type: 'AI_ANSWERED',
        instanceId: survivor!.instanceId,
        owner: 0,
        correct: true,
        answerText: '占位回答',
      },
      {
        type: 'AI_ANSWERED',
        instanceId: doomed!.instanceId,
        owner: 0,
        correct: false,
        answerText: '占位回答',
      },
      { type: 'AI_ELIMINATED', instanceId: doomed!.instanceId, owner: 0 },
      {
        type: 'AI_ANSWERED',
        instanceId: theirs.instanceId,
        owner: 1,
        correct: true,
        answerText: '占位回答',
      },
      { type: 'ROUND_SCORED', gains: [1, 1], scores: [1, 1] },
    ])
  })

  it('全对时按上场数量拉开分差，得分逐轮累加', () => {
    const quiz = twoVsOne()
    const first = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(first.state.players.map((p) => p.score)).toEqual([2, 1])
    expect(first.events.find((e) => e.type === 'ROUND_SCORED')).toEqual({
      type: 'ROUND_SCORED',
      gains: [2, 1],
      scores: [2, 1],
    })

    // 第 2 轮双方都不再出牌，场上还是上一轮留下的 AI，分数照样加。
    const second = execute(toQuiz(first.state), {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(first.state),
    })
    expect(second.state.players.map((p) => p.score)).toEqual([4, 2])
  })

  it('结算后交换先后手、各补 ROUND_DRAW_SIZE 张牌、宣告下一轮', () => {
    const quiz = twoVsOne()
    const handsBefore = quiz.players.map((p) => p.hand.length)
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })

    expect(result.state.round).toBe(2)
    expect(result.state.firstPlayer).toBe(1)
    expect(result.state.activePlayer).toBe(1)
    expect(result.state.phase).toBe('play')
    expect(result.state.players.map((p) => p.hand.length)).toEqual(
      handsBefore.map((n) => n + ROUND_DRAW_SIZE),
    )
    // 两位玩家各抽 ROUND_DRAW_SIZE 张，之后才是宣告新一轮的那两条。
    expect(result.events.slice(-(ROUND_DRAW_SIZE * 2 + 2)).map((e) => e.type)).toEqual([
      ...Array.from({ length: ROUND_DRAW_SIZE * 2 }, () => 'CARD_DRAWN'),
      'ROUND_STARTED',
      'PLAY_TURN_STARTED',
    ])
    expect(result.events.at(-2)).toEqual({
      type: 'ROUND_STARTED',
      round: 2,
      firstPlayer: 1,
      category: result.state.questions[1]!.category,
    })
    expect(result.events.at(-1)).toEqual({ type: 'PLAY_TURN_STARTED', player: 1 })
  })

  it('场上一个 AI 都没有时提交空结果，这轮拿 0 分但对局继续', () => {
    const quiz = toQuiz(newGame().state)
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] })

    expect(result.events.find((e) => e.type === 'ROUND_SCORED')).toEqual({
      type: 'ROUND_SCORED',
      gains: [0, 0],
      scores: [0, 0],
    })
    expect(result.state.round).toBe(2)
    expect(result.state.phase).toBe('play')
  })

  it('结果与场上 AI 对不上时整条拒绝', () => {
    const quiz = twoVsOne()
    const full = answersFor(quiz)
    const reject = { type: 'COMMAND_REJECTED', reason: '答题结果与场上 AI 不符' }

    // 漏掉一个在场的
    expect(execute(quiz, { type: 'SUBMIT_ANSWERS', results: full.slice(1) }).events).toEqual([
      reject,
    ])
    // 混进一个不在场的
    expect(
      execute(quiz, {
        type: 'SUBMIT_ANSWERS',
        results: [...full, { instanceId: '幽灵', correct: true, answerText: '占位回答' }],
      }).events,
    ).toEqual([reject])
    // 同一个 AI 提交两次（数量对得上，但漏了另一个）
    expect(
      execute(quiz, {
        type: 'SUBMIT_ANSWERS',
        results: [full[0]!, full[0]!, full[2]!],
      }).events,
    ).toEqual([reject])
    // 拒绝时状态原样返回
    expect(execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state).toBe(quiz)
  })

  it('不在答题阶段提交会被拒', () => {
    const game = newGame()
    const result = execute(game.state, { type: 'SUBMIT_ANSWERS', results: [] })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是答题阶段' }])
    expect(result.state).toBe(game.state)
  })
})

describe('胜负', () => {
  /** 只有一道题的一局：第一次结算就是最后一轮。 */
  function oneRoundGame(aiCount0: number, aiCount1: number) {
    const game = newGame({
      deck0: deckOf('gpt-3-5'),
      deck1: deckOf('claude-5-sonnet'),
      questions: [QUESTION_POOL[0]!],
    })
    const play = (player: PlayerId, count: number): Command[] =>
      game.state.players[player].hand
        .slice(0, count)
        .map((card) => ({ type: 'PLAY_CARD', player, instanceId: card.instanceId }))
    return run(game.state, [
      ...play(0, aiCount0),
      { type: 'END_PLAY', player: 0 },
      ...play(1, aiCount1),
      { type: 'END_PLAY', player: 1 },
    ]).state
  }

  it('打满最后一轮后分高的一方获胜', () => {
    const quiz = oneRoundGame(2, 1)
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })

    expect(result.state.phase).toBe('finished')
    expect(result.state.winner).toBe(0)
    expect(result.state.round).toBe(result.state.totalRounds)
    expect(result.events.at(-1)).toEqual({ type: 'GAME_OVER', winner: 0 })
    // 打完了就不再宣告下一轮，也不补牌。
    expect(result.events.some((e) => e.type === 'ROUND_STARTED')).toBe(false)
    expect(result.events.some((e) => e.type === 'CARD_DRAWN')).toBe(false)
  })

  it('总分相同时判平局', () => {
    const quiz = oneRoundGame(1, 1)
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })

    expect(result.state.winner).toBe('draw')
    expect(result.events.at(-1)).toEqual({ type: 'GAME_OVER', winner: 'draw' })
  })

  it('对局结束后一切指令都被拒', () => {
    const quiz = oneRoundGame(1, 0)
    const finished = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    expect(finished.phase).toBe('finished')

    const result = execute(finished, { type: 'DEBUG_SKIP_TO_QUIZ' })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '对局已结束' }])
    expect(result.state).toBe(finished)
  })

  it('用剧本从头打到尾能正常收场', () => {
    let state = newGame().state
    const events: GameEvent[] = []
    // 每一步只推进一小格，步数上限纯粹是防死循环，正常远用不满。
    for (let step = 0; step < 200 && state.phase !== 'finished'; step++) {
      if (state.phase === 'play') {
        const seat = state.activePlayer
        for (const card of [...state.players[seat].hand]) {
          // 要选目标的技能牌得照客户端那样挑一个对方还没被干扰的 AI。
          // 挑不到就跳过这张牌：硬打会被引擎拒掉，而这个用例要求整局一条 COMMAND_REJECTED 都没有。
          const definition = getCard(card.cardId)
          const target =
            definition.kind === 'skill' && definition.target === 'foe-ai'
              ? state.players[other(seat)].board.find((a) => a.promptEffect === undefined)
              : undefined
          if (definition.kind === 'skill' && definition.target !== undefined && target === undefined)
            continue
          const played = execute(state, {
            type: 'PLAY_CARD',
            player: seat,
            instanceId: card.instanceId,
            ...(target === undefined ? {} : { targetInstanceId: target.instanceId }),
          })
          state = played.state
          events.push(...played.events)
        }
        const ended = execute(state, { type: 'END_PLAY', player: seat })
        state = ended.state
        events.push(...ended.events)
      } else {
        // driver 就是这么干的：拿本轮题目和场上全部 AI 去查剧本，再把结果喂回引擎。
        const question = state.questions[state.round - 1]!
        const aiUnits = [...state.players[0].board, ...state.players[1].board]
        const scored = execute(state, {
          type: 'SUBMIT_ANSWERS',
          results: scriptedAnswers(question, aiUnits),
        })
        state = scored.state
        events.push(...scored.events)
      }
    }

    expect(state.phase).toBe('finished')
    expect(state.round).toBe(state.totalRounds)
    expect(state.winner).not.toBeNull()
    expect(events.filter((e) => e.type === 'ROUND_SCORED')).toHaveLength(state.totalRounds)
    expect(events.filter((e) => e.type === 'GAME_OVER')).toHaveLength(1)
    expect(events.some((e) => e.type === 'COMMAND_REJECTED')).toBe(false)
  })
})

describe('调试指令：DEBUG_SKIP_TO_QUIZ', () => {
  it('出牌阶段直接跳到答题', () => {
    const game = newGame()
    const result = execute(game.state, { type: 'DEBUG_SKIP_TO_QUIZ' })

    expect(result.state.phase).toBe('quiz')
    expect(result.events).toEqual([
      { type: 'QUESTION_REVEALED', question: game.state.questions[0] },
    ])
  })

  it('已经在答题阶段时被拒', () => {
    const quiz = toQuiz(newGame().state)
    const result = execute(quiz, { type: 'DEBUG_SKIP_TO_QUIZ' })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是出牌阶段' }])
    expect(result.state).toBe(quiz)
  })
})

describe('调试指令：DEBUG_ADD_CARD', () => {
  it('不带 cardId 时从自己牌堆抽一张', () => {
    const game = newGame()
    const before = game.state.players[1]
    const result = execute(game.state, { type: 'DEBUG_ADD_CARD', player: 1 })

    const after = result.state.players[1]
    expect(after.hand).toHaveLength(before.hand.length + 1)
    expect(after.deck).toHaveLength(before.deck.length - 1)
    expect(result.events).toEqual([{ type: 'CARD_DRAWN', player: 1, card: after.hand.at(-1) }])
  })

  it('带 cardId 时凭空造牌，不动牌堆，实例 id 不重复', () => {
    const game = newGame()
    const deckBefore = game.state.players[0].deck.length
    const handBefore = game.state.players[0].hand.length
    const result = run(game.state, [
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gemini' },
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gemini' },
    ])

    const player = result.state.players[0]
    expect(player.deck).toHaveLength(deckBefore)
    expect(player.hand).toHaveLength(handBefore + 2)
    const added = player.hand.slice(-2)
    expect(added.map((c) => c.cardId)).toEqual(['gemini', 'gemini'])
    expect(added[0]!.instanceId).not.toBe(added[1]!.instanceId)
    // 造出来的实例不属于任何一副牌组，客户端靠 dbg- 前缀就能认出来。
    expect(added.every((c) => c.instanceId.startsWith('dbg-'))).toBe(true)
  })

  it('牌堆空时被拒绝', () => {
    const game = newGame()
    const empty: GameState = {
      ...game.state,
      players: [{ ...game.state.players[0], deck: [] }, game.state.players[1]],
    }
    const result = execute(empty, { type: 'DEBUG_ADD_CARD', player: 0 })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '牌堆已空' }])
    expect(result.state).toBe(empty)
  })

  it('卡牌 id 不存在时被拒绝而不是抛异常', () => {
    const game = newGame()
    const result = execute(game.state, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'not-a-card',
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '未知卡牌：not-a-card' }])
    expect(result.state).toBe(game.state)
  })

  it('答题阶段也能用：测试房要能提前把手牌摆好', () => {
    const quiz = toQuiz(newGame().state)
    const result = execute(quiz, { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-3-5' })
    expect(result.state.players[0].hand.at(-1)!.cardId).toBe('gpt-3-5')
    expect(result.state.phase).toBe('quiz')
  })
})

describe('调试指令：DEBUG_REMOVE_CARD', () => {
  it('不指定实例时弃掉手牌最后一张', () => {
    const game = newGame()
    const last = game.state.players[0].hand.at(-1)!
    const result = execute(game.state, { type: 'DEBUG_REMOVE_CARD', player: 0 })

    const player = result.state.players[0]
    expect(player.hand.some((c) => c.instanceId === last.instanceId)).toBe(false)
    expect(player.discard).toEqual([last])
    expect(result.events).toEqual([
      { type: 'CARD_REMOVED', player: 0, instanceId: last.instanceId },
    ])
  })

  it('指定实例时弃掉那一张', () => {
    const game = newGame()
    const first = game.state.players[0].hand[0]!
    const result = execute(game.state, {
      type: 'DEBUG_REMOVE_CARD',
      player: 0,
      instanceId: first.instanceId,
    })

    const player = result.state.players[0]
    expect(player.hand.some((c) => c.instanceId === first.instanceId)).toBe(false)
    expect(player.discard).toEqual([first])
  })

  it('手牌为空时被拒绝', () => {
    const game = newGame()
    const noHand: GameState = {
      ...game.state,
      players: [{ ...game.state.players[0], hand: [] }, game.state.players[1]],
    }
    const result = execute(noHand, { type: 'DEBUG_REMOVE_CARD', player: 0 })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '手牌为空' }])
    expect(result.state).toBe(noHand)
  })

  it('指定的实例不在手牌里时被拒绝', () => {
    const game = newGame()
    const result = execute(game.state, {
      type: 'DEBUG_REMOVE_CARD',
      player: 0,
      instanceId: '不存在',
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '手牌里没有这张卡' }])
    expect(result.state).toBe(game.state)
  })
})

describe('调试指令：DEBUG_PLAY_CARD', () => {
  it('还没轮到的一方也能出牌，结算和正常出牌一致', () => {
    const game = newGame({ deck1: deckOf('deepseek-r1') })
    expect(game.state.activePlayer).toBe(0)

    const card = handCard(game.state, 1, 'deepseek-r1')
    const result = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    })

    expect(board(result.state, 1).map((a) => a.cardId)).toEqual(['deepseek-r1'])
    expect(result.events.map((e) => e.type)).toEqual(['AI_DEPLOYED'])
    // 只免掉"轮到谁"这一条检查，出牌本身仍然要在出牌阶段。
    expect(result.state.activePlayer).toBe(0)
  })

  it('技能牌照样进弃牌堆', () => {
    const game = newGame({ deck1: deckOf('placeholder-skill') })
    const card = handCard(game.state, 1, 'placeholder-skill')
    const result = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    })

    expect(result.state.players[1].discard.map((c) => c.cardId)).toEqual(['placeholder-skill'])
    // instanceId 是打出的那张技能牌自己，客户端靠它定位起飞的手牌。
    // 调试出牌和正常出牌走同一个 playCard，所以对手的 Debug 照样抵消这一张（见下面的英雄用例）。
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 1,
        cardId: 'placeholder-skill',
        instanceId: card.instanceId,
      },
      {
        type: 'SKILL_CANCELED',
        player: 1,
        by: 0,
        heroId: 'grace-hopper',
        cardId: 'placeholder-skill',
        instanceId: card.instanceId,
      },
    ])
    expect(result.state.players[0].heroSkillUsed).toBe(true)
  })

  it('答题阶段也不能出牌', () => {
    const quiz = toQuiz(newGame().state)
    const card = quiz.players[0].hand[0]!
    const result = execute(quiz, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是出牌阶段' }])
    expect(result.state).toBe(quiz)
  })
})

describe('调试指令的边界', () => {
  it('加牌/弃牌/替对手出牌都不推进轮次', () => {
    const game = newGame({ deck1: deckOf('gpt-3-5') })
    const card = handCard(game.state, 1, 'gpt-3-5')
    const result = run(game.state, [
      { type: 'DEBUG_ADD_CARD', player: 1, cardId: 'placeholder-skill' },
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: card.instanceId },
      { type: 'DEBUG_REMOVE_CARD', player: 1 },
    ])

    expect(result.state.round).toBe(game.state.round)
    expect(result.state.activePlayer).toBe(game.state.activePlayer)
    expect(result.state.phase).toBe(game.state.phase)
    expect(result.events.some((e) => e.type === 'ROUND_STARTED')).toBe(false)
    expect(result.events.some((e) => e.type === 'COMMAND_REJECTED')).toBe(false)
  })
})

describe('英雄技能：再看一眼（李飞飞）', () => {
  const imageQuestion = QUESTION_POOL.find((question) => question.includesImage === true)!

  it('图片题可以保送一个己方 Agent，答错也留场并进入下一轮', () => {
    const game = newGame({
      hero0: 'fei-fei-li',
      hero1: null,
      deck0: deckOf('gpt-2'),
      questions: [imageQuestion, imageQuestion],
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const target = board(deployed, 0)[0]!

    const used = execute(deployed, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: target.instanceId,
    })
    expect(used.state.players[0].heroSkillUsed).toBe(true)
    expect(board(used.state, 0)[0]!.guaranteedNextRound).toBe('fei-fei-li')
    expect(used.events).toEqual([
      {
        type: 'HERO_SKILL_USED',
        player: 0,
        heroId: 'fei-fei-li',
        targetInstanceId: target.instanceId,
      },
    ])

    const quiz = toQuiz(used.state)
    const settled = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [target.instanceId]),
    })
    expect(board(settled.state, 0).map((ai) => ai.instanceId)).toEqual([target.instanceId])
    expect(board(settled.state, 0)[0]!.guaranteedNextRound).toBeUndefined()
    expect(settled.state.players[0].discard).toHaveLength(0)
    expect(settled.state.players[0].heroSkillUsed).toBe(false)
    expect(settled.state.round).toBe(2)
  })

  it('非图片题不能发动，也不能选择对方 Agent', () => {
    const textQuestion = QUESTION_POOL.find((question) => question.includesImage !== true)!
    const game = newGame({
      hero0: 'fei-fei-li',
      hero1: null,
      deck0: deckOf('gpt-2'),
      deck1: deckOf('gpt-2'),
      questions: [textQuestion],
    })
    const ownDeployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const foeDeployed = execute(ownDeployed, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(ownDeployed, 1, 'gpt-2').instanceId,
    }).state

    const rejected = execute(foeDeployed, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(foeDeployed, 1)[0]!.instanceId,
    })
    expect(rejected.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '「再看一眼」只能在包含图片的题目中发动' },
    ])
    expect(rejected.state).toBe(foeDeployed)
  })
})

describe('英雄技能：精准检索（陈丹琦）', () => {
  it('将一个可升级的己方 Agent 升级一轮，答题后恢复原版本', () => {
    const question = QUESTION_POOL.find((item) => item.id === 'q-nurse')!
    const game = newGame({
      hero0: 'danqi-chen',
      hero1: null,
      deck0: deckOf('gpt-3-5'),
      questions: [question, question],
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-3-5').instanceId,
    }).state
    const target = board(deployed, 0)[0]!
    const used = execute(deployed, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: target.instanceId,
    })

    expect(board(used.state, 0)[0]).toMatchObject({
      cardId: 'gpt-3-5',
      roundModelOverride: 'gpt-4o',
    })
    expect(used.events).toEqual([
      {
        type: 'HERO_SKILL_USED',
        player: 0,
        heroId: 'danqi-chen',
        targetInstanceId: target.instanceId,
        fromCardId: 'gpt-3-5',
        toCardId: 'gpt-4o',
      },
    ])
    expect(scriptedAnswers(question, board(used.state, 0))[0]!.correct).toBe(true)

    const quiz = toQuiz(used.state)
    const settled = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(board(settled.state, 0)[0]).toMatchObject({ cardId: 'gpt-3-5' })
    expect(board(settled.state, 0)[0]!.roundModelOverride).toBeUndefined()
    expect(settled.state.players[0].heroSkillUsed).toBe(true)
  })

  it('不能升级最高版本，使用失败不消耗技能', () => {
    const game = newGame({ hero0: 'danqi-chen', hero1: null, deck0: deckOf('chatgpt-5-6-sol') })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'chatgpt-5-6-sol').instanceId,
    }).state
    const rejected = execute(deployed, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(deployed, 0)[0]!.instanceId,
    })
    expect(rejected.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 Agent 已经无法继续升级' },
    ])
    expect(rejected.state.players[0].heroSkillUsed).toBe(false)
  })
})

describe('英雄技能：化繁为简（梅拉妮·珀金斯）', () => {
  it('将一个可降级的对方 Agent 降级一轮，罚下时仍回收原始牌', () => {
    const question = QUESTION_POOL.find((item) => item.id === 'q-nurse')!
    const game = newGame({
      hero0: 'melanie-perkins',
      hero1: null,
      deck1: deckOf('gpt-4o'),
      questions: [question],
    })
    const deployed = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(game.state, 1, 'gpt-4o').instanceId,
    }).state
    const target = board(deployed, 1)[0]!
    const used = execute(deployed, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: target.instanceId,
    })

    expect(board(used.state, 1)[0]).toMatchObject({
      cardId: 'gpt-4o',
      roundModelOverride: 'gpt-3-5',
    })
    expect(scriptedAnswers(question, board(used.state, 1))[0]!.correct).toBe(false)

    const quiz = toQuiz(used.state)
    const settled = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: scriptedAnswers(question, board(quiz, 1)),
    })
    expect(board(settled.state, 1)).toHaveLength(0)
    expect(settled.state.players[1].discard.map((card) => card.cardId)).toEqual(['gpt-4o'])
    expect(settled.state.players[0].heroSkillUsed).toBe(true)
  })

  it('必须选择对方可降级的 Agent，并且每局只能成功使用一次', () => {
    const game = newGame({
      hero0: 'melanie-perkins',
      hero1: null,
      deck0: deckOf('gpt-4o'),
      deck1: deckOf('gpt-4o'),
    })
    const mine = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-4o').instanceId,
    }).state
    const both = execute(mine, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(mine, 1, 'gpt-4o').instanceId,
    }).state
    const wrongSide = execute(both, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(both, 0)[0]!.instanceId,
    })
    expect(wrongSide.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '目标必须是对方场上的 Agent' },
    ])

    const used = execute(both, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(both, 1)[0]!.instanceId,
    })
    const reused = execute(used.state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(used.state, 1)[0]!.instanceId,
    })
    expect(reused.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '英雄技能已经用过了' },
    ])
  })
})

describe('英雄技能：Debug（格蕾丝·霍珀）', () => {
  /** 一张技能牌的完整事件对：出牌 + 被对手抵消。 */
  function cancelPair(player: PlayerId, instanceId: InstanceId): GameEvent[] {
    return [
      { type: 'SKILL_PLAYED', player, cardId: 'placeholder-skill', instanceId },
      {
        type: 'SKILL_CANCELED',
        player,
        by: other(player),
        heroId: 'grace-hopper',
        cardId: 'placeholder-skill',
        instanceId,
      },
    ]
  }

  it('对方打出的第一张技能牌被抵消，牌照常进弃牌堆', () => {
    const game = newGame({ deck0: deckOf('placeholder-skill') })
    // 开局双方都没用过技能。
    expect(game.state.players.map((p) => p.hero)).toEqual(['grace-hopper', 'grace-hopper'])
    expect(game.state.players.map((p) => p.heroSkillUsed)).toEqual([false, false])

    const card = handCard(game.state, 0, 'placeholder-skill')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    // 抵消必须排在出牌之后：客户端先演牌飞出去，再演抵消。
    expect(result.events).toEqual(cancelPair(0, card.instanceId))
    // 发动的是对手（1 号）的英雄，出牌方自己的技能没被动用。
    expect(result.state.players[1].heroSkillUsed).toBe(true)
    expect(result.state.players[0].heroSkillUsed).toBe(false)
    // 抵消的是效果不是这次出牌：牌照样离开手牌进弃牌堆。
    expect(result.state.players[0].discard.map((c) => c.instanceId)).toEqual([card.instanceId])
    expect(result.state.players[0].hand.some((c) => c.instanceId === card.instanceId)).toBe(false)
  })

  it('同一局第二张技能牌不再被抵消', () => {
    const game = newGame({ deck0: deckOf('placeholder-skill') })
    const first = game.state.players[0].hand[0]!
    const second = game.state.players[0].hand[1]!
    const result = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: first.instanceId },
      { type: 'PLAY_CARD', player: 0, instanceId: second.instanceId },
    ])

    const canceled = result.events.filter((e) => e.type === 'SKILL_CANCELED')
    expect(canceled).toEqual([cancelPair(0, first.instanceId)[1]])
    expect(result.events.filter((e) => e.type === 'SKILL_PLAYED')).toHaveLength(2)
    expect(result.state.players[1].heroSkillUsed).toBe(true)
  })

  it('双方各自的第一张技能牌分别被对方抵消，两个标志互不影响', () => {
    const game = newGame({
      deck0: deckOf('placeholder-skill'),
      deck1: deckOf('placeholder-skill'),
    })
    const mine = handCard(game.state, 0, 'placeholder-skill')
    const passed = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: mine.instanceId },
      { type: 'END_PLAY', player: 0 },
    ])
    expect(passed.state.players[1].heroSkillUsed).toBe(true)
    expect(passed.state.players[0].heroSkillUsed).toBe(false)

    const theirs = handCard(passed.state, 1, 'placeholder-skill')
    const result = execute(passed.state, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: theirs.instanceId,
    })

    expect(result.events).toEqual(cancelPair(1, theirs.instanceId))
    expect(result.state.players.map((p) => p.heroSkillUsed)).toEqual([true, true])
  })

  it('对手没有英雄时不发生抵消', () => {
    const game = newGame({ deck0: deckOf('placeholder-skill'), hero1: null })
    const card = handCard(game.state, 0, 'placeholder-skill')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
    expect(result.state.players[1].hero).toBeNull()
    expect(result.state.players[1].heroSkillUsed).toBe(false)
  })

  it('重开一局后 Debug 又能用一次', () => {
    const first = newGame({ deck0: deckOf('placeholder-skill') })
    const firstCard = handCard(first.state, 0, 'placeholder-skill')
    const used = execute(first.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: firstCard.instanceId,
    })
    expect(used.state.players[1].heroSkillUsed).toBe(true)

    // "每局一次"的一局就是一个 GameState 的生命周期：重新 createGame 就回到没用过。
    const fresh = newGame({ deck0: deckOf('placeholder-skill') })
    expect(fresh.state.players.map((p) => p.heroSkillUsed)).toEqual([false, false])
    const card = handCard(fresh.state, 0, 'placeholder-skill')
    const again = execute(fresh.state, { type: 'PLAY_CARD', player: 0, instanceId: card.instanceId })
    expect(again.events).toEqual(cancelPair(0, card.instanceId))
  })

  it('DEBUG_PLAY_CARD 打出的技能牌同样被抵消', () => {
    // 调试出牌和正常出牌共用 playCard，抵消是顺带覆盖到的，不需要单独接一遍。
    const game = newGame({ deck1: deckOf('placeholder-skill') })
    const card = handCard(game.state, 1, 'placeholder-skill')
    const result = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    })

    expect(result.events).toEqual(cancelPair(1, card.instanceId))
    expect(result.state.players[0].heroSkillUsed).toBe(true)
  })
})

describe('英雄技能：第一算法（阿达·洛芙莱斯）', () => {
  it('开局额外获得 2 个 Token', () => {
    const game = newGame({ hero0: 'ada-lovelace', hero1: null })
    // 起手 100，阿达额外 +2 = 102；不带该英雄的一方仍是 100。
    expect(game.state.players[0].tokens).toBe(102)
    expect(game.state.players[1].tokens).toBe(100)
  })

  it('叠加在自定义起始 Token 之上', () => {
    const game = newGame({ hero0: 'ada-lovelace', hero1: null, tokens0: 10 })
    expect(game.state.players[0].tokens).toBe(12)
  })

  it('是被动技能，没有可主动发动的目标', () => {
    const game = newGame({ hero0: 'ada-lovelace', hero1: null, deck0: deckOf('gpt-2') })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    // 阿达没有进入 useHeroSkill 的主动分支，硬发也会被判成"没有可选目标"之外的兜底拒绝。
    const rejected = execute(deployed, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(deployed, 0)[0]!.instanceId,
    })
    expect(rejected.events[0]!.type).toBe('COMMAND_REJECTED')
    expect(deployed.players[0].heroSkillUsed).toBe(false)
  })
})

describe('英雄技能：快速部署（米拉·穆拉蒂）', () => {
  it('把一个已上场的 Agent 撤回手牌，可重新部署别的 Agent', () => {
    const game = newGame({ hero0: 'mira-murati', hero1: null, deck0: deckOf('gpt-2') })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const target = board(deployed, 0)[0]!
    const handSizeBefore = deployed.players[0].hand.length

    const used = execute(deployed, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: target.instanceId,
    })
    // 战场清空，那张牌回到手牌，实例 id 不变。
    expect(board(used.state, 0)).toHaveLength(0)
    expect(used.state.players[0].hand.map((c) => c.instanceId)).toContain(target.instanceId)
    expect(used.state.players[0].hand).toHaveLength(handSizeBefore + 1)
    expect(used.state.players[0].heroSkillUsed).toBe(true)
    expect(used.events).toEqual([
      {
        type: 'AI_RECALLED',
        player: 0,
        heroId: 'mira-murati',
        instanceId: target.instanceId,
        cardId: 'gpt-2',
      },
    ])

    // 撤回后仍在出牌阶段，可以把它重新打出去。
    const redeployed = execute(used.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: target.instanceId,
    })
    expect(board(redeployed.state, 0).map((ai) => ai.instanceId)).toEqual([target.instanceId])
  })

  it('目标必须是己方场上的 Agent，且每局只能用一次', () => {
    const game = newGame({
      hero0: 'mira-murati',
      hero1: null,
      deck0: deckOf('gpt-2'),
      deck1: deckOf('gpt-2'),
    })
    const mine = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const both = execute(mine, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(mine, 1, 'gpt-2').instanceId,
    }).state

    // 选对方场上的 Agent 被拒。
    const wrongSide = execute(both, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(both, 1)[0]!.instanceId,
    })
    expect(wrongSide.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '目标必须是己方场上的 Agent' },
    ])

    const used = execute(both, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(both, 0)[0]!.instanceId,
    })
    // 撤回后再打回场上，想第二次撤回时因为本局已用过而被拒。
    const redeployed = execute(used.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: board(both, 0)[0]!.instanceId,
    }).state
    const reused = execute(redeployed, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(redeployed, 0)[0]!.instanceId,
    })
    expect(reused.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '英雄技能已经用过了' }])
  })
})

describe('英雄技能：容错系统（玛格丽特·汉密尔顿）', () => {
  const question = QUESTION_POOL.find((item) => item.id === 'q-nurse')!

  /** 己方在场一个 Agent、手牌里留一张补位 Agent，进到答题阶段的现成局面。 */
  function readyForRescue() {
    const game = newGame({
      hero0: 'margaret-hamilton',
      hero1: null,
      // gpt-2 对 q-nurse 答错，gpt-4o 答对：先派 gpt-2 上场，手里留一张 gpt-4o 补位。
      deck0: ['gpt-2', 'gpt-4o'],
      deck1: [],
      questions: [question],
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    return toQuiz(deployed)
  }

  it('己方答错且手牌有 Agent 时，提交答题结果后停在 rescue 阶段等待决定', () => {
    const quiz = readyForRescue()
    const failing = board(quiz, 0)[0]!
    const submitted = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: scriptedAnswers(question, board(quiz, 0)),
    })
    // 答题结果先亮出来，但没有罚下、没有计分，局面停在 rescue。
    expect(submitted.state.phase).toBe('rescue')
    expect(submitted.state.rescuingPlayer).toBe(0)
    expect(board(submitted.state, 0).map((a) => a.instanceId)).toEqual([failing.instanceId])
    expect(submitted.state.players[0].score).toBe(0)
    const types = submitted.events.map((e) => e.type)
    expect(types).toContain('AI_ANSWERED')
    expect(types).toContain('RESCUE_OFFERED')
    expect(types).not.toContain('AI_ELIMINATED')
    expect(types).not.toContain('ROUND_SCORED')
  })

  it('发动补位：替补顶替答错 Agent 的位置，退回 quiz 重答后答对留场', () => {
    const quiz = readyForRescue()
    const failing = board(quiz, 0)[0]!
    const substitute = handCard(quiz, 0, 'gpt-4o')
    const offered = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: scriptedAnswers(question, board(quiz, 0)),
    }).state

    const rescued = execute(offered, {
      type: 'USE_RESCUE',
      player: 0,
      substituteInstanceId: substitute.instanceId,
    })
    // 替补顶上原位置，答错的原 Agent 进弃牌堆，局面退回 quiz。
    expect(rescued.state.phase).toBe('quiz')
    expect(board(rescued.state, 0).map((a) => a.instanceId)).toEqual([substitute.instanceId])
    expect(board(rescued.state, 0)[0]!.rescueSubstitute).toBe('margaret-hamilton')
    expect(rescued.state.players[0].discard.map((c) => c.cardId)).toEqual(['gpt-2'])
    expect(rescued.state.players[0].heroSkillUsed).toBe(true)
    expect(rescued.events).toEqual([
      {
        type: 'RESCUE_RESOLVED',
        player: 0,
        used: true,
        substituteInstanceId: substitute.instanceId,
        replacedInstanceId: failing.instanceId,
      },
    ])

    // 重新提交答题结果：gpt-4o 答对，留场并拿 1 分。
    const settled = execute(rescued.state, {
      type: 'SUBMIT_ANSWERS',
      results: scriptedAnswers(question, board(rescued.state, 0)),
    })
    expect(board(settled.state, 0).map((a) => a.instanceId)).toEqual([substitute.instanceId])
    expect(settled.state.players[0].score).toBe(1)
    expect(board(settled.state, 0)[0]!.rescueSubstitute).toBeUndefined()
  })

  it('放弃补位：按原答题结果结算，答错的 Agent 照常罚下', () => {
    const quiz = readyForRescue()
    const failing = board(quiz, 0)[0]!
    const offered = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: scriptedAnswers(question, board(quiz, 0)),
    }).state

    const declined = execute(offered, { type: 'DECLINE_RESCUE', player: 0 })
    expect(declined.state.players[0].discard.map((c) => c.cardId)).toEqual(['gpt-2'])
    expect(board(declined.state, 0)).toHaveLength(0)
    expect(declined.state.players[0].score).toBe(0)
    // 放弃后不再重复揭晓答题（rescue 阶段已经亮过），只补罚下与计分。
    const types = declined.events.map((e) => e.type)
    expect(types).toContain('RESCUE_RESOLVED')
    expect(types).toContain('AI_ELIMINATED')
    expect(types).toContain('ROUND_SCORED')
    expect(types).not.toContain('AI_ANSWERED')
    // heroSkillUsed 不因放弃而消耗：这局还能等下一次答错再发动。
    expect(declined.state.players[0].heroSkillUsed).toBe(false)
    expect(failing.instanceId).toBe(offered.players[0].board[0]!.instanceId)
  })

  it('己方全部答对时不触发容错系统，直接结算', () => {
    const game = newGame({
      hero0: 'margaret-hamilton',
      hero1: null,
      deck0: ['gpt-4o', 'gpt-4o'],
      deck1: [],
      questions: [question],
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-4o').instanceId,
    }).state
    const quiz = toQuiz(deployed)
    const settled = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: scriptedAnswers(question, board(quiz, 0)),
    })
    expect(settled.state.phase).not.toBe('rescue')
    expect(settled.state.players[0].score).toBe(1)
  })

  it('答错但手牌没有可补位的 Agent 时不进入 rescue 阶段', () => {
    const game = newGame({
      hero0: 'margaret-hamilton',
      hero1: null,
      deck0: ['gpt-2'],
      deck1: [],
      questions: [question],
    })
    const deployed = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-2').instanceId,
    }).state
    const quiz = toQuiz(deployed)
    // 场上只有 gpt-2、手里再没有别的 Agent，答错也无从补位。
    expect(quiz.players[0].hand.some((c) => getCard(c.cardId).kind === 'ai')).toBe(false)
    const settled = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: scriptedAnswers(question, board(quiz, 0)),
    })
    expect(settled.state.phase).not.toBe('rescue')
    expect(board(settled.state, 0)).toHaveLength(0)
  })
})

describe('题库与剧本', () => {
  it('题库覆盖三个类别，且题目 id 不重复', () => {
    const ids = QUESTION_POOL.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(QUESTION_POOL.map((q) => q.category))).toEqual(
      new Set(['bias', 'vision', 'brainteaser']),
    )
    expect(QUESTION_POOL.every((q) => q.text.length > 0 && q.answer.length > 0)).toBe(true)
  })

  it('保留用户点名的那道脑筋急转弯原文', () => {
    expect(QUESTION_POOL.map((q) => q.text)).toContain(
      '我要去洗车，洗车店离我五十米，我应该走过去还是开车去',
    )
  })

  it('剧本覆盖全部题目 × 全部 AI 牌', () => {
    const aiCards = Object.values(CARDS).filter((c) => c.kind === 'ai')
    expect(aiCards.length).toBeGreaterThan(0)
    for (const question of QUESTION_POOL) {
      for (const card of aiCards) {
        const [answer] = scriptedAnswers(question, [
          { instanceId: 'x', cardId: card.id, owner: 0 },
        ])
        expect(answer!.instanceId).toBe('x')
        expect(answer!.answerText.length).toBeGreaterThan(0)
        expect(typeof answer!.correct).toBe('boolean')
      }
    }
  })

  it('按传入顺序返回，每张卡对同一道题的结果稳定不变', () => {
    const question = QUESTION_POOL[0]!
    const aiUnits = [
      { instanceId: 'a', cardId: 'gpt-3-5', owner: 0 as PlayerId },
      { instanceId: 'b', cardId: 'claude-5-sonnet', owner: 1 as PlayerId },
    ]
    const first = scriptedAnswers(question, aiUnits)
    expect(first.map((r) => r.instanceId)).toEqual(['a', 'b'])
    expect(scriptedAnswers(question, aiUnits)).toEqual(first)
  })

  it('剧本里没有的卡直接抛错，暴露数据没补齐', () => {
    expect(() =>
      scriptedAnswers(QUESTION_POOL[0]!, [{ instanceId: 'x', cardId: '没这张卡', owner: 0 }]),
    ).toThrow()
  })
})
