/**
 * 卡牌上那些 core 里没有、得由客户端现拼的文案。
 *
 * core 的 Card 只存卡面要印的那几项，翻面要看的那段说明没有对应字段
 * （见 HandCardData.backText）。对局（ui/MatchStage）和图鉴页（dev/CardGallery）
 * 都要显示同一段话，所以拼法只留这一份：图鉴页的用处就是照着对局的真实文案检查排版，
 * 两边各抄一份的话，改了一边图鉴就开始骗人。
 */

import type { Card } from '@ai-duel/core'

/**
 * 卡牌翻到背面时的补充说明。
 *
 * 正面版面太小，只放得下卡名、一句描述和底部那行标识；背面补的是"这张牌打出去会怎样"
 * ——这条规则卡面上印不下，可玩家每一轮都要据此决定出不出。
 *
 * 英雄牌也走这里：它不进牌组、打不出去，但正反两面用的是同一套卡面组件，
 * 背面同样得有话说（正面印技能，背面就补人物本身）。
 */
export function cardBackText(card: Card): string {
  if (card.kind === 'ai') {
    return `模型：${card.model}。打出后留在场上，每轮跟着一起答题，答错才被罚下。`
  }
  if (card.kind === 'hero') {
    return `${card.enName}。${card.text}英雄牌不占牌组的 20 张，开局就在场上。`
  }
  if (card.target === 'foe-ai') {
    return '技能牌：打出时要点对方场上一个本轮未受技能影响的 AI。命中后会将卡牌指令加入它本轮的作答提示词，答题结算后清除。'
  }
  if (card.target === 'foe-all-ai') {
    return '技能牌：无需点选目标，打出即把干扰效果加到对方本轮全部作答 AI 的提示词上，答题结算后清除。'
  }
  if (card.target === 'own-ai-interference') {
    return '技能牌：选己方一名正受「干扰」的 AI，立即移除该效果。'
  }
  if (card.target === 'own-ai-restriction') {
    return '技能牌：选己方一名正受「限制」的 AI，立即移除该效果。'
  }
  if (card.target === 'own-ai-reflectable') {
    return '技能牌：选己方一名承受了对方非环境技能的 AI，将该效果移到对方第一名合法 AI。'
  }
  if (card.target === 'own-ai') {
    return '技能牌：选己方场上一个 Agent，本轮结算时它即使答错也留在场上。'
  }
  if (card.target === 'own-hand-ai') {
    return '技能牌：选手牌里的一张 Agent 牌弃置，按它的费用加 1 折算成 Token 收入。'
  }
  if (card.target === 'own-discard-ai') {
    return '技能牌：从弃牌区选一张 Agent 牌收回手牌。'
  }
  if (card.target === 'any-ai-downgradable') {
    return '技能牌：选双方场上任意一个可退化的 Agent，本轮内让它退化 1 级；回合结束恢复原版本。'
  }
  if (card.target === 'any-ai-upgradable') {
    return '技能牌：选双方场上任意一个可进化的 Agent，本轮内让它进化 1 级；回合结束恢复原版本。'
  }
  if (card.effect?.kind === 'round-skill-shield') {
    return '技能牌：立即清除己方现有技能效果，并使自己和所有己方 AI 在本轮免受其他技能牌影响。'
  }
  if (card.effect?.kind === 'limit-foe-plays') {
    return '技能牌：本轮内对方最多打出 2 张牌（含 Agent 牌和技能牌），超出则无法再出。'
  }
  if (card.effect?.kind === 'discount-next-ai') {
    return '技能牌：你下一张打出的 Agent 牌费用减 2，最低降到 1；用掉即失效。'
  }
  if (card.effect?.kind === 'discount-round-cards') {
    return '技能牌：本轮内双方后续打出的每张牌（含 Agent 牌和技能牌）费用减 1，最低降到 1；多座核电站叠加时减免累加。'
  }
  if (card.effect?.kind === 'end-round-immediately') {
    return '技能牌：立刻结束本轮——不答题、不判定、不计分；已打出的牌和已支付的 Token 都不返还，双方 Agent 原样留场。'
  }
  if (card.effect?.kind === 'eliminate-non-domestic') {
    return '技能牌：双方场上所有不带「国产」标记的 Agent 立即被罚下并移入弃牌区，对双方同时生效。'
  }
  if (card.effect?.kind === 'mass-downgrade') {
    return '技能牌：双方场上每个可退化的 Agent 各退化 1 级，本轮生效；回合结束恢复原版本。'
  }
  if (card.effect?.kind === 'mass-upgrade') {
    return '技能牌：双方场上每个可进化的 Agent 各进化 1 级，本轮生效；回合结束恢复原版本。'
  }
  if (card.effect?.kind === 'memory-shortage') {
    return '技能牌：双方各随机保留己方场上一半的 Agent（数量向上取整），其余被罚下并移入弃牌区。'
  }
  return '技能牌：打出后亮个相就进弃牌堆，本迭代还没有任何实际效果。'
}
