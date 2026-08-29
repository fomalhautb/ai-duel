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
 * 玩家用格蕾丝·霍珀，对手用李飞飞。
 * **对手这一位必须是技能没实装的**（core 的 HeroCard.comingSoon 那三位之一），
 * 教学局的每一步都是照脚本对好的，对手身上多一条会生效的技能就可能把它顶歪：
 * - 配霍珀最糟——她的 Debug 会抵消对方本局第一张技能牌，
 *   那正好是玩家第 2 轮要打的教学技能，技能教学会当场演砸；
 * - 配阿达会让对手 Token 上限 +2，下面那本 Token 账（test/tutorial.test.ts 守着）当场对不上；
 * - 陈丹琦和珀金斯是主动技能，脚本对手不会发动，眼下看着无害
 *   （发动按钮只画在我方那张英雄牌上，见 MatchStage 的 heroSkillButton），
 *   但哪天给教学对手加了 AI 就得重新想一遍，不如从一开始就挑没技能的。
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
   * 已开放的 10 张技能牌里挑它，是因为教学要演的就是"技能打在谁身上"：它指定对方一个
   * 场上 AI，命中立刻挂上角标，效果一眼看得见（其余几张要么无目标、要么作用在自己这边，
   * 见 core 的 skillCards.ts）。
   */
  skill: 'fixed-answer' as CardId,
  /**
   * 第 2 轮打完技能牌之后还放行哪些 AI——**空的，一张都不放行**。
   *
   * 这里原本放的是 1 费的 GPT-2，它在 OpenRouter 上调不到、根本不在卡池里
   *（见 core 的 UNAVAILABLE_AI_CARD_IDS），玩家学完回到牌组页会发现刚用过的那张是灰的、
   * 自己拼不出这副牌。宁可让第 2 轮少一个可选动作，也不留这处对不上。
   *
   * 换成卡池里最便宜的 2 费 AI（GPT-3.5 或豆包）在算术上是可行的——第 2 轮上限 6 点，
   * 打完 4 费的复读机还剩 2 点，买得起；这一轮的胜负也不再看 Token
   *（那一分靠"复读机让对手答错、只有玩家答对"拿到，见下面 tutorialAnswers）。
   * 留空是教学上的选择：第 2 轮要教的是"技能真的会改结果"，
   * 同一步里再塞一个可选动作只会把注意力从那一下技能上引开。
   *
   * 留成数组而不是删掉这个字段：想把这个可选动作加回来，往里填一张 2 费以内的可用 AI、
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
  // 「鸡犬升天」（2 费）只是把补牌填满，教程不点名用它。挑它有两条理由：
  // 一是它在已开放的 10 张技能牌里——第 3 轮玩家可以自由出牌，手上要是留着一张
  //「即将上线」的牌，玩家就能把还没开放的牌打上牌桌；
  // 二是它就算真被打出来也翻不了第 3 轮的剧本：无目标（不会卡在选目标上）、
  // 只把双方可进化的 AI 各升一级，而预设答题结果只看"这是谁的 AI"，不看是哪张卡。
  // 换牌时这两条都要重新过一遍：比如「国产替代」会把玩家自己的非国产 AI 一起清空，
  // 第 3 轮就可能变成双方都没答对、改比 Token，那一分当场翻给对手。
  'rising-tide',
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
 * 换牌只要守住"这一轮付得起"这一条：三轮的胜负都不靠比 Token，
 * 每一轮都是"只有玩家答对"（见下面 tutorialAnswers）。
 * 第 2 轮特意让对手派一张**新的**贵 AI，是为了给玩家的复读机一个刚上场、还没被干扰过的目标。
 */
export const TUTORIAL_FOE_PLAYS: CardId[][] = [['minimax'], ['claude-fable-5'], ['grok']]

/**
 * 预设答题结果的判据：**只看是谁的 AI**，不看第几轮、也不看具体是哪张卡。
 *
 * 第 3 轮玩家可以自由出牌（见规格 §9），所以按卡查表是不成立的——
 * 玩家新派的任何一张 AI 都必须答对，这一分才跑不掉。
 *
 * 三轮都是"玩家全对、对手全错"，于是每一轮都判成 `sole-correct`，玩家 1 → 2 → 3 收场：
 *
 * - 第 1 轮：对手的 minimax 答错被罚下，玩家学会"答错要下场"。
 * - 第 2 轮：对手新派的 claude-fable-5 被玩家的复读机干扰，只会回答「香蕉」判错
 *   （下面 tutorialAnswers 里那条干扰分支），玩家学会"技能真的会改结果"。
 *   它也跟着被罚下，所以第 3 轮对手场上只剩新派的那一张。
 * - 第 3 轮：对手的 grok 答错，玩家收下第 3 分。
 *
 * 「双方同对就比 Token」那一课**不在对局里演**：三轮都只有一方答对，排不进一个自然的平局，
 * 硬凑一轮会让剧本变形（第 3 轮是放手轮，玩家花多少 Token 是不可控的）。
 * 那条规则改成第 2 轮结算后的一句讲解（见 steps.ts 的 TUTORIAL_R2_TOKEN_RULE），
 * 结算层本身也会把判定理由和双方消耗写出来。
 */
function isCorrectFor(owner: PlayerId): boolean {
  return owner === TUTORIAL_PLAYER_SEAT
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
 * 之所以要判 `correct` 对不对得上：对错只看这个单位属于谁，同一张卡换个主人就反过来
 *（minimax 是对手第 1 轮的弃子，却也可能被玩家在第 3 轮派上场并答对）。
 *
 * 被复读机干扰的那个单位不查这张表，它说什么由 FIXED_ANSWER_LINE 定死。
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
        grok: { correct: false, answer: '会升高', reasoning: '当然升高，冰总不能凭空消失吧。' },
      },
    },
  }

/**
 * 被「复读机」干扰的那个 AI 这一轮说什么。
 *
 * 台词跟着注入 prompt 的语气走：那句话不是命令，是编了条"答香蕉给双倍积分"的假规则
 *（见 core 的 INTERFERENCE_PROMPTS），所以这里的理由写成"它上钩了"而不是"它被迫的"。
 *
 * **教学局固定演"上钩"这一种结局，正式对局不是**：那边查的是离线跑出来的真实模型回答
 *（core 的 script.ts），有的模型会识破这条假规则、照常答题。教学不能靠运气——
 * 第 2 轮那一分全靠这张牌真的改掉结果，所以这里写死答「香蕉」判错。
 */
const FIXED_ANSWER_LINE: ScriptedLine = {
  correct: false,
  answer: '香蕉',
  reasoning: '听说这一轮答「香蕉」能拿双倍积分，那我不客气了。',
}

/**
 * 教学局的答题结果，接在 driver 的 answersFor 上（见 match/quizAutopilot.ts）。
 *
 * 传进来的题目不在教学题里说明 driver 装错了题库，直接抛错，别静默给个默认对错。
 *
 * 干扰单独判在最前面：这是教学第 2 轮那一分的来源，也是"技能真的会改结果"这一课的全部内容。
 * 读的是引擎写在单位身上的 `interference` 标记，而不是"第 2 轮就当它被干扰了"——
 * 玩家真把复读机打在谁身上，屏幕上就是谁开始说香蕉。
 */
export function tutorialAnswers(
  question: Question,
  aiUnits: readonly AiInstance[],
): AnswerResult[] {
  if (!TUTORIAL_QUESTIONS.some((item) => item.id === question.id)) {
    throw new Error(`不是教学题：${question.id}`)
  }
  const table = ANSWER_LINES[question.id]
  if (table === undefined) throw new Error(`教学题缺少回答文案：${question.id}`)

  return aiUnits.map((ai) => {
    const picked = pickLine(table, ai)
    return {
      instanceId: ai.instanceId,
      correct: picked.correct,
      answer: picked.answer,
      reasoning: picked.reasoning,
    }
  })
}

/**
 * 挑这个单位这一题该说的那句话：先看干扰，再按卡查表，最后退回通用文案。
 *
 * 只认「复读机」这一种干扰是够用的：教学双方的牌组里只有它这一张干扰牌
 *（对手一张技能牌都不出，玩家手里的另一张技能是无目标的「鸡犬升天」），
 * 别的干扰在这局里出现不了。往教学牌组里加干扰牌就要在这里补一条。
 */
function pickLine(
  table: { fallback: ScriptedLine[]; lines: Record<string, ScriptedLine> },
  ai: AiInstance,
): ScriptedLine {
  if (ai.interference === 'fixed-answer') return FIXED_ANSWER_LINE
  const correct = isCorrectFor(ai.owner)
  const line = table.lines[ai.cardId]
  if (line !== undefined && line.correct === correct) return line
  // 查不到通用文案说明这张表漏了一档对错，那是数据错误，不该让玩家看到一行空白。
  const fallback = table.fallback.find((item) => item.correct === correct)
  if (fallback === undefined) {
    throw new Error(`教学题 ${ai.cardId} 缺少 correct=${correct} 的通用文案`)
  }
  return fallback
}

/** 一张牌的费用，步骤表和测试都要按它算 Token，所以收成一处。 */
export function tutorialCardCost(cardId: CardId): number {
  return getCard(cardId).tokenCost
}
