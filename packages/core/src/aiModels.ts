import type { CardId, ModelCard, WeaknessProfile } from './types'

/** 这些数值是游戏测试设定，不代表模型实测表现；技能简称不附加引擎尚未实现的效果。 */
function model(id: CardId, name: string, cost: number, power: number, integrity: number, profile: Partial<WeaknessProfile>): ModelCard {
  return {
    id, name, kind: 'model', cost, power, integrity,
    text: '部署到己方场上。完整度耗尽时崩坏，无额外触发技能。',
    weaknesses: { bias: 0, hallucination: 0, misjudgment: 0, overconfidence: 0, forgetfulness: 0, jailbreak: 0, ...profile },
  }
}

export const AI_MODEL_CARDS: Record<CardId, ModelCard> = {
  'gpt-2': model('gpt-2', 'GPT-2', 1, 1, 3, {"forgetfulness":3,"hallucination":2}),
  'gpt-3-5': model('gpt-3-5', 'GPT-3.5', 2, 2, 4, {"hallucination":2,"misjudgment":2}),
  'gpt-4o': model('gpt-4o', 'GPT-4o', 4, 4, 5, {"overconfidence":2,"hallucination":1}),
  'chatgpt-5-6-sol': model('chatgpt-5-6-sol', 'ChatGPT 5.6 sol', 7, 7, 7, {"overconfidence":2,"jailbreak":1}),
  'claude-5-sonnet': model('claude-5-sonnet', 'Claude 5 Sonnet', 4, 3, 6, {"forgetfulness":2,"misjudgment":1}),
  'claude-fable-5': model('claude-fable-5', 'Claude Fable 5', 6, 5, 8, {"overconfidence":2,"forgetfulness":1}),
  'deepseek-r1': model('deepseek-r1', 'DeepSeek R1', 3, 4, 3, {"hallucination":2,"bias":1}),
  'deepseek-v4': model('deepseek-v4', 'DeepSeek V4', 5, 5, 6, {"jailbreak":2,"overconfidence":1}),
  'gemini': model('gemini', 'Gemini', 4, 4, 5, { hallucination: 1, forgetfulness: 2 }),
  'qwen': model('qwen', '通义千问', 3, 3, 5, {"bias":2,"misjudgment":1}),
  'kimi-k2-6': model('kimi-k2-6', 'Kimi K2.6', 3, 2, 6, {"misjudgment":2,"hallucination":1}),
  'kimi-k3': model('kimi-k3', 'Kimi K3', 5, 4, 7, {"jailbreak":2,"overconfidence":1}),
  'doubao': model('doubao', '豆包', 2, 2, 4, {"bias":2,"hallucination":1}),
  'glm-5': model('glm-5', 'GLM-5', 4, 4, 5, {"misjudgment":2,"forgetfulness":1}),
  'minimax': model('minimax', 'MiniMax', 3, 4, 4, {"forgetfulness":2,"bias":1}),
  'yuanbao': model('yuanbao', '腾讯元宝', 3, 3, 5, {"hallucination":2,"overconfidence":1}),
  'grok': model('grok', 'Grok', 4, 5, 4, {"jailbreak":3,"bias":1}),
  'wenxin-yiyan': model('wenxin-yiyan', '文心一言', 3, 2, 6, {"bias":2,"overconfidence":1}),
}

export const AI_MODEL_CARD_IDS: CardId[] = Object.keys(AI_MODEL_CARDS)
