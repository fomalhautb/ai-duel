/**
 * 右上角那颗静音按钮，全站每一页都有（挂在 App.tsx 的路由外面，跟着壳一起常驻）。
 *
 * 长相沿用卡角那枚问号圆章那一套（见 ui/CardHelpMark.tsx）：夜色圆底 + 米色线条 +
 * 手绘抖动滤镜。全站的线条都是这副长相，普通的 CSS border + 系统图标摆在这些画面上
 * 一眼就是"外来控件"。同理，外圈用 SVG 的 circle 而不是 border-radius 的描边——
 * border 抖不起来，和圈里的喇叭对不上。
 *
 * 为什么是固定在视口角上、而不是画进各页版式里：全站是 1672×941 的死版式再整体等比缩放
 *（见 ui/useStageScale.ts），跟着缩放走的话，手机上这颗按钮只有十几个屏幕像素宽，按不中。
 * 固定在视口上则各档屏幕都是同一个能按的尺寸，位置也不随页面切换而跳。
 *
 * z-index 取 8000：比对局里所有浮层（最高是展示遮罩那档 1100~1200）都大，
 * 又低于竖屏提示的 9000——那层是"现在没法玩"，盖住这颗按钮是对的。
 */

import { useSyncExternalStore } from 'react'
import { isMuted, subscribeMuted, toggleMuted } from './audioMute'

export function MuteButton() {
  // 服务端/测试快照沿用同一个读函数：这个 store 在没有 window 时恒为 false，不会有水合不一致。
  const muted = useSyncExternalStore(subscribeMuted, isMuted, isMuted)
  const label = muted ? '打开声音' : '关闭声音'

  return (
    <button
      type="button"
      className={`mute-toggle${muted ? ' is-muted' : ''}`}
      // aria-pressed 表示"静音这个动作是否处于按下状态"，朗读器会读成开关而不是普通按钮。
      aria-pressed={muted}
      aria-label={label}
      title={label}
      onClick={toggleMuted}
    >
      <SpeakerMark muted={muted} />
    </button>
  )
}

/**
 * 圆章本体：外圈 + 喇叭。
 *
 * 用画的不用字体里的 🔇/🔊：那两个字符各家系统画风差得很远，彩色 emoji 也压不成这套墨线。
 * 喇叭本体两种状态共用，只换右边那部分：有声是两道声波，静音是一个叉。
 */
function SpeakerMark({ muted }: { muted: boolean }) {
  return (
    <svg
      className="mute-toggle__mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9.4" />
      {/* 喇叭画小一圈（原来那把是满格 24 的尺寸），才塞得进上面这个圈里还留出边距。 */}
      <path d="M7.6 10.4h1.9l2.9-2.4v8l-2.9-2.4H7.6Z" />
      {muted ? (
        <path d="m14.6 10 2.9 2.9m0-2.9-2.9 2.9" />
      ) : (
        <>
          <path d="M14.7 10.1a2.6 2.6 0 0 1 0 3.8" />
          <path d="M16.5 8.5a5 5 0 0 1 0 7" />
        </>
      )}
    </svg>
  )
}
