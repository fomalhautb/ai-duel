/**
 * 英雄卡的卡面数据。
 *
 * 英雄不进牌组也不进手牌，但画出来仍然是一张卡，所以借手牌那套 HandCardData 和
 * HandCardFace 渲染，只是 kind 换成 'hero'（底部标识印「英雄」，配色见 .card-face--hero）。
 *
 * 对局侧栏（ui/MatchStage）和图鉴页（dev/CardGallery）都要画同一张英雄卡，拼法只留这一份：
 * 两边各拼一次的话，改了正面印技能还是印简介，图鉴就开始骗人。
 */

import type { HeroCard } from '@ai-duel/core'
import type { HandCardData } from './HandFan'
import { cardBackText } from './cardText'

/**
 * 正面的描述位放技能而不是人物简介：对局里最需要一眼看到的是"这个英雄能干什么"，
 * 人物简介退到背面（见 cardBackText 的英雄分支）。
 */
export function heroCardData(hero: HeroCard): HandCardData {
  return {
    id: hero.id,
    kind: 'hero',
    name: hero.name,
    text: `${hero.skillName}：${hero.skillText}`,
    backText: cardBackText(hero),
  }
}
