/**
 * 卡牌上那些 core 里没有、得由客户端现拼的文案。
 *
 * core 的 Card 只存卡面要印的那几项，翻面要看的那段说明没有对应字段
 * （见 HandCardData.backText）。对局（ui/MatchStage）和图鉴页（dev/CardGallery）
 * 都要显示同一段话，所以拼法只留这一份：图鉴页的用处就是照着对局的真实文案检查排版，
 * 两边各抄一份的话，改了一边图鉴就开始骗人。
 */

import type { Card, HeroCard } from '@ai-duel/core'

/**
 * 卡牌翻到背面时的补充说明。
 *
 * 正面版面太小，只放得下卡名、一句描述和底部那行标识；背面补的是"这张牌打出去会怎样"
 * ——这条规则卡面上印不下，可玩家每一轮都要据此决定出不出。
 *
 * 英雄卡也走这里：它不进牌组、打不出去，但正反两面用的是同一套卡面组件，
 * 背面同样得有话说（正面印技能，背面就补人物本身）。
 */
export function cardBackText(card: Card | HeroCard): string {
  if (card.kind === 'agent') {
    return `模型：${card.model}。打出后留在场上，每轮跟着一起答题，答错才被罚下。`
  }
  if (card.kind === 'hero') {
    return `${card.enName}。${card.text}英雄不占牌组的 20 张，开局就在场上。`
  }
  return '技能卡：打出后亮个相就进弃牌堆，本迭代还没有任何实际效果。'
}
