import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_CARD_IDS,
  CARD_POOL,
  CARDS,
  drawNewCard,
  HEROES,
  INITIAL_COLLECTION,
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

  it('18 张 AI 都已解锁，且在默认的 20 张牌组里各有一张', () => {
    expect(STARTER_DECK).toHaveLength(20)
    for (const id of AI_MODEL_CARD_IDS) {
      expect(INITIAL_COLLECTION).toContain(id)
      expect(STARTER_DECK.filter((cardId) => cardId === id)).toHaveLength(1)
    }
  })

  it('卡池覆盖全部卡牌定义', () => {
    expect(CARD_POOL).toHaveLength(Object.keys(CARDS).length)
    expect(new Set(CARD_POOL).size).toBe(CARD_POOL.length)
  })

  it('初始收藏都是卡池里的卡', () => {
    for (const id of INITIAL_COLLECTION) {
      expect(CARD_POOL).toContain(id)
    }
  })

  it('示例牌组只用初始收藏里的卡', () => {
    for (const id of STARTER_DECK) {
      expect(INITIAL_COLLECTION).toContain(id)
    }
  })

  it('英雄牌不进卡表、不进卡池、也不进牌组', () => {
    // 英雄牌是开局前单独选的，一旦漏进这三张表就会被当成能抽、能进牌组的普通牌。
    expect(Object.keys(HEROES)).toEqual(['grace-hopper'])
    for (const id of Object.keys(HEROES)) {
      expect(CARDS).not.toHaveProperty(id)
      expect(CARD_POOL).not.toContain(id)
      expect(STARTER_DECK).not.toContain(id)
    }
  })
})

describe('drawNewCard', () => {
  // 现在示例牌组把卡池里的卡全用上了，初始收藏只能等于整个卡池（见 collection.ts），
  // 所以这里不拿 INITIAL_COLLECTION 当"已拥有"，改用手搓的列表，
  // 免得卡池一扩这些用例的前提就变了。
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
