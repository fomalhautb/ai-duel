/**
 * 存放"当前这一局"的 driver，让它跨得过路由切换。
 *
 * 联机和 dev 测试房都是在别的页面建好 driver 再跳到 /match：
 * 联机在房间页建，测试房在首页或房间页建。跳转会把建 driver 的那个页面整个卸载掉，
 * driver 不放在路由之上就没了。
 *
 * Provider 挂在 Router 外面，所以刷新页面 = 这局没了——
 * 这和架构文档"不存对局"是一致的，/match 读不到 driver 就跳回首页。
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { MatchDriver } from './driver'

interface MatchSession {
  driver: MatchDriver | null
  /**
   * 这一局是不是 dev 测试房。对局界面据此摊开对方手牌、挂上测试面板，
   * 结算时也不记胜场（测试局不该刷胜场和抽卡）。
   */
  testMode: boolean
  /** 交接一个新 driver。已有的会先被清掉，避免旧连接留着不放。 */
  start(driver: MatchDriver, opts?: { test?: boolean }): void
  /** 结束当前对局并释放资源（关 socket、清定时器）。 */
  end(): void
}

const MatchSessionContext = createContext<MatchSession | null>(null)

/** driver 和 testMode 必须同进同出，所以放在一个 state 里，不拆成两个。 */
interface SessionState {
  driver: MatchDriver | null
  testMode: boolean
}

export function MatchSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ driver: null, testMode: false })

  const start = useCallback((next: MatchDriver, opts?: { test?: boolean }) => {
    setSession((current) => {
      current.driver?.dispose()
      return { driver: next, testMode: opts?.test === true }
    })
  }, [])

  const end = useCallback(() => {
    setSession((current) => {
      current.driver?.dispose()
      return { driver: null, testMode: false }
    })
  }, [])

  const value = useMemo<MatchSession>(
    () => ({ driver: session.driver, testMode: session.testMode, start, end }),
    [session, start, end],
  )
  return <MatchSessionContext value={value}>{children}</MatchSessionContext>
}

export function useMatchSession(): MatchSession {
  const session = useContext(MatchSessionContext)
  if (!session) throw new Error('useMatchSession 必须在 MatchSessionProvider 里用')
  return session
}
