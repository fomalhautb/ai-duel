/**
 * 进对局时的全屏提示，只对触屏设备弹一次。
 *
 * 为什么值得专门劝一句：对局界面是 1672×941 的死版式再整体等比缩放（见 ui/useStageScale.ts），
 * 手机浏览器的地址栏和底栏吃掉的正是高度，而 16:9 的舞台在横屏手机上恰好被高度卡住——
 * 少一条栏，整块画面就大一圈，卡面上的字也跟着大一圈。这是手机上性价比最高的一次点击。
 *
 * 为什么必须是按钮而不是自动进：浏览器只在用户手势的同步回调里受理全屏请求，
 * 页面一加载就调用会被直接拒绝（ui/fullscreen.ts 里也写了同一条）。
 *
 * 为什么可以跳过、而且跳过就不再问：全屏只是锦上添花，不是玩下去的前提
 *（和竖屏提示不同，那个是真的没法玩）。按了「暂不」就写进 localStorage 永久记住，
 * 免得每局开头都拦一下。想反悔的人还有竖屏提示里那颗「一键横屏」，
 * 以及浏览器自己的全屏入口。
 *
 * 不出现的几种情况，都在下面 useEffect 里判：桌面（细指针）、
 * 浏览器压根不支持整页全屏（iPhone Safari 就是这样，劝了也没用）、
 * 已经在全屏里、以及按过「暂不」。
 */

import { useEffect, useState } from 'react'
import { canGoFullscreen, enterLandscapeFullscreen, isCoarsePointer, isFullscreen, onFullscreenChange } from './fullscreen'

/** 按过「暂不」的存档位。存在即代表跳过，值本身没有意义。 */
const DISMISSED_KEY = 'ai-duel.fullscreenPromptDismissed'

/**
 * 读写都吞异常：隐私模式、站点数据被禁的浏览器上 localStorage 光是碰一下就抛，
 * 而这里存的只是一句"别再问了"，丢了最多是下一局再弹一次，不值得把整页带崩。
 */
function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) !== null
  } catch {
    return false
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // 存不下就算了，下一局会再问一次。
  }
}

export function FullscreenPrompt() {
  // 初值恒为 false、进 effect 再判：首帧不弹，免得它抢在对局画面淡入之前先糊在屏幕上。
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!isCoarsePointer() || !canGoFullscreen() || isFullscreen() || isDismissed()) return
    setShow(true)
    // 进全屏成功后这层自己收起来。订阅事件而不是只在按钮回调里关：
    // 玩家也可能走浏览器自己的全屏入口，那时同样不该继续劝。
    return onFullscreenChange(() => {
      if (isFullscreen()) setShow(false)
    })
  }, [])

  if (!show) return null

  return (
    <div className="fs-prompt" role="dialog" aria-modal="true" aria-labelledby="fs-prompt-title">
      <div className="fs-prompt__panel grain">
        <h2 className="fs-prompt__title" id="fs-prompt-title">
          全屏更好看
        </h2>
        <p className="fs-prompt__text">进入全屏能收起地址栏，画面和卡面上的字都会大一圈。</p>
        <button
          type="button"
          className="fs-prompt__go"
          // 必须在这个点击回调里同步发起：全屏和方向锁都只认用户手势。
          // 成功与否都不在这里关面板，交给上面那个 fullscreenchange 订阅——
          // 玩家在系统弹的确认框上按了取消时，面板就该留着。
          onClick={() => void enterLandscapeFullscreen()}
        >
          进入全屏
        </button>
        <button
          type="button"
          className="fs-prompt__skip"
          onClick={() => {
            rememberDismissed()
            setShow(false)
          }}
        >
          暂不，直接开始
        </button>
      </div>
    </div>
  )
}
