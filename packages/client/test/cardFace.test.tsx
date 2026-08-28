import { renderToStaticMarkup } from 'react-dom/server'
import { Router } from 'wouter'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AI_MODEL_CARD_IDS, CARDS } from '@ai-duel/core'
import { CardFaceOverlay } from '../src/ui/CardFaceOverlay'
import { HandCardFace } from '../src/ui/HandFan'
import type { HandCardData } from '../src/ui/HandFan'
import { AI_MODEL_PRESENTATIONS } from '../src/ui/aiModelArt'
import { cardAccentForArt, cardPresentation } from '../src/ui/cardPresentation'
import { cardBackText } from '../src/ui/cardText'
import { CardGallery, DeckGallery } from '../src/dev/CardGallery'
import { MatchSessionProvider } from '../src/match/MatchSession'

const model = CARDS['gpt-3-5']!
const displayedModel: HandCardData = {
  ...model,
  ...cardPresentation(model),
  backText: cardBackText(model),
}

describe('卡面展示数据', () => {
  it('图鉴包含 Gemini，且不再展示四张占位模型', () => {
    const html = renderToStaticMarkup(<Router ssrPath="/card"><MatchSessionProvider><CardGallery /></MatchSessionProvider></Router>)
    expect(html).toContain('Gemini')
    expect(html).toContain('/cards/models/gemini.webp')
    for (const name of ['幻觉先知', '上下文金鱼', '刻板鹦鹉', '榜单冠军']) expect(html).not.toContain(name)
  })
  it('牌组页面展示实际张数、全部新卡和基础牌重复数量', () => {
    const html = renderToStaticMarkup(<Router ssrPath="/deck"><MatchSessionProvider><DeckGallery /></MatchSessionProvider></Router>)
    expect(html).toContain('默认牌组 · 22 张 / 20 种')
    for (const id of AI_MODEL_CARD_IDS) expect(html).toContain(`${CARDS[id]!.name} · ×1`)
    expect(html).toContain('诱导性提问 · ×2')
    expect(html).not.toContain('榜单冠军')
  })

  it('每张现有卡都获得 4～6 字简称，且不改动 core 数据', () => {
    const before = JSON.stringify(CARDS)
    for (const card of Object.values(CARDS)) {
      const presentation = cardPresentation(card)
      expect(Array.from(presentation.skillName).length).toBeGreaterThanOrEqual(4)
      expect(Array.from(presentation.skillName).length).toBeLessThanOrEqual(6)
      expect(existsSync(new URL(`../public${presentation.art}`, import.meta.url))).toBe(true)
      expect(presentation.accent).toBe(cardAccentForArt(presentation.art))
    }
    expect(JSON.stringify(CARDS)).toBe(before)
  })

  it('18 张 AI 各自绑定独立原画，并完整输出卡名、费用和简称', () => {
    expect(Object.keys(AI_MODEL_PRESENTATIONS).sort()).toEqual([...AI_MODEL_CARD_IDS].sort())
    const arts = new Set<string>()
    for (const id of AI_MODEL_CARD_IDS) {
      const card = CARDS[id]!
      const presentation = cardPresentation(card)
      expect(presentation.art).toBe(`/cards/models/${id}.webp`)
      arts.add(presentation.art)
      const html = renderToStaticMarkup(<HandCardFace card={{ ...card, ...presentation, backText: cardBackText(card) }} />)
      expect(html).toContain(card.name)
      expect(html).toContain(`消耗 ${card.cost} Token`)
      expect(html).toContain(presentation.skillName)
    }
    expect(arts.size).toBe(18)
  })

  it('费用和战斗数值以调用方传来的实例数据为准，改实例 id 不会改变插画', () => {
    const instance = { ...displayedModel, id: 'instance-42', cost: 0, power: 9, integrity: 1 }
    const html = renderToStaticMarkup(<HandCardFace card={instance} />)
    expect(html).toContain(`src="${displayedModel.art}"`)
    expect(html).toContain('消耗 0 Token')
    expect(html).toContain('算力 9')
    expect(html).toContain('完整度 1')
    expect(html).not.toContain('偏见0')
  })

  it('详情背面保留完整描述和规则，不因正面精简而丢失', () => {
    for (const card of Object.values(CARDS)) {
      const text = cardBackText(card)
      expect(text).toContain(card.text)
      expect(text).toContain(card.kind === 'model' ? '完整画像' : `基础 ${card.damage}`)
    }
  })
})

describe('通用卡面图层', () => {
  it('纯卡面保留费用、技能与卡名，隐藏战斗信息和长描述', () => {
    const html = renderToStaticMarkup(<HandCardFace card={displayedModel} showCombatStats={false} />)
    expect(html).toContain(displayedModel.name)
    expect(html).toContain(displayedModel.skillName)
    expect(html).toContain(`消耗 ${model.cost} Token`)
    expect(html).not.toContain('card-face__combat')
    expect(html).not.toContain(model.text)
  })

  it('长中英文名称完整输出，使用 SVG 限宽而非省略号', () => {
    const name = '多语言模型 Super Long Agent Name 2026'
    const html = renderToStaticMarkup(<CardFaceOverlay cost={12} skillName="多模态理解" name={name} accent="#415953" />)
    expect(html).toContain(name)
    expect(html).toContain('textLength="610"')
    expect(html).toContain('lengthAdjust="spacingAndGlyphs"')
    expect(html).toContain('--card-accent:#415953')
    expect(html).toContain('消耗 12 Token')
  })

  it('文字中的标记被转义，不能作为 SVG 或 HTML 注入', () => {
    const html = renderToStaticMarkup(<CardFaceOverlay cost={1} skillName="测试能力" name="<script>alert(1)</script>" />)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('提示卡仍显示目标维度和真实伤害，不混入模型数值', () => {
    const card = CARDS['context-flood']!
    const data: HandCardData = { ...card, ...cardPresentation(card), backText: cardBackText(card) }
    const html = renderToStaticMarkup(<HandCardFace card={data} />)
    expect(html).toContain('伤害 3')
    expect(html).toContain('打·上下文遗忘')
    expect(html).not.toContain('算力')
  })
})
