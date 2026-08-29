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
    text: '先自言自语三千字，再回答你那个是非题。',
  },
  'deepseek-v4': {
    kind: 'ai',
    id: 'deepseek-v4',
    name: 'DeepSeek V4',
    model: 'DeepSeek V4',
    tokenCost: 5,
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
    text: '什么尺寸都有，什么活都接。',
  },
  'kimi-k2-6': {
    kind: 'ai',
    id: 'kimi-k2-6',
    name: 'Kimi K2.6',
    model: 'Kimi K2.6',
    tokenCost: 3,
    text: '嘴上说着「这个我不能回答」，手上已经开始写了。',
  },
  'kimi-k3': {
    kind: 'ai',
    id: 'kimi-k3',
    name: 'Kimi K3',
    model: 'Kimi K3',
    tokenCost: 5,
    text: '会自己调工具、自己查资料、自己相信查到的东西。',
  },
  doubao: {
    kind: 'ai',
    id: 'doubao',
    name: '豆包',
    model: 'Doubao',
    tokenCost: 2,
    text: '语气永远是好脾气，答案偶尔不是。',
  },
  'glm-5': {
    kind: 'ai',
    id: 'glm-5',
    name: 'GLM-5',
    model: 'GLM-5',
    tokenCost: 4,
    text: '中文说得比谁都顺，顺到你懒得核对。',
  },
  minimax: {
    kind: 'ai',
    id: 'minimax',
    name: 'MiniMax',
    model: 'MiniMax',
    tokenCost: 3,
    text: '能说会唱，正经答题的时候有点跳。',
  },
  yuanbao: {
    kind: 'ai',
    id: 'yuanbao',
    name: '腾讯元宝',
    model: 'Yuanbao',
    tokenCost: 3,
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
 * 同系列的升级链，每条按"从老到新"排。
 *
 * 升降级技能（陈丹琦的「精准检索」、梅拉妮·珀金斯的「化繁为简」）就是**把场上那个单位的
 * `cardId` 换成链上相邻的一张**，不另加任何数值修正：
 * 答题表现本来就写在 script.ts 那张「题目 × 卡牌」的静态表里，换了卡自然就换了一整套答题结果，
 * 引擎不必再理解"强了多少"。费用也不用重算——技能是免费换卡，不退不补（见 engine.ts 的 useHeroSkill）。
 *
 * 只有确实存在代际关系的四个系列进表，其余 8 张（Gemini / 通义千问 / 豆包 / GLM-5 /
 * MiniMax / 腾讯元宝 / Grok / 文心一言）在卡池里各自只有一代，指向它们的升降级一律被拒。
 * 每张卡最多出现在一条链里、链内不重复，所以查上一代/下一代都是唯一答案。
 */
export const AI_UPGRADE_CHAINS: readonly (readonly CardId[])[] = [
  ['gpt-2', 'gpt-3-5', 'gpt-4o', 'chatgpt-5-6-sol'],
  ['claude-5-sonnet', 'claude-fable-5'],
  ['deepseek-r1', 'deepseek-v4'],
  ['kimi-k2-6', 'kimi-k3'],
]

/** 在升级链上按 step 找相邻的一张：+1 是下一代，-1 是上一代；不在链上或走出两端都是 null。 */
function chainNeighbor(cardId: CardId, step: 1 | -1): CardId | null {
  for (const chain of AI_UPGRADE_CHAINS) {
    const index = chain.indexOf(cardId)
    if (index < 0) continue
    return chain[index + step] ?? null
  }
  return null
}

/** 这张 AI 牌升一级会变成谁。已经是链上最新的一代、或者根本没有同系列的其它代，都返回 null。 */
export function upgradeTargetOf(cardId: CardId): CardId | null {
  return chainNeighbor(cardId, 1)
}

/** 这张 AI 牌降一级会变成谁。已经是链上最早的一代、或者根本没有同系列的其它代，都返回 null。 */
export function downgradeTargetOf(cardId: CardId): CardId | null {
  return chainNeighbor(cardId, -1)
}
