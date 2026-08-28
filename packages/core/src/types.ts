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
}

/**
 * 技能牌：设计上打出即效果结算、随后进弃牌堆，效果可以持续到之后回合；
 * 本迭代只有卡面和动画，没有任何效果。
 */
export interface SkillCard extends CardBase {
  kind: 'skill'
}

/**
 * 英雄牌：开局前选，每方一张，配一个专属技能。
 *
 * 它不进 20 张牌组，也不会出现在手牌、弃牌堆和抽卡池里，所以和 HandCard 是两套东西。
 * 引擎和界面尚未接入：现在只有类型和 heroes.ts 里的数据壳。
 */
export interface HeroCard extends CardBase {
  kind: 'hero'
  skill: {
    name: string
    text: string
  }
}

/** 牌组、手牌、弃牌堆里唯二可能出现的牌。 */
export type HandCard = AiCard | SkillCard

/** 全部卡牌。英雄牌只在选英雄的场合出现，别拿它当手牌用。 */
export type Card = HandCard | HeroCard

/** 牌堆/手牌/弃牌堆里的一张牌。 */
export interface CardInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
}

/**
 * 场上的 AI 单位。
 * 目前没有会被改动的数值，所以只留身份三件套；
 * 之后要加"上场后被增益/削弱"的属性时再往这里拷贝卡面数值。
 */
export interface AiInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
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
export type GamePhase = 'play' | 'quiz' | 'finished'

export interface PlayerState {
  id: PlayerId
  name: string
  /** 累计得分，每轮结算时加上「己方场上存活 AI 数」。 */
  score: number
  hand: CardInstance[]
  /** 牌堆，数组末尾是牌堆顶（抽牌用 pop）。 */
  deck: CardInstance[]
  board: AiInstance[]
  discard: CardInstance[]
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
}

/** 玩家能对引擎发出的全部指令。 */
export type Command =
  /** 打出一张手牌。本迭代没有费用也不选目标，一轮内想打几张打几张。 */
  | { type: 'PLAY_CARD'; player: PlayerId; instanceId: InstanceId }
  /** 结束本方出牌：先手发就轮到后手，后手发就进答题阶段。 */
  | { type: 'END_PLAY'; player: PlayerId }
  /**
   * 提交本轮全场 AI 的答题结果。
   * 玩家不发这条指令，由房主/本地 driver 在进入答题阶段后自动生成并发出
   * （现在结果来自 script.ts 的固定剧本，将来换成调 AI API，指令形状不变）。
   */
  | { type: 'SUBMIT_ANSWERS'; results: AnswerResult[] }
  // 下面四条是 dev 测试房专用的调试指令，走的是和正常指令一样的 execute 路径，
  // 所以联机时客人发给房主也照样会被执行。本项目不防作弊（见 docs/architecture.md 4.1），
  // 客户端只在测试房里给出入口，引擎这一层不做任何身份或来源限制。
  /** 给某位玩家加一张手牌：不带 cardId 从他牌堆抽一张，带 cardId 则凭空造一张新实例（不消耗牌堆）。 */
  | { type: 'DEBUG_ADD_CARD'; player: PlayerId; cardId?: CardId }
  /** 弃掉某位玩家的一张手牌：不带 instanceId 移最后一张，带则移指定那张；被移的牌进弃牌堆。 */
  | { type: 'DEBUG_REMOVE_CARD'; player: PlayerId; instanceId?: InstanceId }
  /** 无视出牌轮次打出一张手牌，其余结算与 PLAY_CARD 完全一致。 */
  | { type: 'DEBUG_PLAY_CARD'; player: PlayerId; instanceId: InstanceId }
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
    }
  /** 进入答题阶段，全屏揭晓题目和正确答案。 */
  | { type: 'QUESTION_REVEALED'; question: Question }
  | {
      type: 'AI_ANSWERED'
      instanceId: InstanceId
      owner: PlayerId
      correct: boolean
      answerText: string
    }
  /** 答错被罚下，从场上移进弃牌堆。 */
  | { type: 'AI_ELIMINATED'; instanceId: InstanceId; owner: PlayerId }
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
