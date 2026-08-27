/**
 * 主网站：介绍游戏 + 一键开始。
 *
 * 文案全是占位，重点是"一键开始"的分流：
 * 教程没通关完就接着打教程，通关完了直接进匹配房。
 */

import { useState } from 'react'
import { useLocation } from 'wouter'
import { CARD_POOL } from '@ai-duel/core'
import { loadSave, resetSave } from '../save/save'
import { TUTORIAL_LEVELS, TUTORIAL_LEVEL_COUNT } from '../tutorial/levels'

export function HomeScreen() {
  const [, navigate] = useLocation()
  // 进这个界面时读一次就够：任何会改存档的操作（打教程、赢一局）都在别的界面，
  // 回到首页时组件会重新挂载，自然读到新的。
  const [save, setSave] = useState(loadSave)

  const tutorialDone = save.tutorialDone
  const nextLevel = Math.min(tutorialDone + 1, TUTORIAL_LEVEL_COUNT)
  const finishedTutorial = tutorialDone >= TUTORIAL_LEVEL_COUNT

  function handleStart(): void {
    navigate(finishedTutorial ? '/room' : `/tutorial/${nextLevel}`)
  }

  return (
    <main className="page page--home">
      <h1>斗AI</h1>
      <p className="page__lead">
        一款以「AI 模型的弱点」为核心机制的卡牌对战游戏。
        每张卡牌是一个 AI 模型，属性来自它真实的软肋：偏见、幻觉、误判、过度自信、上下文遗忘……
      </p>
      <p className="page__lead">
        提示卡指定一个弱点维度，伤害 = 卡面基础伤害 + 目标在该维度上的暴露程度。
        赢法不是比谁数值大，而是读懂对手的画像，挑它最脆的那一维打。
      </p>

      <button type="button" className="page__cta" onClick={handleStart}>
        {finishedTutorial ? '开始对战' : tutorialDone === 0 ? '开始游戏' : `继续教程（第 ${nextLevel} 关）`}
      </button>

      <section className="page__section">
        <h2>你的进度</h2>
        <p>
          教程 {tutorialDone}/{TUTORIAL_LEVEL_COUNT} · 收藏 {save.ownedCards.length}/{CARD_POOL.length} ·
          胜场 {save.wins}
        </p>
        <ul className="page__list">
          {TUTORIAL_LEVELS.map((level) => (
            <li key={level.level}>
              <button type="button" onClick={() => navigate(`/tutorial/${level.level}`)}>
                {level.title}
                {level.level <= tutorialDone ? '（已通关）' : ''}
              </button>
              <span className="page__muted"> {level.summary}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="page__section page__section--dev">
        <h2>调试入口</h2>
        <p className="page__muted">这一块是给开发和演示用的，正式版会去掉。</p>
        <button type="button" onClick={() => navigate('/room')}>
          直接进匹配房
        </button>
        <button type="button" onClick={() => navigate('/dev/hand')}>
          手牌动画演示页
        </button>
        <button type="button" onClick={() => setSave(resetSave())}>
          重置存档
        </button>
      </section>
    </main>
  )
}
