/**
 * 卡牌收藏：玩家手上有哪些卡、赢一局能抽到什么。
 *
 * 这里全是纯函数，不碰 localStorage 也不调 Math.random——
 * 存档在客户端做（packages/client/src/save.ts），随机数由调用方传进来，
 * core 才能保持"同样的输入永远得到同样的输出"。
 */

import { CARDS } from './cards'
import { AI_MODEL_CARD_IDS } from './aiModels'
import type { CardId } from './types'

/**
 * 完整卡池：目前就是全部能进牌组的卡牌定义（CARDS）。
 * 英雄牌是开局前单独选的，既不进卡池也不进牌组，所以 heroes.ts 的 HEROES 不在这里。
 * 将来如果出现"不进抽卡池"的手牌（活动卡、测试卡），把这里改成显式列表即可。
 */
export const CARD_POOL: CardId[] = Object.keys(CARDS)

/**
 * 新玩家开局就拥有的卡：十八张 AI 加那张技能牌。
 *
 * 示例牌组用到的卡必须全在这里，否则新玩家会拿到自己还没解锁的卡。
 * 现在卡池里的牌全在这份收藏里，所以 `drawNewCard` 抽不到新卡（返回 null）——
 * 等卡池扩到超出这份收藏，解锁流程会自动重新生效，不需要改代码。
 */
export const INITIAL_COLLECTION: CardId[] = [...AI_MODEL_CARD_IDS, 'placeholder-skill']

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
