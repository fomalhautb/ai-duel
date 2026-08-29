import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_CARD_IDS,
  CARD_POOL,
  CARDS,
  drawNewCard,
  HEROES,
  INITIAL_COLLECTION,
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

  it('18 张 AI 都已解锁，且在默认的 20 张牌组里各有一张', () => {
    expect(STARTER_DECK).toHaveLength(20)
    for (const id of AI_MODEL_CARD_IDS) {
      expect(INITIAL_COLLECTION).toContain(id)
      expect(STARTER_DECK.filter((cardId) => cardId === id)).toHaveLength(1)
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
