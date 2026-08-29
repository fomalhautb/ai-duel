import { CARDS, HEROES } from '@ai-duel/core'
import type { AiCard, Card, HeroCard, SkillCard } from '@ai-duel/core'
import { DECK_DEMO_CARDS } from '../screens/deckDemoCards'

/** /card 展示的英雄仍以 core 为准。 */
export const GALLERY_HERO_CARDS: HeroCard[] = Object.values(HEROES)

/** AI 牌已经进入正式卡表，图鉴直接读取 core，避免展示数据和对局数据分叉。 */
export const GALLERY_AI_CARDS: AiCard[] = Object.values(CARDS).filter(
  (card): card is AiCard => card.kind === 'ai',
)

/**
 * 技能牌图鉴仍按 24 张设计清单排序；已经进入正式规则引擎的牌优先读取 core 定义，
 * 其余继续使用 /deck 的展示数据。这样「复读机」「黑白颠倒」的卡面文案不会和真实效果分叉。
 */
export const GALLERY_SKILL_CARDS: SkillCard[] = DECK_DEMO_CARDS.filter(
  (card) => card.kind === 'skill',
).map(({ id, name, text }) => {
  const playable = CARDS[id]
  return playable?.kind === 'skill' ? playable : { kind: 'skill', id, name, text }
})

export const GALLERY_DECK_CARDS: Card[] = [...GALLERY_AI_CARDS, ...GALLERY_SKILL_CARDS]
export const GALLERY_ALL_CARDS: Card[] = [...GALLERY_HERO_CARDS, ...GALLERY_DECK_CARDS]
