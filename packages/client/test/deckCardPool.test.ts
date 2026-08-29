import { describe, expect, it } from 'vitest'
import { CARD_POOL, SKILL_DESIGN_CARD_IDS, getCard } from '@ai-duel/core'

/**
 * 牌组页（screens/DeckScreen.tsx）的卡池是玩家存档里的真卡，那批 id 全部来自 core 的 CARD_POOL。
 *
 * 这里守的是这一页最要紧的一条：卡池里的每张牌都要能进 createGame。
 * 拿不到 CardId 的展示数据混进卡池的话，玩家能把它选进牌组，开局时 getCard 才抛错
 * ——那时已经晚了。
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

  it('24 张设计稿技能卡都在卡池里，而且一张都不要目标', () => {
    // 这批牌从"只有设计稿的展示数据"转正成了真卡（core 的 SKILL_DESIGN_CARDS），
    // 所以它们必须满足卡池的全部约束：取得到定义、算技能牌、不要求选目标。
    // 最后一条尤其要守：填了 target，引擎就会逼玩家点一个目标，而点完什么都不会发生。
    const pool = new Set<string>(CARD_POOL)
    expect(SKILL_DESIGN_CARD_IDS).toHaveLength(24)
    for (const cardId of SKILL_DESIGN_CARD_IDS) {
      expect(pool.has(cardId)).toBe(true)
      const card = getCard(cardId)
      // 这一句既是"必须是技能牌"那条断言，也顺带把类型收窄到 SkillCard，下面才读得到 target。
      if (card.kind !== 'skill') throw new Error(`${cardId} 不是技能牌`)
      expect(card.target).toBeUndefined()
    }
  })
})
