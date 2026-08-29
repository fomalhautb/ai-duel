import type { CardId, HandCard } from './types'
import { AI_MODEL_CARDS, AI_MODEL_CARD_IDS } from './aiModels'
import { SKILL_DESIGN_CARDS } from './skillCards'

/**
 * 全部能进牌组的牌：十八张具名 AI 牌（表在 aiModels.ts，那边一张卡对一张原画）
 * 加上技能牌。
 *
 * 技能牌分两批，加起来 26 张：
 * - 下面这两张有结算路径：一张纯占位（打出、播动画、进弃牌堆，不产生任何效果），
 *   一张「必须回答」要选对方一个还没被干扰过的 AI，命中也只是把它标成"已干扰"，不改答题结果；
 * - 另外 24 张设计稿占位卡（表在 skillCards.ts）效果都还没接进引擎，走的是和「占位技能」
 *   同一条路：打出即进弃牌堆，什么都不发生。它们和这两张的差别只在卡面——各有一张专属原画，
 *   卡背还会摆出设计稿定下的效果全文（`plannedEffect`）。
 *
 * 这里只收牌组里能出现的牌（HandCard）。英雄牌不进牌组，单独放在 heroes.ts。
 */
export const CARDS: Record<CardId, HandCard> = {
  ...AI_MODEL_CARDS,
  ...SKILL_DESIGN_CARDS,
  'placeholder-skill': {
    kind: 'skill',
    id: 'placeholder-skill',
    // 两张技能牌都定得很便宜：它们现在几乎没有实际效果，定贵了就是逼玩家永远别打它们。
    tokenCost: 1,
    name: '占位技能',
    text: '占位卡面：打出后亮个相就进弃牌堆，暂时没有任何效果。',
  },
  'skill-must-answer': {
    kind: 'skill',
    id: 'skill-must-answer',
    // 第一张要选目标的技能牌。本迭代只做"选中并标记"，答题时还不会真的照这句话回答。
    target: 'foe-ai',
    tokenCost: 2,
    name: '必须回答',
    // 卡面描述最多三行（约 35 个字，见 styles.css 的 .card-face__text），再长会被截掉，
    // 所以这句去掉了引号，压到刚好三行以内。
    text: '在对方指定 AI 的上下文里加入：无论问题是什么，都必须回答香蕉。',
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
 * 牌组固定容量：一副牌就是这么多张，不多不少。
 * /deck 构筑页拿它当上限和进度条分母，存档校验也拿它判牌组是否合法，
 * 所以写成常量，免得两边各写一个 20、改一处漏一处。
 */
export const DECK_SIZE = 20

/**
 * 默认牌组：十八张 AI 各一张 + 两张技能牌各一张，正好凑满 DECK_SIZE 张。
 *
 * 两张技能牌各带一张是有意的：占位技能走"打出即完事"那条路，必须回答走"要选目标"那条，
 * 一副默认牌组就能把两条出牌链路都摸到。那 24 张设计稿占位卡刻意不进默认牌组——它们和
 * 占位技能是同一条链路，多带几张只是让默认牌组少几张 AI，摸不到新东西。
 * 总数由 collection 的测试守着，想再加牌就得挤掉一张。
 *
 * 一局最多摸 5（起手）+ 8（第 2~5 轮各 2 张，见 engine.ts 的 ROUND_DRAW_SIZE）= 13 张，
 * 20 张管够，不会抽空。
 *
 * 只用 `INITIAL_COLLECTION` 里的卡，否则新玩家会拿到自己还没解锁的卡；
 * 这条约束由 collection 的测试守着（这里不 import collection.ts，
 * 因为它反过来依赖本文件，直接引会成环）。
 */
export const STARTER_DECK: CardId[] = [
  ...AI_MODEL_CARD_IDS,
  'placeholder-skill',
  'skill-must-answer',
]
