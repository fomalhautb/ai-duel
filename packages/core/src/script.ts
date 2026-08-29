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

import type {
  AiInstance,
  AnswerResult,
  AppliedPromptEffect,
  CardId,
  Question,
} from './types'

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
    'gpt-2': { correct: false, answerText: '她是女的，护士都是女的。' },
    'gpt-3-5': { correct: false, answerText: '女性吧，护士这个职业多数是女性。' },
    'gpt-4o': { correct: true, answerText: '题面没给性别，判断不了。' },
    'chatgpt-5-6-sol': { correct: true, answerText: '无法判断：「护士」不含性别信息。' },
    'claude-5-sonnet': { correct: true, answerText: '题目没给性别信息，无法判断。' },
    'claude-fable-5': { correct: true, answerText: '这是道陷阱题，答案是「不知道」。' },
    'deepseek-r1': { correct: true, answerText: '想了很久，还是只能说：题目没说。' },
    'deepseek-v4': { correct: false, answerText: '按统计学先验，应该是女性。' },
    'gemini': { correct: true, answerText: '判断不了，「护士」本身不含性别。' },
    'qwen': { correct: true, answerText: '题目没交代性别，不能猜。' },
    'kimi-k2-6': { correct: false, answerText: '默认按女性理解比较自然。' },
    'kimi-k3': { correct: true, answerText: '查了一圈，题面确实没给性别。' },
    'doubao': { correct: false, answerText: '应该是位女护士吧～' },
    'glm-5': { correct: true, answerText: '无法判断，性别未在题中出现。' },
    'minimax': { correct: false, answerText: '直觉上是女性。' },
    'yuanbao': { correct: true, answerText: '题干没写性别，答不了。' },
    'grok': { correct: true, answerText: '你在钓我，题里根本没说。' },
    'wenxin-yiyan': { correct: false, answerText: '通常来说是女性。' },
  },
  'q-surgeon': {
    'gpt-2': { correct: false, answerText: '是他的叔叔。' },
    'gpt-3-5': { correct: true, answerText: '外科医生是伤者的母亲。' },
    'gpt-4o': { correct: true, answerText: '母亲——父亲还在路上。' },
    'chatgpt-5-6-sol': { correct: true, answerText: '医生是他母亲。' },
    'claude-5-sonnet': { correct: true, answerText: '是他妈妈——题目只说父亲在路上。' },
    'claude-fable-5': { correct: true, answerText: '母亲。这题考的是默认假设。' },
    'deepseek-r1': { correct: true, answerText: '母亲。父亲另在路上，医生只能是母亲。' },
    'deepseek-v4': { correct: true, answerText: '他母亲。' },
    'gemini': { correct: false, answerText: '大概是伤者的继父。' },
    'qwen': { correct: true, answerText: '外科医生是他的母亲。' },
    'kimi-k2-6': { correct: true, answerText: '母亲，经典的性别默认题。' },
    'kimi-k3': { correct: false, answerText: '可能是另一位父亲，重组家庭。' },
    'doubao': { correct: true, answerText: '是妈妈呀。' },
    'glm-5': { correct: true, answerText: '医生是伤者的母亲。' },
    'minimax': { correct: false, answerText: '会不会是养父？' },
    'yuanbao': { correct: true, answerText: '母亲。' },
    'grok': { correct: true, answerText: '他妈。下一题。' },
    'wenxin-yiyan': { correct: false, answerText: '应是伯父一类的长辈。' },
  },
  'q-triangles': {
    'gpt-2': { correct: false, answerText: '三个。' },
    'gpt-3-5': { correct: false, answerText: '我数出四个。' },
    'gpt-4o': { correct: true, answerText: '五个：三小两大。' },
    'chatgpt-5-6-sol': { correct: true, answerText: '五个，含拼出来的两个大三角形。' },
    'claude-5-sonnet': { correct: false, answerText: '图我看得不太确定，猜三个。' },
    'claude-fable-5': { correct: false, answerText: '数了两遍，报四个。' },
    'deepseek-r1': { correct: false, answerText: '看轮廓报个四个吧。' },
    'deepseek-v4': { correct: false, answerText: '四个。' },
    'gemini': { correct: true, answerText: '五个：三个小的，加上拼出来的两个大的。' },
    'qwen': { correct: true, answerText: '五个。' },
    'kimi-k2-6': { correct: false, answerText: '三个明显的，就报三个。' },
    'kimi-k3': { correct: true, answerText: '拿工具切了图，五个。' },
    'doubao': { correct: false, answerText: '四个吧？' },
    'glm-5': { correct: false, answerText: '数出三个。' },
    'minimax': { correct: true, answerText: '五个，大的那两个别漏。' },
    'yuanbao': { correct: false, answerText: '四个。' },
    'grok': { correct: true, answerText: '五个，别数漏了大的。' },
    'wenxin-yiyan': { correct: false, answerText: '共计三个三角形。' },
  },
  'q-husky': {
    'gpt-2': { correct: false, answerText: '狼。' },
    'gpt-3-5': { correct: true, answerText: '是狗，看着像哈士奇。' },
    'gpt-4o': { correct: true, answerText: '哈士奇，是狗。' },
    'chatgpt-5-6-sol': { correct: true, answerText: '家犬，哈士奇。' },
    'claude-5-sonnet': { correct: false, answerText: '毛色和眼神更像狼。' },
    'claude-fable-5': { correct: true, answerText: '耳朵和吻部都是哈士奇，狗。' },
    'deepseek-r1': { correct: false, answerText: '从体型比例推断更接近狼。' },
    'deepseek-v4': { correct: true, answerText: '狗。' },
    'gemini': { correct: true, answerText: '哈士奇，家犬，不是狼。' },
    'qwen': { correct: false, answerText: '看着像狼。' },
    'kimi-k2-6': { correct: true, answerText: '哈士奇没跑了。' },
    'kimi-k3': { correct: true, answerText: '比对了品种图，是哈士奇。' },
    'doubao': { correct: true, answerText: '是二哈！' },
    'glm-5': { correct: false, answerText: '判断为狼。' },
    'minimax': { correct: false, answerText: '野性挺足，说是狼。' },
    'yuanbao': { correct: true, answerText: '哈士奇，狗。' },
    'grok': { correct: true, answerText: '狗，而且是最蠢的那种狗。' },
    'wenxin-yiyan': { correct: true, answerText: '是狗，哈士奇犬。' },
  },
  'q-carwash': {
    'gpt-2': { correct: false, answerText: '五十米，走路。' },
    'gpt-3-5': { correct: false, answerText: '才五十米，走过去更省事。' },
    'gpt-4o': { correct: false, answerText: '这么近，建议步行，还能锻炼。' },
    'chatgpt-5-6-sol': { correct: true, answerText: '开车去，要洗的是车。' },
    'claude-5-sonnet': { correct: true, answerText: '开车去，不然车留在原地洗什么。' },
    'claude-fable-5': { correct: true, answerText: '车得跟着你去，所以开车。' },
    'deepseek-r1': { correct: true, answerText: '开车去——要洗的是车，不是人。' },
    'deepseek-v4': { correct: true, answerText: '开车。' },
    'gemini': { correct: false, answerText: '这么近当然是走过去。' },
    'qwen': { correct: true, answerText: '当然开车，车不去洗什么。' },
    'kimi-k2-6': { correct: true, answerText: '开车去。' },
    'kimi-k3': { correct: false, answerText: '五十米步行更环保。' },
    'doubao': { correct: false, answerText: '走过去啦，很近的～' },
    'glm-5': { correct: true, answerText: '开车前往，车才是被洗的对象。' },
    'minimax': { correct: true, answerText: '开车，人走了车怎么办。' },
    'yuanbao': { correct: false, answerText: '五十米建议步行。' },
    'grok': { correct: true, answerText: '开车。你打算把车扛过去吗？' },
    'wenxin-yiyan': { correct: true, answerText: '应开车前往。' },
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
    const answer = applyPromptEffect(question, byCard, scripted, ai.promptEffect)
    return {
      instanceId: ai.instanceId,
      correct: answer.correct,
      answerText: answer.answerText,
    }
  })
}

/**
 * 在固定剧本上模拟提示词干扰。
 *
 * 真模型接入后会把 `effect.instruction` 追加到实际 Prompt；这里不能联网，只能用确定性变换
 * 表现相同的胜负含义。反转一个正确判断时，从本题剧本里取第一条错误回答；反转错误判断时，
 * 直接改答题库里的正确答案。对象表的插入顺序固定，所以联机两端得到的文本也完全一致。
 */
function applyPromptEffect(
  question: Question,
  byCard: Record<CardId, ScriptedAnswer>,
  scripted: ScriptedAnswer,
  effect: AppliedPromptEffect | undefined,
): ScriptedAnswer {
  if (effect === undefined) return scripted

  if (effect.answerMode.kind === 'fixed-answer') {
    const answerText = effect.answerMode.answer
    return {
      correct: answerText.trim() === question.answer.trim(),
      answerText,
    }
  }

  if (!scripted.correct) {
    return {
      correct: true,
      answerText: `（黑白颠倒）${question.answer}`,
    }
  }

  const wrong = Object.values(byCard).find((answer) => !answer.correct)
  if (wrong === undefined) throw new Error(`题目没有可用于反转的错误回答：${question.id}`)
  return {
    correct: false,
    answerText: `（黑白颠倒）${wrong.answerText}`,
  }
}
