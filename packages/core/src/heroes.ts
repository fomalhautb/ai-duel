/**
 * 英雄牌数据。
 *
 * 和 cards.ts 是两张互不相干的表：英雄不进牌组、不进卡池、抽不到也打不出，
 * 只在开局时挂到玩家身上（见 PlayerState.hero）。为什么分开见 types.ts 的 HeroCard 注释。
 *
 * 定好的 7 位人物全部进表（素材在 assets/人物卡简介/），因为选英雄界面要把 7 张都摆出来。
 * 每位的技能都取材于本人的真实经历，文案已经全部定案，但**实装进度不一样**：
 *
 * - 格蕾丝·霍珀 Debug、阿达·洛芙莱斯 第一算法：被动，引擎自己算（见 engine.ts）。
 * - 陈丹琦 精准检索、梅拉妮·珀金斯 化繁为简：主动，玩家发 USE_HERO_SKILL 指令。
 * - 其余 3 位标着 comingSoon：技能只有文案，选英雄界面要置灰禁选，别让人选了才发现没效果。
 *
 * 新设计的这几位还带一条 roleText（对局里的定位），选英雄详情面板拿它讲"什么时候该选他"。
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
    text: '她推动建立 ImageNet 大规模图像数据集，使 AI 首次能够系统学习「看懂现实世界」，也是现代计算机视觉与以人为本 AI 的重要推动者。',
    skillName: '再看一眼',
    skillText: '当题目含有图片、图表或视觉信息时，可保送 1 个 Agent 进入下一轮。',
    comingSoon: true,
  },
  'danqi-chen': {
    kind: 'hero',
    id: 'danqi-chen',
    name: '陈丹琦',
    enName: 'Danqi Chen',
    text: '她推动开放域问答、信息检索与语言模型结合，让 AI 不只会「生成」，还能从大量信息中找到可靠答案。',
    skillName: '精准检索',
    skillText: '每局限一次：指定 1 个己方场上 Agent，免费升级为同系列下一代。',
    roleText: '知识成长型辅助：把关键 Agent 提前强化，适合在需要知识储备或推理深度的对局中建立优势。',
  },
  'melanie-perkins': {
    kind: 'hero',
    id: 'melanie-perkins',
    name: '梅拉妮·珀金斯',
    enName: 'Melanie Perkins',
    text: 'Canva 联合创始人。她把原本专业、昂贵、难用的设计软件，变成普通人也能快速上手的创作工具。',
    skillName: '化繁为简',
    skillText: '每局限一次：指定 1 个对方场上 Agent，降级为同系列上一代。',
    roleText: '节奏压制：削弱对手的核心 Agent，阻止其形成高等级、强能力组合。',
  },
  'mira-murati': {
    kind: 'hero',
    id: 'mira-murati',
    name: '米拉·穆拉蒂',
    enName: 'Mira Murati',
    text: '生成式 AI 产品化的重要推动者，长期参与将前沿模型转化为真实可用的产品与工具。',
    skillName: '快速部署',
    skillText: '每局限一次：双方 Agent 已选、题目未揭晓时，可重新选择己方 Agent，仅需支付新旧 Agent 的 Token 差额。',
    comingSoon: true,
  },
  'ada-lovelace': {
    kind: 'hero',
    id: 'ada-lovelace',
    name: '阿达·洛芙莱斯',
    enName: 'Ada Lovelace',
    text: '她最早提出机器不仅能计算数字，也能遵循规则处理更复杂的信息；其为分析机写下的算法，被视为程序设计思想的起点。',
    skillName: '第一算法',
    skillText: '整局每一轮的 Token 上限额外 +2。',
    roleText: '经济发育型：每轮都多一笔资源，可更早选强 Agent、保留更多调整空间。',
  },
  'margaret-hamilton': {
    kind: 'hero',
    id: 'margaret-hamilton',
    name: '玛格丽特·汉密尔顿',
    enName: 'Margaret Hamilton',
    text: '她领导阿波罗登月任务的软件工程工作，设计的优先级与容错思想帮助系统在异常输入下仍能完成关键任务。',
    skillName: '容错系统',
    skillText: '当己方 Agent 作答失误时，可免费调用手牌中的另一名 Agent 重新作答 1 次。',
    comingSoon: true,
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
