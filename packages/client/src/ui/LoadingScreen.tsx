/**
 * 整屏加载页：一个 CardLoader 加一行「加载中…」。
 *
 * 和 index.html 里的首屏 loader 是同一副样子（那份是这套视觉的纯 CSS 拷贝）。
 * 于是"bundle 还在下载"和"页面在等自己的图"这两段等待接得上，
 * 中间不会换一副面孔，玩家看到的是一段连续的加载。
 */

import { CardLoader } from './CardLoader'

export function LoadingScreen() {
  return (
    <div className="page-loader">
      {/* CardLoader 自己带 role="status" 和 aria-label="加载中"，
          这行字再被读一遍就重复了，所以对读屏软件藏起来。 */}
      <CardLoader />
      <p className="page-loader__text" aria-hidden="true">
        加载中…
      </p>
    </div>
  )
}
