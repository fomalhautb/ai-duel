/**
 * 战场小卡上的角标和放大查看那行字幕。
 *
 * 这两样是玩家在战场上唯一能看出"这张卡本轮被谁打过"的地方，所以要盯住两件事：
 * 引擎往 `AiInstance.affectedBy` 记的每一张牌都挂得出角标，以及字幕报的是牌名而不是状态。
 * 单位直接按纯数据手工造（AiInstance 就是一份 JSON，见 core 的 types.ts）——
 * 用真引擎凑出"被干扰又被保送"的局面要打好几轮，而这里验的只是显示。
 */

import { describe, expect, it } from 'vitest'
import { SKILL_DESIGN_CARDS } from '@ai-duel/core'
import type { AiInstance, CardId } from '@ai-duel/core'
import { affectedCaptionOf, SKILL_EFFECT_MARKS, tileMarksOf } from '../src/ui/tileMarks'

function unit(fields: Partial<AiInstance> = {}): AiInstance {
  return { instanceId: 'p0-c1', cardId: 'qwen', owner: 0, ...fields }
}

/** 只取角标上的字，class 另有几条单独验。 */
function textsOf(ai: AiInstance, shielded = false): string[] {
  return tileMarksOf(ai, shielded).map((mark) => mark.text)
}

describe('战场小卡的角标', () => {
  it('什么都没打过就一枚不挂', () => {
    expect(tileMarksOf(unit(), false)).toEqual([])
  })

  it('本轮打在身上的技能牌各挂一枚，顺序就是命中先后', () => {
    expect(textsOf(unit({ affectedBy: ['fixed-answer', 'safe-pass'] }))).toEqual([
      '复读中',
      '保送',
    ])
    expect(textsOf(unit({ affectedBy: ['safe-pass', 'fixed-answer'] }))).toEqual([
      '保送',
      '复读中',
    ])
  })

  it('鸡犬升天不走本轮那一批：它挂的是常驻的「已进化」，不会重复挂两枚', () => {
    // 引擎升一次会同时写 affectedBy 和 evolvedTimes（见 core 的 engine.ts），
    // 两笔各有各的用处，但角标只能出一枚。
    expect(textsOf(unit({ affectedBy: ['rising-tide'], evolvedTimes: 1 }))).toEqual(['已进化'])
    // 进下一轮 affectedBy 被清掉，角标照样挂着——卡面身份是永久换掉的。
    expect(textsOf(unit({ evolvedTimes: 1 }))).toEqual(['已进化'])
    // 升过好几次就把次数写出来。
    expect(textsOf(unit({ evolvedTimes: 3 }))).toEqual(['已进化 ×3'])
  })

  it('表里没有的牌落到通用的「被影响」，不会静悄悄少一枚', () => {
    // 新接一张作用于单位的技能牌、却忘了在 SKILL_EFFECT_MARKS 里补文案时就是这一档。
    expect(textsOf(unit({ affectedBy: ['topic-drift'] }))).toEqual(['被影响'])
  })

  it('金钟罩挂在每个单位上，因为它罩的是整个人，记不进单位身上', () => {
    expect(textsOf(unit(), true)).toEqual(['金钟罩'])
    // 刚上场、身上一张牌都没打过的单位照样被罩着。
    expect(textsOf(unit({ affectedBy: ['safe-pass'] }), true)).toEqual(['保送', '金钟罩'])
  })

  it('两种常驻标记同时挂时，进化排在英雄技能的升降级前面', () => {
    expect(textsOf(unit({ evolvedTimes: 1, levelShift: 1 }))).toEqual(['已进化', '已升级'])
  })

  it('升降级排在最后，0 次（升完又被降回去）不挂', () => {
    expect(textsOf(unit({ affectedBy: ['safe-pass'], levelShift: 1 }))).toEqual(['保送', '已升级'])
    expect(textsOf(unit({ levelShift: -2 }))).toEqual(['已降级'])
    expect(textsOf(unit({ levelShift: 0 }))).toEqual([])
  })

  it('配色靠修饰类分档：干扰是默认那档，保送这类多带一个类', () => {
    expect(tileMarksOf(unit({ affectedBy: ['fixed-answer'] }), false)[0]!.className).toBe(
      'battle__tile-mark',
    )
    expect(tileMarksOf(unit({ affectedBy: ['safe-pass'] }), false)[0]!.className).toBe(
      'battle__tile-mark battle__tile-mark--safe',
    )
  })

  it('文案表里的键都是真卡，别写错 id 悄悄失配', () => {
    for (const cardId of Object.keys(SKILL_EFFECT_MARKS) as CardId[]) {
      expect(SKILL_DESIGN_CARDS[cardId]).toBeDefined()
    }
  })
})

describe('放大查看那行字幕', () => {
  it('没被影响过就不渲染这一行', () => {
    expect(affectedCaptionOf(unit(), false)).toBeNull()
  })

  it('报的是牌名而不是角标上那个状态——玩家点开就是想知道是谁干的', () => {
    expect(affectedCaptionOf(unit({ affectedBy: ['fixed-answer', 'safe-pass'] }), false)).toBe(
      '本轮受影响：复读机、保送',
    )
  })

  it('金钟罩也算一张，它护着这个单位，只是记在主人身上', () => {
    expect(affectedCaptionOf(unit({ affectedBy: ['rising-tide'] }), true)).toBe(
      '本轮受影响：鸡犬升天、金钟罩',
    )
  })
})
