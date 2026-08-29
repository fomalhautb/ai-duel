/**
 * 对局顶栏右上角那颗「离开」图标，以及点下去之后问一句的确认弹窗。
 *
 * 为什么要问一句：这一局不存盘（见 match/MatchSession.tsx），离开等于整局作废，
 * 联机时还会顺手把连接断掉，对面直接看到中断。这种一按就没法回头的动作值得拦一下。
 *
 * 图标画成实心剪影、不带边框也不带底：它就摆在顶栏这张纸上，
 * 旁边是同样无边框的静音钮，再给它套个框或圆底就成了纸上贴的一块补丁。
 * 实心也是为了扛住手绘抖动滤镜——那条滤镜按 ±3.2px 位移，细线稿在这个尺寸上会被揉糊，
 * 而实心块只会被揉出手绘的毛边，正是要的效果。
 *
 * 按钮本身不定位，位置由顶栏那一格（.battle-topbar__actions）决定：
 * 它跟着对局舞台一起等比缩放，和顶栏里的比分是同一套坐标。
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PlaqueButton } from './PlaqueButton'

export interface LeaveMatchButtonProps {
  /** 玩家在弹窗里按了「确认」。使用方负责收掉这一局并跳走。 */
  onConfirm(): void
}

export function LeaveMatchButton({ onConfirm }: LeaveMatchButtonProps) {
  const [asking, setAsking] = useState(false)
  // 关掉弹窗后把焦点送回这颗按钮，键盘用户不会掉回页面开头。
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  function close(): void {
    setAsking(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!asking) return
    // 打开就把焦点放到「取消」上：这是两个选项里安全的那个，误按回车不会丢局。
    cancelRef.current?.focus()
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      // 对局里别的浮层也听 Esc，这里拦下来免得一次按键关掉两层。
      event.stopPropagation()
      setAsking(false)
      triggerRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [asking])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="leave-match"
        aria-label="离开战局"
        title="离开战局"
        aria-haspopup="dialog"
        aria-expanded={asking}
        onClick={() => setAsking(true)}
      >
        <LeaveMark />
      </button>
      {/*
       * 弹窗必须传送到 body 上，不能跟着按钮留在原地：按钮画在对局顶栏里，
       * 而顶栏在 .battle-scaler（带 transform）内部——那是个层叠上下文，
       * 里面的元素写多大的 z-index 都盖不住抛硬币那类全屏过场，
       * position: fixed 也会退化成"相对缩放层定位"，弹窗还会跟着舞台一起被缩小。
       */}
      {asking
        ? createPortal(
        <div
          className="leave-ask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-ask-title"
          // 点遮罩等于取消：只认落在遮罩自己身上的点击，点在纸面上不算。
          onClick={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div className="leave-ask__panel grain">
            <h2 className="leave-ask__title" id="leave-ask-title">
              确认要离开战局吗
            </h2>
            <p className="leave-ask__text">这一局不会保存，离开之后无法回到当前进度。</p>
            <div className="leave-ask__actions">
              <PlaqueButton ref={cancelRef} className="leave-ask__btn" onClick={close}>
                取消
              </PlaqueButton>
              <PlaqueButton className="leave-ask__btn" onClick={onConfirm}>
                确认
              </PlaqueButton>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * 离开图标：一扇门加一支往外指的箭头，两块都是实心的（见文件头为什么不用线稿）。
 *
 * 门画成"缺了右边一条"的门框剪影，箭头从缺口里穿出去——
 * 这是"往外走"最通用的一副图形，不用文字也读得出来。
 */
function LeaveMark() {
  return (
    <svg className="leave-match__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {/* 门：左边那道竖框连着上下两截横框，右边空着让箭头穿过去。 */}
      <path d="M4 3h9v2.4H6.4v13.2H13V21H4Z" />
      {/* 箭头：一支实心三角加一截方尾，正对着门口那道缺口。 */}
      <path d="m14.6 7.2 5.6 4.8-5.6 4.8v-3.5H9.2v-2.6h5.4Z" />
    </svg>
  )
}
