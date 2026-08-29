import type { CardId, HandCard } from './types'
import { AI_MODEL_CARDS, AI_MODEL_CARD_IDS } from './aiModels'
import { SKILL_DESIGN_CARDS } from './skillCards'

/**
 * 全部卡牌定义：十八张具名 AI 牌（表在 aiModels.ts，那边一张卡对一张原画）
 * 加上 24 张技能牌（表在 skillCards.ts，同样一张卡对一张原画）。
 *
 * **这不等于卡池**：24 张技能牌里只开放了 10 张，其余 14 张是「即将上线」——卡面数据留在
 * 这张表里，好让牌组页和图鉴照常画出它们，但它们不在 collection.ts 的 CARD_POOL 里，
 * 选不进牌组也上不了牌桌。要"能进牌组的牌"请读 CARD_POOL，别读这张表。
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
 * 默认牌组：十八张 AI 各一张 + 两张技能牌各一张，正好凑满 DECK_SIZE 张。
 *
 * 技能牌挑的这两张各走一条出牌链路：「复读机」要选目标，「鸡犬升天」打出即完事，
 * 一副默认牌组就能把两条链路都摸到。开放的另外几张技能牌刻意不进默认牌组——它们各自
 * 落在这两条链路之一，多带几张只是让默认牌组少几张 AI，摸不到新东西。
 * 总数由 collection 的测试守着，想再加牌就得挤掉一张。
 *
 * 一局最多摸 5（起手）+ 8（第 2~5 轮各 2 张，见 engine.ts 的 ROUND_DRAW_SIZE）= 13 张，
 * 20 张管够，不会抽空。
 *
 * 只用 `INITIAL_COLLECTION` 里的卡（那也就是 CARD_POOL），否则新玩家会拿到自己还没解锁、
 * 甚至还没开放的卡。这条约束由 collection 的测试守着——这里不 import collection.ts 现校验，
 * 是因为那是运行期做不了的事：牌组是常量，写错了应该在测试里当场红，而不是等玩家开局。
 */
export const STARTER_DECK: CardId[] = [...AI_MODEL_CARD_IDS, 'fixed-answer', 'rising-tide']
