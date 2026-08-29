/**
 * 触屏设备提示：这游戏还没为触屏做过适配，进来先说一声。
 *
 * 判据只用 `(pointer: coarse)`，不看 navigator.maxTouchPoints：
 * 现在的笔记本很多带触摸屏，maxTouchPoints 大于 0，但主指针仍是触控板或鼠标，
 * 拿它当判据会把这批人一起弹窗。`pointer: coarse` 描述的是**主要**指针设备的精度，
 * 手机平板才为真，恰好是这条提示想拦的人。
 *
 * 每次加载都判一次，不写 localStorage：提示只有一句话、一个按钮，
 * 记住反而要多一份存储和"怎么清掉"的问题，而它本来就不该长期存在
 *（等真做了触屏适配，整个组件直接删掉）。
 */

import { useEffect, useState } from 'react'
import { HandDrawnFilterDefs } from './HandDrawnFilterDefs'
import { PlaqueButton } from './PlaqueButton'

/** 触屏判据。写成常量是为了在 SSR / 测试等没有 matchMedia 的环境里也能安全求值。 */
const COARSE_POINTER_QUERY = '(pointer: coarse)'

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COARSE_POINTER_QUERY).matches
}

export function TouchDeviceNotice() {
  // 初值恒为 false、进 effect 再判：首帧不弹窗，避免它抢在首页淡入之前先糊在屏幕上。
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isCoarsePointer()) setVisible(true)
  }, [])

  if (!visible) return null

  return (
    <div className="touch-notice" role="dialog" aria-modal="true" aria-labelledby="touch-notice-title">
      {/* 「确认」用的是匾额按钮，它的描边靠这几条手绘滤镜。这里自己挂一份：
          提示可能出现在任何一页，而 /hero、/room 这些页面并没有渲染滤镜定义。
          和别处那份重复也没关系：id 相同、内容也完全相同，浏览器认先出现的那个。 */}
      <HandDrawnFilterDefs />
      <div className="touch-notice__panel grain">
        <h2 className="touch-notice__title" id="touch-notice-title">
          提示
        </h2>
        <p className="touch-notice__text">
          本游戏目前尚未针对触屏设备进行优化，推荐使用鼠标进行游玩。
        </p>
        <PlaqueButton className="touch-notice__ok" onClick={() => setVisible(false)}>
          确认
        </PlaqueButton>
      </div>
    </div>
  )
}
