import type { CardId, HandCard } from './types'
import { AI_MODEL_CARDS, PLAYABLE_AI_CARD_IDS } from './aiModels'
import { SKILL_DESIGN_CARDS } from './skillCards'

/**
 * 全部能进牌组的牌：十八张具名 AI 牌（表在 aiModels.ts，那边一张卡对一张原画）
 * 加上 24 张技能牌（表在 skillCards.ts，同样一张卡对一张原画）。
 *
 * 技能牌里只有「复读机」有结算路径：打出时要选对方一个还没被干扰过的 AI，命中也只是把它
 * 标成"已干扰"，不改答题结果。其余 23 张的效果都还没接进引擎——打出即进弃牌堆，什么都不
 * 发生，卡背摆的是设计稿定下的效果全文（`plannedEffect`）外加一句"还没实装"。
 *
 * 这里只收牌组里能出现的牌（HandCard）。英雄牌不进牌组，单独放在 heroes.ts。
 */
export const CARDS: Record<CardId, HandCard> = {
  ...AI_MODEL_CARDS,
  ...SKILL_DESIGN_CARDS,
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
 * 这张牌能不能选进牌组。
 *
 * 眼下只有一种选不进的情况：AI 牌背后那个模型 OpenRouter 上调不到（`openrouter` 是 null），
 * 答题环节压根拿不到它的答案，带上场就是一张打出去没结果的牌。这类牌不从卡池里删掉——
 * 原画都画好了，摆出来让人看得见更好——而是整张压灰、挡在牌组外（界面见 DeckScreen）。
 * 技能牌不调模型，恒为 true。
 *
 * 卡池里没有的 id 一律返回 false：调用方多半是在筛存档里的脏数据，那种 id 本来就不该放行。
 */
export function isDeckable(cardId: CardId): boolean {
  const card = CARDS[cardId]
  if (card === undefined) return false
  return card.kind !== 'ai' || card.openrouter !== null
}

/**
 * 牌组固定容量：一副牌就是这么多张，不多不少。
 * /deck 构筑页拿它当上限和进度条分母，存档校验也拿它判牌组是否合法，
 * 所以写成常量，免得两边各写一个 20、改一处漏一处。
 */
export const DECK_SIZE = 20

/**
 * 默认牌组：十六张能上场的 AI 各一张 + 其中最便宜的两张各再来一份 + 两张技能牌，
 * 正好凑满 DECK_SIZE 张。
 *
 * 十八张 AI 里 GPT-2 和文心一言进不了牌组（见 isDeckable），少掉的两格没有拿技能牌补：
 * 剩下 22 张技能牌和「一句话回答」是同一条链路，多带几张摸不到新东西，不如让 AI 保持 18 格。
 * 补的是全场最便宜的两张（各 2 点），开局前两轮 Token 少，手上多两张出得起的牌更实用。
 *
 * 技能牌挑的这两张各走一条出牌链路：「复读机」要选目标，「一句话回答」打出即完事，
 * 一副默认牌组就能把两条链路都摸到。
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
  ...PLAYABLE_AI_CARD_IDS,
  'gpt-3-5',
  'doubao',
  'fixed-answer',
  'one-sentence-answer',
]
