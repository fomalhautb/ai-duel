import { describe, expect, it } from 'vitest'
import {
  createGame,
  execute,
  STARTING_HAND_SIZE,
  STARTING_INTEGRITY,
  STARTER_DECK,
} from '../src/index'
import type { CardId, Command, GameEvent, GameState, PlayerId } from '../src/index'

/**
 * 开一局。
 * 洗牌是随机的，所以想测某张卡时就给该玩家一副单卡牌组，
 * 这样"手上一定有这张卡"是规则保证的，不靠种子碰运气。
 */
function newGame(deck0: CardId[] = STARTER_DECK, deck1: CardId[] = STARTER_DECK) {
  return createGame({
    seed: 42,
    players: [
      { name: '甲', deck: [...deck0] },
      { name: '乙', deck: [...deck1] },
    ],
  })
}

function deckOf(cardId: CardId, count = 8): CardId[] {
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

describe('开局', () => {
  it('双方各抽起始手牌，先手多抽一张并拿到 1 点算力', () => {
    const { state, events } = newGame()
    expect(state.phase).toBe('playing')
    expect(state.activePlayer).toBe(0)
    expect(state.turn).toBe(1)
    // 先手在自己的回合开始时又抽了一张。
    expect(state.players[0].hand).toHaveLength(STARTING_HAND_SIZE + 1)
    expect(state.players[1].hand).toHaveLength(STARTING_HAND_SIZE)
    expect(state.players[0].compute).toBe(1)
    expect(state.players[0].integrity).toBe(STARTING_INTEGRITY)
    expect(events[0]).toEqual({ type: 'GAME_STARTED', startingPlayer: 0 })
  })

  it('同一个种子洗出同一副牌堆', () => {
    const a = newGame().state
    const b = newGame().state
    expect(a.players[0].deck.map((c) => c.cardId)).toEqual(b.players[0].deck.map((c) => c.cardId))
  })
})

describe('一个最小回合', () => {
  it('出模型卡 -> 结束回合 -> 对手用提示卡打中它的弱点', () => {
    const game = newGame(deckOf('hallucinating-oracle'), deckOf('leading-question'))
    // 幻觉先知 2 费，先各过一轮把算力攒到 2。
    const warmup = run(game.state, [
      { type: 'END_TURN', player: 0 },
      { type: 'END_TURN', player: 1 },
    ])
    const oracle = handCard(warmup.state, 0, 'hallucinating-oracle')
    const deployed = run(warmup.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: oracle.instanceId },
      { type: 'END_TURN', player: 0 },
    ])

    expect(deployed.state.players[0].board.map((m) => m.cardId)).toEqual(['hallucinating-oracle'])
    expect(deployed.state.players[0].compute).toBe(0)
    expect(deployed.state.activePlayer).toBe(1)
    expect(deployed.events.some((e) => e.type === 'MODEL_DEPLOYED')).toBe(true)

    const prompt = handCard(deployed.state, 1, 'leading-question')
    const attacked = run(deployed.state, [
      {
        type: 'PLAY_CARD',
        player: 1,
        instanceId: prompt.instanceId,
        targetInstanceId: oracle.instanceId,
      },
    ])

    // 基础 2 点 + 幻觉先知在「幻觉」维度上的 3 点暴露 = 5 点，2 点完整度的它直接崩坏。
    expect(attacked.events.find((e) => e.type === 'PROMPT_RESOLVED')).toMatchObject({
      weakness: 'hallucination',
      damage: 5,
    })
    expect(attacked.events.some((e) => e.type === 'MODEL_DESTROYED')).toBe(true)
    expect(attacked.state.players[0].board).toHaveLength(0)
    expect(attacked.state.players[0].discard.map((c) => c.cardId)).toEqual([
      'hallucinating-oracle',
    ])
  })
})

describe('非法指令', () => {
  it('不是自己的回合时被拒绝，状态原样返回', () => {
    const game = newGame()
    const result = execute(game.state, { type: 'END_TURN', player: 1 })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '不是你的回合' }])
    expect(result.state).toBe(game.state)
  })

  it('算力不够时被拒绝', () => {
    const game = newGame(deckOf('hallucinating-oracle'))
    const oracle = handCard(game.state, 0, 'hallucinating-oracle')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: oracle.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '算力不足' }])
    expect(result.state).toBe(game.state)
  })
})

describe('胜负', () => {
  it('本体完整度归零时对手获胜，之后的指令全部被拒', () => {
    const game = newGame(deckOf('leading-question'), deckOf('leading-question'))
    // 直接把 0 号玩家的本体压到 1 点，省掉几十个回合的铺垫。
    const wounded: GameState = {
      ...game.state,
      players: [{ ...game.state.players[0], integrity: 1 }, game.state.players[1]],
    }
    const passed = execute(wounded, { type: 'END_TURN', player: 0 }).state
    const prompt = handCard(passed, 1, 'leading-question')

    // 不指定目标 = 直击本体。
    const result = execute(passed, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: prompt.instanceId,
    })
    expect(result.state.players[0].integrity).toBe(-1)
    expect(result.state.phase).toBe('finished')
    expect(result.state.winner).toBe(1)
    expect(result.events.at(-1)).toEqual({ type: 'GAME_OVER', winner: 1 })

    const after = execute(result.state, { type: 'END_TURN', player: 1 })
    expect(after.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '对局已结束' }])
  })
})
