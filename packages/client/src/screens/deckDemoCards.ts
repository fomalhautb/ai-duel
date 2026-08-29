/**
 * /deck 牌组页面专用展示卡池。
 *
 * AI 牌直接复用 core 的正式定义；技能牌名称和说明来自当前设计稿，
 * 效果尚未接入规则引擎。技能牌只借用 HandCardData 的展示形状，
 * 不属于任何 AI 阵营。
 *
 */

import { AI_MODEL_CARDS } from '@ai-duel/core'
import type { HandCardData } from '../ui/HandFan'

/** 选卡页的 AI 阵营标识。和 core 无关，只用于筛选 AI 牌。 */
export type DeckFaction = 'gpt' | 'claude' | 'kimi' | 'deepseek' | 'cn' | 'other'

export interface FactionOption {
  id: DeckFaction
  /** 筛选栏上显示的中文名。 */
  label: string
}

/**
 * 筛选栏的阵营列表。
 *
 * 数组顺序就是筛选栏从左到右的顺序（照设计稿），改顺序等于改界面，别按字母排。
 * 'other' 是兜底项，凡是不属于前面几家的都归它，所以固定放最后。
 */
export const FACTIONS = [
  { id: 'gpt', label: 'GPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'cn', label: '国产通用' },
  { id: 'other', label: '其他' },
] as const satisfies readonly FactionOption[]

/**
 * /deck 的展示卡。只有 AI 牌带阵营；技能牌通过 id 取得专属技能原画。
 */
export type DeckDemoCard = HandCardData & { faction?: DeckFaction }

/**
 * 24 张技能牌展示数据。AI 牌直接取 core 的正式定义，不在这里重复维护。
 */
const SKILL_CARD_FIXTURES: DeckDemoCard[] = [
  // ---- 技能牌 ----
  {
    id: 'context-flood',
    kind: 'skill',
    name: '上下文洪水',
    text: '为对方本轮所有作答 Agent 加入长篇无关上下文。',
    backText: '为对方本轮所有作答 Agent 加入长篇无关上下文。',
  },
  {
    id: 'topic-drift',
    kind: 'skill',
    name: '话题漂移',
    text: '为对方1个作答 Agent 加入无关话题，要求综合考虑。',
    backText: '为对方1个作答 Agent 加入无关话题，要求综合考虑。',
  },
  {
    id: 'repetition-bombardment',
    kind: 'skill',
    name: '重复轰炸',
    text: '向对方1个作答 Agent 重复插入同一条无关信息。',
    backText: '向对方1个作答 Agent 重复插入同一条无关信息。',
  },
  {
    id: 'black-white-reversal',
    kind: 'skill',
    name: '黑白颠倒',
    text: '要求对方1个作答 Agent 给出与自身判断相反的答案。',
    backText: '要求对方1个作答 Agent 给出与自身判断相反的答案。',
  },
  {
    id: 'fixed-answer',
    kind: 'skill',
    name: '复读机',
    text: '对方1个作答 Agent 无论题目是什么，都只能回答香蕉。',
    backText: '对方1个作答 Agent 无论题目是什么，都只能回答香蕉。',
  },
  {
    id: 'one-sentence-answer',
    kind: 'skill',
    name: '一句话回答',
    text: '对方1个作答 Agent 只能用一句话回答。',
    backText: '对方1个作答 Agent 只能用一句话回答。',
  },
  {
    id: 'character-lock',
    kind: 'skill',
    name: '字数封锁',
    text: '对方1个作答 Agent 最终答案不超过3个字符，标点计入。',
    backText: '对方1个作答 Agent 最终答案不超过3个字符，标点计入。',
  },
  {
    id: 'clean-sweep',
    kind: 'skill',
    name: '大扫除',
    text: '移除一个本轮作用于己方 Agent 的干扰效果。',
    backText: '移除一个本轮作用于己方 Agent 的干扰效果。',
  },
  {
    id: 'jade-purification-vase',
    kind: 'skill',
    name: '玉净瓶',
    text: '移除一个本轮作用于己方 Agent 的限制效果。',
    backText: '移除一个本轮作用于己方 Agent 的限制效果。',
  },
  {
    id: 'boomerang',
    kind: 'skill',
    name: '弹弹弹',
    text: '将对方本轮对你使用的一张非环境技能牌反弹给对方。',
    backText: '将对方本轮对你使用的一张非环境技能牌反弹给对方。',
  },
  {
    id: 'golden-bell-shield',
    kind: 'skill',
    name: '金钟罩',
    text: '本轮内你和所有己方 Agent 不受其他技能牌影响。',
    backText: '本轮内你和所有己方 Agent 不受其他技能牌影响。',
  },
  {
    id: 'safe-pass',
    kind: 'skill',
    name: '保送',
    text: '选己方场上一个 Agent，本轮结算无论答案是否正确都留在场上。',
    backText: '选己方场上一个 Agent，本轮结算无论答案是否正确都留在场上。',
  },
  {
    id: 'anti-addiction',
    kind: 'skill',
    name: '防沉迷',
    text: '本轮对方最多打出2张牌，包括 Agent 和技能牌。',
    backText: '本轮对方最多打出2张牌，包括 Agent 和技能牌。',
  },
  {
    id: 'compute-compression',
    kind: 'skill',
    name: '算力压缩',
    text: '下一张己方 Agent 牌费用减少2，最低1。',
    backText: '下一张己方 Agent 牌费用减少2，最低1。',
  },
  {
    id: 'model-distillation',
    kind: 'skill',
    name: '模型蒸馏',
    text: '弃置手牌中1张 Agent，获得等同其费用加1的 Token。',
    backText: '弃置手牌中1张 Agent，获得等同其费用加1的 Token。',
  },
  {
    id: 'open-source-reproduction',
    kind: 'skill',
    name: '开源复现',
    text: '从己方弃牌区选一张 Agent 加入手牌。',
    backText: '从己方弃牌区选一张 Agent 加入手牌。',
  },
  {
    id: 'nuclear-power-station',
    kind: 'skill',
    name: '核电站',
    text: '本轮双方后续所有牌费用减少1，最低1。',
    backText: '本轮双方后续所有牌费用减少1，最低1。',
  },
  {
    id: 'far-ahead',
    kind: 'skill',
    name: '遥遥领先',
    text: '立刻结束本轮，不作答、不判定、不积分；已打出的牌与已支付 Token 不返还。',
    backText: '立刻结束本轮，不作答、不判定、不积分；已打出的牌与已支付 Token 不返还。',
  },
  {
    id: 'domestic-substitution',
    kind: 'skill',
    name: '国产替代',
    text: '双方场上没有国产标签的 Agent 均被罚下并移入弃牌区。',
    backText: '双方场上没有国产标签的 Agent 均被罚下并移入弃牌区。',
  },
  {
    id: 'version-rollback',
    kind: 'skill',
    name: '版本回退',
    text: '选择场上1个可退化的 Agent，退化1级。',
    backText: '选择场上1个可退化的 Agent，退化1级。',
  },
  {
    id: 'kids-mode',
    kind: 'skill',
    name: '儿童模式',
    text: '双方场上所有可退化 Agent 各退化1级。',
    backText: '双方场上所有可退化 Agent 各退化1级。',
  },
  {
    id: 'version-upgrade',
    kind: 'skill',
    name: '版本升级',
    text: '选择场上1个可进化的 Agent，进化1级。',
    backText: '选择场上1个可进化的 Agent，进化1级。',
  },
  {
    id: 'rising-tide',
    kind: 'skill',
    name: '鸡犬升天',
    text: '双方场上所有可进化 Agent 各进化1级。',
    backText: '双方场上所有可进化 Agent 各进化1级。',
  },
  {
    id: 'memory-shortage',
    kind: 'skill',
    name: '内存紧缺',
    text: '双方各随机保留场上一半 Agent，向上取整，其余罚下移入弃牌区。',
    backText: '双方各随机保留场上一半 Agent，向上取整，其余罚下移入弃牌区。',
  },
]

/** 正式 AI 牌按产品归入筛选项；没有独立厂商筛选项的都归到“其他”。 */
function factionForAi(cardId: string): DeckFaction {
  if (cardId.startsWith('gpt-') || cardId.startsWith('chatgpt-')) return 'gpt'
  if (cardId.startsWith('claude-')) return 'claude'
  if (cardId.startsWith('kimi-')) return 'kimi'
  if (cardId.startsWith('deepseek-')) return 'deepseek'
  if (['qwen', 'doubao', 'glm-5', 'minimax', 'yuanbao', 'wenxin-yiyan'].includes(cardId)) return 'cn'
  return 'other'
}

const SKILL_CARDS = SKILL_CARD_FIXTURES

/**
 * /deck 的实际卡池：AI 牌只使用 core 中有专属原画的 18 张正式卡；技能牌保留完整 24 张。
 */
export const DECK_DEMO_CARDS: DeckDemoCard[] = [
  ...Object.values(AI_MODEL_CARDS).map((card) => ({
    ...card,
    faction: factionForAi(card.id),
    backText: card.text,
  })),
  ...SKILL_CARDS,
]

export type DeckCardKindFilter = 'all' | 'ai' | 'skill'

/**
 * 阵营只属于 AI 牌。技能牌无论当前选择了哪个 AI 阵营，都应该完整显示。
 */
export function filterDeckCards(
  cards: readonly DeckDemoCard[],
  kind: DeckCardKindFilter,
  faction: DeckFaction | null,
): DeckDemoCard[] {
  return cards.filter(
    (card) =>
      (kind === 'all' || card.kind === kind) &&
      (card.kind === 'skill' || faction === null || card.faction === faction),
  )
}
