import { customAlphabet } from 'nanoid'
import { Server } from 'socket.io'
import type { DefaultEventsMap } from 'socket.io'

/**
 * 纯消息转发器。
 *
 * 它只做三件事：发房间码、把人放进房间、把消息原样转给房里的另一个人。
 * 它不认识卡牌、不认识回合、也不校验任何规则——规则全在房主客户端的 core 里跑。
 * 这是黑客松的刻意取舍：服务端没有权威状态，所以也谈不上防作弊。
 *
 * 拆成工厂函数而不是在模块顶层直接开服务，是为了让测试能在随机端口上开一份，
 * 不去抢开发时占着的 3001。真正监听端口的是 index.ts。
 */

/** 每个房间最多两人，满了就不让再进。 */
const ROOM_CAPACITY = 2

const newRoomCode = customAlphabet('0123456789', 4)

export interface ClientToServerEvents {
  'room:create': (reply: (code: string) => void) => void
  'room:join': (code: string, reply: (error: string | null) => void) => void
  /** 对局消息，服务端不看内容。 */
  relay: (payload: unknown) => void
}

export interface ServerToClientEvents {
  'peer:joined': () => void
  'peer:left': () => void
  relay: (payload: unknown) => void
}

export interface SocketData {
  /** 当前所在房间码，没进房间时为空。 */
  room?: string
}

export type RelayServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SocketData
>

/** 建一个转发器，但不监听端口——监听交给调用方。 */
export function createRelayServer(): RelayServer {
  const io: RelayServer = new Server({
    // 黑客松阶段客户端跑在 Vite dev server 上，域名端口都跟这里不同，直接全放开。
    cors: { origin: '*' },
  })

  function roomSize(code: string): number {
    return io.sockets.adapter.rooms.get(code)?.size ?? 0
  }

  io.on('connection', (socket) => {
    socket.on('room:create', (reply) => {
      let code = newRoomCode()
      // 四位码只有一万种，撞号是正常情况，撞到就重摇。
      while (roomSize(code) > 0) code = newRoomCode()
      void socket.join(code)
      socket.data.room = code
      reply(code)
    })

    socket.on('room:join', (code, reply) => {
      const size = roomSize(code)
      if (size === 0) return reply('房间不存在')
      if (size >= ROOM_CAPACITY) return reply('房间已满')
      // 每个人一连上来就先给自己开了一间房（客户端的匹配房界面会立刻显示房间码），
      // 所以进别人的房之前必须先退出自己那间。不退的话会同时待在两个房间里：
      // 自己那间空房还占着号能被第三个人进来，转发也会串台。
      const own = socket.data.room
      if (own !== undefined && own !== code) void socket.leave(own)
      void socket.join(code)
      socket.data.room = code
      reply(null)
      // 通知房主：对手到齐了，可以开局。
      socket.to(code).emit('peer:joined')
    })

    // 房主发事件、客人发指令，走的都是这一条通道。
    socket.on('relay', (payload) => {
      const code = socket.data.room
      if (!code) return
      socket.to(code).emit('relay', payload)
    })

    socket.on('disconnect', () => {
      const code = socket.data.room
      if (!code) return
      // socket.io 自己会把断开的连接移出房间、房间空了也会自动回收，
      // 这里只需要告诉还在房里的另一个人对局中断了。
      socket.to(code).emit('peer:left')
    })
  })

  return io
}
