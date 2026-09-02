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
 * 「谁在房里」这件事是按**玩家**算的，不是按连接算的：一个玩家断线重连会换一条新连接，
 * 但还是同一个玩家。玩家身份由客户端生成的 peer 参数标识（见下面的 PEER_TAG_PREFIX），
 * 转发器靠它把「重连」和「另一个人来了」区分开——这是断线能恢复的前提。
 *
 * 一个容易踩的坑：compatibility_date >= 2025-04-01 之后，**导航请求**
 * （浏览器地址栏跳转，带 `Sec-Fetch-Mode: navigate` 头）根本不会调用 Worker 脚本，
 * 直接由静态资源层处理（Cloudflare 这么做是为了少算一次计费调用）。
 * WebSocket 升级请求不是导航请求，所以不受这条影响。
 * 例外是 wrangler.jsonc 的 assets.run_worker_first 里列出来的路径——
 * 那些路径无论如何都进 Worker，包括导航请求，所以下面要给页面请求留兜底。
 */

/** 每个房间最多两人，满了就不让再进。这里数的是**玩家**，不是连接。 */
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
 *
 * peer:joined 和 peer:online 的区别是「有没有见过这个人」：
 * 前者是对手第一次进房（房主据此开始选卡组），后者是掉线的对手又回来了
 * （对局照常继续，界面把「等待重连」的提示撤掉）。这两件事的后续处理完全不同，
 * 所以不能合并成一条消息。
 *
 * peer:offline 只说「对端此刻没有连接」，不代表这局结束了——判定对手真的走了
 * 是客户端的事（socket.ts 里有一段宽限期），转发器不掺和这个决定。
 */
const ROOM_OK = `${CONTROL_PREFIX}room:ok`
const PEER_JOINED = `${CONTROL_PREFIX}peer:joined`
const PEER_ONLINE = `${CONTROL_PREFIX}peer:online`
const PEER_OFFLINE = `${CONTROL_PREFIX}peer:offline`

/**
 * WebSocket 关闭码。4000-4999 是留给应用自己用的区间。
 * 用关闭码而不是 HTTP 错误码，是因为浏览器的 WebSocket 对象拿不到失败握手的响应体，
 * 但拿得到 CloseEvent 上的 code 和 reason，前端才能把中文原因显示出来。
 *
 * 前四个是「别再试了」的业务拒绝，客户端收到它们会停止自动重连；
 * CLOSE_SUPERSEDED 不一样，它是同一个玩家的新连接顶掉了旧的，旧连接本来就该消失。
 */
const CLOSE_BAD_ROLE = 4000
const CLOSE_NO_ROOM = 4001
const CLOSE_ROOM_FULL = 4002
const CLOSE_ROOM_TAKEN = 4003
const CLOSE_SUPERSEDED = 4004

/**
 * 玩家身份标签的前缀。标签跟着连接走，DO 休眠再醒来也还在，
 * 所以不需要在 storage 里另存一份「谁在房里」。
 * 加前缀是为了和 role 标签（host / guest）区分开，取标签时才认得出哪个是哪个。
 */
const PEER_TAG_PREFIX = 'p:'

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
    // 客户端定期发 "ping" 有两个作用：保住中间链路上的空闲连接不被运营商掐掉，
    // 以及靠"发了 ping 却等不到 pong"识破半开连接（socket 看着还开着，数据其实出不去）。
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
    const params = new URL(request.url).searchParams
    const role = params.get('role')
    const peerId = params.get('peer')
    // 客户端断线重连时会带上这个标记。它只影响「房里没人」怎么解读，见下面 guest 的分支。
    const resuming = params.get('resume') === '1'

    if ((role !== 'host' && role !== 'guest') || !peerId) {
      return rejectUpgrade(CLOSE_BAD_ROLE, 'role 参数必须是 host 或 guest，并且要带 peer')
    }

    const peerTag = PEER_TAG_PREFIX + peerId
    /*
     * 自己上一条还没被运行时回收的连接。断线重连时它多半还挂在房里——
     * 对端异常断开（拔网线、切后台）运行时要过一会儿才发现，这中间旧连接一直算「在房里」。
     *
     * 所以判断房间占没占满**只能看别人**，不能看总数：按总数算的话，
     * 自己的僵尸连接会把自己挡在门外，重连永远进不来。这是原来断线就回不去的根本原因。
     */
    const stale = this.ctx.getWebSockets(peerTag)
    const others = this.ctx.getWebSockets().filter((ws) => !stale.includes(ws))

    if (role === 'host') {
      // 房主是建房的那个人，房间码是刚摇出来的，正常情况下房里不该有另一个房主。
      // 有的话只可能是别人抢先占了这个码。
      if (others.some((ws) => this.roleOf(ws) === 'host')) {
        return rejectUpgrade(CLOSE_ROOM_TAKEN, '房间已被占用')
      }
    } else {
      if (others.some((ws) => this.roleOf(ws) === 'guest')) {
        return rejectUpgrade(CLOSE_ROOM_FULL, '房间已满')
      }
      /*
       * 「房里没人」有两种截然不同的含义，靠 resume 区分：
       * - 首次进房：房间码打错了，或者房主已经走了，统一说房间不存在。
       * - 断线重连：房主此刻多半也正在重连的路上，房间空只是暂时的。
       *   这时候必须放客人进来等，否则两边一起掉线（比如同一个 WiFi 抽了一下）
       *   就变成谁也回不去，对局必然报废。
       */
      if (!resuming && others.length === 0) {
        return rejectUpgrade(CLOSE_NO_ROOM, '房间不存在')
      }
    }
    if (others.length >= ROOM_CAPACITY) return rejectUpgrade(CLOSE_ROOM_FULL, '房间已满')

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    // 关键：用 ctx.acceptWebSocket() 而不是 server.accept()。
    // 只有这样连接才归运行时托管，DO 在没有消息进出的时候可以休眠——
    // 休眠期间连接不断、也不计算时长费用，这正是免费档能挂着长连接的原因。
    // 第二个参数是标签，标签跟着连接走，DO 休眠再醒来也还在。
    this.ctx.acceptWebSocket(server, [role, peerTag])

    /*
     * 顶掉自己的旧连接。顺序要紧：必须在新连接 accept 之后再关，
     * 这样 notifyPeerOffline 查「我还有没有别的连接」时能查到新的那条，
     * 就不会把这次清理误报成掉线（详见 notifyPeerOffline）。
     */
    for (const zombie of stale) zombie.close(CLOSE_SUPERSEDED, '同一玩家的新连接已接管')

    // 回执要在任何转发消息之前发出去，客户端拿它确认进房成功。
    server.send(ROOM_OK)
    // 紧接着告诉它对端在不在。重连回来的一方需要这个：它自己通了不等于链路通了，
    // 对方可能也正断着，这时候不该急着以为可以继续对局。
    server.send(others.length > 0 ? PEER_ONLINE : PEER_OFFLINE)
    // 对端看到的是「新人进房」还是「掉线的人回来了」，取决于这是不是一次重连。
    const notice = stale.length > 0 || resuming ? PEER_ONLINE : PEER_JOINED
    for (const peer of others) peer.send(notice)

    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // 载荷是不透明数据：这里绝不 JSON.parse，服务端不认识卡牌也不认识回合，
    // 所以前端的协议怎么改，这段代码都不用动。
    // 文本帧加一个字符的前缀让客户端和控制消息分开；二进制帧不会是控制消息，原样转发。
    const framed = typeof message === 'string' ? RELAY_PREFIX + message : message
    for (const peer of this.othersOf(ws)) peer.send(framed)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.notifyPeerOffline(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    // 连接异常断开时不会走 webSocketClose，还在房里的人同样需要知道。
    this.notifyPeerOffline(ws)
  }

  /**
   * 一条连接没了，告诉房里另一个玩家。
   *
   * 关键是先确认这个**玩家**是真的不在了：重连时新连接会顶掉旧的，
   * 旧连接的关闭回调随后才到，此时同一个玩家已经有新连接在房里了。
   * 不做这个检查的话，每次重连都会给对手误报一次掉线——对手界面闪一下「对方断开」，
   * 严重时直接把还在正常进行的对局判成中断。
   */
  private notifyPeerOffline(ws: WebSocket): void {
    const peerTag = this.peerTagOf(ws)
    if (peerTag && this.ctx.getWebSockets(peerTag).some((other) => other !== ws)) return
    for (const peer of this.othersOf(ws)) peer.send(PEER_OFFLINE)
  }

  /**
   * 房里的另一个**玩家**的连接。
   *
   * 按玩家标签排除自己，而不是按连接对象排除：重连的空窗期里同一个玩家可能同时挂着
   * 新旧两条连接，按对象排除的话消息会被转发给自己的僵尸连接。
   *
   * 每次都重新查 getWebSockets() 而不是维护一张表，是因为这份列表由运行时保管，
   * DO 休眠再醒来依然完整，而内存里的表会丢。
   */
  private othersOf(ws: WebSocket): WebSocket[] {
    const peerTag = this.peerTagOf(ws)
    return this.ctx.getWebSockets().filter((other) => this.peerTagOf(other) !== peerTag)
  }

  private peerTagOf(ws: WebSocket): string | undefined {
    return this.ctx.getTags(ws).find((tag) => tag.startsWith(PEER_TAG_PREFIX))
  }

  private roleOf(ws: WebSocket): string | undefined {
    return this.ctx.getTags(ws).find((tag) => tag === 'host' || tag === 'guest')
  }
}

/**
 * `/api/room` 的跨域头，纯粹是为了本地开发。
 *
 * 本地是两个进程、两个 origin（Vite 在 5173，`wrangler dev` 在 8787），
 * 没有这个头浏览器会把 `/api/room` 的响应拦下来，前端拿不到房间码。
 * 线上前端和 Worker 同域，用不上它，但留着也没有坏处。
 *
 * 用 `*` 而不是白名单：这个接口是公开的、不带凭据，返回的只有一个房间码。
 * 不用处理 OPTIONS 预检——它是没有自定义头的 GET，属于简单请求。
 * WebSocket 升级不受 CORS 约束，所以只有这个 fetch 接口需要。
 */
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }

/** 摇一个没人用的房间码。 */
async function createRoom(env: Env): Promise<Response> {
  // 四位码只有一万种，撞号是正常情况，撞到就重摇。
  // 但重摇次数要有上限：Worker 里的死循环会一直烧 CPU 时间。
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = newRoomCode()
    if ((await env.ROOM.getByName(code).occupancy()) === 0) {
      return Response.json({ code }, { headers: CORS_HEADERS })
    }
  }
  return Response.json(
    { error: '房间码摇不出来了，请稍后再试' },
    { status: 503, headers: CORS_HEADERS },
  )
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