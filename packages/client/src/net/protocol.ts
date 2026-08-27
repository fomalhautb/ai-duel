/**
 * 房主和客人之间的消息格式。
 *
 * 服务端不看这些内容，只负责把 payload 原样转给房里的另一个人（见 packages/server），
 * 所以协议改了服务端不用动。
 *
 * 方向是固定的：`match:start` 和 `match:sync` 只有房主发，`match:command` 只有客人发。
 */

import type { Command, GameEvent, GameState, PlayerId } from '@ai-duel/core'

export type RelayMessage =
  /**
   * 房主开局，把完整局面发给客人。不裁剪手牌——不防作弊，见架构文档 4.3。
   * seat 是**收件人**（客人）的座位号，events 是开局那批事件（洗牌、发牌、第一回合开始）。
   */
  | { type: 'match:start'; state: GameState; seat: PlayerId; events: GameEvent[] }
  /** 房主执行完一条指令后，把新局面和这批事件广播出去。 */
  | { type: 'match:sync'; state: GameState; events: GameEvent[] }
  /** 客人的操作。客人不跑规则，只把指令发给房主。 */
  | { type: 'match:command'; command: Command }

/**
 * 收到的 payload 是 unknown（服务端不校验内容），用之前先粗筛一遍。
 * 只认 type 字段，字段内部不深校验——两端代码是一起发布的，不存在版本错配。
 */
export function asRelayMessage(payload: unknown): RelayMessage | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { type } = payload as { type?: unknown }
  if (type === 'match:start' || type === 'match:sync' || type === 'match:command') {
    return payload as RelayMessage
  }
  return null
}
