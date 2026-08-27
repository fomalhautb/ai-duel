/**
 * 对局界面。只认一个 MatchDriver，不知道自己在打教程、热座还是联机。
 *
 * 目前是**占位实现**：一堆按钮和文字，没有卡面美术，也没有接 HandFan 和 GSAP 动画。
 * 换成真界面时改的是这个文件的渲染部分，driver 那一侧不用动。
 * 接 HandFan 前还要先给 HandCardData 补上弱点画像和目标维度两项（见 HandFan.tsx 的说明）。
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { getCard, other } from '@ai-duel/core'
import type { CardId, CardInstance, Command, ModelInstance } from '@ai-duel/core'
import { useMatch } from '../match/useMatch'
import type { MatchDriver } from '../match/driver'
import { WEAKNESS_LABELS } from './labels'

/** 提示卡打谁：本体，或者对面场上某张指定卡的模型。 */
export type StageTarget = 'face' | { modelCardId: CardId }

/**
 * 只放行一个动作，别的全部禁用。教程靠它把玩家锁在剧本里。
 * 传 null 表示不限制（联机、热座都是这样）。
 */
export type StageRestriction =
  /** 什么都不能点，界面等玩家读完引导文案。 */
  | { kind: 'none' }
  | { kind: 'play'; cardId: CardId; target?: StageTarget }
  | { kind: 'end-turn' }

export interface MatchStageProps {
  driver: MatchDriver
  restriction?: StageRestriction | null
  /**
   * 玩家完成了 restriction 指定的动作（且引擎没有拒绝）时回调。
   *
   * 只在有 restriction 时才会触发，也就是只有教程会用到。
   * 判断"成功"靠的是 send 之后立刻读 lastRejection，
   * 这对本地 driver 成立（send 是同步的），联机客人那边不成立——但联机不设 restriction。
   */
  onActionDone?: () => void
  /** 顶栏右侧挂的额外内容，比如教程的关卡名。 */
  banner?: ReactNode
  /** 结算层里的按钮，由各个界面自己决定是"下一关"还是"回首页"。 */
  resultActions?: ReactNode
  /** 盖在对局上方的引导层，教程用。 */
  overlay?: ReactNode
}

export function MatchStage({
  driver,
  restriction = null,
  onActionDone,
  banner,
  resultActions,
  overlay,
}: MatchStageProps) {
  const view = useMatch(driver)
  /** 已经点了、正在等玩家选目标的提示卡。 */
  const [pendingPrompt, setPendingPrompt] = useState<CardInstance | null>(null)

  if (!view.state) {
    return (
      <div className="stage-root stage-root--waiting">
        <p>{view.status === 'aborted' ? view.abortReason : '正在等房主开局…'}</p>
        {view.status === 'aborted' ? <div className="stage-actions">{resultActions}</div> : null}
      </div>
    )
  }

  const state = view.state
  const me = state.players[view.seat]
  const foe = state.players[other(view.seat)]
  const myTurn = state.activePlayer === view.seat && state.phase === 'playing'

  function dispatch(command: Command): void {
    driver.send(command)
    setPendingPrompt(null)
    // 有 restriction 就说明是教程：引擎没拒绝就算这一步完成了。
    if (restriction && driver.getSnapshot().lastRejection === null) onActionDone?.()
  }

  /** 这张手牌现在能不能点。 */
  function cardPlayable(instance: CardInstance): boolean {
    if (!myTurn) return false
    if (getCard(instance.cardId).cost > me.compute) return false
    if (!restriction) return true
    return restriction.kind === 'play' && restriction.cardId === instance.cardId
  }

  /** 这个目标现在能不能选。restriction 没写目标（模型卡）时不该走到这里。 */
  function targetAllowed(target: 'face' | ModelInstance): boolean {
    if (!restriction) return true
    if (restriction.kind !== 'play') return false
    const want = restriction.target
    if (want === undefined) return true
    if (want === 'face') return target === 'face'
    return target !== 'face' && target.cardId === want.modelCardId
  }

  function handleCardClick(instance: CardInstance): void {
    const card = getCard(instance.cardId)
    if (card.kind === 'model') {
      dispatch({ type: 'PLAY_CARD', player: view.seat, instanceId: instance.instanceId })
      return
    }
    // 提示卡要先选目标，选完才发指令。
    setPendingPrompt(instance)
  }

  function handleTargetClick(target: 'face' | ModelInstance): void {
    if (!pendingPrompt) return
    dispatch({
      type: 'PLAY_CARD',
      player: view.seat,
      instanceId: pendingPrompt.instanceId,
      targetInstanceId: target === 'face' ? undefined : target.instanceId,
    })
  }

  const endTurnAllowed = myTurn && (!restriction || restriction.kind === 'end-turn')
  const picking = pendingPrompt !== null

  return (
    <div className="stage-root">
      <header className="stage-hud">
        <span className="stage-hud__turn">第 {state.turn} 回合</span>
        <span>{myTurn ? '轮到你了' : `${state.players[state.activePlayer].name} 行动中…`}</span>
        <span className="stage-hud__spacer" />
        {banner}
      </header>

      <section className="stage-side stage-side--foe">
        <div className="stage-side__info">
          <strong>{foe.name}</strong>
          <span>完整度 {foe.integrity}</span>
          <span>
            算力 {foe.compute}/{foe.computeMax}
          </span>
          <span>手牌 {foe.hand.length}</span>
          {picking ? (
            <button
              type="button"
              className="stage-target-face"
              disabled={!targetAllowed('face')}
              onClick={() => handleTargetClick('face')}
            >
              打本体
            </button>
          ) : null}
        </div>
        <ModelRow
          models={foe.board}
          picking={picking}
          isTargetAllowed={targetAllowed}
          onPick={handleTargetClick}
        />
      </section>

      <section className="stage-side stage-side--mine">
        <ModelRow models={me.board} picking={false} isTargetAllowed={() => false} onPick={() => {}} />
        <div className="stage-side__info">
          <strong>{me.name}</strong>
          <span>完整度 {me.integrity}</span>
          <span>
            算力 {me.compute}/{me.computeMax}
          </span>
        </div>
      </section>

      {picking ? (
        <div className="stage-hint">
          选一个目标打「{getCard(pendingPrompt.cardId).name}」
          <button type="button" onClick={() => setPendingPrompt(null)}>
            取消
          </button>
        </div>
      ) : null}
      {view.lastRejection ? <div className="stage-hint stage-hint--error">{view.lastRejection}</div> : null}

      <footer className="stage-hand">
        <ul className="stage-hand__list">
          {me.hand.map((instance) => (
            <li key={instance.instanceId}>
              <button
                type="button"
                className="stage-card"
                disabled={picking || !cardPlayable(instance)}
                onClick={() => handleCardClick(instance)}
              >
                <CardFace cardId={instance.cardId} />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="stage-end-turn" disabled={!endTurnAllowed} onClick={() => dispatch({ type: 'END_TURN', player: view.seat })}>
          结束回合
        </button>
      </footer>

      {overlay}

      {view.status === 'finished' || view.status === 'aborted' ? (
        <div className="stage-result">
          <p className="stage-result__title">
            {view.status === 'aborted'
              ? view.abortReason
              : state.winner === view.seat
                ? '你赢了'
                : '你输了'}
          </p>
          <div className="stage-actions">{resultActions}</div>
        </div>
      ) : null}
    </div>
  )
}

function ModelRow({
  models,
  picking,
  isTargetAllowed,
  onPick,
}: {
  models: readonly ModelInstance[]
  picking: boolean
  isTargetAllowed: (target: ModelInstance) => boolean
  onPick: (target: ModelInstance) => void
}) {
  if (models.length === 0) return <div className="stage-models stage-models--empty">场上没有模型</div>
  return (
    <ul className="stage-models">
      {models.map((model) => (
        <li key={model.instanceId}>
          <button
            type="button"
            className="stage-model"
            disabled={!picking || !isTargetAllowed(model)}
            onClick={() => onPick(model)}
          >
            <strong>{getCard(model.cardId).name}</strong>
            <span>
              {model.power} / {model.integrity}
            </span>
            <span className="stage-model__weak">{weaknessSummary(model)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function CardFace({ cardId }: { cardId: CardId }) {
  const card = getCard(cardId)
  return (
    <>
      <strong>{card.name}</strong>
      <span className="stage-card__cost">{card.cost} 算力</span>
      {card.kind === 'model' ? (
        <span className="stage-card__stat">
          {card.power} / {card.integrity} · {weaknessSummary(card)}
        </span>
      ) : (
        <span className="stage-card__stat">
          伤害 {card.damage} · 打{WEAKNESS_LABELS[card.targetWeakness]}
        </span>
      )}
    </>
  )
}

/** 只列出真正暴露（大于 0）的维度，六维全列出来占位太长也没信息量。 */
function weaknessSummary(owner: { weaknesses: Record<string, number> }): string {
  const parts = Object.entries(owner.weaknesses)
    .filter(([, value]) => value > 0)
    .map(([kind, value]) => `${WEAKNESS_LABELS[kind as keyof typeof WEAKNESS_LABELS]}${value}`)
  return parts.length > 0 ? parts.join(' ') : '无明显弱点'
}
