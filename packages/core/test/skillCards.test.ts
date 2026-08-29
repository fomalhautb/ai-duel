import { describe, expect, it } from 'vitest'
import { CARDS, SKILL_DESIGN_CARDS, SKILL_DESIGN_CARD_IDS } from '../src/index'

/**
 * 24 张设计稿技能卡（src/skillCards.ts）的形状约束。
 *
 * 这批牌进了卡池、玩家能选进牌组、能真的打出来，但效果一个都没实装。
 * 下面几条守的就是"没实装"这件事在数据上不出岔子：一旦有人给某张卡填了 target，
 * 引擎就会要求玩家选目标，而选完之后什么都不会发生。
 */
describe('设计稿技能卡', () => {
  const cards = Object.values(SKILL_DESIGN_CARDS)

  it('正好 24 张，键和卡自己的 id 对得上', () => {
    expect(cards).toHaveLength(24)
    expect(SKILL_DESIGN_CARD_IDS).toHaveLength(24)
    for (const [key, card] of Object.entries(SKILL_DESIGN_CARDS)) {
      expect(card.id).toBe(key)
      expect(card.kind).toBe('skill')
    }
  })

  it('每张都带设计效果全文，客户端卡背才有话可印', () => {
    for (const card of cards) {
      expect(card.plannedEffect).toBeTruthy()
    }
  })

  it('一张都不选目标：效果没实装，选了目标也什么都不会发生', () => {
    for (const card of cards) {
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
