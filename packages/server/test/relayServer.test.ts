/**
 * 转发器的集成测试：真开一个服务，真连几个 socket 上去。
 *
 * 联机这条路没法靠类型检查守住——协议和房间归属都是运行时行为，
 * 而手工验证要开两个浏览器。这里用几个 socket.io 客户端把它跑一遍，代价低得多。
 *
 * 重点守的是"进别人的房之前先退掉自己那间"：客户端一进匹配房界面就先给自己开了房，
 * 漏了这一步会同时待在两个房间里，转发串台，而且自己那间空房还占着号。
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { io as connect } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRelayServer } from '../src/relayServer'
import type { RelayServer } from '../src/relayServer'

let relay: RelayServer
let httpServer: ReturnType<typeof createServer>
let port: number
const clients: Socket[] = []

beforeEach(async () => {
  relay = createRelayServer()
  httpServer = createServer()
  relay.attach(httpServer)
  // 端口 0 = 让系统随便挑一个空闲端口，不去抢开发时占着的 3001。
  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  port = (httpServer.address() as AddressInfo).port
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  await relay.close()
})

/** 连一个客户端并开好自己的房，返回它和房间码——和真实客户端一进匹配房的行为一致。 */
async function connectAndCreate(): Promise<{ socket: Socket; code: string }> {
  const socket = connect(`http://localhost:${port}`, {
    transports: ['websocket'],
    reconnection: false,
  })
  clients.push(socket)
  const code = await new Promise<string>((resolve) => {
    socket.on('connect', () => socket.emit('room:create', resolve))
  })
  return { socket, code }
}

function join(socket: Socket, code: string): Promise<string | null> {
  return new Promise((resolve) => socket.emit('room:join', code, resolve))
}

/** 等一个事件，超时就失败——没有它，断言"没收到消息"会一直挂着。 */
function nextEvent<T>(socket: Socket, event: string, timeoutMs = 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等 ${event} 超时`)), timeoutMs)
    socket.once(event, (payload: T) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

describe('转发器', () => {
  it('摇出来的房间码是 4 位数字，且两个人不会撞号', async () => {
    const a = await connectAndCreate()
    const b = await connectAndCreate()
    expect(a.code).toMatch(/^\d{4}$/)
    expect(b.code).toMatch(/^\d{4}$/)
    expect(a.code).not.toBe(b.code)
  })

  it('进房时通知房主，双向转发都通', async () => {
    const host = await connectAndCreate()
    const guest = await connectAndCreate()

    const joined = nextEvent<void>(host.socket, 'peer:joined')
    expect(await join(guest.socket, host.code)).toBeNull()
    await joined

    const toGuest = nextEvent<unknown>(guest.socket, 'relay')
    host.socket.emit('relay', { type: 'match:start' })
    expect(await toGuest).toEqual({ type: 'match:start' })

    const toHost = nextEvent<unknown>(host.socket, 'relay')
    guest.socket.emit('relay', { type: 'match:command' })
    expect(await toHost).toEqual({ type: 'match:command' })
  })

  it('客人进房之后，它原来那间空房就不存在了', async () => {
    const host = await connectAndCreate()
    const guest = await connectAndCreate()
    const guestOwnCode = guest.code

    expect(await join(guest.socket, host.code)).toBeNull()

    // 客人退出了自己那间房，房间空了会被 socket.io 回收，第三个人进不去。
    const third = await connectAndCreate()
    expect(await join(third.socket, guestOwnCode)).toBe('房间不存在')
  })

  it('第三个人进不了满员的房间', async () => {
    const host = await connectAndCreate()
    const guest = await connectAndCreate()
    const third = await connectAndCreate()

    expect(await join(guest.socket, host.code)).toBeNull()
    expect(await join(third.socket, host.code)).toBe('房间已满')
  })

  it('房间不存在时给出原因', async () => {
    const a = await connectAndCreate()
    expect(await join(a.socket, '0000')).toBe('房间不存在')
  })

  it('一方断线时通知还在房里的另一个人', async () => {
    const host = await connectAndCreate()
    const guest = await connectAndCreate()
    expect(await join(guest.socket, host.code)).toBeNull()

    const left = nextEvent<void>(host.socket, 'peer:left')
    guest.socket.close()
    await left
  })
})
