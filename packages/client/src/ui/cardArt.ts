/**
 * 卡面插画的占位图。
 *
 * 提示卡与首页示例仍使用四张塔罗风竖图（1024×1536）；具名 AI 原画见 aiModelArt.ts。
 * 卡面把它们当整张底图铺满，文字浮在上面（见 HandCardFace 与 styles.css 的 .card-face）。
 * 图放在 public/ 下，所以路径是根绝对路径，不经过打包器的资源哈希。
 */

export const CARD_ART_PLACEHOLDERS = [
  '/cards/placeholder-1.webp',
  '/cards/placeholder-2.webp',
  '/cards/placeholder-3.webp',
  '/cards/placeholder-4.webp',
] as const

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
