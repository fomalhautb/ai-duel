/**
 * 对局界面。
 *
 * driver 是房间页（或 dev 测试房入口）建好之后放进 MatchSession 的——
 * 放在路由之上才跨得过那次跳转。直接刷新 /match 会读不到 driver（这局本来就不存盘），
 * 这时跳回首页。
 */

import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { useMatchSession } from '../match/MatchSession'
import { useMatch } from '../match/useMatch'
import type { MatchDriver } from '../match/driver'
import { MatchStage } from '../ui/MatchStage'
import { PlaqueButton } from '../ui/PlaqueButton'
import { DevPanel } from '../dev/DevPanel'
import { LoadingScreen } from '../ui/LoadingScreen'
import { FullscreenPrompt } from '../ui/FullscreenPrompt'
import { BATTLE_ASSETS } from '../ui/backgroundPreload'
import { useAssetsReady } from '../ui/preloadAssets'
import { recordWin } from '../save/save'
import { useBackgroundMusic } from '../ui/backgroundMusic'

// 去牌组页再返回会重建 Match 组件，结算标记必须跟随 driver，而不是组件实例。
const recordedMatches = new WeakSet<MatchDriver>()

export function MatchScreen() {
  useBackgroundMusic('match')
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
  const assetsReady = useAssetsReady(BATTLE_ASSETS)

  // 测试局不记胜场：那是随手摆出来的局面，不该刷胜场和抽卡。
  // winner 还可能是 'draw'（总分打平）或 null（没打完），两种都不是胜利，
  // 所以这里判的是"和本方座位号相等"，不是"不等于对方"。
  const won = !testMode && view.status === 'finished' && view.state?.winner === view.seat
  useEffect(() => {
    if (!won || recordedMatches.has(driver)) return
    recordedMatches.add(driver)
    recordWin()
  }, [won, driver])

  function leave(to: string): void {
    end()
    navigate(to)
  }

  /*
   * 保险闸门：战场背景和猜先硬币没到位就先只画 loader，别让玩家看着空背景开局。
   *
   * 正常情况下这一步是白给的——后台预加载（ui/backgroundPreload.ts）在玩家还看着首页时
   * 就把这三张下完了，settled 缓存让 useAssetsReady 第一帧就返回 true，loader 一眼都不会闪。
   * 它挡的是"预加载没跑完就已经开打"的边角情况：网络特别慢，或者玩家直接从链接进房间。
   *
   * 注意闸门只挡画面，不挡逻辑：上面 useMatch 已经在跑了，对局照常推进、结算照常记，
   * 图到齐了 MatchStage 直接接着当前局面画，不会漏掉这段时间的状态。
   */
  if (!assetsReady) return <LoadingScreen />

  return (
    <>
      <MatchStage
        driver={driver}
        testMode={testMode}
        resultActions={
          <>
            <PlaqueButton type="button" onClick={() => leave('/room')}>
              再来一局
            </PlaqueButton>
            <PlaqueButton type="button" onClick={() => leave('/')}>
              回首页
            </PlaqueButton>
          </>
        }
      />
      {/* 触屏进对局时劝一句全屏，自己判定要不要显示、按过「暂不」就永久不再弹。 */}
      <FullscreenPrompt />
      {testMode ? <DevPanel driver={driver} /> : null}
    </>
  )
}
