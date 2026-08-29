/**
 * 教学对战之后的两块纯文字页面：过渡提示（规格 §12 开头）和教程完成页（规格 §14）。
 *
 * 两块共用一层纸面板，所以放在同一个文件里——它们的区别只有里面写什么字。
 * 视觉语言照搬现有的纸面页（.paper-page + .grain + OrnateFrame），
 * 不另起一套：这两屏各自只出现几秒，值不上一份专属版式。
 *
 * 完成页刻意**不做规则总结**（规格 §14 明确要求）：玩家刚打完一局，
 * 再糊一屏定义只会把刚学会的东西冲淡。
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { HandDrawnFilterDefs } from '../ui/HandDrawnFilterDefs'
import { PlaqueButton } from '../ui/PlaqueButton'
import { OrnateFrame } from '../ui/OrnateFrame'
import { OrnateTitle, PaperIconDefs } from '../ui/paper'
import { markTutorialDone } from '../save/save'
import './tutorial.css'

/** 过渡提示自己往下走的时间。够读完那句话，也留得住"想快点就直接点按钮"。 */
const INTERLUDE_MS = 4200

/** 教学对战的最终比分（脚本正常走完是 3:0）。 */
export interface TutorialScore {
  mine: number
  foe: number
}

/** 两块页面共用的纸面板外壳。 */
function TutorialPaperPage({ children }: { children: ReactNode }) {
  return (
    <div className="tutorial-page paper-page grain">
      {/* 匾额按钮的框线和文字引用这里定义的滤镜，纸面组件要 PaperIconDefs，各挂一次。 */}
      <HandDrawnFilterDefs />
      <PaperIconDefs />
      {/* .paper-page__inner 把内容抬到两层纸纹之上（纸纹是 .grain 的两个绝对定位伪元素）。 */}
      <div className="paper-page__inner tutorial-page__inner">
        <OrnateFrame className="tutorial-panel">{children}</OrnateFrame>
      </div>
    </div>
  )
}

/**
 * 胜利结算和组牌页之间的一句过渡（规格 §12）。
 *
 * 到点自己往下走，按钮只是给读得快的人一条捷径——不做成"必须点一下"，
 * 是因为这句话本身没有需要玩家决定的事。
 */
export function TutorialInterlude({ onNext }: { onNext: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onNext, INTERLUDE_MS)
    return () => clearTimeout(timer)
  }, [onNext])

  return (
    <TutorialPaperPage>
      <p className="tutorial-panel__lead">你已经学会对战了。</p>
      <p className="tutorial-panel__text">正式比赛前还差两步：组一套自己的牌组，选一位英雄。</p>
      <PlaqueButton className="tutorial-panel__cta" onClick={onNext}>
        去组牌
      </PlaqueButton>
    </TutorialPaperPage>
  )
}

/**
 * 教程完成页（规格 §14）：只突出「教学完成」和教学对战的最终比分，一个主按钮进匹配房。
 *
 * 存档标记写在这里而不是调用方：走到这一屏就等于教程完成了，
 * 而"跳过教程"那条路自己会写一次（见 TutorialScreen），两条出口各写各的，不用互相配合。
 * 重玩教程的入口在匹配房，不占这一页的主视觉。
 */
export function TutorialComplete({
  score,
  onStart,
}: {
  score: TutorialScore
  onStart: () => void
}) {
  useEffect(() => {
    markTutorialDone()
  }, [])

  return (
    <TutorialPaperPage>
      <OrnateTitle>教学完成</OrnateTitle>
      <p className="tutorial-panel__text">你已经会打了，也配好了牌组和英雄。</p>
      <div className="tutorial-score">
        <p className="tutorial-score__label">教学对战最终比分</p>
        <p className="tutorial-score__value">
          <b>{score.mine}</b>
          <i aria-hidden="true">:</i>
          <b>{score.foe}</b>
        </p>
      </div>
      <PlaqueButton className="tutorial-panel__cta" onClick={onStart}>
        开始真正的对战
      </PlaqueButton>
    </TutorialPaperPage>
  )
}
