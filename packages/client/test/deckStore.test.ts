/**
 * 牌组存档的读写行为。
 *
 * 同 save.test.ts：vitest 跑在 node 环境下没有全局 localStorage，deckStore 的 try/catch
 * 会把这当成"存不进去"静默吞掉，测不到真实读写。这里手搭一个内存版顶上去。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CARD_POOL, isDeckable, STARTER_DECK } from '@ai-duel/core'
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
const DECKS_KEY = 'ai-duel-decks-v2'

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

const KNOWN_CARD_IDS = new Set(CARD_POOL)

/** 卡池里能进牌组的那批（灰牌除外，见 core 的 isDeckable）。 */
const DECKABLE_CARD_IDS = CARD_POOL.filter(isDeckable)

/**
 * 测试里当素材用的三张真卡。
 * 从卡池头上取，不写死 id：卡池改名时这份测试跟着走，不用一处处改字符串。
 * 必须跳过灰牌——存档会把它们当脏数据剔掉，拿它当素材写进去就取不回来。
 * `!` 是给 noUncheckedIndexedAccess 让路——能进牌组的至少 20 张，前三张一定在。
 */
const [CARD_A, CARD_B, CARD_C] = [
  DECKABLE_CARD_IDS[0]!,
  DECKABLE_CARD_IDS[1]!,
  DECKABLE_CARD_IDS[2]!,
]

/** 进不了牌组的那种卡，用来验存档会把它剔掉。卡池里眼下一定有（GPT-2、文心一言）。 */
const UNDECKABLE_CARD = CARD_POOL.find((id) => !isDeckable(id))!

describe('牌组存档', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    // deckStore 的内存缓存是模块级变量，跨用例活着。不清的话「读不了就用缓存」那条路径
    // 会读到上一个用例留下的牌组。
    resetDeckStoreCacheForTest()
  })

  describe('播种预设', () => {
    it('没有存档时播种一套「起始牌组」并设为当前', () => {
      const data = loadDecks()
      expect(data.decks.map((deck) => deck.id)).toEqual(['preset-starter'])
      expect(data.decks[0]?.name).toBe('起始牌组')
      expect(data.currentId).toBe('preset-starter')
    })

    // 预设直接取 core 的示例牌组，它本来就是一副能开局的牌，这里守着"没在存档层被改坏"。
    it('预设就是 core 的示例牌组：20 张、卡都在卡池里、同名卡不超过 2 份', () => {
      const deck = loadDecks().decks[0]
      expect(deck?.cards).toEqual([...STARTER_DECK])
      expect(deck?.cards).toHaveLength(DECK_SIZE)
      for (const cardId of deck?.cards ?? []) {
        expect(KNOWN_CARD_IDS).toContain(cardId)
        expect(countCopies(deck?.cards ?? [], cardId)).toBeLessThanOrEqual(MAX_COPIES)
      }
    })

    it('播种结果立刻写回 localStorage，再读一次拿到的是同一份', () => {
      const first = loadDecks()
      expect(localStorage.getItem(DECKS_KEY)).not.toBeNull()
      expect(loadDecks()).toEqual(first)
    })

    it('预设可以改名，改完不会被播种覆盖回去', () => {
      loadDecks()
      renameDeck('preset-starter', '我的牌组')
      expect(loadDecks().decks[0]?.name).toBe('我的牌组')
    })

    // 删掉唯一一套会自动补一套空的（见 deleteDeck），所以这里先建一套再删预设，
    // 才测得到"预设删了就是删了、不会自己长回来"。
    it('预设可以删，删完不会自己长回来', () => {
      loadDecks()
      createDeck()
      deleteDeck('preset-starter')
      expect(loadDecks().decks.map((deck) => deck.id)).not.toContain('preset-starter')
    })
  })

  describe('坏档回落', () => {
    const seeded = ['preset-starter']

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
      const created = createDeck()?.decks.at(-1)
      const id = created?.id ?? ''
      expect(setCurrentDeck('preset-starter').currentId).toBe('preset-starter')
      expect(setCurrentDeck(id).currentId).toBe(id)
      expect(loadDecks().currentId).toBe(id)
    })

    it('setCurrentDeck 传不存在的 id 时不生效', () => {
      loadDecks()
      expect(setCurrentDeck('不存在').currentId).toBe('preset-starter')
    })
  })

  describe('改名', () => {
    it('trim 后截断到 10 个字符', () => {
      loadDecks()
      const data = renameDeck('preset-starter', '  这是一个特别特别长的牌组名字  ')
      expect(data.decks[0]?.name).toBe('这是一个特别特别长的')
      expect(data.decks[0]?.name).toHaveLength(DECK_NAME_MAX)
    })

    it('只有空白的名字回落成原名', () => {
      loadDecks()
      expect(renameDeck('preset-starter', '   ').decks[0]?.name).toBe('起始牌组')
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
      // 一套预设 + 十一套新建正好顶到上限。
      for (let i = 0; i < MAX_DECKS - 1; i += 1) {
        expect(createDeck()).not.toBeNull()
      }
      expect(loadDecks().decks).toHaveLength(MAX_DECKS)
      expect(createDeck()).toBeNull()
      expect(loadDecks().decks).toHaveLength(MAX_DECKS)
    })

    it('每套新建的牌组 id 都不重复', () => {
      loadDecks()
      for (let i = 0; i < MAX_DECKS - 1; i += 1) createDeck()
      const ids = loadDecks().decks.map((deck) => deck.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('删除牌组', () => {
    /** 预设 + 两套新建，够测"删当前"和"删别人"两条路。返回这两套新建的 id。 */
    function seedThreeDecks(): [string, string] {
      loadDecks()
      const first = createDeck()?.decks.at(-1)?.id ?? ''
      const second = createDeck()?.decks.at(-1)?.id ?? ''
      return [first, second]
    }

    it('删掉当前牌组后切到剩下的第一套', () => {
      const [first, second] = seedThreeDecks()
      setCurrentDeck(second)
      const data = deleteDeck(second)
      expect(data.decks.map((deck) => deck.id)).toEqual(['preset-starter', first])
      expect(data.currentId).toBe('preset-starter')
    })

    it('删掉的不是当前牌组时，当前牌组不变', () => {
      const [, second] = seedThreeDecks()
      setCurrentDeck('preset-starter')
      expect(deleteDeck(second).currentId).toBe('preset-starter')
    })

    it('删到一套不剩时自动补一套空的「新牌组」并设为当前', () => {
      const [first, second] = seedThreeDecks()
      deleteDeck(first)
      deleteDeck(second)
      const data = deleteDeck('preset-starter')
      expect(data.decks).toHaveLength(1)
      expect(data.decks[0]?.name).toBe('新牌组')
      expect(data.decks[0]?.cards).toEqual([])
      expect(data.currentId).toBe(data.decks[0]?.id)
      // 补出来的这套要真的存下来，刷新后不能又变回预设。
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
      const data = updateDeckCards('a', [CARD_A, '并不存在的卡', CARD_B])
      expect(data.decks[0]?.cards).toEqual([CARD_A, CARD_B])
    })

    it('丢掉进不了牌组的灰牌', () => {
      // 灰牌在卡池里（卡池要摆出来给人看），但构筑页不让加，存档里也不该留下——
      // 老存档里那两张就是这么被清掉的。
      seedEmptyDeck()
      const data = updateDeckCards('a', [CARD_A, UNDECKABLE_CARD, CARD_B])
      expect(data.decks[0]?.cards).toEqual([CARD_A, CARD_B])
    })

    it('同一张卡最多留 2 份', () => {
      seedEmptyDeck()
      const data = updateDeckCards('a', [CARD_A, CARD_A, CARD_A, CARD_B])
      expect(data.decks[0]?.cards).toEqual([CARD_A, CARD_A, CARD_B])
    })

    it('超过 20 张的部分被截掉', () => {
      seedEmptyDeck()
      const tooMany = CARD_POOL.flatMap((cardId) => [cardId, cardId])
      expect(updateDeckCards('a', tooMany).decks[0]?.cards).toHaveLength(DECK_SIZE)
    })

    it('读存档时同样会过滤：存档里被改坏的卡表读出来是干净的', () => {
      writeRaw({
        decks: [{ id: 'a', name: '测试牌组', cards: [CARD_A, CARD_A, CARD_A, '野卡'] }],
        currentId: 'a',
      })
      expect(loadDecks().decks[0]?.cards).toEqual([CARD_A, CARD_A])
    })

    it('cards 不是数组时读成空牌组', () => {
      writeRaw({ decks: [{ id: 'a', name: '测试牌组', cards: CARD_A }], currentId: 'a' })
      expect(loadDecks().decks[0]?.cards).toEqual([])
    })

    it('改完立刻存下来，只影响目标牌组', () => {
      loadDecks()
      const other = createDeck()?.decks.at(-1)?.id ?? ''
      updateDeckCards(other, [CARD_C])
      updateDeckCards('preset-starter', [CARD_A])
      const data = loadDecks()
      expect(data.decks[0]?.cards).toEqual([CARD_A])
      expect(data.decks.find((deck) => deck.id === other)?.cards).toEqual([CARD_C])
    })

    it('id 不存在时什么都不改', () => {
      const before = loadDecks()
      expect(updateDeckCards('不存在', [CARD_A])).toEqual(before)
    })
  })

  describe('localStorage 不可用', () => {
    it('读抛异常时接着用内存里那份，一次会话里的编辑不会被打回预设', () => {
      const { storage, breakIt } = createBreakableStorage()
      vi.stubGlobal('localStorage', storage)
      // 先正常读一次，把预设播下去，之后再让 storage 坏掉。
      expect(loadDecks().decks).toHaveLength(1)
      breakIt()

      const created = createDeck()
      expect(created?.decks).toHaveLength(2)
      const id = created?.currentId ?? ''

      // 新建的这套还在，改名落在它头上，而不是读回预设后什么都改不到。
      const renamed = renameDeck(id, '断档牌组')
      expect(renamed.decks).toHaveLength(2)
      expect(renamed.decks.find((deck) => deck.id === id)?.name).toBe('断档牌组')

      // 加卡写进新牌组自己，不会因为读回预设而落到 preset-starter 头上。
      const withCards = updateDeckCards(id, [CARD_A, CARD_B])
      expect(withCards.currentId).toBe(id)
      expect(withCards.decks.find((deck) => deck.id === id)?.cards).toEqual([CARD_A, CARD_B])
      expect(withCards.decks.find((deck) => deck.id === 'preset-starter')?.cards).toHaveLength(
        DECK_SIZE,
      )

      // 再读一次拿到的还是这份连续的编辑结果。
      expect(loadDecks()).toEqual(withCards)
    })

    it('一次都没读成功过时照旧播种预设', () => {
      const { storage, breakIt } = createBreakableStorage()
      breakIt()
      vi.stubGlobal('localStorage', storage)
      expect(loadDecks().decks.map((deck) => deck.id)).toEqual(['preset-starter'])
    })
  })
})
