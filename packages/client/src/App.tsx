import { useState } from 'react'
import { createGame, getCard, STARTER_DECK } from '@ai-duel/core'
import { DuelStage } from './DuelStage'

/**
 * 骨架版外壳：底下是 Pixi 画布，上面盖一层 React DOM。
 * 这层 DOM 覆盖层负责菜单、手牌信息、状态栏这类"文字多、交互常规"的界面，
 * 对局本身的动画交给 Pixi，两边不互相渲染。
 */
export function App() {
  // 先开一局本地对局，纯粹是为了验证 core 接得通；正式流程会由房间/菜单驱动。
  const [game] = useState(() =>
    createGame({
      seed: Date.now(),
      players: [
        { name: '玩家', deck: [...STARTER_DECK] },
        { name: '对手', deck: [...STARTER_DECK] },
      ],
    }),
  )
  const state = game.state
  const me = state.players[0]

  return (
    <div className="app">
      <DuelStage />
      <div className="overlay">
        <header className="hud">
          <span className="hud__title">AI Duel · 斗AI</span>
          <span>
            第 {state.turn} 回合 · 行动方 {state.players[state.activePlayer].name}
          </span>
          <span>
            算力 {me.compute}/{me.computeMax} · 完整度 {me.integrity}
          </span>
        </header>
        <ul className="hand">
          {me.hand.map((instance) => {
            const card = getCard(instance.cardId)
            return (
              <li key={instance.instanceId} className="hand__card">
                <strong>{card.name}</strong>
                <span className="hand__cost">{card.cost} 算力</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
