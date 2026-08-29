/**
 * 卡牌收藏：玩家手上有哪些卡、赢一局能抽到什么。
 *
 * 这里全是纯函数，不碰 localStorage 也不调 Math.random——
 * 存档在客户端做（packages/client/src/save.ts），随机数由调用方传进来，
 * core 才能保持"同样的输入永远得到同样的输出"。
 */

import { PLAYABLE_AI_CARD_IDS } from './aiModels'
import { OPEN_SKILL_CARD_IDS } from './skillCards'
import type { CardId } from './types'

/**
 * 完整卡池：调得到模型的那 16 张 AI + 已开放的那几张技能牌。
 *
 * 它不再等于全部卡牌定义（CARDS）：两类牌的卡面数据留在 CARDS 里供牌组页展示，
 * 但不进这份卡池——技能牌里「即将上线」的那 14 张
 *（名单见 skillCards.ts 的 OPEN_SKILL_CARD_IDS），
 * 以及 OpenRouter 调不到模型的那 2 张 AI（名单见 aiModels.ts 的 PLAYABLE_AI_CARD_IDS）。
 * 存档、牌组校验、抽卡都以卡池为准，混进来玩家就能把这些牌选进牌组、带上牌桌。
 *
 * 英雄牌是开局前单独选的，既不进卡池也不进牌组，所以 heroes.ts 的 HEROES 不在这里。
 */
export const CARD_POOL: CardId[] = [...PLAYABLE_AI_CARD_IDS, ...OPEN_SKILL_CARD_IDS]

/**
 * 新玩家开局就拥有的卡：能上场的 16 张 AI + 已开放的技能牌，也就是整个卡池。
 *
 * 全解锁是有意的：牌组页的卡池画的就是这份收藏，把它们关起来的话，
 * 一批已经出好原画的牌谁都看不见；而卡池里本来就只放已实装的那 10 张技能牌，
 * 再拿它们当解锁奖励也奖不出什么。
 *
 * 示例牌组用到的卡必须全在这里，否则新玩家会拿到自己还没解锁的卡。
 * 现在卡池里的牌全在这份收藏里，所以 `drawNewCard` 抽不到新卡（返回 null）——
 * 等卡池扩到超出这份收藏（比如某张「即将上线」的牌开放了），
 * 解锁流程会自动重新生效，不需要改代码。
 */
export const INITIAL_COLLECTION: CardId[] = [...CARD_POOL]

/**
 * 从还没拥有的卡里等概率抽一张。
 *
 * @param owned 已拥有的卡 id
 * @param random 调用方给的随机数，取值范围 [0, 1)
 * @returns 抽到的卡；全部集齐时返回 null
 */
export function drawNewCard(owned: readonly CardId[], random: number): CardId | null {
  const candidates = CARD_POOL.filter((id) => !owned.includes(id))
  if (candidates.length === 0) return null
  // 夹一下上界：调用方要是传了 1（或因浮点误差算出正好等于长度的下标），
  // 不夹就会取到 undefined。
  const index = Math.min(Math.floor(random * candidates.length), candidates.length - 1)
  return candidates[index]!
}
