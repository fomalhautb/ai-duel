/**
 * 卡牌上那些 core 里没有、得由客户端现拼的文案。
 *
 * AI 和英雄的技能说明直接存于 core；其他牌翻面要看的补充说明没有统一字段
 * （见 HandCardData.backText）。对局（ui/MatchStage）和图鉴页（dev/CardGallery）
 * 都要显示同一段话，所以拼法只留这一份：图鉴页的用处就是照着对局的真实文案检查排版，
 * 两边各抄一份的话，改了一边图鉴就开始骗人。
 */

import type { Card } from '@ai-duel/core'

/**
 * 卡牌翻到背面时的补充说明。
 *
 * 技能牌正反两面说的是同一段话（core 的 `SkillCard.text`）：卡面正面印的是原画里
 * 烤死的那句设计稿文案，DOM 里根本没有第二处可写，而牌组页放大查看的背面
 * （DeckScreen 的 SkillCardBack）本来就直接读 `card.text`。这里再手写一份"卡背专用"文案，
 * 结果就是同一张牌翻面和放大看到两句不一样的话，所以只留 `text` 这一份，
 * 边界条件（选谁当目标、只活本轮、会不会误伤自己）都写进它里面。
 *
 * 英雄牌也走这里：它不进牌组、打不出去，但正反两面用的是同一套卡面组件，
 * 背面同样得有话说（正面印技能，背面就补人物本身）。
 */
export function cardBackText(card: Card): string {
  if (card.kind === 'ai') {
    return card.skillText
  }
  if (card.kind === 'hero') {
    return `${card.enName}。${card.text}英雄牌不占牌组的 20 张，开局就在场上。`
  }
  // 效果还没接进引擎的那些（core 的 SKILL_DESIGN_CARDS 里仍带 plannedEffect 的）。设计效果
  // 后面必须紧跟一句"还没实装"——它现在打出去只是亮个相，光印效果会让人以为真会发生什么。
  if (card.plannedEffect !== undefined) {
    return `${card.text}这个效果还没接进规则引擎，本迭代打出后只是亮个相就进弃牌堆。`
  }
  return card.text
}
