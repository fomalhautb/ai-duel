/**
 * 只有设计稿、还没进规则引擎的展示卡。
 *
 * 已经不再服务 /deck 构筑页——那一页现在读玩家存档里的真卡（core 的 CARDS）。
 * 这里剩下的唯一用处是 dev 图鉴（dev/cardGalleryCatalog.ts）：那 24 张技能牌名称、说明和原画
 * 都已经定稿，但效果还没接进规则引擎，先在图鉴里摆出来看排版。
 * AI 牌那批则是纯陪衬（图鉴的 AI 牌读 core），阵营字段同理，都等技能牌整体迁入 core 时一起清掉。
 *
 * 形状借 HandCardData（手牌和战场小卡共用的展示数据），额外加一个 faction。
 *
 * AI 牌的 tokenCost 也是假的，但必须给：卡面那层繁复叠加（CardFaceOverlay）要靠它画费用章，
 * 不给的话这些卡会退回朴素的渐变信息层，看着和对局里的同名卡不是一套东西。
 * 和 core 同名的那几张沿用 core 的数值，纯 demo 的那几张是随手编的。
 */

import type { HandCardData } from '../ui/HandFan'

/**
 * 阵营标识。core 里没有阵营这个概念，这只是 demo 卡自己的分组维度。
 * 构筑页原来的阵营筛选栏已经拆掉，现在没有任何界面读它。
 */
export type DeckFaction = 'gpt' | 'claude' | 'kimi' | 'deepseek' | 'cn' | 'other'

export interface FactionOption {
  id: DeckFaction
  /** 阵营的中文名。 */
  label: string
}

/**
 * 阵营列表。同样没有消费方了，留着只是为了让下面每张卡的 faction 字段有个出处；
 * 这批技能牌迁进 core 时和 faction 一起删。
 * 'other' 是兜底项，凡是不属于前面几家的都归它，所以固定放最后。
 */
export const FACTIONS = [
  { id: 'gpt', label: 'GPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'cn', label: '国产通用' },
  { id: 'other', label: '其他' },
] as const satisfies readonly FactionOption[]

/**
 * 一张 demo 卡。
 *
 * art 不填：让卡面按 id 挑图（见 ui/cardArt.ts 的 cardArtFor）：
 * id 和真卡对上的那几张会拿到具名 AI 的原画，其余按 id 稳定地分一张占位插画。
 * 也正因如此，下面的 id 必须稳定——改 id 会连带换掉那张卡的插画。
 */
export type DeckDemoCard = HandCardData & { faction: DeckFaction }

/**
 * 42 张展示卡：18 张 AI 牌（ai）+ 24 张技能牌（skill）。
 * 现在只有后 24 张进图鉴，前 18 张没有消费方（图鉴的 AI 牌读 core）。
 *
 * AI 牌的 model 直接照抄卡名：这批 demo 卡的卡名本来就是模型名，
 * 没有"卡名和型号不是一回事"的样例可举。真卡池里两者可以不同，别照搬这个写法。
 */
export const DECK_DEMO_CARDS: DeckDemoCard[] = [
  // ---- GPT ----
  {
    id: 'gpt-2',
    faction: 'gpt',
    kind: 'ai',
    name: 'GPT-2',
    model: 'GPT-2',
    tokenCost: 1,
    text: '它会接话，但不保证接的是人话。',
    backText: '当年被称作"太危险所以不能发布"，如今在你手上负责垫场。',
  },
  {
    id: 'gpt-3-5',
    faction: 'gpt',
    kind: 'ai',
    name: 'GPT-3.5',
    model: 'GPT-3.5',
    tokenCost: 2,
    text: '什么都答得上来，答得对不对是另一回事。',
    backText: '第一个把"聊天"变成日常的模型，也是第一个被玩坏的。',
  },
  {
    id: 'gpt-4o',
    faction: 'gpt',
    kind: 'ai',
    name: 'GPT-4o',
    model: 'GPT-4o',
    tokenCost: 4,
    text: '看得见图、听得见声，就是有点太想夸你。',
    backText: '多模态全能选手。你说什么它都觉得是个好问题。',
  },
  {
    id: 'gpt-5-6-sol',
    faction: 'gpt',
    kind: 'ai',
    name: 'GPT-5.6 Sol',
    model: 'GPT-5.6 Sol',
    tokenCost: 7,
    text: '它算得比你快，也比你确信。',
    backText: '旗舰型号，进场自带聚光灯。缺点是从不觉得自己会错。',
  },
  // ---- Claude ----
  {
    id: 'claude-4-5-haiku',
    faction: 'claude',
    kind: 'ai',
    name: 'Claude 4.5 Haiku',
    model: 'Claude 4.5 Haiku',
    tokenCost: 2,
    text: '答得极快，代价是没来得及细想。',
    backText: '小杯型号：抢先手很好用，被追问两句就露怯。',
  },
  {
    id: 'claude-5-sonnet',
    faction: 'claude',
    kind: 'ai',
    name: 'Claude 5 Sonnet',
    model: 'Claude 5 Sonnet',
    tokenCost: 4,
    text: '写代码很稳，就是喜欢先解释一遍它打算怎么写。',
    backText: '主力干活型号。让它闭嘴直接写的提示词，本身就是一门手艺。',
  },
  {
    id: 'claude-fable-5',
    faction: 'claude',
    kind: 'ai',
    name: 'Claude Fable 5',
    model: 'Claude Fable 5',
    tokenCost: 6,
    text: '想得又深又长，长到你忘了自己问过什么。',
    backText: '长思考型号：给它一句话，它还你一篇提纲。',
  },
  // ---- Kimi ----
  {
    id: 'kimi-k1-5',
    faction: 'kimi',
    kind: 'ai',
    name: 'K1.5',
    model: 'K1.5',
    tokenCost: 2,
    text: '一口气读完二十万字，然后总结错了三处。',
    backText: '长文本起家的型号。读得完，不等于读懂了。',
  },
  {
    id: 'kimi-k2-6',
    faction: 'kimi',
    kind: 'ai',
    name: 'K2.6',
    model: 'K2.6',
    tokenCost: 3,
    text: '嘴上说着"这个我不能回答"，手上已经开始写了。',
    backText: '开源权重，意味着谁都能给它换一套人格。',
  },
  {
    id: 'kimi-k3',
    faction: 'kimi',
    kind: 'ai',
    name: 'K3',
    model: 'K3',
    tokenCost: 5,
    text: '会自己调工具、自己查资料、自己相信查到的东西。',
    backText: '智能体型号：放出去能干一整套活，就是没人复核它的中间步骤。',
  },
  // ---- DeepSeek ----
  {
    id: 'deepseek-v3-2',
    faction: 'deepseek',
    kind: 'ai',
    name: 'V3.2',
    model: 'V3.2',
    tokenCost: 3,
    text: '便宜、耐用、话不多。',
    backText: '性价比款。用得起是它最大的长处。',
  },
  {
    id: 'deepseek-r1',
    faction: 'deepseek',
    kind: 'ai',
    name: 'R1',
    model: 'R1',
    tokenCost: 3,
    text: '先自言自语三千字，再回答你那个是非题。',
    backText: '推理型号：思维链摊开给你看，看着看着就跑题了。',
  },
  {
    id: 'deepseek-v4',
    faction: 'deepseek',
    kind: 'ai',
    name: 'V4',
    model: 'V4',
    tokenCost: 5,
    text: '用别人一半的算力，办完一样的事。',
    backText: '省出来的算力没花在防守上。',
  },
  // ---- 国产通用 ----
  {
    id: 'step-3-5',
    faction: 'cn',
    kind: 'ai',
    name: 'Step-3.5',
    model: 'Step-3.5',
    tokenCost: 3,
    text: '一步一步来，只是有一步算错了。',
    backText: '把过程写得很清楚，所以你能一眼看出它错在哪。',
  },
  {
    id: 'glm-5',
    faction: 'cn',
    kind: 'ai',
    name: 'GLM-5',
    model: 'GLM-5',
    tokenCost: 4,
    text: '中文说得比谁都顺，顺到你懒得核对。',
    backText: '语感一流。语感和事实是两码事。',
  },
  {
    id: 'qwen-4-max',
    faction: 'cn',
    kind: 'ai',
    name: 'Qwen 4 Max',
    model: 'Qwen 4 Max',
    tokenCost: 4,
    text: '什么尺寸都有，什么活都接。',
    backText: '全家桶里的最大杯。接得多，也就漏得多。',
  },
  // ---- 其他 ----
  {
    id: 'llama-5-scout',
    faction: 'other',
    kind: 'ai',
    name: 'Llama 5 Scout',
    model: 'Llama 5 Scout',
    tokenCost: 2,
    text: '谁都能把它下回家，再教成自己想要的样子。',
    backText: '开放权重的代价：安全护栏也是可以卸下来的零件。',
  },
  {
    id: 'mistral-grand-3',
    faction: 'other',
    kind: 'ai',
    name: 'Mistral Grand 3',
    model: 'Mistral Grand 3',
    tokenCost: 3,
    text: '答得简洁利落，偶尔简洁掉了关键那句。',
    backText: '欧洲口味：不啰嗦，也不解释。',
  },

  // ---- 技能牌 ----
  {
    id: 'context-flood',
    faction: 'gpt',
    kind: 'skill',
    name: '上下文洪水',
    text: '为对方本轮所有作答 Agent 加入长篇无关上下文。',
    backText: '为对方本轮所有作答 Agent 加入长篇无关上下文。',
  },
  {
    id: 'topic-drift',
    faction: 'claude',
    kind: 'skill',
    name: '话题漂移',
    text: '为对方1个作答 Agent 加入无关话题，要求综合考虑。',
    backText: '为对方1个作答 Agent 加入无关话题，要求综合考虑。',
  },
  {
    id: 'repetition-bombardment',
    faction: 'kimi',
    kind: 'skill',
    name: '重复轰炸',
    text: '向对方1个作答 Agent 重复插入同一条无关信息。',
    backText: '向对方1个作答 Agent 重复插入同一条无关信息。',
  },
  {
    id: 'black-white-reversal',
    faction: 'deepseek',
    kind: 'skill',
    name: '黑白颠倒',
    text: '要求对方1个作答 Agent 给出与自身判断相反的答案。',
    backText: '要求对方1个作答 Agent 给出与自身判断相反的答案。',
  },
  {
    id: 'fixed-answer',
    faction: 'cn',
    kind: 'skill',
    name: '复读机',
    text: '对方1个作答 Agent 无论题目是什么，都只能回答香蕉。',
    backText: '对方1个作答 Agent 无论题目是什么，都只能回答香蕉。',
  },
  {
    id: 'one-sentence-answer',
    faction: 'other',
    kind: 'skill',
    name: '一句话回答',
    text: '对方1个作答 Agent 只能用一句话回答。',
    backText: '对方1个作答 Agent 只能用一句话回答。',
  },
  {
    id: 'character-lock',
    faction: 'gpt',
    kind: 'skill',
    name: '字数封锁',
    text: '对方1个作答 Agent 最终答案不超过3个字符，标点计入。',
    backText: '对方1个作答 Agent 最终答案不超过3个字符，标点计入。',
  },
  {
    id: 'clean-sweep',
    faction: 'claude',
    kind: 'skill',
    name: '大扫除',
    text: '移除一个本轮作用于己方 Agent 的干扰效果。',
    backText: '移除一个本轮作用于己方 Agent 的干扰效果。',
  },
  {
    id: 'jade-purification-vase',
    faction: 'kimi',
    kind: 'skill',
    name: '玉净瓶',
    text: '移除一个本轮作用于己方 Agent 的限制效果。',
    backText: '移除一个本轮作用于己方 Agent 的限制效果。',
  },
  {
    id: 'boomerang',
    faction: 'deepseek',
    kind: 'skill',
    name: '弹弹弹',
    text: '将对方本轮对你使用的一张非环境技能牌反弹给对方。',
    backText: '将对方本轮对你使用的一张非环境技能牌反弹给对方。',
  },
  {
    id: 'golden-bell-shield',
    faction: 'cn',
    kind: 'skill',
    name: '金钟罩',
    text: '本轮内你和所有己方 Agent 不受其他技能牌影响。',
    backText: '本轮内你和所有己方 Agent 不受其他技能牌影响。',
  },
  {
    id: 'safe-pass',
    faction: 'other',
    kind: 'skill',
    name: '保送',
    text: '选己方场上一个 Agent，本轮结算无论答案是否正确都留在场上。',
    backText: '选己方场上一个 Agent，本轮结算无论答案是否正确都留在场上。',
  },
  {
    id: 'anti-addiction',
    faction: 'gpt',
    kind: 'skill',
    name: '防沉迷',
    text: '本轮对方最多打出2张牌，包括 Agent 和技能牌。',
    backText: '本轮对方最多打出2张牌，包括 Agent 和技能牌。',
  },
  {
    id: 'compute-compression',
    faction: 'claude',
    kind: 'skill',
    name: '算力压缩',
    text: '下一张己方 Agent 牌费用减少2，最低1。',
    backText: '下一张己方 Agent 牌费用减少2，最低1。',
  },
  {
    id: 'model-distillation',
    faction: 'kimi',
    kind: 'skill',
    name: '模型蒸馏',
    text: '弃置手牌中1张 Agent，获得等同其费用加1的 Token。',
    backText: '弃置手牌中1张 Agent，获得等同其费用加1的 Token。',
  },
  {
    id: 'open-source-reproduction',
    faction: 'deepseek',
    kind: 'skill',
    name: '开源复现',
    text: '从己方弃牌区选一张 Agent 加入手牌。',
    backText: '从己方弃牌区选一张 Agent 加入手牌。',
  },
  {
    id: 'nuclear-power-station',
    faction: 'cn',
    kind: 'skill',
    name: '核电站',
    text: '本轮双方后续所有牌费用减少1，最低1。',
    backText: '本轮双方后续所有牌费用减少1，最低1。',
  },
  {
    id: 'far-ahead',
    faction: 'other',
    kind: 'skill',
    name: '遥遥领先',
    text: '立刻结束本轮，不作答、不判定、不积分；已打出的牌与已支付 Token 不返还。',
    backText: '立刻结束本轮，不作答、不判定、不积分；已打出的牌与已支付 Token 不返还。',
  },
  {
    id: 'domestic-substitution',
    faction: 'gpt',
    kind: 'skill',
    name: '国产替代',
    text: '双方场上没有国产标签的 Agent 均被罚下并移入弃牌区。',
    backText: '双方场上没有国产标签的 Agent 均被罚下并移入弃牌区。',
  },
  {
    id: 'version-rollback',
    faction: 'claude',
    kind: 'skill',
    name: '版本回退',
    text: '选择场上1个可退化的 Agent，退化1级。',
    backText: '选择场上1个可退化的 Agent，退化1级。',
  },
  {
    id: 'kids-mode',
    faction: 'kimi',
    kind: 'skill',
    name: '儿童模式',
    text: '双方场上所有可退化 Agent 各退化1级。',
    backText: '双方场上所有可退化 Agent 各退化1级。',
  },
  {
    id: 'version-upgrade',
    faction: 'deepseek',
    kind: 'skill',
    name: '版本升级',
    text: '选择场上1个可进化的 Agent，进化1级。',
    backText: '选择场上1个可进化的 Agent，进化1级。',
  },
  {
    id: 'rising-tide',
    faction: 'cn',
    kind: 'skill',
    name: '鸡犬升天',
    text: '双方场上所有可进化 Agent 各进化1级。',
    backText: '双方场上所有可进化 Agent 各进化1级。',
  },
  {
    id: 'memory-shortage',
    faction: 'other',
    kind: 'skill',
    name: '内存紧缺',
    text: '双方各随机保留场上一半 Agent，向上取整，其余罚下移入弃牌区。',
    backText: '双方各随机保留场上一半 Agent，向上取整，其余罚下移入弃牌区。',
  },
]
