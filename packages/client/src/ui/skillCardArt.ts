/** 24 张技能牌的完整正面原画。原画已包含费用、类别和名称，不再叠加通用文字层。 */
export const SKILL_CARD_ART: Readonly<Record<string, string>> = {
  'context-flood': '/cards/skills/context-flood.webp',
  'topic-drift': '/cards/skills/topic-drift.webp',
  'repetition-bombardment': '/cards/skills/repetition-bombardment.webp',
  'black-white-reversal': '/cards/skills/black-white-reversal.webp',
  'fixed-answer': '/cards/skills/fixed-answer.webp',
  'one-sentence-answer': '/cards/skills/one-sentence-answer.webp',
  'character-lock': '/cards/skills/character-lock.webp',
  'clean-sweep': '/cards/skills/clean-sweep.webp',
  'jade-purification-vase': '/cards/skills/jade-purification-vase.webp',
  'boomerang': '/cards/skills/boomerang.webp',
  'golden-bell-shield': '/cards/skills/golden-bell-shield.webp',
  'safe-pass': '/cards/skills/safe-pass.webp',
  'anti-addiction': '/cards/skills/anti-addiction.webp',
  'compute-compression': '/cards/skills/compute-compression.webp',
  'model-distillation': '/cards/skills/model-distillation.webp',
  'open-source-reproduction': '/cards/skills/open-source-reproduction.webp',
  'nuclear-power-station': '/cards/skills/nuclear-power-station.webp',
  'far-ahead': '/cards/skills/far-ahead.webp',
  'domestic-substitution': '/cards/skills/domestic-substitution.webp',
  'version-rollback': '/cards/skills/version-rollback.webp',
  'kids-mode': '/cards/skills/kids-mode.webp',
  'version-upgrade': '/cards/skills/version-upgrade.webp',
  'rising-tide': '/cards/skills/rising-tide.webp',
  'memory-shortage': '/cards/skills/memory-shortage.webp',
}

export function isIllustratedSkillCard(cardId: string): boolean {
  return cardId in SKILL_CARD_ART
}
