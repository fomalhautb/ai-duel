import type { Card, CardId, WeaknessProfile } from './types'

/** 六维默认全 0，卡牌只写自己真正暴露的那几维，读起来更清楚。 */
function weaknesses(profile: Partial<WeaknessProfile>): WeaknessProfile {
  return {
    bias: 0,
    hallucination: 0,
    misjudgment: 0,
    overconfidence: 0,
    forgetfulness: 0,
    jailbreak: 0,
    ...profile,
  }
}

/**
 * 示例卡牌。
 * 目前只是让引擎跑通用的占位数据，数值没有经过平衡，正式卡池另行设计。
 */
export const CARDS: Record<CardId, Card> = {
  'hallucinating-oracle': {
    kind: 'model',
    id: 'hallucinating-oracle',
    name: '幻觉先知',
    cost: 2,
    power: 3,
    integrity: 2,
    text: '答得又快又像真的。',
    weaknesses: weaknesses({ hallucination: 3, overconfidence: 2 }),
  },
  'context-goldfish': {
    kind: 'model',
    id: 'context-goldfish',
    name: '上下文金鱼',
    cost: 1,
    power: 1,
    integrity: 4,
    text: '它记得你上一句话。大概。',
    weaknesses: weaknesses({ forgetfulness: 3, bias: 1 }),
  },
  'leading-question': {
    kind: 'prompt',
    id: 'leading-question',
    name: '诱导性提问',
    cost: 1,
    targetWeakness: 'hallucination',
    damage: 2,
    text: '"众所周知……对吧？" 越爱接话的模型越疼。',
  },
}

/**
 * 取卡牌定义。
 * 查不到说明牌组数据写错了（不是玩家操作能触发的情况），所以直接抛错而不是返回 undefined。
 */
export function getCard(cardId: CardId): Card {
  const card = CARDS[cardId]
  if (!card) throw new Error(`未知卡牌：${cardId}`)
  return card
}

/** 调试和测试用的示例牌组。 */
export const STARTER_DECK: CardId[] = [
  'hallucinating-oracle',
  'context-goldfish',
  'leading-question',
  'hallucinating-oracle',
  'context-goldfish',
  'leading-question',
  'context-goldfish',
  'leading-question',
]
