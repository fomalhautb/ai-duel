/**
 * 首页人物抠图的逐像素命中检测。
 *
 * 首页那七张人物图都是和舞台等大的整幅透明 webp，铺满舞台叠在展示卡上面。
 * 想知道"指针有没有停在某个人身上"，正常做法是给图层加 pointer-events，
 * 但这条路被堵死了：图层压在四张展示卡之上，一旦收指针事件，卡就永远 hover 不到了
 * （styles.css 的 .home__layer 注释里把这条约束写死了）。
 *
 * 所以命中检测挪到舞台级别做：预先把每张图的 alpha 通道抠出来存成数组，
 * 指针在舞台上移动时把坐标归一化，从最上层往下查哪张图在这个点是不透明的。
 *
 * 压在人物之上的桌面弧和前景道具也要抽一份 alpha，当"遮挡层"从命中区里减掉，
 * 否则会出现"指着地球仪却高亮了它后面的人"（见 hitTestAlphaMaps 的注释）。
 *
 * 采样时按源图边长降采样到 1/4（现在的 1x 素材 1672×941 → 418×235），一张图约 96KB，
 * 七张人物加两张遮挡层不到 1MB，而轮廓在这个精度下误差只有 4 个屏幕像素，hover 判定完全够用。
 *
 * 除了这个缓冲大小，其余部分和素材分辨率无关：坐标和包围盒一律归一化成 0~1，
 * 每张图各按自己的宽高采样，所以素材只要求和舞台**等比**，不要求等大，几张图之间也不必同尺寸。
 * 但降采样是按源图边长算的：素材换成 2x（3344×1882）后这些缓冲会涨到四倍（九张约 3.4MB），
 * 多出来的精度在屏幕上却看不出来——命中判定跟得上屏幕像素就够了。
 * 真换了 2x，把 CAST_ALPHA_DOWNSCALE 从 4 改成 8，内存和精度就都回到今天这样。
 */

/** 归一化包围盒，四个值都是 0~1 的比例（相对图片宽高），方便直接换算成舞台里的百分比。 */
export interface NormalizedBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 一张人物图抽出来的 alpha 信息。 */
export interface AlphaMap {
  width: number
  height: number
  /** 逐像素 alpha（0~255），行优先，长度 = width * height。 */
  alpha: Uint8Array
  /** 不透明像素的包围盒；整张全透明（或加载失败）时是 null。 */
  bbox: NormalizedBox | null
}

/**
 * 判定"这个像素算人物身上"的 alpha 下限。
 *
 * 抠图边缘是笔刷化开的半透明羽化，取 64（约 25%）是让指针必须真的压到人身上才算命中，
 * 蹭到轮廓外那圈虚边不触发——否则相邻两个人的虚边会重叠，高亮会来回跳。
 */
export const CAST_ALPHA_THRESHOLD = 64

/** 降采样倍数。命中精度和内存的折中，理由见文件头。 */
export const CAST_ALPHA_DOWNSCALE = 4

/**
 * 从 alpha 数组算不透明像素的归一化包围盒。
 *
 * 用的是"扫全图记录四个极值"的朴素做法：降采样之后一张图也就十万个像素上下（2x 素材是四十万），
 * 每张图一辈子只算一次，没必要为它做行/列的提前跳出。
 */
export function computeAlphaBBox(
  alpha: Uint8Array,
  width: number,
  height: number,
  threshold: number = CAST_ALPHA_THRESHOLD,
): NormalizedBox | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      if ((alpha[row + x] ?? 0) < threshold) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0 || maxY < 0) return null

  // 极值是像素下标，转成比例时右/下边界要 +1：下标 5 的像素占的是 [5, 6) 这一格。
  return {
    minX: minX / width,
    minY: minY / height,
    maxX: (maxX + 1) / width,
    maxY: (maxY + 1) / height,
  }
}

/** 读一张 alpha 图在归一化坐标处的值；空图（加载失败）当全透明。 */
function sampleAlpha(map: AlphaMap | undefined, nx: number, ny: number): number {
  if (map === undefined || map.width <= 0 || map.height <= 0) return 0
  const x = Math.min(map.width - 1, Math.floor(nx * map.width))
  const y = Math.min(map.height - 1, Math.floor(ny * map.height))
  return map.alpha[y * map.width + x] ?? 0
}

/**
 * 在一组 alpha 图上做命中检测，返回命中的下标（没命中返回 null）。
 *
 * maps 的顺序就是 DOM 里的叠放顺序，所以从**最后一项往前**查：
 * 站在前排的人排在数组后面，两个人重叠的地方应该判给挡在前面的那个。
 *
 * occluders 是排在 maps **之上**的图层（首页是桌面弧和前景道具）。
 * 它们不参与"命中谁"，只回答"这个点还看得见人吗"：人物下半身有相当一部分
 * 被桌沿和地球仪压住，屏幕上根本看不见，但那些像素在人物图里照样是不透明的。
 * 不减掉的话，指针停在地球仪上会莫名弹出介绍卡片，而金边高亮同样被道具盖住、看不出原因。
 * 所以只要任一遮挡层在这个点不透明，就当没命中。
 *
 * nx / ny 是相对图片的归一化坐标（左上角 0,0，右下角 1,1）。
 */
export function hitTestAlphaMaps(
  maps: readonly AlphaMap[],
  nx: number,
  ny: number,
  occluders: readonly AlphaMap[] = [],
  threshold: number = CAST_ALPHA_THRESHOLD,
): number | null {
  if (!(nx >= 0) || !(ny >= 0) || nx >= 1 || ny >= 1) return null

  // 遮挡层先查：只有两张，命中就能省下后面扫七张人物图的开销。
  for (const occluder of occluders) {
    if (sampleAlpha(occluder, nx, ny) >= threshold) return null
  }

  for (let index = maps.length - 1; index >= 0; index -= 1) {
    if (sampleAlpha(maps[index], nx, ny) >= threshold) return index
  }

  return null
}

/** 加载失败时的兜底：一张永远不命中、也没有包围盒的空图，让首页照常显示。 */
function emptyAlphaMap(): AlphaMap {
  return { width: 0, height: 0, alpha: new Uint8Array(0), bbox: null }
}

/**
 * 把一张图解码后抽出 alpha 通道。
 *
 * canvas 由调用方传进来，几张图轮流用同一块：解码 await 之后的
 * 「改尺寸 → drawImage → getImageData」是一段同步代码，并发的几张不会插进来抢画布。
 *
 * 单张失败（404、解码错、canvas 上下文拿不到）不抛出，返回空图即可：
 * 少一个人不能 hover 是可以接受的降级，整页因此崩掉不行。
 */
async function loadAlphaMap(src: string, canvas: HTMLCanvasElement): Promise<AlphaMap> {
  try {
    const image = new Image()
    image.src = src
    await image.decode()

    const width = Math.max(1, Math.round(image.naturalWidth / CAST_ALPHA_DOWNSCALE))
    const height = Math.max(1, Math.round(image.naturalHeight / CAST_ALPHA_DOWNSCALE))
    /*
     * willReadFrequently 的名字有点误导：它真正的意思是"这块画布的像素要回 CPU 读"，
     * 而不是"要读很多次"。这里的用法正是它的主场——每张图只画一次（还是缩到 1/4 的小图，
     * 用 CPU 后端画也很便宜），画完立刻 getImageData 全读走。
     * 走 GPU 后端的话这一次 getImageData 是同步的 GPU→CPU 回读，要等 GPU 排空才返回，
     * 而这段代码正好跑在首页入场动画期间，卡的是主线程。
     */
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx === null) return emptyAlphaMap()
    canvas.width = width
    canvas.height = height
    ctx.drawImage(image, 0, 0, width, height)

    const { data } = ctx.getImageData(0, 0, width, height)
    const alpha = new Uint8Array(width * height)
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3] ?? 0

    return { width, height, alpha, bbox: computeAlphaBBox(alpha, width, height) }
  } catch {
    return emptyAlphaMap()
  }
}

/** 并行加载一组图的 alpha 信息，返回结果和入参一一对应。 */
export async function loadCastAlphaMaps(srcs: readonly string[]): Promise<AlphaMap[]> {
  const canvas = document.createElement('canvas')
  try {
    return await Promise.all(srcs.map((src) => loadAlphaMap(src, canvas)))
  } finally {
    // 尺寸归零等于丢掉像素缓冲，不用等 GC 才把这几百 KB 还回去。
    canvas.width = 0
    canvas.height = 0
  }
}
