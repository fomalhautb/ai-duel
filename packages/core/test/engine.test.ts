import { describe, expect, it } from 'vitest'
import {
  CARDS,
  createGame,
  effectivePlayCost,
  execute,
  getCard,
  INITIAL_TOKEN_MAX,
  INTERFERENCE_PROMPTS,
  other,
  QUESTION_POOL,
  ROUND_DRAW_SIZE,
  scriptedAnswers,
  STARTER_DECK,
  STARTING_HAND_SIZE,
  TOKEN_MAX_GROWTH,
} from '../src/index'
import type {
  AnswerResult,
  CardId,
  Command,
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
      { name: '甲', deck: [...(options.deck0 ?? STARTER_DECK)], ...heroOf(options.hero0) },
      { name: '乙', deck: [...(options.deck1 ?? STARTER_DECK)], ...heroOf(options.hero1) },
    ],
    questions: options.questions,
  })
}

function heroOf(hero: HeroId | null | undefined) {
  return hero === undefined ? {} : { hero }
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

/** 按场上顺序凑一份完整答题结果，wrong 里列出的实例算答错。 */
function answersFor(state: GameState, wrong: InstanceId[] = []): AnswerResult[] {
  return [...state.players[0].board, ...state.players[1].board].map((ai) => ({
    instanceId: ai.instanceId,
    correct: !wrong.includes(ai.instanceId),
    answer: '占位',
    reasoning: '占位理由',
  }))
}

/** 双方都不出牌，直接把这一轮推进到答题阶段。 */
function toQuiz(state: GameState) {
  return run(state, [
    { type: 'END_PLAY', player: state.activePlayer },
    { type: 'END_PLAY', player: other(state.activePlayer) },
  ]).state
}

/** 结算阶段双方都点确认：这一步之后才会推进下一轮或结束整局。 */
function confirmBoth(state: GameState) {
  return run(state, [
    { type: 'CONFIRM_ROUND', player: 0 },
    { type: 'CONFIRM_ROUND', player: 1 },
  ])
}

/**
 * 把局面推到第 n 轮的出牌阶段：中间几轮双方都不出牌，场上的 AI 全部答对，双方确认后进下一轮。
 *
 * 用它是为了攒 Token 上限（每轮 +2）。「复读机」一张 4 点，第 1 轮的 4 点只够打一张，
 * 而要选目标那一节里有用例得连打两张，只能等到第 3 轮的 8 点。
 * 场上的 AI 一路全答对，所以推几轮它们都还站在原地。
 */
function toRound(state: GameState, round: number): GameState {
  let current = state
  while (current.round < round) {
    const quiz = execute(current, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const answered = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    current = confirmBoth(answered).state
  }
  return current
}

/** 凭空塞一张牌进某方手牌，返回新局面和那张牌的实例 id。造出来的牌一定落在手牌末尾。 */
function give(state: GameState, player: PlayerId, cardId: CardId) {
  const next = execute(state, { type: 'DEBUG_ADD_CARD', player, cardId }).state
  return { state: next, instanceId: next.players[player].hand.at(-1)!.instanceId }
}

/**
 * 凭空造几张牌再替某方打出去，用来一次把场面摆好（走调试指令是为了绕开出牌轮次）。
 * 费用照常扣，所以摆大场面之前得先用 toRound 把额度攒够；
 * 打不起会当场抛错，免得局面没摆成还让后面的断言去猜哪里不对。
 */
function deploy(state: GameState, player: PlayerId, cardIds: CardId[]): GameState {
  let current = state
  for (const cardId of cardIds) {
    const added = give(current, player, cardId)
    const result = execute(added.state, {
      type: 'DEBUG_PLAY_CARD',
      player,
      instanceId: added.instanceId,
    })
    const rejected = result.events.find((e) => e.type === 'COMMAND_REJECTED')
    if (rejected) throw new Error(`摆场失败（${cardId}）：${rejected.reason}`)
    current = result.state
  }
  return current
}

/**
 * 凭空给某方一张技能牌并立刻打出去，返回引擎的完整返回。
 * 不校验是否被拒——测拒绝的用例也用它。
 */
function playSkill(
  state: GameState,
  player: PlayerId,
  cardId: CardId,
  targetInstanceId?: InstanceId,
) {
  const added = give(state, player, cardId)
  return execute(added.state, {
    type: 'DEBUG_PLAY_CARD',
    player,
    instanceId: added.instanceId,
    ...(targetInstanceId === undefined ? {} : { targetInstanceId }),
  })
}

/**
 * 摆一个双方都不带英雄、额度已经攒起来的出牌阶段局面（第 5 轮各 12 点）。
 *
 * 不带英雄是因为默认的格蕾丝·霍珀会抵消对方本局第一张技能牌，而被抵消的技能一点效果都不留，
 * 会把这一批用例想测的东西整个盖掉（抵消本身另有专门的一节）。
 * 额度攒够是因为技能牌里最贵的金钟罩要 7 点，第 1 轮的 4 点连它都打不出来。
 *
 * 一局就 5 轮，第 5 轮确认完是终局，所以要测"进下一轮"的用例得传 4。
 */
function skillGame(round = 5): GameState {
  const game = newGame({
    deck0: deckOf('gpt-2'),
    deck1: deckOf('gpt-2'),
    hero0: null,
    hero1: null,
  })
  return toRound(game.state, round)
}

/** 第 n 轮双方各有多少 Token（上限只涨不减，见 TOKEN_MAX_GROWTH）。 */
function tokensAt(round: number): number {
  return INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH * (round - 1)
}

function rejection(result: { events: GameEvent[] }): string | undefined {
  const rejected = result.events.find((e) => e.type === 'COMMAND_REJECTED')
  return rejected?.reason
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
  it('Token 够就想出几张出几张：AI 牌上场，技能牌进弃牌堆', () => {
    // 两种牌都只要 1 点，第 1 轮的 4 点正好买得下起手 5 张里的 4 张。
    const game = newGame({ deck0: [...deckOf('gpt-2', 6), ...deckOf('one-sentence-answer', 6)] })
    const affordable = game.state.players[0].hand.slice(0, INITIAL_TOKEN_MAX)
    const result = run(
      game.state,
      affordable.map((card) => ({ type: 'PLAY_CARD', player: 0, instanceId: card.instanceId })),
    )

    const player = result.state.players[0]
    expect(player.hand).toHaveLength(STARTING_HAND_SIZE - INITIAL_TOKEN_MAX)
    expect(player.board.length + player.discard.length).toBe(INITIAL_TOKEN_MAX)
    // 出牌不推进阶段，出完还是自己在出。
    expect(result.state.activePlayer).toBe(0)
    expect(result.state.phase).toBe('play')
    expect(result.events.some((e) => e.type === 'COMMAND_REJECTED')).toBe(false)

    const deployed = result.events.filter((e) => e.type === 'AI_DEPLOYED')
    expect(deployed).toHaveLength(player.board.length)
    expect(player.board.every((a) => a.owner === 0)).toBe(true)
    const skills = result.events.filter((e) => e.type === 'SKILL_PLAYED')
    expect(skills).toHaveLength(player.discard.length)
    expect(player.discard.every((c) => c.cardId === 'one-sentence-answer')).toBe(true)
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
   * 而抵消掉的技能不留 interfered（见 playCard），那样这一组用例测的就不是目标规则了。
   * 抵消和目标撞在一起的情况单独有一节（见下面「英雄抵消 × 要选目标的技能牌」）。
   */
  function foeHasAis() {
    const game = newGame({
      deck0: deckOf('fixed-answer'),
      // 乙用 1 点的 GPT-2 摆场，两个 AI 只花 2 点。
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
    })
    const theirs = game.state.players[1].hand.slice(0, 2)
    const deployed = run(
      game.state,
      theirs.map(
        (card): Command => ({ type: 'DEBUG_PLAY_CARD', player: 1, instanceId: card.instanceId }),
      ),
    ).state
    // 推到第 3 轮：那时双方各有 8 点，够甲连打两张 4 点的「复读机」（"同一个 AI 不能被干扰
    // 两次"那条要打两张），也够乙在"替对方打出"那条里打一张。
    return toRound(deployed, 3)
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

    expect(board(result.state, 1)[0]).toEqual({ ...target, interference: 'fixed-answer' })
    // 只标中选的那一个，同排另一个不受影响。
    expect(board(result.state, 1)[1]!.interference).toBeUndefined()
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
      { type: 'COMMAND_REJECTED', reason: '这个 AI 已经被干扰过了' },
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

    expect(board(result.state, 0)[0]!.interference).toBe('fixed-answer')
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })

  it('不选目标的技能牌行为不变：带了目标也照打不误', () => {
    const state = run(foeHasAis(), [
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'one-sentence-answer' },
    ]).state
    const skill = state.players[0].hand.at(-1)!
    const result = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: board(state, 1)[0]!.instanceId,
    })

    // 没有 target 声明的卡不看这个字段：目标不会被标记，事件里也不带它。
    expect(board(result.state, 1)[0]!.interference).toBeUndefined()
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'one-sentence-answer',
        instanceId: skill.instanceId,
      },
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
    const deployed = run(
      game.state,
      theirs.map(
        (card): Command => ({ type: 'DEBUG_PLAY_CARD', player: 1, instanceId: card.instanceId }),
      ),
    ).state
    // 同 foeHasAis：连打两张 4 点的「复读机」要等到第 3 轮才有 8 点额度。
    return toRound(deployed, 3)
  }

  it('被抵消的干扰技能不留下 interfered 标记，那个 AI 之后还能被选中', () => {
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
    expect(board(canceled.state, 1)[0]!.interference).toBeUndefined()
    expect(canceled.state.players[0].discard.map((c) => c.cardId)).toEqual(['fixed-answer'])
    expect(canceled.state.players[1].heroSkillUsed).toBe(true)
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
    expect(board(second_.state, 1)[0]!.interference).toBe('fixed-answer')
    expect(second_.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })
})

describe('干扰：复读机与黑白颠倒', () => {
  /** 甲场上一个 AI，等着乙来干扰。 */
  function foeAi() {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    return { state, target: board(state, 0)[0]! }
  }

  it('命中后记的是打中它的那张牌，两张干扰各记各的', () => {
    const { state, target } = foeAi()
    const reversed = playSkill(state, 1, 'black-white-reversal', target.instanceId)
    expect(board(reversed.state, 0)[0]!.interference).toBe('black-white-reversal')

    const repeated = playSkill(state, 1, 'fixed-answer', target.instanceId)
    expect(board(repeated.state, 0)[0]!.interference).toBe('fixed-answer')
  })

  it('一个 AI 只挂得住一种干扰：挂着复读机的也挡住黑白颠倒', () => {
    // 两张牌共用 interference 这一个格子，所以"已经被干扰过了"这条对它们是通用的。
    const { state, target } = foeAi()
    const once = playSkill(state, 1, 'fixed-answer', target.instanceId).state
    expect(rejection(playSkill(once, 1, 'black-white-reversal', target.instanceId))).toBe(
      '这个 AI 已经被干扰过了',
    )
  })
})

describe('玉净瓶', () => {
  /** 甲场上一个 AI，已经被乙的复读机干扰。 */
  function interferedMine() {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    return playSkill(state, 1, 'fixed-answer', mine.instanceId).state
  }

  it('把己方 AI 身上的干扰摘掉，事件带上目标 id', () => {
    const state = interferedMine()
    const mine = board(state, 0)[0]!
    const result = playSkill(state, 0, 'jade-purification-vase', mine.instanceId)

    expect(board(result.state, 0)[0]!.interference).toBeUndefined()
    // 摘的是效果，单位本身一动不动。
    expect(board(result.state, 0)[0]!.instanceId).toBe(mine.instanceId)
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'jade-purification-vase',
        instanceId: result.state.players[0].discard.at(-1)!.instanceId,
        targetInstanceId: mine.instanceId,
      },
    ])
  })

  it('目标身上没有可移除的效果时被拒', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    expect(rejection(playSkill(state, 0, 'jade-purification-vase', mine.instanceId))).toBe(
      '这个 AI 身上没有可以移除的效果',
    )
  })

  it('目标是对方场上的 AI 时被拒（它只管己方）', () => {
    const state = interferedMine()
    const foe = deploy(state, 1, ['gpt-2'])
    expect(
      rejection(
        playSkill(foe, 0, 'jade-purification-vase', board(foe, 1)[0]!.instanceId),
      ),
    ).toBe('目标必须是你自己场上的 AI')
  })

  it('摘干净之后本轮还能再被干扰一次', () => {
    // 干扰的判据是"身上现在有没有"，不是"这一轮被打过没有"，所以摘掉就等于回到没被打过。
    const state = interferedMine()
    const mine = board(state, 0)[0]!
    const cleaned = playSkill(state, 0, 'jade-purification-vase', mine.instanceId).state
    const again = playSkill(cleaned, 1, 'black-white-reversal', mine.instanceId)
    expect(board(again.state, 0)[0]!.interference).toBe('black-white-reversal')
  })
})

describe('保送', () => {
  it('标记己方场上的 AI，事件带上目标 id', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    const result = playSkill(state, 0, 'safe-pass', mine.instanceId)

    expect(board(result.state, 0)[0]!.safePassed).toBe(true)
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })

  it('已经被保送的 AI 不能再被选中', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    const once = playSkill(state, 0, 'safe-pass', mine.instanceId).state
    expect(rejection(playSkill(once, 0, 'safe-pass', mine.instanceId))).toBe('这个 AI 已经被保送了')
  })

  it('目标是对方场上的 AI 时被拒', () => {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2']), 1, ['gpt-2'])
    expect(rejection(playSkill(state, 0, 'safe-pass', board(state, 1)[0]!.instanceId))).toBe(
      '目标必须是你自己场上的 AI',
    )
  })

  /**
   * 摆一个"甲两个 AI 全答错、其中一个被保送；乙一个 AI 答对且花得更多"的结算。
   *
   * 乙那张刻意用最贵的 ChatGPT 5.6 Sol：这样两种计分口径会给出相反的结果——
   * 按 results 数答对数是 [0, 1]（乙拿分），按"罚下之后场上还剩几个"却是 [1, 1] 打平、
   * 再比消耗反而是甲拿分。用例守的就是这个差别。
   */
  function safePassedSettle() {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2', 'gpt-2']), 1, ['chatgpt-5-6-sol'])
    const saved = board(state, 0)[0]!
    const passed = playSkill(state, 0, 'safe-pass', saved.instanceId).state
    const quiz = execute(passed, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const wrong = board(quiz, 0).map((a) => a.instanceId)
    return { saved, quiz, result: execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz, wrong) }) }
  }

  it('答错也留在场上，发 AI_SAFE_PASSED 而不是 AI_ELIMINATED', () => {
    const { saved, result } = safePassedSettle()

    expect(board(result.state, 0).map((a) => a.instanceId)).toEqual([saved.instanceId])
    expect(result.events).toContainEqual({
      type: 'AI_SAFE_PASSED',
      instanceId: saved.instanceId,
      owner: 0,
    })
    // 被保送的那个一条罚下事件都没有；同排没被保送的那个照常罚下。
    expect(
      result.events.filter((e) => e.type === 'AI_ELIMINATED').map((e) => e.instanceId),
    ).not.toContain(saved.instanceId)
    expect(result.events.filter((e) => e.type === 'AI_ELIMINATED')).toHaveLength(1)
    expect(result.state.players[0].discard.some((c) => c.instanceId === saved.instanceId)).toBe(
      false,
    )
  })

  it('保送留场的仍然算答错，不给计分注水', () => {
    const { result } = safePassedSettle()
    expect(result.events.find((e) => e.type === 'ROUND_SCORED')).toMatchObject({
      correct: [0, 1],
      gains: [0, 1],
    })
  })

  it('进下一轮时保送标记清掉', () => {
    const state = deploy(skillGame(4), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    const passed = playSkill(state, 0, 'safe-pass', mine.instanceId).state
    const quiz = execute(passed, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    const next = confirmBoth(settle).state

    expect(next.round).toBe(5)
    expect(board(next, 0)[0]!.safePassed).toBeUndefined()
  })
})

describe('金钟罩', () => {
  it('打出后这一方挂上罩子，无目标', () => {
    const state = skillGame()
    const result = playSkill(state, 0, 'golden-bell-shield')
    expect(result.state.players[0].shielded).toBe(true)
    expect(result.state.players[1].shielded).toBeUndefined()
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })

  it('对方的干扰技能选不中被罩那一方的 AI', () => {
    const state = deploy(skillGame(), 1, ['gpt-2'])
    const shielded = playSkill(state, 1, 'golden-bell-shield').state
    const theirs = board(shielded, 1)[0]!
    expect(rejection(playSkill(shielded, 0, 'fixed-answer', theirs.instanceId))).toBe(
      '对方金钟罩生效中，技能牌影响不到他的 Agent',
    )
    expect(board(shielded, 1)[0]!.interference).toBeUndefined()
  })

  it('自己也打不出玉净瓶/保送/模型蒸馏这类只作用于自己的牌', () => {
    // 用户拍板的口径是字面全挡：对自己有利的效果也一起挡在外面。
    // 先让乙干扰一下甲的 AI，玉净瓶才有个合法目标可选（不然会先被"没有可移除的效果"拦掉）。
    const base = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(base, 0)[0]!
    const hit = playSkill(base, 1, 'fixed-answer', mine.instanceId).state
    const shielded = playSkill(hit, 0, 'golden-bell-shield').state
    // 12 - 1（AI）- 7（金钟罩）= 4，下面三张都还买得起，被拒的原因只可能是罩子。
    expect(shielded.players[0].tokens).toBe(tokensAt(5) - 1 - 7)

    const blocked = '金钟罩生效中，本轮技能牌也影响不到你自己'
    expect(rejection(playSkill(shielded, 0, 'jade-purification-vase', mine.instanceId))).toBe(
      blocked,
    )
    expect(rejection(playSkill(shielded, 0, 'safe-pass', mine.instanceId))).toBe(blocked)
    const withAi = give(shielded, 0, 'gpt-2')
    expect(
      rejection(playSkill(withAi.state, 0, 'model-distillation', withAi.instanceId)),
    ).toBe(blocked)
  })

  it('第二张金钟罩被拒（罩子自己是全挡口径唯一的例外）', () => {
    // 两张金钟罩要 14 点，而一局最多也就攒到 12 点，得先用模型蒸馏把额度顶上去
    // ——蒸馏作用于自己，必须赶在罩子立起来之前打。
    // 费用那道闸排在这条检查之前（见 playCard），钱不够的话报的会是"Token 不够"。
    const state = skillGame()
    const fodder = give(state, 0, 'chatgpt-5-6-sol')
    const rich = playSkill(fodder.state, 0, 'model-distillation', fodder.instanceId).state
    const shielded = playSkill(rich, 0, 'golden-bell-shield').state
    expect(shielded.players[0].tokens).toBeGreaterThanOrEqual(
      getCard('golden-bell-shield').tokenCost,
    )
    expect(rejection(playSkill(shielded, 0, 'golden-bell-shield'))).toBe('本轮已经有金钟罩了')
  })

  it('群体技能跳过被罩的一方，另一方照常结算', () => {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2']), 1, ['gpt-2'])
    const shielded = playSkill(state, 0, 'golden-bell-shield').state
    const result = playSkill(shielded, 1, 'domestic-substitution')

    // 两个都是非国产，但只有没被罩的乙自己那个被清了。
    expect(board(result.state, 0)).toHaveLength(1)
    expect(board(result.state, 1)).toHaveLength(0)
    expect(result.events.filter((e) => e.type === 'AI_REMOVED').map((e) => e.owner)).toEqual([1])
  })

  it('被罩的一方不吃核电站的减费', () => {
    const state = playSkill(skillGame(), 1, 'nuclear-power-station').state
    const shielded = playSkill(state, 0, 'golden-bell-shield').state
    expect(shielded.costReduction).toBe(1)
    // 减费对没被罩的乙照常生效，对甲一点不生效。
    expect(effectivePlayCost(shielded, 0, getCard('gpt-4o'))).toBe(getCard('gpt-4o').tokenCost)
    expect(effectivePlayCost(shielded, 1, getCard('gpt-4o'))).toBe(getCard('gpt-4o').tokenCost - 1)

    // 金钟罩自己那一张是按减价付的：付款那一刻罩子还没立起来。
    expect(shielded.players[0].tokens).toBe(tokensAt(5) - (getCard('golden-bell-shield').tokenCost - 1))
  })

  it('被英雄技能抵消时罩子不生效', () => {
    // 抵消的判定排在效果之前，所以这一整套都不该留下痕迹（其余技能牌同理）。
    const game = newGame({ deck0: deckOf('gpt-2'), deck1: deckOf('gpt-2'), hero0: null })
    const state = toRound(game.state, 5)
    const result = playSkill(state, 0, 'golden-bell-shield')

    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED', 'SKILL_CANCELED'])
    expect(result.state.players[0].shielded).toBeUndefined()
  })

  it('进下一轮时罩子撤掉', () => {
    const shielded = playSkill(skillGame(4), 0, 'golden-bell-shield').state
    const quiz = execute(shielded, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state
    expect(confirmBoth(settle).state.players[0].shielded).toBeUndefined()
  })
})

describe('核电站', () => {
  it('打出后双方后续的牌都便宜 1 点', () => {
    const state = playSkill(skillGame(), 0, 'nuclear-power-station').state
    expect(state.costReduction).toBe(1)
    // 减的是双方的费用，也包括打出方自己后面的牌。
    expect(effectivePlayCost(state, 0, getCard('gpt-4o'))).toBe(3)
    expect(effectivePlayCost(state, 1, getCard('gpt-4o'))).toBe(3)

    const played = deploy(state, 1, ['gpt-4o'])
    expect(played.players[1].tokens).toBe(tokensAt(5) - 3)
    // 记账的两处用的是同一个实际费用，结算时的"本轮消耗"也跟着便宜。
    expect(played.players[1].roundTokenSpent).toBe(3)
  })

  it('可以叠加：打两张就减 2', () => {
    const first = playSkill(skillGame(), 0, 'nuclear-power-station').state
    const second = playSkill(first, 0, 'nuclear-power-station').state

    expect(second.costReduction).toBe(2)
    expect(effectivePlayCost(second, 0, getCard('gpt-4o'))).toBe(2)
    // 第二张自己也吃了第一张的减免：4 点的牌先花 4 再花 3。
    expect(second.players[0].tokens).toBe(tokensAt(5) - 4 - 3)
  })

  it('再怎么减也不会低于 1 点', () => {
    const state = playSkill(playSkill(skillGame(), 0, 'nuclear-power-station').state, 0, 'nuclear-power-station').state
    expect(state.costReduction).toBe(2)
    // GPT-2 卡面就 1 点，减 2 也还是 1，不会变成 0 或负数。
    expect(effectivePlayCost(state, 0, getCard('gpt-2'))).toBe(1)
    const played = deploy(state, 0, ['gpt-2'])
    expect(played.players[0].tokens).toBe(state.players[0].tokens - 1)
  })

  it('进下一轮时减免清零', () => {
    const state = playSkill(skillGame(4), 0, 'nuclear-power-station').state
    const quiz = execute(state, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state
    const next = confirmBoth(settle).state

    expect(next.costReduction).toBe(0)
    expect(effectivePlayCost(next, 0, getCard('gpt-4o'))).toBe(4)
  })
})

describe('模型蒸馏', () => {
  it('弃掉手牌里那张 AI，换来它印刷费用 +1 的 Token', () => {
    const state = skillGame()
    const fodder = give(state, 0, 'chatgpt-5-6-sol')
    const result = playSkill(fodder.state, 0, 'model-distillation', fodder.instanceId)

    const player = result.state.players[0]
    expect(player.hand.some((c) => c.instanceId === fodder.instanceId)).toBe(false)
    expect(player.discard.some((c) => c.instanceId === fodder.instanceId)).toBe(true)
    // 12 - 1（这张技能牌）+ 7 + 1。换来的按印刷费用算，不吃核电站的减费。
    expect(player.tokens).toBe(tokensAt(5) - 1 + getCard('chatgpt-5-6-sol').tokenCost + 1)
    // 打向手牌的牌不带 targetInstanceId：客户端拿它去战场上找格子会扑空。
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'model-distillation',
        instanceId: player.discard.at(-2)!.instanceId,
      },
      { type: 'CARD_REMOVED', player: 0, instanceId: fodder.instanceId },
    ])
  })

  it('Token 可以顶破上限，下一轮补满时被覆盖', () => {
    const state = skillGame(4)
    const fodder = give(state, 0, 'chatgpt-5-6-sol')
    const rich = playSkill(fodder.state, 0, 'model-distillation', fodder.instanceId).state
    expect(rich.players[0].tokens).toBeGreaterThan(rich.players[0].tokenMax)

    const quiz = execute(rich, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state
    const next = confirmBoth(settle).state
    expect(next.players[0].tokens).toBe(next.players[0].tokenMax)
  })

  it('目标只能是手牌里的 AI 牌', () => {
    const state = skillGame()
    const skill = give(state, 0, 'one-sentence-answer')
    // 技能牌不行（这一条顺带挡住了"拿蒸馏自己当目标"）。
    expect(rejection(playSkill(skill.state, 0, 'model-distillation', skill.instanceId))).toBe(
      '目标必须是你手牌里的一张 AI 牌',
    )
    // 场上的 AI 也不行：它要的是手牌实例。
    const deployed = deploy(state, 0, ['gpt-2'])
    expect(
      rejection(playSkill(deployed, 0, 'model-distillation', board(deployed, 0)[0]!.instanceId)),
    ).toBe('目标必须是你手牌里的一张 AI 牌')
    expect(rejection(playSkill(state, 0, 'model-distillation'))).toBe('这张技能牌要先指定目标')
  })
})

describe('内存紧缺', () => {
  it('向上取整保留一半：3 个留 2 个，落选的进弃牌堆', () => {
    const state = deploy(skillGame(), 0, ['gpt-2', 'gpt-2', 'gpt-2'])
    const before = board(state, 0).map((a) => a.instanceId)
    const result = playSkill(state, 1, 'memory-shortage')

    const after = board(result.state, 0).map((a) => a.instanceId)
    expect(after).toHaveLength(2)
    // 留下的保持原来的先后顺序，客户端的战场格子才不用整排重排。
    expect(after).toEqual(before.filter((id) => after.includes(id)))

    const removed = result.events.filter((e) => e.type === 'AI_REMOVED')
    expect(removed).toHaveLength(1)
    expect(removed[0]).toEqual({
      type: 'AI_REMOVED',
      instanceId: before.find((id) => !after.includes(id)),
      owner: 0,
      cardId: 'gpt-2',
      by: 'memory-shortage',
    })
    expect(result.state.players[0].discard.map((c) => c.instanceId)).toContain(removed[0]!.instanceId)
  })

  it('场上只有 1 个时一个都不清（ceil(1/2) = 1）', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const result = playSkill(state, 1, 'memory-shortage')
    expect(board(result.state, 0)).toHaveLength(1)
    expect(result.events.some((e) => e.type === 'AI_REMOVED')).toBe(false)
  })

  it('空场也打得出去，什么都不发生', () => {
    const result = playSkill(skillGame(), 0, 'memory-shortage')
    expect(rejection(result)).toBeUndefined()
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })

  it('同一份状态打两次得到同一批幸存者，种子跟着推进', () => {
    // 随机数从状态里的种子起，所以联机两端各自重放同一条指令不会分叉。
    const state = deploy(skillGame(), 0, ['gpt-2', 'gpt-2', 'gpt-2'])
    const first = playSkill(state, 1, 'memory-shortage')
    const second = playSkill(state, 1, 'memory-shortage')

    expect(board(first.state, 0).map((a) => a.instanceId)).toEqual(
      board(second.state, 0).map((a) => a.instanceId),
    )
    expect(first.state.rngSeed).not.toBe(state.rngSeed)
    // 种子推进过了，所以接着再打一张清的不一定是同一批（这里只要求它确实换了个数）。
    expect(playSkill(first.state, 1, 'memory-shortage').state.rngSeed).not.toBe(first.state.rngSeed)
  })

  it('双方各清各的一半', () => {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2', 'gpt-2']), 1, ['gpt-2', 'gpt-2'])
    const result = playSkill(state, 0, 'memory-shortage')
    expect(board(result.state, 0)).toHaveLength(1)
    expect(board(result.state, 1)).toHaveLength(1)
  })
})

describe('国产替代', () => {
  it('双方场上没有国产标签的全部罚下，包括打出方自己的', () => {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2', 'qwen']), 1, ['doubao', 'gemini'])
    const doomed = [board(state, 0)[0]!, board(state, 1)[1]!]
    const result = playSkill(state, 0, 'domestic-substitution')

    expect(board(result.state, 0).map((a) => a.cardId)).toEqual(['qwen'])
    expect(board(result.state, 1).map((a) => a.cardId)).toEqual(['doubao'])
    // 事件按座位号顺序发：先甲的，再乙的。
    expect(result.events.filter((e) => e.type === 'AI_REMOVED')).toEqual([
      {
        type: 'AI_REMOVED',
        instanceId: doomed[0]!.instanceId,
        owner: 0,
        cardId: 'gpt-2',
        by: 'domestic-substitution',
      },
      {
        type: 'AI_REMOVED',
        instanceId: doomed[1]!.instanceId,
        owner: 1,
        cardId: 'gemini',
        by: 'domestic-substitution',
      },
    ])
    expect(result.state.players[0].discard.map((c) => c.cardId)).toContain('gpt-2')
  })

  it('全场都是国产时打空也不拒', () => {
    const state = deploy(skillGame(), 0, ['qwen', 'doubao'])
    const result = playSkill(state, 0, 'domestic-substitution')
    expect(rejection(result)).toBeUndefined()
    expect(board(result.state, 0)).toHaveLength(2)
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })
})

describe('鸡犬升天', () => {
  it('双方场上可进化的各升一级，链尾原地不动', () => {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2', 'chatgpt-5-6-sol']), 1, [
      'claude-5-sonnet',
    ])
    const evolving = board(state, 0)[0]!
    const theirs = board(state, 1)[0]!
    const result = playSkill(state, 1, 'rising-tide')

    expect(board(result.state, 0).map((a) => a.cardId)).toEqual(['gpt-3-5', 'chatgpt-5-6-sol'])
    expect(board(result.state, 1).map((a) => a.cardId)).toEqual(['claude-fable-5'])
    expect(result.events.filter((e) => e.type === 'AI_TRANSFORMED')).toEqual([
      {
        type: 'AI_TRANSFORMED',
        instanceId: evolving.instanceId,
        owner: 0,
        fromCardId: 'gpt-2',
        toCardId: 'gpt-3-5',
      },
      {
        type: 'AI_TRANSFORMED',
        instanceId: theirs.instanceId,
        owner: 1,
        fromCardId: 'claude-5-sonnet',
        toCardId: 'claude-fable-5',
      },
    ])
  })

  it('换的只是卡面身份：实例 id 和身上的本轮标记都留着', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    const hit = playSkill(state, 1, 'fixed-answer', mine.instanceId).state
    const result = playSkill(hit, 1, 'rising-tide')

    expect(board(result.state, 0)[0]).toEqual({
      instanceId: mine.instanceId,
      cardId: 'gpt-3-5',
      owner: 0,
      interference: 'fixed-answer',
    })
  })

  it('连打两张就顺着链子升两级', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const once = playSkill(state, 1, 'rising-tide').state
    const twice = playSkill(once, 1, 'rising-tide').state
    expect(board(twice, 0).map((a) => a.cardId)).toEqual(['gpt-4o'])
  })
})

describe('Token', () => {
  it('开局双方各拿满第 1 轮的额度', () => {
    const game = newGame()
    for (const player of game.state.players) {
      expect(player.tokenMax).toBe(INITIAL_TOKEN_MAX)
      expect(player.tokens).toBe(INITIAL_TOKEN_MAX)
    }
  })

  it('出牌按卡面费用扣，扣的是打出方自己的额度', () => {
    // GPT-3.5 是 2 点，第 1 轮 4 点打一张还剩 2 点。
    const game = newGame({ deck0: deckOf('gpt-3-5') })
    const card = handCard(game.state, 0, 'gpt-3-5')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(result.state.players[0].tokens).toBe(INITIAL_TOKEN_MAX - getCard('gpt-3-5').tokenCost)
    expect(result.state.players[0].tokenMax).toBe(INITIAL_TOKEN_MAX)
    // 对方的额度一点没动。
    expect(result.state.players[1].tokens).toBe(INITIAL_TOKEN_MAX)
  })

  it('剩余 Token 不够时被拒，状态原样返回', () => {
    // ChatGPT 5.6 Sol 要 7 点，第 1 轮只有 4 点，怎么都打不出。
    const game = newGame({ deck0: deckOf('chatgpt-5-6-sol') })
    const card = handCard(game.state, 0, 'chatgpt-5-6-sol')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: 'Token 不够：这张牌要 7 点，只剩 4 点' },
    ])
    expect(result.state).toBe(game.state)
  })

  it('费用不够的技能牌连目标都不用挑就被拒', () => {
    // 校验顺序：费用在选目标之前，不然玩家会挑完目标才被告知打不起。
    const game = newGame({ deck0: deckOf('fixed-answer'), deck1: deckOf('gpt-2') })
    // 乙先摆一个 AI：场上摆着合法目标，下面被拒就只可能是费用那道闸拦的。
    const foeAi = run(game.state, [
      {
        type: 'DEBUG_PLAY_CARD',
        player: 1,
        instanceId: handCard(game.state, 1, 'gpt-2').instanceId,
      },
    ]).state
    // 「复读机」4 点，正好是第 1 轮的全部额度；甲先花 1 点买一张 GPT-2，剩下的 3 点就买不起了。
    const added = run(foeAi, [{ type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-2' }]).state
    const drained = execute(added, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(added, 0, 'gpt-2').instanceId,
    }).state
    expect(drained.players[0].tokens).toBe(INITIAL_TOKEN_MAX - 1)

    // 这一张连目标都没给，但报的是费用不够——费用那道闸排在前面。
    const skill = handCard(drained, 0, 'fixed-answer')
    const result = execute(drained, { type: 'PLAY_CARD', player: 0, instanceId: skill.instanceId })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: 'Token 不够：这张牌要 4 点，只剩 3 点' },
    ])
  })

  it('每轮双方确认后补满并抬高上限，省下的不跨轮累积', () => {
    const game = newGame({ deck0: deckOf('gpt-3-5'), deck1: deckOf('gpt-3-5') })
    // 甲花掉 2 点，乙一点没花——下一轮两边一样满。
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-3-5').instanceId,
    }).state
    const quiz = toQuiz(played)
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    // 结算期间额度保持本轮的样子，界面靠它显示"本轮消耗"。
    expect(settle.players[0].tokens).toBe(INITIAL_TOKEN_MAX - getCard('gpt-3-5').tokenCost)
    const next = confirmBoth(settle).state

    expect(next.round).toBe(2)
    for (const player of next.players) {
      expect(player.tokenMax).toBe(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
      expect(player.tokens).toBe(player.tokenMax)
    }
  })

  it('上限逐轮线性增长，一局打完涨到 4 + 2 × (轮数 - 1)', () => {
    let state = newGame().state
    const maxes: number[] = []
    while (state.phase !== 'finished') {
      if (state.phase === 'play') {
        maxes.push(state.players[0].tokenMax)
        state = toQuiz(state)
      } else if (state.phase === 'settle') {
        state = confirmBoth(state).state
      } else {
        state = execute(state, { type: 'SUBMIT_ANSWERS', results: answersFor(state) }).state
      }
    }
    expect(maxes).toEqual(
      maxes.map((_, index) => INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH * index),
    )
    expect(maxes).toHaveLength(state.totalRounds)
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

  it('答错的罚下进弃牌堆，答对的留场，最后停在结算阶段', () => {
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
    // 双方各答对 1 个、各花 4 点，两条判据都平，所以各拿 1 分。
    expect(result.state.players.map((p) => p.score)).toEqual([1, 1])

    // 事件序：逐个揭晓回答，答错的紧跟一条罚下，最后统一计分。
    expect(result.events).toEqual([
      {
        type: 'AI_ANSWERED',
        instanceId: survivor!.instanceId,
        owner: 0,
        cardId: 'gpt-3-5',
        correct: true,
        answer: '占位',
        reasoning: '占位理由',
      },
      {
        type: 'AI_ANSWERED',
        instanceId: doomed!.instanceId,
        owner: 0,
        cardId: 'gpt-3-5',
        correct: false,
        answer: '占位',
        reasoning: '占位理由',
      },
      { type: 'AI_ELIMINATED', instanceId: doomed!.instanceId, owner: 0 },
      {
        type: 'AI_ANSWERED',
        instanceId: theirs.instanceId,
        owner: 1,
        cardId: 'claude-5-sonnet',
        correct: true,
        answer: '占位',
        reasoning: '占位理由',
      },
      { type: 'ROUND_SCORED', gains: [1, 1], scores: [1, 1], correct: [1, 1], spent: [4, 4] },
    ])

    // 计分完就停下等确认：这一批里没有下一轮的任何动静。
    expect(result.state.phase).toBe('settle')
    expect(result.state.settleConfirmed).toEqual([false, false])
    expect(result.state.round).toBe(1)
    expect(result.state.firstPlayer).toBe(0)
    expect(result.events.some((e) => e.type === 'ROUND_STARTED')).toBe(false)
    expect(result.events.some((e) => e.type === 'CARD_DRAWN')).toBe(false)
  })

  it('答对数多的一方拿这一分，得分逐轮累加', () => {
    const quiz = twoVsOne()
    const first = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(first.state.players.map((p) => p.score)).toEqual([1, 0])
    expect(first.events.find((e) => e.type === 'ROUND_SCORED')).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 0],
      scores: [1, 0],
      correct: [2, 1],
      spent: [4, 4],
    })

    // 第 2 轮双方都不再出牌，场上还是上一轮留下的 AI，甲照样多答对一个。
    const round2 = confirmBoth(first.state).state
    const second = execute(toQuiz(round2), {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(round2),
    })
    expect(second.state.players.map((p) => p.score)).toEqual([2, 0])
  })

  it('双方确认后才交换先后手、各补 ROUND_DRAW_SIZE 张牌、宣告下一轮', () => {
    const quiz = twoVsOne()
    const handsBefore = quiz.players.map((p) => p.hand.length)
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    const result = confirmBoth(settle)

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

  it('场上一个 AI 都没有时提交空结果，两边全平各拿 1 分，对局继续', () => {
    const quiz = toQuiz(newGame().state)
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] })

    expect(result.events.find((e) => e.type === 'ROUND_SCORED')).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 1],
      scores: [1, 1],
      correct: [0, 0],
      spent: [0, 0],
    })
    expect(result.state.phase).toBe('settle')
    expect(confirmBoth(result.state).state.round).toBe(2)
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
        results: [
          ...full,
          { instanceId: '幽灵', correct: true, answer: '占位', reasoning: '占位理由' },
        ],
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

describe('回合确认', () => {
  /** 摆一个刚算完分、停在结算阶段的局面（双方各一个 AI，两条判据都平）。 */
  function settlePhase() {
    const game = newGame({ deck0: deckOf('gpt-3-5'), deck1: deckOf('gpt-3-5') })
    const quiz = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-3-5').instanceId },
      { type: 'END_PLAY', player: 0 },
    ]).state
    const both = run(quiz, [
      { type: 'PLAY_CARD', player: 1, instanceId: handCard(quiz, 1, 'gpt-3-5').instanceId },
      { type: 'END_PLAY', player: 1 },
    ]).state
    return execute(both, { type: 'SUBMIT_ANSWERS', results: answersFor(both) }).state
  }

  it('只有一方确认时局面不动，只发一条 ROUND_CONFIRMED', () => {
    const settle = settlePhase()
    const result = execute(settle, { type: 'CONFIRM_ROUND', player: 0 })

    expect(result.events).toEqual([{ type: 'ROUND_CONFIRMED', player: 0 }])
    expect(result.state.settleConfirmed).toEqual([true, false])
    expect(result.state.phase).toBe('settle')
    expect(result.state.round).toBe(1)
    expect(result.state.players[0].hand.length).toBe(settle.players[0].hand.length)
  })

  it('同一方确认两次时第二次被拒', () => {
    const once = execute(settlePhase(), { type: 'CONFIRM_ROUND', player: 0 }).state
    const result = execute(once, { type: 'CONFIRM_ROUND', player: 0 })

    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '这一轮你已经确认过了' }])
    expect(result.state).toBe(once)
  })

  it('不在结算阶段确认会被拒', () => {
    const game = newGame()
    const play = execute(game.state, { type: 'CONFIRM_ROUND', player: 0 })
    expect(play.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '现在不是回合结算阶段' },
    ])
    expect(play.state).toBe(game.state)

    const quiz = toQuiz(game.state)
    expect(execute(quiz, { type: 'CONFIRM_ROUND', player: 1 }).events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '现在不是回合结算阶段' },
    ])
  })

  it('双方都确认后才推进：轮次 +1、额度补满并涨上限、本轮消耗清零、双方补牌', () => {
    const settle = settlePhase()
    expect(settle.players.map((p) => p.roundTokenSpent)).toEqual([2, 2])
    const handsBefore = settle.players.map((p) => p.hand.length)
    const result = confirmBoth(settle)

    expect(result.state.phase).toBe('play')
    expect(result.state.round).toBe(2)
    expect(result.state.settleConfirmed).toEqual([true, true])
    for (const player of result.state.players) {
      expect(player.tokenMax).toBe(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
      expect(player.tokens).toBe(player.tokenMax)
      expect(player.roundTokenSpent).toBe(0)
    }
    expect(result.state.players.map((p) => p.hand.length)).toEqual(
      handsBefore.map((n) => n + ROUND_DRAW_SIZE),
    )
    // 两条确认各自留下一条事件，推进产生的那批全部跟在第二条后面。
    expect(result.events.slice(0, 2)).toEqual([
      { type: 'ROUND_CONFIRMED', player: 0 },
      { type: 'ROUND_CONFIRMED', player: 1 },
    ])
  })
})

describe('回合计分', () => {
  /**
   * 摆一个算完分的局面：双方各按给定的卡摆场，全部答对。
   * 用不同费用的卡就能造出"答对数相同、消耗不同"的局面。
   */
  function scoreWith(cards0: CardId[], cards1: CardId[]) {
    const game = newGame({ deck0: deckOf('gpt-2'), deck1: deckOf('gpt-2') })
    const both = deploy(deploy(game.state, 0, cards0), 1, cards1)
    const quiz = execute(both, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    return execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
  }

  function scoredEvent(result: ReturnType<typeof scoreWith>) {
    return result.events.find((e) => e.type === 'ROUND_SCORED')
  }

  it('答对数多的一方拿 1 分，另一方 0 分', () => {
    // 甲两张 1 点、乙一张 2 点：甲答对 2 个，乙 1 个。
    const result = scoreWith(['gpt-2', 'gpt-2'], ['gpt-3-5'])
    expect(scoredEvent(result)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 0],
      scores: [1, 0],
      correct: [2, 1],
      spent: [2, 2],
    })
  })

  it('答对数相同时消耗少的一方拿 1 分', () => {
    // 双方各一个 AI，甲花 1 点、乙花 2 点。
    const result = scoreWith(['gpt-2'], ['gpt-3-5'])
    expect(scoredEvent(result)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 0],
      scores: [1, 0],
      correct: [1, 1],
      spent: [1, 2],
    })
  })

  it('答对数和消耗都相同时双方各拿 1 分', () => {
    const result = scoreWith(['gpt-3-5'], ['gpt-3-5'])
    expect(scoredEvent(result)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 1],
      scores: [1, 1],
      correct: [1, 1],
      spent: [2, 2],
    })
  })

  it('spent 就是本轮打出的牌的费用和，技能牌也算在内', () => {
    // 「一句话回答」1 点：它不上场，所以不影响答对数，但照样计入消耗，
    // 于是甲多花了这 1 点，平局的第二判据就倒向乙。
    const result = scoreWith(['gpt-2', 'one-sentence-answer'], ['gpt-2'])
    expect(scoredEvent(result)).toEqual({
      type: 'ROUND_SCORED',
      gains: [0, 1],
      scores: [0, 1],
      correct: [1, 1],
      spent: [2, 1],
    })
  })

  it('进下一轮后本轮消耗清零，上一轮的花费不会带过来', () => {
    const settle = scoreWith(['gpt-2'], ['gpt-3-5']).state
    expect(settle.players.map((p) => p.roundTokenSpent)).toEqual([1, 2])

    const round2 = confirmBoth(settle).state
    expect(round2.players.map((p) => p.roundTokenSpent)).toEqual([0, 0])

    // 第 2 轮甲什么都不打、乙打一张，判据就该反过来倒向甲。
    const played = execute(round2, {
      type: 'DEBUG_ADD_CARD',
      player: 1,
      cardId: 'gpt-2',
    }).state
    const deployed = execute(played, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: played.players[1].hand.at(-1)!.instanceId,
    }).state
    const quiz = execute(deployed, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const scored = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(scored.events.find((e) => e.type === 'ROUND_SCORED')).toMatchObject({
      // 场上是上一轮留下的各一个 + 乙新上的一个：乙答对 2 个，这一分归乙。
      correct: [1, 2],
      spent: [0, 1],
      gains: [0, 1],
    })
  })
})

describe('胜负', () => {
  /**
   * 只有一道题的一局：第一次结算就是最后一轮。
   * 双方用同一张卡摆场，这样"出几个 AI"同时决定答对数和消耗，
   * 数量相同时两条判据都平，正好能测出平局。
   */
  function oneRoundGame(aiCount0: number, aiCount1: number) {
    const game = newGame({
      deck0: deckOf('gpt-3-5'),
      deck1: deckOf('gpt-3-5'),
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

  it('最后一轮双方确认后分高的一方获胜', () => {
    const quiz = oneRoundGame(2, 1)
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    // 算完分只到 settle，终局要等双方点确认。
    expect(settle.state.phase).toBe('settle')
    expect(settle.events.some((e) => e.type === 'GAME_OVER')).toBe(false)

    const result = confirmBoth(settle.state)
    expect(result.state.phase).toBe('finished')
    expect(result.state.winner).toBe(0)
    expect(result.state.round).toBe(result.state.totalRounds)
    expect(result.events.at(-1)).toEqual({ type: 'GAME_OVER', winner: 0 })
    // 打完了就不再宣告下一轮，也不补牌。
    expect(result.events.some((e) => e.type === 'ROUND_STARTED')).toBe(false)
    expect(result.events.some((e) => e.type === 'CARD_DRAWN')).toBe(false)
  })

  it('总分相同时判平局', () => {
    // 双方各一个 AI、各花 2 点，两条判据都平，所以各拿 1 分。
    const quiz = oneRoundGame(1, 1)
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    const result = confirmBoth(settle)

    expect(result.state.winner).toBe('draw')
    expect(result.events.at(-1)).toEqual({ type: 'GAME_OVER', winner: 'draw' })
  })

  it('对局结束后一切指令都被拒', () => {
    const quiz = oneRoundGame(1, 0)
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    const finished = confirmBoth(settle).state
    expect(finished.phase).toBe('finished')

    const result = execute(finished, { type: 'DEBUG_SKIP_TO_QUIZ' })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '对局已结束' }])
    expect(result.state).toBe(finished)
    // 确认指令也一样，结算阶段已经过去了。
    expect(execute(finished, { type: 'CONFIRM_ROUND', player: 0 }).events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '对局已结束' },
    ])
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
          // Token 不够的牌同样跳过，理由同上。客户端那边这些牌是画成灰的、根本拖不动。
          if (definition.tokenCost > state.players[seat].tokens) continue
          const target =
            definition.kind === 'skill' && definition.target === 'foe-ai'
              ? state.players[other(seat)].board.find((a) => a.interference === undefined)
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
      } else if (state.phase === 'settle') {
        // 结算停在这里等两位玩家各自点确认，界面上那两下在这里补齐。
        const confirmed = confirmBoth(state)
        state = confirmed.state
        events.push(...confirmed.events)
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
    // 每轮两条确认，一条都不能少。
    expect(events.filter((e) => e.type === 'ROUND_CONFIRMED')).toHaveLength(state.totalRounds * 2)
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
    const game = newGame({ deck1: deckOf('one-sentence-answer') })
    const card = handCard(game.state, 1, 'one-sentence-answer')
    const result = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    })

    expect(result.state.players[1].discard.map((c) => c.cardId)).toEqual(['one-sentence-answer'])
    // instanceId 是打出的那张技能牌自己，客户端靠它定位起飞的手牌。
    // 调试出牌和正常出牌走同一个 playCard，所以对手的 Debug 照样抵消这一张（见下面的英雄用例）。
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 1,
        cardId: 'one-sentence-answer',
        instanceId: card.instanceId,
      },
      {
        type: 'SKILL_CANCELED',
        player: 1,
        by: 0,
        heroId: 'grace-hopper',
        cardId: 'one-sentence-answer',
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
      { type: 'DEBUG_ADD_CARD', player: 1, cardId: 'one-sentence-answer' },
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

describe('英雄技能：Debug（格蕾丝·霍珀）', () => {
  /** 一张技能牌的完整事件对：出牌 + 被对手抵消。 */
  function cancelPair(player: PlayerId, instanceId: InstanceId): GameEvent[] {
    return [
      { type: 'SKILL_PLAYED', player, cardId: 'one-sentence-answer', instanceId },
      {
        type: 'SKILL_CANCELED',
        player,
        by: other(player),
        heroId: 'grace-hopper',
        cardId: 'one-sentence-answer',
        instanceId,
      },
    ]
  }

  it('对方打出的第一张技能牌被抵消，牌照常进弃牌堆', () => {
    const game = newGame({ deck0: deckOf('one-sentence-answer') })
    // 开局双方都没用过技能。
    expect(game.state.players.map((p) => p.hero)).toEqual(['grace-hopper', 'grace-hopper'])
    expect(game.state.players.map((p) => p.heroSkillUsed)).toEqual([false, false])

    const card = handCard(game.state, 0, 'one-sentence-answer')
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
    const game = newGame({ deck0: deckOf('one-sentence-answer') })
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
      deck0: deckOf('one-sentence-answer'),
      deck1: deckOf('one-sentence-answer'),
    })
    const mine = handCard(game.state, 0, 'one-sentence-answer')
    const passed = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: mine.instanceId },
      { type: 'END_PLAY', player: 0 },
    ])
    expect(passed.state.players[1].heroSkillUsed).toBe(true)
    expect(passed.state.players[0].heroSkillUsed).toBe(false)

    const theirs = handCard(passed.state, 1, 'one-sentence-answer')
    const result = execute(passed.state, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: theirs.instanceId,
    })

    expect(result.events).toEqual(cancelPair(1, theirs.instanceId))
    expect(result.state.players.map((p) => p.heroSkillUsed)).toEqual([true, true])
  })

  it('对手没有英雄时不发生抵消', () => {
    const game = newGame({ deck0: deckOf('one-sentence-answer'), hero1: null })
    const card = handCard(game.state, 0, 'one-sentence-answer')
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
    const first = newGame({ deck0: deckOf('one-sentence-answer') })
    const firstCard = handCard(first.state, 0, 'one-sentence-answer')
    const used = execute(first.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: firstCard.instanceId,
    })
    expect(used.state.players[1].heroSkillUsed).toBe(true)

    // "每局一次"的一局就是一个 GameState 的生命周期：重新 createGame 就回到没用过。
    const fresh = newGame({ deck0: deckOf('one-sentence-answer') })
    expect(fresh.state.players.map((p) => p.heroSkillUsed)).toEqual([false, false])
    const card = handCard(fresh.state, 0, 'one-sentence-answer')
    const again = execute(fresh.state, { type: 'PLAY_CARD', player: 0, instanceId: card.instanceId })
    expect(again.events).toEqual(cancelPair(0, card.instanceId))
  })

  it('DEBUG_PLAY_CARD 打出的技能牌同样被抵消', () => {
    // 调试出牌和正常出牌共用 playCard，抵消是顺带覆盖到的，不需要单独接一遍。
    const game = newGame({ deck1: deckOf('one-sentence-answer') })
    const card = handCard(game.state, 1, 'one-sentence-answer')
    const result = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    })

    expect(result.events).toEqual(cancelPair(1, card.instanceId))
    expect(result.state.players[0].heroSkillUsed).toBe(true)
  })
})

describe('题库与剧本', () => {
  it('题库覆盖三个类别，且题目 id 不重复', () => {
    const ids = QUESTION_POOL.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(QUESTION_POOL.map((q) => q.category))).toEqual(
      new Set(['bias', 'vision', 'brainteaser']),
    )
    expect(
      QUESTION_POOL.every(
        (q) => q.text.length > 0 && q.answer.length > 0 && q.explanation.length > 0,
      ),
    ).toBe(true)
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
        expect(answer!.answer.length).toBeGreaterThan(0)
        expect(answer!.reasoning.length).toBeGreaterThan(0)
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

  it('两种干扰各有一句注入 prompt，接真实 API 时由 driver 拼进去', () => {
    expect(Object.keys(INTERFERENCE_PROMPTS).sort()).toEqual([
      'black-white-reversal',
      'fixed-answer',
    ])
    for (const prompt of Object.values(INTERFERENCE_PROMPTS)) {
      expect(prompt.length).toBeGreaterThan(0)
    }
  })

  it('被复读机干扰的一律答香蕉、判错', () => {
    const question = QUESTION_POOL[0]!
    // 挑一张本来答得对的：干扰之后照样得判错，才说明是干扰在起作用。
    const [plain] = scriptedAnswers(question, [{ instanceId: 'x', cardId: 'gpt-4o', owner: 0 }])
    expect(plain!.correct).toBe(true)

    const [interfered] = scriptedAnswers(question, [
      { instanceId: 'x', cardId: 'gpt-4o', owner: 0, interference: 'fixed-answer' },
    ])
    expect(interfered).toMatchObject({ instanceId: 'x', correct: false, answer: '香蕉' })
    expect(interfered!.reasoning.length).toBeGreaterThan(0)
  })

  it('被黑白颠倒的判定翻个面，两个方向都翻', () => {
    const question = QUESTION_POOL[0]!
    const flip = (cardId: CardId) =>
      scriptedAnswers(question, [
        { instanceId: 'x', cardId, owner: 0, interference: 'black-white-reversal' },
      ])[0]!

    // 本来答对的被翻成答错，答案前面加个否定，界面上那行大字才看得出它反着说了。
    const [right] = scriptedAnswers(question, [{ instanceId: 'x', cardId: 'gpt-4o', owner: 0 }])
    expect(right!.correct).toBe(true)
    expect(flip('gpt-4o')).toMatchObject({ correct: false, answer: `不是${right!.answer}` })

    // 本来答错的反倒蒙对，这时直接报标准答案。
    const [wrong] = scriptedAnswers(question, [{ instanceId: 'x', cardId: 'gpt-2', owner: 0 }])
    expect(wrong!.correct).toBe(false)
    expect(flip('gpt-2')).toMatchObject({ correct: true, answer: question.answer })
  })

  it('没被干扰的照抄剧本，不受这一层影响', () => {
    const question = QUESTION_POOL[0]!
    const [plain] = scriptedAnswers(question, [{ instanceId: 'x', cardId: 'gpt-4o', owner: 0 }])
    expect(plain).toMatchObject({ correct: true })
    expect(plain!.answer).not.toBe('香蕉')
  })
})
