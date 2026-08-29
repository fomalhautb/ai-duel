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
 * 24 张新技能牌目前只有设计定义，还没有接入规则引擎。
 * /card 和 /deck 共用同一份名称、说明与 id，等规则实现后再整体迁入 core。
 */
export const GALLERY_SKILL_CARDS: SkillCard[] = DECK_DEMO_CARDS.filter(
  (card) => card.kind === 'skill',
).map(({ id, name, text }) => ({ kind: 'skill', id, name, text }))

export const GALLERY_DECK_CARDS: Card[] = [...GALLERY_AI_CARDS, ...GALLERY_SKILL_CARDS]
export const GALLERY_ALL_CARDS: Card[] = [...GALLERY_HERO_CARDS, ...GALLERY_DECK_CARDS]
