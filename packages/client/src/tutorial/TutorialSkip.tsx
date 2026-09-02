/**
 * 教程全程右上角那颗「跳过教程」。
 *
 * 刻意做得不显眼：它不是这一页要玩家点的东西，只是给已经会玩的人留的出口。
 * 点一下先变成一行确认，再点「确定」才真的跳——教程有好几分钟，误触一下退掉太亏；
 * 不用浏览器原生 confirm，那个弹窗和整套画面完全不是一个世界。
 *
 * 摆在哪儿分两种情况（由 TutorialScreen 决定，见那边）：
 * - 教学对战那一屏画进对局顶栏里，和静音钮排在一起——顶栏右上角本来就是这一屏放控件的地方，
 *   悬在画面外反而会和顶栏里的图标叠在一起。
 * - 组牌、选英雄那两屏没有顶栏，仍固定在视口右上角：这两屏各有各的舞台缩放，
 *   跟着谁都会在另一屏上跑偏。
 *
 * 长相直接复用全站的八角匾额按钮（PlaqueButton，「结束出牌」「确认牌组」都是它），
 * 只在 CSS 里改小一档：这一颗原来是圆角胶囊 + 系统配色，摆在哪一屏上都像另一个软件的控件。
 */

import { useState } from 'react'
import { PlaqueButton } from '../ui/PlaqueButton'
import './tutorial.css'

export interface TutorialSkipProps {
  onSkip: () => void
  /**
   * 额外的类名，用来改落位。画进对局顶栏时传 tutorial-skip--inbar，
   * 它会把默认那套视口固定定位撤掉（见 tutorial.css）。
   */
  className?: string
}

export function TutorialSkip({ onSkip, className = '' }: TutorialSkipProps) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <PlaqueButton
        className={`tutorial-skip tutorial-skip__plaque ${className}`.trim()}
        onClick={() => setConfirming(true)}
      >
        跳过教程
      </PlaqueButton>
    )
  }

  return (
    <div
      className={`tutorial-skip tutorial-skip--confirm ${className}`.trim()}
      role="group"
      aria-label="跳过教程"
    >
      <span className="tutorial-skip__ask">跳过教程？</span>
      <PlaqueButton className="tutorial-skip__plaque tutorial-skip__btn" onClick={onSkip}>
        确定
      </PlaqueButton>
      <PlaqueButton
        className="tutorial-skip__plaque tutorial-skip__btn"
        onClick={() => setConfirming(false)}
      >
        取消
      </PlaqueButton>
    </div>
  )
}
