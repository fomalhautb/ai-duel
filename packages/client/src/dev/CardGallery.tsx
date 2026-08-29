/**
 * 卡牌图鉴 / 卡面调试页（/card）。
 *
 * 左右分栏：左边按 英雄牌 / AI 牌 / 技能牌列出 core 里的全部卡牌，点一张，右边就是这张卡的完整档案
 * ——正反两面、卡面之外的字段、绑定的插画，最后附一份卡牌定义的原始 JSON。
 * 这是给开发和卡面调试用的，不是给玩家看的图鉴界面，所以只求信息全、找得快，不做美化。
 *
 * 卡面用的就是对局那套 HandCardFace。AI 牌背面统一显示美术资源，英雄牌和技能牌背面继续复用
 * 对局翻面那套 .card-back 结构和文案（见 ui/cardText.ts），方便在同一页检查两种背面的实际尺寸。
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { CARDS, HEROES } from '@ai-duel/core'
import type { AiCard, Card, CardId, HeroCard, SkillCard } from '@ai-duel/core'
import { HandCardFace } from '../ui/HandFan'
import { AI_CARD_BACK_ART, CARD_ART_PLACEHOLDERS, cardArtFor } from '../ui/cardArt'
import { cardBackText } from '../ui/cardText'
import { toHandCardData } from '../ui/handCardData'

const HERO_CARDS: HeroCard[] = Object.values(HEROES)
/** 进牌组的那两类牌。英雄牌不在 CARDS 里，所以页头的张数也按这一份算。 */
const DECK_CARDS = Object.values(CARDS)
const AI_CARDS = DECK_CARDS.filter((card): card is AiCard => card.kind === 'ai')
const SKILL_CARDS = DECK_CARDS.filter((card): card is SkillCard => card.kind === 'skill')
// 英雄牌不进牌组，所以 core 把它和 CARDS 分成两张表；这一页要三类牌都列出来、还要按 id 反查，
// 在这里合成一张。
const ALL_CARDS: Card[] = [...HERO_CARDS, ...DECK_CARDS]
const CARD_BY_ID = new Map<CardId, Card>(ALL_CARDS.map((card) => [card.id, card]))

const KIND_LABELS: Record<Card['kind'], string> = {
  hero: '英雄牌',
  ai: 'AI 牌',
  skill: '技能牌',
}

export function CardGallery() {
  const [, navigate] = useLocation()
  // 默认选中第一张：右栏永远有东西，不用为"还没选"单独做一个空状态。
  const [selectedId, setSelectedId] = useState<CardId | undefined>(ALL_CARDS[0]?.id)
  const selected = selectedId === undefined ? undefined : CARD_BY_ID.get(selectedId)

  return (
    <div className="gallery">
      <aside className="gallery__list">
        <header className="gallery__header">
          <h1 className="gallery__title">卡牌图鉴</h1>
          <p className="gallery__lead">
            core 里共 {DECK_CARDS.length} 张进牌组的牌，外加 {HERO_CARDS.length} 位英雄。
          </p>
          <button type="button" className="gallery__back" onClick={() => navigate('/')}>
            回首页
          </button>
        </header>

        {/* 英雄牌单独一组：它不在 CARDS 里，也进不了牌组，只是借同一套卡面画出来。 */}
        <CardPicker
          title={`英雄牌（${HERO_CARDS.length}）`}
          cards={HERO_CARDS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <CardPicker
          title={`AI 牌（${AI_CARDS.length}）`}
          cards={AI_CARDS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <CardPicker
          title={`技能牌（${SKILL_CARDS.length}）`}
          cards={SKILL_CARDS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

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
      </aside>

      <main className="gallery__detail">
        {selected === undefined ? (
          <p className="gallery__section-note">core 里一张卡都没有。</p>
        ) : (
          <CardDetail card={selected} />
        )}
      </main>
    </div>
  )
}

/** 左栏的一组卡（英雄牌 / AI 牌 / 技能牌各一组），只画正面，点一下换选中。 */
function CardPicker({
  title,
  cards,
  selectedId,
  onSelect,
}: {
  title: string
  cards: Card[]
  selectedId: CardId | undefined
  onSelect: (id: CardId) => void
}) {
  return (
    <section className="gallery__section">
      <h2 className="gallery__section-title">{title}</h2>
      <div className="gallery__picks">
        {cards.map((card) => (
          <button
            type="button"
            className="gallery__pick"
            key={card.id}
            // aria-pressed 同时管两件事：读屏能听出哪张是选中的，选中描边也挂在这个属性上
            //（见 styles.css 的 .gallery__pick[aria-pressed='true']），不用再多一个 class。
            aria-pressed={card.id === selectedId}
            title={card.name}
            onClick={() => onSelect(card.id)}
          >
            <span className="gallery__pick-card">
              <HandCardFace card={toHandCardData(card)} />
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** 右栏：选中那张卡的全部信息。 */
function CardDetail({ card }: { card: Card }) {
  const [showOverlay, setShowOverlay] = useState(true)
  const [previewSize, setPreviewSize] = useState('large')
  return (
    <article>
      <h2 className="gallery__detail-title">{card.name}</h2>

      <div className="gallery__controls">
        <label>
          <input type="checkbox" checked={showOverlay} onChange={(event) => setShowOverlay(event.target.checked)} />
          显示卡面图层
        </label>
        <label>
          预览尺寸
          <select value={previewSize} onChange={(event) => setPreviewSize(event.target.value)}>
            <option value="large">放大 · 300 × 450</option>
            <option value="actual">手牌 · 150 × 225</option>
            <option value="original">原图比例 · 300 × 450</option>
          </select>
        </label>
        <a href="/design#card-overlay">查看设计组件</a>
      </div>
      <div className="gallery__faces" data-preview-size={previewSize}>
        <figure className="gallery__face">
          <div className="gallery__card">
            {showOverlay ? (
              <HandCardFace card={toHandCardData(card)} />
            ) : (
              <img className="gallery__original" src={cardArtFor(card.id)} alt={`${card.name}原始插画`} />
            )}
          </div>
          <figcaption className="gallery__face-name">正面</figcaption>
        </figure>
        <figure className="gallery__face">
          {/* AI 牌使用统一美术背面；其他牌的 .card-back 宽高各 100%，两者都由外层盒子定尺寸。 */}
          <div className="gallery__card">
            {card.kind === 'ai' ? (
              <img
                className="gallery__card-back-art"
                src={AI_CARD_BACK_ART}
                alt={`${card.name} 的统一卡牌背面`}
                draggable={false}
              />
            ) : (
              <div className="card-back">
                <span className="card-back__title">{card.name}</span>
                <p className="card-back__text">{cardBackText(card)}</p>
              </div>
            )}
          </div>
          <figcaption className="gallery__face-name">
            {card.kind === 'ai' ? '背面（AI 牌统一图案）' : '背面（与对局中翻面所见一致）'}
          </figcaption>
        </figure>
      </div>

      <dl className="gallery__meta">
        <MetaRow label="类别">{KIND_LABELS[card.kind]}</MetaRow>
        <MetaRow label="卡牌 id">
          <code>{card.id}</code>
        </MetaRow>
        {card.kind === 'ai' ? <MetaRow label="模型名">{card.model}</MetaRow> : null}
        {/* 英雄牌没有模型名，它那几格换成英文名和专属技能。 */}
        {card.kind === 'hero' ? (
          <>
            <MetaRow label="英文名">{card.enName}</MetaRow>
            <MetaRow label="技能">
              {card.skillName}：{card.skillText}
            </MetaRow>
            <MetaRow label="进牌组">不进：英雄技能不占 20 张牌的牌组空间</MetaRow>
          </>
        ) : null}
        <MetaRow label="卡牌插画">
          <code>{cardArtFor(card.id)}</code>
        </MetaRow>
      </dl>

      <section className="gallery__section">
        <h3 className="gallery__section-title">原始数据（玩家不可见）</h3>
        <p className="gallery__section-note">
          整条卡牌定义原样打印。以后给卡牌加任何玩家在卡面上看不到的字段（内部标签、平衡参数、
          解锁条件……），不用改这一页的代码，加完就能在这里看到。
        </p>
        <pre className="gallery__json">{JSON.stringify(card, null, 2)}</pre>
      </section>
    </article>
  )
}

/** 详情里的一行键值。 */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gallery__meta-row">
      <dt className="gallery__meta-key">{label}</dt>
      <dd className="gallery__meta-value">{children}</dd>
    </div>
  )
}
