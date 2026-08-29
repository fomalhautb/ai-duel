/**
 * 规则引擎的全部数据形状。
 *
 * 约束：这里的所有类型都必须是纯数据（可 JSON 序列化）。
 * 引擎靠 JSON 深拷贝推进状态，联机时房主也要把状态/事件原样发出去，
 * 一旦混进函数、Map、Date 之类的东西这两条路都会断。
 */

/** 玩家固定两人，用 0/1 当座位号，省掉一层 id 映射。 */
export type PlayerId = 0 | 1

/** 卡牌定义 id（同一张卡在牌组里可以出现多次）。 */
export type CardId = string

/** 卡牌实例 id：牌组里每一份拷贝都有独立身份，用来定位手牌和场上单位。 */
export type InstanceId = string

/** 题目类别。界面右侧常驻的「下一题：XX」显示的就是它。 */
export type QuestionCategory =
  | 'bias' // 偏见测试
  | 'vision' // 视觉测试
  | 'brainteaser' // 脑筋急转弯

export interface Question {
  id: string
  category: QuestionCategory
  text: string
  /**
   * 题面是否包含图片。
   *
   * 不直接拿 `category === 'vision'` 代替：视觉题以后也可能只有文字描述，其他类别同样可能配图。
   * 规则引擎只用这个标志判断李飞飞的「再看一眼」能否发动，图片资源仍由客户端自己管理。
   */
  includesImage?: boolean
  /**
   * 正确答案，答题阶段直接摊给玩家看。
   * 本项目不防作弊（见 docs/architecture.md 4.1），所以整份题库连答案一起放在
   * GameState 里发给双方，不做"只在结算时下发"这种服务器权威式的遮挡。
   */
  answer: string
}

interface CardBase {
  id: CardId
  /** 卡面名（中文）。 */
  name: string
  /** 卡面描述文案。 */
  text: string
}

/** AI 牌：打出后作为单位留在场上，每轮答题阶段跟着答题，答错才罚下。 */
export interface AiCard extends CardBase {
  kind: 'ai'
  /** 卡面上印的模型名，纯展示用，引擎不读它。 */
  model: string
  /**
   * 打出这张 AI 牌要扣除的游戏内 Token，也是「模型蒸馏」「算力压缩」读取的费用基准。
   *
   * 这是引擎认可的唯一权威费用来源：客户端卡面（aiModelFace.ts）从这里取值展示，
   * 不再各存一份。没配置就按 0 处理，但正式的十八张 AI 都要填。
   */
  tokenCost?: number
  /**
   * 这张牌是不是国产模型。只被「国产替代」读取：不带该标记的场上 Agent 会被它罚下。
   * 没填视为非国产；正式的十八张 AI 牌都要显式写上 true 或不写，别留含糊。
   */
  domestic?: boolean
}

/**
 * 注入 AI 提示词后，固定剧本要怎样模拟这条指令的结果。
 *
 * 真模型接入后会直接消费 `instruction`，这两个值只负责让当前离线剧本也能表现出同样的规则效果。
 */
export type PromptAnswerMode =
  | { kind: 'fixed-answer'; answer: string }
  | { kind: 'reverse-judgment' }
  | { kind: 'single-sentence' }
  | { kind: 'character-limit'; maxCharacters: number }
  /**
   * 往提示词里塞一段无关信息（上下文洪水、话题漂移、重复轰炸）。
   *
   * 真模型接入后，这类噪声可能把模型带偏；但离线剧本没法真的"读"这段文字，
   * 所以按用户拍板的口径：不改变原剧本的对错，只保留 instruction 供将来拼进真实 Prompt。
   * 答题文本上加一个前缀，让玩家在离线对局里也看得出这个 Agent 被干扰了。
   */
  | { kind: 'irrelevant-context' }

/** 提示词效果的规则分类；净化牌按这个字段判断能否移除。 */
export type PromptEffectCategory = 'interference' | 'restriction'

/** 一张技能牌定义在卡面上的提示词效果。 */
export interface SkillPromptEffect {
  /** 「干扰」或「限制」，与技能牌原画上的分类一致。 */
  category: PromptEffectCategory
  /** 实际追加到目标 AI 提示词里的指令。 */
  instruction: string
  /** 当前固定剧本如何模拟这条指令。 */
  answerMode: PromptAnswerMode
}

/** 已经落到场上 AI 身上的本轮提示词效果。 */
export interface AppliedPromptEffect extends SkillPromptEffect {
  /** 效果来自哪张技能牌，便于客户端展示和之后处理技能间交互。 */
  sourceCardId: CardId
  /** 原始打出这张技能牌的玩家；「弹弹弹」靠它确认效果是对方施加的。 */
  sourcePlayer: PlayerId
}

/** 卡面上的技能类别；环境牌会被反弹规则排除。 */
export type SkillCategory =
  | 'interference'
  | 'restriction'
  | 'cleanse'
  | 'reflection'
  | 'defense'
  | 'environment'
  // 下面两类是围绕 Token 经济和手牌资源的技能，不作用于对方 AI，因此天然不进反弹判定。
  | 'economy'
  | 'recovery'

/** 正式技能牌的结算方式。 */
export type SkillEffect =
  | { kind: 'apply-prompt'; prompt: SkillPromptEffect }
  | { kind: 'remove-prompt'; category: PromptEffectCategory }
  | { kind: 'reflect-prompt' }
  | { kind: 'round-skill-shield' }
  /** 「保送」：本轮结算时目标己方 AI 即使答错也留场。 */
  | { kind: 'guarantee-survival' }
  /** 「防沉迷」：把对方本轮可打出的牌数（含 AI 牌和技能牌）压到 maxPlays 张。 */
  | { kind: 'limit-foe-plays'; maxPlays: number }
  /** 「算力压缩」：下一张打出的 AI 牌费用减 amount，最低降到 minCost。 */
  | { kind: 'discount-next-ai'; amount: number; minCost: number }
  /** 「模型蒸馏」：弃掉手里指定的一张 AI 牌，获得等于其费用加 bonus 的 Token。 */
  | { kind: 'distill-hand-ai'; bonus: number }
  /** 「开源复现」：把弃牌区里指定的一张 AI 牌收回手牌。 */
  | { kind: 'recover-discard-ai' }
  /** 「核电站」：本轮内双方后续打出的每张牌（含 AI 牌和技能牌）费用减 amount，最低降到 minCost。 */
  | { kind: 'discount-round-cards'; amount: number; minCost: number }
  /** 「遥遥领先」：本轮立即作废——不答题、不判定、不计分，已打出的牌与已付 Token 不返还。 */
  | { kind: 'end-round-immediately' }
  /** 「国产替代」：双方场上所有不带「国产」标记的 Agent 立即罚下进弃牌区。 */
  | { kind: 'eliminate-non-domestic' }
  /** 「版本回退」：目标 Agent 本轮沿版本链退化 1 级，回合结束后恢复原版本。 */
  | { kind: 'downgrade-model' }
  /** 「版本升级」：目标 Agent 本轮沿版本链进化 1 级，回合结束后恢复原版本。 */
  | { kind: 'upgrade-model' }
  /** 「儿童模式」：双方场上所有可退化的 Agent 各退化 1 级（本轮生效，回合结束恢复）。 */
  | { kind: 'mass-downgrade' }
  /** 「鸡犬升天」：双方场上所有可进化的 Agent 各进化 1 级（本轮生效，回合结束恢复）。 */
  | { kind: 'mass-upgrade' }
  /** 「内存紧缺」：双方各随机保留己方场上一半的 Agent（向上取整），其余罚下进弃牌区。 */
  | { kind: 'memory-shortage' }

/** 技能牌需要玩家点选的目标类型。 */
export type SkillTarget =
  | 'foe-ai'
  /** 「上下文洪水」：无需点选，效果落在对方本轮全部作答 Agent 身上。 */
  | 'foe-all-ai'
  | 'own-ai-interference'
  | 'own-ai-restriction'
  | 'own-ai-reflectable'
  /** 「保送」：己方场上任意一个未被保送的 AI。 */
  | 'own-ai'
  /** 「模型蒸馏」：己方手牌里的一张 AI 牌。 */
  | 'own-hand-ai'
  /** 「开源复现」：己方弃牌区里的一张 AI 牌。 */
  | 'own-discard-ai'
  /** 「版本回退」：双方场上任意一个还能沿版本链退化的 Agent。 */
  | 'any-ai-downgradable'
  /** 「版本升级」：双方场上任意一个还能沿版本链进化的 Agent。 */
  | 'any-ai-upgradable'

/**
 * 技能牌：设计上打出即效果结算、随后进弃牌堆，效果默认只持续当前回合。
 */
export interface SkillCard extends CardBase {
  kind: 'skill'
  /** 打出时扣除的游戏内 Token；未配置的占位/设计稿技能按 0 处理。 */
  tokenCost?: number
  /** 卡面分类；占位牌可以不填。 */
  category?: SkillCategory
  /**
   * 打出时必须指定的目标；不填就是无目标技能，打出即结算。
   *
   * `foe-ai` 选对方未受技能影响的 AI；`own-ai-*` 三档选己方带指定类别效果的 AI，
   * 分别供移除干扰、移除限制和反弹使用；`own-ai` 选己方场上任意 AI（保送）；
   * `own-hand-ai` / `own-discard-ai` 分别选己方手牌 / 弃牌区里的一张 AI 牌
   * （模型蒸馏、开源复现），此时 targetInstanceId 指向的是手牌 / 弃牌区里的实例而非场上单位；
   * `any-ai-downgradable` 选双方场上任意一个还能退化的 Agent（版本回退）。
   */
  target?: SkillTarget
  /** 没填就是只播出牌流程、不改规则状态的占位牌。 */
  effect?: SkillEffect
}

/** 英雄 id。英雄很少，直接用字面量联合，写错名字当场就是类型错误。 */
export type HeroId =
  | 'fei-fei-li'
  | 'danqi-chen'
  | 'melanie-perkins'
  | 'grace-hopper'
  | 'mira-murati'
  | 'ada-lovelace'
  | 'margaret-hamilton'

/**
 * 英雄牌：开局就跟着玩家，不是牌组里的一张牌。
 *
 * 字段风格对齐 CardBase（id / name / text），另加英文名和技能两项。
 *
 * **它刻意不进 HandCard 联合，也不进 CARDS / CARD_POOL / STARTER_DECK**：
 * 英雄技能不占 20 张牌的牌组空间（见 docs/AI卡牌对战游戏_游戏机制与流程_V0.2.md 第 4 节），
 * 混进卡池还会连累存档过滤、抽卡和牌组洗牌——那几处都是"遍历卡池"的写法，
 * 多出一张抽不到也打不出的卡只会变成脏数据。英雄的表在 heroes.ts，查表走 getHero。
 */
export interface HeroCard {
  kind: 'hero'
  id: HeroId
  /** 中文名，卡面主标题。 */
  name: string
  /** 英文名，卡面上当副标题印一行。 */
  enName: string
  /** 人物简介。 */
  text: string
  /** 技能名，界面上要单独拎出来显示（如抵消过场的大字）。 */
  skillName: string
  /** 技能效果的说明文案。 */
  skillText: string
}

/** 牌组、手牌、弃牌堆里唯二可能出现的牌。 */
export type HandCard = AiCard | SkillCard

/**
 * 全部三类牌。只有需要"任意一张牌"的展示代码才用它（卡面渲染、图鉴、背面文案）；
 * 一切和牌组沾边的地方一律用 HandCard，英雄牌进不去。
 */
export type Card = HandCard | HeroCard

/** 牌堆/手牌/弃牌堆里的一张牌。 */
export interface CardInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
}

/**
 * 场上的 AI 单位。
 * 除了身份三件套，只有本轮生效的提示词效果；
 * 之后要加"上场后被增益/削弱"的数值时再往这里拷贝卡面数值。
 */
export interface AiInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
  /**
   * 当前回合追加到提示词里的效果。一个 AI 同一回合最多承受一条；答题结算后清除。
   * 写成可选字段，没受效果的单位就不带这一项，JSON 深拷贝和联机转发都少一份冗余。
   */
  promptEffect?: AppliedPromptEffect
  /**
   * 本轮临时使用的模型版本。原始 `cardId` 始终不变，因此被罚下时回到弃牌堆的仍是玩家打出的牌。
   * 陈丹琦的升级和梅拉妮·珀金斯的降级只改这一项；答题脚本和客户端卡面优先读取它。
   */
  roundModelOverride?: CardId
  /**
   * 本轮保送标记：即使答错也不离场，结算后清除。
   * 记来源便于客户端区分展示——李飞飞的「再看一眼」和技能牌「保送」都会写这里。
   */
  guaranteedNextRound?: 'fei-fei-li' | 'safe-pass'
  /**
   * 玛格丽特·汉密尔顿「容错系统」补位上场的替补 Agent 标记。
   * 只用于客户端区分「原本就在场的 Agent」和「补位重答的 Agent」，规则上和普通 Agent 无异；
   * 和其他本轮标记一样，答题结算后清除。
   */
  rescueSubstitute?: 'margaret-hamilton'
}

/** 一次答题的结果，由房主/本地 driver 生成后喂进引擎。 */
export interface AnswerResult {
  instanceId: InstanceId
  correct: boolean
  /** 这个 AI 给出的回答原文，只用来展示。 */
  answerText: string
}

/**
 * 一轮分三段：双方轮流出牌（play）→ 全场答题结算（quiz）→ 下一轮。
 * 打满 totalRounds 后进 finished。
 */
export type GamePhase = 'play' | 'quiz' | 'rescue' | 'finished'

export interface PlayerState {
  id: PlayerId
  name: string
  /** 累计得分，每轮结算时加上「己方场上存活 AI 数」。 */
  score: number
  /** 本局剩余的游戏内 Token；打出有费用的技能牌时立即扣除。 */
  tokens: number
  /** 「金钟罩」的本轮状态；答题结算后清除。 */
  skillShielded: boolean
  /**
   * 「算力压缩」留下的、只作用于本方下一张 AI 牌的费用折扣。
   *
   * amount 是减免额，minCost 是折后最低费用；一旦打出一张 AI 牌就立即消费掉（清空）。
   * 只影响 AI 牌，技能牌费用不受它影响。跨轮保留：打不出 AI 牌的话折扣一直留着，直到用掉。
   */
  nextAiDiscount?: { amount: number; minCost: number }
  /**
   * 「防沉迷」压在本方头上的本轮出牌数上限（含 AI 牌和技能牌），null / 不填表示不限。
   *
   * 由对方在自己回合打出「防沉迷」写入，随后本方每打出一张牌都会和已出牌数比对。
   * 只约束正常/调试出牌这一步，不影响答题；答题结算后清除。
   */
  playLimitThisRound?: number
  /** 本轮已经打出的牌数（AI 牌 + 技能牌），配合 playLimitThisRound 判断是否超限；答题结算后清零。 */
  playsThisRound: number
  hand: CardInstance[]
  /** 牌堆，数组末尾是牌堆顶（抽牌用 pop）。 */
  deck: CardInstance[]
  board: AiInstance[]
  discard: CardInstance[]
  /**
   * 这一方选的英雄。英雄不进牌组，只是挂在玩家身上的一份身份 + 一个技能。
   * 为 null 表示这一方没有英雄（技能一律不发动）。
   */
  hero: HeroId | null
  /**
   * 当前英雄技能暂时不能再发动。
   *
   * 格蕾丝·霍珀、陈丹琦和梅拉妮·珀金斯用掉后整局保持 true；
   * 李飞飞是每个图片题回合可发动一次，回合结算时会重置为 false。
   */
  heroSkillUsed: boolean
}

export interface GameState {
  /** 轮次序号，从 1 开始。一轮 = 双方各出一次牌 + 一次答题结算。 */
  round: number
  /** 总轮数 = 题库长度：题目不重复，出完就打完。 */
  totalRounds: number
  /** 本轮先出牌的一方。开局抛硬币决定，之后每轮交换。 */
  firstPlayer: PlayerId
  /**
   * play 阶段轮到谁出牌。
   * 不另设"先手是否已结束出牌"的标志位：activePlayer === firstPlayer 就是先手在出，
   * 否则就是后手在出，后手再 END_PLAY 即进答题。
   */
  activePlayer: PlayerId
  phase: GamePhase
  /** 本局的题目序列（开局洗好），questions[round - 1] 是本轮的题。 */
  questions: Question[]
  players: [PlayerState, PlayerState]
  /** 分数相同时是 'draw'，没打完是 null。 */
  winner: PlayerId | 'draw' | null
  /**
   * 下一个卡牌实例序号，开局发完双方牌组后接着往下走。
   * 调试指令凭空造牌时靠它保证 instanceId 不撞车。引擎里不许用 Math.random / Date，
   * 所以这个计数器必须留在状态里，才能跟着状态一起被拷贝和发给客人。
   */
  seq: number
  /**
   * 玛格丽特·汉密尔顿「容错系统」暂存的本轮答题结果。
   *
   * 答题结果一提交，若该玩家满足容错系统的发动条件，就先把结果整份存下来、进入 rescue 阶段等她决定，
   * 而不是当场结算。跳过（DECLINE_RESCUE）时用它按原样结算；发动补位（USE_RESCUE）时它作废，
   * 由替补上场后重新提交的一份结果覆盖。只在 rescue 阶段存在，结算后清除。
   */
  pendingAnswers?: AnswerResult[]
  /** rescue 阶段里能发动容错系统的玩家；只在 rescue 阶段存在。 */
  rescuingPlayer?: PlayerId
  /**
   * 「核电站」留下的、只作用于本轮的全体费用折扣。
   *
   * 对双方、对 AI 牌和技能牌一视同仁；多座核电站叠加时减免额累加。
   * 它是"本轮"级别的场地效果，答题结算或「遥遥领先」跳轮时清除。
   */
  roundCardDiscount?: { amount: number; minCost: number }
}

/** 玩家能对引擎发出的全部指令。 */
export type Command =
  /**
   * 打出一张手牌。一轮内想打几张打几张，但有 Token 费用的牌必须付得起。
   *
   * `targetInstanceId` 只有卡牌定义标了 `target` 的技能牌要填。该填不填、或者填了个不合法的目标都会被拒；
   * 无目标的卡带上它则直接忽略。
   */
  | {
      type: 'PLAY_CARD'
      player: PlayerId
      instanceId: InstanceId
      targetInstanceId?: InstanceId
    }
  /** 结束本方出牌：先手发就轮到后手，后手发就进答题阶段。 */
  | { type: 'END_PLAY'; player: PlayerId }
  /**
   * 提交本轮全场 AI 的答题结果。
   * 玩家不发这条指令，由房主/本地 driver 在进入答题阶段后自动生成并发出
   * （现在结果来自 script.ts 的固定剧本，将来换成调 AI API，指令形状不变）。
   */
  | { type: 'SUBMIT_ANSWERS'; results: AnswerResult[] }
  /**
   * 发动需要选目标的英雄技能。只能在自己的出牌阶段使用，目标是否合法由英雄规则判断。
   * 格蕾丝·霍珀的 Debug 是自动触发，不走这条指令。
   */
  | { type: 'USE_HERO_SKILL'; player: PlayerId; targetInstanceId: InstanceId }
  /**
   * 玛格丽特·汉密尔顿「容错系统」：在 rescue 阶段用手牌里的一个 Agent 补位重答本题。
   *
   * 只有暂存结果里答错、且没有被保送的己方 Agent 才会被替换掉；替补沿用被替换者留下的战场位置，
   * 由后续重新提交的答题结果决定它这一题答得对不对。
   */
  | { type: 'USE_RESCUE'; player: PlayerId; substituteInstanceId: InstanceId }
  /** 玛格丽特·汉密尔顿「容错系统」：放弃补位，按暂存的答题结果直接结算本轮。 */
  | { type: 'DECLINE_RESCUE'; player: PlayerId }
  // 下面四条是 dev 测试房专用的调试指令，走的是和正常指令一样的 execute 路径，
  // 所以联机时客人发给房主也照样会被执行。本项目不防作弊（见 docs/architecture.md 4.1），
  // 客户端只在测试房里给出入口，引擎这一层不做任何身份或来源限制。
  /** 给某位玩家加一张手牌：不带 cardId 从他牌堆抽一张，带 cardId 则凭空造一张新实例（不消耗牌堆）。 */
  | { type: 'DEBUG_ADD_CARD'; player: PlayerId; cardId?: CardId }
  /** 弃掉某位玩家的一张手牌：不带 instanceId 移最后一张，带则移指定那张；被移的牌进弃牌堆。 */
  | { type: 'DEBUG_REMOVE_CARD'; player: PlayerId; instanceId?: InstanceId }
  /** 无视出牌轮次打出一张手牌，其余结算与 PLAY_CARD 完全一致（含选目标那套校验）。 */
  | {
      type: 'DEBUG_PLAY_CARD'
      player: PlayerId
      instanceId: InstanceId
      targetInstanceId?: InstanceId
    }
  /** 直接结束本轮双方出牌跳到答题阶段，省掉为了看结算连点两次「结束出牌」。 */
  | { type: 'DEBUG_SKIP_TO_QUIZ' }

/**
 * 引擎产出的事件流，客户端照着它播动画。
 * 事件描述"已经发生的事实"，客户端不该再自己算一遍规则。
 */
export type GameEvent =
  /** 开局抛硬币的结果，客户端拿它播全场硬币动画。 */
  | { type: 'GAME_STARTED'; firstPlayer: PlayerId }
  | { type: 'CARD_DRAWN'; player: PlayerId; card: CardInstance }
  /** 一张手牌被直接弃掉（目前只有调试指令会产生，正常出牌走 AI_DEPLOYED / SKILL_PLAYED）。 */
  | { type: 'CARD_REMOVED'; player: PlayerId; instanceId: InstanceId }
  | {
      type: 'ROUND_STARTED'
      round: number
      firstPlayer: PlayerId
      /** 本轮题目的类别；题目全文要等到 QUESTION_REVEALED 才展示。 */
      category: QuestionCategory
    }
  /** 轮到某方出牌，客户端打出牌横幅。 */
  | { type: 'PLAY_TURN_STARTED'; player: PlayerId }
  | { type: 'AI_DEPLOYED'; player: PlayerId; ai: AiInstance }
  /** 技能牌打出：中央亮相一下再进弃牌堆。 */
  | {
      type: 'SKILL_PLAYED'
      player: PlayerId
      cardId: CardId
      /**
       * 打出的那张手牌的实例 id。结算完全用不上它，纯粹给客户端定位用：
       * 对手出牌时要从他手牌里揪出这张牌飞到屏幕中央，而不是让它凭空出现。
       */
      instanceId: InstanceId
      /**
       * 这张技能打向的那个 AI（只有卡牌定义了 target 才有）。
       *
       * 同样是给客户端定位用的：技能牌亮相完要飞向这个 AI 的战场格子并在那儿播命中特效。
       * 结算在事件发出前就做完了，但**别拿它当"效果一定生效"的凭据**：
       * 这张牌可能紧接着被一条 SKILL_CANCELED 抵消掉，那时规则状态不会改变。
       * 最终效果永远以随事件一起提交的新快照为准。
       */
      targetInstanceId?: InstanceId
    }
  /**
   * 一张技能牌的效果被英雄技能抵消。
   *
   * 紧跟在被抵消的那张牌的 SKILL_PLAYED 之后：牌照常打出、照常进弃牌堆，只是效果作废，
   * 客户端也就先演出牌、再演抵消。
   *
   * 两个玩家 id 方向相反，别弄混：
   * - `player` 是打出这张技能牌的一方（被抵消的那一方）；
   * - `by` 是发动英雄技能的一方，也就是 `player` 的对手。
   */
  | {
      type: 'SKILL_CANCELED'
      player: PlayerId
      by: PlayerId
      heroId: HeroId
      cardId: CardId
      /** 被抵消的那张牌的实例 id，和它的 SKILL_PLAYED 是同一个，客户端要靠它对上号。 */
      instanceId: InstanceId
    }
  /** 主动英雄技能已经生效；版本变化字段只在升级/降级时携带。 */
  | {
      type: 'HERO_SKILL_USED'
      player: PlayerId
      heroId: HeroId
      targetInstanceId: InstanceId
      fromCardId?: CardId
      toCardId?: CardId
    }
  /**
   * 米拉·穆拉蒂「快速部署」：一个已上场的 Agent 被撤回手牌。
   *
   * 单独成一条事件而不复用 HERO_SKILL_USED：撤回不是升降级也不是保送，
   * 客户端要把那张小卡从战场飞回手牌，和其他英雄技能的演出完全不同。
   */
  | {
      type: 'AI_RECALLED'
      player: PlayerId
      heroId: HeroId
      /** 被撤回的战场单位实例 id，和它回到手牌后的实例 id 相同。 */
      instanceId: InstanceId
      /** 被撤回单位的卡牌定义 id，供客户端渲染飞回的卡面。 */
      cardId: CardId
    }
  /** 进入答题阶段，全屏揭晓题目和正确答案。 */
  | { type: 'QUESTION_REVEALED'; question: Question }
  /**
   * 玛格丽特·汉密尔顿「容错系统」可以发动：己方有 Agent 答错、手牌里还有 Agent 可补位。
   *
   * 引擎在暂存答题结果后发出这条并停在 rescue 阶段，等 `player` 发 USE_RESCUE 或 DECLINE_RESCUE。
   * 答题结果（AI_ANSWERED）会先于这条事件发出，客户端据此展示每个 Agent 答得对不对，再询问是否补位。
   */
  | { type: 'RESCUE_OFFERED'; player: PlayerId }
  /**
   * 容错系统的最终结果。
   *
   * - `used === false`：玩家放弃补位，本轮按原答题结果结算，后续照常跟 AI_ELIMINATED / ROUND_SCORED。
   * - `used === true`：`substituteInstanceId` 补位上场、替换掉答错的 `replacedInstanceId`，
   *   随后引擎重新回到 quiz 阶段等新一份 SUBMIT_ANSWERS，本条之后不会立刻结算。
   */
  | {
      type: 'RESCUE_RESOLVED'
      player: PlayerId
      used: boolean
      substituteInstanceId?: InstanceId
      replacedInstanceId?: InstanceId
    }
  | {
      type: 'AI_ANSWERED'
      instanceId: InstanceId
      owner: PlayerId
      correct: boolean
      answerText: string
    }
  /** 答错被罚下，从场上移进弃牌堆。 */
  | { type: 'AI_ELIMINATED'; instanceId: InstanceId; owner: PlayerId }
  /**
   * 「遥遥领先」把本轮直接作废：不作答、不判定、不计分，直接推进到下一轮。
   *
   * 事件里没有多余字段——罚下了谁、清了什么标记，客户端照随后的快照和
   * AI_ELIMINATED（国产替代也复用它）自己对；这条只负责让客户端播"本轮跳过"的过场。
   * `player` 是打出「遥遥领先」的一方。
   */
  | { type: 'ROUND_SKIPPED'; player: PlayerId }
  /** 本轮计分：gains/scores 按座位号排，[0] 是 0 号玩家。 */
  | { type: 'ROUND_SCORED'; gains: [number, number]; scores: [number, number] }
  | { type: 'GAME_OVER'; winner: PlayerId | 'draw' }
  /**
   * 非法指令。状态保持不变，只回这一条事件。
   * 房主模式下房主可以只把它回给发指令的人，不必广播。
   */
  | { type: 'COMMAND_REJECTED'; reason: string }

/** 引擎的统一返回：新状态 + 本次产生的事件。 */
export interface ExecuteResult {
  state: GameState
  events: GameEvent[]
}
