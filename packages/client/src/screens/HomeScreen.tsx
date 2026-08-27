/**
 * 主网站：介绍游戏 + 一键开始。
 *
 * 文案全是占位。新手教程还没做，先放一句占位文案；"一键开始"直接进匹配房。
 */

import { useState } from 'react'
import { useLocation } from 'wouter'
import { CARD_POOL } from '@ai-duel/core'
import { loadSave, resetSave } from '../save/save'

export function HomeScreen() {
  const [, navigate] = useLocation()
  // 进这个界面时读一次就够：任何会改存档的操作（赢一局）都在别的界面，
  // 回到首页时组件会重新挂载，自然读到新的。
  const [save, setSave] = useState(loadSave)

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

      <button type="button" className="page__cta" onClick={() => navigate('/room')}>
        开始对战
      </button>

      <section className="page__section">
        <h2>你的进度</h2>
        <p>
          收藏 {save.ownedCards.length}/{CARD_POOL.length} · 胜场 {save.wins}
        </p>
        <p className="page__muted">新手教程</p>
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
