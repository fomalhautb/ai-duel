/**
 * AI 卡面的展示配置。
 *
 * 费用（Token）不在这里维护：它是引擎认可的规则数值，权威来源是 core 的 AiCard.tokenCost，
 * 客户端只在渲染时用 `aiModelTokenCost` 从 core 取值，避免两份费用数据分叉（见 AGENTS.md）。
 * 这里只留纯展示用、引擎不读的字段：卡面技能简称和配色。
 */
import { getCard } from '@ai-duel/core'

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

/** 从 core 取某张 AI 牌的规则费用，用于卡面 Token 圆章。查不到或非 AI 牌返回 0。 */
export function aiModelTokenCost(cardId: string): number {
  try {
    const card = getCard(cardId)
    return card.kind === 'ai' ? (card.tokenCost ?? 0) : 0
  } catch {
    return 0
  }
}
