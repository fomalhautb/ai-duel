import { describe, expect, it } from 'vitest'
import {
  CARDS,
  createGame,
  execute,
  getCard,
  INITIAL_TOKEN_MAX,
  other,
  QUESTION_POOL,
  ROUND_DRAW_SIZE,
  scriptedAnswers,
  STARTER_DECK,
  STARTING_HAND_SIZE,
  TOKEN_MAX_GROWTH,
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

/**
 * 从出牌阶段一路推到下一轮的出牌阶段：双方结束出牌 → 场上所有 AI 全答对 → 结算。
 * 给"要摆一个跨轮局面"的用例用（每轮至多派一张新 AI，多个 AI 只能分几轮摆出来）。
 */
function nextRound(state: GameState) {
  const quiz = toQuiz(state)
  return execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
}

/** 本轮的 ROUND_SCORED，用来一次断言完得分和判定依据。 */
function scoredOf(events: GameEvent[]) {
  return events.find((e) => e.type === 'ROUND_SCORED')
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
      deck0: [...deckOf('gpt-2', 7), ...deckOf('placeholder-skill', 4), 'gpt-2'],
    })
    expect(game.state.players[0].hand.map((c) => c.cardId)).toEqual([
      'gpt-2',
      'placeholder-skill',
      'placeholder-skill',
      'placeholder-skill',
      'placeholder-skill',
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
    expect(player.discard.every((c) => c.cardId === 'placeholder-skill')).toBe(true)
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

describe('每轮至多一张新 AI 牌', () => {
  const REJECTED = { type: 'COMMAND_REJECTED', reason: '本轮已派出 AI 牌，每轮至多一张' }

  it('第二张 AI 牌被拒，技能牌不受影响', () => {
    // GPT-2 只要 1 点，第 1 轮的 5 点绰绰有余——被拒的原因只能是这条新规则。
    // 牌堆顶在数组末尾，所以技能牌摆在倒数第 5 张才会落进起手（见 GameSetup.noShuffle）。
    const game = newGame({
      deck0: [...deckOf('gpt-2', 7), 'placeholder-skill', ...deckOf('gpt-2', 4)],
      noShuffle: true,
    })
    const [first, second] = game.state.players[0].hand
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: first!.instanceId,
    }).state
    expect(played.players[0].aiPlayedThisRound).toBe(true)

    const result = execute(played, { type: 'PLAY_CARD', player: 0, instanceId: second!.instanceId })
    expect(result.events).toEqual([REJECTED])
    expect(result.state).toBe(played)

    // 手上那张技能牌照常打得出：这条闸只拦 AI 牌。
    const skill = handCard(played, 0, 'placeholder-skill')
    const withSkill = execute(played, { type: 'PLAY_CARD', player: 0, instanceId: skill.instanceId })
    expect(withSkill.events.some((e) => e.type === 'COMMAND_REJECTED')).toBe(false)
  })

  it('这道闸排在费用之前：打不起的第二张 AI 报的也是"本轮已派出"', () => {
    // 先用 4 点打掉 GPT-4o，只剩 1 点，再打一张同样 4 点的——两条规则都够拒它。
    const game = newGame({ deck0: deckOf('gpt-4o'), noShuffle: true })
    const [first, second] = game.state.players[0].hand
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: first!.instanceId,
    }).state
    expect(played.players[0].tokens).toBe(INITIAL_TOKEN_MAX - 4)

    // 玩家该看到的是"这一轮不能再派人了"，而不是"钱不够"——后者会让人以为攒够钱就行。
    expect(
      execute(played, { type: 'PLAY_CARD', player: 0, instanceId: second!.instanceId }).events,
    ).toEqual([REJECTED])
  })

  it('下一轮解锁，标志跟着 Token 一起清零', () => {
    const game = newGame({ deck0: deckOf('gpt-2'), deck1: deckOf('gpt-2'), noShuffle: true })
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: game.state.players[0].hand[0]!.instanceId,
    }).state
    const round2 = nextRound(played)

    expect(round2.round).toBe(2)
    expect(round2.players.map((p) => p.aiPlayedThisRound)).toEqual([false, false])
    // 上一轮那张还在场上，新的一张照样派得出（场上从此有两个 AI）。
    const again = execute(round2, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(round2, 0, 'gpt-2').instanceId,
    })
    expect(again.events.map((e) => e.type)).toEqual(['AI_DEPLOYED'])
    expect(board(again.state, 0)).toHaveLength(2)
  })

  it('DEBUG_PLAY_CARD 同样受这一条约束（调试只豁免"轮到谁出牌"）', () => {
    const game = newGame({ deck1: deckOf('gpt-2'), noShuffle: true })
    const [first, second] = game.state.players[1].hand
    const played = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: first!.instanceId,
    }).state

    const result = execute(played, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: second!.instanceId,
    })
    expect(result.events).toEqual([REJECTED])
    expect(result.state).toBe(played)
  })

  it('两位玩家各自算各自的：一方派过不挡另一方', () => {
    const game = newGame({ deck0: deckOf('gpt-2'), deck1: deckOf('gpt-2'), noShuffle: true })
    const mine = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: game.state.players[0].hand[0]!.instanceId,
    }).state
    expect(mine.players.map((p) => p.aiPlayedThisRound)).toEqual([true, false])

    const theirs = execute(mine, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: mine.players[1].hand[0]!.instanceId,
    })
    expect(theirs.events.map((e) => e.type)).toEqual(['AI_DEPLOYED'])
  })
})

describe('要选目标的技能牌', () => {
  /**
   * 摆一个「甲满手必须回答、乙场上两个 AI」的出牌阶段局面。
   *
   * 乙的 AI 用调试指令上场：这时行动方是甲，走正常出牌轮不到乙。
   * 双方都不带英雄：默认英雄格蕾丝·霍珀会抵消对方本局第一张技能牌，
   * 而抵消掉的技能不留 interfered（见 playCard），那样这一组用例测的就不是目标规则了。
   * 抵消和目标撞在一起的情况单独有一节（见下面「英雄抵消 × 要选目标的技能牌」）。
   */
  function foeHasAis() {
    // 每轮至多派一张新 AI，所以两个 AI 只能分两轮摆：
    // 第 1 轮乙先手派一张（答对留场），第 2 轮换甲先手，再给乙补上第二张。
    // 这样局面回到"轮到甲出牌、对面站着两个 AI"，正是客户端里选目标的那一刻。
    const game = newGame({
      firstPlayer: 1,
      deck0: deckOf('skill-must-answer'),
      // 乙用 1 点的 GPT-2 摆场，第 2 轮的 6 点额度基本没动，
      // 下面那条"替对方打出"的用例才有钱再打一张「必须回答」（2 点）。
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
    })
    const first = execute(game.state, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: handCard(game.state, 1, 'gpt-2').instanceId,
    }).state
    const round2 = nextRound(first)
    return execute(round2, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(round2, 1, 'gpt-2').instanceId,
    }).state
  }

  it('不带目标时被拒', () => {
    const state = foeHasAis()
    const skill = handCard(state, 0, 'skill-must-answer')
    const result = execute(state, { type: 'PLAY_CARD', player: 0, instanceId: skill.instanceId })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '这张技能牌要先指定目标' }])
    expect(result.state).toBe(state)
  })

  it('目标不在场上时被拒', () => {
    const state = foeHasAis()
    const skill = handCard(state, 0, 'skill-must-answer')
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

    const skill = handCard(deployed, 0, 'skill-must-answer')
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
    const skill = handCard(state, 0, 'skill-must-answer')
    const target = board(state, 1)[0]!
    const result = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: target.instanceId,
    })

    expect(board(result.state, 1)[0]).toEqual({ ...target, interfered: true })
    // 只标中选的那一个，同排另一个不受影响。
    expect(board(result.state, 1)[1]!.interfered).toBeUndefined()
    // 技能牌自己照常进弃牌堆。
    expect(result.state.players[0].discard.map((c) => c.instanceId)).toEqual([skill.instanceId])
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'skill-must-answer',
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
      { type: 'DEBUG_ADD_CARD', player: 1, cardId: 'skill-must-answer' },
    ]).state
    const skill = theirSkill.players[1].hand.at(-1)!
    const result = execute(theirSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: skill.instanceId,
      targetInstanceId: board(theirSkill, 0)[0]!.instanceId,
    })

    expect(board(result.state, 0)[0]!.interfered).toBe(true)
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
    expect(board(result.state, 1)[0]!.interfered).toBeUndefined()
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

describe('英雄抵消 × 要选目标的技能牌', () => {
  /**
   * 「甲满手必须回答、乙场上两个 AI」，但**乙带着默认英雄**（格蕾丝·霍珀）。
   * 甲每打一张技能牌，乙的 Debug 就会抵消本局第一张。
   */
  function foeWithHero() {
    // 摆法同上一节的 foeHasAis：两个 AI 分两轮上场（每轮至多一张新 AI）。
    const game = newGame({
      firstPlayer: 1,
      deck0: deckOf('skill-must-answer'),
      deck1: deckOf('gpt-3-5'),
      hero0: null,
    })
    const first = execute(game.state, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: handCard(game.state, 1, 'gpt-3-5').instanceId,
    }).state
    const round2 = nextRound(first)
    return execute(round2, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(round2, 1, 'gpt-3-5').instanceId,
    }).state
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
    expect(board(canceled.state, 1)[0]!.interfered).toBeUndefined()
    expect(canceled.state.players[0].discard.map((c) => c.cardId)).toEqual(['skill-must-answer'])
    expect(canceled.state.players[1].heroSkillUsed).toBe(true)
    // 事件序：先出牌（带着本来要打谁），紧跟着抵消。
    expect(canceled.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'skill-must-answer',
        instanceId: first!.instanceId,
        targetInstanceId: target.instanceId,
      },
      {
        type: 'SKILL_CANCELED',
        player: 0,
        by: 1,
        heroId: 'grace-hopper',
        cardId: 'skill-must-answer',
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
    expect(board(second_.state, 1)[0]!.interfered).toBe(true)
    expect(second_.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
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
    const game = newGame({ deck0: deckOf('skill-must-answer'), deck1: deckOf('gpt-2') })
    // 对面摆一个 AI，好让"目标合不合法"这一步真的有得选，测的才是校验顺序。
    const foeAi = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(game.state, 1, 'gpt-2').instanceId,
    }).state
    // 甲先用 4 点买一张 GPT-4o，5 点额度只剩 1 点，买不起 2 点的「必须回答」。
    const withAi = run(foeAi, [{ type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-4o' }]).state
    const drained = execute(withAi, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: withAi.players[0].hand.at(-1)!.instanceId,
    }).state
    expect(drained.players[0].tokens).toBe(1)

    // 这一张连目标都没给，但报的是费用不够——费用那道闸排在前面。
    const result = execute(drained, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(drained, 0, 'skill-must-answer').instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: 'Token 不够：这张牌要 2 点，只剩 1 点' },
    ])
  })

  it('每轮结算后补满并抬高上限，省下的不跨轮累积', () => {
    const game = newGame({ deck0: deckOf('gpt-3-5'), deck1: deckOf('gpt-3-5') })
    // 甲花掉 2 点，乙一点没花——下一轮两边一样满。
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-3-5').instanceId,
    }).state
    const next = nextRound(played)

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
    // 起手固定成「GPT-3.5（2 点）+ 必须回答（2 点）+ 3 张 GPT-2」，对面摆个 AI 好挑目标。
    const game = newGame({
      noShuffle: true,
      deck0: [...deckOf('gpt-2', 10), 'skill-must-answer', 'gpt-3-5'],
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
      instanceId: handCard(foeAi, 0, 'gpt-3-5').instanceId,
    }).state
    expect(withAi.players[0].spentThisRound).toBe(2)

    const withSkill = execute(withAi, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(withAi, 0, 'skill-must-answer').instanceId,
      targetInstanceId: board(withAi, 1)[0]!.instanceId,
    }).state
    expect(withSkill.players[0].spentThisRound).toBe(4)
    // 两边各记各的：乙只打了那张 1 点的 GPT-2，不受甲花了多少影响。
    expect(withSkill.players[1].spentThisRound).toBe(getCard('gpt-2').tokenCost)

    // 下一轮从头算。
    const round2 = nextRound(withSkill)
    expect(round2.players.map((p) => p.spentThisRound)).toEqual([0, 0])
  })

  it('技能牌被英雄技能抵消也计入：Token 是真花出去的，作废的只是效果', () => {
    // 乙带默认英雄格蕾丝·霍珀，会抵消甲本局第一张技能牌。
    const game = newGame({ deck0: deckOf('placeholder-skill'), hero0: null })
    const card = handCard(game.state, 0, 'placeholder-skill')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(result.events.some((e) => e.type === 'SKILL_CANCELED')).toBe(true)
    expect(result.state.players[0].spentThisRound).toBe(getCard('placeholder-skill').tokenCost)
    expect(result.state.players[0].tokens).toBe(
      INITIAL_TOKEN_MAX - getCard('placeholder-skill').tokenCost,
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

  it('答错的罚下进弃牌堆，答对的留场', () => {
    const quiz = duel('gpt-3-5', 'gpt-3-5')
    const mine = board(quiz, 0)[0]!
    const theirs = board(quiz, 1)[0]!
    const result = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [theirs.instanceId]),
    })

    expect(board(result.state, 0).map((a) => a.instanceId)).toEqual([mine.instanceId])
    expect(board(result.state, 1)).toEqual([])
    expect(result.state.players[1].discard.map((c) => c.instanceId)).toEqual([theirs.instanceId])

    // 事件序：逐个揭晓回答，答错的紧跟一条罚下，最后统一计分。
    expect(result.events.slice(0, 4)).toEqual([
      {
        type: 'AI_ANSWERED',
        instanceId: mine.instanceId,
        owner: 0,
        correct: true,
        answerText: '占位回答',
      },
      {
        type: 'AI_ANSWERED',
        instanceId: theirs.instanceId,
        owner: 1,
        correct: false,
        answerText: '占位回答',
      },
      { type: 'AI_ELIMINATED', instanceId: theirs.instanceId, owner: 1 },
      {
        type: 'ROUND_SCORED',
        gains: [1, 0],
        scores: [1, 0],
        correct: [true, false],
        spent: [2, 2],
        verdict: 'sole-correct',
      },
    ])
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
    // 两个 AI 只能分两轮派（每轮至多一张新 AI）。
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
    expect(result.state.round).toBe(2)
    expect(result.state.phase).toBe('play')
  })

  it('结算后交换先后手、各补 ROUND_DRAW_SIZE 张牌、宣告下一轮', () => {
    const quiz = duel('gpt-3-5', 'claude-5-sonnet')
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
        results: [...full, { instanceId: '幽灵', correct: true, answerText: '占位回答' }],
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

describe('胜负', () => {
  /**
   * 一局"甲一路碾压"的对局：甲开局派一张 AI 并一直答对，乙场上永远空着。
   * 于是每轮都是 sole-correct，甲每轮 +1，第 3 轮结束就该收场。
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
      state = scored.state
      events.push(...scored.events)
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
      state = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state
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
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })

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
      state = scored.state
      events.push(...scored.events)
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
          // 本轮已经派过 AI 的话，剩下的 AI 牌一律跳过（每轮至多一张，客户端那边它们是压暗的）。
          if (definition.kind === 'ai' && state.players[seat].aiPlayedThisRound) continue
          // Token 不够的牌同样跳过，理由同上。客户端那边这些牌是画成灰的、根本拖不动。
          if (definition.tokenCost > state.players[seat].tokens) continue
          const target =
            definition.kind === 'skill' && definition.target === 'foe-ai'
              ? state.players[other(seat)].board.find((a) => a.interfered !== true)
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
    // 现在不一定打满题库：先到 WIN_TARGET 分就收场，所以只能断言没超。
    expect(state.round).toBeLessThanOrEqual(state.totalRounds)
    expect(state.winner).not.toBeNull()
    expect(events.filter((e) => e.type === 'ROUND_SCORED')).toHaveLength(state.round)
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
