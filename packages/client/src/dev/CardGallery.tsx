/**
 * 卡牌图鉴 / 卡面调试页（/card）。
 *
 * 左右分栏：左边按 AI 卡 / 技能卡 / 英雄卡列出 core 里的全部卡牌，点一张，右边就是这张卡的完整档案
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
import type { AgentCard, Card, CardId, HeroCard, SkillCard } from '@ai-duel/core'
import { HandCardFace } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { CARD_ART_PLACEHOLDERS, placeholderArtFor } from '../ui/cardArt'
import { cardBackText } from '../ui/cardText'
import { heroCardData } from '../ui/heroCard'

/** 这一页认的"一张卡"：牌组里的卡，加上不进牌组的英雄卡（见 core 的 HeroCard）。 */
type GalleryCard = Card | HeroCard

const ALL_CARDS = Object.values(CARDS)
const AGENT_CARDS = ALL_CARDS.filter((card): card is AgentCard => card.kind === 'agent')
const SKILL_CARDS = ALL_CARDS.filter((card): card is SkillCard => card.kind === 'skill')
const HERO_CARDS = Object.values(HEROES)
/** 英雄和卡牌是两张互不相干的表，这一页要按 id 反查，所以先并成一张。 */
const ALL_ENTRIES: GalleryCard[] = [...ALL_CARDS, ...HERO_CARDS]
const ENTRY_BY_ID = new Map<string, GalleryCard>(ALL_ENTRIES.map((card) => [card.id, card]))

const KIND_LABELS: Record<GalleryCard['kind'], string> = {
  agent: 'AI 卡',
  skill: '技能卡',
  hero: '英雄卡',
}

/**
 * core 的 Card 转成卡面要的展示数据。
 *
 * backText 走 cardBackText，和对局里那张卡完全一样——这一页就是拿来照着对局检查排版的。
 * art 不填，交给 HandCardFace 按 id 分配占位插画（见 ui/cardArt.ts），
 * 这样这一页看到的配图也和对局里那张卡是同一张。
 */
function toHandCardData(card: GalleryCard): HandCardData {
  // 英雄卡的正面拼法只有一份（ui/heroCard.ts），对局侧栏画的就是这一张。
  if (card.kind === 'hero') return heroCardData(card)
  const base = {
    id: card.id,
    name: card.name,
    text: card.text,
    backText: cardBackText(card),
  }
  if (card.kind === 'agent') {
    return { ...base, kind: 'agent', model: card.model }
  }
  return { ...base, kind: 'skill' }
}

export function CardGallery() {
  const [, navigate] = useLocation()
  // 默认选中第一张：右栏永远有东西，不用为"还没选"单独做一个空状态。
  const [selectedId, setSelectedId] = useState<CardId | undefined>(ALL_ENTRIES[0]?.id)
  const selected = selectedId === undefined ? undefined : ENTRY_BY_ID.get(selectedId)

  return (
    <div className="gallery">
      <aside className="gallery__list">
        <header className="gallery__header">
          <h1 className="gallery__title">卡牌图鉴</h1>
          <p className="gallery__lead">
            core 里共 {ALL_CARDS.length} 张牌组卡，外加 {HERO_CARDS.length} 位英雄。
          </p>
          <button type="button" className="gallery__back" onClick={() => navigate('/')}>
            回首页
          </button>
        </header>

        <CardPicker
          title={`AI 卡（${AGENT_CARDS.length}）`}
          cards={AGENT_CARDS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <CardPicker
          title={`技能卡（${SKILL_CARDS.length}）`}
          cards={SKILL_CARDS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {/* 英雄卡单独一组：它不在 CARDS 里，也进不了牌组，只是借同一套卡面画出来。 */}
        <CardPicker
          title={`英雄卡（${HERO_CARDS.length}）`}
          cards={HERO_CARDS}
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

/** 左栏的一组卡（AI 卡 / 技能卡 / 英雄卡各一组），只画正面，点一下换选中。 */
function CardPicker({
  title,
  cards,
  selectedId,
  onSelect,
}: {
  title: string
  cards: GalleryCard[]
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
function CardDetail({ card }: { card: GalleryCard }) {
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
        {card.kind === 'agent' ? <MetaRow label="模型名">{card.model}</MetaRow> : null}
        {card.kind === 'hero' ? (
          <>
            <MetaRow label="英文名">{card.enName}</MetaRow>
            <MetaRow label="技能">
              {card.skillName}：{card.skillText}
            </MetaRow>
            <MetaRow label="进牌组">不进：英雄技能不占 20 张牌的牌组空间</MetaRow>
          </>
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
