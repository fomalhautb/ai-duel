/**
 * 断线之后对局能不能接着打——把房主和客人两个 driver 真的接起来跑一遍。
 *
 * 这里测的是接线，不是传输：RoomHandle 换成内存里的一对假实现，
 * 可以随手"切断链路"摆出各种断线时序。真正的重连、重发、去重在 socket.test.ts 里测。
 *
 * 之所以要这一层：出问题最狠的那个现象——**对方已经出完牌了，我这边还一直显示"对方出牌中"**
 * ——是"链路断了但没人重同步"造成的，而重同步是写在 driver 里的（房主在链路恢复时
 * 重发一份完整局面）。socket 层测不到它，UI 测起来又太贵，只能在这一层验。
 */

import { describe, expect, it } from 'vitest'
import { BALANCED_DECK } from '@ai-duel/core'
import type { GameSetup, GameState } from '@ai-duel/core'
import { createHostDriver } from '../src/match/hostDriver'
import { createGuestDriver } from '../src/match/guestDriver'
import type { RoomHandle } from '../src/net/socket'
import type { RelayMessage } from '../src/net/protocol'

/**
 * 一对互联的假房间。
 *
 * `cut()` 之后两边发的消息全部丢掉——这就是断线：转发器不缓存，对端不在就直接扔。
 * `restore()` 恢复链路并触发两边的 onLinkChange，模拟重连成功。
 */
function makeLinkedRooms() {
  let up = true
  const sides = ['host', 'guest'] as const
  type Side = (typeof sides)[number]

  const relayListeners: Record<Side, ((m: RelayMessage) => void)[]> = { host: [], guest: [] }
  const linkListeners: Record<Side, ((up: boolean) => void)[]> = { host: [], guest: [] }
  const lostListeners: Record<Side, (() => void)[]> = { host: [], guest: [] }
  /** 链路断着时被丢掉的消息，用来断言"确实丢了"。 */
  const dropped: RelayMessage[] = []

  function make(side: Side): RoomHandle {
    const other: Side = side === 'host' ? 'guest' : 'host'
    const send = (message: RelayMessage) => {
      if (!up) {
        dropped.push(message)
        return
      }
      // 结构化拷贝一份，免得两边共享同一个 state 对象，测出来的"同步"是假的。
      const copy = JSON.parse(JSON.stringify(message)) as RelayMessage
      for (const fn of relayListeners[other]) fn(copy)
    }
    return {
      code: '1234',
      onPeerJoined() {},
      onLinkChange(listener) {
        linkListeners[side].push(listener)
        listener(up)
      },
      onLinkLost(listener) {
        lostListeners[side].push(listener)
      },
      onRelay(listener) {
        relayListeners[side].push(listener)
      },
      async join() {
        return null
      },
      relay: send,
      relayReliable: send,
      dispose() {},
    }
  }

  return {
    host: make('host'),
    guest: make('guest'),
    dropped,
    cut() {
      up = false
      for (const side of sides) for (const fn of linkListeners[side]) fn(false)
    },
    restore() {
      up = true
      for (const side of sides) for (const fn of linkListeners[side]) fn(true)
    },
    /** 宽限期到了，socket 层会调这个。 */
    giveUp(side: Side) {
      for (const fn of lostListeners[side]) fn()
    },
  }
}

const SETUP: GameSetup = {
  seed: 42,
  players: [
    { name: '房主', deck: [...BALANCED_DECK] },
    { name: '挑战者', deck: [...BALANCED_DECK] },
  ],
}

function startMatch() {
  const rooms = makeLinkedRooms()
  const guest = createGuestDriver({ room: rooms.guest })
  const host = createHostDriver({ room: rooms.host, setup: SETUP })
  return { rooms, host, guest }
}

/** 谁该出牌。两端都从各自的视图里读，用来验证它们看的是不是同一份局面。 */
const activeOf = (state: GameState | null) => state?.activePlayer ?? null

describe('联机对局的断线恢复', () => {
  it('开局后客人拿到和房主一样的局面', () => {
    const { host, guest } = startMatch()
    expect(guest.getSnapshot().status).toBe('playing')
    expect(activeOf(guest.getSnapshot().state)).toBe(activeOf(host.getSnapshot().state))
  })

  it('链路断了两边都显示重连中，恢复后回到正常', () => {
    const { rooms, host, guest } = startMatch()
    expect(host.getSnapshot().link).toBe('ok')

    rooms.cut()
    expect(host.getSnapshot().link).toBe('down')
    expect(guest.getSnapshot().link).toBe('down')
    // 断线不等于这局结束——只有熬过宽限期才算。
    expect(host.getSnapshot().status).toBe('playing')
    expect(guest.getSnapshot().status).toBe('playing')

    rooms.restore()
    expect(host.getSnapshot().link).toBe('ok')
    expect(guest.getSnapshot().link).toBe('ok')
  })

  it('断线期间房主推进的局面，链路一恢复客人就对齐', () => {
    const { rooms, host, guest } = startMatch()
    const before = guest.getSnapshot().state

    rooms.cut()
    // 房主这边照常出牌（比如它自己的回合走完了），客人此刻什么都收不到。
    host.send({ type: 'END_PLAY', player: activeOf(host.getSnapshot().state)! })
    expect(rooms.dropped.length).toBeGreaterThan(0)
    expect(guest.getSnapshot().state).toBe(before)

    /*
     * 这就是原来卡死的地方：客人的局面永远停在断线那一刻，
     * 界面一直显示"对方出牌中"，而房主那边早就走到下一步了。
     */
    rooms.restore()
    expect(guest.getSnapshot().state).not.toBe(before)
    expect(activeOf(guest.getSnapshot().state)).toBe(activeOf(host.getSnapshot().state))
  })

  it('重同步发的是完整局面，不带事件（不会重放对不上的动画）', () => {
    const { rooms, guest } = startMatch()
    const batches: unknown[][] = []
    guest.subscribeEvents((events) => batches.push(events))

    rooms.cut()
    rooms.restore()
    // 重同步那一条 events 是空的，driverCore 对空批次直接忽略，所以不该多出一批。
    expect(batches.every((batch) => batch.length > 0)).toBe(true)
  })

  it('熬过宽限期才判对局中断', () => {
    const { rooms, host, guest } = startMatch()
    rooms.cut()
    expect(host.getSnapshot().status).toBe('playing')

    rooms.giveUp('host')
    expect(host.getSnapshot().status).toBe('aborted')
    expect(host.getSnapshot().abortReason).toBe('对手断开了连接')

    rooms.giveUp('guest')
    expect(guest.getSnapshot().status).toBe('aborted')
    expect(guest.getSnapshot().abortReason).toBe('房主断开了连接，本局结束')
  })

  it('客人的指令走可靠通道', () => {
    const rooms = makeLinkedRooms()
    const sent: RelayMessage[] = []
    // 换掉可靠通道，确认指令确实是从这里出去的，而不是从尽力而为的那条。
    rooms.guest.relayReliable = (message) => sent.push(message)
    const guest = createGuestDriver({ room: rooms.guest })

    guest.send({ type: 'END_PLAY', player: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.type).toBe('match:command')
  })
})
