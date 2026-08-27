/**
 * 教程关卡数据。
 *
 * 三关全是写死的剧本：关卡指定双方牌组和先手，对手每回合出什么牌也写死，
 * 玩家这边则由界面锁住——每一步只有引导指定的那张牌能点（见 MatchStage 的 restriction）。
 * 两头都定死之后，局面每一步都是可预测的，引导文案里的数字才敢写实数。
 *
 * 关键技巧：**每关的牌组只用一两种卡，而且整副都是同一张**。
 * 这样洗牌洗成什么顺序都无所谓，起手一定是那张卡，
 * 剧本就不必依赖 seed 到底洗出了什么（seed 仍然固定，只是不必去反推它的结果）。
 */

import type { CardId, PlayerId } from '@ai-duel/core'

/** 提示卡打谁：本体，或者对面场上第一个指定 cardId 的模型。 */
export type ScriptTarget = { kind: 'face' } | { kind: 'model'; cardId: CardId }

export const FACE: ScriptTarget = { kind: 'face' }
export function enemyModel(cardId: CardId): ScriptTarget {
  return { kind: 'model', cardId }
}

/** 脚本对手的一次出牌。模型卡不需要 target。 */
export interface ScriptedPlay {
  cardId: CardId
  target?: ScriptTarget
}

/** 对手一个回合要出的牌，按顺序执行，执行完自动结束回合。 */
export type OpponentTurn = ScriptedPlay[]

/**
 * 玩家要完成的一步。
 * - `continue` 是纯讲解，界面上只给一个"继续"按钮，什么牌都点不动。
 * - `play` / `end-turn` 是真操作，界面只放行这一个动作。
 */
export type TutorialAction =
  | { kind: 'continue' }
  | { kind: 'play'; cardId: CardId; target?: ScriptTarget }
  | { kind: 'end-turn' }

export interface TutorialStep {
  text: string
  action: TutorialAction
}

export interface TutorialLevel {
  level: number
  title: string
  /** 一句话说明这关教什么，显示在引导条上方。 */
  summary: string
  /** 洗牌种子。牌组是同质的，所以它其实不影响剧本，固定下来只为可复现。 */
  seed: number
  /**
   * 玩家坐哪个座位。引擎固定 0 号先手，所以这个字段同时决定了谁先手：
   * 玩家坐 1 号就等于把先手让给对手（第 2 关就靠这个，玩家一上来才有模型可打）。
   */
  playerSeat: PlayerId
  playerDeck: CardId[]
  opponentDeck: CardId[]
  /** 起始完整度，不填走引擎默认的 20。第 3 关把对手压低，好在三刀内演到结算。 */
  playerIntegrity?: number
  opponentIntegrity?: number
  /** 对手第 N 次轮到自己时出的牌。用完之后对手只会结束回合。 */
  opponentTurns: OpponentTurn[]
  /** 玩家的引导步骤，全部走完即通关——不另设胜利条件，因为每一步都被界面锁死了。 */
  steps: TutorialStep[]
}

/** 整副同一张卡，长度取得比"起手 3 张 + 每回合抽 1"够用就行。 */
function deckOf(cardId: CardId, count = 12): CardId[] {
  return Array.from({ length: count }, () => cardId)
}

const LEVEL_1: TutorialLevel = {
  level: 1,
  title: '第一关 · 算力与模型',
  summary: '认识算力、打出模型卡、结束回合。',
  seed: 1001,
  playerSeat: 0,
  playerDeck: deckOf('context-goldfish'),
  opponentDeck: deckOf('context-goldfish'),
  // 对手第 1、2 个回合各上一个金鱼（cost 1，两个回合的算力都够）。
  opponentTurns: [[{ cardId: 'context-goldfish' }], [{ cardId: 'context-goldfish' }]],
  steps: [
    {
      text: '下面一排是你的手牌。每张卡都要花算力才能打出去，你现在有 1 点算力。',
      action: { kind: 'continue' },
    },
    {
      text: '打出「上下文金鱼」。它是模型卡，打出后会留在你的场上。',
      action: { kind: 'play', cardId: 'context-goldfish' },
    },
    { text: '这回合没别的可做了，结束回合，看看对手怎么走。', action: { kind: 'end-turn' } },
    {
      text: '对手也上了一个模型。注意你的算力上限涨到了 2——每回合都会 +1。',
      action: { kind: 'continue' },
    },
    { text: '再上一个金鱼，把场面铺开。', action: { kind: 'play', cardId: 'context-goldfish' } },
  ],
}

const LEVEL_2: TutorialLevel = {
  level: 2,
  title: '第二关 · 读弱点画像',
  summary: '提示卡打在对手最脆的那一维上，伤害会翻倍。',
  seed: 1002,
  // 坐 1 号 = 把先手让给对手：玩家第一次行动时对面才可能有模型，教学才讲得下去。
  playerSeat: 1,
  playerDeck: deckOf('counting-trap'),
  opponentDeck: deckOf('stereotype-parrot'),
  // 第 1 个回合对手只有 1 点算力，出不起 cost 2 的鹦鹉，所以是空回合。
  opponentTurns: [[], [{ cardId: 'stereotype-parrot' }]],
  steps: [
    {
      text: '这次对手先手。你手上全是提示卡——提示卡是一次性的，结算完就进弃牌堆。',
      action: { kind: 'continue' },
    },
    {
      text: '对面场上还空着，这时提示卡可以直接砸对手本体，造成 2 点伤害。',
      action: { kind: 'play', cardId: 'counting-trap', target: FACE },
    },
    { text: '结束回合。', action: { kind: 'end-turn' } },
    {
      text: '对手上了「刻板鹦鹉」，它在「误判」这一维暴露 2 点，而「数字母陷阱」打的正是误判。',
      action: { kind: 'continue' },
    },
    {
      text: '用陷阱打鹦鹉：伤害 = 卡面 2 + 误判暴露 2 = 4，它只有 3 点完整度，一击就碎。',
      action: {
        kind: 'play',
        cardId: 'counting-trap',
        target: enemyModel('stereotype-parrot'),
      },
    },
  ],
}

const LEVEL_3: TutorialLevel = {
  level: 3,
  title: '第三关 · 拿下对局',
  summary: '模型挡不住提示卡，把对手的完整度打到 0。',
  seed: 1003,
  playerSeat: 0,
  playerDeck: deckOf('leading-question'),
  opponentDeck: deckOf('context-goldfish'),
  // 对手压到 5 点，三张「诱导性提问」（各 2 点）正好打完，不用磨十几个回合。
  opponentIntegrity: 5,
  opponentTurns: [[{ cardId: 'context-goldfish' }], [{ cardId: 'context-goldfish' }]],
  steps: [
    {
      text: '对手这局只有 5 点完整度。完整度归零就判负——这是唯一的胜负条件。',
      action: { kind: 'continue' },
    },
    {
      text: '先来一发「诱导性提问」，直接打本体，把它打到 3。',
      action: { kind: 'play', cardId: 'leading-question', target: FACE },
    },
    { text: '结束回合。', action: { kind: 'end-turn' } },
    {
      text: '对手放了个金鱼挡在前面。但提示卡不需要突破场上的模型，可以绕过去直接打本体。',
      action: { kind: 'continue' },
    },
    {
      text: '再打一发本体，5 → 3 → 1。',
      action: { kind: 'play', cardId: 'leading-question', target: FACE },
    },
    { text: '结束回合，让它再挣扎一下。', action: { kind: 'end-turn' } },
    { text: '最后一击。', action: { kind: 'continue' } },
    {
      text: '打完这一发对手就归零了。',
      action: { kind: 'play', cardId: 'leading-question', target: FACE },
    },
  ],
}

export const TUTORIAL_LEVELS: TutorialLevel[] = [LEVEL_1, LEVEL_2, LEVEL_3]

/** 教程一共几关。存档里的 tutorialDone 以它为上限。 */
export const TUTORIAL_LEVEL_COUNT = TUTORIAL_LEVELS.length

/** 按关卡序号取关卡。序号越界返回 null，由界面跳回首页。 */
export function getTutorialLevel(level: number): TutorialLevel | null {
  return TUTORIAL_LEVELS.find((it) => it.level === level) ?? null
}
