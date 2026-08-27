import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import express from 'express'
import { customAlphabet } from 'nanoid'
import { Server } from 'socket.io'
import type { DefaultEventsMap } from 'socket.io'

/**
 * 消息转发器 + 前端静态站点，跑在同一个端口上。
 *
 * 转发部分只做三件事：发房间码、把人放进房间、把消息原样转给房里的另一个人。
 * 它不认识卡牌、不认识回合、也不校验任何规则——规则全在房主客户端的 core 里跑。
 * 这是黑客松的刻意取舍：服务端没有权威状态，所以也谈不上防作弊。
 *
 * 前端和 socket 合并成一个进程，是为了在免费档的容器平台上只占一份资源、
 * 只暴露一个域名；同域名也顺带把 CORS 问题一起消掉了。
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

/**
 * client 的构建产物目录。
 *
 * 只写一条相对路径，是因为容器镜像里刻意保留了 packages/{server,client} 的相对结构
 * （见根目录 Dockerfile），本地开发和容器里算出来的都是同一个位置，不用分环境判断。
 */
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist/', import.meta.url))

const app = express()

// 平台的存活探针打这个地址；它必须绕开下面的 SPA 回退，否则探针永远拿到 index.html。
app.get('/healthz', (_req, res) => {
  res.type('text/plain').send('ok')
})

app.use(express.static(CLIENT_DIST))

// SPA 回退：静态文件没命中的 GET 一律交给 index.html，由前端路由自己决定显示什么。
// Express 5 换了 path-to-regexp，旧版的 '*' 会直接抛错，通配符必须写成具名的 '/{*splat}'
// （加花括号表示"零个或多个路径段"，这样根路径 '/' 也能兜住）。
// 这里不用特意排除 /socket.io：socket.io 挂到 httpServer 上时会抢先接管 request 事件，
// 只有不属于它的请求才会往下交给 express，所以这条路由根本看不到握手请求。
app.get('/{*splat}', (_req, res) => {
  res.sendFile('index.html', { root: CLIENT_DIST })
})

const httpServer = createServer(app)

const io = new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>(httpServer, {
  // 生产环境前端和 socket 同源，本来用不着 CORS；这条全放开是留给本地开发的：
  // 那时候 client 跑在 Vite 的 5173 端口，跟这里不同源。
  // 放开也没有额外风险——这个转发器本来就不做鉴权，任何人拿到房间码都能进房。
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

httpServer.listen(PORT, () => {
  console.log(`[ai-duel] 前端和转发器都在 http://localhost:${PORT}（socket.io 路径 /socket.io）`)
})
