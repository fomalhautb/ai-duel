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
   * 正确答案，答题阶段直接摊给玩家看。
   * 本项目不防作弊（见 docs/architecture.md 4.1），所以整份题库连答案一起放在
   * GameState 里发给双方，不做"只在结算时下发"这种服务器权威式的遮挡。
   *
   * 写成短语而不是整句：结算界面把它当大字标题排版，长句会挤成两三行。
   * 说明的部分放到 explanation 里。
   */
  answer: string
  /**
   * 标准答案下面那行小字，讲清楚"为什么是这个答案"。
   * 和 answer 分开是排版需要：一行大字 + 一行小字，两者不能揉进同一个字段。
   */
  explanation: string
}

interface CardBase {
  id: CardId
  /** 卡面名（中文）。 */
  name: string
  /** 卡面描述文案。 */
  text: string
  /**
   * 打出这张牌要花的 Token（见 docs/AI卡牌对战游戏_游戏机制与流程_V0.2.md 第 5 节）。
   *
   * 这是费用的唯一出处：卡面上那枚费用章、手牌"打不起就变灰"的判断、引擎的扣费校验
   * 读的都是它。客户端曾经在 ui/aiModelFace.ts 里另存过一份展示用数值，
   * 那份已经删掉——两份数字一旦对不上，玩家会看到"卡面写 4 点，却提示 Token 不够"。
   */
  tokenCost: number
}

/** AI 牌：打出后作为单位留在场上，每轮答题阶段跟着答题，答错才罚下。 */
export interface AiCard extends CardBase {
  kind: 'ai'
  /** 卡面上印的模型名，纯展示用，引擎不读它。 */
  model: string
  /**
   * 国产模型。「国产替代」按它决定谁留在场上（没标的一律罚下）。
   *
   * 只标 true、不写 false：没这一项就是非国产，JSON 里少一份冗余，
   * 也免得以后有人误以为 `domestic: false` 和不写是两种状态。
   */
  domestic?: true
  /**
   * 进化链的下一级卡（「鸡犬升天」把场上单位换成它）。
   *
   * 不填 = 这张卡不可进化：链尾（如 ChatGPT 5.6 Sol）和没有前后代的单张都不填。
   * 进化链写在卡牌定义上而不是引擎里，再补一条链只要改这里。
   */
  evolvesTo?: CardId
}

/** 干扰类技能牌的 id。命中后写进 `AiInstance.interference`，答案生成层按种类模拟。 */
export type InterferenceCardId = 'fixed-answer' | 'black-white-reversal'

/**
 * 技能牌：打出即效果结算、随后进弃牌堆，效果可以持续到本轮结束。
 *
 * 24 张里有 10 张接进了引擎（名单和各自的结算见 skillCards.ts 的文件头注释），
 * 其余 14 张还带着 `plannedEffect` 走占位路径：打出后亮个相就进弃牌堆，什么都不发生。
 */
export interface SkillCard extends CardBase {
  kind: 'skill'
  /**
   * 打出时必须指定的目标；不填就是无目标技能，打出即结算。
   *
   * - `'foe-ai'`：对方场上一个还没被干扰过的 AI（`AiInstance.interference` 没设置）。复读机、黑白颠倒。
   * - `'own-ai'`：己方场上一个还没被保送的 AI。保送。
   * - `'own-affected-ai'`：己方场上一个身上带着 `interference` 的 AI。玉净瓶。
   * - `'own-hand-ai'`：**自己手牌里**的一张 AI 牌，`targetInstanceId` 指的是手牌实例
   *   而不是场上单位。模型蒸馏。
   *
   * 目标规则写在卡牌定义上而不是引擎里：新技能只要标上其中一档，
   * `playCard` 那段校验和客户端的选目标交互都不用改。
   */
  target?: 'foe-ai' | 'own-ai' | 'own-affected-ai' | 'own-hand-ai'
  /**
   * 设计稿定下的效果全文，**规则引擎尚未实装**，只供卡背展示。
   *
   * 带着它的牌走的是占位路径：打出后亮个相就进弃牌堆，什么都不会发生。
   * 所以客户端拼卡背文案时必须一并说明"还没实装"（见 client 的 ui/cardText.ts）——
   * 直接把这句话摆出来，玩家会以为打出去真有效果。
   * 哪天某张牌接进引擎，就把这个字段删掉、改成真正的结算逻辑。
   */
  plannedEffect?: string
}

/**
 * 英雄 id。英雄总共就这 7 位、不会随版本增删，直接用字面量联合，写错名字当场就是类型错误。
 * 这里的排列顺序不代表展示顺序——展示顺序由 heroes.ts 里 HEROES 的键序决定。
 */
export type HeroId =
  | 'fei-fei-li'
  | 'danqi-chen'
  | 'melanie-perkins'
  | 'mira-murati'
  | 'ada-lovelace'
  | 'margaret-hamilton'
  | 'grace-hopper'

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
 *
 * 除了身份三件套，只有两个「本轮」标记，都在双方确认结算、真的进下一轮时清掉
 * （见 engine.ts 的 confirmRound）；
 * 之后要加"上场后被增益/削弱"的数值时再往这里拷贝卡面数值。
 *
 * 两个标记都写成可选字段、只设不为空的那一档：没被打过的单位就不带这一项，
 * JSON 深拷贝和联机转发都少一份冗余。
 */
export interface AiInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
  /**
   * 被哪张干扰类技能命中了。
   *
   * 干扰的本体是"往这个 AI 的 prompt 里注入一句话"（注入文案见 script.ts 的
   * `INTERFERENCE_PROMPTS`）。真实模型 API 还没接，所以剧本模式按种类等效模拟：
   * 复读机一律答「香蕉」判错，黑白颠倒把本来的判定翻个面。
   *
   * 记的是种类而不是一个布尔，因为下游要分三处用：答案生成层按种类模拟、
   * 玉净瓶按"身上有没有它"挑目标、战场小卡按种类显示不同角标。
   * 一个 AI 同时只能挂一种：已经带着它的单位不能再被第二张干扰技能选中。
   */
  interference?: InterferenceCardId
  /**
   * 被「保送」选中过：本轮结算答错也不罚下（改发 `AI_SAFE_PASSED`）。
   *
   * 它只免掉罚下，**不改计分**：保送留场的那个 AI 在 `ROUND_SCORED.correct` 里仍然算答错。
   */
  safePassed?: true
}

/** 一次答题的结果，由房主/本地 driver 生成后喂进引擎。 */
export interface AnswerResult {
  instanceId: InstanceId
  correct: boolean
  /** 这个 AI 的回答本身，一个短语。结算界面拿它当大字排版，所以别写成整段话。 */
  answer: string
  /** 这个 AI 给出的理由，两行以内的小字，排在 answer 下面。 */
  reasoning: string
}

/**
 * 一轮分四段：双方轮流出牌（play）→ 全场答题（quiz）→ 结算等双方确认（settle）→ 下一轮。
 * 打满 totalRounds 后，最后一轮的双方确认会把状态推进到 finished。
 *
 * settle 单独占一段是为了让结算界面有一段"局面不再变"的时间：
 * 计分已经算完写进快照，但轮次、Token、手牌都还停在本轮的样子，界面可以放心读快照。
 */
export type GamePhase = 'play' | 'quiz' | 'settle' | 'finished'

export interface PlayerState {
  id: PlayerId
  name: string
  /**
   * 累计得分。每轮结算最多加 1 分：本轮答对的 AI 多的一方拿分，
   * 一样多就比谁花的 Token 少，还一样就双方各拿 1 分（规则见 engine.ts 的 submitAnswers）。
   */
  score: number
  /**
   * 本轮打出过「金钟罩」：这一方和他场上所有 AI 不受**任何**技能牌影响，
   * 进下一轮时清掉（见 engine.ts 的 confirmRound）。
   *
   * 口径是字面全挡，对己方有利的效果也一样挡：
   * 对方的干扰技能选不中他的 AI（直接拒绝出牌）、他自己也打不出玉净瓶/保送/模型蒸馏
   * 这类作用于自己的牌、群体牌结算时跳过他的场面、核电站的减费他也不享受
   * （见 engine.ts 的 effectivePlayCost）。唯一的例外是金钟罩自己，
   * 否则第一张就会把自己挡住、这张牌永远打不出去。
   *
   * 只设 true 不设 false：和场上单位的两个标记同一套写法。
   */
  shielded?: true
  /**
   * 本轮还剩多少 Token。出牌时按卡面 tokenCost 扣，扣光了就打不出更贵的牌。
   *
   * 双方确认结算、进下一轮时补满到 tokenMax，不跨轮攒：省下来的 Token 不会带到下一轮，
   * 所以"这一轮的额度尽量用掉"本身就是一条策略。
   */
  tokens: number
  /**
   * 本轮已经花掉的 Token 累计，出牌时和 tokens 一起改。
   *
   * 存这一份而不是拿 tokenMax - tokens 现算：进下一轮时 tokens 会被补满、tokenMax 还要涨，
   * 差值当场就没了，而结算界面正需要在那之前把"本轮消耗"显示出来。
   * 它也是平局时的第二判据（消耗少的一方拿分），所以清零必须等到真的进下一轮。
   */
  roundTokenSpent: number
  /**
   * 本轮的 Token 上限。开局 INITIAL_TOKEN_MAX，之后每答完一题涨 TOKEN_MAX_GROWTH。
   * 右侧栏那排四芒星画的就是它：亮着的是 tokens，灰的是这一轮已经花掉的。
   */
  tokenMax: number
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
   * 英雄技能这一局用掉了没有。
   *
   * 现在只有格蕾丝·霍珀的 Debug 是"每局一次"，所以一个布尔够用；
   * 将来有"每若干轮一次"的技能时再换成记轮次的字段。
   * 一个 GameState 的生命周期就是一局，createGame 重新建状态时它天然回到 false。
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
   * settle 阶段里两位玩家分别确认过没有，按座位号排。
   *
   * 双方都点了"进入下一轮"才推进（见 engine.ts 的 confirmRound）：结算界面要播一整套
   * 揭晓动画，谁看完了谁先点，不能让先看完的一方把还在看的那一方拖走。
   * 每次进 settle 重置成 [false, false]。
   */
  settleConfirmed: [boolean, boolean]
  /**
   * 本轮打出过几张「核电站」：双方后续每张牌都便宜这么多点，最低 1 点
   * （算法见 engine.ts 的 effectivePlayCost）。进下一轮时清零。
   *
   * 记张数而不是一个布尔：这张牌可叠加，打两张就是 -2。
   * 它是全局的一份而不是每方一份——核电站减的是双方的费用。
   */
  costReduction: number
  /**
   * 状态内的随机种子，让引擎在保持"纯函数 + 可序列化"的前提下也能掷随机
   * （眼下只有「内存紧缺」要随机保留一半场上单位）。
   *
   * 用法：`mersenne(rngSeed)` 起一把生成器，取完要用的值再把下一个种子写回这里。
   * 随机数生成器本身进不了状态（它不可 JSON 序列化），种子可以。
   * 这样"同一份状态 + 同一条指令 = 同一个结果"仍然成立：房主广播完快照，
   * 客人手上那份状态里的种子和房主的是同一个，重放也不会分叉。
   */
  rngSeed: number
  /**
   * 下一个卡牌实例序号，开局发完双方牌组后接着往下走。
   * 调试指令凭空造牌时靠它保证 instanceId 不撞车。引擎里不许用 Math.random / Date，
   * 所以这个计数器必须留在状态里，才能跟着状态一起被拷贝和发给客人。
   */
  seq: number
}

/** 玩家能对引擎发出的全部指令。 */
export type Command =
  /**
   * 打出一张手牌。一轮内能打几张由剩余 Token 决定（每张扣的是**实际费用**，
   * 也就是卡面 tokenCost 减去核电站的减免，见 engine.ts 的 effectivePlayCost；
   * 剩的不够就整条被拒）。
   *
   * `targetInstanceId` 只有卡牌定义标了 `target` 的技能牌要填，指的是场上单位还是手牌实例
   * 由那一档 `target` 决定（见 `SkillCard.target`）。该填不填、或者填了个不合法的目标都会被拒；
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
   * 结算界面上点"进入下一轮"。双方都发过才真的推进（或在最后一轮结束整局）。
   * 重复发会被拒，所以界面按下之后要把按钮置灰等对方。
   */
  | { type: 'CONFIRM_ROUND'; player: PlayerId }
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
  /**
   * 一张手牌被直接弃掉（不是打出去的：打出去走 AI_DEPLOYED / SKILL_PLAYED）。
   * 两个来源：调试指令 DEBUG_REMOVE_CARD，以及「模型蒸馏」弃掉的那张 AI 牌。
   */
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
       * 这张技能打向的那个**场上单位**（`target` 是 foe-ai / own-ai / own-affected-ai 的卡才有）。
       *
       * 同样是给客户端定位用的：技能牌亮相完要飞向这个 AI 的战场格子并在那儿播命中特效。
       * 「模型蒸馏」那种打向手牌的（`target: 'own-hand-ai'`）刻意不带这个字段——
       * 客户端拿它去战场上找格子会扑空，那张手牌的去向由随后的 CARD_REMOVED 交代。
       *
       * 结算在事件发出前就做完了，但**别拿它当"效果一定生效了"的凭据**：
       * 这张牌可能紧接着被一条 SKILL_CANCELED 抵消掉，那时目标身上什么标记都没留下。
       * 目标身上到底有什么永远以快照里的 `AiInstance` 为准。
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
  /** 进入答题阶段，全屏揭晓题目和正确答案。 */
  | { type: 'QUESTION_REVEALED'; question: Question }
  | {
      type: 'AI_ANSWERED'
      instanceId: InstanceId
      owner: PlayerId
      /**
       * 这个 AI 是哪张卡。结算界面靠它画头像和卡名。
       *
       * 明明快照里查得到，还要在事件里再报一遍，是因为答错的 AI 紧接着就被罚下了：
       * 界面拿到这批事件时新快照还没提交，等提交完那个单位已经从场上消失，再查就查不到。
       */
      cardId: CardId
      correct: boolean
      /** 回答本身（短语），界面上是那行大字。 */
      answer: string
      /** 回答的理由（两行以内），排在大字下面。 */
      reasoning: string
    }
  /** 答错被罚下，从场上移进弃牌堆。 */
  | { type: 'AI_ELIMINATED'; instanceId: InstanceId; owner: PlayerId }
  /**
   * 答错了但因为被「保送」而留在场上。
   *
   * 排在它自己那条 AI_ANSWERED 之后，占的就是本该发 AI_ELIMINATED 的位置：
   * 客户端在结算层里照常演"这个答错了"，但别演罚下，改标一个「保送」。
   */
  | { type: 'AI_SAFE_PASSED'; instanceId: InstanceId; owner: PlayerId }
  /**
   * 被技能牌罚下，从场上移进弃牌堆（不是答错罚下，那条走 AI_ELIMINATED）。
   *
   * `by` 是干这件事的那张技能牌，眼下只可能是 'memory-shortage' 或 'domestic-substitution'，
   * 客户端可以据此给两张牌配不同的演出。
   * 还带一个 `cardId` 是因为事件发出时快照里这个单位已经不在场上了，
   * 界面要画"谁被清掉了"只剩事件里这一份卡面身份（和 AI_ANSWERED 同一个道理）。
   */
  | {
      type: 'AI_REMOVED'
      instanceId: InstanceId
      owner: PlayerId
      cardId: CardId
      by: CardId
    }
  /**
   * 场上单位进化成了另一张卡（眼下只有「鸡犬升天」会产生）。
   *
   * 换的是同一个单位的卡面身份，`instanceId` 不变，身上的本轮标记也都留着——
   * 客户端换图即可，不要当成"旧的下场、新的上场"来演。
   */
  | {
      type: 'AI_TRANSFORMED'
      instanceId: InstanceId
      owner: PlayerId
      fromCardId: CardId
      toCardId: CardId
    }
  /**
   * 本轮计分，四个数组都按座位号排，[0] 是 0 号玩家。
   *
   * - `gains`：本轮拿到的分，只可能是 0 或 1；双方打平时是 [1, 1]。
   * - `scores`：加完之后的总分。
   * - `correct`：本轮各自答对的 AI 数。数的是 results 里 `correct` 为真的条数，
   *   不是罚下之后还站在场上的数量——被保送的单位答错也留场，两者已经对不上了。
   * - `spent`：本轮各自花掉的 Token，答对数相同时靠它分胜负。
   *
   * correct / spent 是判定依据，界面要把"凭什么这一分给了谁"讲清楚，所以一起发出来。
   */
  | {
      type: 'ROUND_SCORED'
      gains: [number, number]
      scores: [number, number]
      correct: [number, number]
      spent: [number, number]
    }
  /** 某一方在结算界面上确认了本轮。双方都确认后才会有后续的推进事件。 */
  | { type: 'ROUND_CONFIRMED'; player: PlayerId }
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
