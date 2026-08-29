/**
 * 英雄牌数据。
 *
 * 和 cards.ts 是两张互不相干的表：英雄不进牌组、不进卡池、抽不到也打不出，
 * 只在开局时挂到玩家身上（见 PlayerState.hero）。为什么分开见 types.ts 的 HeroCard 注释。
 *
 * 定好的 7 位人物全部进表（素材在 assets/人物卡简介/），因为选英雄界面要把 7 张都摆出来。
 * 每位英雄的技能都取材于本人的真实经历，但技能要配合规则单独设计，眼下只有格蕾丝·霍珀设计完；
 * 其余 6 位的 skillText 明文写着"待实装"，免得占位文案被当成已定案的数值。
 * 引擎里也只有霍珀有效果分支（见 engine.ts 的 canceledBy），其余 6 位打起来就是没技能。
 */

import type { HeroCard, HeroId } from './types'

/**
 * **这里的键序就是选英雄界面的展示顺序**：界面直接 Object.values(HEROES) 保序渲染，
 * 不再自己排一遍。所以调整顺序等于调整界面排布，改之前先看设计稿。
 */
export const HEROES: Record<HeroId, HeroCard> = {
  'fei-fei-li': {
    kind: 'hero',
    id: 'fei-fei-li',
    name: '李飞飞',
    enName: 'Fei-Fei Li',
    text: 'ImageNet 缔造者，计算机视觉与「以人为本 AI」的领军人。',
    skillName: '数据之眼',
    skillText: '技能设计中（待实装），暂无对局效果。',
  },
  'danqi-chen': {
    kind: 'hero',
    id: 'danqi-chen',
    name: '陈丹琦',
    enName: 'Danqi Chen',
    text: 'NLP 学者，以精炼高效的模型研究著称。',
    skillName: '精读',
    skillText: '技能设计中（待实装），暂无对局效果。',
  },
  'melanie-perkins': {
    kind: 'hero',
    id: 'melanie-perkins',
    name: '梅拉妮·珀金斯',
    enName: 'Melanie Perkins',
    text: 'Canva 联合创始人，把设计工具带给每一个人。',
    skillName: '人人可用',
    skillText: '技能设计中（待实装），暂无对局效果。',
  },
  'mira-murati': {
    kind: 'hero',
    id: 'mira-murati',
    name: '米拉·穆拉蒂',
    enName: 'Mira Murati',
    text: '前 OpenAI CTO，主导过 ChatGPT 与 DALL·E 的发布。',
    skillName: '发布日',
    skillText: '技能设计中（待实装），暂无对局效果。',
  },
  'ada-lovelace': {
    kind: 'hero',
    id: 'ada-lovelace',
    name: '阿达·洛芙莱斯',
    enName: 'Ada Lovelace',
    text: '世界上第一位程序员，为分析机写下第一段算法。',
    skillName: '第一行程序',
    skillText: '技能设计中（待实装），暂无对局效果。',
  },
  'margaret-hamilton': {
    kind: 'hero',
    id: 'margaret-hamilton',
    name: '玛格丽特·汉密尔顿',
    enName: 'Margaret Hamilton',
    text: '阿波罗登月飞控软件负责人，「软件工程」一词的推广者。',
    skillName: '登月护航',
    skillText: '技能设计中（待实装），暂无对局效果。',
  },
  'grace-hopper': {
    kind: 'hero',
    id: 'grace-hopper',
    name: '格蕾丝·霍珀',
    enName: 'Grace Hopper',
    text: '编译器先驱、程序调试文化代表人物。',
    skillName: 'Debug',
    skillText: '每局抵消对方打出的第一张技能牌的效果。',
  },
}

/**
 * 取英雄牌定义。
 * 查不到说明状态里的 heroId 写错了（不是玩家操作能触发的情况），所以直接抛错而不是返回 undefined，
 * 和 getCard 保持一致。
 */
export function getHero(heroId: HeroId): HeroCard {
  const hero = HEROES[heroId]
  if (!hero) throw new Error(`未知英雄：${heroId}`)
  return hero
}
