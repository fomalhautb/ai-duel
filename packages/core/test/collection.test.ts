import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_CARD_IDS,
  CARD_POOL,
  CARDS,
  COMING_SOON_SKILL_CARD_IDS,
  drawNewCard,
  HEROES,
  INITIAL_COLLECTION,
  OPEN_SKILL_CARD_IDS,
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

  it('24 张技能卡分成开放的 10 张和「即将上线」的 14 张', () => {
    // 开放名单就是"效果已经接进引擎"的那批，改动它意味着开放 / 收回了某张牌，
    // 而那件事牵着卡池、初始收藏、示例牌组一整串，应该在这一行当场红。
    // 顺序跟着 SKILL_DESIGN_CARDS 的键序走（卡池和图鉴按它摆），所以用对顺序敏感的 toEqual。
    expect(SKILL_DESIGN_CARD_IDS).toHaveLength(24)
    expect(OPEN_SKILL_CARD_IDS).toEqual([
      'black-white-reversal',
      'fixed-answer',
      'jade-purification-vase',
      'golden-bell-shield',
      'safe-pass',
      'model-distillation',
      'nuclear-power-station',
      'domestic-substitution',
      'rising-tide',
      'memory-shortage',
    ])
    // 两份名单不重不漏地把 24 张分完：漏一张就会有牌既进不了卡池、又不在牌组页摆出来，
    // 等于凭空消失。
    expect(COMING_SOON_SKILL_CARD_IDS).toHaveLength(14)
    expect(new Set([...OPEN_SKILL_CARD_IDS, ...COMING_SOON_SKILL_CARD_IDS])).toEqual(
      new Set(SKILL_DESIGN_CARD_IDS),
    )
  })

  it('开放的技能卡开局全解锁，默认牌组只带其中两张', () => {
    // 默认牌组里的技能牌各走一条出牌链路：「复读机」要选目标，「鸡犬升天」打出即完事。
    // 开放的其余几张各自落在这两条链路之一，塞进默认牌组只会挤掉 AI 牌，摸不到新东西。
    const inDeck = ['fixed-answer', 'rising-tide']
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

  it('技能牌一共 24 张，其中 5 张要选目标', () => {
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
    // 客户端的选目标交互按这份名单走，各自选谁由 skillCards.test.ts 那条守着。
    expect(
      new Set(skills.filter((card) => card.target !== undefined).map((card) => card.id)),
    ).toEqual(
      new Set([
        'fixed-answer',
        'black-white-reversal',
        'jade-purification-vase',
        'safe-pass',
        'model-distillation',
      ]),
    )
  })

  it('卡池 = 全部卡牌定义减去「即将上线」的那批', () => {
    expect(CARD_POOL).toHaveLength(Object.keys(CARDS).length - COMING_SOON_SKILL_CARD_IDS.length)
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

describe('AI 牌身上给技能牌读的两个标签', () => {
  const aiCards = Object.values(CARDS).filter((card) => card.kind === 'ai')

  it('国产标签正好挂在这 10 张上（「国产替代」按它清场）', () => {
    expect(new Set(aiCards.filter((card) => card.domestic === true).map((card) => card.id))).toEqual(
      new Set([
        'deepseek-r1',
        'deepseek-v4',
        'qwen',
        'kimi-k2-6',
        'kimi-k3',
        'doubao',
        'glm-5',
        'minimax',
        'yuanbao',
        'wenxin-yiyan',
      ]),
    )
    // 只标 true 不标 false：非国产的那 8 张一律不带这个字段。
    for (const card of aiCards) {
      expect([true, undefined]).toContain(card.domestic)
    }
  })

  it('四条进化链首尾相接，链尾不再往下指', () => {
    const nextOf = Object.fromEntries(aiCards.map((card) => [card.id, card.evolvesTo]))
    expect(nextOf).toMatchObject({
      'gpt-2': 'gpt-3-5',
      'gpt-3-5': 'gpt-4o',
      'gpt-4o': 'chatgpt-5-6-sol',
      'chatgpt-5-6-sol': undefined,
      'claude-5-sonnet': 'claude-fable-5',
      'claude-fable-5': undefined,
      'deepseek-r1': 'deepseek-v4',
      'deepseek-v4': undefined,
      'kimi-k2-6': 'kimi-k3',
      'kimi-k3': undefined,
    })
    // 没有前后代的单张一律不可进化，「鸡犬升天」扫到它们时原地不动。
    for (const id of ['gemini', 'qwen', 'doubao', 'glm-5', 'minimax', 'yuanbao', 'grok', 'wenxin-yiyan']) {
      expect(nextOf[id]).toBeUndefined()
    }
  })

  it('进化链指向的都是真卡，且不会指回自己（否则鸡犬升天会原地打转）', () => {
    for (const card of aiCards) {
      if (card.evolvesTo === undefined) continue
      expect(CARDS[card.evolvesTo]).toBeDefined()
      expect(card.evolvesTo).not.toBe(card.id)
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
