/**
 * 浏览器本地存档：记录玩家的卡牌收藏和胜场。
 *
 * 只有 localStorage 这一层，不做账号、不上服务器——换个浏览器就是新号。
 * core 里的收藏逻辑是纯函数，所有 IO 和随机数都集中在这个文件里。
 */

import { CARD_POOL, drawNewCard, INITIAL_COLLECTION } from '@ai-duel/core'
import type { CardId } from '@ai-duel/core'

/**
 * key 带版本号。存档结构要改时直接换成 v2：旧数据读不到就回落成新号，
 * 不用写迁移代码（项目不做向后兼容）。
 */
const SAVE_KEY = 'ai-duel-save-v1'

export interface SaveData {
  /** 已拥有的卡牌定义 id。 */
  ownedCards: CardId[]
  /** 累计胜场。 */
  wins: number
}

function initialSave(): SaveData {
  return { ownedCards: [...INITIAL_COLLECTION], wins: 0 }
}

/** 解析存档字符串，任何一处对不上就返回 null，由调用方回落到初始收藏。 */
function parseSave(raw: string): SaveData | null {
  const data: unknown = JSON.parse(raw)
  if (typeof data !== 'object' || data === null) return null
  const { ownedCards, wins } = data as Partial<SaveData>
  if (!Array.isArray(ownedCards) || typeof wins !== 'number') return null

  // 卡池随时可能删卡，存档里残留的卡 id 必须丢掉，否则渲染时 getCard 会抛错。
  const owned = ownedCards.filter((id) => typeof id === 'string' && CARD_POOL.includes(id))
  // 一张都不剩说明这份存档已经和当前卡池对不上了，当作新号处理。
  if (owned.length === 0) return null
  return { ownedCards: owned, wins }
}

/** 读存档。读不到、解析失败、浏览器不让读，一律回落到初始收藏。 */
export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw === null) return initialSave()
    return parseSave(raw) ?? initialSave()
  } catch {
    // 隐私模式、禁用站点数据、存储配额被占满时，localStorage 本身就会抛异常。
    // 这种环境下游戏照常能玩，只是这次的进度存不下来。
    return initialSave()
  }
}

function persist(save: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
  } catch {
    // 同 loadSave：写不进去就算了，不打断对局。
  }
}

/**
 * 记一场胜利：胜场 +1，并从未拥有的卡里抽一张。
 *
 * 随机数在这里生成而不是在 core 里，core 要保持纯函数。
 *
 * @returns 写回后的存档，以及本次抽到的卡（已集齐时为 null）
 */
export function recordWin(): { save: SaveData; drawn: CardId | null } {
  const current = loadSave()
  const drawn = drawNewCard(current.ownedCards, Math.random())
  const save: SaveData = {
    ownedCards: drawn === null ? current.ownedCards : [...current.ownedCards, drawn],
    wins: current.wins + 1,
  }
  persist(save)
  return { save, drawn }
}
