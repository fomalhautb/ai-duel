import { describe, expect, it } from 'vitest'
import { AI_MODEL_CARD_IDS, CARD_POOL, SKILL_DESIGN_CARD_IDS, getCard } from '@ai-duel/core'
import { FACTIONS, factionForAi, filterDeckCards } from '../src/screens/deckFactions'
import type { DeckFaction } from '../src/screens/deckFactions'

/**
 * 牌组页那排阵营药丸背后的纯逻辑（screens/deckFactions.ts）。
 *
 * 不渲染组件：这一页的卡面里有 GSAP、滤镜和一堆 ref，为了验一条筛选规则把它挂起来
 * 太贵，而规则本身早就被拆成了纯函数。
 */
describe('阵营归堆', () => {
  it('18 张 AI 每张都落进某一个药丸，没有卡掉在筛选外面', () => {
    const known = new Set<DeckFaction>(FACTIONS.map((option) => option.id))
    expect(AI_MODEL_CARD_IDS).toHaveLength(18)
    for (const cardId of AI_MODEL_CARD_IDS) {
      expect(known.has(factionForAi(cardId))).toBe(true)
    }
  })

  it('按前缀分堆的四家各归各家', () => {
    expect(
      AI_MODEL_CARD_IDS.filter((id) => factionForAi(id) === 'gpt'),
    ).toEqual(['gpt-2', 'gpt-3-5', 'gpt-4o', 'chatgpt-5-6-sol'])
    expect(AI_MODEL_CARD_IDS.filter((id) => factionForAi(id) === 'claude')).toEqual([
      'claude-5-sonnet',
      'claude-fable-5',
    ])
    expect(AI_MODEL_CARD_IDS.filter((id) => factionForAi(id) === 'kimi')).toEqual([
      'kimi-k2-6',
      'kimi-k3',
    ])
    expect(AI_MODEL_CARD_IDS.filter((id) => factionForAi(id) === 'deepseek')).toEqual([
      'deepseek-r1',
      'deepseek-v4',
    ])
  })

  it('剩下的按名单进「国产通用」，没上名单的进「其他」', () => {
    expect(AI_MODEL_CARD_IDS.filter((id) => factionForAi(id) === 'cn')).toEqual([
      'qwen',
      'doubao',
      'glm-5',
      'minimax',
      'yuanbao',
      'wenxin-yiyan',
    ])
    // gemini 和 grok 不属于上面任何一家，也不是国产，兜底到「其他」。
    expect(AI_MODEL_CARD_IDS.filter((id) => factionForAi(id) === 'other')).toEqual([
      'gemini',
      'grok',
    ])
  })
})

describe('卡池筛选', () => {
  const skillIds = CARD_POOL.filter((cardId) => getCard(cardId).kind === 'skill')

  it('不选阵营时按种类筛，「全部」就是整个卡池', () => {
    expect(filterDeckCards(CARD_POOL, 'all', null)).toEqual(CARD_POOL)
    expect(filterDeckCards(CARD_POOL, 'ai', null)).toEqual(AI_MODEL_CARD_IDS)
    expect(filterDeckCards(CARD_POOL, 'skill', null)).toEqual(skillIds)
  })

  it('阵营会把 AI 牌收窄到那一家', () => {
    const gpt = filterDeckCards(CARD_POOL, 'ai', 'gpt')
    expect(gpt).toEqual(['gpt-2', 'gpt-3-5', 'gpt-4o', 'chatgpt-5-6-sol'])
    for (const option of FACTIONS) {
      const shown = filterDeckCards(CARD_POOL, 'ai', option.id)
      expect(shown.length).toBeGreaterThan(0)
      for (const cardId of shown) expect(factionForAi(cardId)).toBe(option.id)
    }
  })

  it('技能牌不受阵营筛选影响：选了阵营，技能牌照样一张不少', () => {
    // 技能牌没有阵营，跟着一起筛掉的话，玩家点一下药丸就再也看不见技能牌，
    // 而他并没有表达过"不想看技能牌"。
    for (const option of FACTIONS) {
      expect(filterDeckCards(CARD_POOL, 'skill', option.id)).toEqual(skillIds)
      // 「全部」页签下选了阵营：AI 被收窄，技能牌仍是完整的那 26 张。
      const all = filterDeckCards(CARD_POOL, 'all', option.id)
      expect(all.filter((cardId) => getCard(cardId).kind === 'skill')).toEqual(skillIds)
      expect(all.filter((cardId) => getCard(cardId).kind === 'ai')).toEqual(
        filterDeckCards(CARD_POOL, 'ai', option.id),
      )
    }
  })

  it('24 张设计稿技能卡在任何阵营下都看得见', () => {
    for (const option of FACTIONS) {
      const shown = new Set(filterDeckCards(CARD_POOL, 'all', option.id))
      for (const cardId of SKILL_DESIGN_CARD_IDS) expect(shown.has(cardId)).toBe(true)
    }
  })
})
