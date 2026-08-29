/**
 * 静音开关。**没有自己的位置**——由每个页面在自己的版式里安排一个角落，
 * 跟着那一页的缩放层一起缩放（对局页在顶栏右上角，纸面页在页眉右端，夜色页在舞台右上角）。
 *
 * 原来它是挂在 App 上、固定在视口角上的一颗常驻圆章，好处是各档屏幕上尺寸一致、按得中，
 * 坏处是它浮在所有页面的图层之外：换页时突兀地悬在那儿，和每一页的版式都没有关系。
 * 现在改成各页自己摆，代价就是它跟着页面一起缩——触屏上会比原来小一圈。
 *
 * 两副长相（variant），差别只在有没有那圈"圆章"：
 * - seal：夜色圆底 + 米色线条，给深色底的页面（首页、匹配房、选英雄、信息页）。
 *   这也是卡角那枚问号圆章（ui/CardHelpMark.tsx）的长相。
 * - plain：不要圆底也不要外圈，喇叭改成实心墨色，给纸面上的页面（对局顶栏、组牌页、教程纸面页）。
 *   纸面上那几处旁边就是同样无边框的图标（比如对局顶栏的「离开」），
 *   摆一颗深色圆章进去会重得像块补丁。
 *
 * 用画的不用字体里的 🔇/🔊：那两个字符各家系统画风差得很远，彩色 emoji 也压不成这套墨线。
 */

import { useSyncExternalStore } from 'react'
import { isMuted, subscribeMuted, toggleMuted } from './audioMute'

export interface MuteButtonProps {
  /** 由使用方决定位置和配色，样式写在各页自己的样式表里。 */
  className?: string
  /** 见文件头。默认 seal。 */
  variant?: 'seal' | 'plain'
}

export function MuteButton({ className = '', variant = 'seal' }: MuteButtonProps) {
  // 服务端/测试快照沿用同一个读函数：这个 store 在没有 window 时恒为 false，不会有水合不一致。
  const muted = useSyncExternalStore(subscribeMuted, isMuted, isMuted)
  const label = muted ? '打开声音' : '关闭声音'

  return (
    <button
      type="button"
      className={`mute-toggle mute-toggle--${variant}${muted ? ' is-muted' : ''} ${className}`.trim()}
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
 * 外圈 + 喇叭。喇叭本体两种状态共用，只换右边那部分：有声是两道声波，静音是一个叉。
 *
 * 外圈和喇叭都带 class，是因为 plain 那副长相靠 CSS 改它们：外圈不画，喇叭填实
 *（喇叭本来就是一条闭合路径，填色即可，不用另画一套图形）。
 */
function SpeakerMark({ muted }: { muted: boolean }) {
  return (
    <svg
      className="mute-toggle__mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="mute-toggle__ring" cx="12" cy="12" r="9.4" />
      {/* 喇叭画小一圈（原来那把是满格 24 的尺寸），才塞得进上面这个圈里还留出边距。 */}
      <path className="mute-toggle__cone" d="M7.6 10.4h1.9l2.9-2.4v8l-2.9-2.4H7.6Z" />
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
