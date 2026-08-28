import { describe, expect, it } from 'vitest'
import { AI_MODEL_CARD_IDS, CARD_POOL, CARDS, drawNewCard, INITIAL_COLLECTION, STARTER_DECK } from '../src/index'

describe('卡池与初始收藏', () => {
  it('四张占位模型已从卡池、收藏与牌组删除', () => {
    const removed = ['hallucinating-oracle', 'context-goldfish', 'stereotype-parrot', 'benchmark-champion']
    for (const id of removed) {
      expect(CARDS[id]).toBeUndefined()
      expect(CARD_POOL).not.toContain(id)
      expect(INITIAL_COLLECTION).not.toContain(id)
      expect(STARTER_DECK).not.toContain(id)
    }
    expect(Object.values(CARDS).filter((card) => card.kind === 'model').map((card) => card.id)).toEqual(AI_MODEL_CARD_IDS)
  })
  it('18 张 AI 均已解锁，且在默认 22 张牌组中各有一张', () => {
    expect(AI_MODEL_CARD_IDS).toHaveLength(18)
    expect(STARTER_DECK).toHaveLength(22)
    for (const id of AI_MODEL_CARD_IDS) {
      expect(CARDS[id]?.kind).toBe('model')
      expect(INITIAL_COLLECTION).toContain(id)
      expect(STARTER_DECK.filter((cardId) => cardId === id)).toHaveLength(1)
    }
  })
  it('卡池覆盖全部卡牌定义', () => {
    expect(CARD_POOL).toHaveLength(Object.keys(CARDS).length)
    expect(new Set(CARD_POOL).size).toBe(CARD_POOL.length)
  })

  it('初始收藏是卡池的真子集，才有卡可抽', () => {
    for (const id of INITIAL_COLLECTION) {
      expect(CARD_POOL).toContain(id)
    }
    expect(INITIAL_COLLECTION.length).toBeLessThan(CARD_POOL.length)
  })

  it('示例牌组只用初始收藏里的卡', () => {
    for (const id of STARTER_DECK) {
      expect(INITIAL_COLLECTION).toContain(id)
    }
  })
})

describe('drawNewCard', () => {
  it('只会抽到没拥有的卡', () => {
    const owned = [...INITIAL_COLLECTION]
    // 遍历 [0,1) 上的一串取值，确认每次都落在未拥有的卡上。
    for (let i = 0; i < 20; i++) {
      const drawn = drawNewCard(owned, i / 20)
      expect(drawn).not.toBeNull()
      expect(owned).not.toContain(drawn)
      expect(CARD_POOL).toContain(drawn)
    }
  })

  it('随机数覆盖整个 [0,1) 时能抽出全部候选卡', () => {
    const candidates = CARD_POOL.filter((id) => !INITIAL_COLLECTION.includes(id))
    const drawn = new Set(
      candidates.map((_, i) => drawNewCard(INITIAL_COLLECTION, (i + 0.5) / candidates.length)),
    )
    expect(drawn).toEqual(new Set(candidates))
  })

  it('random 传 1（超出约定范围）时取最后一张而不是越界', () => {
    expect(drawNewCard(INITIAL_COLLECTION, 1)).not.toBeNull()
  })

  it('全部集齐时返回 null', () => {
    expect(drawNewCard(CARD_POOL, 0.5)).toBeNull()
  })

  it('不修改传入的已拥有列表', () => {
    const owned = [...INITIAL_COLLECTION]
    drawNewCard(owned, 0.3)
    expect(owned).toEqual(INITIAL_COLLECTION)
  })
})
