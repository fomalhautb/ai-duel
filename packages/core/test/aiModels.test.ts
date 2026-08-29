import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_CARD_IDS,
  AI_MODEL_CARDS,
  AI_UPGRADE_CHAINS,
  downgradeTargetOf,
  upgradeTargetOf,
} from '../src/index'
import type { CardId } from '../src/index'

const EXPECTED_SKILLS = {
  'gpt-2': ['开天辟地', '若本轮没有任何技能牌作用于自己，Agent 消耗 -2 Token'],
  'gpt-3-5': ['对话启蒙', '出牌费用 -1 Token；答对后再返还 1 Token'],
  'gpt-4o': ['多模感知', '回答图片题目时，答错不被丢弃'],
  'chatgpt-5-6-sol': ['统筹推演', '每局一次，本轮第一张作用于自己的对方技能牌无效'],
  'claude-5-sonnet': ['文理兼修', '可以屏蔽「话题漂移」及「重复轰炸」一次'],
  'claude-fable-5': [
    '深思织文',
    '每局一次，可无视对方技能牌向题目中新增的文本，只根据原始题目作答',
  ],
  'deepseek-r1': ['链式推理', '如果第一次回答错误，可以额外进行一次回答'],
  'deepseek-v4': ['深海求索', '若本轮双方答题结果相同，则结算时本 Agent 消耗 -1 Token'],
  gemini: [
    '多模融合',
    '回答图片题时，第一次回答错误可以重新观察图片并再次回答；每局最多触发一次',
  ],
  qwen: ['万语通晓', '每局一次，可以忽略对方技能牌向题目中添加的一条额外指令，只执行原题要求'],
  'kimi-k2-6': ['长卷寻踪', '第一次使用此 Agent，可以对对方使用一次上下文洪水干扰'],
  'kimi-k3': ['群星协作', '使对方回答额外消耗 1 Token，每局最多触发一次'],
  doubao: [
    '灵感相伴',
    '若本轮没有任何技能牌作用于自己且回答正确，返还 1 Token；每局最多触发一次',
  ],
  'glm-5': ['知行合一', '每局一次，若双方 Agent 都答错，本轮直接视为 GLM-5 获胜，不再比较 Token'],
  minimax: [
    '声影共鸣',
    '同一问题内部生成两条相互独立的候选答案；若答案不同，再执行一次最终裁决',
  ],
  yuanbao: ['博览集智', '每局一次，可以将一张技能牌以手牌中另一张技能牌的 Token 结算'],
  grok: ['破界直言', '回答问题前先检查一下题目是否有「坑」'],
  'wenxin-yiyan': ['文心妙笔', '回答文字题目时，免疫对方干扰类型技能'],
} as const

describe('AI 专属技能文案', () => {
  it('18 张 AI 的技能名和效果与设计表一致', () => {
    expect(Object.keys(AI_MODEL_CARDS)).toEqual(Object.keys(EXPECTED_SKILLS))
    expect(
      Object.fromEntries(
        Object.entries(AI_MODEL_CARDS).map(([id, card]) => [id, [card.skillName, card.skillText]]),
      ),
    ).toEqual(EXPECTED_SKILLS)
  })
})

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
