/**
 * 整屏加载页：一个 CardLoader、一行「加载中…」和一条素材加载进度条。
 *
 * 和 index.html 里的首屏 loader 是同一副样子（那份是这套视觉的纯 CSS 拷贝）。
 * 于是"bundle 还在下载"和"页面在等自己的图"这两段等待接得上，
 * 中间不会换一副面孔，玩家看到的是一段连续的加载。
 * 进度条只有这一份有：首屏那段还没有 JS，数不出下了几张图。
 */

import { CardLoader } from './CardLoader'

interface LoadingScreenProps {
  /**
   * 0~1 的素材加载进度（见 ui/preloadAssets.ts 的 useAssetsProgress）。
   * 不传就不画进度条——给那些"在等的不是图"的地方用（比如教程页还在建 driver）。
   */
  progress?: number
}

export function LoadingScreen({ progress }: LoadingScreenProps) {
  // 只取整不四舍五入：99.6% 显示成 100% 但画面还没换，看着像卡住了。
  const percent = progress === undefined ? undefined : Math.floor(clamp01(progress) * 100)

  return (
    <div className="page-loader">
      {/* CardLoader 自己带 role="status" 和 aria-label="加载中"，
          这行字再被读一遍就重复了，所以对读屏软件藏起来。 */}
      <CardLoader />
      <p className="page-loader__text" aria-hidden="true">
        加载中…{percent === undefined ? '' : ` ${percent}%`}
      </p>
      {percent !== undefined && (
        <div
          className="page-loader__bar"
          role="progressbar"
          aria-label="素材加载进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="page-loader__bar-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  )
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
