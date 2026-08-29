import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillCardHoverPreview } from '../src/screens/SkillCardHoverPreview'

describe('技能牌悬停预览', () => {
  it('同时输出正面、星象边框背面和当前技能效果', () => {
    const html = renderToStaticMarkup(
      <SkillCardHoverPreview
        card={{
          id: 'skill-preview-test',
          kind: 'skill',
          name: '上下文洪水',
          text: '为对方本轮所有作答 Agent 加入长篇无关上下文。',
          backText: '测试背面补充说明',
        }}
      />,
    )

    expect(html).toContain('上下文洪水正反面预览')
    expect(html).toContain('/cards/skills/skill-card-back.jpg')
    expect(html).toContain('为对方本轮所有作答 Agent 加入长篇无关上下文。')
    expect(html).toContain('正面')
    expect(html).toContain('背面')
  })
})
