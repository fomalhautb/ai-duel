/**
 * 对局界面。
 *
 * driver 是房间页（或 dev 测试房入口）建好之后放进 MatchSession 的——
 * 放在路由之上才跨得过那次跳转。直接刷新 /match 会读不到 driver（这局本来就不存盘），
 * 这时跳回首页。
 */

import { useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { useMatchSession } from '../match/MatchSession'
import { useMatch } from '../match/useMatch'
import type { MatchDriver } from '../match/driver'
import { MatchStage } from '../ui/MatchStage'
import { DevPanel } from '../dev/DevPanel'
import { recordWin } from '../save/save'

export function MatchScreen() {
  const [, navigate] = useLocation()
  const { driver, testMode } = useMatchSession()

  useEffect(() => {
    if (!driver) navigate('/', { replace: true })
  }, [driver, navigate])

  if (!driver) return null
  return <Match driver={driver} testMode={testMode} />
}

function Match({ driver, testMode }: { driver: MatchDriver; testMode: boolean }) {
  const [, navigate] = useLocation()
  const { end } = useMatchSession()
  const view = useMatch(driver)
  /** 一局只记一次胜场，否则结算界面每重渲染一次就多抽一张卡。 */
  const recorded = useRef(false)

  // 测试局不记胜场：那是随手摆出来的局面，不该刷胜场和抽卡。
  // winner 还可能是 'draw'（总分打平）或 null（没打完），两种都不是胜利，
  // 所以这里判的是"和本方座位号相等"，不是"不等于对方"。
  const won = !testMode && view.status === 'finished' && view.state?.winner === view.seat
  useEffect(() => {
    if (!won || recorded.current) return
    recorded.current = true
    recordWin()
  }, [won])

  function leave(to: string): void {
    end()
    navigate(to)
  }

  return (
    <>
      <MatchStage
        driver={driver}
        testMode={testMode}
        resultActions={
          <>
            <button type="button" onClick={() => leave('/room')}>
              再来一局
            </button>
            <button type="button" onClick={() => leave('/')}>
              回首页
            </button>
          </>
        }
      />
      {testMode ? <DevPanel driver={driver} /> : null}
    </>
  )
}
