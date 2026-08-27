import { customAlphabet } from 'nanoid'
import { Server } from 'socket.io'
import type { DefaultEventsMap } from 'socket.io'

/**
 * 纯消息转发器。
 *
 * 它只做三件事：发房间码、把人放进房间、把消息原样转给房里的另一个人。
 * 它不认识卡牌、不认识回合、也不校验任何规则——规则全在房主客户端的 core 里跑。
 * 这是黑客松的刻意取舍：服务端没有权威状态，所以也谈不上防作弊。
 */

const PORT = Number(process.env.PORT ?? 3001)
/** 每个房间最多两人，满了就不让再进。 */
const ROOM_CAPACITY = 2

const newRoomCode = customAlphabet('0123456789', 4)

interface ClientToServerEvents {
  'room:create': (reply: (code: string) => void) => void
  'room:join': (code: string, reply: (error: string | null) => void) => void
  /** 对局消息，服务端不看内容。 */
  relay: (payload: unknown) => void
}

interface ServerToClientEvents {
  'peer:joined': () => void
  'peer:left': () => void
  relay: (payload: unknown) => void
}

interface SocketData {
  /** 当前所在房间码，没进房间时为空。 */
  room?: string
}

const io = new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>({
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

io.listen(PORT)
console.log(`[ai-duel] 转发器已启动：http://localhost:${PORT}`)
