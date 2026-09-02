/**
 * 结算界面调试页（访问 /result 进入）。
 *
 * 结算层只在一局打完的最后一瞬出现，为了调它的版式去真打一局太贵。这一页把四种结果
 * （胜 / 负 / 平 / 中断）摆成可切换的按钮，配上能改的比分，直接盯着改样式。
 *
 * 底板套着和对局界面同一套 16:9 舞台（.battle-frame / .battle-stage / .battle-scaler），
 * 缩放比例和真实对局一致，这里量出来的尺寸拿回去就能用。
 */

import { useState } from 'react'
import { useLocation } from 'wouter'
import { MatchResult } from '../ui/MatchResult'
import { PlaqueButton } from '../ui/PlaqueButton'
import { useStageScale } from '../ui/useStageScale'

type Outcome = 'win' | 'lose' | 'draw' | 'aborted'

const OUTCOMES: { key: Outcome; label: string }[] = [
  { key: 'win', label: '获胜' },
  { key: 'lose', label: '失败' },
  { key: 'draw', label: '平局' },
  { key: 'aborted', label: '对局中断' },
]

/** 结算层的大标题，和对局界面 resultTitleOf 算出来的是同一批文案。 */
const TITLES: Record<Outcome, string> = {
  win: '你赢了',
  lose: '你输了',
  draw: '平局',
  // 中断走的是 MatchView.abortReason，文案不固定，这里取最常见的一条。
  aborted: '对手已离开',
}

export function ResultDemo() {
  const [, navigate] = useLocation()
  const [outcome, setOutcome] = useState<Outcome>('win')
  const [mine, setMine] = useState(3)
  const [foe, setFoe] = useState(1)

  // 舞台缩放系数得由 JS 量出来写进 --battle-scale，CSS 里只有兜底的 1（原因见 ui/useStageScale.ts）。
  // 对局页在 MatchStage 的 BattleFrame 里挂同一个 hook，这一页自己搭舞台，就得自己挂一份。
  const scalerRef = useStageScale<HTMLDivElement>('--battle-scale')

  const title = TITLES[outcome]
  // 和对局界面同一条规矩：中断局没有比分可言，那一行整个不渲染。
  const score = outcome === 'aborted' ? null : { mine, foe }

  return (
    <div className="result-demo">
      <div className="battle-frame">
        <div className="battle-stage">
          <div className="battle-scaler stage-scaler" ref={scalerRef}>
            <MatchResult
              variant={outcome === 'lose' ? 'defeat' : outcome === 'draw' ? 'draw' : 'victory'}
              title={title}
              score={score}
              actions={
                <>
                  <PlaqueButton type="button" onClick={() => navigate('/dev')}>
                    再来一局
                  </PlaqueButton>
                  <PlaqueButton type="button" onClick={() => navigate('/')}>
                    回首页
                  </PlaqueButton>
                </>
              }
            />
          </div>
        </div>
      </div>

      <div className="result-demo__panel">
        <div className="result-demo__row">
          {OUTCOMES.map((item) => (
            <button
              type="button"
              key={item.key}
              className={
                item.key === outcome
                  ? 'result-demo__pick result-demo__pick--on'
                  : 'result-demo__pick'
              }
              onClick={() => setOutcome(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="result-demo__row">
          <label className="result-demo__field">
            我方
            <input
              type="number"
              value={mine}
              onChange={(event) => setMine(Number(event.target.value))}
            />
          </label>
          <label className="result-demo__field">
            对方
            <input
              type="number"
              value={foe}
              onChange={(event) => setFoe(Number(event.target.value))}
            />
          </label>
          <button type="button" className="result-demo__pick" onClick={() => navigate('/dev')}>
            回开发页
          </button>
        </div>
      </div>
    </div>
  )
}
