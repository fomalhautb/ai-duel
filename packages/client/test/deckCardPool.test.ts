import { describe, expect, it } from 'vitest'
import { CARD_POOL, getCard } from '@ai-duel/core'
import { DECK_DEMO_CARDS } from '../src/screens/deckDemoCards'

/**
 * 牌组页（screens/DeckScreen.tsx）的卡池是玩家存档里的真卡，那批 id 全部来自 core 的 CARD_POOL。
 *
 * 这里守的是这一页最要紧的一条：卡池里的每张牌都要能进 createGame。
 * 只有设计稿、还没进规则引擎的展示卡（screens/deckDemoCards.ts）拿不到 CardId，
 * 混进卡池的话，玩家能把它选进牌组，开局时 getCard 才抛错——那时已经晚了。
 */
describe('牌组页卡池', () => {
  it('卡池里每张牌都能取到 core 的定义，所以拼出来的牌组可以直接开局', () => {
    expect(CARD_POOL.length).toBeGreaterThan(0)
    for (const cardId of CARD_POOL) {
      expect(() => getCard(cardId)).not.toThrow()
    }
  })

  it('卡池只有 AI 和技能两类，正好对上页面的两个 kind 页签', () => {
    // 出现第三类的话，那些牌在「AI 牌」「技能牌」两个页签下都看不见，
    // 只有「全部」的计数会莫名多出来。
    const kinds = CARD_POOL.map((cardId) => getCard(cardId).kind)
    const counted = kinds.filter((kind) => kind === 'ai' || kind === 'skill').length
    expect(counted).toBe(CARD_POOL.length)
  })

  it('图鉴那批技能展示卡一张都没混进卡池', () => {
    const pool = new Set<string>(CARD_POOL)
    for (const card of DECK_DEMO_CARDS) {
      expect(pool.has(card.id)).toBe(false)
    }
  })
})
