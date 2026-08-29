/**
 * 牌组页的阵营筛选。
 *
 * 阵营是**纯界面上的分组**，core 不该知道：它按「这张卡画的是谁家的模型」把 18 张 AI 归堆，
 * 只为了让卡池那一屏好找卡，规则引擎里没有任何东西读它（费用、答题、结算都和阵营无关）。
 * 所以这份表留在客户端，AI 牌加进 core 时也不用同步改 core 的类型。
 *
 * 归堆靠 id 前缀而不是另存一份「id → 阵营」的表：同一家的新模型进卡池时
 * （gpt-5、claude-6……）不用记得回来登记一次，忘了登记的后果是那张卡默默掉进「其他」，
 * 而这正是没登记过的模型该去的地方。
 */

import { getCard } from '@ai-duel/core'
import type { CardId } from '@ai-duel/core'

export type DeckFaction = 'gpt' | 'claude' | 'kimi' | 'deepseek' | 'cn' | 'other'

/** 阵营药丸。数组顺序就是界面上从左到右的顺序。 */
export const FACTIONS: readonly { id: DeckFaction; label: string }[] = [
  { id: 'gpt', label: 'GPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'cn', label: '国产通用' },
  { id: 'other', label: '其他' },
]

/**
 * 前四个阵营各自成一堆是因为同系列的卡够多（每家 2 张以上），单拎出来筛才有意义。
 * 剩下的国产模型各只有一张，凑成「国产通用」一堆；再剩下的（gemini、grok）进「其他」。
 */
const CN_GENERAL_AI: readonly CardId[] = [
  'qwen',
  'doubao',
  'glm-5',
  'minimax',
  'yuanbao',
  'wenxin-yiyan',
]

/** 一张 AI 牌属于哪个阵营。技能牌不该走这里（它们没有阵营，见 filterDeckCards）。 */
export function factionForAi(cardId: CardId): DeckFaction {
  if (cardId.startsWith('gpt-') || cardId.startsWith('chatgpt-')) return 'gpt'
  if (cardId.startsWith('claude-')) return 'claude'
  if (cardId.startsWith('kimi-')) return 'kimi'
  if (cardId.startsWith('deepseek-')) return 'deepseek'
  if (CN_GENERAL_AI.includes(cardId)) return 'cn'
  return 'other'
}

/** kind 页签的三档，和 DeckScreen 的 KIND_TABS 一一对应。 */
export type DeckCardKindFilter = 'all' | 'ai' | 'skill'

/**
 * 卡池筛选：先按种类，再按阵营。
 *
 * **阵营只作用于 AI 牌**。所以在「全部」页签下选了某个阵营时，技能牌照样全部显示——
 * 技能牌没有阵营，把它们一起筛掉等于让玩家选个阵营就再也看不见技能牌，
 * 而他并没有表达过"不想看技能牌"。
 */
export function filterDeckCards(
  cardIds: readonly CardId[],
  kind: DeckCardKindFilter,
  faction: DeckFaction | null,
): CardId[] {
  return cardIds.filter((cardId) => {
    const card = getCard(cardId)
    if (kind !== 'all' && card.kind !== kind) return false
    if (card.kind === 'skill') return true
    return faction === null || factionForAi(cardId) === faction
  })
}
