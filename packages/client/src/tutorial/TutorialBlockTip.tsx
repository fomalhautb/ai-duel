/**
 * 「这一步不许点这个」的一句话提示。
 *
 * 组牌 / 选英雄两段教学共用：被锁住的操作点上去必须有话说，
 * 否则玩家只会觉得界面坏了（规格 §15 把这两页的操作限制写死了，但没说可以没反应）。
 *
 * 和引导层的提示气泡分开是有意的：那一句说的是"现在该做什么"，一直挂着；
 * 这一句说的是"刚才那一下不行"，说完就消失，两者同时出现也不该互相顶替。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import './tutorial.css'

/** 一句提示显示多久。够读完一句短话，又短到玩家不会以为它是常驻的。 */
const TIP_MS = 2200

export interface BlockTipHandle {
  /** 当前要显示的那句话；null = 不显示。 */
  tip: string | null
  /** 弹一句话。同一句话连点也会重新计时（key 跟着变，动画重播一遍）。 */
  notify: (message: string) => void
}

export function useBlockTip(): BlockTipHandle {
  const [tip, setTip] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载时把还挂着的定时器收掉，免得它落在已经卸载的组件上。
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  const notify = useCallback((message: string) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    setTip(message)
    timerRef.current = setTimeout(() => {
      setTip(null)
      timerRef.current = null
    }, TIP_MS)
  }, [])

  return { tip, notify }
}

/**
 * 提示本体。摆在舞台顶部居中，压在引导层同一档层级上。
 *
 * `role="status"` 让读屏也念得到——这句话是操作被拒的唯一反馈。
 */
export function TutorialBlockTip({ tip }: { tip: string | null }) {
  if (tip === null) return null
  return (
    <p className="tutorial-block-tip" role="status">
      {tip}
    </p>
  )
}
