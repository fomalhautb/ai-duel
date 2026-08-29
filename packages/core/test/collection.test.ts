import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_CARD_IDS,
  AI_MODEL_CARDS,
  CARD_POOL,
  CARDS,
  drawNewCard,
  HEROES,
  INITIAL_COLLECTION,
  isDeckable,
  PLAYABLE_AI_CARD_IDS,
  SKILL_DESIGN_CARD_IDS,
  STARTER_DECK,
} from '../src/index'

describe('卡池与初始收藏', () => {
  it('AI 牌就是 aiModels 里那 18 张，占位模型牌已经没了', () => {
    // 卡池换过一轮：早期那四张占位 AI（ai-gpt / ai-claude / ai-gemini / ai-deepseek）
    // 已经被 18 张具名模型顶掉，这里守着别有人把旧 id 又捡回来。
    for (const id of ['ai-gpt', 'ai-claude', 'ai-gemini', 'ai-deepseek']) {
      expect(CARDS[id]).toBeUndefined()
      expect(CARD_POOL).not.toContain(id)
      expect(INITIAL_COLLECTION).not.toContain(id)
      expect(STARTER_DECK).not.toContain(id)
    }
    expect(AI_MODEL_CARD_IDS).toHaveLength(18)
    expect(
      Object.values(CARDS)
        .filter((card) => card.kind === 'ai')
        .map((card) => card.id),
    ).toEqual(AI_MODEL_CARD_IDS)
  })

  it('18 张 AI 都已解锁，能上场的那 16 张各带一张（最便宜的两张各两张）', () => {
    expect(STARTER_DECK).toHaveLength(20)
    // 补第二份的这两张：全场最便宜的 AI（各 2 点），顶掉两张灰牌空出来的位置。
    const doubled = ['gpt-3-5', 'doubao']
    for (const id of AI_MODEL_CARD_IDS) {
      // 灰牌也在收藏里：卡池要把它们摆出来（见 collection.ts）。
      expect(INITIAL_COLLECTION).toContain(id)
      const want = isDeckable(id) ? (doubled.includes(id) ? 2 : 1) : 0
      expect(STARTER_DECK.filter((cardId) => cardId === id)).toHaveLength(want)
    }
  })

  it('默认牌组里没有一张是选不进牌组的灰牌', () => {
    // 起始牌组会被直接播成玩家的第一套牌组（见 client 的 deckStore），
    // 混进一张加不进牌组的牌，玩家一进构筑页就会看到一副自己拼不出来的牌。
    for (const id of STARTER_DECK) {
      expect(isDeckable(id)).toBe(true)
    }
  })

  it('24 张技能卡开局全解锁，默认牌组只带其中两张', () => {
    // 默认牌组里的技能牌各走一条出牌链路：「复读机」要选目标，「一句话回答」打出即完事。
    // 其余 22 张和「一句话回答」是同一条链路，塞进默认牌组只会挤掉 AI 牌，
    // 让新玩家开局就摸到一手什么都不会发生的卡。
    expect(SKILL_DESIGN_CARD_IDS).toHaveLength(24)
    const inDeck = ['fixed-answer', 'one-sentence-answer']
    for (const id of SKILL_DESIGN_CARD_IDS) {
      expect(CARD_POOL).toContain(id)
      expect(INITIAL_COLLECTION).toContain(id)
      expect(STARTER_DECK.filter((cardId) => cardId === id)).toHaveLength(
        inDeck.includes(id) ? 1 : 0,
      )
    }
  })

  it('技能牌一共 24 张，只有「复读机」要选目标', () => {
    // 早期那两张（placeholder-skill / skill-must-answer）已经删掉：占位技能没有卡面原画，
    // 而「必须回答」的功能整个挪到了同样效果的「复读机」上。守着别有人把旧 id 又捡回来。
    const skills = Object.values(CARDS).filter((card) => card.kind === 'skill')
    expect(skills).toHaveLength(24)
    for (const id of ['placeholder-skill', 'skill-must-answer']) {
      expect(CARDS[id]).toBeUndefined()
      expect(CARD_POOL).not.toContain(id)
      expect(INITIAL_COLLECTION).not.toContain(id)
      expect(STARTER_DECK).not.toContain(id)
    }
    expect(skills.filter((card) => card.target !== undefined).map((card) => card.id)).toEqual([
      'fixed-answer',
    ])
  })

  it('卡池覆盖全部卡牌定义', () => {
    expect(CARD_POOL).toHaveLength(Object.keys(CARDS).length)
    expect(new Set(CARD_POOL).size).toBe(CARD_POOL.length)
  })

  it('初始收藏就是整个卡池：新玩家一进来卡池页就摆得满满的', () => {
    expect(new Set(INITIAL_COLLECTION)).toEqual(new Set(CARD_POOL))
    expect(INITIAL_COLLECTION).toHaveLength(CARD_POOL.length)
  })

  it('示例牌组只用初始收藏里的卡', () => {
    for (const id of STARTER_DECK) {
      expect(INITIAL_COLLECTION).toContain(id)
    }
  })

  it('七位英雄都不进卡表、不进卡池、也不进牌组', () => {
    // 英雄牌是开局前单独选的，一旦漏进这三张表就会被当成能抽、能进牌组的普通牌。
    // 键序 = 选英雄界面的展示顺序，所以这里用对顺序敏感的 toEqual 一并守着。
    expect(Object.keys(HEROES)).toEqual([
      'fei-fei-li',
      'danqi-chen',
      'melanie-perkins',
      'mira-murati',
      'ada-lovelace',
      'margaret-hamilton',
      'grace-hopper',
    ])
    for (const id of Object.keys(HEROES)) {
      expect(CARDS).not.toHaveProperty(id)
      expect(CARD_POOL).not.toContain(id)
      expect(STARTER_DECK).not.toContain(id)
    }
  })
})

describe('调不到模型的 AI 牌', () => {
  // 这两张牌在 OpenRouter 上没有对得上的模型（原委见 aiModels.ts 里各自的注释）：
  // 留在卡池里陈列，但选不进牌组。改这份名单等于改玩家能用哪些牌，所以写死在这里守着。
  const unavailable = ['gpt-2', 'wenxin-yiyan']

  it('只有 GPT-2 和文心一言的 openrouter 是 null', () => {
    const nulls = AI_MODEL_CARD_IDS.filter((id) => AI_MODEL_CARDS[id]?.openrouter === null)
    expect(nulls).toEqual(unavailable)
  })

  it('其余 16 张都填了看得出厂商的 OpenRouter id', () => {
    expect(PLAYABLE_AI_CARD_IDS).toHaveLength(16)
    for (const id of PLAYABLE_AI_CARD_IDS) {
      // OpenRouter 的 id 一律是「厂商/模型」两段，写漏斜杠调用时会 404。
      expect(AI_MODEL_CARDS[id]?.openrouter).toMatch(/^[a-z0-9-]+\/\S+$/)
    }
  })

  it('isDeckable：灰牌选不进，其余 AI 和全部技能牌都能选', () => {
    for (const id of unavailable) expect(isDeckable(id)).toBe(false)
    for (const id of PLAYABLE_AI_CARD_IDS) expect(isDeckable(id)).toBe(true)
    for (const id of SKILL_DESIGN_CARD_IDS) expect(isDeckable(id)).toBe(true)
    // 卡池里没有的 id 也算选不进，存档筛脏数据时要靠这一条。
    expect(isDeckable('nope')).toBe(false)
  })

  it('灰牌仍然留在卡池和初始收藏里', () => {
    for (const id of unavailable) {
      expect(CARD_POOL).toContain(id)
      expect(INITIAL_COLLECTION).toContain(id)
    }
  })
})

describe('drawNewCard', () => {
  // 初始收藏眼下就等于整个卡池（新玩家开局全解锁，见 collection.ts），
  // 所以这里不拿 INITIAL_COLLECTION 当"已拥有"，改用手搓的列表，
  // 免得哪天解锁策略一改这些用例的前提就变了。
  const owned = CARD_POOL.slice(0, 2)
  const candidates = CARD_POOL.filter((id) => !owned.includes(id))

  it('只会抽到没拥有的卡', () => {
    // 遍历 [0,1) 上的一串取值，确认每次都落在未拥有的卡上。
    for (let i = 0; i < 20; i++) {
      const drawn = drawNewCard(owned, i / 20)
      expect(drawn).not.toBeNull()
      expect(owned).not.toContain(drawn)
      expect(CARD_POOL).toContain(drawn)
    }
  })

  it('随机数覆盖整个 [0,1) 时能抽出全部候选卡', () => {
    const drawn = new Set(
      candidates.map((_, i) => drawNewCard(owned, (i + 0.5) / candidates.length)),
    )
    expect(drawn).toEqual(new Set(candidates))
  })

  it('random 传 1（超出约定范围）时取最后一张而不是越界', () => {
    expect(drawNewCard(owned, 1)).not.toBeNull()
  })

  it('全部集齐时返回 null', () => {
    expect(drawNewCard(CARD_POOL, 0.5)).toBeNull()
    // 眼下初始收藏就等于整个卡池，所以新玩家赢一局也抽不到新卡。
    expect(drawNewCard(INITIAL_COLLECTION, 0.5)).toBeNull()
  })

  it('不修改传入的已拥有列表', () => {
    const copy = [...owned]
    drawNewCard(copy, 0.3)
    expect(copy).toEqual(owned)
  })
})
