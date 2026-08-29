/**
 * 牌组存档的读写行为。
 *
 * 同 save.test.ts：vitest 跑在 node 环境下没有全局 localStorage，deckStore 的 try/catch
 * 会把这当成"存不进去"静默吞掉，测不到真实读写。这里手搭一个内存版顶上去。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DECK_DEMO_CARDS } from '../src/screens/deckDemoCards'
import {
  createDeck,
  DECK_NAME_MAX,
  DECK_SIZE,
  deleteDeck,
  loadDecks,
  MAX_COPIES,
  MAX_DECKS,
  renameDeck,
  resetDeckStoreCacheForTest,
  setCurrentDeck,
  updateDeckCards,
} from '../src/save/deckStore'
import type { DecksData } from '../src/save/deckStore'

/** 和 deckStore.ts 里的 DECKS_KEY 保持一致；改版本号时这里也要跟着改。 */
const DECKS_KEY = 'ai-duel-decks-v1'

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

/**
 * 一个可以中途坏掉的 localStorage：调 breakIt() 之后读写一律抛异常。
 * 模拟隐私模式 / 站点数据被禁那类环境——那里连 getItem 都抛，不是"读到空"。
 */
function createBreakableStorage(): { storage: Storage; breakIt: () => void } {
  const inner = createMemoryStorage()
  let broken = false
  const storage = {
    getItem: (key: string) => {
      if (broken) throw new Error('localStorage 不可用')
      return inner.getItem(key)
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error('localStorage 不可用')
      inner.setItem(key, value)
    },
    removeItem: (key: string) => inner.removeItem(key),
    clear: () => inner.clear(),
    key: () => null,
    get length() {
      return inner.length
    },
  } as Storage
  return {
    storage,
    breakIt: () => {
      broken = true
    },
  }
}

/** 直接往存档位塞一份数据，用来构造"已经存过"的起始状态。 */
function writeRaw(value: unknown): void {
  localStorage.setItem(DECKS_KEY, JSON.stringify(value))
}

function countCopies(cards: readonly string[], cardId: string): number {
  return cards.filter((id) => id === cardId).length
}

const KNOWN_CARD_IDS = new Set(DECK_DEMO_CARDS.map((card) => card.id))

describe('牌组存档', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    // deckStore 的内存缓存是模块级变量，跨用例活着。不清的话「读不了就用缓存」那条路径
    // 会读到上一个用例留下的牌组。
    resetDeckStoreCacheForTest()
  })

  describe('播种预设', () => {
    it('没有存档时播种三套预设，第一套是当前牌组', () => {
      const data = loadDecks()
      expect(data.decks.map((deck) => deck.id)).toEqual([
        'preset-sota',
        'preset-cn',
        'preset-skill',
      ])
      expect(data.currentId).toBe('preset-sota')
    })

    it('每套预设都是合法牌组：20 张、卡都在卡池里、同名卡不超过 2 份', () => {
      for (const deck of loadDecks().decks) {
        expect(deck.cards).toHaveLength(DECK_SIZE)
        for (const cardId of deck.cards) {
          expect(KNOWN_CARD_IDS).toContain(cardId)
          expect(countCopies(deck.cards, cardId)).toBeLessThanOrEqual(MAX_COPIES)
        }
      }
    })

    // 卡池的技能牌有 24 张，一套牌组只有 20 格，装不下全部，所以只查"技能牌占了 12 张且各不相同"。
    it('技能流带了 12 张互不重复的技能牌', () => {
      const skillIds = new Set(
        DECK_DEMO_CARDS.filter((card) => card.kind === 'skill').map((card) => card.id),
      )
      const skillDeck = loadDecks().decks.find((deck) => deck.id === 'preset-skill')
      expect(skillDeck).toBeDefined()
      const picked = skillDeck?.cards.filter((cardId) => skillIds.has(cardId)) ?? []
      expect(picked).toHaveLength(12)
      expect(new Set(picked).size).toBe(12)
    })

    it('播种结果立刻写回 localStorage，再读一次拿到的是同一份', () => {
      const first = loadDecks()
      expect(localStorage.getItem(DECKS_KEY)).not.toBeNull()
      expect(loadDecks()).toEqual(first)
    })

    it('预设可以改可以删，不会自己长回来', () => {
      deleteDeck('preset-sota')
      renameDeck('preset-cn', '国产队')
      const data = loadDecks()
      expect(data.decks.map((deck) => deck.id)).toEqual(['preset-cn', 'preset-skill'])
      expect(data.decks[0]?.name).toBe('国产队')
    })
  })

  describe('坏档回落', () => {
    const seeded = ['preset-sota', 'preset-cn', 'preset-skill']

    it('不是合法 JSON 时重新播种', () => {
      localStorage.setItem(DECKS_KEY, '不是 JSON')
      expect(loadDecks().decks.map((deck) => deck.id)).toEqual(seeded)
    })

    it('decks 不是数组时重新播种', () => {
      writeRaw({ decks: '一套牌组', currentId: 'x' })
      expect(loadDecks().decks.map((deck) => deck.id)).toEqual(seeded)
    })

    it('每一条都不合法（没有 id）时重新播种', () => {
      writeRaw({ decks: [{ name: '没有 id' }, null, 42], currentId: 'x' })
      expect(loadDecks().decks.map((deck) => deck.id)).toEqual(seeded)
    })

    it('重复 id 只留第一条', () => {
      writeRaw({
        decks: [
          { id: 'a', name: '一号', cards: [] },
          { id: 'a', name: '冒牌', cards: [] },
          { id: 'b', name: '二号', cards: [] },
        ],
        currentId: 'a',
      })
      const data = loadDecks()
      expect(data.decks.map((deck) => deck.id)).toEqual(['a', 'b'])
      expect(data.decks[0]?.name).toBe('一号')
    })

    it('牌组套数超上限时只留前 12 套', () => {
      writeRaw({
        decks: Array.from({ length: MAX_DECKS + 5 }, (_, index) => ({
          id: `d${index}`,
          name: `牌组${index}`,
          cards: [],
        })),
        currentId: 'd0',
      })
      expect(loadDecks().decks).toHaveLength(MAX_DECKS)
    })

    it('名字缺失或不是字符串时回落成「新牌组」', () => {
      writeRaw({ decks: [{ id: 'a', name: 42, cards: [] }], currentId: 'a' })
      expect(loadDecks().decks[0]?.name).toBe('新牌组')
    })
  })

  describe('currentId', () => {
    it('指向不存在的牌组时回落到第一套', () => {
      writeRaw({
        decks: [
          { id: 'a', name: '一号', cards: [] },
          { id: 'b', name: '二号', cards: [] },
        ],
        currentId: '早就删了的牌组',
      })
      expect(loadDecks().currentId).toBe('a')
    })

    it('setCurrentDeck 切到存在的牌组，切换结果会存下来', () => {
      loadDecks()
      expect(setCurrentDeck('preset-skill').currentId).toBe('preset-skill')
      expect(loadDecks().currentId).toBe('preset-skill')
    })

    it('setCurrentDeck 传不存在的 id 时不生效', () => {
      loadDecks()
      expect(setCurrentDeck('不存在').currentId).toBe('preset-sota')
    })
  })

  describe('改名', () => {
    it('trim 后截断到 10 个字符', () => {
      loadDecks()
      const data = renameDeck('preset-sota', '  这是一个特别特别长的牌组名字  ')
      expect(data.decks[0]?.name).toBe('这是一个特别特别长的')
      expect(data.decks[0]?.name).toHaveLength(DECK_NAME_MAX)
    })

    it('只有空白的名字回落成原名', () => {
      loadDecks()
      expect(renameDeck('preset-sota', '   ').decks[0]?.name).toBe('SOTA 流')
    })

    it('id 不存在时什么都不改', () => {
      const before = loadDecks()
      expect(renameDeck('不存在', '新名字')).toEqual(before)
    })
  })

  describe('新建牌组', () => {
    it('新建的是空牌组，并且自动切成当前牌组', () => {
      loadDecks()
      const data = createDeck()
      expect(data).not.toBeNull()
      const created = data?.decks.at(-1)
      expect(created?.cards).toEqual([])
      expect(created?.name).toBe('新牌组')
      expect(data?.currentId).toBe(created?.id)
    })

    it('重名自动加序号：新牌组、新牌组 2、新牌组 3', () => {
      loadDecks()
      createDeck()
      createDeck()
      createDeck()
      const names = loadDecks().decks.map((deck) => deck.name)
      expect(names.slice(-3)).toEqual(['新牌组', '新牌组 2', '新牌组 3'])
    })

    it('把中间那个序号腾出来后，新建会补进这个空位', () => {
      loadDecks()
      createDeck()
      const second = createDeck()?.decks.at(-1)
      createDeck()
      deleteDeck(second?.id ?? '')
      expect(createDeck()?.decks.at(-1)?.name).toBe('新牌组 2')
    })

    it('已经有 12 套时不再新建，返回 null', () => {
      loadDecks()
      // 三套预设 + 九套新建正好顶到上限。
      for (let i = 0; i < MAX_DECKS - 3; i += 1) {
        expect(createDeck()).not.toBeNull()
      }
      expect(loadDecks().decks).toHaveLength(MAX_DECKS)
      expect(createDeck()).toBeNull()
      expect(loadDecks().decks).toHaveLength(MAX_DECKS)
    })

    it('每套新建的牌组 id 都不重复', () => {
      loadDecks()
      for (let i = 0; i < MAX_DECKS - 3; i += 1) createDeck()
      const ids = loadDecks().decks.map((deck) => deck.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('删除牌组', () => {
    it('删掉当前牌组后切到剩下的第一套', () => {
      loadDecks()
      setCurrentDeck('preset-cn')
      const data = deleteDeck('preset-cn')
      expect(data.decks.map((deck) => deck.id)).toEqual(['preset-sota', 'preset-skill'])
      expect(data.currentId).toBe('preset-sota')
    })

    it('删掉的不是当前牌组时，当前牌组不变', () => {
      loadDecks()
      expect(deleteDeck('preset-skill').currentId).toBe('preset-sota')
    })

    it('删到一套不剩时自动补一套空的「新牌组」并设为当前', () => {
      loadDecks()
      deleteDeck('preset-sota')
      deleteDeck('preset-cn')
      const data = deleteDeck('preset-skill')
      expect(data.decks).toHaveLength(1)
      expect(data.decks[0]?.name).toBe('新牌组')
      expect(data.decks[0]?.cards).toEqual([])
      expect(data.currentId).toBe(data.decks[0]?.id)
      // 补出来的这套要真的存下来，刷新后不能又变回三套预设。
      expect(loadDecks()).toEqual(data)
    })

    it('id 不存在时什么都不删', () => {
      const before = loadDecks()
      expect(deleteDeck('不存在')).toEqual(before)
    })
  })

  describe('改卡表', () => {
    /** 取一套预设当画布，避免依赖某套预设原有的卡。 */
    function seedEmptyDeck(): DecksData {
      writeRaw({ decks: [{ id: 'a', name: '测试牌组', cards: [] }], currentId: 'a' })
      return loadDecks()
    }

    it('过滤掉卡池里没有的卡 id', () => {
      seedEmptyDeck()
      const data = updateDeckCards('a', ['gpt-4o', '并不存在的卡', 'glm-5'])
      expect(data.decks[0]?.cards).toEqual(['gpt-4o', 'glm-5'])
    })

    it('同一张卡最多留 2 份', () => {
      seedEmptyDeck()
      const data = updateDeckCards('a', ['gpt-4o', 'gpt-4o', 'gpt-4o', 'glm-5'])
      expect(data.decks[0]?.cards).toEqual(['gpt-4o', 'gpt-4o', 'glm-5'])
    })

    it('超过 20 张的部分被截掉', () => {
      seedEmptyDeck()
      const tooMany = DECK_DEMO_CARDS.flatMap((card) => [card.id, card.id])
      expect(updateDeckCards('a', tooMany).decks[0]?.cards).toHaveLength(DECK_SIZE)
    })

    it('读存档时同样会过滤：存档里被改坏的卡表读出来是干净的', () => {
      writeRaw({
        decks: [{ id: 'a', name: '测试牌组', cards: ['gpt-4o', 'gpt-4o', 'gpt-4o', '野卡'] }],
        currentId: 'a',
      })
      expect(loadDecks().decks[0]?.cards).toEqual(['gpt-4o', 'gpt-4o'])
    })

    it('cards 不是数组时读成空牌组', () => {
      writeRaw({ decks: [{ id: 'a', name: '测试牌组', cards: 'gpt-4o' }], currentId: 'a' })
      expect(loadDecks().decks[0]?.cards).toEqual([])
    })

    it('改完立刻存下来，只影响目标牌组', () => {
      loadDecks()
      const before = loadDecks().decks[1]?.cards
      updateDeckCards('preset-sota', ['gpt-2'])
      const data = loadDecks()
      expect(data.decks[0]?.cards).toEqual(['gpt-2'])
      expect(data.decks[1]?.cards).toEqual(before)
    })

    it('id 不存在时什么都不改', () => {
      const before = loadDecks()
      expect(updateDeckCards('不存在', ['gpt-2'])).toEqual(before)
    })
  })

  describe('localStorage 不可用', () => {
    it('读抛异常时接着用内存里那份，一次会话里的编辑不会被打回预设', () => {
      const { storage, breakIt } = createBreakableStorage()
      vi.stubGlobal('localStorage', storage)
      // 先正常读一次，把三套预设播下去，之后再让 storage 坏掉。
      expect(loadDecks().decks).toHaveLength(3)
      breakIt()

      const created = createDeck()
      expect(created?.decks).toHaveLength(4)
      const id = created?.currentId ?? ''

      // 新建的这套还在，改名落在它头上，而不是读回预设后什么都改不到。
      const renamed = renameDeck(id, '断档牌组')
      expect(renamed.decks).toHaveLength(4)
      expect(renamed.decks.find((deck) => deck.id === id)?.name).toBe('断档牌组')

      // 加卡写进新牌组自己，不会因为读回预设而落到 preset-sota 头上。
      const withCards = updateDeckCards(id, ['gpt-4o', 'glm-5'])
      expect(withCards.currentId).toBe(id)
      expect(withCards.decks.find((deck) => deck.id === id)?.cards).toEqual(['gpt-4o', 'glm-5'])
      expect(withCards.decks.find((deck) => deck.id === 'preset-sota')?.cards).toHaveLength(
        DECK_SIZE,
      )

      // 再读一次拿到的还是这份连续的编辑结果。
      expect(loadDecks()).toEqual(withCards)
    })

    it('一次都没读成功过时照旧播种预设', () => {
      const { storage, breakIt } = createBreakableStorage()
      breakIt()
      vi.stubGlobal('localStorage', storage)
      expect(loadDecks().decks.map((deck) => deck.id)).toEqual([
        'preset-sota',
        'preset-cn',
        'preset-skill',
      ])
    })
  })
})
