/**
 * 卡面展示配置：每张 AI 插画的主色，只影响卡面长什么样。
 *
 * 技能名和效果是玩家要据此决策的正式卡牌数据，唯一出处在 core 的 AiCard；
 * 正面铭牌和背面详情都读那一份，不能在客户端再抄一张表。
 *
 * 这里**不再存 Token 费用**：费用是引擎真扣的规则数值，唯一出处是 core 的卡牌定义
 * （AiCard.tokenCost）。两边各存一份的话，改了平衡数值只改一边，
 * 玩家就会看到"卡面写 4 点，出牌却提示 Token 不够"。
 */
export const AI_MODEL_FACE: Record<string, { accent: string }> = {
  'gpt-2': { accent: '#46584b' },
  'gpt-3-5': { accent: '#46584b' },
  'gpt-4o': { accent: '#46584b' },
  'chatgpt-5-6-sol': { accent: '#46584b' },
  'claude-5-sonnet': { accent: '#87502d' },
  'claude-fable-5': { accent: '#87502d' },
  'deepseek-r1': { accent: '#304e70' },
  'deepseek-v4': { accent: '#304e70' },
  'gemini': { accent: '#655580' },
  'qwen': { accent: '#37646b' },
  'kimi-k2-6': { accent: '#343e48' },
  'kimi-k3': { accent: '#343e48' },
  'doubao': { accent: '#505b77' },
  'glm-5': { accent: '#3d4a64' },
  'minimax': { accent: '#95465f' },
  'yuanbao': { accent: '#465d49' },
  'grok': { accent: '#303939' },
  'wenxin-yiyan': { accent: '#40596b' },
}
