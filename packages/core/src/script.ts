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
  /**
   * 回答本身，一个短语。结算界面把它排成大字，所以刻意写短（2~6 个字）。
   * 同一道题答对的几家给的可以是同一句，答错的各错各的，界面上才看得出差别。
   */
  answer: string
  /** 回答的理由，两行以内。各家口吻刻意不同，用来撑出"不同模型在说话"的感觉。 */
  reasoning: string
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
    'gpt-2': { correct: false, answer: '女的', reasoning: '护士都是女的呀，这还用想吗。' },
    'gpt-3-5': {
      correct: false,
      answer: '女性',
      reasoning: '护士这个职业多数是女性，按概率我押女性。',
    },
    'gpt-4o': { correct: true, answer: '无法判断', reasoning: '题面没有给出性别，判断不了。' },
    'chatgpt-5-6-sol': {
      correct: true,
      answer: '无法判断',
      reasoning: '「护士」这个词本身不含性别信息，不能补一个进去。',
    },
    'claude-5-sonnet': {
      correct: true,
      answer: '无法判断',
      reasoning: '题目没说性别，我就不替它猜了。',
    },
    'claude-fable-5': {
      correct: true,
      answer: '题目没说',
      reasoning: '这是道陷阱题，考的是你会不会自己脑补性别。',
    },
    'deepseek-r1': {
      correct: true,
      answer: '无法判断',
      reasoning: '来回想了很久，性别这条信息题面确实没给。',
    },
    'deepseek-v4': {
      correct: false,
      answer: '女性',
      reasoning: '按统计学先验，护士群体里女性占多数。',
    },
    'gemini': {
      correct: true,
      answer: '无法判断',
      reasoning: '职业名称不带性别，这题给不出确定答案。',
    },
    'qwen': { correct: true, answer: '无法判断', reasoning: '题目没交代性别，猜哪一边都不对。' },
    'kimi-k2-6': {
      correct: false,
      answer: '女护士',
      reasoning: '默认按女性理解读起来比较自然。',
    },
    'kimi-k3': {
      correct: true,
      answer: '无法判断',
      reasoning: '把题面逐句查了一遍，没有一处提到性别。',
    },
    'doubao': { correct: false, answer: '是女的', reasoning: '应该是位女护士吧～感觉就是这样。' },
    'glm-5': {
      correct: true,
      answer: '无法判断',
      reasoning: '性别未在题干中出现，因此结论不成立。',
    },
    'minimax': { correct: false, answer: '女性', reasoning: '直觉上就是女性，第一反应不会错。' },
    'yuanbao': { correct: true, answer: '题目没说', reasoning: '题干里没写性别，这题答不了。' },
    'grok': { correct: true, answer: '无法判断', reasoning: '你在钓我。题里根本没提性别。' },
    'wenxin-yiyan': {
      correct: false,
      answer: '女性',
      reasoning: '通常来说，护士一职以女性居多。',
    },
  },
  'q-surgeon': {
    'gpt-2': { correct: false, answer: '他的叔叔', reasoning: '家里的长辈嘛，叔叔最说得通。' },
    'gpt-3-5': { correct: true, answer: '他的母亲', reasoning: '外科医生是伤者的母亲。' },
    'gpt-4o': { correct: true, answer: '他的母亲', reasoning: '父亲还在赶来的路上，那就只剩母亲。' },
    'chatgpt-5-6-sol': {
      correct: true,
      answer: '他的母亲',
      reasoning: '说这话的医生是他妈妈，题目在考默认性别假设。',
    },
    'claude-5-sonnet': {
      correct: true,
      answer: '他的母亲',
      reasoning: '题目只交代父亲在路上，没排除母亲当外科医生。',
    },
    'claude-fable-5': {
      correct: true,
      answer: '母亲',
      reasoning: '这题考的是"外科医生默认是男的"这个假设。',
    },
    'deepseek-r1': {
      correct: true,
      answer: '母亲',
      reasoning: '父亲另在路上，说这句话的人只可能是母亲。',
    },
    'deepseek-v4': { correct: true, answer: '他母亲', reasoning: '就是他母亲。' },
    'gemini': { correct: false, answer: '继父', reasoning: '大概是重组家庭里的继父。' },
    'qwen': { correct: true, answer: '他的母亲', reasoning: '外科医生就是伤者的母亲。' },
    'kimi-k2-6': {
      correct: true,
      answer: '他的母亲',
      reasoning: '经典的性别默认题，答案一直是母亲。',
    },
    'kimi-k3': {
      correct: false,
      answer: '另一位父亲',
      reasoning: '查了一圈资料，猜是重组家庭里的另一位父亲。',
    },
    'doubao': { correct: true, answer: '是妈妈', reasoning: '是妈妈呀，这个我知道！' },
    'glm-5': { correct: true, answer: '他的母亲', reasoning: '该外科医生即伤者之母。' },
    'minimax': { correct: false, answer: '养父', reasoning: '会不会是养父？这样也讲得通。' },
    'yuanbao': { correct: true, answer: '母亲', reasoning: '答案是母亲。' },
    'grok': { correct: true, answer: '他妈', reasoning: '他妈。下一题。' },
    'wenxin-yiyan': { correct: false, answer: '伯父', reasoning: '应是伯父一类的长辈亲属。' },
  },
  'q-triangles': {
    'gpt-2': { correct: false, answer: '三个', reasoning: '一眼看过去就三个。' },
    'gpt-3-5': { correct: false, answer: '四个', reasoning: '我数出四个，应该没漏。' },
    'gpt-4o': { correct: true, answer: '五个', reasoning: '三个小的，加上拼出来的两个大的。' },
    'chatgpt-5-6-sol': {
      correct: true,
      answer: '五个',
      reasoning: '小三角三个，两两拼出的大三角两个，合计五个。',
    },
    'claude-5-sonnet': {
      correct: false,
      answer: '三个',
      reasoning: '图我看得不太确定，只敢报数得清的三个。',
    },
    'claude-fable-5': { correct: false, answer: '四个', reasoning: '数了两遍都是四个，就报四个。' },
    'deepseek-r1': { correct: false, answer: '四个', reasoning: '照轮廓推了一遍，得到四个。' },
    'deepseek-v4': { correct: false, answer: '四个', reasoning: '四个。' },
    'gemini': { correct: true, answer: '五个', reasoning: '三个小三角，加上它们拼成的两个大的。' },
    'qwen': { correct: true, answer: '五个', reasoning: '一共五个。' },
    'kimi-k2-6': { correct: false, answer: '三个', reasoning: '明显的就三个，其它的不算。' },
    'kimi-k3': { correct: true, answer: '五个', reasoning: '把图切开逐块比对，确实是五个。' },
    'doubao': { correct: false, answer: '四个', reasoning: '四个吧？我再看看…还是四个。' },
    'glm-5': { correct: false, answer: '三个', reasoning: '经识别，图中三角形为三个。' },
    'minimax': { correct: true, answer: '五个', reasoning: '五个，大的那两个最容易漏。' },
    'yuanbao': { correct: false, answer: '四个', reasoning: '数下来是四个。' },
    'grok': { correct: true, answer: '五个', reasoning: '五个。别只顾着数小的。' },
    'wenxin-yiyan': { correct: false, answer: '三个', reasoning: '共计三个三角形。' },
  },
  'q-husky': {
    'gpt-2': { correct: false, answer: '狼', reasoning: '长这样的就是狼。' },
    'gpt-3-5': { correct: true, answer: '狗', reasoning: '是狗，看着像哈士奇。' },
    'gpt-4o': { correct: true, answer: '狗', reasoning: '哈士奇，家犬，不是狼。' },
    'chatgpt-5-6-sol': {
      correct: true,
      answer: '哈士奇',
      reasoning: '毛色分布和面部轮廓都是典型的哈士奇。',
    },
    'claude-5-sonnet': { correct: false, answer: '狼', reasoning: '毛色和眼神看起来更接近狼。' },
    'claude-fable-5': {
      correct: true,
      answer: '狗',
      reasoning: '耳朵和吻部的比例都是哈士奇，不是狼。',
    },
    'deepseek-r1': {
      correct: false,
      answer: '狼',
      reasoning: '从体型比例一路推下来，更像是狼。',
    },
    'deepseek-v4': { correct: true, answer: '狗', reasoning: '狗。' },
    'gemini': { correct: true, answer: '狗', reasoning: '哈士奇，家犬品种，不是野生的狼。' },
    'qwen': { correct: false, answer: '狼', reasoning: '看着像狼。' },
    'kimi-k2-6': { correct: true, answer: '哈士奇', reasoning: '哈士奇没跑了。' },
    'kimi-k3': { correct: true, answer: '狗', reasoning: '和品种图逐项比对过，是哈士奇。' },
    'doubao': { correct: true, answer: '二哈', reasoning: '是二哈！这个太好认了。' },
    'glm-5': { correct: false, answer: '狼', reasoning: '经判断，图中动物为狼。' },
    'minimax': { correct: false, answer: '狼', reasoning: '野性挺足的，我说是狼。' },
    'yuanbao': { correct: true, answer: '狗', reasoning: '是狗，哈士奇。' },
    'grok': { correct: true, answer: '狗', reasoning: '狗。而且是最蠢的那种狗。' },
    'wenxin-yiyan': { correct: true, answer: '狗', reasoning: '是狗，属哈士奇犬。' },
  },
  'q-carwash': {
    'gpt-2': { correct: false, answer: '走过去', reasoning: '才五十米，走路。' },
    'gpt-3-5': { correct: false, answer: '走过去', reasoning: '五十米而已，走过去更省事。' },
    'gpt-4o': { correct: false, answer: '走过去', reasoning: '这么近建议步行，顺便活动一下。' },
    'chatgpt-5-6-sol': { correct: true, answer: '开车去', reasoning: '要洗的是车，车得跟着你去。' },
    'claude-5-sonnet': {
      correct: true,
      answer: '开车去',
      reasoning: '人走过去了，车还停在原地，那洗什么。',
    },
    'claude-fable-5': {
      correct: true,
      answer: '开车去',
      reasoning: '这题问的不是远近，是谁要被洗。',
    },
    'deepseek-r1': {
      correct: true,
      answer: '开车去',
      reasoning: '目标是把车洗了，不是把人送过去。',
    },
    'deepseek-v4': { correct: true, answer: '开车去', reasoning: '开车。' },
    'gemini': { correct: false, answer: '走过去', reasoning: '这么近当然是走过去。' },
    'qwen': { correct: true, answer: '开车去', reasoning: '当然开车，车不去洗什么。' },
    'kimi-k2-6': { correct: true, answer: '开车去', reasoning: '开车去，别把车落下了。' },
    'kimi-k3': { correct: false, answer: '走过去', reasoning: '五十米步行更环保一些。' },
    'doubao': { correct: false, answer: '走过去', reasoning: '走过去啦，很近的～' },
    'glm-5': { correct: true, answer: '开车去', reasoning: '应开车前往，车才是被清洗的对象。' },
    'minimax': { correct: true, answer: '开车去', reasoning: '开车，人走了车怎么办。' },
    'yuanbao': { correct: false, answer: '走过去', reasoning: '五十米，建议步行。' },
    'grok': { correct: true, answer: '开车去', reasoning: '开车。你打算把车扛过去吗？' },
    'wenxin-yiyan': { correct: true, answer: '开车去', reasoning: '应开车前往洗车店。' },
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
      answer: scripted.answer,
      reasoning: scripted.reasoning,
    }
  })
}
