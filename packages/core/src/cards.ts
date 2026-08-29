import type { CardId, HandCard } from './types'
import { AI_MODEL_CARDS, PLAYABLE_AI_CARD_IDS } from './aiModels'
import { SKILL_DESIGN_CARDS } from './skillCards'

/**
 * 全部卡牌定义：十八张具名 AI 牌（表在 aiModels.ts，那边一张卡对一张原画）
 * 加上 24 张技能牌（表在 skillCards.ts，同样一张卡对一张原画）。
 *
 * **这不等于卡池**：有两类牌留在这张表里，好让牌组页照常画出它们，但不进
 * collection.ts 的 CARD_POOL，选不进牌组也上不了牌桌——
 * 24 张技能牌里没开放的那 14 张（「即将上线」），
 * 以及 18 张 AI 里 OpenRouter 调不到模型的那 2 张（「暂未接入」，见 aiModels.ts）。
 * 要"能进牌组的牌"请读 CARD_POOL，别读这张表。
 *
 * 开放的那 10 张正好就是接进了引擎的 10 张（名单和各自的结算见 skillCards.ts 的文件头注释）；
 * 其余 14 张还是占位牌——打出即进弃牌堆，什么都不发生，
 * 卡背摆的是设计稿定下的效果全文（`plannedEffect`）外加一句"还没实装"。
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
 * 牌组固定容量：一副牌就是这么多张，不多不少。
 * /deck 构筑页拿它当上限和进度条分母，存档校验也拿它判牌组是否合法，
 * 所以写成常量，免得两边各写一个 20、改一处漏一处。
 */
export const DECK_SIZE = 20

/**
 * 默认牌组：十六张能上场的 AI 各一张 + 其中最便宜的两张各再来一份 + 两张技能牌，
 * 正好凑满 DECK_SIZE 张。
 *
 * 十八张 AI 里 GPT-2 和文心一言不在卡池里（OpenRouter 调不到，见 aiModels.ts），
 * 少掉的两格没有拿技能牌补：开放的那几张技能牌各自落在下面说的两条出牌链路之一，
 * 多带几张摸不到新东西，不如让 AI 保持 18 格。补的是全场最便宜的两张（各 2 点），
 * 开局前两轮 Token 少，手上多两张出得起的牌更实用。
 *
 * 技能牌挑的这两张各走一条出牌链路：「复读机」要选目标，「鸡犬升天」打出即完事，
 * 一副默认牌组就能把两条链路都摸到。
 * 总数由 collection 的测试守着，想再加牌就得挤掉一张。
 *
 * 一局最多摸 5（起手）+ 8（第 2~5 轮各 2 张，见 engine.ts 的 ROUND_DRAW_SIZE）= 13 张，
 * 20 张管够，不会抽空。
 *
 * 只用 `INITIAL_COLLECTION` 里的卡（那也就是 CARD_POOL），否则新玩家会拿到自己还没解锁、
 * 甚至还没开放的卡。这条约束由 collection 的测试守着——这里不 import collection.ts 现校验，
 * 是因为那是运行期做不了的事：牌组是常量，写错了应该在测试里当场红，而不是等玩家开局。
 */
export const STARTER_DECK: CardId[] = [
  ...PLAYABLE_AI_CARD_IDS,
  'gpt-3-5',
  'doubao',
  'fixed-answer',
  'rising-tide',
]
