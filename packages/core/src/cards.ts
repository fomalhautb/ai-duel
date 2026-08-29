import type { CardId, HandCard } from './types'
import { AI_MODEL_CARDS, PLAYABLE_AI_CARD_IDS } from './aiModels'
import { SKILL_DESIGN_CARDS } from './skillCards'

/**
 * 全部卡牌定义：十八张具名 AI 牌（表在 aiModels.ts，那边一张卡对一张原画）
 * 加上 24 张技能牌（表在 skillCards.ts，同样一张卡对一张原画）。
 *
 * **这不等于卡池**：有两类牌留在这张表里，好让牌组页和图鉴照常画出它们，但不进
 * collection.ts 的 CARD_POOL，选不进牌组也上不了牌桌——
 * 24 张技能牌里没开放的那 14 张（「即将上线」），
 * 以及 18 张 AI 里 OpenRouter 调不到模型的那 2 张（「暂未接入」，见 aiModels.ts）。
 * 要"能进牌组的牌"请读 CARD_POOL，别读这张表。
 *
 * 开放的那 10 张正好就是接进了引擎的 10 张（名单和各自的结算见 skillCards.ts 的文件头注释）；
 * 其余 14 张还是占位牌——打出即进弃牌堆，什么都不发生，
 * 卡背摆的是设计稿定下的效果全文（`plannedEffect`）外加一句"还没实装"。
 *
 * 这里只收牌组里能出现的牌（HandCard）。英雄牌不进牌组，单独放在 heroes.ts。
 */
export const CARDS: Record<CardId, HandCard> = {
  ...AI_MODEL_CARDS,
  ...SKILL_DESIGN_CARDS,
}

/**
 * 取卡牌定义。
 * 查不到说明牌组数据写错了（不是玩家操作能触发的情况），所以直接抛错而不是返回 undefined。
 */
export function getCard(cardId: CardId): HandCard {
  const card = CARDS[cardId]
  if (!card) throw new Error(`未知卡牌：${cardId}`)
  return card
}

/**
 * 牌组固定容量：一副牌就是这么多张，不多不少。
 * /deck 构筑页拿它当上限和进度条分母，存档校验也拿它判牌组是否合法，
 * 所以写成常量，免得两边各写一个 20、改一处漏一处。
 */
export const DECK_SIZE = 20

/*
 * 下面三套预设牌组：新玩家一进来就有这三副能直接开局的牌，各是一种打法。
 * 客户端把它们播成最初的三套牌组存档（见 client 的 deckStore）。
 *
 * 三副的共同约束（由 collection 的测试守着）：各 20 张（DECK_SIZE）、同名卡最多 3 份
 * （构筑页的 MAX_COPIES，预设不该出现玩家自己编不出来的牌组）、
 * 只用 `INITIAL_COLLECTION` 里的卡（那也就是 CARD_POOL），
 * 否则新玩家会拿到自己还没解锁、甚至还没开放的卡。
 * 这几条不在这里 import collection.ts 现校验：牌组是常量，写错了应该在测试里当场红，
 * 而不是等玩家开局才发现。
 *
 * 一局最多摸 5（起手）+ 8（第 2~5 轮各 2 张，见 engine.ts 的 ROUND_DRAW_SIZE）= 13 张，
 * 20 张管够，三副都不会抽空。
 *
 * 技能牌只能从已开放的那 10 张里挑（见 skillCards.ts），所以三副的技能位重合不少；
 * 真正把它们区分开的是 AI 牌的费用结构。
 */

/**
 * 默认牌组（平衡）：14 张 AI + 6 张技能，国产和国外 AI 各 7 张，费用 2~6 铺开。
 *
 * 定位是"什么都摸得到"的入门牌组：低费（2 点）4 张保证开局出得起，中费（3~4 点）8 张是主力，
 * 高费只留 Claude Fable 5 一张当上限。技能位一张一种，把开放技能的几类都放进来——
 * 干扰（复读机、黑白颠倒）、解干扰（玉净瓶）、保护（保送）、减费（核电站）、进化（鸡犬升天），
 * 也顺带覆盖了两条出牌链路：要选目标的和打出即完事的。
 *
 * 唯独不放「国产替代」：它按字面清掉双方场上所有非国产 Agent，而这副牌一半是国外 AI，
 * 打出去多半是先清自己。
 */
export const BALANCED_DECK: CardId[] = [
  // 国外 7 张
  'gpt-3-5',
  'gpt-3-5',
  'gpt-4o',
  'gpt-4o',
  'claude-5-sonnet',
  'gemini',
  'claude-fable-5',
  // 国产 7 张
  'doubao',
  'doubao',
  'deepseek-r1',
  'deepseek-r1',
  'qwen',
  'kimi-k2-6',
  'glm-5',
  // 技能 6 张
  'rising-tide',
  'black-white-reversal',
  'safe-pass',
  'fixed-answer',
  'jade-purification-vase',
  'nuclear-power-station',
]

/**
 * 低费流：14 张 AI 全是 2~3 点的便宜牌，靠数量铺场，再用升级牌把它们变成贵牌。
 *
 * 这副的核心是「鸡犬升天」（带满 3 张）：它顺着 `AiCard.evolvesTo` 把双方场上可进化的
 * Agent 各升一级，所以 AI 位优先塞进化链的链头——GPT-3.5、DeepSeek R1、Kimi K2.6 各 3 张，
 * 一共 9 张能被它升级，等于用 2 点的价钱把 2~3 点的单位换成 4~5 点的。
 * 注意它升的是**双方**的场，对面也铺着可进化单位时会白喂对面，这是这副牌自带的风险。
 *
 * 另外两种技能都在给铺场让路：「核电站」让本轮后续所有牌各减 1 费，一轮多铺一两个单位；
 * 「模型蒸馏」花 1 点弃掉手里多余的便宜 AI 换回费用 +1 的 Token，把重复的手牌变成额度。
 */
export const LOW_COST_DECK: CardId[] = [
  // 可进化的链头 9 张：全是「鸡犬升天」的升级目标
  'gpt-3-5',
  'gpt-3-5',
  'gpt-3-5',
  'deepseek-r1',
  'deepseek-r1',
  'deepseek-r1',
  'kimi-k2-6',
  'kimi-k2-6',
  'kimi-k2-6',
  // 其余便宜 AI 5 张
  'doubao',
  'doubao',
  'doubao',
  'qwen',
  'minimax',
  // 技能 6 张
  'rising-tide',
  'rising-tide',
  'rising-tide',
  'nuclear-power-station',
  'nuclear-power-station',
  'model-distillation',
]

/**
 * 强卡流：12 张 AI 全是 4~7 点的高费牌，配 6 张保护牌，让打出来的贵单位活到结算。
 *
 * 贵单位一旦答错就被罚下，一轮的 Token 全打了水漂，所以保护位给得厚：
 * 「保送」3 张（答错也留在场上）、「玉净瓶」2 张（解掉身上的干扰）、「金钟罩」1 张
 *（本轮整个己方不受技能牌影响；它按字面全挡，连自己后面打出的技能牌也一起挡掉，所以只带 1 张）。
 *
 * 「模型蒸馏」2 张是这副牌唯一的起手解：第 1 轮上限只有 5 点（见 engine.ts 的
 * INITIAL_TOKEN_MAX），而这里最便宜的 AI 也要 4 点。花 1 点弃掉手里一张 7 点的
 * ChatGPT 5.6 Sol 能换回 8 点 Token，正好把前两轮的额度垫起来。
 */
export const HIGH_COST_DECK: CardId[] = [
  // 高费 AI 12 张
  'chatgpt-5-6-sol',
  'chatgpt-5-6-sol',
  'claude-fable-5',
  'claude-fable-5',
  'deepseek-v4',
  'deepseek-v4',
  'kimi-k3',
  'gpt-4o',
  'gpt-4o',
  'claude-5-sonnet',
  'grok',
  'gemini',
  // 保护 6 张
  'safe-pass',
  'safe-pass',
  'safe-pass',
  'jade-purification-vase',
  'jade-purification-vase',
  'golden-bell-shield',
  // 起手解 2 张
  'model-distillation',
  'model-distillation',
]

/**
 * 三套预设，顺序就是牌组页里从上到下的顺序。
 *
 * 客户端播种时按这个顺序建牌组，第一套（默认牌组）会被设成当前牌组。
 */
export const PRESET_DECKS: readonly CardId[][] = [BALANCED_DECK, LOW_COST_DECK, HIGH_COST_DECK]
