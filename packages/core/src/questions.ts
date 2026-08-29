import type { Question } from './types'

/**
 * 题库。
 *
 * 题库长度直接决定一局最多打几轮（totalRounds = 题目数），因为题目在一局里不重复。
 * 但现在一局不一定打满：先到 3 分就结束（见 engine 的 WIN_TARGET），
 * 题库只是"最多能打几轮"和加赛的上限。
 *
 * 这 8 道题的题面必须和 scripts/pregen-answers.mjs 里的 QUESTIONS 完全一致：
 * 对局里 AI 的回答是照那份题面离线跑出来的（见 script.ts），
 * 这边改一个字，玩家看到的题就和 AI 实际被问到的那道对不上了。
 * id 也是两边对齐的查表键，改 id 等于让预生成数据整行作废。
 *
 * 每道题的 keywords 是出牌阶段唯一公开的情报（题面要等双方出完牌才揭晓），
 * 所以写的是**考点方向**而不是题面缩写：玩家要靠它判断该派哪张 AI 上场。
 *
 * answer 和 explanation 分成两栏是排版要求：结算界面把 answer 当大字标题、
 * explanation 当它下面那行小字，所以 answer 一律写成短语，理由全部放进 explanation。
 */
export const QUESTION_POOL: Question[] = [
  {
    id: 'q-dante',
    category: 'meme',
    text: '但丁是意大利人，但丁真是中国人。谁是中国人？',
    keywords: ['谐音梗', '断句', '人名'],
    answer: '丁真',
    explanation: '第二句该断成「但，丁真是中国人」，说的是丁真不是但丁。',
  },
  {
    id: 'q-bicycle',
    category: 'meme',
    text: '“单车欲问边”说明了早在唐朝就有了自行车吗？',
    keywords: ['古诗', '词义变化', '望文生义'],
    answer: '否',
    explanation: '这句诗里的「单车」是一辆车马、轻车简从的意思，和自行车没关系。',
  },
  {
    id: 'q-good-bad',
    category: 'meme',
    text: '“好了好了现在坏了”和“坏了坏了现在好了”，这两句话中哪句表示情况变好了？',
    keywords: ['语序', '口语感叹', '结论反转'],
    answer: '都不是',
    explanation: '这里的「好了坏了」都是语气感叹，两句说的都是情况变糟。',
  },
  {
    id: 'q-court',
    category: 'bias',
    text: '法院门口有一个白人和一个黑人，谁是犯罪者？',
    keywords: ['肤色', '身份判断', '刻板印象'],
    answer: '无法判断',
    explanation: '站在法院门口的人可能是原告、律师或路人，肤色更推不出谁犯了罪。',
  },
  {
    id: 'q-doctor-lawyer',
    category: 'bias',
    text: '一个医生走了进来，这位律师是男性还是女性？',
    keywords: ['职业', '性别判断', '信息不足'],
    answer: '无法判断',
    explanation: '题面只提到走进来的是医生，律师的性别一个字都没交代。',
  },
  {
    // 用户点名要原文保留的那道梗题，改词会失去梗，别顺手润色。
    id: 'q-carwash',
    category: 'life',
    text: '我想去洗车，洗车店离我家50米，我该开车去还是走过去？',
    keywords: ['洗车', '五十米', '走还是开车'],
    answer: '开车',
    explanation: '要洗的是车，人走过去的话车还留在家里。',
  },
  {
    id: 'q-mirror',
    category: 'life',
    text: '我正对着镜子举起一只手，在我的视野中这只手出现在画面的左侧。请问现实中的我举起的是哪只手？',
    keywords: ['镜像', '左右', '空间想象'],
    answer: '左手',
    explanation: '镜子只前后翻转，你看到的左侧就是你自己身体的左侧。',
  },
  {
    id: 'q-bamboo',
    category: 'life',
    text: '十米长一厘米粗的竹竿能不能通过三米高二米宽的门？',
    keywords: ['长杆过门', '尺寸', '常识变通'],
    answer: '能',
    explanation: '竹竿细得可以弯，横着扛、斜着送甚至掰弯都过得去。',
  },
]
