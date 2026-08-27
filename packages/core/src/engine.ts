// pure-rand v8 只提供子路径入口，没有包根入口，所以这几行 import 看起来才这么长。
import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import { getCard } from './cards'
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
   * 教程关卡靠它把血量压到几点，好在三五个回合内演到 GAME_OVER。
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
  // 要让某一方先手（教程第 2 关就要）就把他排到 0 号座位上，不需要再开一个开关。
  const startingPlayer: PlayerId = 0
  const state: GameState = {
    turn: 0,
    activePlayer: startingPlayer,
    players: [makePlayer(0, setup.players[0]), makePlayer(1, setup.players[1])],
    phase: 'playing',
    winner: null,
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
  if (command.player !== state.activePlayer) return reject(state, '不是你的回合')

  switch (command.type) {
    case 'PLAY_CARD':
      return playCard(state, command.player, command.instanceId, command.targetInstanceId)
    case 'END_TURN':
      return endTurn(state, command.player)
  }
}

function playCard(
  state: GameState,
  playerId: PlayerId,
  instanceId: InstanceId,
  targetInstanceId?: InstanceId,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId)
  if (handIndex < 0) return reject(state, '手牌里没有这张卡')

  const instance = player.hand[handIndex]!
  const card = getCard(instance.cardId)
  if (card.cost > player.compute) return reject(state, '算力不足')

  const events: GameEvent[] = []
  player.hand.splice(handIndex, 1)
  player.compute -= card.cost
  events.push({
    type: 'COMPUTE_CHANGED',
    player: playerId,
    compute: player.compute,
    computeMax: player.computeMax,
  })

  if (card.kind === 'model') {
    deployModel(next, playerId, instance, card, events)
  } else {
    const resolved = resolvePrompt(next, playerId, card, targetInstanceId, events)
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

/** 结算提示卡。目标找不到时返回 false，由调用方作废整条指令。 */
function resolvePrompt(
  state: GameState,
  playerId: PlayerId,
  card: PromptCard,
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
