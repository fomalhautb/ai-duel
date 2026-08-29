/**
 * 引导层的几何：把"舞台减去几个洞"拆成一组矩形。
 *
 * 纯函数，不碰 DOM，所以能直接断言。
 */

export interface OverlayRect {
  x: number
  y: number
  w: number
  h: number
}

/** 小于这个高度/宽度的碎片直接丢掉：浮点误差留下的零点几像素条纹会画成一道毛边。 */
const EPSILON = 0.5

/**
 * 舞台里除去这几个洞之后还该压暗的那些矩形。
 *
 * 做法是横向切带：按所有洞的上下边把舞台切成若干条，每一条里把跨满这一条的洞按 x 排开，
 * 洞与洞之间（以及两端）剩下的就是要压暗的矩形。只有一个洞时它正好退化成
 * "上、左、右、下"四块——也就是最常见的那种挖洞遮罩，洞区一个像素都不盖。
 *
 * 之所以不用 clip-path 打洞：整层是 pointer-events: none 的，洞里的真实 UI 本来就点得到，
 * 拼矩形能得到一模一样的画面，还不用担心各家浏览器对 path() 填充规则的差异。
 */
export function dimRects(
  holes: readonly OverlayRect[],
  stageWidth: number,
  stageHeight: number,
): OverlayRect[] {
  const bounds: number[] = [0, stageHeight]
  for (const hole of holes) {
    bounds.push(clamp(hole.y, 0, stageHeight), clamp(hole.y + hole.h, 0, stageHeight))
  }
  const rows = [...new Set(bounds)].sort((a, b) => a - b)

  const rects: OverlayRect[] = []
  for (let index = 0; index < rows.length - 1; index += 1) {
    const top = rows[index]!
    const bottom = rows[index + 1]!
    if (bottom - top <= EPSILON) continue
    // 只有**纵向跨满**这一条的洞才在这一条里留空；半截伸进来的洞在别的条里自会处理。
    const spans = holes
      .filter((hole) => hole.y <= top + EPSILON && hole.y + hole.h >= bottom - EPSILON)
      .map((hole) => ({
        from: clamp(hole.x, 0, stageWidth),
        to: clamp(hole.x + hole.w, 0, stageWidth),
      }))
      .filter((span) => span.to - span.from > EPSILON)
      .sort((a, b) => a.from - b.from)

    let cursor = 0
    for (const span of spans) {
      if (span.from - cursor > EPSILON) {
        rects.push({ x: cursor, y: top, w: span.from - cursor, h: bottom - top })
      }
      cursor = Math.max(cursor, span.to)
    }
    if (stageWidth - cursor > EPSILON) {
      rects.push({ x: cursor, y: top, w: stageWidth - cursor, h: bottom - top })
    }
  }
  return rects
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
