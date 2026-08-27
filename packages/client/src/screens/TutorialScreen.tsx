/**
 * 教程关卡：一局本地对局 + 一层分步引导。
 *
 * 对手按关卡脚本出牌（tutorialDriver），玩家这边由引导锁死——
 * 每一步只有 restriction 指定的那一个动作能点。两头都定死，整局就是一段固定剧本。
 * 引导步骤全部走完即通关，不另设胜利条件。
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import type { CardId } from '@ai-duel/core'
import { getCard } from '@ai-duel/core'
import { createTutorialDriver } from '../match/tutorialDriver'
import { useMatch } from '../match/useMatch'
import type { MatchDriver } from '../match/driver'
import { MatchStage } from '../ui/MatchStage'
import type { StageRestriction, StageTarget } from '../ui/MatchStage'
import { getTutorialLevel, TUTORIAL_LEVEL_COUNT } from '../tutorial/levels'
import type { ScriptTarget, TutorialAction } from '../tutorial/levels'
import { completeTutorialLevel } from '../save/save'

export function TutorialScreen({ level: levelNumber }: { level: number }) {
  const [, navigate] = useLocation()
  const level = getTutorialLevel(levelNumber)

  // driver 在 effect 里建、在 cleanup 里销毁。
  // 不用 useState 的惰性初始化，是因为严格模式会把初始化函数跑两遍，
  // 多出来的那个 driver 没人 dispose，它的定时器会一直去推进一局没人看的对局。
  const [driver, setDriver] = useState<MatchDriver | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [reward, setReward] = useState<{ drawn: CardId | null } | null>(null)
  const rewarded = useRef(false)

  useEffect(() => {
    if (!level) return
    setStepIndex(0)
    setReward(null)
    rewarded.current = false
    const created = createTutorialDriver(level)
    setDriver(created)
    return () => {
      created.dispose()
      setDriver(null)
    }
  }, [level])

  const done = level !== null && stepIndex >= level.steps.length

  useEffect(() => {
    if (!done || !level || rewarded.current) return
    rewarded.current = true
    setReward(completeTutorialLevel(level.level))
  }, [done, level])

  if (!level) {
    return (
      <main className="page">
        <p>没有这一关。</p>
        <button type="button" onClick={() => navigate('/')}>
          回首页
        </button>
      </main>
    )
  }
  if (!driver) return <main className="page">正在准备关卡…</main>

  return (
    <TutorialBoard
      driver={driver}
      levelTitle={level.title}
      step={level.steps[stepIndex] ?? null}
      onStepDone={() => setStepIndex((index) => index + 1)}
      done={done}
      reward={reward}
      nextLevel={level.level < TUTORIAL_LEVEL_COUNT ? level.level + 1 : null}
    />
  )
}

interface TutorialBoardProps {
  driver: MatchDriver
  levelTitle: string
  step: { text: string; action: TutorialAction } | null
  onStepDone: () => void
  done: boolean
  reward: { drawn: CardId | null } | null
  nextLevel: number | null
}

function TutorialBoard({
  driver,
  levelTitle,
  step,
  onStepDone,
  done,
  reward,
  nextLevel,
}: TutorialBoardProps) {
  const [, navigate] = useLocation()
  const view = useMatch(driver)
  const myTurn = view.state !== null && view.state.activePlayer === view.seat

  // 不是自己的回合时把界面全锁上：对手正在按脚本出牌，这时候玩家点什么都会被引擎拒。
  const restriction: StageRestriction =
    !myTurn || step === null ? { kind: 'none' } : toRestriction(step.action)

  return (
    <>
      <MatchStage
        driver={driver}
        restriction={restriction}
        onActionDone={onStepDone}
        banner={<span className="stage-hud__level">{levelTitle}</span>}
        resultActions={
          <button type="button" onClick={() => navigate('/')}>
            回首页
          </button>
        }
        overlay={
          done ? null : (
            <div className="guide">
              <p className="guide__text">{myTurn ? (step?.text ?? '') : '对手行动中…'}</p>
              {myTurn && step?.action.kind === 'continue' ? (
                <button type="button" className="guide__next" onClick={onStepDone}>
                  继续
                </button>
              ) : null}
            </div>
          )
        }
      />

      {done ? (
        <div className="stage-result">
          <p className="stage-result__title">{levelTitle} 通关</p>
          {reward ? (
            <p>
              {reward.drawn === null
                ? '所有卡牌都已收集齐了。'
                : `解锁新卡：${getCard(reward.drawn).name}`}
            </p>
          ) : null}
          <div className="stage-actions">
            {nextLevel === null ? (
              <button type="button" onClick={() => navigate('/room')}>
                进入匹配房
              </button>
            ) : (
              <button type="button" onClick={() => navigate(`/tutorial/${nextLevel}`)}>
                下一关
              </button>
            )}
            <button type="button" onClick={() => navigate('/')}>
              回首页
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

function toRestriction(action: TutorialAction): StageRestriction {
  switch (action.kind) {
    case 'continue':
      return { kind: 'none' }
    case 'end-turn':
      return { kind: 'end-turn' }
    case 'play':
      return { kind: 'play', cardId: action.cardId, target: toStageTarget(action.target) }
  }
}

function toStageTarget(target: ScriptTarget | undefined): StageTarget | undefined {
  if (!target) return undefined
  return target.kind === 'face' ? 'face' : { modelCardId: target.cardId }
}
