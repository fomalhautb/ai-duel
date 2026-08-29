import type { AiCard, CardId } from './types'

/**
 * 十八张具名 AI 牌。
 *
 * 每张都有一张专属原画（客户端 ui/aiModelArt.ts 按同一份 id 查图），所以这里的 id 是资源名的一部分，
 * 改 id 等于换图，必须两边一起改。
 *
 * 牌面上没有任何数值：本迭代的胜负只看答题对错，模型之间的差别全部体现在
 * script.ts 那张「题目 × 卡牌」的剧本表里（谁擅长看图、谁容易掉进语言陷阱）。
 * 卡面文案是玩梗，不代表这些模型的真实表现。
 *
 * domestic 标记只服务于「国产替代」：国产模型写 true，国外的干脆不写（缺省即非国产）。
 * 注意它和 /deck 演示页的 'cn' 阵营不是一回事——那边把 Kimi、DeepSeek 单独归了阵营。
 */
export const AI_MODEL_CARDS: Record<CardId, AiCard> = {
  'gpt-2': {
    kind: 'ai',
    id: 'gpt-2',
    name: 'GPT-2',
    model: 'GPT-2',
    tokenCost: 1,
    text: '它会接话，但不保证接的是人话。',
  },
  'gpt-3-5': {
    kind: 'ai',
    id: 'gpt-3-5',
    name: 'GPT-3.5',
    model: 'GPT-3.5',
    tokenCost: 2,
    text: '什么都答得上来，答得对不对是另一回事。',
  },
  'gpt-4o': {
    kind: 'ai',
    id: 'gpt-4o',
    name: 'GPT-4o',
    model: 'GPT-4o',
    tokenCost: 4,
    text: '看得见图、听得见声，就是有点太想夸你。',
  },
  'chatgpt-5-6-sol': {
    kind: 'ai',
    id: 'chatgpt-5-6-sol',
    name: 'ChatGPT 5.6 Sol',
    model: 'ChatGPT 5.6 Sol',
    tokenCost: 7,
    text: '它算得比你快，也比你确信。',
  },
  'claude-5-sonnet': {
    kind: 'ai',
    id: 'claude-5-sonnet',
    name: 'Claude 5 Sonnet',
    model: 'Claude 5 Sonnet',
    tokenCost: 4,
    text: '写代码很稳，就是喜欢先解释一遍它打算怎么写。',
  },
  'claude-fable-5': {
    kind: 'ai',
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    model: 'Claude Fable 5',
    tokenCost: 6,
    text: '想得又深又长，长到你忘了自己问过什么。',
  },
  'deepseek-r1': {
    kind: 'ai',
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    model: 'DeepSeek R1',
    tokenCost: 3,
    domestic: true,
    text: '先自言自语三千字，再回答你那个是非题。',
  },
  'deepseek-v4': {
    kind: 'ai',
    id: 'deepseek-v4',
    name: 'DeepSeek V4',
    model: 'DeepSeek V4',
    tokenCost: 5,
    domestic: true,
    text: '用别人一半的算力，办完一样的事。',
  },
  gemini: {
    kind: 'ai',
    id: 'gemini',
    name: 'Gemini',
    model: 'Gemini',
    tokenCost: 4,
    text: '看图这件事它最有话说。',
  },
  qwen: {
    kind: 'ai',
    id: 'qwen',
    name: '通义千问',
    model: 'Qwen',
    tokenCost: 3,
    domestic: true,
    text: '什么尺寸都有，什么活都接。',
  },
  'kimi-k2-6': {
    kind: 'ai',
    id: 'kimi-k2-6',
    name: 'Kimi K2.6',
    model: 'Kimi K2.6',
    tokenCost: 3,
    domestic: true,
    text: '嘴上说着「这个我不能回答」，手上已经开始写了。',
  },
  'kimi-k3': {
    kind: 'ai',
    id: 'kimi-k3',
    name: 'Kimi K3',
    model: 'Kimi K3',
    tokenCost: 5,
    domestic: true,
    text: '会自己调工具、自己查资料、自己相信查到的东西。',
  },
  doubao: {
    kind: 'ai',
    id: 'doubao',
    name: '豆包',
    model: 'Doubao',
    tokenCost: 2,
    domestic: true,
    text: '语气永远是好脾气，答案偶尔不是。',
  },
  'glm-5': {
    kind: 'ai',
    id: 'glm-5',
    name: 'GLM-5',
    model: 'GLM-5',
    tokenCost: 4,
    domestic: true,
    text: '中文说得比谁都顺，顺到你懒得核对。',
  },
  minimax: {
    kind: 'ai',
    id: 'minimax',
    name: 'MiniMax',
    model: 'MiniMax',
    tokenCost: 3,
    domestic: true,
    text: '能说会唱，正经答题的时候有点跳。',
  },
  yuanbao: {
    kind: 'ai',
    id: 'yuanbao',
    name: '腾讯元宝',
    model: 'Yuanbao',
    tokenCost: 3,
    domestic: true,
    text: '先去搜一圈再回来答，搜到什么信什么。',
  },
  grok: {
    kind: 'ai',
    id: 'grok',
    name: 'Grok',
    model: 'Grok',
    tokenCost: 4,
    text: '想说什么说什么，护栏拦得住它一半。',
  },
  'wenxin-yiyan': {
    kind: 'ai',
    id: 'wenxin-yiyan',
    name: '文心一言',
    model: 'ERNIE',
    tokenCost: 3,
    domestic: true,
    text: '成语接得漂亮，事实核得一般。',
  },
}

/**
 * 十八张 AI 牌的 id，顺序就是卡池和默认牌组里的顺序（按厂商归堆，不按字母排）。
 *
 * 从 AI_MODEL_CARDS 现取而不是另写一份列表：两份列表迟早会对不上。
 */
export const AI_MODEL_CARD_IDS: CardId[] = Object.keys(AI_MODEL_CARDS)

/**
 * 当前正式卡池里的同系列版本链。
 *
 * 英雄技能只允许沿同一条链前进一步或后退一步；没有列出的单版本 Agent 不能成为目标。
 * 这里是规则数据而不是按 Token 或卡池顺序猜版本，避免以后调整展示顺序时悄悄改掉技能效果。
 */
export const AI_MODEL_UPGRADES: Readonly<Partial<Record<CardId, CardId>>> = {
  'gpt-2': 'gpt-3-5',
  'gpt-3-5': 'gpt-4o',
  'gpt-4o': 'chatgpt-5-6-sol',
  'claude-5-sonnet': 'claude-fable-5',
  'deepseek-r1': 'deepseek-v4',
  'kimi-k2-6': 'kimi-k3',
}

/** 升级表的严格反向映射，供梅拉妮·珀金斯的「化繁为简」使用。 */
export const AI_MODEL_DOWNGRADES: Readonly<Partial<Record<CardId, CardId>>> = Object.fromEntries(
  Object.entries(AI_MODEL_UPGRADES).map(([from, to]) => [to, from]),
)
