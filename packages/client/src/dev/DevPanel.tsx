/**
 * dev 测试面板：只在测试房里挂，用来随手摆出想看的局面。
 *
 * 面板发的全是 core 的 DEBUG_* 指令，走的是和正常出牌一模一样的 execute 路径
 * （见 packages/core/src/types.ts 里那几条指令的说明），所以摆出来的局面和真打出来的没有区别。
 *
 * 它自己 useMatch(driver) 拿局面：快照订阅可以有任意多个，
 * 只有事件订阅是单例（那一个名额归 MatchStage 的动画层，见架构 5.2）。
 */

import { useState } from 'react'
import { other } from '@ai-duel/core'
import type { PlayerId } from '@ai-duel/core'
import { useMatch } from '../match/useMatch'
import type { MatchDriver } from '../match/driver'

export function DevPanel({ driver }: { driver: MatchDriver }) {
  const view = useMatch(driver)
  const [open, setOpen] = useState(false)

  const state = view.state
  if (state === null) return null

  const mySeat = view.seat
  const rows: Array<{ label: string; seat: PlayerId }> = [
    { label: '己方', seat: mySeat },
    { label: '对方', seat: other(mySeat) },
  ]

  return (
    <div className="battle-dev">
      <button
        type="button"
        className="battle-dev__toggle"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? '收起面板' : '测试面板'}
      </button>

      {open ? (
        <div className="battle-dev__panel">
          {rows.map((row) => (
            <div className="battle-dev__row" key={row.seat}>
              <span className="battle-dev__row-label">{row.label}</span>
              <button
                type="button"
                className="battle-dev__btn"
                onClick={() => driver.send({ type: 'DEBUG_ADD_CARD', player: row.seat })}
              >
                抽1张
              </button>
              <button
                type="button"
                className="battle-dev__btn"
                onClick={() => driver.send({ type: 'DEBUG_REMOVE_CARD', player: row.seat })}
              >
                去1张
              </button>
              <button
                type="button"
                className="battle-dev__btn"
                onClick={() => driver.send({ type: 'DEBUG_REFILL_COMPUTE', player: row.seat })}
              >
                算力拉满
              </button>
            </div>
          ))}

          <div className="battle-dev__row">
            {/* 对方回合没有 AI 会主动结束，卡住时靠这个按钮把回合推过去。 */}
            <button
              type="button"
              className="battle-dev__btn"
              onClick={() => driver.send({ type: 'END_TURN', player: state.activePlayer })}
            >
              结束当前回合
            </button>
          </div>

          <p className="battle-dev__note">点对方手牌可替对方出牌（提示卡直击本体）。</p>
        </div>
      ) : null}
    </div>
  )
}
