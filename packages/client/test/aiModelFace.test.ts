import { describe, expect, it } from 'vitest'
import { AI_MODEL_CARDS } from '@ai-duel/core'
import { AI_MODEL_FACE } from '../src/ui/aiModelFace'

/**
 * 费用圆章是逐张对着原画上那枚星章摆的（见 aiModelFace.ts 的 costBadge），
 * 这里守的是「加了新 AI 牌却忘了配圆章」和「圆心填得离谱把圆章挤出卡面」这两件事。
 */

/** 圆章直径（技能牌原画上印的那枚的 1.3 倍）；真正生效的那份写在 cardFaceOverlay.css 里。 */
const BADGE_SIZE = 20.8

describe('AI 卡面费用圆章', () => {
  it('每张 AI 牌都配了圆章坐标', () => {
    for (const id of Object.keys(AI_MODEL_CARDS)) {
      expect(AI_MODEL_FACE[id], `${id} 缺卡面配置`).toBeDefined()
    }
  })

  it('圆章整个留在卡面里', () => {
    // 卡是 2:3，直径按卡宽算，换算到卡高的百分比要乘 2/3（所以半径是 BADGE_SIZE / 3）。
    for (const [id, face] of Object.entries(AI_MODEL_FACE)) {
      const { x, y } = face.costBadge
      expect(x - BADGE_SIZE / 2, `${id} 圆章左边出界`).toBeGreaterThan(0)
      expect(y - BADGE_SIZE / 3, `${id} 圆章上边出界`).toBeGreaterThan(0)
    }
  })
})
