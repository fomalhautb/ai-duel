import { describe, expect, it } from 'vitest'
import { CARDS, SKILL_DESIGN_CARDS, SKILL_DESIGN_CARD_IDS } from '../src/index'
import type { SkillCard } from '../src/index'

/**
 * 24 张技能卡（src/skillCards.ts）的形状约束。
 *
 * 这批牌进了卡池、玩家能选进牌组、能真的打出来，其中 10 张接了引擎、14 张还是占位。
 * 下面几条守的就是这条分界线在数据上不出岔子：占位牌一旦被填上 `target`，
 * 引擎就会要求玩家选目标，而选完之后什么都不会发生；实装牌一旦留着 `plannedEffect`，
 * 卡背就会印上"还没实装"，可它明明会改局面。
 */
describe('技能卡', () => {
  const cards = Object.values(SKILL_DESIGN_CARDS)
  /** 接进引擎的 10 张，顺序对齐 SKILL_DESIGN_CARDS 的键序。 */
  const IMPLEMENTED_IDS = [
    'black-white-reversal',
    'fixed-answer',
    'jade-purification-vase',
    'golden-bell-shield',
    'safe-pass',
    'model-distillation',
    'nuclear-power-station',
    'domestic-substitution',
    'rising-tide',
    'memory-shortage',
  ]
  const implemented = cards.filter((card) => IMPLEMENTED_IDS.includes(card.id))
  const unimplemented = cards.filter((card) => !IMPLEMENTED_IDS.includes(card.id))

  it('正好 24 张，键和卡自己的 id 对得上', () => {
    expect(cards).toHaveLength(24)
    expect(SKILL_DESIGN_CARD_IDS).toHaveLength(24)
    for (const [key, card] of Object.entries(SKILL_DESIGN_CARDS)) {
      expect(card.id).toBe(key)
      expect(card.kind).toBe('skill')
    }
  })

  it('10 张实装卡都在表里，一张不多一张不少', () => {
    expect(implemented).toHaveLength(IMPLEMENTED_IDS.length)
    expect(unimplemented).toHaveLength(24 - IMPLEMENTED_IDS.length)
  })

  it('没实装的那些都带设计效果全文，客户端卡背才有话可印', () => {
    for (const card of unimplemented) {
      expect(card.plannedEffect).toBeTruthy()
      // 占位牌一律不选目标：填了引擎就会拦着玩家挑一个，挑完却什么都不发生。
      expect(card.target).toBeUndefined()
    }
  })

  it('实装的那些一律不写 plannedEffect：带上它卡背会印"还没实装"', () => {
    for (const card of implemented) {
      expect(card.plannedEffect).toBeUndefined()
    }
  })

  it('要选目标的正好是 5 张，各自的目标种类和规则对得上', () => {
    const targets = new Map(
      cards.filter((card) => card.target !== undefined).map((card) => [card.id, card.target]),
    )
    expect(Object.fromEntries(targets)).toEqual({
      // 干扰两张打对面，玉净瓶和保送打自己场上，模型蒸馏打自己手牌。
      'fixed-answer': 'foe-ai',
      'black-white-reversal': 'foe-ai',
      'jade-purification-vase': 'own-affected-ai',
      'safe-pass': 'own-ai',
      'model-distillation': 'own-hand-ai',
    })
  })

  it('无目标的实装卡打出即结算，不需要玩家点谁', () => {
    // 这四张的效果要么落在打出方自己身上（金钟罩），要么直接扫全场，
    // 客户端不该为它们进选目标模式。
    const noTarget = implemented.filter((card) => card.target === undefined).map((card) => card.id)
    expect(new Set(noTarget)).toEqual(
      new Set([
        'golden-bell-shield',
        'nuclear-power-station',
        'domestic-substitution',
        'rising-tide',
        'memory-shortage',
      ]),
    )
  })

  it('玉净瓶的卡面文案是"移除己方 Agent 身上的效果"这一版', () => {
    // 它管的不只是干扰：将来的限制类效果也归它，所以文案刻意不点名某一种效果。
    const vase = SKILL_DESIGN_CARDS['jade-purification-vase'] as SkillCard
    expect(vase.text).toBe('移除己方1个 Agent 身上的效果，它本轮照常答题，之后还能再被干扰。')
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
