import { CARDS, HEROES } from '@ai-duel/core'
import type { AiCard, Card, HeroCard, SkillCard } from '@ai-duel/core'

/** /card 展示的英雄仍以 core 为准。 */
export const GALLERY_HERO_CARDS: HeroCard[] = Object.values(HEROES)

/** AI 牌已经进入正式卡表，图鉴直接读取 core，避免展示数据和对局数据分叉。 */
export const GALLERY_AI_CARDS: AiCard[] = Object.values(CARDS).filter(
  (card): card is AiCard => card.kind === 'ai',
)

/**
 * 技能牌也全部来自 core，同 AI 牌：一共 24 张，各有一张专属原画。
 * 效果实没实装不影响图鉴，它要摆的就是"卡池里现在有哪些牌、卡面长什么样"。
 */
export const GALLERY_SKILL_CARDS: SkillCard[] = Object.values(CARDS).filter(
  (card): card is SkillCard => card.kind === 'skill',
)

export const GALLERY_DECK_CARDS: Card[] = [...GALLERY_AI_CARDS, ...GALLERY_SKILL_CARDS]
export const GALLERY_ALL_CARDS: Card[] = [...GALLERY_HERO_CARDS, ...GALLERY_DECK_CARDS]
