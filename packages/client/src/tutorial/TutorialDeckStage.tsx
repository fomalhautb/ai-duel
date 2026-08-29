/**
 * 新手教程的组牌一步（规格 §12）。
 *
 * 这一层只做三件事：进页面前把预填的 17 张写进牌组存档、按 deckSteps.ts 那张表推进引导、
 * 把「现在放行哪张卡」交给 DeckScreen。页面本身还是那个 DeckScreen，
 * 教学结束后玩家在 /deck 看到的就是这套刚组好的牌组。
 */

import { useEffect, useRef, useState } from 'react'
import { DeckScreen } from '../screens/DeckScreen'
import { putDeck } from '../save/deckStore'
import { battleStageMetrics } from '../ui/battleStage'
import { TutorialBlockTip, useBlockTip } from './TutorialBlockTip'
import { TutorialOverlay } from './TutorialOverlay'
import {
  DECK_FIRST_STEP,
  TUTORIAL_DECK_ID,
  TUTORIAL_DECK_NAME,
  deckBlockTip,
  deckSelectorOf,
  deckStep,
  tutorialDeckPrefill,
} from './deckSteps'
import type { DeckStepId } from './deckSteps'

export function TutorialDeckStage({ onDone }: { onDone: () => void }) {
  /*
   * 预填必须在 DeckScreen 挂载**之前**落盘：那一页的编辑态是在自己的 useState 初始化里
   * 从 deckStore 读当前牌组的，晚一步就会先渲染出一套空牌组。
   * 所以这一步写在渲染期而不是 effect 里，用一个 ref 保证同一个实例只写一次
   * （StrictMode 会把渲染跑两遍）。putDeck 本身按固定 id 覆盖，重玩教程也不会堆出一堆牌组。
   */
  const seededRef = useRef(false)
  if (!seededRef.current) {
    seededRef.current = true
    putDeck(TUTORIAL_DECK_ID, TUTORIAL_DECK_NAME, tutorialDeckPrefill())
  }

  const [stepId, setStepId] = useState<DeckStepId>(DECK_FIRST_STEP)
  const step = deckStep(stepId)
  const { tip, notify } = useBlockTip()

  // 开场那句只靠计时往下走；其余几步等玩家把指定的牌加进去（见下面 onCardAdded）。
  useEffect(() => {
    const current = deckStep(stepId)
    if (current.advanceAfterMs === undefined || current.next === null) return
    const next = current.next
    const timer = setTimeout(() => setStepId(next), current.advanceAfterMs)
    return () => clearTimeout(timer)
  }, [stepId])

  const selectors = step.highlight.map(deckSelectorOf)

  /*
   * 把要点的那张卡滚到卡池网格正中。
   *
   * 卡池自己会滚（.deck-grid），20 张牌一屏未必摆得下，而引导圈是按元素实际位置画的
   * ——目标滚出去了，圈就画在网格外面的空处。
   *
   * 只动网格自己的 scrollTop，**不用 scrollIntoView**：那个会把每一级可滚祖先都滚一遍，
   * 窗口矮一点时连整个文档都会被顶上去，整页的顶栏就跑出画面了。
   * 摆正中而不是贴边：引导圈比卡本身大一圈，提示气泡还要贴着它放，贴边会被裁掉一角。
   *
   * rect 是视口坐标、scrollTop 是舞台内坐标，中间差一个舞台缩放，所以要过一次换算
   * （口径见 ui/battleStage.ts）。等一帧再滚：这一步刚切进来，React 还没把新的高亮提交上去。
   */
  useEffect(() => {
    const target = deckStep(stepId).highlight.find((item) => item.kind === 'poolCard')
    if (target === undefined) return
    const handle = requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(deckSelectorOf(target))
      const grid = node?.closest<HTMLElement>('.deck-grid')
      if (node === null || grid === null || grid === undefined) return
      const { scale } = battleStageMetrics()
      const offset = (node.getBoundingClientRect().top - grid.getBoundingClientRect().top) / scale
      const cardHeight = node.getBoundingClientRect().height / scale
      grid.scrollTo({
        top: grid.scrollTop + offset - (grid.clientHeight - cardHeight) / 2,
        behavior: 'smooth',
      })
    })
    return () => cancelAnimationFrame(handle)
  }, [stepId])

  return (
    <DeckScreen
      // 牌组每加一张就自己写进 deckStore 了，这里只管往下一步走。
      onConfirm={onDone}
      tutorial={{
        allowedCardId: step.allowedCardId,
        allowConfirm: step.allowConfirm,
        blockTip: deckBlockTip(step),
        onBlocked: notify,
        onCardAdded: (cardId) => {
          // 只有当前这一步点名的那张才推进。DeckScreen 已经挡过一道，这里是第二道保险。
          const current = deckStep(stepId)
          if (current.allowedCardId !== cardId || current.next === null) return
          setStepId(current.next)
        },
      }}
      overlay={
        <>
          <TutorialOverlay
            instruction={step.instruction}
            selectors={selectors}
            dim
            active
          />
          <TutorialBlockTip tip={tip} />
        </>
      }
    />
  )
}
