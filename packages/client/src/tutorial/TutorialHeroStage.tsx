/**
 * 新手教程的选英雄一步（规格 §13）。
 *
 * 两步：高亮霍珀等玩家点开她的技能详情，详情里高亮「确认英雄」等玩家按下去。
 * 确认之后英雄落盘（saveHero），和匹配流程里选英雄走的是同一条存档路径。
 */

import { useState } from 'react'
import { HeroScreen } from '../screens/HeroScreen'
import { saveHero } from '../save/save'
import { TutorialBlockTip, useBlockTip } from './TutorialBlockTip'
import { TutorialOverlay } from './TutorialOverlay'
import { HERO_BLOCK_TIP, HERO_STEPS, TUTORIAL_HERO } from './heroSteps'
import type { HeroStepId } from './heroSteps'

export function TutorialHeroStage({ onDone }: { onDone: () => void }) {
  const [stepId, setStepId] = useState<HeroStepId>('HERO_PICK')
  const step = HERO_STEPS[stepId]
  const { tip, notify } = useBlockTip()

  return (
    <HeroScreen
      // 教学局用的就是霍珀，这里把她预填成选中项：确认时交出去的正是她。
      initialHeroId={TUTORIAL_HERO}
      onConfirm={(hero) => {
        saveHero(hero)
        onDone()
      }}
      tutorial={{
        allowedHeroId: TUTORIAL_HERO,
        onBlocked: () => notify(HERO_BLOCK_TIP),
        // 玩家在详情里点「返回」或按 ESC 会退回第一步，不会卡在一句对不上画面的提示上。
        onDetailChange: (hero) => setStepId(hero === null ? 'HERO_PICK' : 'HERO_CONFIRM'),
      }}
      overlay={
        <>
          <TutorialOverlay
            instruction={step.instruction}
            selectors={[step.selector]}
            dim={step.dim}
            active
          />
          <TutorialBlockTip tip={tip} />
        </>
      }
    />
  )
}
