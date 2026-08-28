/**
 * MatchDriver：对局界面和"规则跑在哪"之间的唯一接口。
 *
 * 本地热座、dev 测试房、联机房主、联机客人，这几种玩法的界面完全一样，
 * 区别只在于指令交给谁执行、局面从哪来。把这层差异收进 driver 之后，
 * MatchStage 根本不知道自己是在本地对局还是在联机——接联机时界面一行都不用改。
 */

import type { Command, GameEvent, GameState, PlayerId } from '@ai-duel/core'

export type MatchStatus =
  /** 还没拿到局面：联机客人在等房主发开局数据。 */
  | 'connecting'
  | 'playing'
  /** 分出胜负了。 */
  | 'finished'
  /** 对局中断（对手断线等），和 finished 不一样，没有赢家。 */
  | 'aborted'

export interface MatchView {
  /** 当前局面。客人这边是房主 relay 过来的那一份，不是自己算的。 */
  state: GameState | null
  /** 本端占的座位号，决定界面把哪边画成"我方"。 */
  seat: PlayerId
  status: MatchStatus
  /**
   * 最近一条指令被拒绝的原因，成功执行任何指令后自动清空。
   * 界面拿它显示提示；正常玩不该看到它，看到就说明客户端和引擎的判断不一致。
   */
  lastRejection: string | null
  /** status 为 aborted 时的原因。 */
  abortReason: string | null
}

export interface MatchDriver {
  /** 局面变了就回调，配 React 的 useSyncExternalStore 用。 */
  subscribe(listener: () => void): () => void
  /** 无变化时必须返回同一个对象引用，否则 useSyncExternalStore 会一直重渲染。 */
  getSnapshot(): MatchView
  /**
   * 每产生一批新事件回调一次，给动画层用。
   *
   * 和 getSnapshot 分开是有意的：state 是"事件全部应用完"的结果，负责渲染；
   * 事件流是"过程"，负责播动画。两者节奏不同，混在一起会互相牵制。
   */
  subscribeEvents(listener: (events: GameEvent[]) => void): () => void
  send(command: Command): void
  /** 界面卸载时调用：断连接、清定时器。 */
  dispose(): void
}

/** driver 内部共用的订阅/快照管理，三个实现（localDriver / hostDriver / guestDriver）都基于它。 */
export interface DriverCore {
  subscribe(listener: () => void): () => void
  getSnapshot(): MatchView
  subscribeEvents(listener: (events: GameEvent[]) => void): () => void
  /** 改视图并通知订阅者。每次都换新对象，所以只在真的有变化时调用。 */
  patch(changes: Partial<MatchView>): void
  emitEvents(events: GameEvent[]): void
}

/**
 * 事件订阅者只支持一个（就是动画层）。
 *
 * 这条限制换来一个重要的性质：**没人订阅时事件会被攒着，等第一个订阅者来了补发**。
 * driver 是在构造函数里就把开局事件（洗牌、发起始手牌、第一个回合开始）发出来的，
 * 而 React 要等渲染完的 effect 里才订阅得上——不攒着的话这批事件必然丢，
 * 动画层就会漏掉发牌动画，直接从空手牌跳到满手牌。
 */
export function createDriverCore(initial: MatchView): DriverCore {
  let view = initial
  const listeners = new Set<() => void>()
  let eventListener: ((events: GameEvent[]) => void) | null = null
  let buffered: GameEvent[] = []

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return view
    },
    subscribeEvents(listener) {
      eventListener = listener
      if (buffered.length > 0) {
        const pending = buffered
        buffered = []
        listener(pending)
      }
      return () => {
        if (eventListener === listener) eventListener = null
      }
    },
    patch(changes) {
      view = { ...view, ...changes }
      for (const listener of listeners) listener()
    },
    emitEvents(events) {
      if (events.length === 0) return
      if (eventListener) eventListener(events)
      else buffered = [...buffered, ...events]
    },
  }
}

/**
 * 从一批事件里挑出指令被拒的原因，没有就返回 null。
 *
 * 返回 null 正好用来清掉上一次的提示：一条指令成功执行就说明上一条错误已经翻篇了。
 */
export function rejectionOf(events: readonly GameEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.type === 'COMMAND_REJECTED') return event.reason
  }
  return null
}

/** 局面结束了就是 finished，否则 playing。中断（aborted）由 driver 自己设。 */
export function statusOf(state: GameState): MatchStatus {
  return state.phase === 'finished' ? 'finished' : 'playing'
}
