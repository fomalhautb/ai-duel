import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_CARD_IDS,
  CARD_POOL,
  COMING_SOON_SKILL_CARD_IDS,
  OPEN_SKILL_CARD_IDS,
  PLAYABLE_AI_CARD_IDS,
  SKILL_DESIGN_CARD_IDS,
  UNAVAILABLE_AI_CARD_IDS,
  getCard,
} from '@ai-duel/core'
import type { CardId, SkillCard } from '@ai-duel/core'
import { cardBackText } from '../src/ui/cardText'

/**
 * 要玩家指定目标的技能牌，以及各自选的是哪一档目标（口径见 core 的 `SkillCard.target`）。
 * 没列在这里的牌一律不该填 target。
 */
const TARGETED_SKILLS: Record<CardId, SkillCard['target']> = {
  'fixed-answer': 'foe-ai',
  'black-white-reversal': 'foe-ai',
  'jade-purification-vase': 'own-affected-ai',
  'safe-pass': 'own-ai',
  'model-distillation': 'own-hand-ai',
}

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

  it('卡池 = 调得到模型的 16 张 AI + 已开放的 10 张技能牌', () => {
    // 这一条把"卡池到底装了什么"钉死：牌组页的每一屏、预设牌组和抽卡全都按它走，
    // 名单一改（开放 / 收回某张技能牌、某张 AI 接上或掉了模型）就该在这里当场红。
    expect(CARD_POOL).toEqual([...PLAYABLE_AI_CARD_IDS, ...OPEN_SKILL_CARD_IDS])
    expect(AI_MODEL_CARD_IDS).toHaveLength(18)
    expect(PLAYABLE_AI_CARD_IDS).toHaveLength(16)
    expect(OPEN_SKILL_CARD_IDS).toHaveLength(10)
  })

  it('牌组页要摆的灰卡有两批：调不到模型的 2 张 AI + 「即将上线」的 14 张技能牌', () => {
    // 两批灰卡在这一页是同一种待遇（灰着排在卡池后面、碰一下只说一句为什么），
    // 但来源是两回事：一批是模型调不到，一批是产品还没开放。数字对不上就说明有牌凭空消失了。
    expect(UNAVAILABLE_AI_CARD_IDS).toEqual(['gpt-2', 'wenxin-yiyan'])
    expect(COMING_SOON_SKILL_CARD_IDS).toHaveLength(14)
    for (const cardId of [...UNAVAILABLE_AI_CARD_IDS, ...COMING_SOON_SKILL_CARD_IDS]) {
      // 卡面数据必须查得到（这一页要画它们），但绝不能进卡池。
      expect(getCard(cardId)).toBeDefined()
      expect(CARD_POOL).not.toContain(cardId)
    }
  })

  it('开放的 10 张技能卡都在卡池里，要选目标的正好是其中那 5 张', () => {
    // 这批牌从"只有设计稿的展示数据"转正成了真卡（core 的 SKILL_DESIGN_CARDS），
    // 所以它们必须满足卡池的全部约束：取得到定义、算技能牌。
    // target 那条尤其要守：效果还没接进引擎的牌一旦填了 target，引擎就会逼玩家点一个目标，
    // 而点完什么都不会发生。反过来，接进引擎、又确实要玩家指一个目标的那几张必须填对档位
    //（客户端照 target 决定亮哪一批目标，见 MatchStage 的 boardTargetsOf）。
    const pool = new Set<string>(CARD_POOL)
    for (const cardId of OPEN_SKILL_CARD_IDS) {
      expect(pool.has(cardId)).toBe(true)
      const card = getCard(cardId)
      // 这一句既是"必须是技能牌"那条断言，也顺带把类型收窄到 SkillCard，下面才读得到 target。
      if (card.kind !== 'skill') throw new Error(`${cardId} 不是技能牌`)
      expect(card.target).toBe(TARGETED_SKILLS[cardId])
    }
    // 反过来也要成立：要选目标的这 5 张全在开放名单里，没有一张漏在「即将上线」那边。
    expect(Object.keys(TARGETED_SKILLS).sort()).toEqual([...OPEN_SKILL_CARD_IDS]
      .filter((id) => TARGETED_SKILLS[id] !== undefined)
      .sort())
  })

  it('接进引擎的技能牌各有一段自己的卡背文案，不会印成「还没实装」', () => {
    // 卡背文案按 id 手写在 ui/cardText.ts 的表里，而"这张牌实装了没有"的唯一判据是
    // 卡牌定义上还带不带 plannedEffect（见 core 的 types.ts）。两边一旦对不上：
    // 实装了却漏写文案，玩家会读到"打出后没有任何实际效果"这句假话；
    // 没实装却写了文案，则是反过来骗他这张牌能用。
    for (const cardId of SKILL_DESIGN_CARD_IDS) {
      const card = getCard(cardId)
      if (card.kind !== 'skill') throw new Error(`${cardId} 不是技能牌`)
      const text = cardBackText(card)
      // 认的是占位分支那句独一份的话（「还没接进规则引擎」）：光找"还没"两个字会误伤
      //「还没被干扰过的 AI」这种正经文案。
      expect(text.includes('还没接进规则引擎')).toBe(card.plannedEffect !== undefined)
    }
  })

  it('「即将上线」的 14 张不在卡池里，但卡面照样查得到', () => {
    // 牌组页把这批牌拼在卡池后面灰着展示（见 DeckScreen 的 DISPLAY_CARD_IDS），
    // 所以 getCard 必须查得到——查不到那一屏当场抛错。
    // 而它们又绝不能进卡池：进了就等于玩家能把还没开放的牌选进牌组。
    const pool = new Set<string>(CARD_POOL)
    expect(COMING_SOON_SKILL_CARD_IDS).toHaveLength(14)
    for (const cardId of COMING_SOON_SKILL_CARD_IDS) {
      expect(pool.has(cardId)).toBe(false)
      expect(getCard(cardId).kind).toBe('skill')
    }
  })
})
