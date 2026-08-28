/**
 * 卡牌图鉴 / 卡面调试页（/card）。
 *
 * 左右分栏：左边按 英雄牌 / AI 牌 / 技能牌列出 core 里的全部卡牌，点一张，右边就是这张卡的完整档案
 * ——正反两面、卡面之外的字段、分到的占位插画，最后附一份卡牌定义的原始 JSON。
 * 这是给开发和卡面调试用的，不是给玩家看的图鉴界面，所以只求信息全、找得快，不做美化。
 *
 * 卡面用的就是对局那套 HandCardFace，背面也是对局翻面那套 .card-back 结构和同一份文案
 * （见 ui/cardText.ts），所以改排版这一页能立刻看出每张卡各自会变成什么样
 * ——它存在的意义就是这个"对照表"。
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { CARDS, HEROES } from '@ai-duel/core'
import type { AiCard, Card, CardId, HeroCard, SkillCard } from '@ai-duel/core'
import { HandCardFace } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { CARD_ART_PLACEHOLDERS, placeholderArtFor } from '../ui/cardArt'
import { cardBackText } from '../ui/cardText'

const HERO_CARDS: HeroCard[] = Object.values(HEROES)
// 英雄牌不进牌组，所以 core 把它和 CARDS 分开放；这一页要把三种牌都列出来，在这里合并。
const ALL_CARDS: Card[] = [...HERO_CARDS, ...Object.values(CARDS)]
const AI_CARDS = ALL_CARDS.filter((card): card is AiCard => card.kind === 'ai')
const SKILL_CARDS = ALL_CARDS.filter((card): card is SkillCard => card.kind === 'skill')

const KIND_LABELS: Record<Card['kind'], string> = {
  hero: '英雄牌',
  ai: 'AI 牌',
  skill: '技能牌',
}

const CARD_BY_ID = new Map<CardId, Card>(ALL_CARDS.map((card) => [card.id, card]))

/**
 * core 的 Card 转成卡面要的展示数据。
 *
 * backText 走 cardBackText，和对局里那张卡完全一样——这一页就是拿来照着对局检查排版的。
 * art 不填，交给 HandCardFace 按 id 分配占位插画（见 ui/cardArt.ts），
 * 这样这一页看到的配图也和对局里那张卡是同一张。英雄牌也走同一条路：
 * 它自己的立绘（assets/人物卡简介/）还没接进构建，先跟着分一张占位图。
 */
function toHandCardData(card: Card): HandCardData {
  const base = {
    id: card.id,
    name: card.name,
    text: card.text,
    backText: cardBackText(card),
  }
  if (card.kind === 'ai') {
    return { ...base, kind: 'ai', model: card.model }
  }
  if (card.kind === 'hero') {
    return { ...base, kind: 'hero' }
  }
  return { ...base, kind: 'skill' }
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
          <p className="gallery__lead">core 里共 {ALL_CARDS.length} 张卡。</p>
          <button type="button" className="gallery__back" onClick={() => navigate('/')}>
            回首页
          </button>
        </header>

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
  return (
    <article>
      <h2 className="gallery__detail-title">{card.name}</h2>

      <div className="gallery__faces">
        <figure className="gallery__face">
          <div className="gallery__card">
            <HandCardFace card={toHandCardData(card)} />
          </div>
          <figcaption className="gallery__face-name">正面</figcaption>
        </figure>
        <figure className="gallery__face">
          {/* .card-back 是宽高各 100%，尺寸本来由 HandFan 的翻面层给（见 .hand-fan__face）；
              脱开手牌单独渲染时得自己套一个 150×210 的盒子，否则它会塌成 0 高。 */}
          <div className="gallery__card">
            <div className="card-back">
              <span className="card-back__title">{card.name}</span>
              <p className="card-back__text">{cardBackText(card)}</p>
            </div>
          </div>
          <figcaption className="gallery__face-name">背面（与对局中翻面所见一致）</figcaption>
        </figure>
      </div>

      <dl className="gallery__meta">
        <MetaRow label="类别">{KIND_LABELS[card.kind]}</MetaRow>
        <MetaRow label="卡牌 id">
          <code>{card.id}</code>
        </MetaRow>
        {card.kind === 'ai' ? <MetaRow label="模型名">{card.model}</MetaRow> : null}
        {/* 英雄牌没有模型名，它那一格换成专属技能（内容目前是占位，见 core 的 heroes.ts）。 */}
        {card.kind === 'hero' ? (
          <MetaRow label="英雄技能">
            {card.skill.name}——{card.skill.text}
          </MetaRow>
        ) : null}
        <MetaRow label="占位插画">
          <code>{placeholderArtFor(card.id)}</code>
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
