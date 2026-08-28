/**
 * 本地存档的读写行为。
 *
 * vitest 默认跑在 node 环境下，没有全局 localStorage——save.ts 的 try/catch
 * 会把这当成"存不进去"静默吞掉，测不出真实的读写效果。这里手搭一个内存版
 * localStorage 顶上去，才能测到 parseSave / persist 的实际逻辑。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CARD_POOL, INITIAL_COLLECTION } from '@ai-duel/core'
import { loadSave, recordWin, resetSave } from '../src/save/save'

/** 和 save.ts 里的 SAVE_KEY 保持一致；改版本号时这里也要跟着改。 */
const SAVE_KEY = 'ai-duel-save-v4'

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size
    },
  } as Storage
}

describe('本地存档', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  it('没有存档时回落到初始收藏', () => {
    const save = loadSave()
    expect(save.wins).toBe(0)
    expect(save.ownedCards).toEqual(INITIAL_COLLECTION)
  })

  it('存档损坏（不是合法 JSON）时回落到初始收藏', () => {
    localStorage.setItem(SAVE_KEY, '不是 JSON')
    expect(loadSave().ownedCards).toEqual(INITIAL_COLLECTION)
  })

  it('存档里的卡都不在当前卡池时当作新号处理', () => {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ ownedCards: ['卡池里已经没有的卡'], wins: 5 }),
    )
    expect(loadSave().ownedCards).toEqual(INITIAL_COLLECTION)
  })

  // 现在初始收藏就等于整个卡池，所以新号赢一局是抽不到新卡的。
  // 这条测试守着"抽不到也不能出错"，卡池扩容后它应该跟着改成断言抽得到。
  it('新号赢一局：胜场 +1，但初始收藏已经是整个卡池，抽不到新卡', () => {
    const { save, drawn } = recordWin()
    expect(save.wins).toBe(1)
    expect(drawn).toBeNull()
    expect(save.ownedCards).toEqual(INITIAL_COLLECTION)
    expect(loadSave()).toEqual(save)
  })

  it('收藏还缺卡时，赢一局会补上一张之前没有的卡', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ownedCards: [CARD_POOL[0]], wins: 0 }))
    const { save, drawn } = recordWin()
    expect(save.wins).toBe(1)
    expect(drawn).not.toBeNull()
    expect(save.ownedCards).toContain(drawn)
    expect(loadSave()).toEqual(save)
  })

  it('卡已经集齐时再赢一局，抽卡结果是 null，收藏不再增长', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ownedCards: [...CARD_POOL], wins: 3 }))
    const { save, drawn } = recordWin()
    expect(drawn).toBeNull()
    expect(save.ownedCards).toEqual(CARD_POOL)
    expect(save.wins).toBe(4)
  })

  it('重置存档回到初始收藏，localStorage 里的记录也被清掉', () => {
    recordWin()
    const reset = resetSave()
    expect(reset).toEqual({ ownedCards: INITIAL_COLLECTION, wins: 0 })
    expect(localStorage.getItem(SAVE_KEY)).toBeNull()
  })
})
