/**
 * 组牌教学的步骤表（规格 §12 的 Step 18~20）。
 *
 * 和对战那张步骤表（steps.ts）一个路子：纯数据 + 纯函数，不碰 DOM 也不认屏幕坐标，
 * 每一步只说"高亮哪个语义元素、现在唯一放行的是哪张卡、提示说哪句话"。
 * 跑它的是 TutorialDeckStage.tsx，那边只负责把状态接到 DeckScreen 和引导层上。
 *
 * 这一段比对战那段简单得多：没有演出信号也没有对手，推进条件只有两种——
 * 开场那句话停够时间，以及"玩家把指定的那张卡加进牌组了"。
 */

import { CARD_POOL, DECK_SIZE, getCard } from '@ai-duel/core'
import type { CardId } from '@ai-duel/core'

/** 教程写进存档的那套牌组：id 固定，重玩教程时整套覆盖（见 deckStore 的 putDeck）。 */
export const TUTORIAL_DECK_ID = 'tutorial-first-deck'
export const TUTORIAL_DECK_NAME = '我的第一套牌组'

/**
 * 三张要玩家亲手加进去的牌，顺序就是教学顺序：两张 AI 牌，再一张技能牌。
 *
 * 挑的都是教学对战里刚见过的牌——第 1 轮派出去的 GPT-3.5、教学局起手里那张豆包、
 * 第 2 轮打出去的「复读机」。玩家对它们有印象，"加入牌组"才不是在选三张陌生卡。
 *
 * 三张在牌组页的默认筛选状态下都看得见：种类页签默认是「全部」、阵营默认不选
 *（见 DeckScreen 的 kindTab / faction 初值），所以教程不需要替玩家去动那两行筛选。
 */
export const TUTORIAL_DECK_PICKS: readonly CardId[] = ['gpt-3-5', 'doubao', 'fixed-answer']

/**
 * 进组牌页时先替玩家填好的那 17 张（规格 §12：计数从 `17 / 20` 起步）。
 *
 * 取法是"卡池里除掉上面那三张之外的前 17 张"，于是天然满足两条约束：
 * 三张待加的牌一份都还没占（每张卡最多 MAX_COPIES 份的规则怎么都碰不到），
 * 而 17 + 3 正好是 DECK_SIZE。
 *
 * 卡池现在是 18 张 AI + 10 张已开放的技能牌（共 28 张），去掉两张 AI 之后前 17 张正好是
 * "16 张 AI + 1 张技能"，每张各一份，构筑校验（20 张、每张至多 MAX_COPIES 份、都在收藏里）
 * 全部通过。取自 CARD_POOL 还顺带保证了预填里不会混进「即将上线」的牌——那 14 张不在卡池里。
 * 卡池增减后这里仍然只取前 17 张，不用改；缩到 20 张以下才会不够填，由测试守着。
 */
export function tutorialDeckPrefill(): CardId[] {
  return CARD_POOL.filter((cardId) => !TUTORIAL_DECK_PICKS.includes(cardId)).slice(
    0,
    DECK_SIZE - TUTORIAL_DECK_PICKS.length,
  )
}

/** 步骤 id。照规格 §12 排：先说清楚要凑 20 张，再逐张加。 */
export type DeckStepId = 'DECK_INTRO' | 'DECK_AI_1' | 'DECK_AI_2' | 'DECK_SKILL' | 'DECK_READY'

/** 组牌页认得的语义锚点，对应界面上打了 `data-tutorial-anchor` 的元素。 */
export type DeckAnchorName = 'deckCounter' | 'deckConfirm'

/** 一个高亮目标：要么是页面上的固定锚点，要么是卡池里的某一张卡。 */
export type DeckHighlight =
  | { kind: 'anchor'; name: DeckAnchorName }
  | { kind: 'poolCard'; cardId: CardId }

export interface DeckStep {
  id: DeckStepId
  /** 一句话提示，照规格原文写。 */
  instruction: string
  highlight: DeckHighlight[]
  /**
   * 这一步唯一放行的卡池卡；null = 这一步不许再加牌（开场和收尾两步）。
   * 其余操作（移除、改名、切换牌组……）整段教学一律关着，不逐步写。
   */
  allowedCardId: CardId | null
  /** 「确认牌组」能不能点。只有最后一步是 true。 */
  allowConfirm: boolean
  /** 只有开场那步靠计时往下走；其余步等 allowedCardId 那张牌被加进牌组。 */
  advanceAfterMs?: number
  next: DeckStepId | null
}

/** 开场那句话停多久。够读完一句，又不至于让人以为界面卡住。 */
const INTRO_MS = 3200

const [FIRST_AI, SECOND_AI, SKILL] = TUTORIAL_DECK_PICKS as [CardId, CardId, CardId]

export const DECK_STEPS: DeckStep[] = [
  {
    id: 'DECK_INTRO',
    instruction: '比赛开始前，先组建你的 20 张牌组。',
    highlight: [{ kind: 'anchor', name: 'deckCounter' }],
    allowedCardId: null,
    allowConfirm: false,
    advanceAfterMs: INTRO_MS,
    next: 'DECK_AI_1',
  },
  {
    id: 'DECK_AI_1',
    instruction: '先加入一张 AI 牌。',
    highlight: [{ kind: 'poolCard', cardId: FIRST_AI }],
    allowedCardId: FIRST_AI,
    allowConfirm: false,
    next: 'DECK_AI_2',
  },
  {
    id: 'DECK_AI_2',
    instruction: '不同 AI 擅长的任务可能不同。',
    highlight: [{ kind: 'poolCard', cardId: SECOND_AI }],
    allowedCardId: SECOND_AI,
    allowConfirm: false,
    next: 'DECK_SKILL',
  },
  {
    id: 'DECK_SKILL',
    instruction: '技能牌不能答题，但可以影响对局。',
    highlight: [{ kind: 'poolCard', cardId: SKILL }],
    allowedCardId: SKILL,
    allowConfirm: false,
    next: 'DECK_READY',
  },
  {
    id: 'DECK_READY',
    instruction: '牌组完成。',
    highlight: [{ kind: 'anchor', name: 'deckConfirm' }],
    allowedCardId: null,
    allowConfirm: true,
    next: null,
  },
]

export const DECK_FIRST_STEP: DeckStepId = 'DECK_INTRO'

const STEP_BY_ID = new Map(DECK_STEPS.map((step) => [step.id, step]))

/** 按 id 取一步。取不到说明步骤表里的 next 写错了，直接抛错。 */
export function deckStep(id: DeckStepId): DeckStep {
  const step = STEP_BY_ID.get(id)
  if (step === undefined) throw new Error(`组牌步骤表里没有这一步：${id}`)
  return step
}

/**
 * 现在能不能加这张卡。
 *
 * 教程期间只有当前这一步点名的那张放得进去——包括"再加一份已经加过的牌"也一并挡掉，
 * 否则玩家在 DECK_AI_2 那步连点两下第一张卡就会把牌组填到 20 张，后面两步没牌可加。
 */
export function deckCardAllowed(step: DeckStep, cardId: CardId): boolean {
  return step.allowedCardId !== null && step.allowedCardId === cardId
}

/**
 * 把一个高亮目标换算成 CSS 选择器。
 *
 * 卡池里的卡按 `data-flip-id` 定位（DeckScreen 给每张卡池卡挂的就是 `pool:<卡 id>`），
 * 限定在 `.deck-grid` 里是因为牌组格子那边的迷你卡带的是 `deck:<份 key>`，
 * 万一将来两套前缀撞上，也不至于高亮到右面板里去。
 *
 * 不套 CSS.escape：卡 id 是卡池里写死的一批 kebab-case 标识符，没有需要转义的字符，
 * 而这个函数要能在 node 环境的单元测试里直接调（那里没有 CSS 这个全局对象）。
 */
export function deckSelectorOf(highlight: DeckHighlight): string {
  if (highlight.kind === 'anchor') return `[data-tutorial-anchor="${highlight.name}"]`
  return `.deck-grid [data-flip-id="pool:${highlight.cardId}"]`
}

/** 点到被锁住的东西时说的那句话。教学阶段的锁必须有话说，否则玩家只会觉得界面坏了。 */
export function deckBlockTip(step: DeckStep): string {
  if (step.allowedCardId === null) {
    return step.allowConfirm ? '牌组已经配好了，点「确认牌组」继续' : '先看完这句提示'
  }
  return `教学阶段：先加入高亮的那张「${getCard(step.allowedCardId).name}」`
}
