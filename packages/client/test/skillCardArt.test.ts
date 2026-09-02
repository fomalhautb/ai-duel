import { describe, expect, it } from 'vitest'
import { SKILL_DESIGN_CARDS, SKILL_DESIGN_CARD_IDS } from '@ai-duel/core'
import { SKILL_CARD_ART, isIllustratedSkillCard } from '../src/ui/skillCardArt'
import { SKILL_CARD_FACE } from '../src/ui/skillCardFace'
import { cardArtFor } from '../src/ui/cardArt'

/**
 * 24 张技能卡各有一张专属原画，靠 id 对上号（core 的 SKILL_DESIGN_CARDS ↔
 * ui/skillCardArt.ts 的 SKILL_CARD_ART）。改 id 就等于换掉那张卡的插画，
 * 所以这里两边一起守：少一边、错一个字母，卡面都会悄悄退回通用占位图。
 */
describe('技能牌正面原画', () => {
  it('为 24 张技能卡各绑定一张独立原画', () => {
    expect(SKILL_DESIGN_CARD_IDS).toHaveLength(24)
    expect(Object.keys(SKILL_CARD_ART)).toHaveLength(24)
    expect(new Set(SKILL_DESIGN_CARD_IDS).size).toBe(24)
    for (const cardId of SKILL_DESIGN_CARD_IDS) {
      expect(isIllustratedSkillCard(cardId)).toBe(true)
      expect(cardArtFor(cardId)).toBe(`/cards/skills/${cardId}.webp`)
    }
  })

  it('每张技能牌都配了盖在原画那枚费用章上的圆章', () => {
    // 少一张就会露出原画上印的旧价（比如金钟罩画的是 7、实际扣 3）。
    for (const cardId of SKILL_DESIGN_CARD_IDS) {
      expect(SKILL_CARD_FACE[cardId], `${cardId} 缺卡面配置`).toBeDefined()
      expect(SKILL_CARD_FACE[cardId]?.fill, `${cardId} 盘底色不是十六进制颜色`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('模型蒸馏使用保留“待定”费用的专属原画', () => {
    // 24 张里唯一一张原画上没印数字的（圆章写的是「待定」），
    // 费用已经定成 2，原画那枚圆章还没补上数字，等重出时印这个数。
    const card = SKILL_DESIGN_CARDS['model-distillation']
    expect(card?.name).toBe('模型蒸馏')
    expect(card?.tokenCost).toBe(2)
    expect(SKILL_CARD_ART['model-distillation']).toBe('/cards/skills/model-distillation.webp')
  })
})
