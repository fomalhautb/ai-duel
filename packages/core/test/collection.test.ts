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
  BALANCED_DECK,
  LOW_COST_DECK,
  HIGH_COST_DECK,
  PRESET_DECKS,
  DECK_SIZE,
} from '../src/index'
import type { AiCard, CardId, SkillCard } from '../src/types'

/** 一张卡在某副牌组里带了几份。 */
function copies(deck: readonly CardId[], cardId: CardId): number {
  return deck.filter((id) => id === cardId).length
}

/** 挑出牌组里的 AI 牌，顺带把类型收窄到 AiCard，好读 tokenCost / domestic / evolvesTo。 */
function aiCardsIn(deck: readonly CardId[]): AiCard[] {
  return deck.map((id) => CARDS[id]).filter((card): card is AiCard => card?.kind === 'ai')
}

/** 同上，挑技能牌。 */
function skillCardsIn(deck: readonly CardId[]): SkillCard[] {
  return deck.map((id) => CARDS[id]).filter((card): card is SkillCard => card?.kind === 'skill')
}

/** 构筑页的同名卡上限（client 的 deckStore.MAX_COPIES）：预设不该出现玩家自己编不出来的牌组。 */
const MAX_COPIES = 3

describe('卡池与初始收藏', () => {
  it('AI 牌就是 aiModels 里那 18 张，占位模型牌已经没了', () => {
    // 卡池换过一轮：早期那四张占位 AI（ai-gpt / ai-claude / ai-gemini / ai-deepseek）
    // 已经被 18 张具名模型顶掉，这里守着别有人把旧 id 又捡回来。
    for (const id of ['ai-gpt', 'ai-claude', 'ai-gemini', 'ai-deepseek']) {
      expect(CARDS[id]).toBeUndefined()
      expect(CARD_POOL).not.toContain(id)
      expect(INITIAL_COLLECTION).not.toContain(id)
      for (const deck of PRESET_DECKS) expect(deck).not.toContain(id)
    }
    expect(AI_MODEL_CARD_IDS).toHaveLength(18)
    expect(
      Object.values(CARDS)
        .filter((card) => card.kind === 'ai')
        .map((card) => card.id),
    ).toEqual(AI_MODEL_CARD_IDS)
  })

  it('能上场的 16 张 AI 都已解锁', () => {
    for (const id of PLAYABLE_AI_CARD_IDS) {
      expect(INITIAL_COLLECTION).toContain(id)
    }
  })

  it('三套预设各 20 张、同名卡不超过 3 份、没有一张是卡池外的牌', () => {
    // 三套预设会被直接播成玩家最初的三套牌组（见 client 的 deckStore），
    // 混进一张卡池外的牌，读档时会被当脏数据剔掉，玩家一进构筑页就看到一副缺张的牌；
    // 带满 4 份则是玩家自己在构筑页编不出来的牌组。
    expect(PRESET_DECKS).toHaveLength(3)
    for (const deck of PRESET_DECKS) {
      expect(deck).toHaveLength(DECK_SIZE)
      for (const id of deck) {
        expect(CARD_POOL).toContain(id)
        expect(copies(deck, id)).toBeLessThanOrEqual(MAX_COPIES)
      }
    }
  })

  it('默认牌组（平衡）：国产和国外 AI 各 7 张，技能 6 张各不重样', () => {
    // 这副是新玩家的第一套牌组，卖点就是"两边都摸得到"：国产 / 国外对半、技能不重样。
    // 数字对不上说明有人往里塞牌时把平衡这件事挤掉了。
    const ai = aiCardsIn(BALANCED_DECK)
    expect(ai).toHaveLength(14)
    expect(ai.filter((card) => card.domestic === true)).toHaveLength(7)
    const skills = skillCardsIn(BALANCED_DECK)
    expect(skills).toHaveLength(6)
    expect(new Set(skills.map((card) => card.id)).size).toBe(skills.length)
    // 「国产替代」会把这副牌一半的国外 AI 一起清掉，不该出现在这里。
    expect(BALANCED_DECK).not.toContain('domestic-substitution')
  })

  it('低费流：AI 全是 3 点以内的便宜牌，「鸡犬升天」带满 3 张且有的可升', () => {
    for (const card of aiCardsIn(LOW_COST_DECK)) {
      expect(card.tokenCost).toBeLessThanOrEqual(3)
    }
    expect(copies(LOW_COST_DECK, 'rising-tide')).toBe(MAX_COPIES)
    // 「鸡犬升天」只对带 evolvesTo 的单位有用，牌组里得有足够多的升级目标才成立。
    const evolvable = aiCardsIn(LOW_COST_DECK).filter((card) => card.evolvesTo !== undefined)
    expect(evolvable.length).toBeGreaterThanOrEqual(9)
  })

  it('强卡流：AI 全是 4 点以上的贵牌，保护牌至少 6 张', () => {
    for (const card of aiCardsIn(HIGH_COST_DECK)) {
      expect(card.tokenCost).toBeGreaterThanOrEqual(4)
    }
    // 贵单位答错就被罚下，一轮的 Token 全白花，所以这副牌的立身之本是保护位够厚。
    const protection = ['safe-pass', 'jade-purification-vase', 'golden-bell-shield']
    const count = HIGH_COST_DECK.filter((id) => protection.includes(id)).length
    expect(count).toBeGreaterThanOrEqual(6)
    // 第 1 轮上限只有 5 点（engine 的 INITIAL_TOKEN_MAX），没有「模型蒸馏」垫一手根本起不来。
    expect(copies(HIGH_COST_DECK, 'model-distillation')).toBeGreaterThanOrEqual(1)
  })

  it('24 张技能卡分成开放的 10 张和「即将上线」的 14 张', () => {
    // 开放名单就是"效果已经接进引擎"的那批，改动它意味着开放 / 收回了某张牌，
    // 而那件事牵着卡池、初始收藏、预设牌组一整串，应该在这一行当场红。
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

  it('开放的技能卡开局全解锁，预设里的技能牌也只从这批里挑', () => {
    for (const id of OPEN_SKILL_CARD_IDS) {
      expect(CARD_POOL).toContain(id)
      expect(INITIAL_COLLECTION).toContain(id)
    }
    // 反过来：预设里凡是技能牌，必须是开放的那批。带一张占位牌进去，
    // 玩家打出后什么都不会发生，看着就像游戏坏了。
    for (const deck of PRESET_DECKS) {
      for (const card of skillCardsIn(deck)) {
        expect(OPEN_SKILL_CARD_IDS).toContain(card.id)
      }
    }
  })

  it('「即将上线」的技能卡查得到卡面，但进不了卡池、收藏和牌组', () => {
    // 卡面数据必须留在 CARDS 里：牌组页和图鉴要照常把它们画出来（灰着、排在最后）。
    // 而卡池那三条一旦漏了，玩家就能把还没开放的牌选进牌组、带上牌桌。
    for (const id of COMING_SOON_SKILL_CARD_IDS) {
      expect(CARDS[id]).toBeDefined()
      expect(CARD_POOL).not.toContain(id)
      expect(INITIAL_COLLECTION).not.toContain(id)
      for (const deck of PRESET_DECKS) expect(deck).not.toContain(id)
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
      for (const deck of PRESET_DECKS) expect(deck).not.toContain(id)
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

  it('三套预设只用初始收藏里的卡', () => {
    for (const deck of PRESET_DECKS) {
      for (const id of deck) expect(INITIAL_COLLECTION).toContain(id)
    }
  })

  it('七位英雄都不进卡表、不进卡池、也不进牌组', () => {
    // 英雄牌是开局前单独选的，一旦漏进这三张表就会被当成能抽、能进牌组的普通牌。
    // 键序 = 选英雄界面的展示顺序，所以这里用对顺序敏感的 toEqual 一并守着。
    expect(Object.keys(HEROES)).toEqual([
      // 已实装的 4 位在前，comingSoon 的 3 位排在最后。
      'danqi-chen',
      'melanie-perkins',
      'ada-lovelace',
      'grace-hopper',
      'fei-fei-li',
      'mira-murati',
      'margaret-hamilton',
    ])
    for (const id of Object.keys(HEROES)) {
      expect(CARDS).not.toHaveProperty(id)
      expect(CARD_POOL).not.toContain(id)
      for (const deck of PRESET_DECKS) expect(deck).not.toContain(id)
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

  // 标签和"调不调得到模型"是两回事：调不到只是进不了卡池，卡面定义连同标签都留着。
  // 调试指令能把这两张摆上场（见 engine 的 DEBUG_ADD_CARD），那时它们照样吃这两条规则。
  it('调不到模型的那两张照样带着标签：文心一言算国产，GPT-2 仍是进化链链头', () => {
    expect(CARDS['wenxin-yiyan']).toMatchObject({ openrouter: null, domestic: true })
    expect(CARDS['gpt-2']).toMatchObject({ openrouter: null, evolvesTo: 'gpt-3-5' })
  })
})

describe('调不到模型的 AI 牌', () => {
  it('18 张 AI 分成能上场的 16 张和调不到模型的 2 张', () => {
    // 名单写死在这里：改动它意味着某张牌能不能上场变了，而那件事牵着卡池、初始收藏、
    // 预设牌组一整串，应该在这一行当场红。顺序跟着 AI_MODEL_CARDS 的键序走。
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
      for (const deck of PRESET_DECKS) expect(deck).not.toContain(id)
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
