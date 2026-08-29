/**
 * 卡面插画的占位图。
 *
 * 提示卡与首页示例仍使用四张塔罗风竖图（1024×1536）；具名 AI 原画见 aiModelArt.ts。
 * 卡面把它们当整张底图铺满，文字浮在上面（见 HandCardFace 与 styles.css 的 .card-face）。
 * 图放在 public/ 下，所以路径是根绝对路径，不经过打包器的资源哈希。
 */

import { AI_MODEL_ART } from './aiModelArt'
import { SKILL_CARD_ART } from './skillCardArt'

export const CARD_ART_PLACEHOLDERS = [
  '/cards/placeholder-1.webp',
  '/cards/placeholder-2.webp',
  '/cards/placeholder-3.webp',
  '/cards/placeholder-4.webp',
] as const

/** /card 图鉴里所有 AI 牌共用的背面图，英雄牌和技能牌仍显示带说明文字的详情背面。 */
export const AI_CARD_BACK_ART = '/cards/card-back-v4-relaxed-ornament.png'

/**
 * 按 id 稳定地挑一张占位图：同一个 id 永远拿到同一张。
 *
 * 不能用随机数：卡面在 hover 放大、翻面、上场飞行的过程中会被反复重渲染，
 * 每渲染一次换一张图的话，玩家会看到卡牌插画凭空跳变。
 *
 * 哈希用 FNV-1a，只求"不同 id 分得开"，不需要抗碰撞——撞了也只是两张卡共用一张占位图。
 */
export function placeholderArtFor(seed: string): string {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // >>> 0 把 32 位有符号结果转成无符号，省掉负数取模那一层判断。
  const index = (hash >>> 0) % CARD_ART_PLACEHOLDERS.length
  return CARD_ART_PLACEHOLDERS[index] ?? CARD_ART_PLACEHOLDERS[0]
}

/**
 * 一张卡该画哪张插画：有专属原画就用原画，没有的才退回占位图。
 *
 * 卡面、图鉴、首页预加载都走这一个函数。要是各处自己判断，
 * 预加载等的图和卡面真正显示的图就会对不上，玩家会先看到空白再看到图闪出来。
 */
export function cardArtFor(cardId: string): string {
  return AI_MODEL_ART[cardId] ?? SKILL_CARD_ART[cardId] ?? placeholderArtFor(cardId)
}
