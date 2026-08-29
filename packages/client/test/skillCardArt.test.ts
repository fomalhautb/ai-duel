import { describe, expect, it } from 'vitest'
import { SKILL_DESIGN_CARDS, SKILL_DESIGN_CARD_IDS } from '@ai-duel/core'
import { GALLERY_SKILL_CARDS } from '../src/dev/cardGalleryCatalog'
import { SKILL_CARD_ART, isIllustratedSkillCard } from '../src/ui/skillCardArt'
import { cardArtFor } from '../src/ui/cardArt'

/**
 * 24 张设计稿技能卡各有一张专属原画，靠 id 对上号（core 的 SKILL_DESIGN_CARDS ↔
 * ui/skillCardArt.ts 的 SKILL_CARD_ART）。改 id 就等于换掉那张卡的插画，
 * 所以这里两边一起守：少一边、错一个字母，卡面都会悄悄退回通用占位图。
 */
describe('技能牌正面原画', () => {
  it('为 24 张设计稿技能卡各绑定一张独立原画', () => {
    expect(SKILL_DESIGN_CARD_IDS).toHaveLength(24)
    expect(Object.keys(SKILL_CARD_ART)).toHaveLength(24)
    expect(new Set(SKILL_DESIGN_CARD_IDS).size).toBe(24)
    for (const cardId of SKILL_DESIGN_CARD_IDS) {
      expect(isIllustratedSkillCard(cardId)).toBe(true)
      expect(cardArtFor(cardId)).toBe(`/cards/skills/${cardId}.webp`)
    }
  })

  it('把同一批 24 张技能牌收录到 /card 图鉴', () => {
    // 图鉴现在直接读 core 的 CARDS，所以技能牌一共 26 张：24 张设计稿卡
    // 外加有结算路径的「占位技能」和「必须回答」（那两张没有专属原画，走占位图）。
    const galleryIds = GALLERY_SKILL_CARDS.map((card) => card.id)
    expect(galleryIds).toHaveLength(26)
    for (const cardId of SKILL_DESIGN_CARD_IDS) {
      expect(galleryIds).toContain(cardId)
    }
  })

  it('模型蒸馏使用保留“待定”费用的专属原画', () => {
    // 24 张里唯一一张原画上没印数字的（圆章写的是「待定」），
    // 所以 core 那边的 tokenCost 是先按最便宜的 1 放着，等原画补上数字再改。
    const card = SKILL_DESIGN_CARDS['model-distillation']
    expect(card?.name).toBe('模型蒸馏')
    expect(card?.tokenCost).toBe(1)
    expect(SKILL_CARD_ART['model-distillation']).toBe('/cards/skills/model-distillation.webp')
  })
})
