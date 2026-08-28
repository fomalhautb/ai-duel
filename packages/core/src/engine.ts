// pure-rand v8 只提供子路径入口，没有包根入口，所以这几行 import 看起来才这么长。
import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import { CARDS, getCard } from './cards'
import type {
  CardId,
  CardInstance,
  Command,
  ExecuteResult,
  GameEvent,
  GameState,
  InstanceId,
  ModelCard,
  ModelInstance,
  PlayerId,
  PlayerState,
  PromptCard,
} from './types'

/** 本体完整度初始值，归零判负。 */
export const STARTING_INTEGRITY = 20
/** 开局手牌数。黑客松阶段不做先后手补偿，双方一样。 */
export const STARTING_HAND_SIZE = 3
/** 算力上限的上限。 */
export const MAX_COMPUTE = 10

export interface PlayerSetup {
  name: string
  /** 牌组，元素是卡牌定义 id，可以重复。 */
  deck: CardId[]
  /**
   * 起始完整度，不填就是 STARTING_INTEGRITY。
   * 留这个口子是为了测试和调试：把血量压到几点，几个回合内就能打到 GAME_OVER。
   */
  integrity?: number
}

export interface GameSetup {
  /** 洗牌种子。同一个种子 + 同一串指令 = 同一场对局。 */
  seed: number
  players: [PlayerSetup, PlayerSetup]
}

/**
 * 开一局：建好双方状态、洗牌、发起始手牌。
 *
 * 随机只出现在这里（洗牌）。牌堆洗完之后抽牌就是从末尾 pop，
 * 所以 execute 全程没有随机数，GameState 也不需要保存 RNG 状态。
 */
export function createGame(setup: GameSetup): ExecuteResult {
  const rng = xoroshiro128plus(setup.seed)
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
      integrity: config.integrity ?? STARTING_INTEGRITY,
      compute: 0,
      computeMax: 0,
      hand: [],
      deck: shuffle(deck, rng),
      board: [],
      discard: [],
    }
  }

  // 先手固定为 0 号座位：黑客松不做随机先后手，谁建房谁先手，规则更好解释。
  // 要让某一方先手就把他排到 0 号座位上，不需要再开一个开关——
  // dev 测试房就是这样把本端"我"固定成先手的。
  const startingPlayer: PlayerId = 0
  // 先建好两个玩家再组装 state：makePlayer 会推进 seq，
  // 写在对象字面量里的话 seq 那一行会按书写顺序取到发牌前的旧值。
  const players: [PlayerState, PlayerState] = [
    makePlayer(0, setup.players[0]),
    makePlayer(1, setup.players[1]),
  ]
  const state: GameState = {
    turn: 0,
    activePlayer: startingPlayer,
    players,
    phase: 'playing',
    winner: null,
    seq,
  }

  const events: GameEvent[] = [{ type: 'GAME_STARTED', startingPlayer }]
  for (const player of state.players) {
    drawCards(player, STARTING_HAND_SIZE, events)
  }
  beginTurn(state, events)
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
  // 回合归属只管正常对局指令。DEBUG_* 是测试房用来随时摆场面的
  // （比如在对手回合给自己塞张卡、替对手打出一张卡看结算动画），
  // 一律要求"轮到你"就没法用了，所以这里把它们排除在检查之外。
  if (
    (command.type === 'PLAY_CARD' || command.type === 'END_TURN') &&
    command.player !== state.activePlayer
  ) {
    return reject(state, '不是你的回合')
  }

  switch (command.type) {
    case 'PLAY_CARD':
      return playCard(state, command.player, command.instanceId, command.targetInstanceId)
    case 'END_TURN':
      return endTurn(state, command.player)
    case 'DEBUG_ADD_CARD':
      return debugAddCard(state, command.player, command.cardId)
    case 'DEBUG_REMOVE_CARD':
      return debugRemoveCard(state, command.player, command.instanceId)
    case 'DEBUG_PLAY_CARD':
      return playCard(state, command.player, command.instanceId, command.targetInstanceId, true)
    case 'DEBUG_REFILL_COMPUTE':
      return debugRefillCompute(state, command.player)
  }
}

/**
 * 打出一张手牌。
 *
 * free = true（DEBUG_PLAY_CARD）时不检查算力、也不扣算力和发 COMPUTE_CHANGED，
 * 除此之外和正常出牌走完全同一套结算，免得调试路径和真实路径慢慢跑偏。
 */
function playCard(
  state: GameState,
  playerId: PlayerId,
  instanceId: InstanceId,
  targetInstanceId?: InstanceId,
  free = false,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId)
  if (handIndex < 0) return reject(state, '手牌里没有这张卡')

  const instance = player.hand[handIndex]!
  const card = getCard(instance.cardId)
  if (!free && card.cost > player.compute) return reject(state, '算力不足')

  const events: GameEvent[] = []
  player.hand.splice(handIndex, 1)
  if (!free) {
    player.compute -= card.cost
    events.push({
      type: 'COMPUTE_CHANGED',
      player: playerId,
      compute: player.compute,
      computeMax: player.computeMax,
    })
  }

  if (card.kind === 'model') {
    deployModel(next, playerId, instance, card, events)
  } else {
    const resolved = resolvePrompt(
      next,
      playerId,
      card,
      instance.instanceId,
      targetInstanceId,
      events,
    )
    // 指定了目标却找不到，说明客户端拿的是过期状态，整条指令作废。
    if (!resolved) return reject(state, '目标不存在')
    player.discard.push(instance)
  }

  checkGameOver(next, events)
  return { state: next, events }
}

function deployModel(
  state: GameState,
  playerId: PlayerId,
  instance: CardInstance,
  card: ModelCard,
  events: GameEvent[],
): void {
  const model: ModelInstance = {
    instanceId: instance.instanceId,
    cardId: card.id,
    owner: playerId,
    power: card.power,
    integrity: card.integrity,
    weaknesses: { ...card.weaknesses },
  }
  state.players[playerId].board.push(model)
  events.push({ type: 'MODEL_DEPLOYED', player: playerId, model })
}

/**
 * 结算提示卡。目标找不到时返回 false，由调用方作废整条指令。
 *
 * instanceId 是打出的那张手牌自己的实例 id，只是原样带进 PROMPT_RESOLVED 事件里，
 * 不参与结算：客户端要靠它在出牌方的手牌里找到起飞的那张牌（见 PROMPT_RESOLVED 的说明）。
 */
function resolvePrompt(
  state: GameState,
  playerId: PlayerId,
  card: PromptCard,
  instanceId: InstanceId,
  targetInstanceId: InstanceId | undefined,
  events: GameEvent[],
): boolean {
  const opponentId = other(playerId)
  const opponent = state.players[opponentId]

  if (targetInstanceId === undefined) {
    // 不指定目标就是直击本体：本体没有弱点画像，只吃基础伤害。
    opponent.integrity -= card.damage
    events.push({
      type: 'PROMPT_RESOLVED',
      player: playerId,
      cardId: card.id,
      instanceId,
      weakness: card.targetWeakness,
      targetInstanceId: null,
      damage: card.damage,
    })
    events.push({
      type: 'PLAYER_DAMAGED',
      player: opponentId,
      amount: card.damage,
      integrity: opponent.integrity,
    })
    return true
  }

  const index = opponent.board.findIndex((m) => m.instanceId === targetInstanceId)
  if (index < 0) return false
  const target = opponent.board[index]!

  // 核心机制：打中弱点维度越高的模型越疼，逼玩家去读对手的弱点画像。
  const damage = card.damage + target.weaknesses[card.targetWeakness]
  target.integrity -= damage
  events.push({
    type: 'PROMPT_RESOLVED',
    player: playerId,
    cardId: card.id,
    instanceId,
    weakness: card.targetWeakness,
    targetInstanceId: target.instanceId,
    damage,
  })
  events.push({
    type: 'MODEL_DAMAGED',
    instanceId: target.instanceId,
    amount: damage,
    integrity: target.integrity,
  })
  if (target.integrity <= 0) {
    opponent.board.splice(index, 1)
    opponent.discard.push({
      instanceId: target.instanceId,
      cardId: target.cardId,
      owner: opponentId,
    })
    events.push({ type: 'MODEL_DESTROYED', instanceId: target.instanceId, owner: opponentId })
  }
  return true
}

function endTurn(state: GameState, playerId: PlayerId): ExecuteResult {
  const next = clone(state)
  const events: GameEvent[] = [{ type: 'TURN_ENDED', player: playerId }]
  next.activePlayer = other(playerId)
  beginTurn(next, events)
  return { state: next, events }
}

/** 当前玩家的回合开始：涨算力、回满、抽一张。 */
function beginTurn(state: GameState, events: GameEvent[]): void {
  state.turn += 1
  const player = state.players[state.activePlayer]
  player.computeMax = Math.min(player.computeMax + 1, MAX_COMPUTE)
  player.compute = player.computeMax
  events.push({ type: 'TURN_STARTED', player: player.id, turn: state.turn })
  events.push({
    type: 'COMPUTE_CHANGED',
    player: player.id,
    compute: player.compute,
    computeMax: player.computeMax,
  })
  drawCards(player, 1, events)
}

/** 抽牌。牌堆空了就是抽不到，不做疲劳伤害——黑客松阶段牌组够长，先不管。 */
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

/** 测试房：把算力和算力上限一起拉满，省掉为了测高费卡连过十几个回合。 */
function debugRefillCompute(state: GameState, playerId: PlayerId): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  player.computeMax = MAX_COMPUTE
  player.compute = MAX_COMPUTE
  return {
    state: next,
    events: [
      {
        type: 'COMPUTE_CHANGED',
        player: playerId,
        compute: player.compute,
        computeMax: player.computeMax,
      },
    ],
  }
}

function checkGameOver(state: GameState, events: GameEvent[]): void {
  for (const player of state.players) {
    if (player.integrity <= 0) {
      state.phase = 'finished'
      state.winner = other(player.id)
      events.push({ type: 'GAME_OVER', winner: state.winner })
      return
    }
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
