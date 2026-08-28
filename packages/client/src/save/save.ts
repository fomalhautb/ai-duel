/**
 * 浏览器本地存档：记录玩家的卡牌收藏和胜场。
 *
 * 只有 localStorage 这一层，不做账号、不上服务器——换个浏览器就是新号。
 * core 里的收藏逻辑是纯函数，所有 IO 和随机数都集中在这个文件里。
 */

import { CARD_POOL, drawNewCard, INITIAL_COLLECTION } from '@ai-duel/core'
import type { CardId } from '@ai-duel/core'

/**
 * key 带版本号。存档结构要改时直接换成下一个版本号：旧数据读不到就回落成新号，
 * 不用写迁移代码（项目不做向后兼容）。
 * v2 → v3 删掉了 tutorialDone（新手教程整个下线了）。
 * v3 → v4 是卡池整个换了一批（模型卡/提示卡 → AI 牌/技能牌），旧存档里的卡 id 一个都不剩。
 * v4 → v5 卡 id 全部换名（agent-* → ai-*），术语统一为英雄牌/AI 牌/技能牌，旧存档直接作废。
 * 存的卡 id 全部来自当前卡池（AI 牌 + 技能牌两类，见 core 的 CARDS）；
 * 英雄牌不进牌组也不进收藏，所以这里不存英雄。
 */
const SAVE_KEY = 'ai-duel-save-v5'

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
 * 注意现在的初始收藏就等于整个卡池（见 core 的 INITIAL_COLLECTION），
 * 所以这条抽卡链路暂时恒返回 null，只有胜场真的在涨。卡池扩容后会自动重新生效。
 *
 * @returns 写回后的存档，以及本次抽到的卡（已集齐时为 null）
 */
export function recordWin(): { save: SaveData; drawn: CardId | null } {
  const current = loadSave()
  return grantCard({ ...current, wins: current.wins + 1 })
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
