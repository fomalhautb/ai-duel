/**
 * 存放"当前这一局"的 driver，让它跨得过路由切换。
 *
 * 只有联机流程需要它：房间页建好 driver 之后要跳到 /match，
 * 而跳转会把房间页整个卸载掉，driver 不放在路由之上就没了。
 * 教程页自己建 driver、自己用，不经过这里。
 *
 * Provider 挂在 Router 外面，所以刷新页面 = 这局没了——
 * 这和架构文档"不存对局"是一致的，/match 读不到 driver 就跳回首页。
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { MatchDriver } from './driver'

interface MatchSession {
  driver: MatchDriver | null
  /** 交接一个新 driver。已有的会先被清掉，避免旧连接留着不放。 */
  start(driver: MatchDriver): void
  /** 结束当前对局并释放资源（关 socket、清定时器）。 */
  end(): void
}

const MatchSessionContext = createContext<MatchSession | null>(null)

export function MatchSessionProvider({ children }: { children: ReactNode }) {
  const [driver, setDriver] = useState<MatchDriver | null>(null)

  const start = useCallback((next: MatchDriver) => {
    setDriver((current) => {
      current?.dispose()
      return next
    })
  }, [])

  const end = useCallback(() => {
    setDriver((current) => {
      current?.dispose()
      return null
    })
  }, [])

  const value = useMemo<MatchSession>(() => ({ driver, start, end }), [driver, start, end])
  return <MatchSessionContext value={value}>{children}</MatchSessionContext>
}

export function useMatchSession(): MatchSession {
  const session = useContext(MatchSessionContext)
  if (!session) throw new Error('useMatchSession 必须在 MatchSessionProvider 里用')
  return session
}
