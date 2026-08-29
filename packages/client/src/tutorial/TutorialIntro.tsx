/**
 * 教程最前面的一屏：先说清楚接下来要干什么，玩家点「开始教学」才真的进教学对战。
 *
 * 加这一屏是因为直接甩进一局对战太突兀——玩家还没搭好"我在打一局教学赛"的预期，
 * 第一条引导提示就已经压上来了。这里只交代流程，不讲任何规则：
 * 规则一律留到玩家第一次需要用到时再教（规格 §2.1）。
 *
 * 不做自动跳转（和过渡提示 TutorialInterlude 不同）：那一屏玩家已经在教程里了，
 * 而这一屏是入口，要等玩家自己决定什么时候开始。
 */

import { PlaqueButton } from '../ui/PlaqueButton'
import { OrnateTitle } from '../ui/paper'
import { TutorialPaperPage } from './TutorialPaperPage'
import './tutorial.css'

export function TutorialIntro({ onStart }: { onStart: () => void }) {
  return (
    <TutorialPaperPage>
      <OrnateTitle>新手教学</OrnateTitle>
      <p className="tutorial-panel__lead">先打一局，边打边学。</p>
      <p className="tutorial-panel__text">
        牌组和英雄这局由系统代发，你只管跟着提示出牌。
        <br />
        打完之后，再学组牌和选英雄这两件正式比赛前要做的事。
      </p>
      <PlaqueButton className="tutorial-panel__cta" onClick={onStart}>
        开始教学
      </PlaqueButton>
    </TutorialPaperPage>
  )
}
