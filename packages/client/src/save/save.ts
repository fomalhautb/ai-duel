/**
 * 浏览器本地存档：记录玩家的卡牌收藏、胜场和教程进度。
 *
 * 只有 localStorage 这一层，不做账号、不上服务器——换个浏览器就是新号。
 * core 里的收藏逻辑是纯函数，所有 IO 和随机数都集中在这个文件里。
 */

import { CARD_POOL, drawNewCard, INITIAL_COLLECTION } from '@ai-duel/core'
import type { CardId } from '@ai-duel/core'
import { TUTORIAL_LEVEL_COUNT } from '../tutorial/levels'

/**
 * key 带版本号。存档结构要改时直接换成 v3：旧数据读不到就回落成新号，
 * 不用写迁移代码（项目不做向后兼容）。
 * v1 → v2 加的是 tutorialDone，所以 v1 存档会被当成"没玩过"重新走一遍教程。
 */
const SAVE_KEY = 'ai-duel-save-v2'

export interface SaveData {
  /** 已拥有的卡牌定义 id。 */
  ownedCards: CardId[]
  /** 累计胜场。 */
  wins: number
  /**
   * 已通关的教程关卡数，取值 0..TUTORIAL_LEVEL_COUNT。
   * 首页的"一键开始"就是靠它分流：没通关完就进下一关教程，通关完了直接进匹配房。
   */
  tutorialDone: number
}

function initialSave(): SaveData {
  return { ownedCards: [...INITIAL_COLLECTION], wins: 0, tutorialDone: 0 }
}

/** 解析存档字符串，任何一处对不上就返回 null，由调用方回落到初始收藏。 */
function parseSave(raw: string): SaveData | null {
  const data: unknown = JSON.parse(raw)
  if (typeof data !== 'object' || data === null) return null
  const { ownedCards, wins, tutorialDone } = data as Partial<SaveData>
  if (!Array.isArray(ownedCards) || typeof wins !== 'number') return null
  if (typeof tutorialDone !== 'number') return null

  // 卡池随时可能删卡，存档里残留的卡 id 必须丢掉，否则渲染时 getCard 会抛错。
  const owned = ownedCards.filter((id) => typeof id === 'string' && CARD_POOL.includes(id))
  // 一张都不剩说明这份存档已经和当前卡池对不上了，当作新号处理。
  if (owned.length === 0) return null
  return {
    ownedCards: owned,
    wins,
    // 教程关卡数可能被砍，夹一下，否则进度会指向一个不存在的关卡。
    tutorialDone: clampTutorial(tutorialDone),
  }
}

function clampTutorial(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.floor(value), 0), TUTORIAL_LEVEL_COUNT)
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

/** 从未拥有的卡里抽一张并写回存档。随机数在这里生成，core 要保持纯函数。 */
function grantCard(save: SaveData): { save: SaveData; drawn: CardId | null } {
  const drawn = drawNewCard(save.ownedCards, Math.random())
  const next: SaveData = {
    ...save,
    ownedCards: drawn === null ? save.ownedCards : [...save.ownedCards, drawn],
  }
  persist(next)
  return { save: next, drawn }
}

/**
 * 记一场胜利：胜场 +1，并从未拥有的卡里抽一张。
 *
 * @returns 写回后的存档，以及本次抽到的卡（已集齐时为 null）
 */
export function recordWin(): { save: SaveData; drawn: CardId | null } {
  const current = loadSave()
  return grantCard({ ...current, wins: current.wins + 1 })
}

/**
 * 记一关教程通关，同样奖一张新卡。
 *
 * 用 max 而不是 +1，因为玩家可以从首页重玩已经通关的关卡，
 * 重玩不该把进度往回退，也不该让进度越刷越高。
 */
export function completeTutorialLevel(level: number): { save: SaveData; drawn: CardId | null } {
  const current = loadSave()
  const tutorialDone = clampTutorial(Math.max(current.tutorialDone, level))
  return grantCard({ ...current, tutorialDone })
}

/** 清空存档，回到新号状态。给演示和调试用（首页有入口）。 */
export function resetSave(): SaveData {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // 同上，删不掉也不影响这次会话。
  }
  return initialSave()
}
