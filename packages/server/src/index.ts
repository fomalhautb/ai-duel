import { DurableObject } from 'cloudflare:workers'
import { customAlphabet } from 'nanoid'

/**
 * 纯消息转发器，跑在 Cloudflare Worker 上。
 *
 * 它只做三件事：发房间码、把人放进房间、把消息原样转给房里的另一个人。
 * 它不认识卡牌、不认识回合、也不校验任何规则——规则全在房主客户端的 core 里跑。
 * 这是黑客松的刻意取舍：服务端没有权威状态，所以也谈不上防作弊。
 *
 * 同一个 Worker 还负责发前端静态资源（见 wrangler.jsonc 的 assets），所以只有一个域名。
 *
 * 一个容易踩的坑：compatibility_date >= 2025-04-01 之后，**导航请求**
 * （浏览器地址栏跳转，带 `Sec-Fetch-Mode: navigate` 头）根本不会调用 Worker 脚本，
 * 直接由静态资源层处理（Cloudflare 这么做是为了少算一次计费调用）。
 * WebSocket 升级请求不是导航请求，所以不受这条影响。
 * 例外是 wrangler.jsonc 的 assets.run_worker_first 里列出来的路径——
 * 那些路径无论如何都进 Worker，包括导航请求，所以下面要给页面请求留兜底。
 */

/** 每个房间最多两人，满了就不让再进。 */
const ROOM_CAPACITY = 2

/**
 * 4 位数字房间码。用 nanoid 而不是自己拿 crypto.getRandomValues 取模，
 * 是因为取模会让靠前的数字概率略高，而 nanoid 已经处理好了这件事。
 */
const newRoomCode = customAlphabet('0123456789', 4)

/**
 * 服务端发给客户端的每一帧都带一个字符的前缀，用来区分两类消息：
 * `#` 开头是服务端自己的控制消息，`>` 开头是原样转发的对端载荷。
 *
 * 之所以要这个信封：控制消息和游戏载荷走同一条 WebSocket，客户端得能分开。
 * 之所以只用一个字符前缀而不是包一层 JSON：服务端**绝不解析游戏载荷**，
 * 加前缀是纯字符串拼接，不需要看懂里面是什么。
 *
 * 客户端发上来的消息不带前缀，整条都是载荷。
 */
const CONTROL_PREFIX = '#'
const RELAY_PREFIX = '>'

/**
 * 控制消息的全部取值。
 *
 * room:ok 是进房成功的回执。它不是可有可无的：被拒绝的连接也会先握手成功再被关掉
 * （见 rejectUpgrade），所以客户端光看到 open 事件不能算进房了，
 * 得等第一帧——收到 room:ok 才是真进去了，收到 close 就看 code 和 reason。
 */
const ROOM_OK = `${CONTROL_PREFIX}room:ok`
const PEER_JOINED = `${CONTROL_PREFIX}peer:joined`
const PEER_LEFT = `${CONTROL_PREFIX}peer:left`

/**
 * WebSocket 关闭码。4000-4999 是留给应用自己用的区间。
 * 用关闭码而不是 HTTP 错误码，是因为浏览器的 WebSocket 对象拿不到失败握手的响应体，
 * 但拿得到 CloseEvent 上的 code 和 reason，前端才能把中文原因显示出来。
 */
const CLOSE_BAD_ROLE = 4000
const CLOSE_NO_ROOM = 4001
const CLOSE_ROOM_FULL = 4002
const CLOSE_ROOM_TAKEN = 4003

/**
 * 握手已经完成、但业务上要拒绝这个连接。
 *
 * 必须先回 101 把连接建起来再关掉：直接回 4xx 的话浏览器只会抛一个没有细节的 error，
 * 玩家看不到"房间不存在"还是"房间已满"。
 */
function rejectUpgrade(code: number, reason: string): Response {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
  // 这里用普通的 accept() 而不是 ctx.acceptWebSocket()：连接马上就关，没有休眠的必要。
  server.accept()
  server.close(code, reason)
  return new Response(null, { status: 101, webSocket: client })
}

/**
 * 一个房间 = 一个 Durable Object 实例，房间码就是它的名字。
 *
 * 这样就不需要自己维护一张全局房间表：同一个码永远被路由到同一个实例，
 * 一个房间的两条连接一定落在同一个地方，转发就是在实例内部把消息递给另一条连接。
 */
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // 心跳交给运行时自动应答：DO 在休眠中收到 "ping" 会直接回 "pong"，不会被唤醒、不计费。
    // 客户端只要定期发 "ping" 就能保住中间链路上的连接。
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    // 这里不需要像官方示例那样遍历 getWebSockets() 恢复状态：
    // 下面所有地方都是现用现查 getWebSockets()，没有任何内存里的连接表，
    // 所以 DO 从休眠中醒来、构造函数重跑时也没有东西要恢复。
  }

  /**
   * 房里现在几个人。Worker 摇房间码时用 RPC 调它来判断这个码空不空。
   */
  occupancy(): number {
    return this.ctx.getWebSockets().length
  }

  override async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get('role')
    if (role !== 'host' && role !== 'guest') {
      return rejectUpgrade(CLOSE_BAD_ROLE, 'role 参数必须是 host 或 guest')
    }

    // 先算好在座的人，等下要通知他们；注意此刻新连接还没加进来。
    const peers = this.ctx.getWebSockets()

    if (role === 'host') {
      // 房主是建房的那个人，房间码是刚摇出来的，正常情况下房里一定是空的。
      // 房里已经有人只可能是别人抢先占了这个码。
      if (peers.length > 0) return rejectUpgrade(CLOSE_ROOM_TAKEN, '房间已被占用')
    } else {
      // 房里没人，对玩家来说就是"房间码打错了"或者"房主已经走了"，统一说房间不存在。
      if (peers.length === 0) return rejectUpgrade(CLOSE_NO_ROOM, '房间不存在')
      if (peers.length >= ROOM_CAPACITY) return rejectUpgrade(CLOSE_ROOM_FULL, '房间已满')
    }

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    // 关键：用 ctx.acceptWebSocket() 而不是 server.accept()。
    // 只有这样连接才归运行时托管，DO 在没有消息进出的时候可以休眠——
    // 休眠期间连接不断、也不计算时长费用，这正是免费档能挂着长连接的原因。
    // 第二个参数是标签，标签跟着连接走，DO 休眠再醒来也还在。
    this.ctx.acceptWebSocket(server, [role])

    // 回执要在任何转发消息之前发出去，客户端拿它确认进房成功。
    server.send(ROOM_OK)
    // 通知房主：对手到齐了，可以开局。
    for (const peer of peers) peer.send(PEER_JOINED)

    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const peer = this.peerOf(ws)
    if (!peer) return
    // 载荷是不透明数据：这里绝不 JSON.parse，服务端不认识卡牌也不认识回合，
    // 所以前端的协议怎么改，这段代码都不用动。
    // 文本帧加一个字符的前缀让客户端和控制消息分开；二进制帧不会是控制消息，原样转发。
    peer.send(typeof message === 'string' ? RELAY_PREFIX + message : message)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.notifyPeerLeft(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    // 连接异常断开时不会走 webSocketClose，还在房里的人同样需要知道对局中断了。
    this.notifyPeerLeft(ws)
  }

  private notifyPeerLeft(ws: WebSocket): void {
    this.peerOf(ws)?.send(PEER_LEFT)
  }

  /**
   * 房里的另一个人。
   *
   * 容量是 2，所以除自己之外最多只剩一个。每次都重新查 getWebSockets() 而不是维护一张表，
   * 是因为这份列表由运行时保管，DO 休眠再醒来依然完整，而内存里的表会丢。
   * 关闭回调触发时自己可能还在这份列表里，所以要显式排除。
   */
  private peerOf(ws: WebSocket): WebSocket | undefined {
    return this.ctx.getWebSockets().find((other) => other !== ws)
  }
}

/** 摇一个没人用的房间码。 */
async function createRoom(env: Env): Promise<Response> {
  // 四位码只有一万种，撞号是正常情况，撞到就重摇。
  // 但重摇次数要有上限：Worker 里的死循环会一直烧 CPU 时间。
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = newRoomCode()
    if ((await env.ROOM.getByName(code).occupancy()) === 0) {
      return Response.json({ code })
    }
  }
  return Response.json({ error: '房间码摇不出来了，请稍后再试' }, { status: 503 })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/room') return createRoom(env)

    const roomPath = /^\/room\/(\d{4})\/?$/.exec(url.pathname)
    const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
    if (roomPath && isUpgrade) {
      // 房间码就是 Durable Object 的名字，同一个码永远路由到同一个实例。
      // getByName 是新 API，取代了老的 idFromName + get 两步写法。
      return env.ROOM.getByName(roomPath[1]!).fetch(request)
    }

    // 剩下的都是页面请求，交给静态资源层，匹配不到的路径回 index.html。
    // 主要就是打开对局页面 /room/1234 的时候：那条路径既是 WebSocket 端点又是前端路由，
    // 被 run_worker_first 拉进了 Worker，所以这里得亲自把 index.html 发回去。
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
