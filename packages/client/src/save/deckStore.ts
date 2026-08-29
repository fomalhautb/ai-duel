/**
 * 牌组存档：把玩家在 /deck 页拼好的牌组存进 localStorage。
 *
 * 和 save.ts 一样只有本地这一层：所有读写包在 try/catch 里静默失败（隐私模式下
 * localStorage 本身就抛异常），坏数据一律回落成默认值，结构要改就换 key 的版本号，
 * 不写迁移代码（项目不做向后兼容）。
 * 比 save.ts 多一份内存缓存（cachedDecks）：这里的每次修改都要先读回上一份数据，
 * 读不了就得靠它把一次会话里的连续编辑接起来。
 *
 * 存的是 core 的真卡 id（CARD_POOL 里那批），所以这里读出来的牌组可以直接开局；
 * 存档只保证卡 id 在卡池里，**不保证张数够开局**——玩家可以把牌组编到一半就走人，
 * 所以拿它去开局的地方（match/testMatch.ts、RoomScreen 的选卡组一步）都要自己查 DECK_SIZE。
 */

import { CARD_POOL, DECK_SIZE, STARTER_DECK } from '@ai-duel/core'
import type { CardId } from '@ai-duel/core'

/** 换存档结构时直接改版本号：旧数据解析不出来就回落成播种预设。 */
const DECKS_KEY = 'ai-duel-decks-v2'

/**
 * 一套牌组 20 张、同名卡最多 2 份、最多 12 套。
 *
 * DECK_SIZE 是 core 那份（牌组容量是规则的一部分，引擎和存档校验都读它），这里只是转出来，
 * 让选牌页的三条选卡规则从同一个文件导入，不用为一个常量再引一次 core。
 * MAX_COPIES 只有 /deck 页在守：core 不校验牌组内容，所以从选牌页放行的牌组不会再有第二道关卡。
 * 12 套是纯粹的界面约束：牌组列表再长就没法一眼扫完，顺带给 localStorage 封了顶。
 */
export { DECK_SIZE }
export const MAX_COPIES = 2
export const MAX_DECKS = 12
/** 牌组名最多 10 个字符：再长选牌页的标签就排不下。 */
export const DECK_NAME_MAX = 10
/** 新建牌组的默认名，重名时后面接序号。 */
const DEFAULT_DECK_NAME = '新牌组'

/** 卡池白名单：存档里凡是不在这个集合里的 id 都要丢掉，否则卡面渲染时 getCard 会抛错。 */
const POOL_CARD_IDS = new Set<CardId>(CARD_POOL)

export interface SavedDeck {
  id: string
  name: string
  /** 卡 id，逐份存：同一张卡带两份就在数组里出现两次。顺序即选牌顺序。 */
  cards: CardId[]
}

export interface DecksData {
  decks: SavedDeck[]
  /** 当前选中的牌组 id。读出来的存档保证它一定能在 decks 里找到。 */
  currentId: string
}

/** 名字规整：trim 后截断到 10 个字符，空名回落到调用方给的原名。 */
function clampName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  if (trimmed === '') return fallback
  // 按码点截断而不是 slice：中文名和 emoji 都算一个字符，也免得把代理对切成半个乱码。
  return [...trimmed].slice(0, DECK_NAME_MAX).join('')
}

/** 卡表规整：丢掉卡池里没有的卡、超出 2 份的重复卡，并把长度收进 20 张以内。 */
function sanitizeCards(raw: unknown): CardId[] {
  if (!Array.isArray(raw)) return []
  const copies = new Map<CardId, number>()
  const cards: CardId[] = []
  for (const cardId of raw) {
    if (typeof cardId !== 'string' || !POOL_CARD_IDS.has(cardId)) continue
    const used = copies.get(cardId) ?? 0
    if (used >= MAX_COPIES) continue
    copies.set(cardId, used + 1)
    cards.push(cardId)
    if (cards.length >= DECK_SIZE) break
  }
  return cards
}

/** 解析存档字符串，任何一处对不上就返回 null，由调用方回落到播种预设。 */
function parseDecks(raw: string): DecksData | null {
  const data: unknown = JSON.parse(raw)
  if (typeof data !== 'object' || data === null) return null
  const { decks, currentId } = data as Partial<DecksData>
  if (!Array.isArray(decks)) return null

  const ids = new Set<string>()
  const parsed: SavedDeck[] = []
  for (const deck of decks) {
    if (typeof deck !== 'object' || deck === null) continue
    const { id, name, cards } = deck as Partial<SavedDeck>
    // id 是改名和删除的唯一凭据：重复 id 会让一次操作同时命中两套牌组，后来的直接丢掉。
    if (typeof id !== 'string' || id === '' || ids.has(id)) continue
    ids.add(id)
    parsed.push({ id, name: clampName(name, DEFAULT_DECK_NAME), cards: sanitizeCards(cards) })
    if (parsed.length >= MAX_DECKS) break
  }

  const [first] = parsed
  // 一套都没剩说明这份存档已经没法用了，当作新号重新播种。
  if (first === undefined) return null
  // 当前牌组被删过或存档被改坏时，回落到第一套，绝不留下指不到人的 currentId。
  const current = typeof currentId === 'string' && ids.has(currentId) ? currentId : first.id
  return { decks: parsed, currentId: current }
}

/**
 * 首次进入时播种的那一套预设：core 的示例牌组。
 *
 * 只播一套，不再自造几套「流派」：卡池里 24 张技能牌只有「复读机」接进了规则引擎，其余全是
 * 打出即进弃牌堆的设计稿卡（见 core 的 CARDS），眼下真正拉得开差距的只有那 18 张 AI，
 * 「流派」无从谈起，多播几套等于把同一副牌换个名字摆三遍。等技能效果实装之后再考虑加。
 *
 * 预设就是普通牌组：可以改名、改卡、删掉，删完也不会自动长回来（只有一套都不剩时
 * 才补一套空的）。id 写死成 preset-starter，方便对着看是不是原始预设。
 */
function presetDecks(): SavedDeck[] {
  return [{ id: 'preset-starter', name: '起始牌组', cards: [...STARTER_DECK] }]
}

/** 播种预设。预设也走一遍 sanitizeCards，写错卡 id 只会少几张牌，不会污染存档。 */
function seedPresets(): DecksData {
  const decks = presetDecks().map((deck) => ({ ...deck, cards: sanitizeCards(deck.cards) }))
  const [first] = decks
  // presetDecks 恒返回一套，这里只是给类型检查一个交代。
  return { decks, currentId: first?.id ?? 'preset-starter' }
}

/**
 * 最近一份成功构建出来的存档，只活在内存里。
 *
 * 存在的理由是 localStorage 整个不可用的那种环境（隐私模式、站点数据被禁）：那里每次
 * getItem 都抛异常，而下面每个修改函数都要先 loadDecks 拿基准数据。没有这份缓存的话，
 * 每次读都重新播种那套预设，于是改完名下一步就被打回原名、新建的牌组在下一次
 * updateDeckCards 里根本不存在（原样返回播种数据），调用方跟着它的 currentId 走，
 * 就会把正在编辑的那一整套卡写进 preset-starter。有了缓存，这一次会话里的编辑至少能自洽，
 * 也就对得上 persist 那句"存不下就算了，这次会话照常能编辑"。
 *
 * 只在读抛异常时才顶上：能读到 localStorage 时一律以盘上那份为准。所以多标签页同时开着
 * 仍然是最后写入者胜（本来就是），黑客松阶段不处理。
 */
let cachedDecks: DecksData | null = null

function persist(data: DecksData): void {
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(data))
  } catch {
    // 隐私模式、禁用站点数据、配额占满时会抛异常。存不下就算了，这次会话照常能编辑。
  }
}

/** 写回并原样返回，让每个修改函数都只有一行收尾。顺手记进缓存，存不下时靠它接上下一步。 */
function commit(data: DecksData): DecksData {
  cachedDecks = data
  persist(data)
  return data
}

/**
 * 读牌组存档。
 *
 * 读不到、解析失败、浏览器不让读，一律播种预设，保证返回至少一套牌组，
 * 且 currentId 一定指得到人——调用方不用处理"没有牌组"的空状态。
 */
export function loadDecks(): DecksData {
  try {
    const raw = localStorage.getItem(DECKS_KEY)
    const parsed = raw === null ? null : parseDecks(raw)
    if (parsed !== null) {
      cachedDecks = parsed
      return parsed
    }
  } catch {
    // 浏览器不让读。这次会话已经攒下的那份接着用，会话内才连得上（见 cachedDecks）。
    // 注意"读到了但数据坏了"不走这条路：那种情况下面照旧重新播种。
    if (cachedDecks !== null) return cachedDecks
  }
  return commit(seedPresets())
}

/** 只给测试用：清掉内存缓存，让每个用例都从"这次会话还没读过存档"开始。 */
export function resetDeckStoreCacheForTest(): void {
  cachedDecks = null
}

/** 覆盖一套牌组的卡表（会过滤未知卡、超份数的卡和超长部分）。id 不存在时原样返回。 */
export function updateDeckCards(id: string, cards: readonly CardId[]): DecksData {
  const data = loadDecks()
  if (!data.decks.some((deck) => deck.id === id)) return data
  return commit({
    ...data,
    decks: data.decks.map((deck) =>
      deck.id === id ? { ...deck, cards: sanitizeCards(cards) } : deck,
    ),
  })
}

/** 改名：trim 后截断到 10 个字符，空名保持原名不变。id 不存在时原样返回。 */
export function renameDeck(id: string, name: string): DecksData {
  const data = loadDecks()
  const target = data.decks.find((deck) => deck.id === id)
  if (target === undefined) return data
  const next = clampName(name, target.name)
  return commit({
    ...data,
    decks: data.decks.map((deck) => (deck.id === id ? { ...deck, name: next } : deck)),
  })
}

/** 挑一个没被占用的默认名：新牌组、新牌组 2、新牌组 3……。 */
function nextDeckName(decks: readonly SavedDeck[]): string {
  const used = new Set(decks.map((deck) => deck.name))
  if (!used.has(DEFAULT_DECK_NAME)) return DEFAULT_DECK_NAME
  // 已有牌组不超过 MAX_DECKS 套，试到 MAX_DECKS + 1 必定能找到空序号。
  for (let n = 2; n <= MAX_DECKS + 1; n += 1) {
    const name = `${DEFAULT_DECK_NAME} ${n}`
    if (!used.has(name)) return name
  }
  return DEFAULT_DECK_NAME
}

/** 生成一个没被占用的牌组 id。 */
function nextDeckId(decks: readonly SavedDeck[]): string {
  const used = new Set(decks.map((deck) => deck.id))
  // 时间戳 + 随机后缀足够了；万一撞上（同一毫秒里摇出同一个后缀）就再摇一次。
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    if (!used.has(id)) return id
  }
  // 连撞十次基本不可能，兜底用序号扫一个必然空着的 id 出来。
  let index = decks.length
  while (used.has(`deck-${index}`)) index += 1
  return `deck-${index}`
}

/**
 * 新建一套空牌组并切过去（点"新建"就是要马上编辑它）。
 *
 * @returns 写回后的存档；已经有 12 套时不新建，返回 null 让调用方提示上限
 */
export function createDeck(): DecksData | null {
  const data = loadDecks()
  if (data.decks.length >= MAX_DECKS) return null
  const deck: SavedDeck = {
    id: nextDeckId(data.decks),
    name: nextDeckName(data.decks),
    cards: [],
  }
  return commit({ decks: [...data.decks, deck], currentId: deck.id })
}

/**
 * 删掉一套牌组。id 不存在时原样返回。
 *
 * 删的是当前牌组就切到剩下的第一套；删到一套不剩会自动补一套空的「新牌组」，
 * 因为选牌页没有"没有牌组"这个状态可画。
 */
export function deleteDeck(id: string): DecksData {
  const data = loadDecks()
  if (!data.decks.some((deck) => deck.id === id)) return data
  const decks = data.decks.filter((deck) => deck.id !== id)
  const [firstLeft] = decks
  if (firstLeft === undefined) {
    const fresh: SavedDeck = { id: nextDeckId([]), name: DEFAULT_DECK_NAME, cards: [] }
    return commit({ decks: [fresh], currentId: fresh.id })
  }
  const currentId = decks.some((deck) => deck.id === data.currentId) ? data.currentId : firstLeft.id
  return commit({ decks, currentId })
}

/**
 * 按固定 id 写入一套牌组并切成当前牌组：已存在就整套覆盖，不存在就新建。
 *
 * 只有新手教程在用（组牌教学要有一套 id 稳定、可以反复重玩覆盖的牌组）。
 * 普通的新建走 createDeck——那条路每次都发新 id，重玩教程会把牌组列表堆满。
 *
 * 覆盖已存在的那套时不动它在列表里的位置，玩家重玩教程不会看到牌组顺序跳一下。
 * 已经满 MAX_DECKS 套又要新建时，挤掉列表最前面那套：这只可能发生在
 * "玩家自己攒够 12 套之后又从头玩一遍教程"，为这个边角保留一条更复杂的规则不值当。
 */
export function putDeck(id: string, name: string, cards: readonly CardId[]): DecksData {
  const data = loadDecks()
  const deck: SavedDeck = { id, name: clampName(name, DEFAULT_DECK_NAME), cards: sanitizeCards(cards) }
  const existing = data.decks.some((item) => item.id === id)
  const decks = existing
    ? data.decks.map((item) => (item.id === id ? deck : item))
    : [...data.decks, deck]
  while (decks.length > MAX_DECKS) decks.shift()
  return commit({ decks, currentId: id })
}

/** 切换当前牌组。id 不存在时原样返回（不会把 currentId 指飞）。 */
export function setCurrentDeck(id: string): DecksData {
  const data = loadDecks()
  if (!data.decks.some((deck) => deck.id === id)) return data
  return commit({ ...data, currentId: id })
}
