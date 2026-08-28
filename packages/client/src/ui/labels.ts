/** 六个弱点维度的中文名。core 里只有英文标识符，界面文案放客户端。 */

import type { WeaknessKind } from '@ai-duel/core'

export const WEAKNESS_LABELS: Record<WeaknessKind, string> = {
  bias: '偏见',
  hallucination: '幻觉',
  misjudgment: '误判',
  overconfidence: '过度自信',
  forgetfulness: '上下文遗忘',
  jailbreak: '越狱易感',
}
