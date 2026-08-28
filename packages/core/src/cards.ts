import type { CardId, HandCard } from './types'
import { AI_MODEL_CARDS, AI_MODEL_CARD_IDS } from './aiModels'

/**
 * 全部能进牌组的牌：十八张具名 AI 牌（表在 aiModels.ts，那边一张卡对一张原画）
 * 加上技能牌。
 *
 * 技能牌本迭代只有一张占位卡：能打出、播动画、进弃牌堆，不产生任何效果。
 *
 * 这里只收牌组里能出现的牌（HandCard）。英雄牌不进牌组，单独放在 heroes.ts。
 */
export const CARDS: Record<CardId, HandCard> = {
  ...AI_MODEL_CARDS,
  'placeholder-skill': {
    kind: 'skill',
    id: 'placeholder-skill',
    name: '占位技能',
    text: '占位卡面：打出后亮个相就进弃牌堆，暂时没有任何效果。',
  },
}

/**
 * 取卡牌定义。
 * 查不到说明牌组数据写错了（不是玩家操作能触发的情况），所以直接抛错而不是返回 undefined。
 */
export function getCard(cardId: CardId): HandCard {
  const card = CARDS[cardId]
  if (!card) throw new Error(`未知卡牌：${cardId}`)
  return card
}

/**
 * 默认牌组：十八张 AI 各一张 + 两张技能牌，凑满 20 张（/deck 页的牌组容量就是 20）。
 *
 * 一局最多摸 5（起手）+ 4（第 2~5 轮各 1 张）= 9 张，20 张管够，不会抽空。
 *
 * 只用 `INITIAL_COLLECTION` 里的卡，否则新玩家会拿到自己还没解锁的卡；
 * 这条约束由 collection 的测试守着（这里不 import collection.ts，
 * 因为它反过来依赖本文件，直接引会成环）。
 */
export const STARTER_DECK: CardId[] = [
  ...AI_MODEL_CARD_IDS,
  'placeholder-skill',
  'placeholder-skill',
]
