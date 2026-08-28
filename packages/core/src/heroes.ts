/**
 * 英雄数据。
 *
 * 和 cards.ts 是两张互不相干的表：英雄不进牌组、不进卡池、抽不到也打不出，
 * 只在开局时挂到玩家身上（见 PlayerState.hero）。为什么分开见 types.ts 的 HeroCard 注释。
 *
 * 每位英雄的技能都取材于本人的真实经历，眼下只有一位。
 */

import type { HeroCard, HeroId } from './types'

export const HEROES: Record<HeroId, HeroCard> = {
  'grace-hopper': {
    kind: 'hero',
    id: 'grace-hopper',
    name: '格蕾丝·霍珀',
    enName: 'Grace Hopper',
    text: '编译器先驱、程序调试文化代表人物。',
    skillName: 'Debug',
    skillText: '每局抵消对方打出的第一张技能卡的效果。',
  },
}

/**
 * 取英雄定义。
 * 查不到说明状态里的 heroId 写错了（不是玩家操作能触发的情况），所以直接抛错而不是返回 undefined，
 * 和 getCard 保持一致。
 */
export function getHero(heroId: HeroId): HeroCard {
  const hero = HEROES[heroId]
  if (!hero) throw new Error(`未知英雄：${heroId}`)
  return hero
}
