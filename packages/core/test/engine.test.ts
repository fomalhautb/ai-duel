import { describe, expect, it } from 'vitest'
import {
  ADA_TOKEN_MAX_BONUS,
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
  upgradeTargetOf,
  WIN_TARGET,
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
  /** 直接指定第一轮先手，不掷硬币（比挑种子好使，见 GameSetup.firstPlayer）。 */
  firstPlayer?: PlayerId
  /** 牌组和题库都按传入顺序原样使用，不洗（见 GameSetup.noShuffle）。 */
  noShuffle?: boolean
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
    // 这两项都是可选覆盖，不传就一个字段都不出现（exactOptionalPropertyTypes 打开着）。
    ...(options.firstPlayer === undefined ? {} : { firstPlayer: options.firstPlayer }),
    ...(options.noShuffle === undefined ? {} : { noShuffle: options.noShuffle }),
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
 * 从出牌阶段一路推到下一轮的出牌阶段：
 * 双方结束出牌 → 场上所有 AI 全答对 → 双方确认结算。
 * 给"要摆一个跨轮局面"的用例用。
 */
function nextRound(state: GameState) {
  const quiz = toQuiz(state)
  const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
  return confirmBoth(settle).state
}

/** 本轮的 ROUND_SCORED，用来一次断言完得分和判定依据。 */
function scoredOf(events: GameEvent[]) {
  return events.find((e) => e.type === 'ROUND_SCORED')
}

/**
 * 把局面推到第 n 轮的出牌阶段：中间几轮双方都不出牌，场上的 AI 全部答对，双方确认后进下一轮。
 *
 * 用它是为了攒 Token 上限（第 1 轮 INITIAL_TOKEN_MAX 点，之后每轮 +TOKEN_MAX_GROWTH）。
 * 「复读机」一张 4 点，要连打两张就得等额度攒到 8 点，也就是第 4 轮。
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
    // execute 回的是一份新克隆，改它不会污染传进来的 state。
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
 * 这批技能用例给双方发的 Token 额度。
 *
 * 按正常规则第 5 轮也才 INITIAL_TOKEN_MAX + 4 × TOKEN_MAX_GROWTH 点，而这里好几个用例要在
 * 一轮里连打两三张技能牌（光金钟罩一张就 7 点）。额度怎么涨另有专门的用例守着，
 * 这批直接把上限撑到管够，免得断言挂在"打不起"这种和被测效果无关的地方。
 */
const SKILL_TEST_TOKENS = 12

/**
 * 摆一个双方都不带英雄、额度已经撑到 SKILL_TEST_TOKENS 的出牌阶段局面。
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
  const state = toRound(game.state, round)
  for (const player of state.players) {
    // 比分抹平：toRound 每推一轮双方各 +1 分（双方同错、消耗都是 0，判成 equal-tokens），
    // 推到第 4 轮就已经 3:3。这批用例再分出个高低就会触发 WIN_TARGET 当场收场，
    // 后面"进下一轮才清标记"的断言全落在一个已经 finished 的局面上。
    player.score = 0
    player.tokenMax = SKILL_TEST_TOKENS
    player.tokens = SKILL_TEST_TOKENS
  }
  return state
}

function rejection(result: { events: GameEvent[] }): string | undefined {
  const rejected = result.events.find((e) => e.type === 'COMMAND_REJECTED')
  return rejected?.reason
}

/** 给甲凭空造一张和乙同费用的 AI 并打出去，让本轮双方消耗持平。 */
function matchFoeAi(state: GameState, cardId: CardId): GameState {
  const added = execute(state, { type: 'DEBUG_ADD_CARD', player: 0, cardId }).state
  return execute(added, {
    type: 'DEBUG_PLAY_CARD',
    player: 0,
    instanceId: added.players[0].hand.at(-1)!.instanceId,
  }).state
}

/**
 * 摆一个「乙场上两个 AI、轮到甲出牌、甲满手复读机」的第 4 轮局面。
 *
 * 摆法绕了一点，是因为三件事必须同时成立：
 * - 「复读机」一张 4 点，而有的用例要在一轮里连打两张，得等额度攒到 8 点，也就是第 4 轮；
 * - 一路推到第 4 轮的过程中不能有人先到 WIN_TARGET 分把对局结束掉。所以每轮都让甲跟着乙
 *   打一张同费用的 AI：双方同对、消耗相同，判成 equal-tokens 各 +1，分数一直咬平
 *   （3:3 也不算分出胜负，见 engine 的 decided），对局才走得到第 4 轮。
 *
 * 甲的 AI 用调试指令凭空造（它牌组里全是复读机），乙的第二张也走调试指令：
 * 这两下都只免掉"轮到谁出牌"，费用照旧生效。
 */
function stageTwoFoeAis(start: GameState, foeAi: CardId): GameState {
  // 第 1 轮乙先手派一张，甲跟一张。
  const round1 = matchFoeAi(
    execute(start, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: handCard(start, 1, foeAi).instanceId,
    }).state,
    foeAi,
  )
  // 第 2 轮换甲先手，乙靠调试指令补上第二张，甲再跟一张。
  const round2 = nextRound(round1)
  const staged = matchFoeAi(
    execute(round2, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(round2, 1, foeAi).instanceId,
    }).state,
    foeAi,
  )
  // 第 3 轮双方都不出牌（消耗同为 0，照样各 +1），确认完就是要的那个第 4 轮局面。
  return toRound(nextRound(staged), 4)
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
      // 关键词和类别一样，出牌阶段就公开：玩家要靠它决定派谁上场。
      keywords: state.questions[0]!.keywords,
    })
    expect(events.at(-1)).toEqual({ type: 'PLAY_TURN_STARTED', player: 0 })
  })

  it('ROUND_STARTED 带的关键词是题目自己那一份的拷贝，改事件改不到题库', () => {
    const { state, events } = newGame()
    const started = events.find((e) => e.type === 'ROUND_STARTED')!
    expect(started.keywords).toEqual(state.questions[0]!.keywords)
    expect(started.keywords).not.toBe(state.questions[0]!.keywords)
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

describe('开局的两个覆盖项（教程要用）', () => {
  it('指定先手就不掷硬币，GAME_STARTED 照常带 firstPlayer', () => {
    for (const seat of [0, 1] as const) {
      const { state, events } = newGame({ firstPlayer: seat })
      expect(state.firstPlayer).toBe(seat)
      expect(state.activePlayer).toBe(seat)
      expect(events[0]).toEqual({ type: 'GAME_STARTED', firstPlayer: seat })
    }
  })

  it('指定先手不消耗随机数：换个先手不会连带把牌堆和题序也洗成另一副', () => {
    // 抛硬币是整个跳过的（不是掷完丢掉），所以这一掷不再推进 rng：
    // 同一个种子下改先手，后面洗出来的牌堆和题序一字不差。
    // 教程排剧本时才能"先定牌序，再单独安排谁先手"，两件事互不牵连。
    const zero = newGame({ firstPlayer: 0 }).state
    const one = newGame({ firstPlayer: 1 }).state
    expect([zero.firstPlayer, one.firstPlayer]).toEqual([0, 1])
    expect(one.questions.map((q) => q.id)).toEqual(zero.questions.map((q) => q.id))
    for (const seat of [0, 1] as const) {
      expect(one.players[seat].deck.map((c) => c.cardId)).toEqual(
        zero.players[seat].deck.map((c) => c.cardId),
      )
    }
  })

  it('noShuffle 时牌组和题库都按传入顺序原样使用，抽牌从末尾取', () => {
    // 牌堆顶在数组末尾，所以起手 5 张就是牌组倒过来的最后 5 张。
    const deck: CardId[] = [
      ...deckOf('gpt-2', 5),
      'chatgpt-5-6-sol',
      'claude-5-sonnet',
      'deepseek-r1',
      'gpt-3-5',
      'gpt-4o',
    ]
    const { state } = newGame({ deck0: deck, deck1: deck, noShuffle: true })
    expect(state.players[0].hand.map((c) => c.cardId)).toEqual([
      'gpt-4o',
      'gpt-3-5',
      'deepseek-r1',
      'claude-5-sonnet',
      'chatgpt-5-6-sol',
    ])
    // 剩下的牌堆保持原序，末尾仍然是下一张要抽的。
    expect(state.players[0].deck.map((c) => c.cardId)).toEqual(deckOf('gpt-2', 5))
    // 题库按原序逐轮取，questions[0] 就是题库第一道。
    expect(state.questions.map((q) => q.id)).toEqual(QUESTION_POOL.map((q) => q.id))
  })

  it('noShuffle 下换种子也是同一副牌：随机彻底不参与', () => {
    const a = newGame({ noShuffle: true, firstPlayer: 0, seed: 1 }).state
    const b = newGame({ noShuffle: true, firstPlayer: 0, seed: 12345 }).state
    expect(a.players[0].hand.map((c) => c.cardId)).toEqual(b.players[0].hand.map((c) => c.cardId))
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id))
  })
})

describe('出牌阶段', () => {
  it('技能牌 Token 够就想打几张打几张，AI 牌上场、技能牌进弃牌堆', () => {
    // 不洗牌，把起手固定成「1 张 AI + 4 张技能」：两种牌都只要 1 点，
    // 第 1 轮的 5 点正好全买下（牌堆顶在数组末尾，见 GameSetup.noShuffle）。
    const game = newGame({
      noShuffle: true,
      deck0: [...deckOf('gpt-2', 7), ...deckOf('one-sentence-answer', 4), 'gpt-2'],
    })
    expect(game.state.players[0].hand.map((c) => c.cardId)).toEqual([
      'gpt-2',
      'one-sentence-answer',
      'one-sentence-answer',
      'one-sentence-answer',
      'one-sentence-answer',
    ])
    const result = run(
      game.state,
      game.state.players[0].hand.map((card) => ({
        type: 'PLAY_CARD',
        player: 0,
        instanceId: card.instanceId,
      })),
    )

    const player = result.state.players[0]
    expect(player.hand).toHaveLength(0)
    expect(player.tokens).toBe(0)
    expect(player.spentThisRound).toBe(INITIAL_TOKEN_MAX)
    expect(player.board.map((a) => a.cardId)).toEqual(['gpt-2'])
    expect(player.board.every((a) => a.owner === 0)).toBe(true)
    // 出牌不推进阶段，出完还是自己在出。
    expect(result.state.activePlayer).toBe(0)
    expect(result.state.phase).toBe('play')
    expect(result.events.some((e) => e.type === 'COMMAND_REJECTED')).toBe(false)

    expect(result.events.filter((e) => e.type === 'AI_DEPLOYED')).toHaveLength(1)
    const skills = result.events.filter((e) => e.type === 'SKILL_PLAYED')
    expect(skills).toHaveLength(4)
    expect(skills).toHaveLength(player.discard.length)
    expect(player.discard.every((c) => c.cardId === 'one-sentence-answer')).toBe(true)
    // 每条事件都报出了那张牌自己的实例 id，客户端才能在手牌里把它揪出来播动画。
    expect(skills.map((e) => e.instanceId).sort()).toEqual(
      player.discard.map((c) => c.instanceId).sort(),
    )
  })

  it('起手就是 STARTING_HAND_SIZE 张，出一张少一张', () => {
    const game = newGame({ deck0: deckOf('gpt-2') })
    expect(game.state.players[0].hand).toHaveLength(STARTING_HAND_SIZE)
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: game.state.players[0].hand[0]!.instanceId,
    })
    expect(result.state.players[0].hand).toHaveLength(STARTING_HAND_SIZE - 1)
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

describe('一轮里派几张新 AI 都行', () => {
  it('第二张 AI 牌照常打得出，两张一起进场', () => {
    // GPT-2 只要 1 点，第 1 轮的 5 点连打两张还有富余：唯一能拦住第二张的只有费用。
    const game = newGame({ deck0: deckOf('gpt-2'), noShuffle: true })
    const [first, second] = game.state.players[0].hand
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: first!.instanceId,
    }).state

    const again = execute(played, { type: 'PLAY_CARD', player: 0, instanceId: second!.instanceId })
    expect(again.events.map((e) => e.type)).toEqual(['AI_DEPLOYED'])
    expect(board(again.state, 0)).toHaveLength(2)
    // 两张各扣各的费，本轮消耗是两张之和（同对同错时比的就是它）。
    expect(again.state.players[0].tokens).toBe(INITIAL_TOKEN_MAX - 2)
    expect(again.state.players[0].spentThisRound).toBe(2)
  })

  it('拦住第二张的只剩 Token：额度花光了才被拒', () => {
    // ChatGPT 5.6 Sol 一张 7 点，第 1 轮只有 5 点，第一张就打不起；
    // 换成 4 点的 GPT-4o，打完只剩 1 点，第二张被拒的理由是费用而不是张数。
    const game = newGame({ deck0: deckOf('gpt-4o'), noShuffle: true })
    const [first, second] = game.state.players[0].hand
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: first!.instanceId,
    }).state
    expect(played.players[0].tokens).toBe(INITIAL_TOKEN_MAX - 4)

    expect(
      execute(played, { type: 'PLAY_CARD', player: 0, instanceId: second!.instanceId }).events,
    ).toEqual([{ type: 'COMMAND_REJECTED', reason: 'Token 不够：这张牌要 4 点，只剩 1 点' }])
  })

  it('跨轮累积：上一轮那张留场，这一轮接着派', () => {
    const game = newGame({ deck0: deckOf('gpt-2'), deck1: deckOf('gpt-2'), noShuffle: true })
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: game.state.players[0].hand[0]!.instanceId,
    }).state
    const round2 = nextRound(played)

    expect(round2.round).toBe(2)
    const again = execute(round2, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(round2, 0, 'gpt-2').instanceId,
    })
    expect(again.events.map((e) => e.type)).toEqual(['AI_DEPLOYED'])
    expect(board(again.state, 0)).toHaveLength(2)
  })
})

describe('要选目标的技能牌', () => {
  /**
   * 摆一个「甲满手复读机、乙场上两个 AI」的出牌阶段局面。
   *
   * 乙的 AI 用调试指令上场：这时行动方是甲，走正常出牌轮不到乙。
   * 双方都不带英雄：默认英雄格蕾丝·霍珀会抵消对方本局第一张技能牌，
   * 而抵消掉的技能不留 interference（见 playCard），那样这一组用例测的就不是目标规则了。
   * 抵消和目标撞在一起的情况单独有一节（见下面「英雄抵消 × 要选目标的技能牌」）。
   */
  function foeHasAis() {
    const game = newGame({
      firstPlayer: 1,
      deck0: deckOf('fixed-answer'),
      // 乙用 1 点的 GPT-2 摆场，甲每轮跟一张同费用的，双方消耗一直持平。
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
    })
    return stageTwoFoeAis(game.state, 'gpt-2')
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

  it('打中之后目标被标上是哪张干扰牌，事件带上目标 id', () => {
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
    // 摆法同上一节的 foeHasAis，只是乙留着默认英雄。
    // 甲在这段摆盘里只打 AI 牌、一张技能都不打，乙的 Debug 才会原封不动留给下面的用例。
    const game = newGame({
      firstPlayer: 1,
      deck0: deckOf('fixed-answer'),
      deck1: deckOf('gpt-3-5'),
      hero0: null,
    })
    return stageTwoFoeAis(game.state, 'gpt-3-5')
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
      correct: [false, true],
      gains: [0, 1],
      verdict: 'sole-correct',
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
    expect(shielded.players[0].tokens).toBe(SKILL_TEST_TOKENS - 1 - 7)

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
    // 两张金钟罩要 14 点，比这批用例发的 SKILL_TEST_TOKENS 还多，得先用模型蒸馏把额度顶上去
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
    expect(shielded.players[0].tokens).toBe(SKILL_TEST_TOKENS - (getCard('golden-bell-shield').tokenCost - 1))
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
    expect(played.players[1].tokens).toBe(SKILL_TEST_TOKENS - 3)
    // 记账的两处用的是同一个实际费用，结算时的"本轮消耗"也跟着便宜。
    expect(played.players[1].spentThisRound).toBe(3)
  })

  it('可以叠加：打两张就减 2', () => {
    const first = playSkill(skillGame(), 0, 'nuclear-power-station').state
    const second = playSkill(first, 0, 'nuclear-power-station').state

    expect(second.costReduction).toBe(2)
    expect(effectivePlayCost(second, 0, getCard('gpt-4o'))).toBe(2)
    // 第二张自己也吃了第一张的减免：4 点的牌先花 4 再花 3。
    expect(second.players[0].tokens).toBe(SKILL_TEST_TOKENS - 4 - 3)
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
    // SKILL_TEST_TOKENS - 1（这张技能牌）+ 7 + 1。换来的按印刷费用算，不吃核电站的减费。
    expect(player.tokens).toBe(SKILL_TEST_TOKENS - 1 + getCard('chatgpt-5-6-sol').tokenCost + 1)
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
    // ChatGPT 5.6 Sol 要 7 点，第 1 轮只有 5 点，怎么都打不出。
    const game = newGame({ deck0: deckOf('chatgpt-5-6-sol') })
    const card = handCard(game.state, 0, 'chatgpt-5-6-sol')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(result.events).toEqual([
      {
        type: 'COMMAND_REJECTED',
        reason: `Token 不够：这张牌要 7 点，只剩 ${INITIAL_TOKEN_MAX} 点`,
      },
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
    // 甲先用 4 点买一张 GPT-4o，第 1 轮的 5 点只剩 1 点，买不起 4 点的「复读机」。
    const added = run(foeAi, [{ type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-4o' }]).state
    const drained = execute(added, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(added, 0, 'gpt-4o').instanceId,
    }).state
    expect(drained.players[0].tokens).toBe(INITIAL_TOKEN_MAX - getCard('gpt-4o').tokenCost)

    // 这一张连目标都没给，但报的是费用不够——费用那道闸排在前面。
    const skill = handCard(drained, 0, 'fixed-answer')
    const result = execute(drained, { type: 'PLAY_CARD', player: 0, instanceId: skill.instanceId })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: 'Token 不够：这张牌要 4 点，只剩 1 点' },
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

  it('上限逐轮线性增长：第 n 轮是 INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH × (n - 1)', () => {
    // 双方都不出牌 = 消耗都是 0，每轮都是 equal-tokens 各 +1，
    // 所以第 3 轮结束时双方 3:3 要加赛，一路打到题库出完才收场。
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
    expect(maxes).toEqual(maxes.map((_, index) => INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH * index))
    expect(maxes).toHaveLength(state.totalRounds)
  })
})

describe('本轮 Token 消耗（spentThisRound）', () => {
  it('AI 牌和技能牌都累加，每轮清零', () => {
    // 起手固定成「GPT-2（1 点）+ 复读机（4 点）+ 3 张 GPT-2」：那两张正好花光第 1 轮的 5 点。
    // 对面摆个 AI 好让复读机挑得到目标。
    const game = newGame({
      noShuffle: true,
      deck0: [...deckOf('gpt-2', 10), 'fixed-answer', 'gpt-2'],
      deck1: deckOf('gpt-2'),
      // 乙不带英雄，免得 Debug 把那张技能牌抵消掉——抵消也计消耗是下一条用例的事。
      hero1: null,
    })
    const foeAi = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(game.state, 1, 'gpt-2').instanceId,
    }).state
    expect(foeAi.players[0].spentThisRound).toBe(0)

    const withAi = execute(foeAi, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(foeAi, 0, 'gpt-2').instanceId,
    }).state
    expect(withAi.players[0].spentThisRound).toBe(1)

    const withSkill = execute(withAi, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(withAi, 0, 'fixed-answer').instanceId,
      targetInstanceId: board(withAi, 1)[0]!.instanceId,
    }).state
    expect(withSkill.players[0].spentThisRound).toBe(5)
    // 两边各记各的：乙只打了那张 1 点的 GPT-2，不受甲花了多少影响。
    expect(withSkill.players[1].spentThisRound).toBe(getCard('gpt-2').tokenCost)

    // 下一轮从头算。
    const round2 = nextRound(withSkill)
    expect(round2.players.map((p) => p.spentThisRound)).toEqual([0, 0])
  })

  it('技能牌被英雄技能抵消也计入：Token 是真花出去的，作废的只是效果', () => {
    // 乙带默认英雄格蕾丝·霍珀，会抵消甲本局第一张技能牌。
    const game = newGame({ deck0: deckOf('one-sentence-answer'), hero0: null })
    const card = handCard(game.state, 0, 'one-sentence-answer')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(result.events.some((e) => e.type === 'SKILL_CANCELED')).toBe(true)
    expect(result.state.players[0].spentThisRound).toBe(getCard('one-sentence-answer').tokenCost)
    expect(result.state.players[0].tokens).toBe(
      INITIAL_TOKEN_MAX - getCard('one-sentence-answer').tokenCost,
    )
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
  /**
   * 摆一个答题阶段：双方各派一张 AI，然后都结束出牌。
   *
   * 用不洗牌的单卡牌组，本轮消耗就正好等于那张 AI 的费用，Token 决胜那几条好对账。
   */
  function duel(card0: CardId, card1: CardId) {
    const game = newGame({ deck0: deckOf(card0), deck1: deckOf(card1), noShuffle: true })
    return run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: game.state.players[0].hand[0]!.instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'PLAY_CARD', player: 1, instanceId: game.state.players[1].hand[0]!.instanceId },
      { type: 'END_PLAY', player: 1 },
    ]).state
  }

  /**
   * 摆一个"甲两个 AI、乙一个 AI"的答题阶段局面，停在第 2 轮。
   *
   * 甲那两个分两轮上场，这个局面天然是跨轮的：
   * 第 1 轮甲派 GPT-3.5（2 点）、乙派 Claude 5 Sonnet（4 点），双方都答对，
   * 消耗少的甲拿下第 1 分（比分 1:0）；第 2 轮甲再派一张 GPT-3.5（2 点），乙不出牌（0 点）。
   * 所以进第 2 轮答题时：场上 2 对 1，本轮消耗 2 对 0，比分 1:0——下面的用例都从这个基准往下算。
   */
  function twoVsOne() {
    const game = newGame({ deck0: deckOf('gpt-3-5'), deck1: deckOf('claude-5-sonnet') })
    const quizR1 = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: game.state.players[0].hand[0]!.instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'PLAY_CARD', player: 1, instanceId: game.state.players[1].hand[0]!.instanceId },
      { type: 'END_PLAY', player: 1 },
    ]).state
    const settledR1 = execute(quizR1, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quizR1),
    }).state
    // 第 2 轮换乙先手：乙直接过，甲再派一张，然后进答题。
    const round2 = confirmBoth(settledR1).state
    return run(round2, [
      { type: 'END_PLAY', player: 1 },
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(round2, 0, 'gpt-3-5').instanceId },
      { type: 'END_PLAY', player: 0 },
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
    // 甲有一个答错被罚下，但"己方答对"是团队口径，另一个答对了就算甲答对。
    // 双方同对就改比本轮消耗：甲花了 2 点、乙一点没花，这一分归乙，比分从 1:0 变成 1:1。
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
      {
        type: 'ROUND_SCORED',
        gains: [0, 1],
        scores: [1, 1],
        correct: [true, true],
        spent: [2, 0],
        verdict: 'fewer-tokens',
      },
    ])

    // 计分完就停下等确认：这一批里没有下一轮的任何动静。
    expect(result.state.phase).toBe('settle')
    expect(result.state.settleConfirmed).toEqual([false, false])
    expect(result.state.round).toBe(2)
    expect(result.state.firstPlayer).toBe(1)
    expect(result.events.some((e) => e.type === 'ROUND_STARTED')).toBe(false)
    expect(result.events.some((e) => e.type === 'CARD_DRAWN')).toBe(false)
  })

  it('只有一方答对时那方 +1，消耗一样多也不改判', () => {
    // 双方都花 2 点，但只有甲答对——sole-correct 排在比 Token 之前。
    const quiz = duel('gpt-3-5', 'gpt-3-5')
    const result = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [board(quiz, 1)[0]!.instanceId]),
    })
    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 0],
      scores: [1, 0],
      correct: [true, false],
      spent: [2, 2],
      verdict: 'sole-correct',
    })
  })

  it('「己方答对」是团队口径：有一个答对就算，另一个答错照样罚下', () => {
    // 两个 AI 分两轮派，测的是跨轮留场的那一个也算进团队口径。
    const game = newGame({ deck0: deckOf('gpt-2'), deck1: deckOf('gpt-2'), noShuffle: true })
    const first = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: game.state.players[0].hand[0]!.instanceId,
    }).state
    const round2 = nextRound(first)
    const both = execute(round2, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(round2, 0, 'gpt-2').instanceId,
    }).state
    expect(board(both, 0)).toHaveLength(2)

    const quiz = toQuiz(both)
    const doomed = board(quiz, 0)[1]!
    const result = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [doomed.instanceId]),
    })

    // 答错的那个照常罚下，但本轮判定看的是"至少一个答对"。
    expect(board(result.state, 0)).toHaveLength(1)
    expect(scoredOf(result.events)!.correct).toEqual([true, false])
    expect(scoredOf(result.events)!.gains).toEqual([1, 0])
  })

  it('双方都答对时比本轮消耗，少的一方 +1', () => {
    // 甲的 GPT-2 花 1 点，乙的 GPT-4o 花 4 点。
    const quiz = duel('gpt-2', 'gpt-4o')
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })

    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 0],
      scores: [1, 0],
      correct: [true, true],
      spent: [1, 4],
      verdict: 'fewer-tokens',
    })
    // 都答对，谁都没被罚下。
    expect([board(result.state, 0).length, board(result.state, 1).length]).toEqual([1, 1])
  })

  it('双方都答错时同样比本轮消耗，少的一方 +1', () => {
    const quiz = duel('gpt-4o', 'gpt-2')
    const result = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [board(quiz, 0)[0]!.instanceId, board(quiz, 1)[0]!.instanceId]),
    })

    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [0, 1],
      scores: [0, 1],
      correct: [false, false],
      spent: [4, 1],
      verdict: 'fewer-tokens',
    })
    // 两个都答错、两个都被罚下，场面清空。
    expect([board(result.state, 0).length, board(result.state, 1).length]).toEqual([0, 0])
  })

  it('结果相同且消耗也相同时双方各 +1', () => {
    const quiz = duel('gpt-3-5', 'gpt-3-5')
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 1],
      scores: [1, 1],
      correct: [true, true],
      spent: [2, 2],
      verdict: 'equal-tokens',
    })
  })

  it('场上没有 AI 的一方算没答对', () => {
    // 甲派一张答对，乙一张都没派：乙一条 AI_ANSWERED 都没有，判定里仍然是"没答对"。
    const game = newGame({ deck0: deckOf('gpt-2'), noShuffle: true })
    const quiz = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: game.state.players[0].hand[0]!.instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'END_PLAY', player: 1 },
    ]).state
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })

    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 0],
      scores: [1, 0],
      correct: [true, false],
      spent: [1, 0],
      verdict: 'sole-correct',
    })
  })

  it('双方场上都没有 AI 时提交空结果：同错同消耗，各 +1，对局继续', () => {
    // 两边都没答对、都没花钱，按规则就是 equal-tokens 各 +1，而不是各 0 分。
    const quiz = toQuiz(newGame().state)
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] })

    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 1],
      scores: [1, 1],
      correct: [false, false],
      spent: [0, 0],
      verdict: 'equal-tokens',
    })
    // 计分完停在 settle，双方确认过才进第 2 轮。
    expect(result.state.phase).toBe('settle')
    const next = confirmBoth(result.state).state
    expect(next.round).toBe(2)
    expect(next.phase).toBe('play')
  })

  it('答对数多不再直接拿分：团队口径下双方都算答对，改比本轮消耗', () => {
    // 甲场上 2 个、乙场上 1 个，全部答对。旧规则比的是答对**个数**，那甲稳赢；
    // 现在只问"这一方有没有答对"，双方都算答对，于是改比本轮消耗——
    // 甲这一轮花了 2 点、乙一点没花，这一分反而归乙。
    const quiz = twoVsOne()
    const first = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(scoredOf(first.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [0, 1],
      scores: [1, 1],
      correct: [true, true],
      spent: [2, 0],
      verdict: 'fewer-tokens',
    })

    // 下一轮双方都不再出牌，场上还是留下来的那三个 AI：同对同消耗，各 +1，得分照常累加。
    const round3 = confirmBoth(first.state).state
    const second = execute(toQuiz(round3), {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(round3),
    })
    expect(second.state.players.map((p) => p.score)).toEqual([2, 2])
  })

  it('双方确认后才交换先后手、各补 ROUND_DRAW_SIZE 张牌、宣告下一轮', () => {
    const quiz = duel('gpt-3-5', 'claude-5-sonnet')
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
      keywords: result.state.questions[1]!.keywords,
    })
    expect(result.events.at(-1)).toEqual({ type: 'PLAY_TURN_STARTED', player: 1 })
  })

  it('结果与场上 AI 对不上时整条拒绝', () => {
    const quiz = duel('gpt-3-5', 'claude-5-sonnet')
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
        results: [full[0]!, full[0]!],
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
    expect(settle.players.map((p) => p.spentThisRound)).toEqual([2, 2])
    const handsBefore = settle.players.map((p) => p.hand.length)
    const result = confirmBoth(settle)

    expect(result.state.phase).toBe('play')
    expect(result.state.round).toBe(2)
    expect(result.state.settleConfirmed).toEqual([true, true])
    for (const player of result.state.players) {
      expect(player.tokenMax).toBe(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
      expect(player.tokens).toBe(player.tokenMax)
      expect(player.spentThisRound).toBe(0)
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
   *
   * 列表里 AI 牌和技能牌都不限张数，正好用来测"技能牌也计入本轮消耗"。
   * 双方都不带英雄：默认英雄会抵消对方第一张技能牌，那样测的就不是消耗口径了。
   */
  function scoreWith(cards0: CardId[], cards1: CardId[]) {
    const game = newGame({
      deck0: deckOf('gpt-2'),
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
    })
    const both = deploy(deploy(game.state, 0, cards0), 1, cards1)
    const quiz = execute(both, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    return execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
  }

  function scoredEvent(result: ReturnType<typeof scoreWith>) {
    return result.events.find((e) => e.type === 'ROUND_SCORED')
  }

  it('spent 就是本轮打出的牌的费用和，技能牌也算在内', () => {
    // 「一句话回答」1 点：它不上场，所以不影响"这一方答没答对"，但照样计入消耗，
    // 于是甲多花了这 1 点，同对同错时的第二判据就倒向乙。
    const result = scoreWith(['gpt-2', 'one-sentence-answer'], ['gpt-2'])
    expect(scoredEvent(result)).toEqual({
      type: 'ROUND_SCORED',
      gains: [0, 1],
      scores: [0, 1],
      correct: [true, true],
      spent: [2, 1],
      verdict: 'fewer-tokens',
    })
  })

  it('进下一轮后本轮消耗清零，上一轮的花费不会带过来', () => {
    const settle = scoreWith(['gpt-2'], ['gpt-3-5']).state
    expect(settle.players.map((p) => p.spentThisRound)).toEqual([1, 2])

    const round2 = confirmBoth(settle).state
    expect(round2.players.map((p) => p.spentThisRound)).toEqual([0, 0])

    // 第 2 轮甲什么都不打、乙打一张：上一轮的消耗要是带过来了，判据就不会倒向甲。
    const deployed = deploy(round2, 1, ['gpt-2'])
    const quiz = execute(deployed, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const scored = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(scoredEvent(scored)).toMatchObject({
      correct: [true, true],
      spent: [0, 1],
      gains: [1, 0],
      verdict: 'fewer-tokens',
    })
  })
})

describe('胜负', () => {
  /**
   * 一局"甲一路碾压"的对局：甲开局派一张 AI 并一直答对，乙场上永远空着。
   * 于是每轮都是 sole-correct，甲每轮 +1，第 3 轮结束就该收场。
   *
   * 每轮结算完都要双方确认才推进，所以循环里"算分"和"确认"是分开的两步。
   */
  function shutout(questions?: Question[]) {
    const game = newGame({
      deck0: deckOf('gpt-2'),
      noShuffle: true,
      ...(questions === undefined ? {} : { questions }),
    })
    let state = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: game.state.players[0].hand[0]!.instanceId,
    }).state
    const events: GameEvent[] = []
    // 之后每轮双方都不再出牌：甲那张 AI 留在场上继续答对，乙一直是空场。
    for (let step = 0; step < 20 && state.phase !== 'finished'; step++) {
      const quiz = toQuiz(state)
      const scored = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
      events.push(...scored.events)
      const confirmed = confirmBoth(scored.state)
      state = confirmed.state
      events.push(...confirmed.events)
    }
    return { state, events }
  }

  it('先到 WIN_TARGET 分就结束，题库还剩题也照样收场', () => {
    const { state, events } = shutout()
    expect(state.totalRounds).toBe(QUESTION_POOL.length)

    expect(state.phase).toBe('finished')
    expect(state.winner).toBe(0)
    expect(state.players.map((p) => p.score)).toEqual([WIN_TARGET, 0])
    // 三轮打完就收，题库里还剩两道没用上。
    expect(state.round).toBe(WIN_TARGET)
    expect(state.round).toBeLessThan(state.totalRounds)
    expect(events.filter((e) => e.type === 'ROUND_SCORED')).toHaveLength(WIN_TARGET)
    expect(events.at(-1)).toEqual({ type: 'GAME_OVER', winner: 0 })
    // 打完了就不再宣告下一轮，也不补牌。
    const tail = events.slice(events.findIndex((e) => e.type === 'GAME_OVER'))
    expect(tail.some((e) => e.type === 'ROUND_STARTED')).toBe(false)
  })

  it('双方同时到 WIN_TARGET 分不算结束，继续加赛到有人单独领先', () => {
    // 双方都不出牌 = 同错同消耗，每轮 equal-tokens 各 +1，三轮打完是 3:3。
    // 甲用单卡牌组，加赛那一轮手上必定还有 GPT-2 可派。
    let state = newGame({ deck0: deckOf('gpt-2'), noShuffle: true }).state
    for (let round = 0; round < WIN_TARGET; round++) {
      const quiz = toQuiz(state)
      const scored = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state
      state = confirmBoth(scored).state
    }
    expect(state.players.map((p) => p.score)).toEqual([WIN_TARGET, WIN_TARGET])
    expect(state.phase).toBe('play')
    expect(state.winner).toBeNull()
    expect(state.round).toBe(WIN_TARGET + 1)

    // 加赛这一轮甲派一张 AI 并答对，乙仍然空场：4:3，这才分出胜负。
    const played = execute(state, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(state, 0, 'gpt-2').instanceId,
    }).state
    const quiz = toQuiz(played)
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    // 算完分只到 settle，终局要等双方点确认。
    expect(settle.state.phase).toBe('settle')
    expect(settle.events.some((e) => e.type === 'GAME_OVER')).toBe(false)

    const result = confirmBoth(settle.state)
    expect(result.state.phase).toBe('finished')
    expect(result.state.winner).toBe(0)
    expect(result.state.players.map((p) => p.score)).toEqual([WIN_TARGET + 1, WIN_TARGET])
  })

  it('题库出完还没人到线时保底判：总分高的一方获胜', () => {
    // 只有两道题，甲连拿两分也到不了 3 分，靠"题出完了"这条兜底收场。
    const { state } = shutout(QUESTION_POOL.slice(0, 2))
    expect(state.phase).toBe('finished')
    expect(state.round).toBe(state.totalRounds)
    expect(state.players.map((p) => p.score)).toEqual([2, 0])
    expect(state.winner).toBe(0)
  })

  it('题库出完且总分相同时才是平局', () => {
    // 双方一张牌都不打，每轮 equal-tokens 各 +1，一路打到题库出完仍然同分。
    let state = newGame().state
    const events: GameEvent[] = []
    while (state.phase !== 'finished') {
      const quiz = toQuiz(state)
      const scored = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] })
      events.push(...scored.events)
      const confirmed = confirmBoth(scored.state)
      state = confirmed.state
      events.push(...confirmed.events)
    }

    expect(state.round).toBe(state.totalRounds)
    expect(state.players.map((p) => p.score)).toEqual([
      QUESTION_POOL.length,
      QUESTION_POOL.length,
    ])
    expect(state.winner).toBe('draw')
    expect(events.at(-1)).toEqual({ type: 'GAME_OVER', winner: 'draw' })
  })

  it('对局结束后一切指令都被拒', () => {
    const finished = shutout(QUESTION_POOL.slice(0, 1)).state
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
          // Token 不够的牌跳过：硬打会被拒。客户端那边这些牌是画成灰的、根本拖不动。
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
    // 现在不一定打满题库：先到 WIN_TARGET 分就收场，所以只能断言没超。
    expect(state.round).toBeLessThanOrEqual(state.totalRounds)
    expect(state.winner).not.toBeNull()
    expect(events.filter((e) => e.type === 'ROUND_SCORED')).toHaveLength(state.round)
    // 每轮两条确认，一条都不能少。
    expect(events.filter((e) => e.type === 'ROUND_CONFIRMED')).toHaveLength(state.round * 2)
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

describe('英雄技能：第一算法（阿达·洛芙莱斯）', () => {
  it('开局余额和上限都比对手多 2，而且这个差一直保持到整局结束', () => {
    const game = newGame({ hero0: 'ada-lovelace', hero1: null })
    const ada = game.state.players[0]
    expect(ada.tokenMax).toBe(INITIAL_TOKEN_MAX + ADA_TOKEN_MAX_BONUS)
    expect(ada.tokens).toBe(INITIAL_TOKEN_MAX + ADA_TOKEN_MAX_BONUS)
    expect(game.state.players[1].tokenMax).toBe(INITIAL_TOKEN_MAX)
    expect(game.state.players[1].tokens).toBe(INITIAL_TOKEN_MAX)

    // 进下一轮走的是 tokenMax += TOKEN_MAX_GROWTH 的增量逻辑，所以加高的起点会一路带下去：
    // 第 2 轮对手 6 点、她 8 点，恒多 2 而不是只多在第 1 轮。
    const quiz = toQuiz(game.state)
    const answered = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    const round2 = confirmBoth(answered).state
    expect(round2.round).toBe(2)
    expect(round2.players[0].tokenMax).toBe(
      INITIAL_TOKEN_MAX + ADA_TOKEN_MAX_BONUS + TOKEN_MAX_GROWTH,
    )
    expect(round2.players[0].tokens).toBe(round2.players[0].tokenMax)
    expect(round2.players[1].tokenMax).toBe(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
  })

  it('是被动，不占「每局一次」的标志，也发不出 USE_HERO_SKILL', () => {
    const game = newGame({ deck0: deckOf('gpt-2'), hero0: 'ada-lovelace', hero1: null })
    const card = handCard(game.state, 0, 'gpt-2')
    const state = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    }).state
    expect(state.players[0].heroSkillUsed).toBe(false)

    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '你的英雄没有可发动的技能' },
    ])
    expect(result.state).toBe(state)
  })
})

describe('英雄技能：升降级（陈丹琦 / 梅拉妮·珀金斯）', () => {
  /** 甲带陈丹琦、场上一个自己的 GPT-2；乙不带英雄，免得霍珀的抵消掺和进来。 */
  function upgraderWithOwnAi(cardId: CardId = 'gpt-2') {
    const game = newGame({ deck0: deckOf(cardId), hero0: 'danqi-chen', hero1: null })
    const card = handCard(game.state, 0, cardId)
    return execute(game.state, { type: 'PLAY_CARD', player: 0, instanceId: card.instanceId }).state
  }

  /** 甲带梅拉妮·珀金斯；乙场上一个 AI（用调试指令上场，因为这时是甲的出牌轮）。 */
  function downgraderWithFoeAi(cardId: CardId = 'gpt-3-5') {
    const game = newGame({ deck1: deckOf(cardId), hero0: 'melanie-perkins', hero1: null })
    const card = handCard(game.state, 1, cardId)
    return execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    }).state
  }

  it('升级把己方目标换成同系列下一代，完全免费也不结束出牌轮', () => {
    const state = upgraderWithOwnAi()
    const target = board(state, 0)[0]!
    const before = state.players[0]
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: target.instanceId,
    })

    const after = result.state.players[0]
    // 换的是 cardId 本身，levelShift 只是给界面画角标的净升降次数。
    expect(board(result.state, 0)).toEqual([
      { instanceId: target.instanceId, cardId: 'gpt-3-5', owner: 0, levelShift: 1 },
    ])
    expect(after.heroSkillUsed).toBe(true)
    // 免费：余额和本轮消耗都不动（打出那张 GPT-2 花掉的 1 点保持原样）。
    expect(after.tokens).toBe(before.tokens)
    expect(after.spentThisRound).toBe(before.spentThisRound)
    // 发动完还是自己的出牌轮，接着还能出牌。
    expect(result.state.activePlayer).toBe(0)
    expect(result.state.phase).toBe('play')
    expect(result.events).toEqual([
      {
        type: 'HERO_SKILL_USED',
        player: 0,
        heroId: 'danqi-chen',
        targetInstanceId: target.instanceId,
        fromCardId: 'gpt-2',
        toCardId: 'gpt-3-5',
        direction: 'upgrade',
      },
    ])
  })

  it('升级后答题按新卡的剧本走', () => {
    // 能力变化全靠"换成了另一张卡"：script.ts 那张静态表按 cardId 查，换完自然换了一整套回答。
    const state = upgraderWithOwnAi()
    const upgraded = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    }).state

    const question = upgraded.questions[0]!
    const [actual] = scriptedAnswers(question, board(upgraded, 0))
    const [asNewCard] = scriptedAnswers(question, [
      { instanceId: 'x', cardId: 'gpt-3-5', owner: 0 },
    ])
    const [asOldCard] = scriptedAnswers(question, [{ instanceId: 'x', cardId: 'gpt-2', owner: 0 }])
    expect(actual).toEqual({ ...asNewCard, instanceId: board(upgraded, 0)[0]!.instanceId })
    expect({ ...actual, instanceId: 'x' }).not.toEqual(asOldCard)
  })

  it('降级把对方目标换成同系列上一代', () => {
    const state = downgraderWithFoeAi()
    const target = board(state, 1)[0]!
    const foeBefore = state.players[1]
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: target.instanceId,
    })

    expect(board(result.state, 1)).toEqual([
      { instanceId: target.instanceId, cardId: 'gpt-2', owner: 1, levelShift: -1 },
    ])
    expect(result.state.players[0].heroSkillUsed).toBe(true)
    // 被降级的一方不退费也不扣费：他那张 GPT-3.5 的 2 点照旧记在账上。
    expect(result.state.players[1].tokens).toBe(foeBefore.tokens)
    expect(result.state.players[1].spentThisRound).toBe(foeBefore.spentThisRound)
    expect(result.events).toEqual([
      {
        type: 'HERO_SKILL_USED',
        player: 0,
        heroId: 'melanie-perkins',
        targetInstanceId: target.instanceId,
        fromCardId: 'gpt-3-5',
        toCardId: 'gpt-2',
        direction: 'downgrade',
      },
    ])
  })

  it('被干扰过的单位照样能升降级，两个标记互不影响', () => {
    // 乙先用「复读机」干扰甲场上的 GPT-2（乙不带英雄，所以这一张不会被抵消）。
    const state = upgraderWithOwnAi()
    const withSkill = run(state, [
      { type: 'DEBUG_ADD_CARD', player: 1, cardId: 'fixed-answer' },
    ]).state
    const skill = withSkill.players[1].hand.at(-1)!
    const interfered = execute(withSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: skill.instanceId,
      targetInstanceId: board(withSkill, 0)[0]!.instanceId,
    }).state
    expect(board(interfered, 0)[0]!.interference).toBe('fixed-answer')

    const result = execute(interfered, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(interfered, 0)[0]!.instanceId,
    })
    // 升级只换卡面身份，干扰标记原样跟着这个单位走：它升完照样只会答「香蕉」。
    expect(board(result.state, 0)[0]).toEqual({
      instanceId: board(interfered, 0)[0]!.instanceId,
      cardId: 'gpt-3-5',
      owner: 0,
      interference: 'fixed-answer',
      levelShift: 1,
    })
  })

  it('还没轮到自己出牌时被拒', () => {
    const game = newGame({
      deck0: deckOf('gpt-2'),
      hero0: 'danqi-chen',
      hero1: 'melanie-perkins',
    })
    const card = handCard(game.state, 0, 'gpt-2')
    const state = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    }).state

    // 乙的降级本来打得中甲这个单位，拦住他的是"没轮到你"。
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 1,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '还没轮到你出牌' }])
    expect(result.state).toBe(state)
  })

  it('出牌阶段之外发不出来', () => {
    const state = upgraderWithOwnAi()
    const quiz = toQuiz(state)
    const result = execute(quiz, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(quiz, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是出牌阶段' }])
    expect(result.state).toBe(quiz)
  })

  it('每局只能发一次', () => {
    const state = upgraderWithOwnAi()
    const once = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    }).state

    // 升成 GPT-3.5 之后链上还有下一代，所以这次被拒只可能是因为技能已经用过了。
    expect(upgradeTargetOf(board(once, 0)[0]!.cardId)).toBe('gpt-4o')
    const result = execute(once, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(once, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '英雄技能这一局已经用过了' },
    ])
    expect(result.state).toBe(once)
  })

  it('升级指向对方场上的单位时被拒', () => {
    const game = newGame({
      deck0: deckOf('gpt-2'),
      deck1: deckOf('gpt-3-5'),
      hero0: 'danqi-chen',
      hero1: null,
    })
    const theirs = handCard(game.state, 1, 'gpt-3-5')
    const state = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: theirs.instanceId,
    }).state

    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 1)[0]!.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '目标必须是你场上的 AI' }])
    expect(result.state).toBe(state)
  })

  it('降级指向自己场上的单位时被拒', () => {
    const state = downgraderWithFoeAi()
    const withMine = run(state, [{ type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-3-5' }]).state
    const mine = withMine.players[0].hand.at(-1)!
    const deployed = execute(withMine, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: mine.instanceId,
    }).state

    const result = execute(deployed, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(deployed, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '目标必须是对方场上的 AI' },
    ])
    expect(result.state).toBe(deployed)
  })

  it('目标不在场上时被拒', () => {
    const state = upgraderWithOwnAi()
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: '不存在',
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '目标必须是你场上的 AI' }])
    expect(result.state).toBe(state)
  })

  it('已经是链上最新一代时升不动', () => {
    // DeepSeek V4 要 5 点，第 1 轮的 4 点买不起，先推到第 2 轮的 6 点。
    // 先手每轮交换，所以这里得让乙先手，第 2 轮才轮得到甲出牌和发技能。
    const game = newGame({
      seed: SEED_FIRST_1,
      deck0: deckOf('deepseek-v4'),
      hero0: 'danqi-chen',
      hero1: null,
    })
    const round2 = toRound(game.state, 2)
    const card = handCard(round2, 0, 'deepseek-v4')
    const state = execute(round2, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    }).state

    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 AI 没有可升级的下一代' },
    ])
    expect(result.state).toBe(state)
  })

  it('没有同系列其它代的卡升不了', () => {
    const state = upgraderWithOwnAi('gemini')
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 AI 没有可升级的下一代' },
    ])
    expect(result.state).toBe(state)
  })

  it('已经是链上最早一代时降不动', () => {
    const state = downgraderWithFoeAi('gpt-2')
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 1)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 AI 没有可降级的上一代' },
    ])
    expect(result.state).toBe(state)
  })

  it('霍珀和没英雄的一方发这条指令都会被拒', () => {
    for (const hero of ['grace-hopper', null] as const) {
      const game = newGame({ deck0: deckOf('gpt-2'), hero0: hero, hero1: null })
      const card = handCard(game.state, 0, 'gpt-2')
      const state = execute(game.state, {
        type: 'PLAY_CARD',
        player: 0,
        instanceId: card.instanceId,
      }).state

      const result = execute(state, {
        type: 'USE_HERO_SKILL',
        player: 0,
        targetInstanceId: board(state, 0)[0]!.instanceId,
      })
      expect(result.events).toEqual([
        { type: 'COMMAND_REJECTED', reason: '你的英雄没有可发动的技能' },
      ])
      // 霍珀的 Debug 是另一条路（打技能牌时触发），标志不该被这条指令碰过。
      expect(result.state.players[0].heroSkillUsed).toBe(false)
      expect(result.state).toBe(state)
    }
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
    // 只守"两种干扰各配一句、都不为空"。句子本身是文案，会随设计改口吻
    //（复读机那句现在是利诱而不是命令，见 script.ts 的说明），断言原文只会挡住改文案。
    expect(Object.keys(INTERFERENCE_PROMPTS).sort()).toEqual([
      'black-white-reversal',
      'fixed-answer',
    ])
    for (const prompt of Object.values(INTERFERENCE_PROMPTS)) {
      expect(prompt.length).toBeGreaterThan(0)
    }
  })

  // 注入那句话是骗它的（编一条"答香蕉给双倍积分"的假规则），模型本可以不理；
  // 剧本模式没有模型可问，一律按"它上钩了"模拟，所以这里的结果是定死的。
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
