/**
 * 新手教程的教学对战页。
 *
 * 刻意**不走 MatchScreen**：那条路径会给胜局记胜场（recordWin），
 * 而教学局是一段写死结局的剧本，记进存档等于白送一场胜利。
 * 除此之外画面完全是同一个 MatchStage——教程只是多挂了一个 tutorial prop 和一层引导。
 *
 * driver 也不进 MatchSession：教程自己起、自己收，不用跨路由传递，
 * 也就不会和联机 / 测试房那一局互相顶掉。
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { createTutorialDriver } from '../match/tutorialDriver'
import type { TutorialDriver } from '../match/tutorialDriver'
import { useTutorialController } from '../tutorial/TutorialController'
import { TutorialOverlay } from '../tutorial/TutorialOverlay'
import { MatchStage } from '../ui/MatchStage'
import { PlaqueButton } from '../ui/PlaqueButton'
import { LoadingScreen } from '../ui/LoadingScreen'
import { BATTLE_ASSETS } from '../ui/backgroundPreload'
import { useAssetsReady } from '../ui/preloadAssets'

export function TutorialScreen() {
  /**
   * driver 在 effect 里建、在 effect 的清理里收，**不放在 ref 或惰性 state 里**。
   *
   * 理由是 StrictMode：开发模式下 React 会「挂载 → 卸载 → 再挂载」跑一遍，
   * 在渲染期建、在清理里 dispose 的写法，第二次挂载拿到的就是一个已经被 dispose 的 driver，
   * 整局再也推不动。写成"清理里 dispose 并置空、effect 里重建"之后，
   * 第二次挂载会新开一局，行为和生产模式一致。
   * 开局事件在 driver 里攒着，等 MatchStage 订阅上来再补发（见 driver.ts），所以晚一帧建不会漏。
   */
  const [driver, setDriver] = useState<TutorialDriver | null>(null)
  useEffect(() => {
    const next = createTutorialDriver()
    setDriver(next)
    return () => {
      next.dispose()
      setDriver(null)
    }
  }, [])

  // 战场背景和硬币没到位就先只画 loader，理由同 MatchScreen。
  const assetsReady = useAssetsReady(BATTLE_ASSETS)
  if (!assetsReady || driver === null) return <LoadingScreen />
  return <TutorialMatch driver={driver} />
}

/**
 * 拆成两个组件是因为控制器那一套 hook 要求 driver 已经建好，
 * 而上面那层还要在建好之前先画 loader。
 */
function TutorialMatch({ driver }: { driver: TutorialDriver }) {
  const [, navigate] = useLocation()
  const tutorial = useTutorialController(driver)

  return (
    <MatchStage
      driver={driver}
      tutorial={tutorial.stage}
      overlay={
        <TutorialOverlay
          instruction={tutorial.step.instruction}
          selectors={tutorial.highlightSelectors}
          dim={tutorial.step.dim !== false}
          active={tutorial.ready && tutorial.step.instruction !== null}
        />
      }
      resultActions={
        // 下一段教程（组牌 → 选英雄 → 完成页）还没做，先回首页。
        <PlaqueButton type="button" onClick={() => navigate('/')}>
          继续教程
        </PlaqueButton>
      }
    />
  )
}
