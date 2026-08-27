import { useState } from 'react'
import { CARD_POOL, createGame, getCard, STARTER_DECK } from '@ai-duel/core'
import { loadSave } from './save'

/**
 * 骨架版外壳：一层深色底 + 一层 React 覆盖层，全部是 DOM。
 * 对局画面（手牌、战场、特效）也走 DOM + GSAP，不再有画布。
 * 这里的 HUD 和手牌列表还是最早的占位实现，等接上 HandFan 和事件流时再换掉。
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
  // 本地存档只在挂载时读一次。结算界面还没做，所以暂时没有更新它的入口，
  // 等接上胜负判定后用 recordWin 的返回值 setState 即可。
  const [save] = useState(loadSave)
  const state = game.state
  const me = state.players[0]

  return (
    <div className="app">
      <div className="stage" />
      <div className="overlay">
        <header className="hud">
          <span className="hud__title">AI Duel · 斗AI</span>
          <span>
            第 {state.turn} 回合 · 行动方 {state.players[state.activePlayer].name}
          </span>
          <span>
            算力 {me.compute}/{me.computeMax} · 完整度 {me.integrity}
          </span>
          <span>
            收藏 {save.ownedCards.length}/{CARD_POOL.length} · 胜场 {save.wins}
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
