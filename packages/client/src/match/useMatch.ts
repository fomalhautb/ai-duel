/**
 * 把 MatchDriver 接进 React。
 *
 * 用 useSyncExternalStore 而不是自己 useState + useEffect：
 * driver 是 React 之外的可变数据源，这个 hook 是 React 官方为这种场景准备的，
 * 也顺带解决了并发渲染下读到半新半旧状态的问题。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { GameEvent } from '@ai-duel/core'
import type { MatchDriver, MatchView } from './driver'

export function useMatch(driver: MatchDriver): MatchView {
  return useSyncExternalStore(driver.subscribe, driver.getSnapshot)
}

/**
 * 订阅事件流，给动画层用。
 *
 * handler 存在 ref 里，所以它每次渲染换新函数也不会导致重新订阅——
 * 重新订阅会丢掉 driver 攒着的那批开局事件（见 createDriverCore 的说明）。
 */
export function useMatchEvents(
  driver: MatchDriver,
  handler: (events: GameEvent[]) => void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    return driver.subscribeEvents((events) => handlerRef.current(events))
  }, [driver])
}
