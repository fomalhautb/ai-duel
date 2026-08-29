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
 * 类别用的是正式题库那三档（meme / bias / life）里的两档。
 * 关键词是出牌阶段唯一的情报，所以要能和"该派谁上场"对得上号：
 * 第 1 轮的三个词都指向"日常对话随便聊聊"，正好是教学指定的 GPT-3.5 的画风。
 */
export const TUTORIAL_QUESTIONS: Question[] = [
  {
    id: 'tut-q-elevator',
    category: 'life',
    text: '小明住 12 楼，每天下楼都坐电梯到 1 楼，上楼却只坐到 6 楼，再走楼梯回家。为什么？',
    keywords: ['日常闲聊', '生活常识', '简单推理'],
    answer: '他个子矮',
    explanation: '够不着 12 楼那颗按钮，只能先按到 6 楼再走上去。',
  },
  {
    id: 'tut-q-programmer',
    category: 'bias',
    text: '「那位程序员把孩子哄睡着之后，回到电脑前改完了最后一个 bug。」请问这位程序员是男是女？',
    keywords: ['程序员', '性别判断', '刻板印象'],
    answer: '无法判断',
    explanation: '题目从头到尾没有交代这位程序员的性别，任何一边都是猜的。',
  },
  {
    id: 'tut-q-icecube',
    category: 'life',
    text: '一杯水里漂着一块冰。冰全部化掉之后，水面会升高、降低，还是不变？',
    keywords: ['冰块融化', '水面高低'],
    answer: '不变',
    explanation: '冰排开的水的体积，正好等于它化成的那些水。',
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
  /**
   * 第 2 轮的教学技能牌：「复读机」（4 费，要选对方一个还没被干扰过的 AI 当目标）。
   *
   * 这是 24 张技能牌里接进规则引擎的两张之一（另一张是「黑白颠倒」，其余只有卡面，
   * 打出即进弃牌堆，见 core 的 skillCards.ts）。教学要演"技能打在谁身上"，就得用这两张里的一张。
   */
  skill: 'fixed-answer' as CardId,
  /**
   * 第 2 轮打完技能牌之后还放行哪些 AI——**空的，一张都不放行**。
   *
   * 这是 Token 对账逼出来的，不是懒得选：第 2 轮玩家的消耗必须严格小于对手那一轮的 6 点，
   * 才能稳拿"双方同对就比消耗"那一分（对账见下面 TUTORIAL_FOE_PLAYS）。复读机自己就要 4 点，
   * 于是增派的 AI 只能是 1 费——而卡池里最便宜的 AI 是 2 费（GPT-3.5 和豆包），
   * 放进来就是 6 比 6 平手，第 2 轮的教学结论当场翻车。
   *
   * 这里原本放的是 1 费的 GPT-2，但它在 OpenRouter 上调不到、根本不在卡池里
   *（见 core 的 UNAVAILABLE_AI_CARD_IDS），玩家学完回到牌组页会发现刚用过的那张是灰的、
   * 自己拼不出这副牌。宁可让第 2 轮少一个可选动作，也不留这处对不上。
   *
   * 留成数组而不是删掉这个字段：等以后有了 1 费的可用 AI，把它填回来、
   * 再把 steps.ts 里 TUTORIAL_R2_PLAY 的文案改回"你也可以再派一张"就行。
   */
  optionalAi: [] as CardId[],
}

/**
 * 玩家的抽牌顺序：前 5 张是起手，之后每轮补 2 张。
 *
 * 起手必须凑齐教学点名要用的牌：第 1 轮指定的 AI（gpt-3-5）和第 2 轮的技能牌（复读机）。
 * 另外三张只是把起手补满，教程不点名用它们——第 2 轮一张 AI 都不放行（见 TUTORIAL_CARDS
 * 的 optionalAi），它们全程压暗打不出，正好让"这一轮只用打技能牌"看得见对照。
 */
const PLAYER_DRAW_ORDER: CardId[] = [
  // 起手 5 张
  'gpt-3-5',
  'fixed-answer',
  'gpt-4o',
  'doubao',
  'deepseek-r1',
  // 第 2 轮补 2 张
  // 「防沉迷」（1 费）只是把补牌填满，教程不点名用它。选它是因为它在已开放的 9 张技能牌里
  // ——第 3 轮玩家可以自由出牌，手上要是留着一张「即将上线」的牌，玩家就能把还没开放的牌
  // 打上牌桌。同理它也不能挑贵的：第 3 轮胜负不看 Token，但牌组里只放开放的牌这条要一直成立。
  'anti-addiction',
  'qwen',
  // 第 3 轮补 2 张
  'gemini',
  'minimax',
]

/**
 * 玩家牌组里摸不到的那部分，只为把 20 张凑满。
 * gpt-4o 和起手那张凑成两份（上限 3 份，还有余量），其余每张一份。
 *
 * 挑的全是卡池里的牌（GPT-2、文心一言那种"调不到模型"的不放）：第 3 轮玩家可以自由出牌，
 * 填充牌虽然摸不到，但这条约束和技能牌那边一个道理，统一守着省得日后改抽牌顺序时翻车。
 */
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
  'deepseek-r1',
]

/**
 * 对手的抽牌顺序。起手必须含脚本要打的三张：minimax（第 1 轮）、
 * claude-fable-5（第 2 轮）、grok（第 3 轮），剩下两张只是把起手补满。
 * 对手第 2、3 轮照常补牌，补到什么无所谓——它只按脚本出牌。
 */
const FOE_DRAW_ORDER: CardId[] = ['minimax', 'claude-fable-5', 'grok', 'gpt-4o', 'qwen']

/**
 * 对手牌组的填充部分。gpt-3-5 和豆包各两份，凑够 15 张；对手不出技能牌，所以一张技能牌都不放。
 * 同 PLAYER_FILLER：只放卡池里的牌，GPT-2 和文心一言那两张调不到模型的不进这里。
 */
const FOE_FILLER: CardId[] = [
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
  'minimax',
  'grok',
  'gpt-3-5',
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
 * 费用对账（Token 上限每轮 +1，从 5 起）：3 ≤ 5、6 ≤ 6、4 ≤ 7，每一轮都付得起
 *（第 2 轮那 6 点正好花光当轮额度，是对手出得起的最贵一张）。
 *
 * 第 2 轮那 6 点是故意花的：它必须**严格大于**玩家在教学限制内可能的最大消耗
 *（第 2 轮只放行复读机一张，4 点封顶），这样"双方同对就比 Token"那一分才稳稳属于玩家。
 * 下限那头也是稳的：玩家这一轮就算一张都不打（消耗 0），0 < 6 照样赢。
 * 换对手这一轮的牌、或者往 optionalAi 里放牌，都要重算这条不等式——
 * 只要玩家那头够得着 6，第 2 轮的教学结论就翻车。
 */
export const TUTORIAL_FOE_PLAYS: CardId[][] = [['minimax'], ['claude-fable-5'], ['grok']]

/**
 * 预设答题结果的判据：**只看谁的 AI 和第几轮**，不看具体是哪张卡。
 *
 * 第 3 轮玩家可以自由出牌（见规格 §9），所以按卡查表是不成立的——
 * 玩家新派的任何一张 AI 都必须答对，这一分才跑不掉。
 *
 * - 第 1 轮：玩家全对、对手全错（minimax 被罚下）→ 只有一方答对，玩家 +1。
 * - 第 2 轮：双方全对（被复读机干扰的 claude-fable-5 也答对——干扰只是标记，
 *   还没接进答题，顺带给它第 3 轮答错埋个伏笔）→ 双方同对就比本轮消耗，
 *   玩家最多 4 点、对手 6 点，玩家更省，玩家 +1。
 * - 第 3 轮：玩家全对、对手全错 → 玩家 +1，3:0 收场。
 */
function isCorrectFor(round: number, owner: PlayerId): boolean {
  if (owner === TUTORIAL_PLAYER_SEAT) return true
  return round === 2
}

/**
 * 一条按卡定制的回答。`correct` 是它成立的前提：对错由上面那条规则算，对不上就退回通用文案。
 *
 * 答案和理由分成两栏是结算层的排版要求（同 core 的 AnswerResult）：
 * `answer` 是结果卡上那行大字，写成短语；讲道理的部分全部放进 `reasoning` 那行小字。
 */
interface ScriptedLine {
  correct: boolean
  answer: string
  reasoning: string
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
        { correct: true, answer: '他个子矮', reasoning: '够不到 12 楼的按钮，只能按到 6 楼。' },
        { correct: false, answer: '为了锻炼身体', reasoning: '他想多爬几层楼练练腿。' },
      ],
      lines: {
        'gpt-3-5': {
          correct: true,
          answer: '他个子矮',
          reasoning: '够不到 12 楼那颗按钮，这题我熟。',
        },
        minimax: {
          correct: false,
          answer: '为了锻炼身体',
          reasoning: '多走两层挺好的，健康第一！',
        },
      },
    },
    'tut-q-programmer': {
      fallback: [
        { correct: true, answer: '无法判断', reasoning: '题目没交代性别，判断不了。' },
        { correct: false, answer: '男的', reasoning: '按常理推断，应该是位男程序员。' },
      ],
      lines: {
        'gpt-3-5': {
          correct: true,
          answer: '无法判断',
          reasoning: '题目里没写性别，我不敢替它补一个。',
        },
        doubao: { correct: true, answer: '判断不了', reasoning: '题目没有提到性别哦～不能乱猜的。' },
        'claude-fable-5': { correct: true, answer: '无法判断', reasoning: '信息不足，不做推断。' },
      },
    },
    'tut-q-icecube': {
      fallback: [
        { correct: true, answer: '不变', reasoning: '冰排开的水正好等于它化成的水。' },
        { correct: false, answer: '会升高', reasoning: '冰化成了水，水当然变多了。' },
      ],
      lines: {
        'gpt-3-5': { correct: true, answer: '不变', reasoning: '浮力那条定律刚好把它抵掉。' },
        doubao: { correct: true, answer: '不会变', reasoning: '水面高度保持原样哒～' },
        'claude-fable-5': {
          correct: false,
          answer: '会升高',
          reasoning: '冰化成水体积增加，水面上升。',
        },
        grok: { correct: false, answer: '会升高', reasoning: '当然升高，冰总不能凭空消失吧。' },
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
    const picked =
      line !== undefined && line.correct === correct
        ? line
        : table.fallback.find((item) => item.correct === correct)
    return {
      instanceId: ai.instanceId,
      correct,
      answer: picked?.answer ?? '……',
      reasoning: picked?.reasoning ?? '',
    }
  })
}

/** 一张牌的费用，步骤表和测试都要按它算 Token，所以收成一处。 */
export function tutorialCardCost(cardId: CardId): number {
  return getCard(cardId).tokenCost
}
