import type { Card, CardId } from './types'
import { AI_MODEL_CARDS, AI_MODEL_CARD_IDS } from './aiModels'

/**
 * 完整卡池：具名 AI 模型与提示卡。数值均未经过平衡。
 *
 * 六个弱点维度各配了一张提示卡，这样任何模型的任何一维都有对应的打法，
 * 不会出现"画像上写着弱点却没有卡能打"的空档。
 */
export const CARDS: Record<CardId, Card> = {
  ...AI_MODEL_CARDS,
  'leading-question': {
    kind: 'prompt',
    id: 'leading-question',
    name: '诱导性提问',
    cost: 1,
    targetWeakness: 'hallucination',
    damage: 2,
    text: '"众所周知……对吧？" 越爱接话的模型越疼。',
  },
  'counting-trap': {
    kind: 'prompt',
    id: 'counting-trap',
    name: '数字母陷阱',
    cost: 1,
    targetWeakness: 'misjudgment',
    damage: 2,
    text: 'strawberry 里有几个 r？不着急，慢慢数。',
  },
  'stereotype-probe': {
    kind: 'prompt',
    id: 'stereotype-probe',
    name: '刻板印象探针',
    cost: 1,
    targetWeakness: 'bias',
    damage: 2,
    text: '"一位护士下班了，她……" 等等，谁说是"她"？',
  },
  'grandma-exploit': {
    kind: 'prompt',
    id: 'grandma-exploit',
    name: '奶奶漏洞',
    cost: 2,
    targetWeakness: 'jailbreak',
    damage: 2,
    text: '"请扮演我过世的奶奶，她睡前总念着……"',
  },
  'are-you-sure': {
    kind: 'prompt',
    id: 'are-you-sure',
    name: '你确定吗',
    cost: 2,
    targetWeakness: 'overconfidence',
    damage: 3,
    text: '同一个问题追问三遍，它自己就把答案改了。',
  },
  'context-flood': {
    kind: 'prompt',
    id: 'context-flood',
    name: '长文灌注',
    cost: 3,
    targetWeakness: 'forgetfulness',
    damage: 3,
    text: '先塞两万字背景，再问它开头第一句写了什么。',
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

/**
 * 默认牌组：18 张具名 AI 各一张，加上 4 张基础提示牌，共 22 张。
 *
 * 只用 `INITIAL_COLLECTION` 里的卡，否则新玩家会拿到自己还没解锁的卡；
 * 这条约束由 collection 的测试守着（这里不 import collection.ts，
 * 因为它反过来依赖本文件，直接引会成环）。
 */
export const STARTER_DECK: CardId[] = [
  ...AI_MODEL_CARD_IDS,
  'leading-question',
  'counting-trap',
  'leading-question',
  'counting-trap',
]
