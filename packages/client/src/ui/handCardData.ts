/**
 * core 的 Card 转成卡面（HandCardFace）要的展示数据。
 *
 * 抽成公共函数是因为对局之外还有两处要画"和对局里一模一样的那张卡"：
 * 卡牌图鉴（/card）和首页橱窗里的展示卡。各写一份的话，改了 backText 的拼法
 * 或者英雄牌的正面结构，就会出现某一页还是旧样子的情况。
 *
 * backText 走 cardBackText，和对局里那张卡完全一样。
 * art 不填，交给 HandCardFace 按 id 查找原画或占位插画（见 ui/cardArt.ts），
 * 配图也就和对局里那张卡是同一张。英雄牌也走同一条路：
 * 它自己的立绘（assets/人物卡简介/）还没接进构建，先跟着分一张占位图。
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
  }
  if (card.kind === 'ai') {
    return { ...base, kind: 'ai', model: card.model }
  }
  return { ...base, kind: 'skill' }
}
