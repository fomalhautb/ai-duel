// pure-rand v8 只提供子路径入口，没有包根入口，所以这几行 import 看起来才这么长。
import { uniformInt } from 'pure-rand/distribution/uniformInt'
// 用 mersenne 而不是更快的 xoroshiro128plus：后者从整数种子起步时，
// 相邻种子头几个输出的低位是强相关的（实测连续种子掷硬币有约 65% 概率翻面，
// 空转多少次都甩不掉），而这里的 seed 就是 Date.now()，会掷出"隔一毫秒换一次先手"的规律。
// mersenne 的种子扩散做得干净，连续种子的首个输出实测就是均匀且互不相关的。
import { mersenne } from 'pure-rand/generator/mersenne'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import { CARDS, getCard } from './cards'
import { QUESTION_POOL } from './questions'
import type {
  AgentInstance,
  AnswerResult,
  CardId,
  CardInstance,
  Command,
  ExecuteResult,
  GameEvent,
  GameState,
  InstanceId,
  PlayerId,
  PlayerState,
  Question,
} from './types'

/** 开局手牌数。黑客松阶段不做先后手补偿，双方一样。 */
export const STARTING_HAND_SIZE = 5

export interface PlayerSetup {
  name: string
  /** 牌组，元素是卡牌定义 id，可以重复。 */
  deck: CardId[]
}

export interface GameSetup {
  /** 洗牌种子。同一个种子 + 同一串指令 = 同一场对局，先手也由它掷出。 */
  seed: number
  players: [PlayerSetup, PlayerSetup]
  /**
   * 指定本局的题序，不填就把整个题库洗一遍。
   * 留这个口子是给测试和调试用的：只塞一两道题，一两轮就能打到 GAME_OVER，
   * 不必为了看结算界面把整局走完。传进来的顺序原样使用，不再洗。
   */
  questions?: Question[]
}

/**
 * 开一局：建好双方状态、洗牌、洗题序、抛硬币定先手、发起始手牌。
 *
 * 随机只出现在这里。牌堆洗完之后抽牌就是从末尾 pop、题目按洗好的顺序逐轮取，
 * 所以 execute 全程没有随机数，GameState 也不需要保存 RNG 状态。
 */
export function createGame(setup: GameSetup): ExecuteResult {
  const rng = mersenne(setup.seed)
  let seq = 0

  const makePlayer = (id: PlayerId, config: PlayerSetup): PlayerState => {
    const deck: CardInstance[] = config.deck.map((cardId) => ({
      instanceId: `p${id}-c${seq++}`,
      cardId,
      owner: id,
    }))
    return {
      id,
      name: config.name,
      score: 0,
      hand: [],
      deck: shuffle(deck, rng),
      board: [],
      discard: [],
    }
  }

  // 抛硬币定第一轮先手，之后每轮交换，所以只掷这一次。
  // 放在洗牌之前是有意的：洗牌会按牌组长度推进 rng，先手要是排在后面，
  // 换一副牌组或换一份题库就会掷出另一个结果，"同一个 seed 谁先手"这件事就不好复盘了。
  const firstPlayer: PlayerId = uniformInt(rng, 0, 1) === 0 ? 0 : 1
  // 先建好两个玩家再组装 state：makePlayer 会推进 seq，
  // 写在对象字面量里的话 seq 那一行会按书写顺序取到发牌前的旧值。
  const players: [PlayerState, PlayerState] = [
    makePlayer(0, setup.players[0]),
    makePlayer(1, setup.players[1]),
  ]
  const questions = setup.questions ? setup.questions.slice() : shuffle(QUESTION_POOL, rng)

  const state: GameState = {
    round: 1,
    totalRounds: questions.length,
    firstPlayer,
    activePlayer: firstPlayer,
    phase: 'play',
    questions,
    players,
    winner: null,
    seq,
  }

  const events: GameEvent[] = [{ type: 'GAME_STARTED', firstPlayer }]
  for (const player of state.players) {
    drawCards(player, STARTING_HAND_SIZE, events)
  }
  announceRound(state, events)
  return { state, events }
}

/**
 * 执行一条指令。
 *
 * 纯函数：不改传入的 state，返回新状态和本次产生的事件。
 * 指令非法时状态原样返回，只带一条 COMMAND_REJECTED。
 */
export function execute(state: GameState, command: Command): ExecuteResult {
  if (state.phase === 'finished') return reject(state, '对局已结束')

  switch (command.type) {
    case 'PLAY_CARD':
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      if (command.player !== state.activePlayer) return reject(state, '还没轮到你出牌')
      return playCard(state, command.player, command.instanceId)
    case 'END_PLAY':
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      if (command.player !== state.activePlayer) return reject(state, '还没轮到你出牌')
      return endPlay(state)
    case 'SUBMIT_ANSWERS':
      if (state.phase !== 'quiz') return reject(state, '现在不是答题阶段')
      return submitAnswers(state, command.results)
    // DEBUG_ADD_CARD / DEBUG_REMOVE_CARD 不限阶段：测试房要能在答题阶段先把手牌摆好。
    case 'DEBUG_ADD_CARD':
      return debugAddCard(state, command.player, command.cardId)
    case 'DEBUG_REMOVE_CARD':
      return debugRemoveCard(state, command.player, command.instanceId)
    case 'DEBUG_PLAY_CARD':
      // 和 PLAY_CARD 只差"轮到谁"这一条检查：测试房要能替对手出牌看结算动画。
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      return playCard(state, command.player, command.instanceId)
    case 'DEBUG_SKIP_TO_QUIZ':
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      return skipToQuiz(state)
  }
}

/**
 * 打出一张手牌。
 * 本迭代出牌没有费用、不选目标，一轮内想打几张打几张。
 */
function playCard(state: GameState, playerId: PlayerId, instanceId: InstanceId): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId)
  if (handIndex < 0) return reject(state, '手牌里没有这张卡')

  const instance = player.hand[handIndex]!
  const card = getCard(instance.cardId)
  player.hand.splice(handIndex, 1)

  const events: GameEvent[] = []
  if (card.kind === 'agent') {
    // AI 卡进场后跨轮留在场上，答错才罚下，所以实例 id 沿用手牌那一份，
    // 罚下时才能原样塞回弃牌堆。
    const agent: AgentInstance = {
      instanceId: instance.instanceId,
      cardId: card.id,
      owner: playerId,
    }
    player.board.push(agent)
    events.push({ type: 'AGENT_DEPLOYED', player: playerId, agent })
  } else {
    player.discard.push(instance)
    events.push({ type: 'SKILL_PLAYED', player: playerId, cardId: card.id })
  }
  return { state: next, events }
}

/** 结束本方出牌：先手发就轮到后手，后手发就进答题阶段。 */
function endPlay(state: GameState): ExecuteResult {
  const next = clone(state)
  if (next.activePlayer === next.firstPlayer) {
    next.activePlayer = other(next.firstPlayer)
    return { state: next, events: [{ type: 'PLAY_TURN_STARTED', player: next.activePlayer }] }
  }
  return { state: next, events: enterQuiz(next) }
}

/** 测试房：跳过双方剩下的出牌，直接进答题阶段。 */
function skipToQuiz(state: GameState): ExecuteResult {
  const next = clone(state)
  return { state: next, events: enterQuiz(next) }
}

/** 进答题阶段：揭晓本轮题目全文（含正确答案）。 */
function enterQuiz(state: GameState): GameEvent[] {
  state.phase = 'quiz'
  return [{ type: 'QUESTION_REVEALED', question: currentQuestion(state) }]
}

/**
 * 结算本轮答题。
 *
 * results 由房主/本地 driver 在进入答题阶段后一次性生成，覆盖场上每一个 AI；
 * 对不上就整条拒绝——那说明 driver 拿的是过期状态，宁可什么都不做也别结算出错的局面。
 */
function submitAnswers(state: GameState, results: AnswerResult[]): ExecuteResult {
  const next = clone(state)
  const onBoard = new Set(
    [...next.players[0].board, ...next.players[1].board].map((a) => a.instanceId),
  )
  // 用 delete 的返回值一次挡掉三种情况：混进不在场的、重复提交同一个、漏掉在场的
  // （前两种当场为 false，第三种靠数量相等推出来）。
  if (results.length !== onBoard.size) return reject(state, '答题结果与场上 AI 不符')
  for (const result of results) {
    if (!onBoard.delete(result.instanceId)) return reject(state, '答题结果与场上 AI 不符')
  }

  const events: GameEvent[] = []
  for (const result of results) {
    // 上面刚校验过 results 和场上一一对应，所以这里必定找得到人。
    const owner = next.players.find((p) =>
      p.board.some((a) => a.instanceId === result.instanceId),
    )!
    const index = owner.board.findIndex((a) => a.instanceId === result.instanceId)
    const agent = owner.board[index]!
    events.push({
      type: 'AGENT_ANSWERED',
      instanceId: agent.instanceId,
      owner: agent.owner,
      correct: result.correct,
      answerText: result.answerText,
    })
    if (!result.correct) {
      owner.board.splice(index, 1)
      owner.discard.push({
        instanceId: agent.instanceId,
        cardId: agent.cardId,
        owner: agent.owner,
      })
      events.push({ type: 'AGENT_ELIMINATED', instanceId: agent.instanceId, owner: agent.owner })
    }
  }

  // 计分：罚下之后各自数一遍还站着几个 AI，就是本轮拿多少分。
  // 场上一个 AI 都没有也照样走完剩下的轮次，只是这轮拿 0 分。
  const gains: [number, number] = [next.players[0].board.length, next.players[1].board.length]
  next.players[0].score += gains[0]
  next.players[1].score += gains[1]
  const scores: [number, number] = [next.players[0].score, next.players[1].score]
  events.push({ type: 'ROUND_SCORED', gains, scores })

  if (next.round >= next.totalRounds) {
    next.phase = 'finished'
    next.winner = scores[0] === scores[1] ? 'draw' : scores[0] > scores[1] ? 0 : 1
    events.push({ type: 'GAME_OVER', winner: next.winner })
    return { state: next, events }
  }

  next.round += 1
  next.firstPlayer = other(next.firstPlayer)
  next.activePlayer = next.firstPlayer
  next.phase = 'play'
  // 第 2 轮起每轮开始双方各补一张，起手 5 张之外的牌都是这么来的。
  for (const player of next.players) {
    drawCards(player, 1, events)
  }
  announceRound(next, events)
  return { state: next, events }
}

/** 宣告新一轮开始并让先手行动。开局和每轮换手都走这里，保证两处事件序一致。 */
function announceRound(state: GameState, events: GameEvent[]): void {
  events.push({
    type: 'ROUND_STARTED',
    round: state.round,
    firstPlayer: state.firstPlayer,
    category: currentQuestion(state).category,
  })
  events.push({ type: 'PLAY_TURN_STARTED', player: state.firstPlayer })
}

/**
 * 本轮的题。
 * round 由引擎自己推进且永远不超过 totalRounds，取不到只可能是外部塞了一份坏状态，
 * 属于数据错误而不是玩家操作能触发的情况，所以直接抛错而不是回 COMMAND_REJECTED。
 */
function currentQuestion(state: GameState): Question {
  const question = state.questions[state.round - 1]
  if (!question) throw new Error(`第 ${state.round} 轮没有对应的题目`)
  return question
}

/** 抽牌。牌堆空了就是抽不到，不做疲劳伤害——牌组比一局用得到的张数长，先不管。 */
function drawCards(player: PlayerState, count: number, events: GameEvent[]): void {
  for (let i = 0; i < count; i++) {
    const card = player.deck.pop()
    if (!card) return
    player.hand.push(card)
    events.push({ type: 'CARD_DRAWN', player: player.id, card })
  }
}

/**
 * 测试房：给某位玩家加一张手牌。
 *
 * 不带 cardId 就是正常从牌堆抽一张；带 cardId 则凭空造一张新实例塞进手牌，牌堆不动，
 * 这样想测某张卡不用先把牌组调成一水儿的那张卡。
 */
function debugAddCard(state: GameState, playerId: PlayerId, cardId?: CardId): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const events: GameEvent[] = []

  if (cardId === undefined) {
    if (player.deck.length === 0) return reject(state, '牌堆已空')
    drawCards(player, 1, events)
    return { state: next, events }
  }

  // 这里直接查表而不用 getCard：cardId 是客户端传来的，写错很正常，
  // 得退一条 COMMAND_REJECTED 回去，不能让 getCard 抛的异常把房主的引擎打断。
  if (!CARDS[cardId]) return reject(state, `未知卡牌：${cardId}`)
  const card: CardInstance = {
    // 凭空造的牌不属于任何一副牌组，用 dbg- 前缀跟发牌时的 p0-c3 这类 id 区分开。
    instanceId: `dbg-${next.seq++}`,
    cardId,
    owner: playerId,
  }
  player.hand.push(card)
  // 复用 CARD_DRAWN：对客户端来说"手上多了一张牌"要播的动画是一样的。
  events.push({ type: 'CARD_DRAWN', player: playerId, card })
  return { state: next, events }
}

/** 测试房：弃掉某位玩家的一张手牌，不填 instanceId 就弃最后一张。 */
function debugRemoveCard(
  state: GameState,
  playerId: PlayerId,
  instanceId?: InstanceId,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  if (player.hand.length === 0) return reject(state, '手牌为空')

  const index =
    instanceId === undefined
      ? player.hand.length - 1
      : player.hand.findIndex((c) => c.instanceId === instanceId)
  if (index < 0) return reject(state, '手牌里没有这张卡')

  const removed = player.hand.splice(index, 1)[0]!
  player.discard.push(removed)
  return {
    state: next,
    events: [{ type: 'CARD_REMOVED', player: playerId, instanceId: removed.instanceId }],
  }
}

function reject(state: GameState, reason: string): ExecuteResult {
  return { state, events: [{ type: 'COMMAND_REJECTED', reason }] }
}

export function other(playerId: PlayerId): PlayerId {
  return playerId === 0 ? 1 : 0
}

/**
 * JSON 深拷贝。
 * 慢，但顺带把"GameState 必须可序列化"这条约束钉死了：
 * 一旦有人往状态里塞函数或 Map，拷贝会立刻丢数据暴露问题。
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Fisher-Yates 洗牌。rng 会被就地推进，所以用同一个生成器连洗两副牌不会得到相同顺序。 */
function shuffle<T>(items: readonly T[], rng: RandomGenerator): T[] {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = uniformInt(rng, 0, i)
    const tmp = result[i]!
    result[i] = result[j]!
    result[j] = tmp
  }
  return result
}
