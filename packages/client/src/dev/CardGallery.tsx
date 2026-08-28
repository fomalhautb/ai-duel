/**
 * 卡牌图鉴 / 卡面调试页（/card）。
 *
 * 左右分栏：左边按模型卡 / 提示卡列出 core 里的全部卡牌，点一张，右边就是这张卡的完整档案
 * ——正反两面、全部数值、分到的占位插画，最后附一份卡牌定义的原始 JSON。
 * 这是给开发和数值调试用的，不是给玩家看的图鉴界面，所以只求信息全、找得快，不做美化。
 *
 * 卡面用的就是对局那套 HandCardFace，背面也是对局翻面那套 .card-back 结构和同一份文案
 * （见 ui/cardText.ts），所以改排版、改数值这一页能立刻看出每张卡各自会变成什么样
 * ——它存在的意义就是这个"对照表"。
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { CARDS, WEAKNESS_KINDS } from '@ai-duel/core'
import type { Card, CardId, ModelCard, PromptCard } from '@ai-duel/core'
import { HandCardFace } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { CARD_ART_PLACEHOLDERS, placeholderArtFor } from '../ui/cardArt'
import { cardBackText } from '../ui/cardText'
import { WEAKNESS_LABELS } from '../ui/labels'

const ALL_CARDS = Object.values(CARDS)
const MODEL_CARDS = ALL_CARDS.filter((card): card is ModelCard => card.kind === 'model')
const PROMPT_CARDS = ALL_CARDS.filter((card): card is PromptCard => card.kind === 'prompt')

const KIND_LABELS: Record<Card['kind'], string> = {
  model: '模型卡',
  prompt: '提示卡',
}

/**
 * core 的 Card 转成卡面要的展示数据。
 *
 * weaknesses 直接把六维原样递进去（不像对局那样先筛掉 0）：HandCardFace 自己会再滤一道，
 * 这一页也需要"卡面漏画了哪一维"能看得出来，筛在外面反而把这个对照弄没了。
 * art 不填，交给 HandCardFace 按 id 分配占位插画（见 ui/cardArt.ts）——
 * 这样这一页看到的配图和对局里那张卡是同一张。
 */
function toHandCardData(card: Card): HandCardData {
  const base = {
    id: card.id,
    name: card.name,
    cost: card.cost,
    text: card.text,
    backText: cardBackText(card),
  }
  if (card.kind === 'model') {
    return {
      ...base,
      kind: 'model',
      power: card.power,
      integrity: card.integrity,
      weaknesses: card.weaknesses,
    }
  }
  return { ...base, kind: 'prompt', damage: card.damage, targetWeakness: card.targetWeakness }
}

export function CardGallery() {
  const [, navigate] = useLocation()
  // 默认选中第一张：右栏永远有东西，不用为"还没选"单独做一个空状态。
  const [selectedId, setSelectedId] = useState<CardId | undefined>(ALL_CARDS[0]?.id)
  const selected = selectedId === undefined ? undefined : CARDS[selectedId]

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
          title={`模型卡（${MODEL_CARDS.length}）`}
          cards={MODEL_CARDS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <CardPicker
          title={`提示卡（${PROMPT_CARDS.length}）`}
          cards={PROMPT_CARDS}
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

/** 左栏的一组卡（模型卡 / 提示卡各一组），只画正面，点一下换选中。 */
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
        <MetaRow label="费用">{card.cost}</MetaRow>
        {card.kind === 'model' ? (
          <>
            <MetaRow label="算力">{card.power}</MetaRow>
            <MetaRow label="完整度">{card.integrity}</MetaRow>
            <MetaRow label="弱点画像">
              {/* 六维全列，0 的那几维只压暗、不省略：正面卡面为了省地方把 0 全筛掉了
                  （见 HandCardFace），可"这一维打了完全不疼"本身就是要读的信息。 */}
              <span className="gallery__weak">
                {WEAKNESS_KINDS.map((kind) => (
                  <span
                    className="gallery__weak-item"
                    key={kind}
                    data-zero={card.weaknesses[kind] === 0}
                  >
                    {WEAKNESS_LABELS[kind]} {card.weaknesses[kind]}
                  </span>
                ))}
              </span>
            </MetaRow>
          </>
        ) : (
          <>
            <MetaRow label="目标维度">
              {WEAKNESS_LABELS[card.targetWeakness]}（{card.targetWeakness}）
            </MetaRow>
            <MetaRow label="基础伤害">{card.damage}</MetaRow>
          </>
        )}
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
