/**
 * 卡牌上那些 core 里没有、得由客户端按数值现拼的文案。
 *
 * core 的 Card 只存数值，翻面要看的那段说明没有对应字段（见 HandCardData.backText）。
 * 对局（ui/MatchStage）和图鉴页（dev/CardGallery）都要显示同一段话，
 * 所以拼法只留这一份：图鉴页的用处就是照着对局的真实文案检查排版，
 * 两边各抄一份的话，改了一边图鉴就开始骗人。
 */

import { WEAKNESS_KINDS } from '@ai-duel/core'
import type { Card, WeaknessProfile } from '@ai-duel/core'
import { WEAKNESS_LABELS } from './labels'

/** 完整六维画像，0 也列出来——"打哪一维没用"同样是要读的信息。 */
function fullWeaknessText(profile: WeaknessProfile): string {
  return WEAKNESS_KINDS.map((kind) => `${WEAKNESS_LABELS[kind]}${profile[kind]}`).join(' ')
}

/**
 * 卡牌翻到背面时的补充说明。
 *
 * 正面版面太小，只放得下暴露出来的那几维和一个目标维度；背面补的就是正面装不下的部分：
 * 模型卡给完整画像，提示卡说清伤害怎么算。
 */
export function cardBackText(card: Card): string {
  if (card.kind === 'model') {
    return `完整画像：${fullWeaknessText(card.weaknesses)}。对手的提示卡打中哪一维，伤害就加上这一维的数值。`
  }
  return `伤害 = 基础 ${card.damage} + 目标的「${WEAKNESS_LABELS[card.targetWeakness]}」暴露度。不选模型就直击对手本体。`
}
