/**
 * 联机房主 driver：这台机器是唯一跑规则的地方。
 *
 * 双方的指令都在这里串行喂给 execute，所以不存在并发和冲突（架构文档 4.2）。
 * 房主自己的操作也走同一条路径（本地 execute → 广播），
 * 不为"自己的操作"另写一套，两边的时序才对得上。
 */

import { createGame, execute, other } from '@ai-duel/core'
import type { Command, GameSetup, PlayerId } from '@ai-duel/core'
import { createDriverCore, rejectionOf, statusOf } from './driver'
import type { MatchDriver } from './driver'
import type { RoomHandle } from '../net/socket'

/** 房主固定坐 0 号，也就是先手——引擎里 0 号先手是写死的。 */
export const HOST_SEAT: PlayerId = 0

export interface HostDriverOptions {
  room: RoomHandle
  setup: GameSetup
}

export function createHostDriver({ room, setup }: HostDriverOptions): MatchDriver {
  const opening = createGame(setup)

  const core = createDriverCore({
    state: opening.state,
    seat: HOST_SEAT,
    status: statusOf(opening.state),
    lastRejection: null,
    abortReason: null,
  })
  core.emitEvents(opening.events)
  room.relay({
    type: 'match:start',
    state: opening.state,
    seat: other(HOST_SEAT),
    events: opening.events,
  })

  let disposed = false

  /** 执行一条指令并把结果广播出去。被拒的指令也照发，客人要靠它知道自己点错了。 */
  function apply(command: Command): void {
    if (disposed) return
    const { state } = core.getSnapshot()
    if (!state) return
    const result = execute(state, command)
    core.patch({
      state: result.state,
      status: statusOf(result.state),
      lastRejection: rejectionOf(result.events),
    })
    core.emitEvents(result.events)
    room.relay({ type: 'match:sync', state: result.state, events: result.events })
  }

  room.onRelay((message) => {
    if (message.type !== 'match:command') return
    // 客人只会发自己的指令；就算它伪造成房主的座位，execute 也只是照常判断轮次，
    // 不做额外校验是刻意的——这局不防作弊（架构文档 4.1）。
    apply(message.command)
  })

  room.onPeerLeft(() => {
    if (disposed) return
    core.patch({ status: 'aborted', abortReason: '对手断开了连接' })
  })

  return {
    subscribe: core.subscribe,
    getSnapshot: core.getSnapshot,
    subscribeEvents: core.subscribeEvents,
    send: apply,
    dispose() {
      disposed = true
      room.dispose()
    },
  }
}
