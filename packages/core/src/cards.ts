import type { Card, CardId } from './types'

/**
 * 示例卡牌。
 * 目前只是让引擎跑通用的占位数据，卡面文案和模型名都是占位，正式卡池另行设计。
 *
 * AI 卡取了四家真实模型的味道，方便一眼看出场上是谁；
 * 技能卡本迭代只有一张占位卡：能打出、播动画、进弃牌堆，不产生任何效果。
 */
export const CARDS: Record<CardId, Card> = {
  'agent-gpt': {
    kind: 'agent',
    id: 'agent-gpt',
    name: '通用选手',
    model: 'GPT',
    text: '什么都会一点，什么都敢答一点。',
  },
  'agent-claude': {
    kind: 'agent',
    id: 'agent-claude',
    name: '谨慎书记员',
    model: 'Claude',
    text: '答之前先把题目读三遍。',
  },
  'agent-gemini': {
    kind: 'agent',
    id: 'agent-gemini',
    name: '多模态目击者',
    model: 'Gemini',
    text: '看图这件事它最有话说。',
  },
  'agent-deepseek': {
    kind: 'agent',
    id: 'agent-deepseek',
    name: '深度推理员',
    model: 'DeepSeek',
    text: '想得久，绕得开陷阱。',
  },
  'placeholder-skill': {
    kind: 'skill',
    id: 'placeholder-skill',
    name: '占位技能',
    text: '占位卡面：打出后亮个相就进弃牌堆，暂时没有任何效果。',
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
 * 调试和测试用的示例牌组：四种 AI 各两张 + 四张技能卡，共 12 张。
 *
 * 一局最多摸 5（起手）+ 4（第 2~5 轮各 1 张）= 9 张，12 张管够，不会抽空。
 *
 * 只用 `INITIAL_COLLECTION` 里的卡，否则新玩家会拿到自己还没解锁的卡；
 * 这条约束由 collection 的测试守着（这里不 import collection.ts，
 * 因为它反过来依赖本文件，直接引会成环）。
 */
export const STARTER_DECK: CardId[] = [
  'agent-gpt',
  'agent-claude',
  'agent-gemini',
  'agent-deepseek',
  'agent-gpt',
  'agent-claude',
  'agent-gemini',
  'agent-deepseek',
  'placeholder-skill',
  'placeholder-skill',
  'placeholder-skill',
  'placeholder-skill',
]
