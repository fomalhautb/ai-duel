/**
 * 教程全程右上角那颗「跳过教程」。
 *
 * 刻意做得不显眼：它不是这一页要玩家点的东西，只是给已经会玩的人留的出口。
 * 点一下先变成一行确认，再点「确定」才真的跳——教程有好几分钟，误触一下退掉太亏；
 * 不用浏览器原生 confirm，那个弹窗和整套画面完全不是一个世界。
 *
 * 挂在整条教程流程之外（TutorialScreen 直接渲染），所以对战、组牌、选英雄三屏都有它，
 * 而且用的是视口坐标：这三屏各有各的舞台缩放，跟着谁都会在别的屏上跑偏。
 */

import { useState } from 'react'
import './tutorial.css'

export function TutorialSkip({ onSkip }: { onSkip: () => void }) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button type="button" className="tutorial-skip" onClick={() => setConfirming(true)}>
        跳过教程
      </button>
    )
  }

  return (
    <div className="tutorial-skip tutorial-skip--confirm" role="group" aria-label="跳过教程">
      <span className="tutorial-skip__ask">跳过教程？</span>
      <button type="button" className="tutorial-skip__btn" onClick={onSkip}>
        确定
      </button>
      <button
        type="button"
        className="tutorial-skip__btn tutorial-skip__btn--ghost"
        onClick={() => setConfirming(false)}
      >
        取消
      </button>
    </div>
  )
}
