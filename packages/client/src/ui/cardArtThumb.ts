/**
 * 把卡面原画路径换成某一档缩小版的路径。
 *
 * 原画一律 1024×1536，而界面上**没有任何一处**把卡画到那么大：最大的一处是桌面上
 * 手牌 hover 放大到顶，卡面按 262 CSS 像素排版，2 倍 DPR 下也才 524 个设备像素。
 * 直接铺原图的话，浏览器要为每张卡解码整张 157 万像素的大图再高倍降采样；
 * 一屏几十张时滚动和拖拽明显掉帧，手机上还会因为内存吃紧被反复丢弃重解，正好卡在动画帧里。
 *
 * 所以离线烤了两档（scripts/gen-card-thumbs.sh），用哪一档看卡画多大：
 *   thumbFor → 300 宽，牌库页的卡池格子、小卡这类**列表**场景，一屏几十张。
 *   midFor   → 600 宽，**卡面组件（HandCardFace）显示的都走它**。手牌、战场小卡、
 *              强制展示、回合结算、牌库的放大查看全是同一个组件，所以只在那一处调用。
 *
 * 600 这一档是照上面那个 524 定的，还留了余量，所以**原画在界面上已经没有使用场景了**。
 * 真要加一处把卡画得比这更大的地方（比如整屏的图鉴大图），别直接改回原画路径，
 * 先回去把 gen-card-thumbs.sh 的 mid 档调大——那边一改，全站卡面一起受益。
 */

/** 原画所在目录。两档产物都镜像这个目录的结构，各多套一层自己的目录。 */
const CARDS_PREFIX = '/cards/'
const THUMBS_PREFIX = '/cards/thumbs/'
const MID_PREFIX = '/cards/mid/'

/**
 * 已经是产物的路径前缀。
 *
 * 认出来就原样返回，免得重复调用叠成 thumbs/thumbs/ 或 mid/thumbs/——
 * 后者尤其容易发生：牌库页先把卡表过一遍 thumbFor，某个卡面又被 HandCardFace 画一次，
 * 那里再过一遍 midFor，路径就串了。
 */
const VARIANT_PREFIXES = [THUMBS_PREFIX, MID_PREFIX]

/**
 * 取一张原画对应的某档产物路径；认不出来的原样返回。
 *
 * 这里靠路径拼接而不是查表，是因为生成脚本会把 public/cards/ 下的图逐张烤过去，
 * 产物路径和原画路径逐段对齐（cards/models/x.webp -> cards/mid/models/x.webp）。
 * 于是"有原画就有产物"是脚本保证的不变量，这边不用再维护一份会和资产漂移的清单。
 * 反过来说：往 public/cards/ 手工丢图却没重跑脚本，这里就会指向不存在的文件（图裂），
 * 加图后请重跑 scripts/gen-card-thumbs.sh。
 *
 * 原样返回的几种情况：
 *   - 卡牌自带的外部图（HandCardData.art 可以是任意 URL，比如 http: 或 data:）；
 *   - 不在 /cards/ 下的路径；
 *   - 已经是某一档产物的路径。
 * 这些都是正常输入，不是错误，所以既不抛异常也不报警告——图能显示，只是没吃到优化。
 */
function variantFor(artUrl: string, prefix: string): string {
  if (!artUrl.startsWith(CARDS_PREFIX)) return artUrl
  if (VARIANT_PREFIXES.some((known) => artUrl.startsWith(known))) return artUrl
  // 只有 webp 有产物：脚本烤的就是 webp，别的扩展名（真出现了）没有对应文件。
  if (!artUrl.endsWith('.webp')) return artUrl
  return prefix + artUrl.slice(CARDS_PREFIX.length)
}

/** 300 宽那一档：牌库页的卡池格子、小卡这类列表场景。 */
export function thumbFor(artUrl: string): string {
  return variantFor(artUrl, THUMBS_PREFIX)
}

/**
 * 600 宽那一档：卡面组件真正显示的图。
 *
 * 正常只该由 HandCardFace 和卡背那几处调用——全站的卡都是它们画的，
 * 在别处再调一次多半说明那里绕开了公共卡面组件，先想想是不是该改成用组件。
 */
export function midFor(artUrl: string): string {
  return variantFor(artUrl, MID_PREFIX)
}
