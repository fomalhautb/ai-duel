/**
 * 联机通道的可靠传输层。
 *
 * 这里测的是 net/socket.ts 里那套"消息一定送得到"的机制——信封序号、回执、重发、去重，
 * 外加心跳探活和断线宽限期。它是这次修网络问题的核心：
 * 原来出牌指令是直接 ws.send() 出去的，连接一断就静默丢掉，房主永远等不到，
 * 玩家看到的就是"我点了没反应 / 对方明明出完牌了我这边还显示对方出牌中"。
 *
 * 服务端那边的冒烟测试（packages/server/test/smoke.mjs）覆盖不到这一层：
 * 转发器根本不看载荷，序号和回执全是客户端自己的事。
 *
 * 用假的 WebSocket 替掉 partysocket，这样才能精确摆出"消息丢了""对方没回执"这些时序——
 * 真连接上这些场景要么等不到，要么复现不稳定。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** vi.mock 会被提升到文件顶部，替身类必须跟着一起提升，否则 factory 里取不到。 */
const { FakeSocket } = vi.hoisted(() => {
  type Listener = (event: unknown) => void

  class FakeSocket {
    static instances: FakeSocket[] = []

    readonly OPEN = 1
    readyState = 1
    /** 这条连接往外发过的所有帧，按顺序。 */
    sent: string[] = []
    closed = false
    reconnectCount = 0
    private urlProvider: () => string
    private listeners = new Map<string, Listener[]>()

    constructor(
      url: string | (() => string),
      _protocols: unknown,
      readonly options: Record<string, unknown>,
    ) {
      this.urlProvider = typeof url === 'function' ? url : () => url
      FakeSocket.instances.push(this)
    }

    get url(): string {
      return this.urlProvider()
    }

    addEventListener(type: string, fn: Listener): void {
      const list = this.listeners.get(type) ?? []
      list.push(fn)
      this.listeners.set(type, list)
    }

    send(data: string): boolean {
      this.sent.push(data)
      return true
    }

    close(): void {
      this.closed = true
    }

    reconnect(): void {
      this.reconnectCount += 1
    }

    /** 模拟服务端发来一帧。 */
    receive(data: string): void {
      for (const fn of this.listeners.get('message') ?? []) fn({ data })
    }

    fire(type: string, event: unknown = {}): void {
      for (const fn of this.listeners.get(type) ?? []) fn(event)
    }

    /** 只保留业务帧，心跳会把 sent 冲得很吵。 */
    get frames(): string[] {
      return this.sent.filter((frame) => frame !== 'ping')
    }
  }

  return { FakeSocket }
})

vi.mock('partysocket', () => ({ WebSocket: FakeSocket }))

/** socket.ts 里那几个时间常量，测试要按它们推进假时钟。 */
const PING_INTERVAL = 15_000
const PONG_TIMEOUT = 20_000
const RESEND_INTERVAL = 2_000
const PEER_GRACE = 60_000

const listeners = new Map<string, Set<(event: unknown) => void>>()

beforeEach(() => {
  FakeSocket.instances.length = 0
  listeners.clear()
  vi.useFakeTimers()
  vi.stubGlobal('window', { location: { origin: 'http://localhost:8787' } })
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.get(type)?.delete(fn)
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ code: '1234' }) })),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

/**
 * 建一个已经连上、对手也在房里的 RoomHandle。
 *
 * connectRoom 要等进房回执才 resolve，所以这里手动把服务端那两帧喂进去。
 */
async function connectedRoom() {
  const { connectRoom } = await import('../src/net/socket')
  const pending = connectRoom()
  // 让 fetch 的微任务跑完，socket 才会被建出来。
  await vi.advanceTimersByTimeAsync(0)
  const socket = FakeSocket.instances[0]!
  socket.receive('#room:ok')
  socket.receive('#peer:online')
  const room = await pending
  socket.sent.length = 0
  return { room, socket }
}

/** 取出一帧里的信封，断言用。 */
const envelopeOf = (frame: string) => JSON.parse(frame)

describe('可靠送达', () => {
  it('可靠消息带序号和回执标记，普通消息不带', async () => {
    const { room, socket } = await connectedRoom()

    room.relayReliable({ type: 'match:command', command: { type: 'END_TURN' } as never })
    room.relay({ type: 'match:sync', state: null as never, events: [] })

    const [reliable, plain] = socket.frames.map(envelopeOf)
    expect(reliable.r).toBe(1)
    expect(reliable.n).toBe(1)
    expect(reliable.m.type).toBe('match:command')
    // 普通消息也带序号（收方要靠它去重），但没有 r，对方不用回执。
    expect(plain.n).toBe(2)
    expect(plain.r).toBeUndefined()
  })

  it('没收到回执就一直重发，收到回执才停', async () => {
    const { room, socket } = await connectedRoom()
    room.relayReliable({ type: 'match:command', command: { type: 'END_TURN' } as never })
    expect(socket.frames).toHaveLength(1)

    // 这正是原来卡死的场景：指令发出去了，对面没收到。现在它会自己重发。
    await vi.advanceTimersByTimeAsync(RESEND_INTERVAL * 3)
    expect(socket.frames.length).toBeGreaterThanOrEqual(4)
    expect(new Set(socket.frames.map((f) => envelopeOf(f).n))).toEqual(new Set([1]))

    // 房主确认收到了，重发就该停下。
    socket.receive('>' + JSON.stringify({ a: 1 }))
    const settled = socket.frames.length
    await vi.advanceTimersByTimeAsync(RESEND_INTERVAL * 3)
    expect(socket.frames).toHaveLength(settled)
  })

  it('普通消息不会被重发', async () => {
    const { room, socket } = await connectedRoom()
    room.relay({ type: 'match:sync', state: null as never, events: [] })

    await vi.advanceTimersByTimeAsync(RESEND_INTERVAL * 3)
    expect(socket.frames).toHaveLength(1)
  })

  it('收到要回执的消息会自动回执，且重复到达也照回', async () => {
    const { room, socket } = await connectedRoom()
    const seen: unknown[] = []
    room.onRelay((message) => seen.push(message))

    const frame = '>' + JSON.stringify({ n: 7, r: 1, m: { type: 'match:command', command: {} } })
    socket.receive(frame)
    expect(socket.frames.map(envelopeOf)).toEqual([{ a: 7 }])
    expect(seen).toHaveLength(1)

    /*
     * 同一条又来了一次，说明上一次的回执没送到——必须再回一次。
     * 但业务消息只能投递一次，否则同一张牌会被打两遍。
     */
    socket.receive(frame)
    expect(socket.frames.map(envelopeOf)).toEqual([{ a: 7 }, { a: 7 }])
    expect(seen).toHaveLength(1)
  })

  it('纯回执帧不会被当成业务消息投递上去', async () => {
    const { room, socket } = await connectedRoom()
    const seen: unknown[] = []
    room.onRelay((message) => seen.push(message))

    socket.receive('>' + JSON.stringify({ a: 3 }))
    expect(seen).toHaveLength(0)
  })

  it('认不出来的载荷直接丢掉，不会把界面搞崩', async () => {
    const { room, socket } = await connectedRoom()
    const seen: unknown[] = []
    room.onRelay((message) => seen.push(message))

    socket.receive('>这不是 JSON')
    socket.receive('>' + JSON.stringify({ n: 1, m: { type: '未知消息' } }))
    expect(seen).toHaveLength(0)
  })
})

describe('心跳', () => {
  it('定期发 ping', async () => {
    const { socket } = await connectedRoom()
    await vi.advanceTimersByTimeAsync(PING_INTERVAL)
    expect(socket.sent.filter((f) => f === 'ping')).toHaveLength(1)
  })

  it('发了 ping 等不到 pong 就重连（识破半开连接）', async () => {
    const { socket } = await connectedRoom()
    await vi.advanceTimersByTimeAsync(PING_INTERVAL)
    expect(socket.reconnectCount).toBe(0)

    // socket 还显示 OPEN、send 也不报错，但数据其实出不去——只有心跳能发现。
    await vi.advanceTimersByTimeAsync(PONG_TIMEOUT + 5_000)
    expect(socket.reconnectCount).toBeGreaterThan(0)
  })

  it('收到 pong 就不重连', async () => {
    const { socket } = await connectedRoom()
    await vi.advanceTimersByTimeAsync(PING_INTERVAL)
    socket.receive('pong')
    await vi.advanceTimersByTimeAsync(PONG_TIMEOUT + 5_000)
    expect(socket.reconnectCount).toBe(0)
  })

  it('pong 不会被当成业务消息', async () => {
    const { room, socket } = await connectedRoom()
    const seen: unknown[] = []
    room.onRelay((message) => seen.push(message))
    socket.receive('pong')
    expect(seen).toHaveLength(0)
  })
})

describe('链路状态与宽限期', () => {
  it('对手掉线先报链路断，熬过宽限期才判对局中断', async () => {
    const { room, socket } = await connectedRoom()
    const changes: boolean[] = []
    let lost = false
    room.onLinkChange((up) => changes.push(up))
    room.onLinkLost(() => {
      lost = true
    })

    // 第一个 true 是注册时补的当前状态，第二个才是这次掉线。
    socket.receive('#peer:offline')
    expect(changes).toEqual([true, false])
    expect(lost).toBe(false)

    await vi.advanceTimersByTimeAsync(PEER_GRACE - 1_000)
    expect(lost).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(lost).toBe(true)
  })

  it('宽限期内对手回来了就当无事发生', async () => {
    const { room, socket } = await connectedRoom()
    const changes: boolean[] = []
    let lost = false
    room.onLinkChange((up) => changes.push(up))
    room.onLinkLost(() => {
      lost = true
    })

    socket.receive('#peer:offline')
    await vi.advanceTimersByTimeAsync(PEER_GRACE / 2)
    socket.receive('#peer:online')
    expect(changes).toEqual([true, false, true])

    await vi.advanceTimersByTimeAsync(PEER_GRACE * 2)
    expect(lost).toBe(false)
  })

  it('自己断线同样算链路断', async () => {
    const { room, socket } = await connectedRoom()
    const changes: boolean[] = []
    room.onLinkChange((up) => changes.push(up))

    socket.fire('close', { code: 1006, reason: '' })
    expect(changes).toEqual([true, false])

    // 重连成功后服务端会重新发一遍进房回执和对端状态。
    socket.receive('#room:ok')
    expect(changes).toEqual([true, false, true])
  })

  it('房主在大厅等人时不算掉线，也不会启动宽限期', async () => {
    const { connectRoom } = await import('../src/net/socket')
    const pending = connectRoom()
    await vi.advanceTimersByTimeAsync(0)
    const socket = FakeSocket.instances[0]!
    socket.receive('#room:ok')
    // 房里还没人，服务端会发 offline——但那是"人还没来"，不是"人掉了"。
    socket.receive('#peer:offline')
    const room = await pending

    let lost = false
    room.onLinkLost(() => {
      lost = true
    })
    await vi.advanceTimersByTimeAsync(PEER_GRACE * 2)
    expect(lost).toBe(false)
  })

  it('dispose 之后不会再冒出对局中断', async () => {
    const { room, socket } = await connectedRoom()
    let lost = false
    room.onLinkLost(() => {
      lost = true
    })

    room.dispose()
    socket.fire('close', { code: 1000, reason: '' })
    await vi.advanceTimersByTimeAsync(PEER_GRACE * 2)
    expect(lost).toBe(false)
  })
})

describe('重连', () => {
  it('首次连接不带 resume，进过房之后重连才带', async () => {
    const { connectRoom } = await import('../src/net/socket')
    const pending = connectRoom()
    await vi.advanceTimersByTimeAsync(0)
    const socket = FakeSocket.instances[0]!
    expect(socket.url).toContain('role=host')
    expect(socket.url).toContain('peer=')
    expect(socket.url).not.toContain('resume=1')

    socket.receive('#room:ok')
    socket.receive('#peer:online')
    await pending

    // partysocket 每次重连都会重新取一次 URL，这时候要带上 resume——
    // 转发器靠它把"房里没人"解读成"房主也在重连"而不是"房间不存在"。
    expect(socket.url).toContain('resume=1')
  })

  it('业务拒绝不重连，网络原因才重连', async () => {
    const { connectRoom } = await import('../src/net/socket')
    void connectRoom().catch(() => {})
    await vi.advanceTimersByTimeAsync(0)
    const socket = FakeSocket.instances[0]!
    const shouldReconnect = socket.options.shouldReconnectOnClose as (e: {
      code: number
    }) => boolean

    // 4001 房间不存在、4002 房间已满、4003 房间被占：重试多少次都是同样的结果。
    expect(shouldReconnect({ code: 4001 })).toBe(false)
    expect(shouldReconnect({ code: 4002 })).toBe(false)
    // 4004 是被自己的新连接顶替，1006 是异常断开，这些都该继续重连。
    expect(shouldReconnect({ code: 4004 })).toBe(true)
    expect(shouldReconnect({ code: 1006 })).toBe(true)
  })

  it('重连上来立刻补发欠着的消息', async () => {
    const { room, socket } = await connectedRoom()
    room.relayReliable({ type: 'match:command', command: { type: 'END_TURN' } as never })
    socket.sent.length = 0

    // 断了又回来：进房回执是重连成功的标志。
    socket.fire('close', { code: 1006, reason: '' })
    socket.receive('#room:ok')

    expect(socket.frames.map((f) => envelopeOf(f).n)).toContain(1)
  })
})
