import { describe, expect, it } from 'vitest'
import {
  createGame,
  execute,
  MAX_COMPUTE,
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
    // instanceId 是打出的那张提示卡自己，客户端靠它定位起飞的手牌。
    expect(attacked.events.find((e) => e.type === 'PROMPT_RESOLVED')).toMatchObject({
      instanceId: prompt.instanceId,
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
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'benchmark-champion' },
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'benchmark-champion' },
    ])

    const player = result.state.players[0]
    expect(player.deck).toHaveLength(deckBefore)
    expect(player.hand).toHaveLength(handBefore + 2)
    const added = player.hand.slice(-2)
    expect(added.map((c) => c.cardId)).toEqual(['benchmark-champion', 'benchmark-champion'])
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
  it('非行动方也能出模型卡，且不检查也不扣算力', () => {
    // 开局是 0 号玩家的回合，1 号玩家算力还是 0，正常路径连 1 费卡都出不了。
    const game = newGame(STARTER_DECK, deckOf('hallucinating-oracle'))
    expect(game.state.players[1].compute).toBe(0)

    const oracle = handCard(game.state, 1, 'hallucinating-oracle')
    const result = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: oracle.instanceId,
    })

    expect(result.state.players[1].board.map((m) => m.cardId)).toEqual(['hallucinating-oracle'])
    expect(result.state.players[1].compute).toBe(0)
    expect(result.events.map((e) => e.type)).toEqual(['MODEL_DEPLOYED'])
  })

  it('提示卡照常按弱点结算并进弃牌堆', () => {
    const game = newGame(deckOf('hallucinating-oracle'), deckOf('leading-question'))
    const oracle = handCard(game.state, 0, 'hallucinating-oracle')
    const deployed = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: oracle.instanceId,
    }).state

    const prompt = handCard(deployed, 1, 'leading-question')
    const result = execute(deployed, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: prompt.instanceId,
      targetInstanceId: oracle.instanceId,
    })

    // 和正常出牌一样：基础 2 点 + 幻觉维度 3 点暴露 = 5 点，2 点完整度的它当场崩坏。
    expect(result.events.find((e) => e.type === 'PROMPT_RESOLVED')).toMatchObject({
      instanceId: prompt.instanceId,
      weakness: 'hallucination',
      damage: 5,
    })
    expect(result.events.some((e) => e.type === 'MODEL_DESTROYED')).toBe(true)
    expect(result.events.some((e) => e.type === 'COMPUTE_CHANGED')).toBe(false)
    expect(result.state.players[0].board).toHaveLength(0)
    expect(result.state.players[1].discard.map((c) => c.cardId)).toEqual(['leading-question'])
    expect(result.state.players[1].compute).toBe(0)
  })

  it('打死本体照样判胜负', () => {
    const game = newGame(deckOf('leading-question'), deckOf('leading-question'))
    const wounded: GameState = {
      ...game.state,
      players: [{ ...game.state.players[0], integrity: 1 }, game.state.players[1]],
    }
    const prompt = handCard(wounded, 1, 'leading-question')
    const result = execute(wounded, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: prompt.instanceId,
    })

    expect(result.state.phase).toBe('finished')
    expect(result.state.winner).toBe(1)
    expect(result.events.at(-1)).toEqual({ type: 'GAME_OVER', winner: 1 })
  })
})

describe('调试指令：DEBUG_REFILL_COMPUTE', () => {
  it('把算力和上限一起拉满', () => {
    const game = newGame()
    const result = execute(game.state, { type: 'DEBUG_REFILL_COMPUTE', player: 1 })

    const player = result.state.players[1]
    expect(player.compute).toBe(MAX_COMPUTE)
    expect(player.computeMax).toBe(MAX_COMPUTE)
    expect(result.events).toEqual([
      { type: 'COMPUTE_CHANGED', player: 1, compute: MAX_COMPUTE, computeMax: MAX_COMPUTE },
    ])
  })
})

describe('调试指令的边界', () => {
  it('都不推进回合', () => {
    const game = newGame(STARTER_DECK, deckOf('hallucinating-oracle'))
    const oracle = handCard(game.state, 1, 'hallucinating-oracle')
    const result = run(game.state, [
      { type: 'DEBUG_REFILL_COMPUTE', player: 1 },
      { type: 'DEBUG_ADD_CARD', player: 1, cardId: 'are-you-sure' },
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: oracle.instanceId },
      { type: 'DEBUG_REMOVE_CARD', player: 1 },
    ])

    expect(result.state.activePlayer).toBe(game.state.activePlayer)
    expect(result.state.turn).toBe(game.state.turn)
    expect(result.events.some((e) => e.type === 'TURN_STARTED')).toBe(false)
    expect(result.events.some((e) => e.type === 'COMMAND_REJECTED')).toBe(false)
  })

  it('对局结束后一律被拒', () => {
    const game = newGame()
    const finished: GameState = { ...game.state, phase: 'finished', winner: 0 }
    const result = execute(finished, { type: 'DEBUG_REFILL_COMPUTE', player: 0 })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '对局已结束' }])
    expect(result.state).toBe(finished)
  })
})
