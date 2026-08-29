/**
 * 扇形手牌的布局数学，玩家手牌（HandFan）和对手手牌（OpponentFan）共用。
 *
 * 抽出来不是笼统的"复用"：两边用的是同一套坐标系和同一条公式，只有"卡牌沉出锚点多深"
 * 和"弧线多平"两个数不一样。抄成两份的话，改一次扇形张角就要记得改两处，
 * 而漏改的后果不只是排版丑一点——HandFan 的 hover 防抖动是拿这些常量算几何下限的，
 * 对不上号卡牌就会在"放大→指针掉到卡外→缩回"之间抖个没完（见 HandFan 的 MIN_HOVER_SCALE）。
 *
 * 坐标系约定（两边完全一致）：
 * 原点在锚点容器的底边中点，y 向下为正，每张牌以自己的底边中点为旋转轴。
 * 对手扇形不改这套数学，而是把整个锚点容器 rotate(180deg) 吊到视口顶边，
 * 于是"往下沉"自动变成"往上沉"、"两端向下垂"自动变成"两端向上垂"（见 OpponentFan）。
 */

/**
 * 卡面基准尺寸，必须和 styles.css 里的 --card-w / --card-h 一致。
 * 不一致的后果不是"卡画歪了"这么简单：下面的 sink 和 HandFan 的 MIN_HOVER_SCALE 都按它算，
 * 对不上号 hover 防抖动的几何前提就不成立了。
 */
export const CARD_WIDTH = 150
export const CARD_HEIGHT = 225

/**
 * 手牌张开的总角度，几张牌都是这个数。
 *
 * 以前是"每多一张多张开 5°、封顶 40°"，弧线跟着牌数变：出一张牌，剩下的整排会重新拱一次，
 * 明明只少了一张牌，看上去却像整只手换了个握法。固定下来之后，加减牌只改牌与牌的间距，
 * 拱的形状从头到尾是同一个，两端也永远是 ±SPREAD_DEG/2 = 20°
 *（HandFan 的 MIN_HOVER_SCALE 按这个最大倾角算防抖动的几何下限）。
 */
export const SPREAD_DEG = 40
/** 每张牌理想的水平间距；卡宽 150，所以到这个间距时相邻卡已经互相压住一部分。 */
export const GAP_PER_CARD = 95
/** 手牌总宽上限，超过就压缩间距让牌重叠。 */
export const MAX_SPAN = 900
/** 扇形最外侧那张牌和可用区域边缘之间至少留出的空隙，纯观感。 */
export const EDGE_MARGIN = 16
/**
 * 重排（加牌 / 减牌 / 改窗口大小）的时长。
 * 两侧手牌共用同一个值，加减牌时上下两排的节奏才是一套的。
 */
export const LAYOUT_DUR = 0.4

/** 一副扇形手牌的两个可调参数，其余公式两边完全共用。 */
export interface FanGeometry {
  /**
   * 卡牌沉出锚点边缘多少像素：越大，露在外面的部分越少。
   * 取 0 就是卡的底边正好压在锚点边缘上；取负值则整张牌往锚点内侧挪，露得更多
   * （对手那档就贴着 0，负值是否安全见 OPPONENT_FAN 的说明）。
   */
  sink: number
  /**
   * 扇形下垂用的虚拟半径。
   *
   * 下垂量是 arcRadius × (1 − cos 倾角)，所以半径越大、同样的倾角垂得越多。
   * 想把弧线压平要**调小**它，不是调大——这一点很容易记反。
   */
  arcRadius: number
}

/**
 * 玩家手牌：整排抬进视口 32px，沉出屏幕的只有两端那两个角。
 *
 * arcRadius 400，两端的下垂量 24px（最早是 800/48px），拱比原来平一半。
 *
 * sink 取负，是因为卡面最下面那块名字铭牌紧贴着卡的底边，整张牌往下沉一点就被视口切掉，
 * 而铭牌上的名字是必须看清的。32 是"尽量沉、又不切字"之间的那个点：
 * 两端下垂 24，牌又以底边中点为轴转了 20°、最低那个角还要再往下探 (卡宽/2)·sin 20° ≈ 26，
 * 于是最外侧那两个角落在视口下方约 18px 处。铭牌底边比那个角高十几像素，
 * 1280×800 下实测最外侧那张的铭牌底边出界约 3px——切掉的是铭牌下沿那条框，名字本身还完整。
 * 再想沉就真的要切字了，这点余量已经用尽。
 */
export const PLAYER_FAN: FanGeometry = {
  sink: -32,
  arcRadius: 400,
}

/**
 * 对手手牌：倒挂在视口顶边，整排还按 0.64 缩了一号（缩放写在 OpponentFan 的补间里），
 * 上面又压着 72px 高、不透明的顶栏。
 *
 * sink 是按"每张牌在顶栏下方还能露出多少"倒推的。缩放的变换原点是卡的底边中点，
 * 而 sink 和下垂量是父坐标系里的位移、不跟着卡一起缩，所以：
 * 露出高度 = 卡高 225 × 0.64 − sink − 下垂量 − 顶栏 72 = 72 − sink − 下垂量。
 * 缩到 0.64 之后卡只剩 144 高，再照旧沉 8 就只露五十来像素，一排牌看着像一条边框，
 * 所以 sink 直接归 0：牌的底边（也就是缩放和旋转的轴）正好压在视口顶边上，一点都不外沉。
 * 张角固定在 40°（见 SPREAD_DEG），两端的下垂量因此恒定在 16px，几张牌都一样：
 * 中间那张露 72px、两端露 56px，加减牌不会让这排牌忽高忽低。
 * 还想再多露一点的话 sink 可以取负值（整排往屏幕里挪）：顶栏不透明，只要 |sink|
 * 小于顶栏高度，牌和视口边之间空出来的那条缝就一直藏在顶栏后面，看不出破绽；
 * 现在没这么做只是因为 0 已经落在想要的露出量里。
 * 矮窗口那一档（styles.css 里 max-height: 805px）顶栏收成 62px，露出的部分跟着多 10px，
 * 观感上仍是同一回事，不用为它单独调 sink。
 * arcRadius 260 和玩家那档的 400 是各按各的理由选的：这边挑的是"两端还能露出多少"
 *（垂 16px 时露 56px，再垂就看着像一条边框），玩家那边挑的是拱得好不好看。
 * 改一边不用跟着改另一边。
 */
export const OPPONENT_FAN: FanGeometry = {
  sink: 0,
  arcRadius: 260,
}

export interface SlotTransform {
  x: number
  y: number
  rotation: number
}

/**
 * 算出第 index 张牌在扇形里的基准位置。
 *
 * areaWidth 是"这排扇形可以铺开多宽"，不是视口宽：玩家手牌传的是战场中栏的宽度
 * （见 HandFan 的 fanAreaWidth），对手手牌顶栏那排没人跟它抢地方，传的就是视口宽。
 *
 * 以底边中点为旋转轴是防抖动的第一步：hover 时只放大、只往上长，绝不往下移，
 * 卡底始终不会往锚点内侧跑（玩家那档还额外沉了 sink，hover 时也还差 HOVER_BOTTOM）。
 * 第二步是放大倍数的下限（见 HandFan 的 MIN_HOVER_SCALE）：只有横向也盖过倾斜卡牌最远的那个角，
 * 放大后的卡才真的盖住了原来那张卡露在屏幕里的全部像素，
 * 指针不会因为卡变大而掉到卡外面，也就不会出现"放大→缩回→又放大"的循环。
 */
export function fanTransform(
  index: number,
  count: number,
  areaWidth: number,
  geometry: FanGeometry,
): SlotTransform {
  if (count <= 1) return { x: 0, y: geometry.sink, rotation: 0 }

  const spread = SPREAD_DEG
  const rotation = -spread / 2 + (spread / (count - 1)) * index

  /*
   * 能张多宽由三条一起卡：理想间距、总宽上限，以及"最外侧那张牌不许越过可用区域的边"。
   *
   * 第三条要按倾斜后的实际占位算，不能拿卡宽了事：以底边中点为轴倾斜 θ 的牌，
   * 横向要伸到 (卡宽/2)·cos θ + 卡高·sin θ——20°（张角到顶那一档）时是 142px，
   * 比半个卡宽 75 多出快一倍。早先这里写的是 viewportWidth × 0.7，
   * 既没扣掉这块伸出量，也没考虑对局界面两侧的栏（它们 z-index 30，压在手牌之上），
   * 手牌一多两端就整片钻到侧栏底下去了。
   *
   * span 是"每张牌摊一格"的总宽，最外侧牌心只到 span/2 × (count−1)/count，
   * 所以反推可用的 span 时要再乘回 count/(count−1)。
   */
  const tilt = ((spread / 2) * Math.PI) / 180
  const halfExtent = (CARD_WIDTH / 2) * Math.cos(tilt) + CARD_HEIGHT * Math.sin(tilt)
  const fitHalf = Math.max(0, areaWidth / 2 - EDGE_MARGIN - halfExtent)
  const fitSpan = ((fitHalf * 2) * count) / (count - 1)

  const span = Math.min(fitSpan, MAX_SPAN, count * GAP_PER_CARD)
  const gap = span / count
  const x = (index - (count - 1) / 2) * gap

  // 让扇形的两端往下垂，像一叠握在手里的牌，而不是排在一条直线上。
  const droop = geometry.arcRadius * (1 - Math.cos((rotation * Math.PI) / 180))
  return { x, y: geometry.sink + droop, rotation }
}
