import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_CARD_IDS,
  AI_MODEL_CARDS,
  CARD_POOL,
  CARDS,
  COMING_SOON_SKILL_CARD_IDS,
  drawNewCard,
  HEROES,
  INITIAL_COLLECTION,
  OPEN_SKILL_CARD_IDS,
  PLAYABLE_AI_CARD_IDS,
  UNAVAILABLE_AI_CARD_IDS,
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

  it('能上场的 16 张 AI 都已解锁，默认牌组里各带一张（最便宜的两张各两张）', () => {
    expect(STARTER_DECK).toHaveLength(20)
    // 补第二份的这两张：全场最便宜的 AI（各 2 点），顶掉两张调不到模型的牌空出来的位置。
    const doubled = ['gpt-3-5', 'doubao']
    for (const id of PLAYABLE_AI_CARD_IDS) {
      expect(INITIAL_COLLECTION).toContain(id)
      expect(STARTER_DECK.filter((cardId) => cardId === id)).toHaveLength(
        doubled.includes(id) ? 2 : 1,
      )
    }
  })

  it('默认牌组里没有一张是卡池外的牌', () => {
    // 起始牌组会被直接播成玩家的第一套牌组（见 client 的 deckStore），
    // 混进一张卡池外的牌，读档时会被当脏数据剔掉，玩家一进构筑页就看到一副缺张的牌。
    for (const id of STARTER_DECK) {
      expect(CARD_POOL).toContain(id)
    }
  })

  it('24 张技能卡分成开放的 9 张和「即将上线」的 15 张', () => {
    // 名单是产品定的，所以这里逐个写死：改动它意味着开放 / 收回了某张牌，
    // 而那件事牵着卡池、初始收藏、示例牌组一整串，应该在这一行当场红。
    // 顺序跟着 SKILL_DESIGN_CARDS 的键序走（卡池和图鉴按它摆），所以用对顺序敏感的 toEqual。
    expect(SKILL_DESIGN_CARD_IDS).toHaveLength(24)
    expect(OPEN_SKILL_CARD_IDS).toEqual([
      'black-white-reversal',
      'fixed-answer',
      'clean-sweep',
      'golden-bell-shield',
      'anti-addiction',
      'nuclear-power-station',
      'domestic-substitution',
      'rising-tide',
      'memory-shortage',
    ])
    // 两份名单不重不漏地把 24 张分完：漏一张就会有牌既进不了卡池、又不在牌组页摆出来，
    // 等于凭空消失。
    expect(COMING_SOON_SKILL_CARD_IDS).toHaveLength(15)
    expect(new Set([...OPEN_SKILL_CARD_IDS, ...COMING_SOON_SKILL_CARD_IDS])).toEqual(
      new Set(SKILL_DESIGN_CARD_IDS),
    )
  })

  it('开放的技能卡开局全解锁，默认牌组只带其中两张', () => {
    // 默认牌组里的技能牌各走一条出牌链路：「复读机」要选目标，「防沉迷」打出即完事。
    // 开放的其余几张和「防沉迷」是同一条链路，塞进默认牌组只会挤掉 AI 牌，
    // 让新玩家开局就摸到一手什么都不会发生的卡。
    const inDeck = ['fixed-answer', 'anti-addiction']
    for (const id of OPEN_SKILL_CARD_IDS) {
      expect(CARD_POOL).toContain(id)
      expect(INITIAL_COLLECTION).toContain(id)
      expect(STARTER_DECK.filter((cardId) => cardId === id)).toHaveLength(
        inDeck.includes(id) ? 1 : 0,
      )
    }
  })

  it('「即将上线」的技能卡查得到卡面，但进不了卡池、收藏和牌组', () => {
    // 卡面数据必须留在 CARDS 里：牌组页和图鉴要照常把它们画出来（灰着、排在最后）。
    // 而卡池那三条一旦漏了，玩家就能把还没开放的牌选进牌组、带上牌桌。
    for (const id of COMING_SOON_SKILL_CARD_IDS) {
      expect(CARDS[id]).toBeDefined()
      expect(CARD_POOL).not.toContain(id)
      expect(INITIAL_COLLECTION).not.toContain(id)
      expect(STARTER_DECK).not.toContain(id)
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

  it('卡池 = 全部卡牌定义减去「即将上线」和「调不到模型」的那两批', () => {
    expect(CARD_POOL).toHaveLength(
      Object.keys(CARDS).length -
        COMING_SOON_SKILL_CARD_IDS.length -
        UNAVAILABLE_AI_CARD_IDS.length,
    )
    expect(new Set(CARD_POOL).size).toBe(CARD_POOL.length)
    // 反过来也要成立：卡池里不许有 CARDS 查不到的 id，否则开局 getCard 会抛错。
    for (const id of CARD_POOL) expect(CARDS[id]).toBeDefined()
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
  it('18 张 AI 分成能上场的 16 张和调不到模型的 2 张', () => {
    // 名单写死在这里：改动它意味着某张牌能不能上场变了，而那件事牵着卡池、初始收藏、
    // 示例牌组一整串，应该在这一行当场红。顺序跟着 AI_MODEL_CARDS 的键序走。
    expect(AI_MODEL_CARD_IDS).toHaveLength(18)
    expect(UNAVAILABLE_AI_CARD_IDS).toEqual(['gpt-2', 'wenxin-yiyan'])
    expect(PLAYABLE_AI_CARD_IDS).toHaveLength(16)
    expect([...PLAYABLE_AI_CARD_IDS, ...UNAVAILABLE_AI_CARD_IDS].sort()).toEqual(
      [...AI_MODEL_CARD_IDS].sort(),
    )
  })

  it('两份名单的依据就是 openrouter 填没填', () => {
    for (const id of UNAVAILABLE_AI_CARD_IDS) {
      expect(AI_MODEL_CARDS[id]?.openrouter).toBeNull()
    }
    for (const id of PLAYABLE_AI_CARD_IDS) {
      // OpenRouter 的 id 一律是「厂商/模型」两段，写漏斜杠调用时会 404。
      expect(AI_MODEL_CARDS[id]?.openrouter).toMatch(/^[a-z0-9-]+\/\S+$/)
    }
  })

  it('调不到模型的那两张不进卡池，但卡面定义留着给牌组页画', () => {
    for (const id of UNAVAILABLE_AI_CARD_IDS) {
      expect(CARDS[id]).toBeDefined()
      expect(CARD_POOL).not.toContain(id)
      expect(INITIAL_COLLECTION).not.toContain(id)
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
