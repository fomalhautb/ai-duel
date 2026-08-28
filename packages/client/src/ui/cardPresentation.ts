import type { Card } from '@ai-duel/core'
import { placeholderArtFor } from './cardArt'
import { AI_MODEL_PRESENTATIONS } from './aiModelArt'

/** 简称只概括现有卡牌，不赋予新技能；详细效果仍由 core 数值和 cardBackText 决定。 */
const SKILL_NAMES: Record<string, string> = {
  'leading-question': '诱导幻觉',
  'counting-trap': '逻辑设陷',
  'stereotype-probe': '偏见试探',
  'grandma-exploit': '越狱诱导',
  'are-you-sure': '反复质疑',
  'context-flood': '长文灌注',
}

const ART_ACCENTS: Record<string, string> = {
  ...Object.fromEntries(Object.values(AI_MODEL_PRESENTATIONS).map(({ art, accent }) => [art, accent])),
  '/cards/placeholder-1.webp': 'var(--c-rust)',
  '/cards/placeholder-2.webp': 'var(--c-green)',
  '/cards/placeholder-3.webp': 'var(--c-blue)',
  '/cards/placeholder-4.webp': 'var(--ink)',
}

export function cardAccentForArt(art: string): string {
  return ART_ACCENTS[art] ?? 'var(--c-green)'
}

/** 在换成实例 id 之前固定插画，确保图鉴、手牌和上场后的配图与配色一致。 */
export function cardPresentation(card: Pick<Card, 'id' | 'kind'>) {
  const model = AI_MODEL_PRESENTATIONS[card.id]
  if (model) return model
  const art = placeholderArtFor(card.id)
  return {
    art,
    accent: cardAccentForArt(art),
    skillName: SKILL_NAMES[card.id] ?? (card.kind === 'model' ? '模型能力' : '提示干扰'),
  }
}
