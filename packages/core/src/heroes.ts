/**
 * 英雄牌数据。
 *
 * 和 cards.ts 是两张互不相干的表：英雄不进牌组、不进卡池、抽不到也打不出，
 * 只在开局时挂到玩家身上（见 PlayerState.hero）。为什么分开见 types.ts 的 HeroCard 注释。
 *
 * 每位英雄的技能都取材于本人的真实经历，已经接入规则的才进入这张表。
 * 人物名单已经定了 7 位（李飞飞、陈丹琦、梅兰妮·珀金斯、米拉·穆拉蒂、阿达·洛芙莱斯、
 * 玛格丽特·汉密尔顿、格蕾丝·霍珀，素材在 assets/人物卡简介/），
 * 但技能要配合规则单独设计，设计好一位才进这张表，免得占位数值被当成定案。
 */

import type { HeroCard, HeroId } from './types'

export const HEROES: Record<HeroId, HeroCard> = {
  'fei-fei-li': {
    kind: 'hero',
    id: 'fei-fei-li',
    name: '李飞飞',
    enName: 'Fei-Fei Li',
    text: '计算机视觉与以人为本人工智能领域的代表人物。',
    skillName: '再看一眼',
    skillText: '当题目包含图片时，可以保送 1 个 Agent 进入下一轮。',
  },
  'danqi-chen': {
    kind: 'hero',
    id: 'danqi-chen',
    name: '陈丹琦',
    enName: 'Danqi Chen',
    text: '自然语言处理、知识检索与问答系统研究者。',
    skillName: '精准检索',
    skillText: '每局一次，可以选择 1 个己方 Agent 免费升级一轮。',
  },
  'melanie-perkins': {
    kind: 'hero',
    id: 'melanie-perkins',
    name: '梅拉妮·珀金斯',
    enName: 'Melanie Perkins',
    text: 'Canva 联合创始人，以简化设计工具推动视觉创作普及。',
    skillName: '化繁为简',
    skillText: '每局一次，可以选择 1 个对方 Agent 降级一轮。',
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
  'mira-murati': {
    kind: 'hero',
    id: 'mira-murati',
    name: '米拉·穆拉蒂',
    enName: 'Mira Murati',
    text: 'OpenAI 前 CTO，主导多代旗舰模型的产品化与快速迭代。',
    skillName: '快速部署',
    // 原设计文案是「重新选择自己的 Agent，只支付差额」。当前规则里 Agent 上场不花 Token
    // （见 engine.ts 的 playCard），差额无从计算，因此落地为「把已上场的 Agent 撤回手牌」，
    // 撤回后玩家仍可在题目揭晓前改派别的 Agent，等价于零成本重新选择。
    skillText: '每局一次，题目揭晓前把 1 个己方已上场的 Agent 撤回手牌，重新部署。',
  },
  'ada-lovelace': {
    kind: 'hero',
    id: 'ada-lovelace',
    name: '阿达·洛芙莱斯',
    enName: 'Ada Lovelace',
    text: '公认的第一位程序员，写下最早的算法。',
    skillName: '第一算法',
    skillText: '每局开始时，额外获得 2 个 Token。',
  },
  'margaret-hamilton': {
    kind: 'hero',
    id: 'margaret-hamilton',
    name: '玛格丽特·汉密尔顿',
    enName: 'Margaret Hamilton',
    text: '阿波罗飞行软件负责人，容错设计的奠基者。',
    skillName: '容错系统',
    skillText: '每局一次，己方 Agent 答错时，可免费从手牌调用另一个 Agent 补位重答本题。',
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
