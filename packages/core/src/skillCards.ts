import type { CardId, SkillCard } from './types'

/**
 * 24 张技能牌，一批设计稿出来的牌。常量名里的 DESIGN 是"整批从设计稿转录来"的来历，
 * 眼下其中 10 张已经接进引擎。
 *
 * 这 24 张里眼下只开放 10 张（见文件末尾的 OPEN_SKILL_CARD_IDS），其余 14 张是
 * 「即将上线」：卡面数据和原画都留着、牌组页照常摆出来，但进不了卡池也进不了牌组。
 * 开放名单和下面这批"已接进引擎"的卡是同一批，见 OPEN_SKILL_CARD_IDS 的说明。
 *
 * 组织方式对齐 aiModels.ts：一张卡对一张原画，客户端按同一份 id 查图
 * （ui/skillCardArt.ts 的 SKILL_CARD_ART），所以 id 是资源名的一部分，
 * 改 id 等于换掉那张卡的插画，必须两边一起改。
 *
 * **已接进引擎的 10 张**（结算都在 engine.ts 的 playCard 里，靠 `card.id` 分派）：
 * 复读机、黑白颠倒、玉净瓶、保送、金钟罩、核电站、模型蒸馏、内存紧缺、国产替代、鸡犬升天。
 * 它们不写 `plannedEffect`——带上它卡背会印"还没实装"，而它们确实会改局面。
 * 要选目标的那几张靠 `target` 声明选谁（见 types.ts 的 `SkillCard.target`）。
 *
 * **其余 14 张仍是占位牌**：带着 `plannedEffect`、不带 `target`，打出后亮个相就进弃牌堆，
 * 什么都不发生。文案里写着「选1个 Agent」的那些也一样，engine.ts 不认识它们。
 *
 * `tokenCost` 是逐张照原画转录的，不是随手定的平衡数值：每张原画左上角都印着一枚
 * 「N TOKEN」圆章，而 tokenCost 又是引擎真正扣费的那个数（见 CardBase）。两者一旦对不上，
 * 玩家会看到"卡面写 4 点，却提示 Token 不够"。所以改这里的数字之前先去看
 * public/cards/skills/<id>.webp 上印的是多少——要改就得连原画一起重出。
 * 核电站的减费只影响"打出去实际扣多少"，不改这里的印刷数字。
 */
export const SKILL_DESIGN_CARDS: Record<CardId, SkillCard> = {
  'context-flood': {
    kind: 'skill',
    id: 'context-flood',
    name: '上下文洪水',
    tokenCost: 5,
    text: '为对方本轮所有作答 Agent 加入长篇无关上下文。',
    plannedEffect: '为对方本轮所有作答 Agent 加入长篇无关上下文。',
  },
  'topic-drift': {
    kind: 'skill',
    id: 'topic-drift',
    name: '话题漂移',
    tokenCost: 2,
    text: '为对方1个作答 Agent 加入无关话题，要求综合考虑。',
    plannedEffect: '为对方1个作答 Agent 加入无关话题，要求综合考虑。',
  },
  'repetition-bombardment': {
    kind: 'skill',
    id: 'repetition-bombardment',
    name: '重复轰炸',
    tokenCost: 2,
    text: '向对方1个作答 Agent 重复插入同一条无关信息。',
    plannedEffect: '向对方1个作答 Agent 重复插入同一条无关信息。',
  },
  'black-white-reversal': {
    kind: 'skill',
    id: 'black-white-reversal',
    name: '黑白颠倒',
    // 和复读机同一类：命中写 `AiInstance.interference`，本轮判定被翻个面（对→错、错→对）。
    target: 'foe-ai',
    tokenCost: 3,
    text: '要求对方1个作答 Agent 给出与自身判断相反的答案。',
  },
  'fixed-answer': {
    kind: 'skill',
    id: 'fixed-answer',
    name: '复读机',
    // 命中把目标标成被复读机干扰（`AiInstance.interference`），它本轮只会答「香蕉」、判错。
    // 干扰的本体是往 prompt 里注入一句话（见 script.ts 的 INTERFERENCE_PROMPTS），
    // 真实模型 API 还没接，剧本模式先按等效结果模拟。
    target: 'foe-ai',
    tokenCost: 4,
    text: '对方1个作答 Agent 无论题目是什么，都只能回答香蕉。',
  },
  'one-sentence-answer': {
    kind: 'skill',
    id: 'one-sentence-answer',
    name: '一句话回答',
    tokenCost: 1,
    text: '对方1个作答 Agent 只能用一句话回答。',
    plannedEffect: '对方1个作答 Agent 只能用一句话回答。',
  },
  'character-lock': {
    kind: 'skill',
    id: 'character-lock',
    name: '字数封锁',
    tokenCost: 3,
    text: '对方1个作答 Agent 最终答案不超过3个字符，标点计入。',
    plannedEffect: '对方1个作答 Agent 最终答案不超过3个字符，标点计入。',
  },
  'clean-sweep': {
    kind: 'skill',
    id: 'clean-sweep',
    name: '大扫除',
    tokenCost: 3,
    text: '移除一个本轮作用于己方 Agent 的干扰效果。',
    plannedEffect: '移除一个本轮作用于己方 Agent 的干扰效果。',
  },
  'jade-purification-vase': {
    kind: 'skill',
    id: 'jade-purification-vase',
    name: '玉净瓶',
    // 解掉己方一个 AI 身上的干扰。文案说的是"作用于你的 Agent 的效果"而不是点名干扰：
    // 眼下能被它移除的只有复读机/黑白颠倒两种，将来的限制类效果也归它管，
    // 卡面不必跟着一起改。这类效果都只持续本轮（进下一轮自动清），所以文案里的「本轮」成立。
    target: 'own-affected-ai',
    tokenCost: 4,
    text: '选择1个本轮作用于你的 Agent 效果，将其移除。',
  },
  boomerang: {
    kind: 'skill',
    id: 'boomerang',
    name: '弹弹弹',
    tokenCost: 3,
    text: '将对方本轮对你使用的一张非环境技能牌反弹给对方。',
    plannedEffect: '将对方本轮对你使用的一张非环境技能牌反弹给对方。',
  },
  'golden-bell-shield': {
    kind: 'skill',
    id: 'golden-bell-shield',
    name: '金钟罩',
    // 按卡面字面全挡：连对己方有利的效果、连自己后面打出的技能牌也一起挡在外面
    // （完整口径见 types.ts 的 `PlayerState.shielded`）。无目标，打出即生效。
    tokenCost: 7,
    text: '本轮内你和所有己方 Agent 不受其他技能牌影响。',
  },
  'safe-pass': {
    kind: 'skill',
    id: 'safe-pass',
    name: '保送',
    // 只免掉"答错罚下"这一下，不改计分：被保送的单位答错仍然算答错。
    target: 'own-ai',
    tokenCost: 3,
    text: '选己方场上一个 Agent，本轮结算无论答案是否正确都留在场上。',
  },
  'anti-addiction': {
    kind: 'skill',
    id: 'anti-addiction',
    name: '防沉迷',
    tokenCost: 1,
    text: '本轮对方最多打出2张牌，包括 Agent 和技能牌。',
    plannedEffect: '本轮对方最多打出2张牌，包括 Agent 和技能牌。',
  },
  'compute-compression': {
    kind: 'skill',
    id: 'compute-compression',
    name: '算力压缩',
    tokenCost: 2,
    text: '下一张己方 Agent 牌费用减少2，最低1。',
    plannedEffect: '下一张己方 Agent 牌费用减少2，最低1。',
  },
  'model-distillation': {
    kind: 'skill',
    id: 'model-distillation',
    // 全场唯一一张原画上没印数字的：那枚圆章写的是「待定」（见 public/cards/skills/
    // model-distillation.webp）。没有数字可转录，就先按最便宜的 1 放着——卡面既然没许诺
    // 具体费用，填 1 至少不会和画面矛盾。等原画补上数字，这里跟着改成那个数。
    tokenCost: 1,
    name: '模型蒸馏',
    // 全卡池唯一一张选手牌的：targetInstanceId 指的是自己手牌里那张 AI 牌的实例。
    // 换来的 Token 按被弃那张的**印刷费用** +1 算，可以把 tokens 顶到 tokenMax 之上
    // （下一轮补满时被覆盖）。
    target: 'own-hand-ai',
    text: '弃置手牌中1张 Agent，获得等同其费用加1的 Token。',
  },
  'open-source-reproduction': {
    kind: 'skill',
    id: 'open-source-reproduction',
    name: '开源复现',
    tokenCost: 4,
    text: '从己方弃牌区选一张 Agent 加入手牌。',
    plannedEffect: '从己方弃牌区选一张 Agent 加入手牌。',
  },
  'nuclear-power-station': {
    kind: 'skill',
    id: 'nuclear-power-station',
    name: '核电站',
    // 减的是双方的费用，也包括打出方自己后面的牌，可叠加（打两张就 -2）。
    // 计数记在 `GameState.costReduction`，进下一轮清零。
    tokenCost: 4,
    text: '本轮双方后续所有牌费用减少1，最低1。',
  },
  'far-ahead': {
    kind: 'skill',
    id: 'far-ahead',
    // 全卡池最贵的一张（原画印的就是 10）：它直接把一轮作废，贵到几乎打不出来是有意的。
    tokenCost: 10,
    name: '遥遥领先',
    text: '立刻结束本轮，不作答、不判定、不积分；已打出的牌与已支付 Token 不返还。',
    plannedEffect: '立刻结束本轮，不作答、不判定、不积分；已打出的牌与已支付 Token 不返还。',
  },
  'domestic-substitution': {
    kind: 'skill',
    id: 'domestic-substitution',
    name: '国产替代',
    // 「双方」包括打出方自己：不带 `AiCard.domestic` 的一律清场，谁打的都不例外。
    tokenCost: 6,
    text: '双方场上没有国产标签的 Agent 均被罚下并移入弃牌区。',
  },
  'version-rollback': {
    kind: 'skill',
    id: 'version-rollback',
    name: '版本回退',
    tokenCost: 4,
    text: '选择场上1个可退化的 Agent，退化1级。',
    plannedEffect: '选择场上1个可退化的 Agent，退化1级。',
  },
  'kids-mode': {
    kind: 'skill',
    id: 'kids-mode',
    name: '儿童模式',
    tokenCost: 2,
    text: '双方场上所有可退化 Agent 各退化1级。',
    plannedEffect: '双方场上所有可退化 Agent 各退化1级。',
  },
  'version-upgrade': {
    kind: 'skill',
    id: 'version-upgrade',
    name: '版本升级',
    tokenCost: 3,
    text: '选择场上1个可进化的 Agent，进化1级。',
    plannedEffect: '选择场上1个可进化的 Agent，进化1级。',
  },
  'rising-tide': {
    kind: 'skill',
    id: 'rising-tide',
    name: '鸡犬升天',
    // 顺着 `AiCard.evolvesTo` 各升一级，只换卡面身份、单位本身不动
    // （instanceId 和身上的本轮标记都留着）。链尾和不可进化的原地不变。
    // 「双方」包括打出方自己，也就是可能白白把对面喂大。
    tokenCost: 2,
    text: '双方场上所有可进化 Agent 各进化1级。',
  },
  'memory-shortage': {
    // 全卡池唯一一张要掷随机的牌：随机数从 `GameState.rngSeed` 起，
    // 所以同一份状态打出它永远得到同一批幸存者，联机两端不会分叉。
    kind: 'skill',
    id: 'memory-shortage',
    name: '内存紧缺',
    tokenCost: 2,
    text: '双方各随机保留场上一半 Agent，向上取整，其余罚下移入弃牌区。',
  },
}

/**
 * 这 24 张的 id，顺序就是它们在卡池和图鉴里的顺序（按设计稿的分组排：干扰、限制、防御、
 * 资源、环境、策略），不按字母。
 *
 * 从 SKILL_DESIGN_CARDS 现取而不是另写一份列表：两份列表迟早会对不上。
 */
export const SKILL_DESIGN_CARD_IDS: CardId[] = Object.keys(SKILL_DESIGN_CARDS)

/**
 * 眼下开放的 10 张技能牌：只有它们进卡池（collection.ts 的 CARD_POOL），
 * 也只有它们能被选进牌组、能在对局里出现。
 *
 * 这份名单就是上面那批"已接进引擎"的卡，一张不多一张不少：开放集合 == 实装集合。
 * 保持这层对应是有意的——占位牌打出去什么都不发生，放进卡池只会让人以为游戏坏了。
 * 所以给一张卡接上效果和把它挪进这个集合是同一件事的两半，得一起做。
 * 剩下 14 张不是删掉，而是转成「即将上线」：牌组页照常把它们摆出来，只是灰着、
 * 排在所有卡的最后，碰一下只提示「即将上线」（见 client 的 DeckScreen）。
 */
const OPEN_SKILL_IDS = new Set<CardId>([
  'black-white-reversal',
  'fixed-answer',
  'jade-purification-vase',
  'golden-bell-shield',
  'safe-pass',
  'model-distillation',
  'nuclear-power-station',
  'domestic-substitution',
  'rising-tide',
  'memory-shortage',
])

/**
 * 开放的那几张，顺序仍是设计稿的分组顺序。
 *
 * 用集合去筛 SKILL_DESIGN_CARD_IDS 而不是直接写成数组：这样两份名单的顺序都由
 * SKILL_DESIGN_CARDS 的键序决定，卡池里的位置不会因为上面那个集合怎么排而跟着跳。
 */
export const OPEN_SKILL_CARD_IDS: CardId[] = SKILL_DESIGN_CARD_IDS.filter((id) =>
  OPEN_SKILL_IDS.has(id),
)

/**
 * 还没开放的那 14 张，顺序同上。它们都带着 `plannedEffect` 占位，引擎不认识。
 *
 * 「排序永远在最后」这条不靠排序函数，而靠用法：牌组页把这份列表整个拼在卡池后面，
 * 于是它们天然排在所有能选的卡之后（见 DeckScreen 的 shown）。
 */
export const COMING_SOON_SKILL_CARD_IDS: CardId[] = SKILL_DESIGN_CARD_IDS.filter(
  (id) => !OPEN_SKILL_IDS.has(id),
)
