import type { AiCard, CardId } from './types'

/**
 * 十八张具名 AI 牌。
 *
 * 每张都有一张专属原画（客户端 ui/aiModelArt.ts 按同一份 id 查图），所以这里的 id 是资源名的一部分，
 * 改 id 等于换图，必须两边一起改。
 *
 * 牌面上唯一的数值是 tokenCost：本迭代的胜负只看答题对错，模型答得准不准全部体现在
 * script.ts 那张「题目 × 卡牌」的剧本表里（谁擅长看图、谁容易掉进语言陷阱），
 * tokenCost 只决定这一轮出不出得起。数值大致按"越新越全能越贵"排（1~7），
 * 这批数字原先躺在客户端当卡面装饰，现在是引擎真扣的费用，改动会直接影响平衡。
 * 卡面文案是玩梗，不代表这些模型的真实表现。
 */
export const AI_MODEL_CARDS: Record<CardId, AiCard> = {
  'gpt-2': {
    kind: 'ai',
    id: 'gpt-2',
    name: 'GPT-2',
    model: 'GPT-2',
    tokenCost: 1,
    skillName: '开天辟地',
    skillText: '若本轮没有任何技能牌作用于自己，Agent 消耗 -2 Token',
    text: '它会接话，但不保证接的是人话。',
  },
  'gpt-3-5': {
    kind: 'ai',
    id: 'gpt-3-5',
    name: 'GPT-3.5',
    model: 'GPT-3.5',
    tokenCost: 2,
    skillName: '对话启蒙',
    skillText: '出牌费用 -1 Token；答对后再返还 1 Token',
    text: '什么都答得上来，答得对不对是另一回事。',
  },
  'gpt-4o': {
    kind: 'ai',
    id: 'gpt-4o',
    name: 'GPT-4o',
    model: 'GPT-4o',
    tokenCost: 4,
    skillName: '多模感知',
    skillText: '回答图片题目时，答错不被丢弃',
    text: '看得见图、听得见声，就是有点太想夸你。',
  },
  'chatgpt-5-6-sol': {
    kind: 'ai',
    id: 'chatgpt-5-6-sol',
    name: 'ChatGPT 5.6 Sol',
    model: 'ChatGPT 5.6 Sol',
    tokenCost: 7,
    skillName: '统筹推演',
    skillText: '每局一次，本轮第一张作用于自己的对方技能牌无效',
    text: '它算得比你快，也比你确信。',
  },
  'claude-5-sonnet': {
    kind: 'ai',
    id: 'claude-5-sonnet',
    name: 'Claude 5 Sonnet',
    model: 'Claude 5 Sonnet',
    tokenCost: 4,
    skillName: '文理兼修',
    skillText: '可以屏蔽「话题漂移」及「重复轰炸」一次',
    text: '写代码很稳，就是喜欢先解释一遍它打算怎么写。',
  },
  'claude-fable-5': {
    kind: 'ai',
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    model: 'Claude Fable 5',
    tokenCost: 6,
    skillName: '深思织文',
    skillText: '每局一次，可无视对方技能牌向题目中新增的文本，只根据原始题目作答',
    text: '想得又深又长，长到你忘了自己问过什么。',
  },
  'deepseek-r1': {
    kind: 'ai',
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    model: 'DeepSeek R1',
    tokenCost: 3,
    skillName: '链式推理',
    skillText: '如果第一次回答错误，可以额外进行一次回答',
    text: '先自言自语三千字，再回答你那个是非题。',
  },
  'deepseek-v4': {
    kind: 'ai',
    id: 'deepseek-v4',
    name: 'DeepSeek V4',
    model: 'DeepSeek V4',
    tokenCost: 5,
    skillName: '深海求索',
    skillText: '若本轮双方答题结果相同，则结算时本 Agent 消耗 -1 Token',
    text: '用别人一半的算力，办完一样的事。',
  },
  gemini: {
    kind: 'ai',
    id: 'gemini',
    name: 'Gemini',
    model: 'Gemini',
    tokenCost: 4,
    skillName: '多模融合',
    skillText: '回答图片题时，第一次回答错误可以重新观察图片并再次回答；每局最多触发一次',
    text: '看图这件事它最有话说。',
  },
  qwen: {
    kind: 'ai',
    id: 'qwen',
    name: '通义千问',
    model: 'Qwen',
    tokenCost: 3,
    skillName: '万语通晓',
    skillText: '每局一次，可以忽略对方技能牌向题目中添加的一条额外指令，只执行原题要求',
    text: '什么尺寸都有，什么活都接。',
  },
  'kimi-k2-6': {
    kind: 'ai',
    id: 'kimi-k2-6',
    name: 'Kimi K2.6',
    model: 'Kimi K2.6',
    tokenCost: 3,
    skillName: '长卷寻踪',
    skillText: '第一次使用此 Agent，可以对对方使用一次上下文洪水干扰',
    text: '嘴上说着「这个我不能回答」，手上已经开始写了。',
  },
  'kimi-k3': {
    kind: 'ai',
    id: 'kimi-k3',
    name: 'Kimi K3',
    model: 'Kimi K3',
    tokenCost: 5,
    skillName: '群星协作',
    skillText: '使对方回答额外消耗 1 Token，每局最多触发一次',
    text: '会自己调工具、自己查资料、自己相信查到的东西。',
  },
  doubao: {
    kind: 'ai',
    id: 'doubao',
    name: '豆包',
    model: 'Doubao',
    tokenCost: 2,
    skillName: '灵感相伴',
    skillText: '若本轮没有任何技能牌作用于自己且回答正确，返还 1 Token；每局最多触发一次',
    text: '语气永远是好脾气，答案偶尔不是。',
  },
  'glm-5': {
    kind: 'ai',
    id: 'glm-5',
    name: 'GLM-5',
    model: 'GLM-5',
    tokenCost: 4,
    skillName: '知行合一',
    skillText: '每局一次，若双方 Agent 都答错，本轮直接视为 GLM-5 获胜，不再比较 Token',
    text: '中文说得比谁都顺，顺到你懒得核对。',
  },
  minimax: {
    kind: 'ai',
    id: 'minimax',
    name: 'MiniMax',
    model: 'MiniMax',
    tokenCost: 3,
    skillName: '声影共鸣',
    skillText: '同一问题内部生成两条相互独立的候选答案；若答案不同，再执行一次最终裁决',
    text: '能说会唱，正经答题的时候有点跳。',
  },
  yuanbao: {
    kind: 'ai',
    id: 'yuanbao',
    name: '腾讯元宝',
    model: 'Yuanbao',
    tokenCost: 3,
    skillName: '博览集智',
    skillText: '每局一次，可以将一张技能牌以手牌中另一张技能牌的 Token 结算',
    text: '先去搜一圈再回来答，搜到什么信什么。',
  },
  grok: {
    kind: 'ai',
    id: 'grok',
    name: 'Grok',
    model: 'Grok',
    tokenCost: 4,
    skillName: '破界直言',
    skillText: '回答问题前先检查一下题目是否有「坑」',
    text: '想说什么说什么，护栏拦得住它一半。',
  },
  'wenxin-yiyan': {
    kind: 'ai',
    id: 'wenxin-yiyan',
    name: '文心一言',
    model: 'ERNIE',
    tokenCost: 3,
    skillName: '文心妙笔',
    skillText: '回答文字题目时，免疫对方干扰类型技能',
    text: '成语接得漂亮，事实核得一般。',
  },
}

/**
 * 十八张 AI 牌的 id，顺序就是卡池和默认牌组里的顺序（按厂商归堆，不按字母排）。
 *
 * 从 AI_MODEL_CARDS 现取而不是另写一份列表：两份列表迟早会对不上。
 */
export const AI_MODEL_CARD_IDS: CardId[] = Object.keys(AI_MODEL_CARDS)
