/**
 * 首页人物 alpha 命中检测的纯函数部分。
 *
 * vitest 跑在 node 环境下，没有 Image 也没有 canvas，所以这里只测不碰 DOM 的那两个函数
 * （命中查询和包围盒计算）——alpha 数组手工构造，一目了然，也不用为测试引一套 canvas 垫片。
 */

import { describe, expect, it } from 'vitest'
import type { AlphaMap } from '../src/screens/castHitTest'
import { CAST_ALPHA_THRESHOLD, computeAlphaBBox, hitTestAlphaMaps } from '../src/screens/castHitTest'

/** 按 width×height 造一张图，fill 决定每个像素的 alpha。 */
function makeMap(width: number, height: number, fill: (x: number, y: number) => number): AlphaMap {
  const alpha = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) alpha[y * width + x] = fill(x, y)
  }
  return { width, height, alpha, bbox: computeAlphaBBox(alpha, width, height) }
}

describe('computeAlphaBBox', () => {
  it('把不透明像素的极值换算成 0~1 的比例，右下边界含整个像素格', () => {
    // 10×10 里只有 (2,3)~(5,7) 这块是实的。
    const map = makeMap(10, 10, (x, y) => (x >= 2 && x <= 5 && y >= 3 && y <= 7 ? 255 : 0))
    expect(map.bbox).toEqual({ minX: 0.2, minY: 0.3, maxX: 0.6, maxY: 0.8 })
  })

  it('低于阈值的半透明边缘不算进包围盒', () => {
    const alpha = new Uint8Array(4 * 1)
    alpha[0] = CAST_ALPHA_THRESHOLD - 1
    alpha[1] = CAST_ALPHA_THRESHOLD
    alpha[2] = 255
    alpha[3] = 0
    expect(computeAlphaBBox(alpha, 4, 1)).toEqual({ minX: 0.25, minY: 0, maxX: 0.75, maxY: 1 })
  })

  it('整张全透明时没有包围盒', () => {
    expect(computeAlphaBBox(new Uint8Array(9), 3, 3)).toBeNull()
  })
})

describe('hitTestAlphaMaps', () => {
  /** 左半边实心 */
  const left = makeMap(4, 4, (x) => (x < 2 ? 255 : 0))
  /** 右三列实心，和 left 在第 2 列重叠 */
  const right = makeMap(4, 4, (x) => (x >= 1 ? 255 : 0))

  it('重叠处判给排在后面的图层（前排的人挡住后排的）', () => {
    // 归一化 0.3 落在第 1 列，两张图在这里都是实的，所以答案只取决于谁排在后面。
    expect(hitTestAlphaMaps([left, right], 0.3, 0.5)).toBe(1) // right 在上
    expect(hitTestAlphaMaps([right, left], 0.3, 0.5)).toBe(1) // left 在上
  })

  it('只有一张图覆盖时命中那张', () => {
    expect(hitTestAlphaMaps([left, right], 0.05, 0.5)).toBe(0)
    expect(hitTestAlphaMaps([left, right], 0.95, 0.5)).toBe(1)
  })

  it('透明处不命中', () => {
    const only = makeMap(4, 4, (x) => (x < 1 ? 255 : 0))
    expect(hitTestAlphaMaps([only], 0.9, 0.5)).toBeNull()
  })

  it('阈值以下的羽化边缘不算命中', () => {
    const soft = makeMap(2, 1, (x) => (x === 0 ? CAST_ALPHA_THRESHOLD - 1 : CAST_ALPHA_THRESHOLD))
    expect(hitTestAlphaMaps([soft], 0.25, 0.5)).toBeNull()
    expect(hitTestAlphaMaps([soft], 0.75, 0.5)).toBe(0)
  })

  it('坐标出界一律不命中', () => {
    const full = makeMap(2, 2, () => 255)
    expect(hitTestAlphaMaps([full], -0.01, 0.5)).toBeNull()
    expect(hitTestAlphaMaps([full], 1, 0.5)).toBeNull()
    expect(hitTestAlphaMaps([full], 0.5, 1.2)).toBeNull()
    expect(hitTestAlphaMaps([full], Number.NaN, 0.5)).toBeNull()
  })

  it('加载失败的空图被跳过，不影响它下面那层', () => {
    const broken: AlphaMap = { width: 0, height: 0, alpha: new Uint8Array(0), bbox: null }
    expect(hitTestAlphaMaps([left, broken], 0.1, 0.5)).toBe(0)
  })

  describe('遮挡层', () => {
    /** 下半截实心，模拟压住人物下半身的桌面弧 */
    const table = makeMap(4, 4, (_x, y) => (y >= 2 ? 255 : 0))

    it('被遮挡层盖住的地方不算命中', () => {
      // 同一个 x，上半截看得见人所以命中，下半截被桌面盖住就当没命中。
      expect(hitTestAlphaMaps([left], 0.1, 0.1, [table])).toBe(0)
      expect(hitTestAlphaMaps([left], 0.1, 0.9, [table])).toBeNull()
    })

    it('遮挡层透明的地方照常命中', () => {
      const empty = makeMap(4, 4, () => 0)
      expect(hitTestAlphaMaps([left], 0.1, 0.9, [empty])).toBe(0)
    })

    it('遮挡层自己的羽化边缘不算遮挡', () => {
      const soft = makeMap(4, 4, () => CAST_ALPHA_THRESHOLD - 1)
      expect(hitTestAlphaMaps([left], 0.1, 0.9, [soft])).toBe(0)
    })
  })

  /*
   * 素材只要求和舞台等比，不要求等大，几张图之间也不必同尺寸（见 castHitTest.ts 文件头）。
   * 首页文档里"换 2x 素材代码一行都不用改"这句话就靠这条性质，所以拿测试钉住：
   * 人物图换成 2x、遮挡层还是 1x 时，同一个归一化坐标必须判出同样的结果。
   */
  it('同一坐标下，图的分辨率不影响判定结果', () => {
    const table1x = makeMap(4, 4, (_x, y) => (y >= 2 ? 255 : 0))
    const left2x = makeMap(8, 8, (x) => (x < 4 ? 255 : 0))

    expect(hitTestAlphaMaps([left2x], 0.1, 0.1, [table1x])).toBe(0)
    expect(hitTestAlphaMaps([left2x], 0.1, 0.9, [table1x])).toBeNull()
    // 包围盒是比例，所以 1x 和 2x 的同一张图算出来完全一样。
    expect(left2x.bbox).toEqual(left.bbox)
  })
})
