/**
 * 新手教程的整条流程：教学开始页 → 教学对战 → 过渡提示 → 组牌教学 → 选英雄教学 → 完成页。
 *
 * 全在 `/tutorial` 这一条路由里按 phase 换画面，做法和 RoomScreen 内嵌
 * DeckScreen / HeroScreen 那一套一样：换路由就要重建教程状态，而这条流程是一段连贯的引导，
 * 中途被打散会丢掉"打完这局的比分"这类跨阶段的东西。
 *
 * 教学对战那一屏刻意**不走 MatchScreen**：那条路径会给胜局记胜场（recordWin），
 * 而教学局是一段写死结局的剧本，记进存档等于白送一场胜利。
 * 除此之外画面完全是同一个 MatchStage——教程只是多挂了一个 tutorial prop 和一层引导。
 *
 * driver 也不进 MatchSession：教程自己起、自己收，不用跨路由传递，
 * 也就不会和联机 / 测试房那一局互相顶掉。
 */

import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { createTutorialDriver } from '../match/tutorialDriver'
import type { TutorialDriver } from '../match/tutorialDriver'
import { useMatch } from '../match/useMatch'
import { markTutorialDone } from '../save/save'
import { useTutorialController } from '../tutorial/TutorialController'
import { TutorialDeckStage } from '../tutorial/TutorialDeckStage'
import { TutorialHeroStage } from '../tutorial/TutorialHeroStage'
import { TutorialIntro } from '../tutorial/TutorialIntro'
import { TutorialOverlay } from '../tutorial/TutorialOverlay'
import { TutorialComplete, TutorialInterlude } from '../tutorial/TutorialOutro'
import type { TutorialScore } from '../tutorial/TutorialOutro'
import { TutorialSkip } from '../tutorial/TutorialSkip'
import { TUTORIAL_FOE_SEAT, TUTORIAL_PLAYER_SEAT } from '../tutorial/content'
import { MatchStage } from '../ui/MatchStage'
import { MuteButton } from '../ui/MuteButton'
import { PlaqueButton } from '../ui/PlaqueButton'
import { LoadingScreen } from '../ui/LoadingScreen'
import { BATTLE_ASSETS } from '../ui/backgroundPreload'
import { useBackgroundMusic } from '../ui/backgroundMusic'
import { useAssetsProgress } from '../ui/preloadAssets'

/**
 * 教程现在演到哪一屏。顺序就是流程顺序，只往前走，没有回退。
 * 和 tutorial/steps.ts 那张步骤表是两回事：那张表只管教学对战内部的二十来步。
 */
type Phase = 'intro' | 'match' | 'interlude' | 'deck' | 'hero' | 'complete'

/** 教学对战没打完就跳过时给完成页兜的比分。正常走完会被真实比分覆盖。 */
const UNPLAYED_SCORE: TutorialScore = { mine: 0, foe: 0 }

export function TutorialScreen() {
  // 教程整条流程与匹配房共用同一曲目和全局音量，跨阶段不切歌。
  useBackgroundMusic('room')
  const [, navigate] = useLocation()
  const [phase, setPhase] = useState<Phase>('intro')
  /** 教学对战的最终比分，完成页要显示（脚本正常走完是 3:0）。 */
  const [score, setScore] = useState<TutorialScore>(UNPLAYED_SCORE)

  /** 跳过 = 记一笔"教程不用再自动放了"，然后直接进匹配房。 */
  const skip = useCallback(() => {
    markTutorialDone()
    navigate('/room')
  }, [navigate])

  if (phase === 'complete') {
    // 完成页不再显示「跳过教程」：这时候已经没有东西可跳了。
    return <TutorialComplete score={score} onStart={() => navigate('/room')} />
  }

  return (
    <>
      {phase === 'intro' ? (
        <TutorialIntro onStart={() => setPhase('match')} />
      ) : phase === 'match' ? (
        <TutorialMatchPhase
          onSkip={skip}
          onFinished={(finalScore) => {
            setScore(finalScore)
            setPhase('interlude')
          }}
        />
      ) : phase === 'interlude' ? (
        <TutorialInterlude onNext={() => setPhase('deck')} />
      ) : phase === 'deck' ? (
        <TutorialDeckStage onDone={() => setPhase('hero')} />
      ) : (
        <TutorialHeroStage onDone={() => setPhase('complete')} />
      )}
      {/* 对战屏的跳过钮画在顶栏里（往下传给 TutorialMatchPhase），不在这儿挂第二颗：
          顶栏右上角已经有静音钮，再悬一颗视口固定的按钮会正好叠在它上面。 */}
      {phase === 'match' ? null : <TutorialSkip onSkip={skip} />}
    </>
  )
}

/** 教学对战那一屏。拆出来是为了让 driver 跟着这一屏一起建、一起收。 */
function TutorialMatchPhase({
  onFinished,
  onSkip,
}: {
  onFinished: (score: TutorialScore) => void
  onSkip: () => void
}) {
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

  // 场地和卡面没到位就先只画 loader，理由同 MatchScreen。
  const assets = useAssetsProgress(BATTLE_ASSETS)
  if (!assets.ready || driver === null) return <LoadingScreen progress={assets.progress} />
  return <TutorialMatch driver={driver} onFinished={onFinished} onSkip={onSkip} />
}

/**
 * 拆成两个组件是因为控制器那一套 hook 要求 driver 已经建好，
 * 而上面那层还要在建好之前先画 loader。
 */
function TutorialMatch({
  driver,
  onFinished,
  onSkip,
}: {
  driver: TutorialDriver
  onFinished: (score: TutorialScore) => void
  onSkip: () => void
}) {
  const tutorial = useTutorialController(driver)
  /**
   * 比分只在按「继续教程」那一刻读一次。
   *
   * 走这条订阅（而不是让控制器把 view 转出来）是因为 useMatch 是 useSyncExternalStore，
   * 同一个 driver 订阅几次都读的是同一份快照，多这一条不会有第二套状态。
   */
  const view = useMatch(driver)

  return (
    <MatchStage
      driver={driver}
      tutorial={tutorial.stage}
      // 教程不给「离开」图标：这一屏的出口是同一格里的「跳过教程」。
      topBarActions={
        <>
          <MuteButton variant="plain" className="battle-topbar__icon" />
          <TutorialSkip onSkip={onSkip} className="tutorial-skip--inbar" />
        </>
      }
      overlay={
        <TutorialOverlay
          instruction={tutorial.step.instruction}
          selectors={tutorial.highlightSelectors}
          dim={tutorial.step.dim !== false}
          active={tutorial.ready && tutorial.step.instruction !== null}
          // 纯讲解的步骤等玩家点一下才走；要玩家出牌 / 等演出的那些步不传，界面照常操作。
          onNext={tutorial.awaitingTap ? tutorial.notifyTap : null}
        />
      }
      resultActions={
        <PlaqueButton
          type="button"
          onClick={() =>
            onFinished({
              // 局面理论上一定在（结算面板是靠它画出来的），取不到就按 0:0 交出去，
              // 总好过为一个不该发生的分支把整条流程卡在结算页上。
              mine: view.state?.players[TUTORIAL_PLAYER_SEAT].score ?? 0,
              foe: view.state?.players[TUTORIAL_FOE_SEAT].score ?? 0,
            })
          }
        >
          继续教程
        </PlaqueButton>
      }
    />
  )
}
