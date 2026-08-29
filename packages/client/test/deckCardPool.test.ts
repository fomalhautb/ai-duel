import { describe, expect, it } from 'vitest'
import { AI_MODEL_CARD_IDS } from '@ai-duel/core'
import { DECK_DEMO_CARDS, filterDeckCards } from '../src/screens/deckDemoCards'

describe('/deck 卡池', () => {
  it('AI 牌只包含 18 张正式卡', () => {
    const aiCards = DECK_DEMO_CARDS.filter((card) => card.kind === 'ai')

    expect(aiCards.map((card) => card.id)).toEqual(AI_MODEL_CARD_IDS)
    expect(aiCards).toHaveLength(18)
    for (const testId of [
      'claude-4-5-haiku',
      'kimi-k1-5',
      'deepseek-v3-2',
      'step-3-5',
      'qwen-4-max',
      'llama-5-scout',
      'mistral-grand-3',
    ]) {
      expect(aiCards.some((card) => card.id === testId)).toBe(false)
    }
  })

  it('技能牌不受 AI 阵营筛选影响', () => {
    const allSkills = DECK_DEMO_CARDS.filter((card) => card.kind === 'skill')

    expect(allSkills).toHaveLength(24)
    expect(filterDeckCards(DECK_DEMO_CARDS, 'skill', 'gpt')).toEqual(allSkills)
    expect(filterDeckCards(DECK_DEMO_CARDS, 'all', 'claude').filter((card) => card.kind === 'skill')).toEqual(allSkills)
  })

  it('阵营筛选仍会限制 AI 牌', () => {
    const gptCards = filterDeckCards(DECK_DEMO_CARDS, 'ai', 'gpt')

    expect(gptCards.length).toBeGreaterThan(0)
    expect(gptCards.every((card) => card.kind === 'ai' && card.faction === 'gpt')).toBe(true)
  })
})
