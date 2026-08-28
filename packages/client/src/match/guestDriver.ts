/**
 * 联机客人 driver：本地不跑规则，只发指令、收局面。
 *
 * 界面照样能点，但点完不会立刻变——要等房主执行完把新局面转回来。
 * 指令非法时房主会把 COMMAND_REJECTED 一起转回来，显示成提示。
 */

import type { Command } from '@ai-duel/core'
import { createDriverCore, rejectionOf, statusOf } from './driver'
import type { MatchDriver } from './driver'
import type { RoomHandle } from '../net/socket'
import { HOST_SEAT } from './hostDriver'
import { other } from '@ai-duel/core'

export interface GuestDriverOptions {
  room: RoomHandle
}

export function createGuestDriver({ room }: GuestDriverOptions): MatchDriver {
  const core = createDriverCore({
    // 房主还没发开局数据，界面这时显示"等待房主开局"。
    state: null,
    seat: other(HOST_SEAT),
    status: 'connecting',
    lastRejection: null,
    abortReason: null,
  })

  let disposed = false

  room.onRelay((message) => {
    if (disposed) return
    switch (message.type) {
      case 'match:start':
        core.patch({
          state: message.state,
          seat: message.seat,
          status: statusOf(message.state),
          lastRejection: null,
        })
        core.emitEvents(message.events)
        break
      case 'match:sync':
        core.patch({
          state: message.state,
          status: statusOf(message.state),
          lastRejection: rejectionOf(message.events),
        })
        core.emitEvents(message.events)
        break
      case 'match:command':
        // 客人不该收到指令，收到就是哪里接错线了，忽略即可。
        break
    }
  })

  room.onPeerLeft(() => {
    if (disposed) return
    // 房主是唯一跑规则的地方，它一走这局就没法继续了。
    core.patch({ status: 'aborted', abortReason: '房主断开了连接，本局结束' })
  })

  return {
    subscribe: core.subscribe,
    getSnapshot: core.getSnapshot,
    subscribeEvents: core.subscribeEvents,

    send(command: Command) {
      if (disposed) return
      room.relay({ type: 'match:command', command })
    },

    dispose() {
      disposed = true
      room.dispose()
    },
  }
}
