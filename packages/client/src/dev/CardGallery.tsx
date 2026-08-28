/**
 * 卡牌图鉴 / 卡面调试页（/card）。
 *
 * 一次把 core 里的全部卡牌按原始尺寸（150×210）摆出来，用的就是对局里那套 HandCardFace，
 * 所以卡面排版一改，这一页立刻能看出每张卡各自会变成什么样——它存在的意义就是这个"对照表"，
 * 不是给玩家看的图鉴界面。
 *
 * 卡面上现在只印卡名、描述和底部那一行标识（AI 卡是模型名，技能牌是"技能"），
 * 所以下面的说明栏也只补一条卡面上没有的信息：AI 卡的模型名对应的卡牌 id。
 */

import { useLocation } from 'wouter'
import { CARDS } from '@ai-duel/core'
import type { AgentCard, Card, SkillCard } from '@ai-duel/core'
import { HandCardFace } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { CARD_ART_PLACEHOLDERS } from '../ui/cardArt'

const ALL_CARDS = Object.values(CARDS)
const AGENT_CARDS = ALL_CARDS.filter((card): card is AgentCard => card.kind === 'agent')
const SKILL_CARDS = ALL_CARDS.filter((card): card is SkillCard => card.kind === 'skill')

/**
 * core 的 Card 转成卡面要的展示数据。
 *
 * backText 填的是占位说明：图鉴只渲染正面，背面归 HandFan 的翻面层管，这一页碰不到它。
 * art 不填，交给 HandCardFace 按 id 分配占位插画（见 ui/cardArt.ts）——
 * 这样这一页看到的配图和对局里那张卡是同一张。
 */
function toHandCardData(card: Card): HandCardData {
  const base = {
    id: card.id,
    name: card.name,
    text: card.text,
    backText: '图鉴页只看正面。',
  }
  if (card.kind === 'agent') {
    return { ...base, kind: 'agent', model: card.model }
  }
  return { ...base, kind: 'skill' }
}

export function CardGallery() {
  const [, navigate] = useLocation()

  return (
    <div className="gallery">
      <header className="gallery__header">
        <h1 className="gallery__title">卡牌图鉴</h1>
        <p className="gallery__lead">
          core 里的全部 {ALL_CARDS.length} 张卡，按对局中的真实尺寸（150×210）平铺。
          插画目前全是占位图，按卡牌 id 稳定分配。
        </p>
        <button type="button" className="gallery__back" onClick={() => navigate('/')}>
          回首页
        </button>
      </header>

      <section className="gallery__section">
        <h2 className="gallery__section-title">占位插画原图</h2>
        <p className="gallery__section-note">
          四张图轮流分给所有卡牌，协作时按文件名指认。原图 1024×1536。
        </p>
        <div className="gallery__arts">
          {CARD_ART_PLACEHOLDERS.map((src) => (
            <figure className="gallery__art" key={src}>
              <img className="gallery__art-img" src={src} alt="" draggable={false} />
              <figcaption className="gallery__art-name">{src}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="gallery__section">
        <h2 className="gallery__section-title">AI 卡（{AGENT_CARDS.length}）</h2>
        <div className="gallery__grid">
          {AGENT_CARDS.map((card) => (
            <article className="gallery__item" key={card.id}>
              <div className="gallery__card">
                <HandCardFace card={toHandCardData(card)} />
              </div>
              <dl className="gallery__meta">
                <div className="gallery__meta-row">
                  <dt className="gallery__meta-key">卡牌 id</dt>
                  <dd className="gallery__meta-value">{card.id}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="gallery__section">
        <h2 className="gallery__section-title">技能牌（{SKILL_CARDS.length}）</h2>
        <div className="gallery__grid">
          {SKILL_CARDS.map((card) => (
            <article className="gallery__item" key={card.id}>
              <div className="gallery__card">
                <HandCardFace card={toHandCardData(card)} />
              </div>
              <dl className="gallery__meta">
                <div className="gallery__meta-row">
                  <dt className="gallery__meta-key">卡牌 id</dt>
                  <dd className="gallery__meta-value">{card.id}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
