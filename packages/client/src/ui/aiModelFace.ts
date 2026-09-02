/**
 * 卡面展示配置：每张 AI 插画的主色和费用圆章的位置，只影响卡面长什么样。
 *
 * 技能名和效果是玩家要据此决策的正式卡牌数据，唯一出处在 core 的 AiCard；
 * 正面铭牌和背面详情都读那一份，不能在客户端再抄一张表。
 *
 * 这里**不再存 Token 费用**：费用是引擎真扣的规则数值，唯一出处是 core 的卡牌定义
 * （AiCard.tokenCost）。两边各存一份的话，改了平衡数值只改一边，
 * 玩家就会看到"卡面写 4 点，出牌却提示 Token 不够"。
 */

/**
 * 费用圆章的圆心：`x` 按卡宽、`y` 按卡高的百分比。直径不在这儿配，全场统一（见 cardFaceOverlay.css）。
 *
 * 之所以圆心逐张配：每张原画左上角自己就画了一枚星章，而这些插画是各画各的，位置张张不同
 * （最靠边的 DeepSeek / 豆包 / GLM 几乎贴着画框，Kimi K2.6 的又偏右）。费用圆章要盖住它——
 * 两枚圆章一起露出来最难看——所以只能跟着各自的原画走。
 * 数字是照 public/cards/models/<id>.webp 量出来的星章圆心，换原画就得重量。
 *
 * 贴边的那几张（DeepSeek 两张、豆包、GLM-5、Grok、MiniMax）不是量出来的原值，而是往里
 * 收到了圆章不掉出卡面的最小位置：它们的星章本来就压着画框，圆章又比星章大得多。
 * 收完 DeepSeek 和豆包的星章最外圈还会露 2~3px（原图 1024 宽上量的，手牌尺寸下看不见），
 * 再往星章靠圆章就要探出卡外了。
 */
export interface AiModelFace {
  accent: string
  costBadge: { x: number; y: number }
}

export const AI_MODEL_FACE: Record<string, AiModelFace> = {
  'gpt-2': { accent: '#46584b', costBadge: { x: 10.9, y: 7.1 } },
  'gpt-3-5': { accent: '#46584b', costBadge: { x: 11.5, y: 7.2 } },
  'gpt-4o': { accent: '#46584b', costBadge: { x: 10.7, y: 7.1 } },
  'chatgpt-5-6-sol': { accent: '#46584b', costBadge: { x: 10.9, y: 7.2 } },
  'claude-5-sonnet': { accent: '#87502d', costBadge: { x: 11.5, y: 7.1 } },
  'claude-fable-5': { accent: '#87502d', costBadge: { x: 11.3, y: 7.1 } },
  'deepseek-r1': { accent: '#304e70', costBadge: { x: 10.7, y: 7.1 } },
  'deepseek-v4': { accent: '#304e70', costBadge: { x: 10.7, y: 7.1 } },
  'gemini': { accent: '#655580', costBadge: { x: 10.9, y: 8.1 } },
  // 通义千问和文心一言这两张原画的角上没画星章，没有要盖的东西，取其余各张的中位数摆齐即可。
  'qwen': { accent: '#37646b', costBadge: { x: 11.0, y: 7.1 } },
  'kimi-k2-6': { accent: '#343e48', costBadge: { x: 11.9, y: 7.1 } },
  'kimi-k3': { accent: '#343e48', costBadge: { x: 11.3, y: 7.1 } },
  'doubao': { accent: '#505b77', costBadge: { x: 10.7, y: 7.1 } },
  'glm-5': { accent: '#3d4a64', costBadge: { x: 10.7, y: 7.1 } },
  'minimax': { accent: '#95465f', costBadge: { x: 10.7, y: 7.1 } },
  'yuanbao': { accent: '#465d49', costBadge: { x: 11.5, y: 7.3 } },
  'grok': { accent: '#303939', costBadge: { x: 10.7, y: 7.1 } },
  'wenxin-yiyan': { accent: '#40596b', costBadge: { x: 11.0, y: 7.1 } },
}
