/**
 * 卡牌图鉴（/card）与默认牌组（/deck）共用卡面详情，避免两处展示规则分叉。
 *
 * 左右分栏：左边按模型卡 / 提示卡列出 core 里的全部卡牌，点一张，右边就是这张卡的完整档案
 * ——正反两面、全部数值、绑定的插画，最后附一份卡牌定义的原始 JSON。
 * 这是给开发和数值调试用的，不是给玩家看的图鉴界面，所以只求信息全、找得快，不做美化。
 *
 * 卡面用的就是对局那套 HandCardFace，可切换纯卡面、战斗信息和原图；背面也是对局的同一份文案
 * （见 ui/cardText.ts），所以改排版、改数值这一页能立刻看出每张卡各自会变成什么样
 * ——它存在的意义就是这个"对照表"。
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { AI_MODEL_CARD_IDS, CARDS, STARTER_DECK, WEAKNESS_KINDS } from '@ai-duel/core'
import type { Card, CardId } from '@ai-duel/core'
import { HandCardFace } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { CARD_ART_PLACEHOLDERS } from '../ui/cardArt'
import { cardBackText } from '../ui/cardText'
import { cardPresentation } from '../ui/cardPresentation'
import { WEAKNESS_LABELS } from '../ui/labels'
import { useMatchSession } from '../match/MatchSession'

const ALL_CARDS = Object.values(CARDS)
const DECK_COUNTS = new Map<CardId, number>()
for (const id of STARTER_DECK) DECK_COUNTS.set(id, (DECK_COUNTS.get(id) ?? 0) + 1)
const DECK_CARDS = ALL_CARDS.filter((card) => DECK_COUNTS.has(card.id))

const KIND_LABELS: Record<Card['kind'], string> = {
  model: '模型卡',
  prompt: '提示卡',
}

/**
 * core 的 Card 转成卡面要的展示数据。
 *
 * weaknesses 直接把六维原样递进去（不像对局那样先筛掉 0）：HandCardFace 自己会再滤一道，
 * 这一页也需要"卡面漏画了哪一维"能看得出来，筛在外面反而把这个对照弄没了。
 * 插画、配色和技能简称与对局使用同一份 cardPresentation，实例 id 不会改变它们。
 */
function toHandCardData(card: Card): HandCardData {
  const base = {
    ...cardPresentation(card),
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

export function DeckGallery() {
  return <CollectionGallery mode="deck" />
}

export function CardGallery() {
  return <CollectionGallery mode="catalog" />
}

function CollectionGallery({ mode }: { mode: 'deck' | 'catalog' }) {
  const [, navigate] = useLocation()
  const session = useMatchSession()
  const isDeck = mode === 'deck'
  const cards = isDeck ? DECK_CARDS : ALL_CARDS
  // 默认选中第一张：右栏永远有东西，不用为"还没选"单独做一个空状态。
  const [selectedId, setSelectedId] = useState<CardId | undefined>(cards[0]?.id)
  const selected = selectedId === undefined ? undefined : CARDS[selectedId]

  return (
    <div className="gallery">
      <aside className="gallery__list">
        <header className="gallery__header">
          <h1 className="gallery__title">{isDeck ? '我的牌组' : '卡牌图鉴'}</h1>
          <p className="gallery__lead">
            {isDeck ? `默认牌组 · ${STARTER_DECK.length} 张 / ${cards.length} 种` : `卡池共 ${cards.length} 种卡。`}
          </p>
          <p className="gallery__section-note">
            {isDeck ? `${AI_MODEL_CARD_IDS.length} 张 AI 卡已全部入组，新建对局自动使用。当前为固定测试牌组，数值尚未平衡。` : '具名 AI 使用专属原画；技能简称为卡牌主题，战斗效果以背面规则为准。'}
          </p>
          <button type="button" className="gallery__back" onClick={() => navigate('/')}>
            回首页
          </button>
          <button type="button" className="gallery__back" onClick={() => navigate(isDeck ? '/card' : '/deck')}>
            {isDeck ? '全部图鉴' : '查看牌组'}
          </button>
          {session.driver && <button type="button" className="gallery__back" onClick={() => navigate('/match')}>返回对局</button>}
        </header>

        <CardPicker
          title={`模型卡（${cards.filter((card) => card.kind === 'model').length} 种）`}
          cards={cards.filter((card) => card.kind === 'model')}
          counts={isDeck ? DECK_COUNTS : undefined}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <CardPicker
          title={`提示卡（${cards.filter((card) => card.kind === 'prompt').length} 种）`}
          cards={cards.filter((card) => card.kind === 'prompt')}
          counts={isDeck ? DECK_COUNTS : undefined}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {!isDeck && <section className="gallery__section">
          <h2 className="gallery__section-title">占位插画原图</h2>
          <p className="gallery__section-note">
            仅提示卡使用这些占位图。{AI_MODEL_CARD_IDS.length} 张 AI 模型均绑定专属原画，原图 1024×1536。
          </p>
          <div className="gallery__arts">
            {CARD_ART_PLACEHOLDERS.map((src) => (
              <figure className="gallery__art" key={src}>
                <img className="gallery__art-img" src={src} alt="" draggable={false} />
                <figcaption className="gallery__art-name">{src}</figcaption>
              </figure>
            ))}
          </div>
        </section>}
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
  counts,
  selectedId,
  onSelect,
}: {
  title: string
  cards: Card[]
  counts?: ReadonlyMap<CardId, number>
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
            aria-label={card.name}
            title={card.name}
            onClick={() => onSelect(card.id)}
          >
            <span className="gallery__pick-card">
              <HandCardFace card={toHandCardData(card)} showCombatStats={false} />
            </span>
            {counts && <span className="gallery__copy-count">{card.name} · ×{counts.get(card.id)}</span>}
          </button>
        ))}
      </div>
    </section>
  )
}

/** 右栏：选中那张卡的全部信息。 */
function CardDetail({ card }: { card: Card }) {
  const [showOverlay, setShowOverlay] = useState(true)
  const [showCombatStats, setShowCombatStats] = useState(false)
  const [previewSize, setPreviewSize] = useState('large')
  const presentation = cardPresentation(card)
  return (
    <article>
      <h2 className="gallery__detail-title">{card.name}</h2>

      <div className="gallery__controls">
        <label>
          <input type="checkbox" checked={showOverlay} onChange={(event) => setShowOverlay(event.target.checked)} />
          显示卡面图层
        </label>
        <label>
          <input
            type="checkbox"
            checked={showCombatStats}
            disabled={!showOverlay}
            onChange={(event) => setShowCombatStats(event.target.checked)}
          />
          显示战斗数值
        </label>
        <label>
          预览尺寸
          <select value={previewSize} onChange={(event) => setPreviewSize(event.target.value)}>
            <option value="large">放大 · 300 × 420</option>
            <option value="actual">手牌 · 150 × 210</option>
            <option value="original">原图比例 · 300 × 450</option>
          </select>
        </label>
      </div>
      <p className="gallery__section-note">
        数值与弱点均为未平衡的游戏设定，不代表真实模型表现。技能简称为卡牌主题，不附加特殊效果。
        <a href="/design#card-overlay">查看设计组件</a>
      </p>

      <div className="gallery__faces" data-preview-size={previewSize}>
        <figure className="gallery__face">
          <div className="gallery__card">
            {showOverlay ? (
              <HandCardFace card={toHandCardData(card)} showCombatStats={showCombatStats} />
            ) : (
              <img className="gallery__original" src={presentation.art} alt={`${card.name}原始插画`} />
            )}
          </div>
          <figcaption className="gallery__face-name">
            {showOverlay ? '正面 · 通用图层' : '原始插画 · 未叠加图层'}
          </figcaption>
        </figure>
        <figure className="gallery__face">
          {/* 背面仍按手牌的 150×210 排版，再整体放大，避免大图预览改变真实的换行。 */}
          <div className="gallery__card">
            <div className="gallery__back-inner">
              <div className="card-back">
                <span className="card-back__title">{card.name}</span>
                <p className="card-back__text">{cardBackText(card)}</p>
              </div>
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
        <MetaRow label="技能简称">{presentation.skillName}</MetaRow>
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
        <MetaRow label="卡面插画">
          <code>{presentation.art}</code>
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
