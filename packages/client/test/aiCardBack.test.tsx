import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AI_MODEL_CARDS } from '@ai-duel/core'
import { AiCardBack } from '../src/ui/AiCardBack'
import { toHandCardData } from '../src/ui/handCardData'

describe('AI 卡牌正反面文案', () => {
  it('背面同时展示 AI 名称、技能名和技能效果', () => {
    const card = toHandCardData(AI_MODEL_CARDS['gpt-2']!)
    const html = renderToStaticMarkup(<AiCardBack card={card} />)

    expect(html).toContain('GPT-2')
    expect(html).toContain('开天辟地')
    expect(html).toContain('若本轮没有任何技能牌作用于自己，Agent 消耗 -2 Token')
  })
})
