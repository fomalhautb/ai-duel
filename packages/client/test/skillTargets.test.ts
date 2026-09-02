import { describe, expect, it } from 'vitest'
import { createGame, execute, getCard } from '@ai-duel/core'
import type { AiInstance, CardId, GameState, InstanceId, PlayerId } from '@ai-duel/core'
import { boardTargetsOf, handTargetsOf } from '../src/ui/skillTargets'
import type { SkillTargetMode } from '../src/ui/skillTargets'

/**
 * 选目标那套交互亮出来的目标，必须和引擎真正接受的目标**一模一样**。
 *
 * 客户端算合法目标（ui/skillTargets.ts）纯粹是为了提前把画面点亮：亮多了，玩家点下去
 * 会被引擎回一条 COMMAND_REJECTED；亮少了，本来能打的目标点不动。两边各写一份规则，
 * 迟早会因为改了一头而分叉，所以这里拿真引擎逐个目标问一遍，两份答案必须重合。
 *
 * 局面直接照着 GameState 摆（它就是一份纯数据，见 core 的 types.ts）：
 * 用调试指令一点点凑出"一个被干扰、一个被保送、一个干净"的场面要打好几轮，
 * 而这里要验的只是"哪些目标合法"，局面怎么来的无关紧要。
 */

/** 出牌方固定坐 0 号位，对手 1 号位。 */
const ME: PlayerId = 0
const FOE: PlayerId = 1

/**
 * 摆一个能随便打牌的局面：出牌阶段、轮到我、Token 管够。
 * Token 给得远超卡面费用，是为了把"打不起"这条完全排除在外——这里验的只有目标合法性。
 */
function stageState(): GameState {
  const deck: CardId[] = ['gpt-2', 'gpt-3-5', 'qwen', 'fixed-answer']
  const { state } = createGame({
    seed: 7,
    players: [
      { name: '我', deck, hero: null },
      { name: '对手', deck, hero: null },
    ],
  })
  state.phase = 'play'
  state.activePlayer = ME
  for (const player of state.players) {
    player.tokens = 99
    player.hand = []
    player.board = []
  }
  return state
}

/** 往某一方场上摆一个 AI 单位，返回它本身，好在原地挂上本轮标记。 */
function deploy(
  state: GameState,
  owner: PlayerId,
  instanceId: InstanceId,
  cardId: CardId,
): AiInstance {
  const unit: AiInstance = { instanceId, cardId, owner }
  state.players[owner].board.push(unit)
  return unit
}

/** 往某一方手牌里塞一张牌。 */
function giveCard(state: GameState, owner: PlayerId, instanceId: InstanceId, cardId: CardId): void {
  state.players[owner].hand.push({ instanceId, cardId, owner })
}

/** 引擎认不认这个目标：打一次看有没有被拒。state 不会被改（execute 是纯函数）。 */
function engineAccepts(state: GameState, skillId: InstanceId, targetId: InstanceId): boolean {
  const { events } = execute(state, {
    type: 'PLAY_CARD',
    player: ME,
    instanceId: skillId,
    targetInstanceId: targetId,
  })
  return !events.some((event) => event.type === 'COMMAND_REJECTED')
}

/** 这张技能牌选哪一档目标（顺带断言它确实标了 target）。 */
function modeOf(cardId: CardId): SkillTargetMode {
  const card = getCard(cardId)
  if (card.kind !== 'skill') throw new Error(`${cardId} 不是技能牌`)
  const { target } = card
  if (target === undefined) throw new Error(`${cardId} 没有标 target`)
  return target
}

describe('选目标：客户端亮出来的和引擎接受的必须是同一批', () => {
  /**
   * 摆一个把三档战场目标的边界一次占全的场面：
   * 双方各三个单位，我方一个挂着干扰、一个被保送、一个干净，对方一个挂着干扰、两个干净。
   */
  function boardStage(): GameState {
    const state = stageState()
    deploy(state, ME, 'me-clean', 'gpt-2')
    deploy(state, ME, 'me-hit', 'gpt-3-5').interference = 'fixed-answer'
    deploy(state, ME, 'me-safe', 'qwen').safePassed = true
    deploy(state, FOE, 'foe-clean-a', 'gpt-2')
    deploy(state, FOE, 'foe-clean-b', 'gpt-3-5')
    deploy(state, FOE, 'foe-hit', 'qwen').interference = 'black-white-reversal'
    return state
  }

  const boardCards: CardId[] = [
    'fixed-answer', // foe-ai
    'black-white-reversal', // foe-ai
    'safe-pass', // own-ai
    'jade-purification-vase', // own-affected-ai
  ]

  for (const cardId of boardCards) {
    it(`「${getCard(cardId).name}」亮着的战场目标就是引擎认的那几个`, () => {
      const state = boardStage()
      giveCard(state, ME, 'skill', cardId)
      const shown = new Set(
        boardTargetsOf(modeOf(cardId), state.players[ME], state.players[FOE]).map(
          (ai) => ai.instanceId,
        ),
      )
      // 每一档都必须既亮着几个、又挡掉几个：这条防的是两边一起退化成"全不合法"，
      // 那种情况下面那圈逐个比对会全票通过，测试就白写了。
      expect(shown.size).toBeGreaterThan(0)
      expect(shown.size).toBeLessThan(6)
      // 双方场上每一个单位都问一遍，不只问亮着的那几个：漏亮的目标同样是 bug。
      const all = [...state.players[ME].board, ...state.players[FOE].board]
      expect(all.length).toBe(6)
      for (const ai of all) {
        expect({ id: ai.instanceId, ok: shown.has(ai.instanceId) }).toEqual({
          id: ai.instanceId,
          ok: engineAccepts(state, 'skill', ai.instanceId),
        })
      }
    })
  }

  it('「模型蒸馏」亮着的手牌就是引擎认的那几张（AI 牌能弃、技能牌不能）', () => {
    const state = stageState()
    giveCard(state, ME, 'skill', 'model-distillation')
    giveCard(state, ME, 'hand-ai', 'gpt-2')
    giveCard(state, ME, 'hand-ai-2', 'qwen')
    giveCard(state, ME, 'hand-skill', 'nuclear-power-station')
    // 场上摆一个单位：手牌那一档一张战场目标都不该亮，顺带守住"别把场上的也算进来"。
    deploy(state, ME, 'me-clean', 'gpt-3-5')
    expect(boardTargetsOf('own-hand-ai', state.players[ME], state.players[FOE])).toEqual([])

    const shown = new Set(handTargetsOf(state.players[ME].hand).map((item) => item.instanceId))
    // 手上四张里正好两张 AI 牌（同上，防两边一起退化成"一张都不能弃"）。
    expect(shown.size).toBe(2)
    for (const instance of state.players[ME].hand) {
      // 蒸馏牌自己也问一遍：它是技能牌，既不该亮也不该被引擎接受。
      expect({ id: instance.instanceId, ok: shown.has(instance.instanceId) }).toEqual({
        id: instance.instanceId,
        ok: engineAccepts(state, 'skill', instance.instanceId),
      })
    }
  })

  it('对方被金钟罩罩着时，干扰牌一个目标都打不出去', () => {
    // 这一条不归 skillTargets 管（它只算"目标本身合不合法"），但客户端确实靠"点了被拒"
    // 兜住这种局面，所以在这里把引擎的口径记一笔：罩着的时候连干净的单位也拒。
    const state = boardStage()
    giveCard(state, ME, 'skill', 'fixed-answer')
    state.players[FOE].shielded = true
    for (const ai of state.players[FOE].board) {
      expect(engineAccepts(state, 'skill', ai.instanceId)).toBe(false)
    }
  })
})
