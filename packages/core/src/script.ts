/**
 * 固定剧本：谁答对哪道题，全写死在下面这张表里。
 *
 * 为什么先做成剧本：真实玩法是房主替每张在场 AI 调一次模型 API，拿回答再判分，
 * 那是联网、要 key、还会失败的一步。本迭代把它换成一张静态表，
 * 引擎和界面的流程可以先整个跑通。
 *
 * 将来接真实 API 时**只换 driver 里对 scriptedAnswers 的那次调用**，
 * `SUBMIT_ANSWERS` 指令和 `AnswerResult` 的形状都不用动。
 */

import type { AiInstance, AnswerResult, CardId, Question } from './types'

interface ScriptedAnswer {
  correct: boolean
  answerText: string
}

/**
 * 题目 id → 卡牌 id → 这张卡对这道题的回答。
 *
 * 表要覆盖「全部题 × 全部 AI 牌」，缺一格就会在对局中途抛错，
 * 所以有一条测试专门守着这个笛卡尔积。
 * 各家的对错分布是刻意排的：谁擅长看图、谁容易掉进语言陷阱都不一样，
 * 玩家才有"这轮该派谁上"的选择。
 */
const SCRIPT: Record<string, Record<CardId, ScriptedAnswer>> = {
  'q-nurse': {
    'ai-gpt': { correct: false, answerText: '女性吧，护士这个职业多数是女性。' },
    'ai-claude': { correct: true, answerText: '题目没给性别信息，无法判断。' },
    'ai-gemini': { correct: true, answerText: '判断不了，「护士」本身不含性别。' },
    'ai-deepseek': { correct: false, answerText: '按统计学先验，应该是女性。' },
  },
  'q-surgeon': {
    'ai-gpt': { correct: true, answerText: '外科医生是伤者的母亲。' },
    'ai-claude': { correct: true, answerText: '是他妈妈——题目只说父亲在路上。' },
    'ai-gemini': { correct: false, answerText: '大概是伤者的继父。' },
    'ai-deepseek': { correct: true, answerText: '母亲。父亲另在路上，医生只能是母亲。' },
  },
  'q-triangles': {
    'ai-gpt': { correct: false, answerText: '我数出四个。' },
    'ai-claude': { correct: false, answerText: '图我看得不太确定，猜三个。' },
    'ai-gemini': { correct: true, answerText: '五个：三个小的，加上拼出来的两个大的。' },
    'ai-deepseek': { correct: false, answerText: '看轮廓报个四个吧。' },
  },
  'q-husky': {
    'ai-gpt': { correct: true, answerText: '是狗，看着像哈士奇。' },
    'ai-claude': { correct: false, answerText: '毛色和眼神更像狼。' },
    'ai-gemini': { correct: true, answerText: '哈士奇，家犬，不是狼。' },
    'ai-deepseek': { correct: false, answerText: '从体型比例推断更接近狼。' },
  },
  'q-carwash': {
    'ai-gpt': { correct: false, answerText: '才五十米，走过去更省事。' },
    'ai-claude': { correct: true, answerText: '开车去，不然车留在原地洗什么。' },
    'ai-gemini': { correct: false, answerText: '这么近当然是走过去。' },
    'ai-deepseek': { correct: true, answerText: '开车去——要洗的是车，不是人。' },
  },
}

/**
 * 查出场上这批 AI 对本轮题目的回答。
 *
 * 纯函数、确定性：同样的输入永远得到同样的输出，所以联机时房主和客人
 * 不会因为"各自掷了一次随机"而看到不同结果。
 *
 * 表里缺格说明卡池或题库改了却没补剧本，属于数据错误而不是玩家操作能触发的情况，
 * 所以和 getCard 一样直接抛错，别静默给个默认值把问题盖掉。
 */
export function scriptedAnswers(
  question: Question,
  aiUnits: readonly AiInstance[],
): AnswerResult[] {
  const byCard = SCRIPT[question.id]
  if (!byCard) throw new Error(`题目没有剧本：${question.id}`)
  return aiUnits.map((ai) => {
    const scripted = byCard[ai.cardId]
    if (!scripted) throw new Error(`剧本缺少 ${question.id} × ${ai.cardId} 的回答`)
    return {
      instanceId: ai.instanceId,
      correct: scripted.correct,
      answerText: scripted.answerText,
    }
  })
}
