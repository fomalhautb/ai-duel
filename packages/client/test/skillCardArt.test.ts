import { describe, expect, it } from 'vitest'
import { GALLERY_SKILL_CARDS } from '../src/dev/cardGalleryCatalog'
import { DECK_DEMO_CARDS } from '../src/screens/deckDemoCards'
import { SKILL_CARD_ART, isIllustratedSkillCard } from '../src/ui/skillCardArt'
import { cardArtFor } from '../src/ui/cardArt'

describe('技能牌正面原画', () => {
  const skills = DECK_DEMO_CARDS.filter((card) => card.kind === 'skill')

  it('为牌组页的 24 张技能牌各绑定一张独立原画', () => {
    expect(skills).toHaveLength(24)
    expect(Object.keys(SKILL_CARD_ART)).toHaveLength(24)
    expect(new Set(skills.map((card) => card.id)).size).toBe(24)
    for (const card of skills) {
      expect(isIllustratedSkillCard(card.id)).toBe(true)
      expect(cardArtFor(card.id)).toBe(`/cards/skills/${card.id}.webp`)
    }
  })

  it('把同一批 24 张技能牌收录到 /card 图鉴', () => {
    expect(GALLERY_SKILL_CARDS).toHaveLength(24)
    expect(GALLERY_SKILL_CARDS.map((card) => card.id)).toEqual(skills.map((card) => card.id))
  })

  it('模型蒸馏使用保留“待定”费用的专属原画', () => {
    const card = skills.find((candidate) => candidate.id === 'model-distillation')
    expect(card?.name).toBe('模型蒸馏')
    expect(SKILL_CARD_ART['model-distillation']).toBe('/cards/skills/model-distillation.webp')
  })
})
