/**
 * 牌组存档：把玩家在 /deck 页拼好的牌组存进 localStorage。
 *
 * 和 save.ts 一样只有本地这一层：所有读写包在 try/catch 里静默失败（隐私模式下
 * localStorage 本身就抛异常），坏数据一律回落成默认值，结构要改就换 key 的版本号，
 * 不写迁移代码（项目不做向后兼容）。
 * 比 save.ts 多一份内存缓存（cachedDecks）：这里的每次修改都要先读回上一份数据，
 * 读不了就得靠它把一次会话里的连续编辑接起来。
 *
 * 存的是 deckDemoCards 里那 42 张 demo 卡的 id——那批卡进不了对局，所以这份存档
 * 目前只服务选牌页的编辑体验。真卡池落地后 cardId 的取值范围会整个换掉，
 * 到时候直接升 key 版本号作废旧档。
 */

import { DECK_DEMO_CARDS } from '../screens/deckDemoCards'

/** 换存档结构时直接改版本号：旧数据解析不出来就回落成播种预设。 */
const DECKS_KEY = 'ai-duel-decks-v1'

/**
 * 一套牌组 20 张、同名卡最多 2 份、最多 12 套。
 *
 * 前两条就是 /deck 页的选卡规则，DeckScreen.tsx 直接从这里导入，只此一份。
 * 12 套是纯粹的界面约束：牌组列表再长就没法一眼扫完，顺带给 localStorage 封了顶。
 */
export const DECK_SIZE = 20
export const MAX_COPIES = 2
export const MAX_DECKS = 12
/** 牌组名最多 10 个字符：再长选牌页的标签就排不下。 */
export const DECK_NAME_MAX = 10
/** 新建牌组的默认名，重名时后面接序号。 */
const DEFAULT_DECK_NAME = '新牌组'

/** 卡池白名单：存档里凡是不在这个集合里的 id 都要丢掉，否则卡面渲染时取不到数据。 */
const DEMO_CARD_IDS = new Set(DECK_DEMO_CARDS.map((card) => card.id))

export interface SavedDeck {
  id: string
  name: string
  /** demo 卡 id，逐份存：同一张卡带两份就在数组里出现两次。顺序即选牌顺序。 */
  cards: string[]
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
function sanitizeCards(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const copies = new Map<string, number>()
  const cards: string[] = []
  for (const cardId of raw) {
    if (typeof cardId !== 'string' || !DEMO_CARD_IDS.has(cardId)) continue
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

/** 把一串卡 id 各复制 copies 份，同一张卡的几份挨在一起。 */
function repeat(cardIds: readonly string[], copies: number): string[] {
  return cardIds.flatMap((cardId) => Array<string>(copies).fill(cardId))
}

/**
 * 首次进入时播种的三套预设。
 *
 * 预设就是普通牌组：可以改名、改卡、删掉，删完也不会自动长回来（只有一套都不剩时
 * 才补一套空的）。id 写死成 preset-*，方便对着看是不是原始预设。
 *
 * 卡池里没有 Gemini / Grok / 豆包 / MiniMax / 腾讯元宝 / 文心一言 这几张卡，
 * 对不上的位置按"同一类角色"就近换成卡池里实际有的卡：
 * Gemini → Mistral Grand 3、Grok → Llama 5 Scout（都是国外大厂的另一张旗舰/开放权重牌）；
 * 国产四张缺卡换成卡池里剩下的国产 AI 牌（Step-3.5、K1.5、V3.2），
 * 最后一个空位没有国产 AI 牌可用了，补一张 cn 阵营的技能牌「复读机」。
 *
 * 技能牌那 12 张老卡（小费贿赂、系统提示词套取……）在卡池换成设计稿的 24 张正式技能牌
 * 之后整批消失了，这里按「同阵营 + 同角色（干扰 / 增益 / 防守）」就近顶上：
 * 系统提示词套取 → 上下文洪水（gpt·干扰）、立场翻转测试 → 金钟罩（cn）、
 * 单位换算连环 → 复读机（cn·干扰）。
 * 「技能流」原本要带齐全部技能牌，现在 24 张一套装不下（一套只有 20 格），
 * 改成取卡池里的前 12 张——正好每个阵营各 2 张，配 8 张 AI 牌凑满 20。
 */
function presetDecks(): SavedDeck[] {
  return [
    {
      id: 'preset-sota',
      name: 'SOTA 流',
      cards: [
        ...repeat(
          [
            'gpt-5-6-sol',
            'claude-fable-5',
            'claude-5-sonnet',
            'gpt-4o',
            'deepseek-v4',
            'kimi-k3',
            'mistral-grand-3',
            'glm-5',
            'llama-5-scout',
          ],
          2,
        ),
        'context-flood',
        'golden-bell-shield',
      ],
    },
    {
      id: 'preset-cn',
      name: '国产模型流',
      cards: repeat(
        [
          'qwen-4-max',
          'glm-5',
          'kimi-k2-6',
          'kimi-k3',
          'deepseek-r1',
          'deepseek-v4',
          'step-3-5',
          'kimi-k1-5',
          'deepseek-v3-2',
          'fixed-answer',
        ],
        2,
      ),
    },
    {
      id: 'preset-skill',
      name: '技能流',
      cards: [
        // 卡池里的前 12 张技能牌，每个阵营各 2 张（顺序就是卡池顺序）。
        'context-flood',
        'topic-drift',
        'repetition-bombardment',
        'black-white-reversal',
        'fixed-answer',
        'one-sentence-answer',
        'character-lock',
        'clean-sweep',
        'jade-purification-vase',
        'boomerang',
        'golden-bell-shield',
        'safe-pass',
        'gpt-4o',
        'claude-fable-5',
        'deepseek-v4',
        'kimi-k3',
        'glm-5',
        'qwen-4-max',
        'mistral-grand-3',
        'llama-5-scout',
      ],
    },
  ]
}

/** 播种预设。预设也走一遍 sanitizeCards，写错卡 id 只会少几张牌，不会污染存档。 */
function seedPresets(): DecksData {
  const decks = presetDecks().map((deck) => ({ ...deck, cards: sanitizeCards(deck.cards) }))
  const [first] = decks
  // presetDecks 恒返回三套，这里只是给类型检查一个交代。
  return { decks, currentId: first?.id ?? 'preset-sota' }
}

/**
 * 最近一份成功构建出来的存档，只活在内存里。
 *
 * 存在的理由是 localStorage 整个不可用的那种环境（隐私模式、站点数据被禁）：那里每次
 * getItem 都抛异常，而下面每个修改函数都要先 loadDecks 拿基准数据。没有这份缓存的话，
 * 每次读都重新播种三套预设，于是改完名下一步就被打回原名、新建的牌组在下一次
 * updateDeckCards 里根本不存在（原样返回播种数据），调用方跟着它的 currentId 走，
 * 就会把正在编辑的那一整套卡写进 preset-sota。有了缓存，这一次会话里的编辑至少能自洽，
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
 * 读不到、解析失败、浏览器不让读，一律播种三套预设，保证返回至少一套牌组，
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
export function updateDeckCards(id: string, cards: string[]): DecksData {
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

/** 切换当前牌组。id 不存在时原样返回（不会把 currentId 指飞）。 */
export function setCurrentDeck(id: string): DecksData {
  const data = loadDecks()
  if (!data.decks.some((deck) => deck.id === id)) return data
  return commit({ ...data, currentId: id })
}
