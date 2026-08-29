/**
 * 首页亮出来之后，在后台把剩下的图全部拉完。
 *
 * 为什么要做：每个界面都有自己的加载闸门（首页、房间页、组卡页、英雄页、对局页），闸门等的是"进这一页要用的图"。
 * 玩家从首页一路走到对局，等于每到一站都要停下来等一次；而对局用到的那十几 MB 原画，
 * 在玩家看首页、建房、等对手的那几十秒里完全可以悄悄下完。
 * 下完之后各页的闸门会命中 preloadAssets 的 settled 缓存，第一帧就是就绪状态，
 * 玩家一路点过去看不到任何 loader。
 *
 * 下载优先级压到最低、并发限到 3（见 preloadAssetsInBackground），所以不会抢当前页面的带宽。
 *
 * **这里是全站图片的总目录**：public/ 下每一张图都要落进下面某一份清单，
 * 漏掉的那张就会退回"用到时才开始下"，玩家先看到一块白再看到它显影——
 * 技能牌原画就这么白过一阵。test/assetManifest.test.ts 会扫 public/ 逐张核对，加图忘了登记会被它拦下。
 */

import { DECK_ASSETS } from '../screens/DeckScreen'
import { HERO_ASSETS } from '../screens/HeroScreen'
import { HOME_ASSETS } from '../screens/HomeScreen'
import { INFO_ASSETS } from '../screens/InfoScreen'
import { ROOM_ASSETS } from '../screens/RoomScreen'
import { AI_MODEL_ART } from './aiModelArt'
import { AI_CARD_BACK_ART, CARD_ART_PLACEHOLDERS } from './cardArt'
import { preloadAssetsInBackground } from './preloadAssets'
import { SKILL_CARD_ART } from './skillCardArt'

/**
 * 全部卡面正面原画：18 张 AI 模型 + 24 张技能 + 4 张占位图，1024×1536，加起来十几 MB。
 *
 * 三份来源都不在这儿写死，而是照各自那份映射表现取：卡面真正显示哪张图由 cardArtFor 决定
 * （ui/cardArt.ts），在这里另抄一份清单，改卡时两边就会对不上——预加载等的图和卡面用的图一旦分家，
 * 玩家看到的还是那张白卡。
 */
export const CARD_ART_ASSETS: readonly string[] = Array.from(
  new Set([
    ...Object.values(AI_MODEL_ART),
    ...Object.values(SKILL_CARD_ART),
    ...CARD_ART_PLACEHOLDERS,
  ]),
)

/**
 * 两张卡背：AI 牌那张美术背面（<img>，地址在 ui/cardArt.ts）和技能牌背面的星象边框底图
 * （只写在 CSS 里，styles.css 的 .card-back--skill；换图时两处一起改）。
 */
export const CARD_BACK_ASSETS: readonly string[] = [
  AI_CARD_BACK_ART,
  '/cards/card-back-v1.webp',
]

/**
 * 对局界面的全部图片：场地 + 会出现在场上的每一张卡。
 *
 * battle-bg.webp 在整个 tsx 里搜不到，它只出现在 CSS 的背景简写里：
 * styles.css 的 .battle__battlefield（战场）和 screens/deck.css 的 .deck-pool（组卡池，同一张图）——
 * 改图片地址时这三处要一起改，不然对局页会先空一块背景再刷出来。两张硬币是开局猜先动画里条件挂载的 <img>，
 * final-victory-bg 是终局结算那张横幅底图（也只写在 CSS 里，styles.css 的 .final-victory）。
 *
 * 卡面原画和卡背也算进来，是这次修的正题：对局里出现哪几张卡要等发牌、等对手出牌才知道，
 * 没法只等"这局用得上的那几张"。既然一局下来 42 张里哪张都可能上场，就整批一起等——
 * 反正后台预加载在玩家还在首页和房间页时就把它们下完了，这道闸门通常一帧就过。
 */
export const BATTLE_ASSETS: readonly string[] = [
  '/battle/battle-bg.webp',
  '/battle/coin-first.webp',
  '/battle/coin-second.webp',
  '/battle/final-victory-bg.webp',
  ...CARD_ART_ASSETS,
  ...CARD_BACK_ASSETS,
]

/** 只跑一次。App 的 effect 在严格模式下会挂载两遍，没这个标志就会排两轮重复的队。 */
let started = false

/**
 * 后台预加载的排队顺序，按"主流程会先用到谁"排，前一组下完才开下一组。
 *
 * 玩家的实际路径是首页 → 房间 → 组卡 → 对局：房间页是离开首页后的第一站，组卡页紧接着，
 * 它那几十张缩略图加起来才 1 MB 出头，插在大件前面几秒就下完了。
 * 对局那一批最大（场地加 42 张原画十几 MB），排在后面慢慢下，玩家在房间里等对手的时间足够用。
 * 英雄页和关于页目前都在主流程之外，排最后。
 *
 * 首页那份（HOME_ASSETS）也列进来，但它排在最后：玩家能看到这行代码开始跑，
 * 就说明首页的闸门已经放行、那批图早就在 settled 缓存里了。列它只为让"public 下每张图都在某份清单里"
 * 这条不变量成立（test/assetManifest.test.ts 守着），实际不会真发出请求。
 *
 * 清单之间重复不要紧（比如 ROOM_ASSETS 和 HERO_ASSETS 都含 hero-bg.webp、DECK_ASSETS 和
 * BATTLE_ASSETS 都含 battle-bg.webp）：分组是串行的，排到后一组时这张已经进了 settled 缓存，会被直接跳过。
 */
const PRELOAD_GROUPS: readonly (readonly string[])[] = [
  ROOM_ASSETS,
  DECK_ASSETS,
  BATTLE_ASSETS,
  HERO_ASSETS,
  INFO_ASSETS,
  HOME_ASSETS,
]

/**
 * 开始后台预加载。同步返回，加载在后面自己跑（fire-and-forget）。
 */
export function startBackgroundPreload(): void {
  if (started) return
  started = true

  void (async () => {
    for (const group of PRELOAD_GROUPS) {
      await preloadAssetsInBackground(group)
    }
  })()
}
