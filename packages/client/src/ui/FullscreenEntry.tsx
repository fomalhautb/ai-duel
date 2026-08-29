/**
 * 常驻的全屏入口：画面边上那颗小按钮，以及 iOS 专用的「添加到主屏幕」三步引导。
 *
 * 为什么需要它：全站是 1672×941 的 16:9 死版式再整体等比缩放（见 ui/useStageScale.ts），
 * 手机浏览器的地址栏和底栏吃掉的正是高度，而 16:9 的舞台在横屏手机上恰好被高度卡住——
 * 少一条栏，整块画面就大一圈。原来劝这件事的只有对局开场那一层（ui/FullscreenPrompt.tsx），
 * 弹一次、能永久跳过，跳过之后就再也没有入口了；而 iPhone 上它连出现都不会出现。
 *
 * 两条分叉，判据是浏览器给不给整页全屏（canGoFullscreen，纯特性检测，不看 UA）：
 * - 给（安卓 Chrome 等）：按钮点下去当场进全屏并锁横屏，一步到位。
 * - 不给（iPhone / iPad 的 Safari 和 Chrome，iOS 上都是同一个 WebKit）：
 *   网页这条路是死的，唯一能去掉地址栏的办法是把站点加到主屏幕、再从图标启动
 *   （所需的 manifest 和 apple- 系 meta 在 index.html 里），所以按钮点下去弹的是那份三步引导。
 *
 * 什么时候整个组件都不出现：桌面（细指针，人家有 F11）、已经在全屏里、
 * 以及已经从主屏幕图标启动——那时地址栏本来就没了，再劝就是骚扰。
 *
 * 引导第一次会自己弹一次（只在 iOS 那条分叉上），关掉后记进 localStorage 不再自动弹，
 * 但边上那颗按钮一直在，随时可以再看一遍。
 */

import { useEffect, useState } from 'react'
import {
  canGoFullscreen,
  enterLandscapeFullscreen,
  isCoarsePointer,
  isFullscreen,
  isStandalone,
  onFullscreenChange,
} from './fullscreen'

/** 自动弹过一次引导的存档位。存在即代表别再自动弹，值本身没有意义。 */
const GUIDE_SEEN_KEY = 'ai-duel.pwaGuideSeen'

/**
 * 读写都吞异常：隐私模式、站点数据被禁的浏览器上 localStorage 光是碰一下就抛，
 * 而这里存的只是一句"别再自动弹了"，丢了最多是下次进站再弹一次，不值得把整页带崩。
 */
function isGuideSeen(): boolean {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) !== null
  } catch {
    return false
  }
}

function rememberGuideSeen(): void {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, '1')
  } catch {
    // 存不下就算了，下次进站会再弹一次。
  }
}

export function FullscreenEntry() {
  /** 初值恒为 false、进 effect 再判：首帧不显示，免得按钮和引导抢在页面淡入之前先糊在屏幕上。 */
  const [enabled, setEnabled] = useState(false)
  /** 浏览器支持什么是一开始就定死的，只算一次。 */
  const [canFullscreen] = useState(canGoFullscreen)
  /** 当前在不在全屏。进了全屏就该收起入口（此时按钮的活已经干完了）。 */
  const [fullscreen, setFullscreen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    // 已经从主屏幕启动的，地址栏本来就没了，整组件收工。
    if (!isCoarsePointer() || isStandalone()) return
    setEnabled(true)
    setFullscreen(isFullscreen())
    // 订阅而不是只在按钮回调里记：玩家也可能走浏览器自己的全屏入口。
    return onFullscreenChange(() => setFullscreen(isFullscreen()))
  }, [])

  useEffect(() => {
    if (!enabled || canFullscreen || isGuideSeen()) return
    // 等页面自己的资源下完再弹：这之前屏幕上还是首屏 loader（见 index.html），
    // 引导糊在 loader 上既看不出是哪个站点的，也挡着玩家看加载进度。
    if (document.readyState === 'complete') {
      setGuideOpen(true)
      return
    }
    const open = () => setGuideOpen(true)
    window.addEventListener('load', open, { once: true })
    return () => window.removeEventListener('load', open)
  }, [enabled, canFullscreen])

  if (!enabled || fullscreen) return null

  return (
    <>
      {/* 引导开着的时候不画这颗：它比引导低一档，会隔着那层半透明的黑底透出来，
          像一颗按不动的按钮。
          另外视口正好是 16:9 时舞台铺满、边上没有留白，那时它也会压在画面上，
          这一种由 CSS 藏（见 styles.css 的 .fs-corner）。 */}
      {!guideOpen && (
        <button
          type="button"
          className="fs-corner"
          aria-label={canFullscreen ? '进入全屏' : '如何全屏'}
          // 能真全屏的设备上必须在这个点击回调里同步发起：全屏和方向锁都只认用户手势。
          onClick={() => {
            if (canFullscreen) void enterLandscapeFullscreen()
            else setGuideOpen(true)
          }}
        >
          {/* 四个折角，全屏的通用图标。纯装饰，朗读器读上面的 aria-label。 */}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      )}
      {guideOpen && (
        <PwaGuide
          onClose={() => {
            rememberGuideSeen()
            setGuideOpen(false)
          }}
        />
      )}
    </>
  )
}

/**
 * iOS 的「添加到主屏幕」三步引导。
 *
 * 为什么写死三步而不做成通用文案：走到这里的只有 iOS——安卓那条分叉在上面就直接进全屏了，
 * 而 iOS 上不管用的是 Safari 还是 Chrome，底下都是同一个 WebKit，操作路径也就这一条。
 * 两个浏览器唯一的差别是「分享」按钮的位置，所以第一步把两处都点了出来。
 */
function PwaGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="fs-guide" role="dialog" aria-modal="true" aria-labelledby="fs-guide-title">
      <div className="fs-guide__panel grain">
        <h2 className="fs-guide__title" id="fs-guide-title">
          iPhone 上这样全屏
        </h2>
        <p className="fs-guide__text">
          iOS 的浏览器不给网页整页全屏，地址栏赶不走。把本站加到主屏幕，再从图标启动，
          地址栏和底栏就都没有了，画面和卡面上的字都会大一圈。
        </p>
        <ol className="fs-guide__steps">
          <li>
            点「分享」<ShareIcon />（Safari 在底部，Chrome 在右上角）
          </li>
          <li>在列表里往下找，选「添加到主屏幕」</li>
          <li>回桌面，从新出现的图标启动本站</li>
        </ol>
        <button type="button" className="fs-guide__close" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  )
}

/** iOS 的分享图标（方框里一支向上的箭头），画在文字行里当"就是这颗"的指认。 */
function ShareIcon() {
  return (
    <svg className="fs-guide__share" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12M12 3l-4 4M12 3l4 4" />
      <path d="M7 11H5v10h14V11h-2" />
    </svg>
  )
}
