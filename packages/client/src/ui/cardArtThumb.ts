/**
 * 把卡面原画路径换成缩略图路径。
 *
 * 原画是 1024×1536，而牌库页的卡池格子、小卡这类列表场景只画到 150×225 上下。
 * 直接铺原图的话，浏览器要为每张卡解码整张大图再高倍降采样，一屏几十张时滚动和拖拽明显掉帧。
 * 缩略图是 300 宽（2 倍 DPR 下够用）的离线产物，由 scripts/gen-card-thumbs.sh 烤出来。
 *
 * **放大查看（CardZoomOverlay）必须继续用原图**：那里卡片占到大半个屏幕，
 * 300 宽拉上去会糊得一眼可见。同理，任何把卡画大的场合（强制展示、图鉴大图）都别走这个函数。
 */

/** 原画所在目录。缩略图镜像这个目录的结构，多套一层 thumbs/。 */
const CARDS_PREFIX = '/cards/'
const THUMBS_PREFIX = '/cards/thumbs/'

/**
 * 取一张原画对应的缩略图路径；认不出来的原样返回。
 *
 * 这里靠路径拼接而不是查表，是因为生成脚本会把 public/cards/ 下**每一张** webp 都烤一份，
 * 缩略图路径和原画路径逐段对齐（cards/models/x.webp -> cards/thumbs/models/x.webp）。
 * 于是"有原画就有缩略图"是脚本保证的不变量，这边不用再维护一份会和资产漂移的清单。
 * 反过来说：往 public/cards/ 手工丢图却没重跑脚本，这里就会指向不存在的文件（图裂），
 * 加图后请重跑 scripts/gen-card-thumbs.sh。
 *
 * 原样返回的几种情况：
 *   - 卡牌自带的外部图（HandCardData.art 可以是任意 URL，比如 http: 或 data:）；
 *   - 不在 /cards/ 下的路径；
 *   - 已经是缩略图路径，避免重复调用叠成 thumbs/thumbs/。
 * 这些都是正常输入，不是错误，所以既不抛异常也不报警告——原图能显示，只是没吃到优化。
 */
export function thumbFor(artUrl: string): string {
  if (!artUrl.startsWith(CARDS_PREFIX)) return artUrl
  if (artUrl.startsWith(THUMBS_PREFIX)) return artUrl
  // 只有 webp 有缩略图：脚本烤的就是 webp，别的扩展名（真出现了）没有对应产物。
  if (!artUrl.endsWith('.webp')) return artUrl
  return THUMBS_PREFIX + artUrl.slice(CARDS_PREFIX.length)
}
