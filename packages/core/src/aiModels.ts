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
 *
 * openrouter 是这张牌答题时真正去调的模型。其中两张填的是 null——GPT-2 和文心一言在
 * OpenRouter 上都没有对得上的模型（各自的原委写在那两张牌旁边），它们因此不进卡池
 *（见 collection.ts 的 CARD_POOL），牌组页仍然把它们灰着摆在最后，和「即将上线」的技能牌
 * 一个待遇。
 * 离线预生成脚本 scripts/pregen-answers.mjs 另有一份自己的模型表：那边除了 id 还要配
 * 思考强度和截断方式，是这份表的一个带调参的子集，加模型时两处都要看一眼。
 *
 * 另有两个给技能牌读的标签，改动同样会直接影响平衡。它们和"调不调得到模型"是两回事，
 * 所以 openrouter 为 null 的那两张照样带着标签（文心一言仍然算国产、GPT-2 仍是进化链链头）：
 * - `domestic`：国产模型（下面 10 张）。「国产替代」把双方场上没标它的全部罚下。
 * - `evolvesTo`：进化链的下一级。四条链 gpt-2→gpt-3-5→gpt-4o→chatgpt-5-6-sol、
 *   claude-5-sonnet→claude-fable-5、deepseek-r1→deepseek-v4、kimi-k2-6→kimi-k3，
 *   「鸡犬升天」顺着它把场上单位换成下一张。链尾和 Gemini、Grok 这类没有前后代的单张不填，
 *   也就是"不可进化"。链是按同厂商的代际排的，跨厂商不连，费用也顺着链递增。
 */
export const AI_MODEL_CARDS: Record<CardId, AiCard> = {
  'gpt-2': {
    kind: 'ai',
    id: 'gpt-2',
    name: 'GPT-2',
    model: 'GPT-2',
    // OpenRouter 没有 GPT-2：最老的 OpenAI 模型只到 gpt-3.5-turbo，连补全时代的
    // davinci / babbage 都没上架，也没有第三方托管。这张牌因此进不了牌组。
    openrouter: null,
    tokenCost: 1,
    evolvesTo: 'gpt-3-5',
    text: '它会接话，但不保证接的是人话。',
  },
  'gpt-3-5': {
    kind: 'ai',
    id: 'gpt-3-5',
    name: 'GPT-3.5',
    model: 'GPT-3.5',
    openrouter: 'openai/gpt-3.5-turbo',
    tokenCost: 2,
    evolvesTo: 'gpt-4o',
    text: '什么都答得上来，答得对不对是另一回事。',
  },
  'gpt-4o': {
    kind: 'ai',
    id: 'gpt-4o',
    name: 'GPT-4o',
    model: 'GPT-4o',
    openrouter: 'openai/gpt-4o',
    tokenCost: 4,
    evolvesTo: 'chatgpt-5-6-sol',
    text: '看得见图、听得见声，就是有点太想夸你。',
  },
  'chatgpt-5-6-sol': {
    kind: 'ai',
    id: 'chatgpt-5-6-sol',
    name: 'ChatGPT 5.6 Sol',
    model: 'ChatGPT 5.6 Sol',
    openrouter: 'openai/gpt-5.6-sol',
    tokenCost: 7,
    text: '它算得比你快，也比你确信。',
  },
  'claude-5-sonnet': {
    kind: 'ai',
    id: 'claude-5-sonnet',
    name: 'Claude 5 Sonnet',
    model: 'Claude 5 Sonnet',
    openrouter: 'anthropic/claude-sonnet-5',
    tokenCost: 4,
    evolvesTo: 'claude-fable-5',
    text: '写代码很稳，就是喜欢先解释一遍它打算怎么写。',
  },
  'claude-fable-5': {
    kind: 'ai',
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    model: 'Claude Fable 5',
    openrouter: 'anthropic/claude-fable-5',
    tokenCost: 6,
    text: '想得又深又长，长到你忘了自己问过什么。',
  },
  'deepseek-r1': {
    kind: 'ai',
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    model: 'DeepSeek R1',
    openrouter: 'deepseek/deepseek-r1',
    domestic: true,
    tokenCost: 3,
    evolvesTo: 'deepseek-v4',
    text: '先自言自语三千字，再回答你那个是非题。',
  },
  'deepseek-v4': {
    kind: 'ai',
    id: 'deepseek-v4',
    name: 'DeepSeek V4',
    model: 'DeepSeek V4',
    openrouter: 'deepseek/deepseek-v4-pro',
    domestic: true,
    tokenCost: 5,
    text: '用别人一半的算力，办完一样的事。',
  },
  gemini: {
    kind: 'ai',
    id: 'gemini',
    name: 'Gemini',
    model: 'Gemini',
    // 卡面只写「Gemini」没有版本号，就挑现役最新的那档通用款。
    openrouter: 'google/gemini-3.7-flash',
    tokenCost: 4,
    text: '看图这件事它最有话说。',
  },
  qwen: {
    kind: 'ai',
    id: 'qwen',
    name: '通义千问',
    model: 'Qwen',
    // 同上，卡面没有版本号，取千问自家的旗舰档 Max。
    openrouter: 'qwen/qwen3.8-max',
    domestic: true,
    tokenCost: 3,
    text: '什么尺寸都有，什么活都接。',
  },
  'kimi-k2-6': {
    kind: 'ai',
    id: 'kimi-k2-6',
    name: 'Kimi K2.6',
    model: 'Kimi K2.6',
    openrouter: 'moonshotai/kimi-k2.6',
    domestic: true,
    tokenCost: 3,
    evolvesTo: 'kimi-k3',
    text: '嘴上说着「这个我不能回答」，手上已经开始写了。',
  },
  'kimi-k3': {
    kind: 'ai',
    id: 'kimi-k3',
    name: 'Kimi K3',
    model: 'Kimi K3',
    openrouter: 'moonshotai/kimi-k3',
    domestic: true,
    tokenCost: 5,
    text: '会自己调工具、自己查资料、自己相信查到的东西。',
  },
  doubao: {
    kind: 'ai',
    id: 'doubao',
    name: '豆包',
    model: 'Doubao',
    // 豆包是字节的 App 名，OpenRouter 上架的是它底座的 Seed 系列，所以调 Seed。
    openrouter: 'bytedance-seed/seed-2-1-turbo',
    domestic: true,
    tokenCost: 2,
    text: '语气永远是好脾气，答案偶尔不是。',
  },
  'glm-5': {
    kind: 'ai',
    id: 'glm-5',
    name: 'GLM-5',
    model: 'GLM-5',
    openrouter: 'z-ai/glm-5',
    domestic: true,
    tokenCost: 4,
    text: '中文说得比谁都顺，顺到你懒得核对。',
  },
  minimax: {
    kind: 'ai',
    id: 'minimax',
    name: 'MiniMax',
    model: 'MiniMax',
    openrouter: 'minimax/minimax-m3',
    domestic: true,
    tokenCost: 3,
    text: '能说会唱，正经答题的时候有点跳。',
  },
  yuanbao: {
    kind: 'ai',
    id: 'yuanbao',
    name: '腾讯元宝',
    model: 'Yuanbao',
    // 同豆包：元宝是腾讯的 App 名，OpenRouter 上架的是它底座的混元，所以调 hy3。
    openrouter: 'tencent/hy3',
    domestic: true,
    tokenCost: 3,
    text: '先去搜一圈再回来答，搜到什么信什么。',
  },
  grok: {
    kind: 'ai',
    id: 'grok',
    name: 'Grok',
    model: 'Grok',
    openrouter: 'x-ai/grok-4.6',
    tokenCost: 4,
    text: '想说什么说什么，护栏拦得住它一半。',
  },
  'wenxin-yiyan': {
    kind: 'ai',
    id: 'wenxin-yiyan',
    name: '文心一言',
    model: 'ERNIE',
    // OpenRouter 上百度只有 ernie-4.5-vl 这一个旧的开源视觉版，不是文心一言现役的那个模型，
    // 拿它冒充等于卡面写一套、答题的是另一套。宁可不接，这张牌因此进不了牌组。
    openrouter: null,
    domestic: true,
    tokenCost: 3,
    text: '成语接得漂亮，事实核得一般。',
  },
}

/**
 * 十八张 AI 牌的 id，顺序就是它们在牌组页里的顺序（按厂商归堆，不按字母排）。
 * 这份是全的，含调不到模型的那两张——图鉴和卡面调试页要能逐张画出来。
 *
 * 从 AI_MODEL_CARDS 现取而不是另写一份列表：两份列表迟早会对不上。
 */
export const AI_MODEL_CARD_IDS: CardId[] = Object.keys(AI_MODEL_CARDS)

/**
 * 调得到模型、真能上场的那 16 张，顺序同上。
 *
 * 只有它们进卡池（collection.ts 的 CARD_POOL），也只有它们能被选进牌组、能在对局里出现。
 * 组织方式对齐技能牌那边的 OPEN_SKILL_CARD_IDS：那批是"产品还没开放"，这批是"模型调不到"，
 * 在牌组页里是同一种待遇——灰着摆在卡池最后，碰一下只说一句为什么。
 */
export const PLAYABLE_AI_CARD_IDS: CardId[] = AI_MODEL_CARD_IDS.filter(
  (id) => AI_MODEL_CARDS[id]?.openrouter !== null,
)

/**
 * 调不到模型的那两张（GPT-2、文心一言），顺序同上。
 *
 * 对应技能牌那边的 COMING_SOON_SKILL_CARD_IDS，用法也一样：牌组页把这份列表拼在卡池后面，
 * 于是它们天然排在所有能选的卡之后（见 DeckScreen 的 shown）。
 * 哪天 OpenRouter 上架了对得上的模型，把那张牌的 openrouter 填上，这两份名单自己就改好了。
 */
export const UNAVAILABLE_AI_CARD_IDS: CardId[] = AI_MODEL_CARD_IDS.filter(
  (id) => AI_MODEL_CARDS[id]?.openrouter === null,
)

/**
 * 同系列的升级链，每条按"从老到新"排。
 *
 * **不是另写一份名单，而是顺着每张卡的 `evolvesTo` 现串出来的**：链头是"没有任何卡指向它、
 * 自己又指向别人"的那几张，从链头一路跟着 evolvesTo 走到头就是一条链。
 * 这么做是因为同一份代际关系有两个读者——技能牌「鸡犬升天」直接读 `evolvesTo` 逐个进化，
 * 英雄技能「精准检索」/「化繁为简」读这份链表升降级。写成两份迟早会对不上，
 * 那时同一对卡在两条路径上会给出不同的下一代，谁都说不清哪个才算数。
 *
 * 升降级技能就是**把场上那个单位的 `cardId` 换成链上相邻的一张**，不另加任何数值修正：
 * 答题表现本来就写在 script.ts 那张「题目 × 卡牌」的静态表里，换了卡自然就换了一整套答题结果，
 * 引擎不必再理解"强了多少"。费用也不用重算——技能是免费换卡，不退不补（见 engine.ts 的 useHeroSkill）。
 *
 * 只有确实存在代际关系的四个系列会串出链来（GPT / Claude / DeepSeek / Kimi），
 * 其余 8 张（Gemini / 通义千问 / 豆包 / GLM-5 / MiniMax / 腾讯元宝 / Grok / 文心一言）
 * 不带 evolvesTo、也没人指向它们，指向它们的升降级一律被拒。
 * 每张卡最多出现在一条链里、链内不重复，所以查上一代/下一代都是唯一答案。
 *
 * 链条**不避开 UNAVAILABLE_AI_CARD_IDS**：GPT-2 调不到模型、进不了牌组，
 * 但珀金斯照样能把对面的 GPT-3.5 降成它——那两份名单管的是"玩家能不能把这张牌选进牌组"，
 * 而答题结果眼下走 script.ts 那张静态表，18 张卡全都有词条，降成 GPT-2 一样答得出来。
 * 不为此特判是有意的：链条按代际关系排就够了，多一条"跳过调不到的那张"的规则
 * 只会让"降一代"这件事变得难以预期（对面看到的会是 GPT-3.5 直接掉成……什么？）。
 * 将来真接上模型 API，再决定是给这两张配一个替身模型，还是那时才把它们从链上摘掉。
 */
export const AI_UPGRADE_CHAINS: readonly (readonly CardId[])[] = buildUpgradeChains()

function buildUpgradeChains(): CardId[][] {
  // 被别人指着的都不是链头。evolvesTo 里的每个值最多被一张卡指向（由测试守着），
  // 所以"没被指过"就足以认出链头，不用再判环。
  const pointedAt = new Set(
    AI_MODEL_CARD_IDS.map((id) => AI_MODEL_CARDS[id]?.evolvesTo).filter(
      (id): id is CardId => id !== undefined,
    ),
  )
  const chains: CardId[][] = []
  for (const head of AI_MODEL_CARD_IDS) {
    if (pointedAt.has(head) || AI_MODEL_CARDS[head]?.evolvesTo === undefined) continue
    const chain: CardId[] = [head]
    // 一路跟着 evolvesTo 走到头。链上不会有环（collection 的测试守着"不指回自己"，
    // 加上上面那条"每张最多被指一次"，环就无从形成）。
    let next: CardId | undefined = AI_MODEL_CARDS[head]?.evolvesTo
    while (next !== undefined) {
      chain.push(next)
      next = AI_MODEL_CARDS[next]?.evolvesTo
    }
    chains.push(chain)
  }
  return chains
}

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
