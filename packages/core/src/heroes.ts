/**
 * 英雄牌：开局前每方选一张，配一个专属技能。
 *
 * 它不进 20 张牌组，也不进手牌、弃牌堆和抽卡池，所以和 cards.ts 分开放，
 * CARD_POOL 也不会把它算进去。引擎和对局界面都还没接入，现在只有这份数据壳。
 *
 * 人物名单已经定了（顺序和 assets/人物卡简介/ 里的图片编号一致，那批素材还没接进构建），
 * 但简介和技能都刻意留白：技能要配合规则单独设计，先占位免得随手写的数值被当成定案。
 */

import type { CardId, HeroCard } from './types'

const PLACEHOLDER_TEXT = '占位简介：人物卡文案后续补充。'
const PLACEHOLDER_SKILL = {
  name: '占位英雄技能',
  text: '占位：英雄技能效果后续单独设计。',
}

export const HEROES: Record<CardId, HeroCard> = {
  'hero-fei-fei-li': {
    kind: 'hero',
    id: 'hero-fei-fei-li',
    name: '李飞飞',
    text: PLACEHOLDER_TEXT,
    skill: { ...PLACEHOLDER_SKILL },
  },
  'hero-danqi-chen': {
    kind: 'hero',
    id: 'hero-danqi-chen',
    name: '陈丹琦',
    text: PLACEHOLDER_TEXT,
    skill: { ...PLACEHOLDER_SKILL },
  },
  'hero-melanie-perkins': {
    kind: 'hero',
    id: 'hero-melanie-perkins',
    name: '梅兰妮·珀金斯',
    text: PLACEHOLDER_TEXT,
    skill: { ...PLACEHOLDER_SKILL },
  },
  'hero-mira-murati': {
    kind: 'hero',
    id: 'hero-mira-murati',
    name: '米拉·穆拉蒂',
    text: PLACEHOLDER_TEXT,
    skill: { ...PLACEHOLDER_SKILL },
  },
  'hero-ada-lovelace': {
    kind: 'hero',
    id: 'hero-ada-lovelace',
    name: '阿达·洛芙莱斯',
    text: PLACEHOLDER_TEXT,
    skill: { ...PLACEHOLDER_SKILL },
  },
  'hero-margaret-hamilton': {
    kind: 'hero',
    id: 'hero-margaret-hamilton',
    name: '玛格丽特·汉密尔顿',
    text: PLACEHOLDER_TEXT,
    skill: { ...PLACEHOLDER_SKILL },
  },
  'hero-grace-hopper': {
    kind: 'hero',
    id: 'hero-grace-hopper',
    name: '格蕾丝·霍珀',
    text: PLACEHOLDER_TEXT,
    skill: { ...PLACEHOLDER_SKILL },
  },
}

/**
 * 取英雄牌定义。
 * 查不到说明数据写错了（不是玩家操作能触发的情况），所以和 getCard 一样直接抛错。
 */
export function getHero(id: CardId): HeroCard {
  const hero = HEROES[id]
  if (!hero) throw new Error(`未知英雄牌：${id}`)
  return hero
}
