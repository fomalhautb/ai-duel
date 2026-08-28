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
 * 兜底超时。图挂了 onerror 会立刻回来，但请求卡在那儿不上不下是没有回调的
 * （比如网络极慢、或者被中间设备吞了），没这道闸就会永远停在 loader 上。
 * 超时之后照常进页面，缺的图会自己在后面补上——退回成原来那种"慢慢加载"，
 * 总比一个进不去的首页强。
 */
const PRELOAD_TIMEOUT_MS = 10_000

/**
 * 本次会话里已经结束等待的图（加载成功和失败的都算）。
 *
 * 作用是"从别的页面回到首页时不要再闪一次 loader"：图这时已经在浏览器缓存里，
 * 等待会在一两帧内结束，但那一两帧的 loader 闪烁比不闪更难看。
 * 失败的也记进来，是不想每次回首页都为同一张取不到的图重新卡满超时。
 */
const settled = new Set<string>()

function loadImage(url: string): Promise<void> {
  if (settled.has(url)) return Promise.resolve()

  const image = new Image()
  image.src = url
  // 用 decode() 而不是只等 onload：onload 只代表下载完，解码还留在首次绘制那一帧里做，
  // 十几张整幅大图一起解码足够卡掉几帧——正是这次要消灭的"画面一块块拼出来"。
  // decode() 把解码提前到这儿，之后贴上去就是现成的位图。
  const done =
    typeof image.decode === 'function'
      ? image.decode()
      : new Promise<void>((resolve, reject) => {
          image.onload = () => resolve()
          image.onerror = reject
        })

  // 失败也当"等到了"：少一张图是画面问题，卡在 loader 里进不去是致命问题。
  return done.then(
    () => {
      settled.add(url)
    },
    () => {
      settled.add(url)
    },
  )
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

/** 全部图片加载完（或超时）就 resolve，永远不 reject。 */
export function preloadAssets(
  urls: readonly string[],
  timeoutMs: number = PRELOAD_TIMEOUT_MS,
): Promise<void> {
  const everything = Promise.all([...urls.map(loadImage), fontsReady()]).then(() => undefined)
  const deadline = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
  return Promise.race([everything, deadline])
}

/**
 * 把 preloadAssets 接进 React：返回"这批图能用了没有"。
 *
 * urls 必须是模块级常量之类的稳定引用，每次渲染现拼一个新数组会让 effect 反复重跑。
 */
export function useAssetsReady(urls: readonly string[]): boolean {
  // 初值直接查缓存：回到首页时如果都加载过，第一帧就是就绪状态，不会闪一下 loader。
  const [ready, setReady] = useState(() => urls.every((url) => settled.has(url)))

  useEffect(() => {
    if (ready) return
    let cancelled = false
    void preloadAssets(urls).then(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [urls, ready])

  return ready
}
