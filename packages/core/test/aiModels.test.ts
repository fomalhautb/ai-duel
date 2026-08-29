import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_CARD_IDS,
  AI_MODEL_CARDS,
  AI_UPGRADE_CHAINS,
  downgradeTargetOf,
  upgradeTargetOf,
} from '../src/index'
import type { CardId } from '../src/index'

/**
 * 同系列升级链（src/aiModels.ts）的数据约束。
 *
 * 升降级技能就是照着这张表把场上单位的 cardId 换掉，所以链本身写错就会当场变成对局里的怪事：
 * 指向不存在的卡会让答题剧本查表抛错，同一张卡出现在两条链上则"下一代是谁"没有唯一答案。
 */
describe('AI 卡升级链', () => {
  const chained = AI_UPGRADE_CHAINS.flat()

  it('链上每张卡都在卡表里，且没有一张出现两次', () => {
    expect(chained.length).toBeGreaterThan(0)
    for (const cardId of chained) {
      expect(AI_MODEL_CARDS[cardId]).toBeDefined()
    }
    expect(new Set(chained).size).toBe(chained.length)
    // 只有一代的"链"没有意义：升不了也降不了，等于没进表。
    for (const chain of AI_UPGRADE_CHAINS) {
      expect(chain.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('升级和降级互为逆操作，走到两端就是 null', () => {
    for (const chain of AI_UPGRADE_CHAINS) {
      expect(downgradeTargetOf(chain[0]!)).toBeNull()
      expect(upgradeTargetOf(chain.at(-1)!)).toBeNull()
      for (let i = 0; i < chain.length - 1; i++) {
        expect(upgradeTargetOf(chain[i]!)).toBe(chain[i + 1])
        expect(downgradeTargetOf(chain[i + 1]!)).toBe(chain[i])
      }
    }
  })

  it('从任何一张卡一路升上去都会走到头，不会绕回自己', () => {
    for (const start of AI_MODEL_CARD_IDS) {
      const seen: CardId[] = []
      let current: CardId | null = start
      while (current !== null) {
        // 有环的话第二次踩到同一张卡就在这里失败，不会真的死循环。
        expect(seen).not.toContain(current)
        seen.push(current)
        current = upgradeTargetOf(current)
      }
    }
  })

  it('不在任何链上的卡升不了也降不了', () => {
    const inChain = new Set(chained)
    const loners = AI_MODEL_CARD_IDS.filter((cardId) => !inChain.has(cardId))
    // 18 张卡里 10 张进了四条链，剩下 8 张在卡池里各自只有一代。
    expect(loners).toHaveLength(8)
    for (const cardId of loners) {
      expect(upgradeTargetOf(cardId)).toBeNull()
      expect(downgradeTargetOf(cardId)).toBeNull()
    }
  })
})
