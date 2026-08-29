import { describe, expect, it } from 'vitest'
import { CARDS, SKILL_DESIGN_CARDS, SKILL_DESIGN_CARD_IDS } from '../src/index'

/**
 * 24 张技能卡（src/skillCards.ts）的形状约束。
 *
 * 这批牌进了卡池、玩家能选进牌组、能真的打出来，但除了「复读机」效果都没实装。
 * 下面几条守的就是"没实装"这件事在数据上不出岔子：一旦有人给别的卡也填了 target，
 * 引擎就会要求玩家选目标，而选完之后什么都不会发生。
 */
describe('技能卡', () => {
  const cards = Object.values(SKILL_DESIGN_CARDS)
  /** 唯一接进引擎的一张：它要选目标，也因此不写 plannedEffect（见 skillCards.ts）。 */
  const implemented = cards.filter((card) => card.id === 'fixed-answer')
  const unimplemented = cards.filter((card) => card.id !== 'fixed-answer')

  it('正好 24 张，键和卡自己的 id 对得上', () => {
    expect(cards).toHaveLength(24)
    expect(SKILL_DESIGN_CARD_IDS).toHaveLength(24)
    for (const [key, card] of Object.entries(SKILL_DESIGN_CARDS)) {
      expect(card.id).toBe(key)
      expect(card.kind).toBe('skill')
    }
  })

  it('没实装的那些都带设计效果全文，客户端卡背才有话可印', () => {
    expect(unimplemented).toHaveLength(23)
    for (const card of unimplemented) {
      expect(card.plannedEffect).toBeTruthy()
    }
  })

  it('只有「复读机」选目标：其余效果没实装，选了目标也什么都不会发生', () => {
    expect(implemented.map((card) => card.target)).toEqual(['foe-ai'])
    // 实装了的那张不写 plannedEffect：带上它卡背会印"还没实装"，而它确实会改场上的状态。
    expect(implemented.map((card) => card.plannedEffect)).toEqual([undefined])
    for (const card of unimplemented) {
      expect(card.target).toBeUndefined()
    }
  })

  it('费用都是正整数（照原画上那枚「N TOKEN」圆章转录）', () => {
    for (const card of cards) {
      expect(Number.isInteger(card.tokenCost)).toBe(true)
      expect(card.tokenCost).toBeGreaterThan(0)
    }
  })

  it('整批都进了卡表，和 CARDS 里是同一份对象', () => {
    for (const card of cards) {
      expect(CARDS[card.id]).toBe(card)
    }
  })
})
