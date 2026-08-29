/**
 * 手机上的「进全屏 + 锁横屏」。
 *
 * 为什么要这件事：全站是 1672×941 的 16:9 死版式，整块画面按视口等比缩放
 *（见 useStageScale.ts）。手机浏览器的地址栏和底栏吃掉的是高度，而 16:9 的舞台
 * 在手机横屏下正好被高度卡住，少一条栏就等于整个画面大一圈。
 * 更要紧的是第二件事：**只有进了全屏，浏览器才允许 screen.orientation.lock()**。
 * 这是唯一能替玩家把画面转成横屏、并且压得过系统「竖排方向锁定」的办法——
 * 开了旋转锁定的人光转手腕是没用的（这也是 OrientationNotice 留「仍要继续」的原因）。
 *
 * 覆盖面决定了这里为什么处处降级、一处都不抛错：
 * - Android Chrome / Edge / 三星 / 国内 Chromium 内核浏览器：两样都支持。
 * - iPhone Safari：非 video 元素的全屏至今不支持，也没有 screen.orientation.lock，
 *   两个检测都会是 false，界面上不会出现任何全屏入口，玩家看到的还是原来那句「请横屏」。
 * - iPad Safari：支持全屏（16.4 起不带前缀，老版本是 webkit 前缀），没有 lock。
 * - iOS 微信等 App 内的 WKWebView：同 iPhone Safari，做不到。
 * - Android 微信（XWeb）：内核版本碎片化，能不能用只有真机说了算——
 *   所以这里一律走特性检测，不判 UA。
 */

/** 老 WebKit（iPad Safari 16.4 之前）只有带前缀的那套，类型里没有，自己补上。 */
type FullscreenTarget = HTMLElement & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void
}

type FullscreenDoc = Document & {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
}

/** 触屏设备。桌面浏览器有 F11，不需要我们插一脚，所以入口只对粗指针开放。 */
const COARSE_POINTER_QUERY = '(pointer: coarse)'

export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COARSE_POINTER_QUERY).matches
}

/**
 * 能不能把整页变全屏。
 *
 * 除了看方法在不在，还要看 fullscreenEnabled：它同时反映「浏览器支持」和
 * 「当前文档被允许全屏」（比如被别人 iframe 进去又没给 allow="fullscreen"）。
 * iPhone Safari 上这个值是 false，正是我们要的那条分叉。
 */
export function canGoFullscreen(): boolean {
  if (typeof document === 'undefined') return false
  const doc = document as FullscreenDoc
  const enabled = doc.fullscreenEnabled || doc.webkitFullscreenEnabled || false
  if (!enabled) return false
  const el = document.documentElement as FullscreenTarget
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
}

/**
 * 现在是不是全屏。
 *
 * 判的是"有没有元素处于全屏"，不是"是不是我们这一层进的全屏"：玩家可能已经按过
 * 浏览器自己的全屏入口，那时也不该再劝一遍（见 ui/FullscreenPrompt.tsx）。
 * 带前缀的那份是给 iPad Safari 16.4 之前的老 WebKit 兜底，同上面的 FullscreenTarget。
 */
export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false
  const doc = document as FullscreenDoc
  return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null
}

/**
 * 全屏状态变化的订阅。两个事件名都接：老 WebKit 只发带前缀的那个。
 * 返回退订函数。
 */
export function onFullscreenChange(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('fullscreenchange', listener)
  document.addEventListener('webkitfullscreenchange', listener)
  return () => {
    document.removeEventListener('fullscreenchange', listener)
    document.removeEventListener('webkitfullscreenchange', listener)
  }
}

/**
 * 能不能锁定横屏。
 *
 * 方法存在不等于调用会成功——桌面 Chrome 上它也在，但不在全屏里调用就直接 reject。
 * 所以这只是「值不值得把按钮显示出来」的判据，真正成不成还得看 enterLandscapeFullscreen 的结果。
 */
export function canLockLandscape(): boolean {
  if (typeof screen === 'undefined') return false
  return typeof screen.orientation?.lock === 'function'
}

/**
 * 进全屏，然后尽量锁成横屏。必须在用户手势（点击/触摸）的回调里同步调用，
 * 否则浏览器会直接拒绝。
 *
 * 全程吞掉异常：不支持、被用户拒绝、不在手势里，任何一种失败都只是"少了个锦上添花"，
 * 不该把调用方的正常流程（进房间、继续玩）带崩。
 */
export async function enterLandscapeFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return
  const el = document.documentElement as FullscreenTarget
  const request = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el)
  if (request == null) return

  try {
    // navigationUI: 'hide' 是「连浏览器自己的导航条也一起藏掉」的请求，浏览器可以不听；
    // 带前缀的老实现不认参数，多传一个也无害。
    await request({ navigationUI: 'hide' })
  } catch {
    // 进不去全屏，锁横屏也就无从谈起，直接收工。
    return
  }

  try {
    await screen.orientation?.lock?.('landscape')
  } catch {
    // 锁不上就算了：起码已经进了全屏，画面大了一圈，玩家仍然可以自己转手机。
  }
  // 不用管解锁：退出全屏时浏览器会自动把方向锁一并解掉。
}
