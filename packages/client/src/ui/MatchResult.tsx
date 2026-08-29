/**
 * 结算层：对局结束后盖满全屏的那块羊皮纸底板。
 *
 * 单独拆出来是为了能脱离对局单独渲染——开发页 /result（dev/ResultDemo.tsx）直接摆出
 * 胜/负/平/中断四种样子来调版式，不用真打完一局。对局界面里由 MatchStage 渲染。
 *
 * 只负责画，不判定胜负：标题文案和要不要显示比分都由调用方算好传进来。
 */

import type { ReactNode } from 'react'

export interface MatchResultProps {
  /** 大标题，例如「你赢了」。中断局传中断原因。 */
  title: string
  /** 最终比分。对局中断时没有比分可言，传 null 就整行不渲染。 */
  score: { mine: number; foe: number } | null
  /** 底下那排按钮，由各个界面自己决定是"再来一局"还是"回首页"。 */
  actions?: ReactNode
}

export function MatchResult({ title, score, actions }: MatchResultProps) {
  return (
    <div className="battle__result">
      <div className="battle__result-panel">
        <div className="battle__result-content">
          <p className="battle__result-title">{title}</p>
          {score === null ? null : (
            <p className="battle__result-score">
              最终比分 <strong>{score.mine} : {score.foe}</strong>
            </p>
          )}
          <div className="battle__result-actions">{actions}</div>
        </div>
      </div>
    </div>
  )
}
