/**
 * 卡牌上那些 core 里没有、得由客户端按数值现拼的文案。
 *
 * core 的 Card 存数值和描述，翻面所需的规则说明由这里组合（见 HandCardData.backText）。
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
 * 正面只留核心能力简称和可选战斗信息；背面保留完整描述，模型卡补完整画像，提示卡说明伤害。
 */
export function cardBackText(card: Card): string {
  if (card.kind === 'model') {
    return `${card.text}\n\n完整画像：${fullWeaknessText(card.weaknesses)}。对手的提示卡打中哪一维，伤害就加上这一维的数值。`
  }
  return `${card.text}\n\n伤害 = 基础 ${card.damage} + 目标的「${WEAKNESS_LABELS[card.targetWeakness]}」暴露度。不选模型就直击对手本体。`
}
