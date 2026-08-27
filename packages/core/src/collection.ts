/**
 * 卡牌收藏：玩家手上有哪些卡、赢一局能抽到什么。
 *
 * 这里全是纯函数，不碰 localStorage 也不调 Math.random——
 * 存档在客户端做（packages/client/src/save.ts），随机数由调用方传进来，
 * core 才能保持"同样的输入永远得到同样的输出"。
 */

import { CARDS } from './cards'
import type { CardId } from './types'

/**
 * 完整卡池：目前就是全部卡牌定义。
 * 将来如果出现"不进抽卡池"的卡（活动卡、测试卡），改成显式列表即可。
 */
export const CARD_POOL: CardId[] = Object.keys(CARDS)

/**
 * 新玩家开局就拥有的卡：两个模型 + 两张提示卡，刚好够凑一副能打的牌组。
 * 其余的卡是抽卡奖池，赢一局解锁一张。
 */
export const INITIAL_COLLECTION: CardId[] = [
  'hallucinating-oracle',
  'context-goldfish',
  'leading-question',
  'counting-trap',
]

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
