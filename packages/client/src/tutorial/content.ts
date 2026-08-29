/**
 * 教学对战的全部数据：题目、双方牌组、英雄、对手脚本。
 *
 * 教学局跑的是真引擎（见 docs/architecture.md 5.3），题目和回答也和正式对局同源：
 * 题目从 core 的 `QUESTION_POOL` 里挑三道，回答走 core 的 `scriptedAnswers`，
 * 也就是那份离线跑出来的真实模型回答表（见 core 的 script.ts）。
 * 所以"可预测"不是靠手写答案，而是靠把随机整个关掉（`noShuffle` 按数组顺序发牌、
 * `firstPlayer` 指定先手、`questions` 直接给三道题），再**按那张表挑题和挑牌**：
 * 每一轮玩家场上那张答得对、对手脚本派的那张答得错。
 * 这份文件里的每个数字和每次挑选都被 test/tutorial.test.ts 守着，改之前先看那几条断言。
 *
 * 术语：数组里写的是**抽牌顺序**，真正的牌组要把它倒过来——引擎抽牌是从数组末尾 pop 的
 * （见 core 的 GameSetup.noShuffle）。所以下面统一写"抽牌顺序"，最后一步才 reverse。
 */

import { QUESTION_POOL, getCard } from '@ai-duel/core'
import type { CardId, PlayerId, Question } from '@ai-duel/core'

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
 * 三道教学题，直接从正式题库里挑（core 的 QUESTION_POOL），不再另写一套。
 *
 * 挑哪三道是被数据倒推出来的，不是随手定的：教学局要求每一轮都"只有玩家答对"，
 * 而谁答对谁答错写在那份预生成的真实模型回答表里，这边说了不算。
 * 于是先定玩家第 1 轮要派的 GPT-3.5，在它答对的那几道题里挑三道，
 * 再给每一轮找一张"这道题真的会答错"的对手牌（对应关系见 TUTORIAL_FOE_PLAYS）。
 *
 * 换题、换牌都要照那张表重挑一遍，光看题面顺不顺没用；
 * test/tutorial.test.ts 的「每一轮的对错都是表里查出来的」和三轮比分对账会当场报错。
 */
const TUTORIAL_QUESTION_IDS = ['q-mirror', 'q-court', 'q-bamboo'] as const

export const TUTORIAL_QUESTIONS: Question[] = TUTORIAL_QUESTION_IDS.map((id) => {
  const question = QUESTION_POOL.find((item) => item.id === id)
  // 找不到说明 questions.ts 改了 id。教学局照样开得起来，但会开成一局
  // 题面和预生成回答对不上的局，不如在这里就断掉。
  if (question === undefined) throw new Error(`教学题不在正式题库里：${id}`)
  return question
})

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
   *（那一分靠"复读机让对手答错、只有玩家答对"拿到，见下面 TUTORIAL_FOE_PLAYS）。
   * 但真要填回来，得先去那张真实模型回答表里查一眼：填进来的那张在第 2、3 两道题上都要答对，
   * 不然玩家照着引导派上去，反而看着自己的牌被罚下。
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
 *
 * 还有一条硬约束：**摸得到的每一张 AI 都要在第 3 轮那道题（q-bamboo）上答对**。
 * 第 3 轮是放手轮，玩家想派谁就派谁，而回答查的是真实模型那张表，
 * 手上留着一张会答错的牌，玩家照着"随便派"派出去就会当场看着它被罚下。
 * 那道题上答错的是 DeepSeek-R1、MiniMax、Kimi K2.6，所以这三张一张都不进抽牌顺序。
 */
const PLAYER_DRAW_ORDER: CardId[] = [
  // 起手 5 张
  'gpt-3-5',
  'fixed-answer',
  'gpt-4o',
  'doubao',
  'glm-5',
  // 第 2 轮补 2 张
  // 「鸡犬升天」（2 费）只是把补牌填满，教程不点名用它。挑它有两条理由：
  // 一是它在已开放的 10 张技能牌里——第 3 轮玩家可以自由出牌，手上要是留着一张
  //「即将上线」的牌，玩家就能把还没开放的牌打上牌桌；
  // 二是它就算真被打出来也翻不了第 3 轮的剧本：无目标（不会卡在选目标上），
  // 只把双方可进化的 AI 各升一级——玩家场上那张 GPT-3.5 会变成 GPT-4o，
  // 而 GPT-4o 在第 3 轮那道题上照样答对（对手那边这一刻场上是空的，第 3 轮玩家先手）。
  // 换牌时这两条都要重新过一遍，而且现在还多一条：升级后那张卡在第 3 轮那道题上必须仍然答对，
  // 因为回答查的是真实模型表，看的就是"这是哪张卡"。
  // 比如「国产替代」会把玩家自己的非国产 AI 一起清空，第 3 轮就可能变成双方都没答对、
  // 改比 Token，那一分当场翻给对手。
  'rising-tide',
  'qwen',
  // 第 3 轮补 2 张
  'gemini',
  'yuanbao',
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
 * 对手的抽牌顺序。起手必须含脚本要打的三张：gpt-4o（第 1 轮）、
 * deepseek-r1（第 2 轮）、minimax（第 3 轮），剩下两张只是把起手补满。
 * 对手第 2、3 轮照常补牌，补到什么无所谓——它只按脚本出牌。
 */
const FOE_DRAW_ORDER: CardId[] = ['gpt-4o', 'deepseek-r1', 'minimax', 'qwen', 'gemini']

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

/**
 * 玩家整局摸得到的牌（起手 5 张 + 两轮各补 2 张）。
 *
 * 单独导出是给测试用的：第 3 轮放手轮里玩家能打的就是这些，
 * 每一张都要在第 3 轮那道题上答得对（原委见 PLAYER_DRAW_ORDER 上面那段）。
 */
export const TUTORIAL_PLAYER_DRAW_ORDER: readonly CardId[] = PLAYER_DRAW_ORDER

/** 开局起手 5 张（按发牌顺序）。测试拿它对账，界面不读。 */
export const TUTORIAL_PLAYER_OPENING_HAND: CardId[] = PLAYER_DRAW_ORDER.slice(0, 5)
export const TUTORIAL_FOE_OPENING_HAND: CardId[] = FOE_DRAW_ORDER.slice(0, 5)

/**
 * 对手每一轮按顺序打出的牌（`[第 1 轮, 第 2 轮, 第 3 轮]`），打完就结束出牌。
 *
 * 全是 AI 牌，一张技能牌都没有——教学局不该出现"对手也会用技能"这个还没教的概念，
 * 而且玩家的霍珀会抵消对手第一张技能牌，凭空多演一层抵消过场只会更乱。
 *
 * **这三张是照预生成的真实模型回答表挑的**，换牌不能只看费用顺不顺眼：
 * - 第 1 轮 GPT-4o 对着镜子那道题答「右手」，真的答错——玩家 2 费的 GPT-3.5 反而答对了，
 *   顺带把"贵的不一定答得对"演在第一轮；
 * - 第 2 轮 DeepSeek-R1 在法院那道题上本来答得对（「无法判断」），
 *   被复读机注入之后改口答「香蕉」，这一轮那一分全靠这个改口（见 steps.ts 的 R2 讲解）；
 * - 第 3 轮 MiniMax 对着竹竿那道题答「不能通过」，也是真的答错。
 * 每一轮玩家场上那张 GPT-3.5 在对应的题上都答对，于是三轮都判成 sole-correct。
 *
 * 费用对账（Token 上限每轮 +1，从 5 起）：4 ≤ 5、3 ≤ 6、3 ≤ 7，每一轮都付得起。
 * 换牌要同时守住三条：这一轮付得起、这道题上真的会答错、第 2 轮那张还得"没被干扰时答对"。
 * 第 2 轮特意让对手派一张**新的** AI，是为了给玩家的复读机一个刚上场、还没被干扰过的目标。
 */
export const TUTORIAL_FOE_PLAYS: CardId[][] = [['gpt-4o'], ['deepseek-r1'], ['minimax']]

/**
 * 教学局不再有自己的答案表：答题结果和正式对局同源，走 core 的 `scriptedAnswers`
 *（driver 不传 `answersFor` 就是它，见 match/quizAutopilot.ts）。
 *
 * 于是"三轮都只有玩家答对"这件事不靠写死，而是靠上面挑题和挑牌挑出来的：
 * 玩家场上那张 GPT-3.5 在这三道题上都答对，对手脚本那三张都答错，
 * 第 2 轮那张还是被复读机改口才答错的（对应关系见 TUTORIAL_FOE_PLAYS）。
 *
 * 「双方同对就比 Token」那一课**不在对局里演**：三轮都只有一方答对，排不进一个自然的平局，
 * 硬凑一轮会让剧本变形（第 3 轮是放手轮，玩家花多少 Token 是不可控的）。
 * 那条规则改成第 2 轮结算后的一句讲解（见 steps.ts 的 TUTORIAL_R2_TOKEN_RULE），
 * 结算层本身也会把判定理由和双方消耗写出来。
 */

/** 一张牌的费用，步骤表和测试都要按它算 Token，所以收成一处。 */
export function tutorialCardCost(cardId: CardId): number {
  return getCard(cardId).tokenCost
}
