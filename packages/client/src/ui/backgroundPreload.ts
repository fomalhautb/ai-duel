/**
 * 首页亮出来之后，在后台把剩下的图全部拉完。
 *
 * 为什么要做：每个界面都有自己的加载闸门（首页、房间页、组卡页、英雄页、对局页），闸门等的是"进这一页要用的图"。
 * 玩家从首页一路走到对局，等于每到一站都要停下来等一次；而对局用到的那几 MB 卡面，
 * 在玩家看首页、建房、等对手的那几十秒里完全可以悄悄下完。
 * 下完之后各页的闸门会命中 preloadAssets 的 settled 缓存，第一帧就是就绪状态，
 * 玩家一路点过去看不到任何 loader。
 *
 * 下载优先级压到最低、并发限到 3（见 preloadAssetsInBackground），所以不会抢当前页面的带宽。
 *
 * **这里是全站图片的总目录**：public/ 下每一张图都要落进下面某一份清单，
 * 漏掉的那张就会退回"用到时才开始下"，玩家先看到一块白再看到它显影——
 * 技能牌原画就这么白过一阵。test/assetManifest.test.ts 会扫 public/ 逐张核对，加图忘了登记会被它拦下。
 *
 * 但"登记"不等于"会下载"：卡面原画那两份（CARD_ART_FULL_ASSETS / CARD_BACK_FULL_ASSETS）
 * 只出现在总目录里，**不排进下面的 PRELOAD_GROUPS**。界面上已经没有一处引用它们，
 * 下了也没人用（各自的说明见下）。加新清单时想清楚自己属于哪一类，
 * 别顺手把只登记的那两份也塞进队列。
 */

import { DECK_ASSETS } from '../screens/DeckScreen'
import { HERO_ASSETS } from '../screens/HeroScreen'
import { HOME_ASSETS } from '../screens/HomeScreen'
import { INFO_ASSETS } from '../screens/InfoScreen'
import { ROOM_ASSETS } from '../screens/RoomScreen'
import { AI_MODEL_ART } from './aiModelArt'
import { AI_CARD_BACK_ART, CARD_ART_PLACEHOLDERS } from './cardArt'
import { midFor } from './cardArtThumb'
import { preloadAssetsInBackground } from './preloadAssets'
import { SKILL_CARD_ART } from './skillCardArt'

/** 全部卡面正面的原画地址：18 张 AI 模型 + 24 张技能 + 4 张占位图，1024×1536。 */
const CARD_ART_SOURCES: readonly string[] = Array.from(
  new Set([
    ...Object.values(AI_MODEL_ART),
    ...Object.values(SKILL_CARD_ART),
    ...CARD_ART_PLACEHOLDERS,
  ]),
)

/**
 * 卡面正面，**600 宽那一档**（mid）。加起来约 4.5 MB，原画那份是 15 MB。
 *
 * 两件事都要照做，缺一份清单就白列：
 * 1. 来源不在这儿写死，而是照各自那份映射表现取——卡面显示哪张图由 cardArtFor 决定
 *    （ui/cardArt.ts），在这里另抄一份清单，改卡时两边就会对不上，玩家看到的还是白卡。
 * 2. **档位也必须和显示处用同一个函数换算**。卡面组件（HandCardFace）铺的是 midFor(...)，
 *    这里要是还列原画地址，预载下来的和卡面请求的就是两个 URL，等于一张都没预载，
 *    而且还白下了三倍大的图。
 */
export const CARD_ART_ASSETS: readonly string[] = CARD_ART_SOURCES.map(midFor)

/**
 * 卡面正面的**原画**。列在这儿只为让"public 下每张图都登记过"这条不变量成立
 * （test/assetManifest.test.ts 守着），它不进任何加载闸门，也不排进后台预载队列。
 *
 * 为什么一张都不下：界面上已经没有任何一处引用原画了。最大的那处（桌面手牌 hover 放大到顶）
 * 也只要 524 个设备像素，600 宽那一档全盖得住，推导见 ui/cardArtThumb.ts。
 * 以前是整批 46 张原画进对局闸门、逐张 decode()，手机上光解码就要把内存占满一轮，
 * 之后每次绘制还可能撞上"被丢弃后重解"，正好卡在动画帧里。
 *
 * 既然零引用，这批文件留在 public/ 下就只是跟着部署的 15 MB。
 * 真确定不再需要（比如将来也不打算加整屏图鉴大图），应该整批移出 public/ 只留作烤图的源，
 * 那时 scripts/gen-card-thumbs.sh 的取图目录要跟着改。
 */
export const CARD_ART_FULL_ASSETS: readonly string[] = CARD_ART_SOURCES

/**
 * 两张卡背，同样是 600 宽那一档：AI 牌那张美术背面（<img> 在 ui/AiCardBack.tsx，
 * 地址常量在 ui/cardArt.ts）和技能牌背面的星象边框底图（只写在 CSS 里，
 * styles.css 的 .card-back--skill）。
 *
 * 卡背和正面一样只画到 150×225，所以也不该铺原画。
 * CSS 那张的档位是写死在样式里的（url('/cards/mid/card-back-v1.webp')），
 * 换档时两处要一起改——这里过 midFor、那边写死，对不上就等于没预载。
 */
export const CARD_BACK_ASSETS: readonly string[] = [
  midFor(AI_CARD_BACK_ART),
  midFor('/cards/card-back-v1.webp'),
]

/**
 * 三张卡背的原画。和 CARD_ART_FULL_ASSETS 同理：只登记，不下载。
 *
 * 第三张是组卡页那张技能牌背的边框底图。它不在上面 CARD_BACK_ASSETS 里，
 * 因为对局用不到它——它的 mid 版列在 DeckScreen 的 DECK_ASSETS 里。
 */
export const CARD_BACK_FULL_ASSETS: readonly string[] = [
  AI_CARD_BACK_ART,
  '/cards/card-back-v1.webp',
  '/cards/skills/skill-card-back.webp',
]

/**
 * 对局界面的全部图片：场地 + 会出现在场上的每一张卡。
 *
 * battle-bg.webp 在整个 tsx 里搜不到，它只出现在 CSS 的背景简写里：
 * styles.css 的 .battle__battlefield（战场）和 screens/deck.css 的 .deck-pool（组卡池，同一张图）——
 * 改图片地址时这三处要一起改，不然对局页会先空一块背景再刷出来。两张硬币是开局猜先动画里条件挂载的 <img>，
 * final-victory-bg 是终局结算那张横幅底图（也只写在 CSS 里，styles.css 的 .final-victory）。
 *
 * 卡面和卡背也算进来：对局里出现哪几张卡要等发牌、等对手出牌才知道，
 * 没法只等"这局用得上的那几张"。既然一局下来 46 张里哪张都可能上场，就整批一起等——
 * 反正后台预加载在玩家还在首页和房间页时就把它们下完了，这道闸门通常一帧就过。
 * 等的是 600 宽那一档（约 4.5 MB），不是原画（15 MB）；为什么够、原画去哪了，
 * 见上面 CARD_ART_ASSETS 和 CARD_ART_FULL_ASSETS 的说明。
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
 * 它那几十张 300 宽的小图加起来才 1 MB 出头，插在大件前面几秒就下完了。
 * 对局那一批最大（场地加 49 张 600 宽的卡面，约 5 MB），排在后面慢慢下，
 * 玩家在房间里等对手的时间足够用。英雄页和关于页目前都在主流程之外，排最后。
 *
 * 首页那份（HOME_ASSETS）也列进来，但它排在最后：玩家能看到这行代码开始跑，
 * 就说明首页的闸门已经放行、那批图早就在 settled 缓存里了。列它只为让"public 下每张图都在某份清单里"
 * 这条不变量成立（test/assetManifest.test.ts 守着），实际不会真发出请求。
 *
 * **卡面原画那两份清单刻意不在这里**（CARD_ART_FULL_ASSETS / CARD_BACK_FULL_ASSETS）。
 * 它们和 HOME_ASSETS 那种"列了但不会真发请求"不一样：这两份要是排进来，是会实打实
 * 多下 15 MB、而界面上一处也用不到的。理由见各自的说明。
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
