/**
 * 首屏资源预加载：先把一个界面要用的图全部拉完，再让它上场。
 *
 * 为什么需要：首页是十几张整幅图叠出来的一张画。浏览器是拿到一张画一张，
 * 不管的话玩家会看着夜空、人物、桌子、道具一层层往上冒，还夹着几张卡的插画慢慢显影。
 * 与其让人看半成品，不如整段时间都停在 loader 上，好了再一次性亮出来。
 *
 * 没有引第三方库：要做的只是"等一批 Image 加载完"，浏览器原生就够了。
 */

import { useEffect, useState } from 'react'

/**
 * 兜底超时：连着这么久**一张图都没加载完**就不等了。
 *
 * 为什么需要：图挂了 onerror 会立刻回来，但请求卡在那儿不上不下是没有回调的
 * （比如网络极慢、或者被中间设备吞了），没这道闸就会永远停在 loader 上。
 * 超时之后照常进页面，缺的图会自己在后面补上——退回成原来那种"慢慢加载"，
 * 总比一个进不去的首页强。
 *
 * 计的是"停滞多久"而不是"总共等了多久"：对局那份清单有四十多张图、十几 MB
 * （见 ui/backgroundPreload.ts 的 BATTLE_ASSETS），慢一点的网络下总时长轻松超过任何一个
 * 定死的上限，按总时长算的话闸门几乎必然超时放行，等于白设。而只要还在一张接一张地到货，
 * 就说明连接是通的、值得继续等；真卡住了，这十秒里一张都不会完成。
 */
const PRELOAD_STALL_MS = 10_000

/**
 * 本次会话里已经结束等待的图（加载成功和失败的都算）。
 *
 * 作用是"从别的页面回到首页时不要再闪一次 loader"：图这时已经在浏览器缓存里，
 * 等待会在一两帧内结束，但那一两帧的 loader 闪烁比不闪更难看。
 * 失败的也记进来，是不想每次回首页都为同一张取不到的图重新卡满超时。
 */
const settled = new Set<string>()

/**
 * 正在下载、还没有结果的图。
 *
 * 后台预加载和页面闸门会同时要同一张图（后台正慢慢往下拉，玩家已经点进了那一页），
 * 各造一个 Image 的话就是两轮请求。共用同一个 Promise，谁先起的头谁负责，另一边搭车等着。
 * 有结果就从这儿摘掉，转记进 settled。
 */
const inFlight = new Map<string, Promise<void>>()

/**
 * 加载一张图，等它解码完就算数（成功失败都算）。
 *
 * priority 传 'low' 用于后台预加载：让浏览器把这张图排在当前页面真正要用的资源后面。
 * 注意搭车的情况下 priority 不起作用——已经发出去的请求改不了优先级，
 * 而重发一份也没用，浏览器认地址，两次请求本来就会被合成一条。
 */
function loadImage(url: string, priority: 'auto' | 'low' = 'auto'): Promise<void> {
  if (settled.has(url)) return Promise.resolve()
  const running = inFlight.get(url)
  if (running) return running

  const image = new Image()
  // 必须赶在 src 之前设：请求一发出去，再改优先级就没有意义了。
  // 老浏览器没有这个属性，赋值只是往对象上多挂一个字段，不影响加载。
  if (priority === 'low') image.fetchPriority = 'low'
  image.src = url
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = reject
  })
  // 用 decode() 而不是只等 onload：onload 只代表下载完，解码还留在首次绘制那一帧里做，
  // 十几张整幅大图一起解码足够卡掉几帧——正是这次要消灭的"画面一块块拼出来"。
  // decode() 把解码提前到这儿，之后贴上去就是现成的位图。
  //
  // 但页面切到后台时浏览器会把解码整个推迟到重新可见，decode() 返回的 promise 于是一直不结算
  // ——不是慢，是真的不返回。后台预加载是排队串行的，一张卡住整条队就停在那儿，
  // 玩家切出去回个消息再回来，剩下的图一张都没下。所以下载完之后只要页面在后台就不再等解码：
  // 反正没人在看，解码晚一点做没有任何代价。
  const done =
    typeof image.decode === 'function'
      ? Promise.race([image.decode().then(() => undefined), loaded.then(whileHidden)])
      : loaded

  // 失败也当"等到了"：少一张图是画面问题，卡在 loader 里进不去是致命问题。
  function finish(): void {
    settled.add(url)
    inFlight.delete(url)
  }
  const task = done.then(finish, finish)
  inFlight.set(url, task)
  return task
}

/**
 * 等到页面处于后台。已经在后台就立刻返回，否则一直等到玩家切走。
 *
 * 只给上面那处"下载完了、页面在后台就别等解码了"用。页面一直开着的话这个 promise 永远不结算，
 * 于是那边的 race 就老老实实等 decode()——正是想要的行为。
 */
let hiddenWaiters: (() => void)[] = []
let watchingVisibility = false

function whileHidden(): Promise<void> {
  if (document.visibilityState === 'hidden') return Promise.resolve()

  // 一个监听器管所有等待者，而不是每张图各挂一个：一批就是四十多张，
  // 页面一直开着的话那些监听器谁也摘不掉，一路攒下去。
  if (!watchingVisibility) {
    watchingVisibility = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return
      const waiting = hiddenWaiters
      hiddenWaiters = []
      for (const wake of waiting) wake()
    })
  }

  return new Promise<void>((resolve) => {
    hiddenWaiters.push(resolve)
  })
}

/**
 * 等字体就位。
 *
 * 正文字体是从 Google Fonts 拿的（引入写在 index.html，用的是 display=swap），
 * 不等它的话页面会先用本地宋体画一遍标题，字体到货后再整段重排一次，
 * 字宽和位置都会跳一下。等在 loader 后面，玩家就只看得到最终那一版。
 *
 * document.fonts 在少数老浏览器和 jsdom 里没有，取不到就直接放行。
 */
function fontsReady(): Promise<void> {
  return document.fonts?.ready.then(() => undefined) ?? Promise.resolve()
}

/**
 * 一批素材的加载进度。
 *
 * 按"张数"算而不是按字节：图是用 Image 拉的，浏览器不会告诉我们下了多少字节，
 * 想按体积算就得另外维护一份"每张图多大"的清单，加图漏登记就会算错。
 * 张数的代价是走得不匀（一张 600 KB 的原画和一张 20 KB 的图标各占一格），
 * 但至少一定是真的、而且只会往前走。
 */
export interface PreloadProgress {
  /** 已经有结果的张数（加载成功和失败的都算，跟闸门的口径一致）。 */
  loaded: number
  /** 这批清单一共几张。 */
  total: number
}

export interface PreloadOptions {
  /** 连着这么久一张图都没到就放行，默认 PRELOAD_STALL_MS。 */
  stallMs?: number
  /**
   * 进度变化时回调。调用这一刻会先同步报一次当前进度（缓存里已有的那些直接算数），
   * 之后每到一张图报一次。字体不计进 total：它没有"加载了几分之几"可言，
   * 而且多半比图先好，硬算成一格只会让进度条在最后莫名其妙卡一下。
   */
  onProgress?: (progress: PreloadProgress) => void
}

/** 全部图片加载完（或卡住太久）就 resolve，永远不 reject。 */
export function preloadAssets(urls: readonly string[], options: PreloadOptions = {}): Promise<void> {
  const { stallMs = PRELOAD_STALL_MS, onProgress } = options
  const total = urls.length

  // 包一层箭头函数而不是直接 map(loadImage)：map 会把下标当第二个参数传进去，正好撞上 priority。
  // 只 map 一次并把结果留下来：下面还要逐个挂"到货了"的回调，重新 map 一遍会为同一个地址
  // 再造一个 Image，白发一轮请求。
  const each = urls.map((url) => loadImage(url))
  const everything = Promise.all([...each, fontsReady()]).then(() => undefined)

  // 先报一次起点。缓存命中时这一次报的就是满格，进度条不会从 0 补跑一遍。
  // 逐个记"这一格算过没有"而不是只留一个计数器：缓存命中的图 promise 也会回调，
  // 不记的话它们会被数第二遍，loaded 直接超过 total。按下标记还能容忍清单里有重复地址。
  const counted = urls.map((url) => settled.has(url))
  let loaded = counted.filter(Boolean).length
  onProgress?.({ loaded, total })

  return new Promise<void>((resolve) => {
    let timer = setTimeout(resolve, stallMs)
    // 每到一张就把停滞计时重新起头，所以只有"连着 stallMs 一张都没到"才会放行。
    function restart(): void {
      clearTimeout(timer)
      timer = setTimeout(resolve, stallMs)
    }
    each.forEach((one, index) => {
      void one.then(() => {
        // 数自己的计数器而不是回头数 settled：settled 是全站共用的，
        // 后台预加载同时也在往里塞别的图，拿它当分子会把不属于这批的张数算进来。
        if (!counted[index]) {
          counted[index] = true
          loaded += 1
          onProgress?.({ loaded, total })
        }
        restart()
      })
    })
    void everything.then(() => {
      // 全到齐了就把计时撤掉，否则这颗定时器会一直挂到超时才自然消失。
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * 后台悄悄把一批图拉下来，不挡任何界面。
 *
 * 和 preloadAssets 的区别是"谁在等"：那个是玩家正盯着 loader 等这批图，
 * 所以要一次全发出去、还要有超时兜底；这个是玩家正在玩别的页面，
 * 图晚一点到没关系，反而不能挤掉当前页面的请求。所以这里：
 * - 限制并发（默认 3 条），不一口气占满浏览器对同一域名的连接；
 * - 每张图都标 fetchPriority: 'low'，排在页面自己的资源后面；
 * - 不设超时，慢就慢着，反正没人等。
 *
 * 已经加载过的（settled 里有的）直接跳过，所以进过的页面不会被重复排队。
 * 和 loadImage 一样永远不 reject。
 */
export function preloadAssetsInBackground(
  urls: readonly string[],
  concurrency = 3,
): Promise<void> {
  const pending = urls.filter((url) => !settled.has(url))
  if (pending.length === 0) return Promise.resolve()

  // 固定几个 worker 轮流从同一个下标往后取，取完就收工——
  // 比按数量切成几段好在：某张图特别慢时，其他 worker 会继续消化剩下的，不会有人空等。
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const url = pending[next]
      next += 1
      if (url === undefined) return
      await loadImage(url, 'low')
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () => worker())
  return Promise.all(workers).then(() => undefined)
}

/** useAssetsProgress 的返回值。 */
export interface AssetsState {
  /** 这批图能用了没有（超时放行也算能用，缺的图会自己在后面补上）。 */
  ready: boolean
  /** 0~1 的加载进度，给进度条用。ready 之后一定是 1。 */
  progress: number
}

/**
 * 把 preloadAssets 接进 React：返回"这批图能用了没有"和加载到哪儿了。
 *
 * urls 必须是模块级常量之类的稳定引用，每次渲染现拼一个新数组会让 effect 反复重跑。
 */
export function useAssetsProgress(urls: readonly string[]): AssetsState {
  // 初值直接查缓存：回到首页时如果都加载过，第一帧就是就绪状态，不会闪一下 loader。
  const [state, setState] = useState<AssetsState>(() => {
    const loaded = urls.reduce((count, url) => (settled.has(url) ? count + 1 : count), 0)
    const ready = loaded === urls.length
    return { ready, progress: ratio(loaded, urls.length) }
  })

  useEffect(() => {
    if (state.ready) return
    let cancelled = false
    void preloadAssets(urls, {
      onProgress: ({ loaded, total }) => {
        if (cancelled) return
        setState((prev) => {
          const progress = ratio(loaded, total)
          // 只许往前走。同一个地址可能同时被别处的加载也盯着，
          // 而且进度条往回缩比走得不匀难看得多。
          return progress <= prev.progress ? prev : { ready: prev.ready, progress }
        })
      },
    }).then(() => {
      // 超时放行时进度可能还没满，这里一并补成满格：闸门已经开了，
      // 让玩家看着一条没走完的进度条切走反而像是出了错。
      if (!cancelled) setState({ ready: true, progress: 1 })
    })
    return () => {
      cancelled = true
    }
    // 依赖里只放 ready 不放 progress：进度每变一次都重跑 effect 的话，
    // preloadAssets 会被反复调用（虽然有 inFlight 兜底不会重复发请求，但计时器会一路重建）。
  }, [urls, state.ready])

  return state
}

/** 空清单当作已经满了，免得除出 NaN 把进度条宽度写成 NaN%。 */
function ratio(loaded: number, total: number): number {
  return total === 0 ? 1 : loaded / total
}
