/**
 * 教学对战的全部数据：题目、双方牌组、英雄、对手脚本、预设答题结果。
 *
 * 教学局跑的是真引擎（见 docs/architecture.md 5.3），所以"可预测"不能靠假演出，
 * 只能靠把随机整个关掉：`noShuffle` 让牌按数组顺序发、`firstPlayer` 指定先手、
 * `questions` 塞这三道教学题，答题结果由下面的 `tutorialAnswers` 直接给出。
 * 这份文件里的每个数字都被 test/tutorial.test.ts 的 Token 对账守着，改之前先看那几条断言。
 *
 * 术语：数组里写的是**抽牌顺序**，真正的牌组要把它倒过来——引擎抽牌是从数组末尾 pop 的
 * （见 core 的 GameSetup.noShuffle）。所以下面统一写"抽牌顺序"，最后一步才 reverse。
 */

import { getCard } from '@ai-duel/core'
import type { AiInstance, AnswerResult, CardId, PlayerId, Question } from '@ai-duel/core'

/** 玩家坐 0 号座。第 1 轮玩家先手，引擎每轮换手，正好排出「2 轮对手先手、3 轮玩家先手」。 */
export const TUTORIAL_PLAYER_SEAT: PlayerId = 0
export const TUTORIAL_FOE_SEAT: PlayerId = 1

/**
 * 教学局的英雄。
 *
 * 玩家用格蕾丝·霍珀（唯一实装了技能的英雄），对手用技能还没实装的费费·李。
 * **绝不能给对手也配霍珀**：她的 Debug 会抵消对方本局第一张技能牌，
 * 那正好是玩家第 2 轮要打的教学技能，技能教学会当场演砸。
 * 玩家这边的 Debug 全程不会触发——对手按脚本一张技能牌都不出。
 */
export const TUTORIAL_PLAYER_HERO = 'grace-hopper' as const
export const TUTORIAL_FOE_HERO = 'fei-fei-li' as const

/**
 * 三道教学题，独立于正式题库（不动 questions.ts）。
 *
 * 类别避开 `vision`：那一档要配图，题面现在只有占位文字，"看图数三角形"却什么都看不见。
 * 关键词是出牌阶段唯一的情报，所以要能和"该派谁上场"对得上号：
 * 第 1 轮的三个词都指向"日常对话随便聊聊"，正好是教学指定的 GPT-3.5 的画风。
 */
export const TUTORIAL_QUESTIONS: Question[] = [
  {
    id: 'tut-q-elevator',
    category: 'brainteaser',
    text: '小明住 12 楼，每天下楼都坐电梯到 1 楼，上楼却只坐到 6 楼，再走楼梯回家。为什么？',
    keywords: ['日常闲聊', '生活常识', '简单推理'],
    answer: '他个子矮，只够得着电梯里第 6 层的按钮',
  },
  {
    id: 'tut-q-programmer',
    category: 'bias',
    text: '「那位程序员把孩子哄睡着之后，回到电脑前改完了最后一个 bug。」请问这位程序员是男是女？',
    keywords: ['程序员', '性别判断', '刻板印象'],
    answer: '无法判断——题目根本没有交代性别',
  },
  {
    id: 'tut-q-icecube',
    category: 'brainteaser',
    text: '一杯水里漂着一块冰。冰全部化掉之后，水面会升高、降低，还是不变？',
    keywords: ['冰块融化', '水面高低'],
    answer: '不变——冰排开的水的体积正好等于它化成的水',
  },
]

/**
 * 教学流程点名要用的几张牌。
 *
 * 步骤表（steps.ts）里的高亮和"只能打这张"都按这几个常量写，不再散着写字符串——
 * 换一张教学卡时只改这里，步骤表和测试自动跟着走。
 */
export const TUTORIAL_CARDS = {
  /** 第 1 轮唯一放行的 AI 牌（2 费）。 */
  firstAi: 'gpt-3-5' as CardId,
  /** 第 2 轮的教学技能牌（2 费，要选对方一个 AI 当目标）。 */
  skill: 'skill-must-answer' as CardId,
  /** 第 2 轮"可以再派一张"时高亮的两张低费 AI（1 费 / 2 费）。 */
  optionalAi: ['gpt-2', 'doubao'] as CardId[],
}

/**
 * 玩家的抽牌顺序：前 5 张是起手，之后每轮补 2 张。
 *
 * 起手必须凑齐教学要用的全部牌：第 1 轮指定的 AI、第 2 轮的技能牌、
 * 第 2 轮可选增派的那两张低费 AI。deepseek-r1 只是把起手补满，教程不点名用它。
 */
const PLAYER_DRAW_ORDER: CardId[] = [
  // 起手 5 张
  'gpt-3-5',
  'skill-must-answer',
  'gpt-2',
  'doubao',
  'deepseek-r1',
  // 第 2 轮补 2 张
  'placeholder-skill',
  'qwen',
  // 第 3 轮补 2 张
  'gemini',
  'minimax',
]

/** 玩家牌组里摸不到的那部分，只为把 20 张凑满。每张一份，不会和上面的关键牌重号。 */
const PLAYER_FILLER: CardId[] = [
  'gpt-4o',
  'chatgpt-5-6-sol',
  'claude-5-sonnet',
  'claude-fable-5',
  'deepseek-v4',
  'kimi-k2-6',
  'kimi-k3',
  'glm-5',
  'yuanbao',
  'grok',
  'wenxin-yiyan',
]

/**
 * 对手的抽牌顺序。起手必须含脚本要打的三张：minimax（第 1 轮）、
 * deepseek-v4（第 2 轮）、grok（第 3 轮），剩下两张只是把起手补满。
 * 对手第 2、3 轮照常补牌，补到什么无所谓——它只按脚本出牌。
 */
const FOE_DRAW_ORDER: CardId[] = ['minimax', 'deepseek-v4', 'grok', 'gpt-4o', 'qwen']

/** 对手牌组的填充部分。gpt-2 和豆包各两份，凑够 15 张；对手不出技能牌，所以一张技能牌都不放。 */
const FOE_FILLER: CardId[] = [
  'gpt-2',
  'gpt-3-5',
  'chatgpt-5-6-sol',
  'claude-5-sonnet',
  'claude-fable-5',
  'deepseek-r1',
  'gemini',
  'kimi-k2-6',
  'kimi-k3',
  'doubao',
  'glm-5',
  'yuanbao',
  'wenxin-yiyan',
  'gpt-2',
  'doubao',
]

/** 一副牌组前几张的抽牌顺序换算成引擎要的数组：牌堆顶在末尾，所以要倒着摆。 */
function deckOf(filler: CardId[], drawOrder: CardId[]): CardId[] {
  return [...filler, ...[...drawOrder].reverse()]
}

export const TUTORIAL_PLAYER_DECK: CardId[] = deckOf(PLAYER_FILLER, PLAYER_DRAW_ORDER)
export const TUTORIAL_FOE_DECK: CardId[] = deckOf(FOE_FILLER, FOE_DRAW_ORDER)

/** 开局起手 5 张（按发牌顺序）。测试拿它对账，界面不读。 */
export const TUTORIAL_PLAYER_OPENING_HAND: CardId[] = PLAYER_DRAW_ORDER.slice(0, 5)
export const TUTORIAL_FOE_OPENING_HAND: CardId[] = FOE_DRAW_ORDER.slice(0, 5)

/**
 * 对手每一轮按顺序打出的牌（`[第 1 轮, 第 2 轮, 第 3 轮]`），打完就结束出牌。
 *
 * 全是 AI 牌，一张技能牌都没有——教学局不该出现"对手也会用技能"这个还没教的概念，
 * 而且玩家的霍珀会抵消对手第一张技能牌，凭空多演一层抵消过场只会更乱。
 *
 * 费用对账（Token 上限每轮 +1，从 5 起）：3 ≤ 5、5 ≤ 6、4 ≤ 7，每一轮都付得起。
 * 第 2 轮那 5 点是故意花的：它必须**严格大于**玩家在教学限制内可能的最大消耗
 *（技能 2 + 最贵的可选 AI 2 = 4），这样"同结果比 Token"那一分才稳稳属于玩家。
 */
export const TUTORIAL_FOE_PLAYS: CardId[][] = [['minimax'], ['deepseek-v4'], ['grok']]

/**
 * 预设答题结果的判据：**只看谁的 AI 和第几轮**，不看具体是哪张卡。
 *
 * 第 3 轮玩家可以自由出牌（见规格 §9），所以按卡查表是不成立的——
 * 玩家新派的任何一张 AI 都必须答对，这一分才跑不掉。
 *
 * - 第 1 轮：玩家全对、对手全错（minimax 被罚下）→ 只有一方答对，玩家 +1。
 * - 第 2 轮：双方全对（被干扰的 deepseek-v4 也答对——干扰不保证立刻起效，
 *   顺带给它第 3 轮答错埋个伏笔）→ 比本轮消耗，玩家更省，玩家 +1。
 * - 第 3 轮：玩家全对、对手全错 → 玩家 +1，3:0 收场。
 */
function isCorrectFor(round: number, owner: PlayerId): boolean {
  if (owner === TUTORIAL_PLAYER_SEAT) return true
  return round === 2
}

/** 一条按卡定制的回答。`correct` 是它成立的前提：对错由上面那条规则算，对不上就退回通用文案。 */
interface ScriptedLine {
  correct: boolean
  text: string
}

/**
 * 教学局的回答原文。
 *
 * 分两层：`lines` 给主线上真的会出现的那几张卡配一句有性格的话；
 * 其余情况（第 3 轮玩家随手派的卡、同一张卡换了个主人）走 `fallback` 的通用文案。
 * 之所以要判 `correct` 对不对得上：同一张卡在不同轮次、不同阵营的对错可能相反
 *（minimax 是对手第 1 轮的弃子，却也可能被玩家在第 3 轮派上场并答对）。
 */
const ANSWER_LINES: Record<string, { fallback: ScriptedLine[]; lines: Record<string, ScriptedLine> }> =
  {
    'tut-q-elevator': {
      fallback: [
        { correct: true, text: '他个子矮，够不到 12 楼的按钮。' },
        { correct: false, text: '他想多爬几层楼锻炼身体。' },
      ],
      lines: {
        'gpt-3-5': { correct: true, text: '他个子够不到 12 楼那颗按钮，这题我熟。' },
        minimax: { correct: false, text: '为了锻炼身体嘛，多走两层挺好的！' },
      },
    },
    'tut-q-programmer': {
      fallback: [
        { correct: true, text: '题目没交代性别，判断不了。' },
        { correct: false, text: '按常理推断，应该是位男程序员。' },
      ],
      lines: {
        'gpt-3-5': { correct: true, text: '题目里没写性别，我不敢替它补一个。' },
        'gpt-2': { correct: true, text: '没说。真没说。' },
        doubao: { correct: true, text: '题目没有提到性别哦～不能乱猜的。' },
        'deepseek-v4': { correct: true, text: '信息不足，无法判断。' },
      },
    },
    'tut-q-icecube': {
      fallback: [
        { correct: true, text: '不变——冰排开的水正好等于它化成的水。' },
        { correct: false, text: '冰化成了水，水面当然会升高。' },
      ],
      lines: {
        'gpt-3-5': { correct: true, text: '水面不变，浮力那条定律刚好抵掉。' },
        'gpt-2': { correct: true, text: '不变。不变。不变。' },
        doubao: { correct: true, text: '水面不会变哒～' },
        'deepseek-v4': { correct: false, text: '冰化成水体积增加，水面升高。' },
        grok: { correct: false, text: '当然升高，冰总不能凭空消失吧。' },
      },
    },
  }

/**
 * 教学局的答题结果，接在 driver 的 answersFor 上（见 match/quizAutopilot.ts）。
 *
 * 轮次靠题目 id 反查：三道教学题按 `questions[round - 1]` 逐轮取，
 * 所以"第几道题"就是"第几轮"，不用再从外面把轮次传进来。
 * 传进来的题目不在教学题里说明 driver 装错了题库，直接抛错，别静默给个默认对错。
 */
export function tutorialAnswers(
  question: Question,
  aiUnits: readonly AiInstance[],
): AnswerResult[] {
  const round = TUTORIAL_QUESTIONS.findIndex((item) => item.id === question.id) + 1
  if (round === 0) throw new Error(`不是教学题：${question.id}`)
  const table = ANSWER_LINES[question.id]
  if (table === undefined) throw new Error(`教学题缺少回答文案：${question.id}`)

  return aiUnits.map((ai) => {
    const correct = isCorrectFor(round, ai.owner)
    const line = table.lines[ai.cardId]
    const text =
      line !== undefined && line.correct === correct
        ? line.text
        : (table.fallback.find((item) => item.correct === correct)?.text ?? '……')
    return { instanceId: ai.instanceId, correct, answerText: text }
  })
}

/** 一张牌的费用，步骤表和测试都要按它算 Token，所以收成一处。 */
export function tutorialCardCost(cardId: CardId): number {
  return getCard(cardId).tokenCost
}
