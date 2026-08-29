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
import { CARDS, CARD_POOL, other } from '@ai-duel/core'
import type { CardId, GamePhase, PlayerId } from '@ai-duel/core'
import { useMatch } from '../match/useMatch'
import type { MatchDriver } from '../match/driver'

const PHASE_LABELS: Record<GamePhase, string> = {
  play: '出牌',
  quiz: '答题',
  rescue: '容错补位',
  finished: '已结束',
}

/** 下拉里的这一项表示"不指定卡牌"，也就是照常从牌堆顶抽一张。 */
const FROM_DECK = ''

export function DevPanel({ driver }: { driver: MatchDriver }) {
  const view = useMatch(driver)
  const [open, setOpen] = useState(false)
  /** 「加1张」要造哪张卡；留空就是从牌堆抽。 */
  const [cardId, setCardId] = useState<CardId | typeof FROM_DECK>(FROM_DECK)

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
          {/* 一眼看清引擎现在停在哪：出牌卡住还是在等答题自动提交，光看画面分不出来。 */}
          <p className="battle-dev__status">
            第 {state.round}/{state.totalRounds} 轮 · {PHASE_LABELS[state.phase]} · 行动方{' '}
            {state.players[state.activePlayer].name}
          </p>

          <div className="battle-dev__row">
            <span className="battle-dev__row-label">造牌</span>
            <select
              className="battle-dev__select"
              value={cardId}
              onChange={(event) => setCardId(event.target.value)}
            >
              <option value={FROM_DECK}>牌堆顶</option>
              {CARD_POOL.map((id) => (
                <option key={id} value={id}>
                  {CARDS[id]?.name ?? id}
                </option>
              ))}
            </select>
          </div>

          {rows.map((row) => (
            <div className="battle-dev__row" key={row.seat}>
              <span className="battle-dev__row-label">{row.label}</span>
              <button
                type="button"
                className="battle-dev__btn"
                onClick={() =>
                  driver.send({
                    type: 'DEBUG_ADD_CARD',
                    player: row.seat,
                    // 不传 cardId 才是"从牌堆抽"，所以留空时这个字段必须整个不出现。
                    ...(cardId === FROM_DECK ? {} : { cardId }),
                  })
                }
              >
                加1张
              </button>
              <button
                type="button"
                className="battle-dev__btn"
                onClick={() => driver.send({ type: 'DEBUG_REMOVE_CARD', player: row.seat })}
              >
                去1张
              </button>
            </div>
          ))}

          <div className="battle-dev__row">
            {/* 对方不会自己点「结束出牌」，卡住时靠这个按钮把出牌权交出去。 */}
            <button
              type="button"
              className="battle-dev__btn"
              onClick={() => driver.send({ type: 'END_PLAY', player: state.activePlayer })}
            >
              结束出牌
            </button>
            {/* 只想看答题和计分时省掉连点两次「结束出牌」。 */}
            <button
              type="button"
              className="battle-dev__btn"
              onClick={() => driver.send({ type: 'DEBUG_SKIP_TO_QUIZ' })}
            >
              跳到答题
            </button>
          </div>

          <p className="battle-dev__note">
            点对方手牌可替对方出牌。进答题阶段后结果会自动提交，不用手动点。
          </p>
        </div>
      ) : null}
    </div>
  )
}
