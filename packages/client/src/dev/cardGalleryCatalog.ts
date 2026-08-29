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
 * 24 张新技能牌目前只有设计定义，还没有接入规则引擎，所以进不了牌组页那个真卡池，
 * 只在图鉴里摆着看排版（数据在 screens/deckDemoCards.ts），等规则实现后再整体迁入 core。
 */
export const GALLERY_SKILL_CARDS: SkillCard[] = DECK_DEMO_CARDS.filter(
  (card) => card.kind === 'skill',
).map(({ id, name, text }) => ({
  kind: 'skill',
  id,
  name,
  text,
  // 费用还没定：这 24 张没进规则引擎，图鉴也不画费用章（那一层只给具名 AI 用，
  // 见 HandCardFace），补个占位值纯粹是为了凑齐 SkillCard 的形状。
  // 真正定价要和"整体迁入 core"一起做，别在这儿编数字。
  tokenCost: 1,
}))

export const GALLERY_DECK_CARDS: Card[] = [...GALLERY_AI_CARDS, ...GALLERY_SKILL_CARDS]
export const GALLERY_ALL_CARDS: Card[] = [...GALLERY_HERO_CARDS, ...GALLERY_DECK_CARDS]
