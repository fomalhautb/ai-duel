/**
 * 首页亮出来之后，在后台把剩下的图全部拉完。
 *
 * 为什么要做：每个界面都有自己的加载闸门（首页、房间页、英雄页、对局页），闸门等的是"进这一页要用的图"。
 * 玩家从首页一路走到对局，等于每到一站都要停下来等一次；而对局用到的那十几 MB 原画，
 * 在玩家看首页、建房、等对手的那几十秒里完全可以悄悄下完。
 * 下完之后各页的闸门会命中 preloadAssets 的 settled 缓存，第一帧就是就绪状态，
 * 玩家一路点过去看不到任何 loader。
 *
 * 下载优先级压到最低、并发限到 3（见 preloadAssetsInBackground），所以不会抢当前页面的带宽。
 */

import { HERO_ASSETS } from '../screens/HeroScreen'
import { ROOM_ASSETS } from '../screens/RoomScreen'
import { AI_MODEL_ART } from './aiModelArt'
import { CARD_ART_PLACEHOLDERS } from './cardArt'
import { preloadAssetsInBackground } from './preloadAssets'

/**
 * 对局界面的图。
 *
 * battle-bg.webp 在整个 tsx 里搜不到，它只出现在 styles.css 的 .battle__battlefield 背景简写里
 * （见 styles.css 的「战场背景图」一段）——改那条 CSS 的图片地址时记得同步这里，
 * 不然对局页会先空一块背景再刷出来。两张硬币是开局猜先动画里条件挂载的 <img>，
 * 等真要用时才开始下载就已经晚了。
 */
export const BATTLE_ASSETS: readonly string[] = [
  '/battle/battle-bg.webp',
  '/battle/coin-first.webp',
  '/battle/coin-second.webp',
]

/** 只跑一次。App 的 effect 在严格模式下会挂载两遍，没这个标志就会排两轮重复的队。 */
let started = false

/**
 * 开始后台预加载。同步返回，加载在后面自己跑（fire-and-forget）。
 *
 * 分组按"主流程会先用到谁"排，前一组下完才开下一组：
 * 玩家的实际路径是首页 → 房间 → 对局，房间页是离开首页后的第一站，所以排最前；
 * 对局的背景和硬币紧随其后，卡牌原画再往后（对局开始才需要，但有 18 张近 10MB，是最大的一块），
 * 占位图很小、只有没配原画的卡才用得上，英雄页目前还进不去正式流程，排最后。
 *
 * ROOM_ASSETS 和 HERO_ASSETS 都含 /hero/hero-bg.webp，重复不要紧：
 * 分组是串行的，等排到英雄页那一组时这张已经进了 preloadAssets 的 settled 缓存，会被直接跳过。
 */
export function startBackgroundPreload(): void {
  if (started) return
  started = true

  void (async () => {
    await preloadAssetsInBackground(ROOM_ASSETS)
    await preloadAssetsInBackground(BATTLE_ASSETS)
    await preloadAssetsInBackground(Object.values(AI_MODEL_ART))
    await preloadAssetsInBackground(CARD_ART_PLACEHOLDERS)
    await preloadAssetsInBackground(HERO_ASSETS)
  })()
}
