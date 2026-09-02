/**
 * 教程里几块纯文字页面共用的纸面板外壳（教学开始页、过渡提示、完成页）。
 *
 * 视觉语言照搬现有的纸面页（.paper-page + .grain + OrnateFrame），不另起一套：
 * 这几屏各自只出现几秒，值不上一份专属版式。
 */

import type { ReactNode } from 'react'
import { PaperIconDefs } from '../ui/paper'
import { OrnateFrame } from '../ui/OrnateFrame'
import { MuteButton } from '../ui/MuteButton'
import './tutorial.css'

export function TutorialPaperPage({ children }: { children: ReactNode }) {
  return (
    <div className="tutorial-page paper-page grain">
      {/* 纸面组件的 <use> 要找得到 symbol，各挂一次。手绘滤镜由 App 全局挂，这里不用管。 */}
      <PaperIconDefs />
      {/* .paper-page__inner 把内容抬到两层纸纹之上（纸纹是 .grain 的两个绝对定位伪元素）。 */}
      {/* 这三屏没有别的控件，静音钮摆纸面右上角。放在 __inner 外面是因为那一层只有
          中间那栏面板那么宽，装进去按钮会贴着面板边而不是页面边（位置见 .tutorial-page__mute）。 */}
      <MuteButton variant="plain" className="tutorial-page__mute" />
      <div className="paper-page__inner tutorial-page__inner">
        <OrnateFrame className="tutorial-panel">{children}</OrnateFrame>
      </div>
    </div>
  )
}
