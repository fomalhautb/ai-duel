/**
 * core 的 Card 转成卡面（HandCardFace）要的展示数据。
 *
 * 抽成公共函数是因为对局之外还有别处要画"和对局里一模一样的那张卡"：
 * 首页橱窗里那四张展示卡、回合结算里飞出来的那张。各写一份的话，改了 backText 的拼法
 * 或者英雄牌的正面结构，就会出现某一处还是旧样子的情况。
 *
 * backText 走 cardBackText，和对局里那张卡完全一样。
 * art 不填，交给 HandCardFace 按 id 查找原画或占位插画（见 ui/cardArt.ts），
 * 配图也就和对局里那张卡是同一张。英雄牌也走同一条路，跟着分一张占位图——
 * public/hero/ 下那七张人物原画（见 ui/heroArt.ts）眼下只有选英雄页和对局侧栏在用，
 * 橱窗那几张还是通用文字卡面。
 */

import type { Card } from '@ai-duel/core'
import type { HandCardData } from './HandFan'
import { cardBackText } from './cardText'
import { heroCardData } from './heroCard'

export function toHandCardData(card: Card): HandCardData {
  // 英雄牌的正面拼法只有一份（ui/heroCard.ts），对局侧栏画的就是这一张。
  if (card.kind === 'hero') return heroCardData(card)
  const base = {
    id: card.id,
    name: card.name,
    text: card.text,
    backText: cardBackText(card),
    tokenCost: card.tokenCost,
  }
  if (card.kind === 'ai') {
    return {
      ...base,
      kind: 'ai',
      model: card.model,
      skillName: card.skillName,
      skillText: card.skillText,
    }
  }
  return { ...base, kind: 'skill' }
}
