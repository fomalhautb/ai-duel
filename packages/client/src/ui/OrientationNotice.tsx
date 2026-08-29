/**
 * 竖屏提示：请把手机横过来玩。
 *
 * 全站每一页都是 1672×941 的 16:9 死版式，整块画面再按视口等比缩放（见 ui/useStageScale.ts）。
 * 竖屏下能塞进去的就只有屏幕中间那一条，卡面小到看不清字、更别说往战场上瞄，
 * 所以竖屏不是"排版差一点"，而是根本没法玩。与其做一套只在这里用的竖屏版式，
 * 不如让玩家转个手腕——这也是绝大多数横版手游的做法。
 *
 * 判据是「竖屏 **且** 主指针是粗指针」两条都成立：
 * 只判竖屏的话，把电脑浏览器窗口拖窄成竖条的人也会被弹一脸提示，而他们本来就该自己拉宽窗口；
 * `pointer: coarse` 描述的是主要指针设备的精度，手机平板才为真，恰好是这条提示要拦的人。
 *
 * 留了一颗「仍要继续」：系统开了旋转锁定的人转多少下屏幕都不会变横，
 * 没有这个出口他们就被永久挡在门外了。关掉之后转回横屏、再转回竖屏会重新弹——
 * 这一次关闭只对"当前这一次竖屏"有效，不写存档，理由和整块提示一样：它本就该是临时的。
 */

import { useEffect, useState } from 'react'

/**
 * 竖屏 + 触屏。写成常量是为了在 SSR / 测试等没有 matchMedia 的环境里也能安全求值。
 *
 * 用 orientation 而不是自己比较宽高：宽高比要考虑地址栏伸缩、分屏、软键盘顶上来，
 * 而 orientation 由浏览器给出，这些情况它自己都算过了。
 */
const PORTRAIT_TOUCH_QUERY = '(orientation: portrait) and (pointer: coarse)'

export function OrientationNotice() {
  // 初值恒为 false、进 effect 再判：首帧不弹，免得它抢在页面淡入之前先糊在屏幕上。
  const [portrait, setPortrait] = useState(false)
  /** 玩家按过「仍要继续」。转回横屏时清掉（见下面 apply）。 */
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(PORTRAIT_TOUCH_QUERY)
    const apply = () => {
      setPortrait(query.matches)
      // 离开竖屏就把"仍要继续"忘掉：下一次转回竖屏是新的一次，该重新提示。
      if (!query.matches) setDismissed(false)
    }
    apply()
    query.addEventListener('change', apply)
    // resize 这一路不是多余的：媒体查询的 change 事件在"转屏"这件事上并不可靠
    // （实测 Chrome 的设备模拟改视口时就一次都不发，iOS Safari 上也有过同类问题），
    // 而转屏必然伴随一次 resize。两条都接，谁先到都行——apply 写的是同一个值，
    // React 遇到相同的 state 会直接跳过重渲染，多调几次不花钱。
    window.addEventListener('resize', apply)
    return () => {
      query.removeEventListener('change', apply)
      window.removeEventListener('resize', apply)
    }
  }, [])

  if (!portrait || dismissed) return null

  return (
    <div className="rotate-notice" role="dialog" aria-modal="true" aria-labelledby="rotate-notice-title">
      <div className="rotate-notice__panel grain">
        {/* 一部正在转成横屏的手机。纯装饰，朗读器跳过；动效由 CSS 负责，
            开了"减少动效"就停在倾斜的那一帧（见 styles.css）。 */}
        <svg className="rotate-notice__icon" viewBox="0 0 64 64" aria-hidden="true">
          <rect x="22" y="6" width="20" height="52" rx="4" />
          <line x1="28" y1="12" x2="36" y2="12" />
          <circle cx="32" cy="51" r="1.8" />
        </svg>
        <h2 className="rotate-notice__title" id="rotate-notice-title">
          请横屏游玩
        </h2>
        <p className="rotate-notice__text">把手机横过来，画面会自动铺满。</p>
        <button type="button" className="rotate-notice__skip" onClick={() => setDismissed(true)}>
          仍要继续
        </button>
      </div>
    </div>
  )
}
