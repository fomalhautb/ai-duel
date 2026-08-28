/**
 * 卡牌图鉴 / 卡面调试页（/card）。
 *
 * 一次把 core 里的全部卡牌按原始尺寸（150×210）摆出来，用的就是对局里那套 HandCardFace，
 * 所以卡面排版一改，这一页立刻能看出十张卡各自会变成什么样——它存在的意义就是这个"对照表"，
 * 不是给玩家看的图鉴界面。
 *
 * 模型卡的弱点画像和提示卡的目标维度现在卡面上已经有版面（弱点标签行、"打·xx"），
 * 每张卡下面仍然把它们用纯文字再列一遍：卡面上那几个标签又小又挤，
 * 调排版时需要一个"这张卡的数据到底是什么"的对照，才看得出卡面有没有把它们画错或画漏。
 */

import { useLocation } from 'wouter'
import { CARDS, WEAKNESS_KINDS } from '@ai-duel/core'
import type { Card, ModelCard, PromptCard } from '@ai-duel/core'
import { HandCardFace } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { CARD_ART_PLACEHOLDERS } from '../ui/cardArt'
import { WEAKNESS_LABELS } from '../ui/labels'

const ALL_CARDS = Object.values(CARDS)
const MODEL_CARDS = ALL_CARDS.filter((card): card is ModelCard => card.kind === 'model')
const PROMPT_CARDS = ALL_CARDS.filter((card): card is PromptCard => card.kind === 'prompt')

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
    cost: card.cost,
    text: card.text,
    backText: '图鉴页只看正面。',
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

/** 只列出真正暴露的那几维（0 的维度对打法没有意义，列出来只会把这块塞满）。 */
function exposedWeaknesses(card: ModelCard): string[] {
  return WEAKNESS_KINDS.filter((kind) => card.weaknesses[kind] > 0).map(
    (kind) => `${WEAKNESS_LABELS[kind]} ${card.weaknesses[kind]}`,
  )
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
        <h2 className="gallery__section-title">模型卡（{MODEL_CARDS.length}）</h2>
        <div className="gallery__grid">
          {MODEL_CARDS.map((card) => (
            <article className="gallery__item" key={card.id}>
              <div className="gallery__card">
                <HandCardFace card={toHandCardData(card)} />
              </div>
              <dl className="gallery__meta">
                <div className="gallery__meta-row">
                  <dt className="gallery__meta-key">弱点</dt>
                  <dd className="gallery__meta-value">
                    {exposedWeaknesses(card).join(' · ') || '（六维全 0）'}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="gallery__section">
        <h2 className="gallery__section-title">提示卡（{PROMPT_CARDS.length}）</h2>
        <div className="gallery__grid">
          {PROMPT_CARDS.map((card) => (
            <article className="gallery__item" key={card.id}>
              <div className="gallery__card">
                <HandCardFace card={toHandCardData(card)} />
              </div>
              <dl className="gallery__meta">
                <div className="gallery__meta-row">
                  <dt className="gallery__meta-key">目标维度</dt>
                  <dd className="gallery__meta-value">{WEAKNESS_LABELS[card.targetWeakness]}</dd>
                </div>
                <div className="gallery__meta-row">
                  <dt className="gallery__meta-key">基础伤害</dt>
                  <dd className="gallery__meta-value">{card.damage}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
