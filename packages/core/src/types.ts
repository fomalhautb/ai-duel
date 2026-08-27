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

/**
 * 六个弱点维度，取材自真实 AI 模型的软肋。
 * 攻击方向就是靠这六维互相咬合的，新增维度要同步更新卡牌数值。
 */
export type WeaknessKind =
  | 'bias' // 偏见
  | 'hallucination' // 幻觉
  | 'misjudgment' // 误判
  | 'overconfidence' // 过度自信
  | 'forgetfulness' // 上下文遗忘
  | 'jailbreak' // 越狱易感度

/** 需要遍历六个维度时用它，避免各处手写数组漏掉某一维。 */
export const WEAKNESS_KINDS = [
  'bias',
  'hallucination',
  'misjudgment',
  'overconfidence',
  'forgetfulness',
  'jailbreak',
] as const satisfies readonly WeaknessKind[]

/**
 * 一个模型在六个维度上的暴露程度，取值 0-3。
 * 数值越高，对应维度的提示卡打它越疼——强模型的代价就体现在某几维特别高。
 */
export type WeaknessProfile = Record<WeaknessKind, number>

interface CardBase {
  id: CardId
  /** 卡面名（中文）。 */
  name: string
  /** 打出所需算力。 */
  cost: number
  /** 卡面描述文案。 */
  text: string
}

/** 模型卡：打出后作为单位留在场上。 */
export interface ModelCard extends CardBase {
  kind: 'model'
  /** 算力：进攻数值。 */
  power: number
  /** 完整度：单位的耐久，归零即崩坏。 */
  integrity: number
  weaknesses: WeaknessProfile
}

/** 提示卡：一次性结算，专打某一个弱点维度。 */
export interface PromptCard extends CardBase {
  kind: 'prompt'
  /** 攻击的弱点维度。 */
  targetWeakness: WeaknessKind
  /** 基础伤害，实际伤害还要加上目标在该维度的暴露程度。 */
  damage: number
}

export type Card = ModelCard | PromptCard

/** 牌堆/手牌/弃牌堆里的一张牌。 */
export interface CardInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
}

/**
 * 场上的模型单位。
 * 数值从 ModelCard 拷贝而来而不是每次去查定义，因为上场后会被增益/削弱改动。
 */
export interface ModelInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
  power: number
  integrity: number
  weaknesses: WeaknessProfile
}

export interface PlayerState {
  id: PlayerId
  name: string
  /** 本体完整度，归零判负。 */
  integrity: number
  /** 本回合还剩多少算力。 */
  compute: number
  /** 本回合算力上限，每回合开始 +1。 */
  computeMax: number
  hand: CardInstance[]
  /** 牌堆，数组末尾是牌堆顶（抽牌用 pop）。 */
  deck: CardInstance[]
  board: ModelInstance[]
  discard: CardInstance[]
}

export interface GameState {
  /** 回合序号，从 1 开始，每次交接 +1（不是"双方各走一次"算一回合）。 */
  turn: number
  activePlayer: PlayerId
  players: [PlayerState, PlayerState]
  phase: 'playing' | 'finished'
  winner: PlayerId | null
}

/** 玩家能对引擎发出的全部指令。 */
export type Command =
  | {
      type: 'PLAY_CARD'
      player: PlayerId
      instanceId: InstanceId
      /** 提示卡的目标模型；不填表示直击对手本体。模型卡忽略此字段。 */
      targetInstanceId?: InstanceId
    }
  | { type: 'END_TURN'; player: PlayerId }

/**
 * 引擎产出的事件流，客户端照着它播动画。
 * 事件描述"已经发生的事实"，客户端不该再自己算一遍规则。
 */
export type GameEvent =
  | { type: 'GAME_STARTED'; startingPlayer: PlayerId }
  | { type: 'CARD_DRAWN'; player: PlayerId; card: CardInstance }
  | { type: 'TURN_STARTED'; player: PlayerId; turn: number }
  | { type: 'TURN_ENDED'; player: PlayerId }
  | { type: 'COMPUTE_CHANGED'; player: PlayerId; compute: number; computeMax: number }
  | { type: 'MODEL_DEPLOYED'; player: PlayerId; model: ModelInstance }
  | {
      type: 'PROMPT_RESOLVED'
      player: PlayerId
      cardId: CardId
      weakness: WeaknessKind
      /** 命中的模型；打本体时为 null。 */
      targetInstanceId: InstanceId | null
      damage: number
    }
  | { type: 'MODEL_DAMAGED'; instanceId: InstanceId; amount: number; integrity: number }
  | { type: 'MODEL_DESTROYED'; instanceId: InstanceId; owner: PlayerId }
  | { type: 'PLAYER_DAMAGED'; player: PlayerId; amount: number; integrity: number }
  | { type: 'GAME_OVER'; winner: PlayerId }
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
