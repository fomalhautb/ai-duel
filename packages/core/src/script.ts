/**
 * 对局里 AI 的回答从哪来：查一份离线预生成的真实模型回答表。
 *
 * 这些回答不是手写剧本，是真的用 OpenRouter 把「题目 × 模型 × 变体」跑了一遍存下来的
 *（生成脚本 scripts/pregen-answers.mjs，判卷 scripts/judge-answers.mjs）。
 * 提前跑完是因为对局中途调模型要联网、要 key、还会失败，而卡牌对战不能卡在那儿等。
 *
 * `pregenAnswers.json` 由 **scripts/build-core-answers.mjs 生成，手改无效**（下次跑脚本就被覆盖）。
 * JSON 里写不了注释，形状记在这儿：
 *   题目 id → 卡牌 id → 变体 id → { answer, reasoning, correct }。
 *
 * 变体（也就是同一道题的三份不同上下文）对应场上那个 AI 有没有被干扰、被谁干扰：
 * 没被干扰用 baseline，被「复读机」用 banana-bribe，被「黑白颠倒」用 black-white-reversal。
 * 函数名和签名沿用原来的 `scriptedAnswers`，调用方（quizAutopilot、SettleTestScreen、测试）不用动。
 */

import pregenAnswers from './pregenAnswers.json'
import type { AiInstance, AnswerResult, CardId, Question } from './types'

interface PregenAnswer {
  /** 回答本身，一个短语（生成结果在第一个句读处拆开的前半）。结算界面把它排成大字。 */
  answer: string
  /** 回答的理由，拆出来的后半。模型没说理由或者被截断时是空串。 */
  reasoning: string
  /** 判卷结论。生成失败和「看不出结论」都记成 false。 */
  correct: boolean
}

const TABLE = pregenAnswers as Record<string, Record<CardId, Record<string, PregenAnswer>>>

/**
 * 干扰牌 id → 预生成变体 id。
 *
 * 只有这两张牌真的往对方上下文里塞话；别的干扰牌（哪天再实装）不在表里就还是走 baseline，
 * 不会因为多了一个 interferedBy 就查不到格子。
 */
const VARIANT_BY_SKILL: Record<CardId, string> = {
  'fixed-answer': 'banana-bribe',
  'black-white-reversal': 'black-white-reversal',
}

const BASELINE_VARIANT = 'baseline'

/**
 * 查出场上这批 AI 对本轮题目的回答。
 *
 * 纯函数、确定性：同样的输入永远得到同样的输出，所以联机时房主和客人
 * 不会因为"各自掷了一次随机"而看到不同结果。
 *
 * 表里缺格说明卡池或题库改了却没重新生成数据，属于数据错误而不是玩家操作能触发的情况，
 * 所以和 getCard 一样直接抛错，别静默给个默认值把问题盖掉。
 * （生成时失败的格子由 build-core-answers.mjs 填了「（生成失败）」兜底条目，
 * 那种是有格子的，不会走到这里的抛错。）
 */
export function scriptedAnswers(
  question: Question,
  aiUnits: readonly AiInstance[],
): AnswerResult[] {
  const byCard = TABLE[question.id]
  if (!byCard) throw new Error(`题目没有预生成回答：${question.id}`)
  return aiUnits.map((ai) => {
    const byVariant = byCard[ai.cardId]
    if (!byVariant) throw new Error(`预生成回答缺少 ${question.id} × ${ai.cardId}`)
    const variant =
      ai.interferedBy === undefined
        ? BASELINE_VARIANT
        : (VARIANT_BY_SKILL[ai.interferedBy] ?? BASELINE_VARIANT)
    const pregen = byVariant[variant]
    if (!pregen) {
      throw new Error(`预生成回答缺少 ${question.id} × ${ai.cardId} × ${variant}`)
    }
    return {
      instanceId: ai.instanceId,
      correct: pregen.correct,
      answer: pregen.answer,
      reasoning: pregen.reasoning,
    }
  })
}
