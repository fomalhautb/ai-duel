/**
 * 卡面展示配置：技能简称和插画主色，只影响卡面长什么样。
 *
 * 这里**不再存 Token 费用**：费用是引擎真扣的规则数值，唯一出处是 core 的卡牌定义
 * （AiCard.tokenCost）。两边各存一份的话，改了平衡数值只改一边，
 * 玩家就会看到"卡面写 4 点，出牌却提示 Token 不够"。
 */
export const AI_MODEL_FACE: Record<string, { skillName: string; accent: string }> = {
  'gpt-2': { skillName: '文本续写', accent: '#46584b' },
  'gpt-3-5': { skillName: '对话启蒙', accent: '#46584b' },
  'gpt-4o': { skillName: '多模感知', accent: '#46584b' },
  'chatgpt-5-6-sol': { skillName: '统筹推演', accent: '#46584b' },
  'claude-5-sonnet': { skillName: '文理兼修', accent: '#87502d' },
  'claude-fable-5': { skillName: '深思织文', accent: '#87502d' },
  'deepseek-r1': { skillName: '链式推理', accent: '#304e70' },
  'deepseek-v4': { skillName: '深海求索', accent: '#304e70' },
  'gemini': { skillName: '多模融会', accent: '#655580' },
  'qwen': { skillName: '万语通晓', accent: '#37646b' },
  'kimi-k2-6': { skillName: '长卷寻踪', accent: '#343e48' },
  'kimi-k3': { skillName: '群星协作', accent: '#343e48' },
  'doubao': { skillName: '灵感相伴', accent: '#505b77' },
  'glm-5': { skillName: '知行合一', accent: '#3d4a64' },
  'minimax': { skillName: '声影共鸣', accent: '#95465f' },
  'yuanbao': { skillName: '博览集智', accent: '#465d49' },
  'grok': { skillName: '破界直言', accent: '#303939' },
  'wenxin-yiyan': { skillName: '文心妙笔', accent: '#40596b' },
}
