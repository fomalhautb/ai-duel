/**
 * 组牌教学的数据与放行规则（tutorial/deckSteps.ts）。
 *
 * 这一段的界面部分（挖洞高亮、点哪张卡）没法在 node 环境里跑，
 * 但"预填几张、哪几张留给玩家、每一步放行谁"全是纯函数，可以直接断言。
 * 守的是规格 §12 那三个数字：进页面 17/20，三步之后正好 20/20，
 * 而且每一步都只有一张牌加得进去。
 */

import { describe, expect, it } from 'vitest'
import { CARD_POOL, COMING_SOON_SKILL_CARD_IDS, DECK_SIZE, getCard } from '@ai-duel/core'
import { MAX_COPIES } from '../src/save/deckStore'
import {
  DECK_FIRST_STEP,
  DECK_STEPS,
  TUTORIAL_DECK_PICKS,
  deckCardAllowed,
  deckSelectorOf,
  deckStep,
  tutorialDeckPrefill,
} from '../src/tutorial/deckSteps'

describe('组牌教学的预填', () => {
  it('预填正好 17 张，加上三张待选牌凑满一副牌组', () => {
    const prefill = tutorialDeckPrefill()
    expect(prefill).toHaveLength(DECK_SIZE - TUTORIAL_DECK_PICKS.length)
    expect(prefill.length + TUTORIAL_DECK_PICKS.length).toBe(DECK_SIZE)
  })

  // CARD_POOL 里没有「即将上线」的那 15 张技能牌，所以这一条同时也守住了
  // "预填不会替玩家塞一张选不进牌组的牌"——真塞进去会被 sanitizeCards 悄悄丢掉，
  // 教学的 17/20 当场对不上。
  it('预填里的卡都在当前卡池里，不含「即将上线」的牌', () => {
    for (const cardId of tutorialDeckPrefill()) {
      expect(CARD_POOL).toContain(cardId)
      expect(COMING_SOON_SKILL_CARD_IDS).not.toContain(cardId)
    }
  })

  // 卡池缩水到 20 张以下时预填会填不满 17 张，教学的三步就对不上计数了。
  it('卡池够大，预填不会短缺', () => {
    expect(CARD_POOL.length).toBeGreaterThanOrEqual(DECK_SIZE)
  })

  // 三张待加的牌一份都还没占，玩家逐张点下去时不可能撞上"每张最多 MAX_COPIES 份"的规则。
  it('三张待加的牌不在预填里', () => {
    const prefill = tutorialDeckPrefill()
    for (const cardId of TUTORIAL_DECK_PICKS) {
      expect(prefill).not.toContain(cardId)
    }
  })

  // 份数上限归 save/deckStore.ts 管（core 不校验牌组内容），超了会被 sanitizeCards 悄悄丢掉，
  // 玩家点了卡却没进牌组，教学的计数就对不上了。
  it('拼出来的整副牌组没有一张超过每副的份数上限', () => {
    const deck = [...tutorialDeckPrefill(), ...TUTORIAL_DECK_PICKS]
    const copies = new Map<string, number>()
    for (const cardId of deck) copies.set(cardId, (copies.get(cardId) ?? 0) + 1)
    for (const count of copies.values()) {
      expect(count).toBeLessThanOrEqual(MAX_COPIES)
    }
  })

  // 规格 §12 的顺序写死了：两张 AI 牌，再一张技能牌。
  it('待加的三张是「AI 牌、AI 牌、技能牌」', () => {
    const kinds = TUTORIAL_DECK_PICKS.map((cardId) => getCard(cardId).kind)
    expect(kinds).toEqual(['ai', 'ai', 'skill'])
  })
})

describe('组牌教学的步骤与放行', () => {
  it('步骤按 next 串成一条链，最后一步收尾', () => {
    const visited: string[] = []
    let id: string | null = DECK_FIRST_STEP
    while (id !== null) {
      expect(visited).not.toContain(id)
      visited.push(id)
      id = deckStep(id as never).next
    }
    expect(visited).toHaveLength(DECK_STEPS.length)
  })

  it('三步各自只放行一张牌，顺序和 TUTORIAL_DECK_PICKS 一致', () => {
    const allowed = DECK_STEPS.map((step) => step.allowedCardId).filter((id) => id !== null)
    expect(allowed).toEqual([...TUTORIAL_DECK_PICKS])
  })

  it('放行判定只认当前这一步点名的那张，别的牌（含已经加过的）一律挡下', () => {
    const step = deckStep('DECK_AI_2')
    expect(deckCardAllowed(step, TUTORIAL_DECK_PICKS[1]!)).toBe(true)
    // 上一步刚加过的那张不能再加：连点两下就会把牌组提前填满。
    expect(deckCardAllowed(step, TUTORIAL_DECK_PICKS[0]!)).toBe(false)
    expect(deckCardAllowed(step, TUTORIAL_DECK_PICKS[2]!)).toBe(false)
  })

  it('开场和收尾两步一张牌都不放行', () => {
    for (const id of ['DECK_INTRO', 'DECK_READY'] as const) {
      const step = deckStep(id)
      expect(step.allowedCardId).toBeNull()
      for (const cardId of CARD_POOL) {
        expect(deckCardAllowed(step, cardId)).toBe(false)
      }
    }
  })

  // 规格 §12：加满 20 张之后「牌组完成按钮进入可用状态」，在那之前一直是灰的。
  it('只有最后一步才解锁「确认牌组」', () => {
    for (const step of DECK_STEPS) {
      expect(step.allowConfirm).toBe(step.id === 'DECK_READY')
    }
  })

  it('提示文案照规格原句写', () => {
    expect(deckStep('DECK_INTRO').instruction).toBe('比赛开始前，先组建你的 20 张牌组。')
    expect(deckStep('DECK_AI_1').instruction).toBe('先加入一张 AI 牌。')
    expect(deckStep('DECK_AI_2').instruction).toBe('不同 AI 擅长的任务可能不同。')
    expect(deckStep('DECK_SKILL').instruction).toBe('技能牌不能答题，但可以影响对局。')
    expect(deckStep('DECK_READY').instruction).toBe('牌组完成。')
  })

  it('高亮目标换算成的选择器认得出锚点和卡池里的卡', () => {
    expect(deckSelectorOf({ kind: 'anchor', name: 'deckCounter' })).toBe(
      '[data-tutorial-anchor="deckCounter"]',
    )
    expect(deckSelectorOf({ kind: 'poolCard', cardId: 'gpt-3-5' })).toBe(
      '.deck-grid [data-flip-id="pool:gpt-3-5"]',
    )
  })
})
