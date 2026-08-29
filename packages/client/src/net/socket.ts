/**
 * 联机通道的唯一封装：建房、进房、转发消息，外加断线重连和消息可靠送达。
 *
 * 这一层不认识卡牌和回合，跟服务端一样只管"把 payload 送到房里的另一个人"。
 * 对局逻辑在 hostDriver / guestDriver 里。
 *
 * 服务端是 Cloudflare Worker + Durable Object（协议见 docs/deploy.md 第 4 节）：
 * - `GET /api/room` 摇一个 4 位房间码
 * - `GET /room/:code?role=host|guest&peer=<玩家id>[&resume=1]` 升级成 WebSocket
 * - 服务端发下来的每一帧带一个字符前缀：`#` 是控制消息，`>` 是原样转发的对端载荷
 * - 客户端发上去的不带前缀，整条都是载荷
 *
 * ## 为什么这一层这么厚
 *
 * 裸 WebSocket 在弱网下有两个安静的失败模式，玩家看到的都是"卡住了"而不是"断线了"：
 *
 * 1. **发送静默丢失**：连接进入 CLOSING / CLOSED 之后 `send()` 既不抛错也不排队，
 *    直接丢掉。出牌指令就这么消失，房主永远等不到，界面停在"等待对方出牌"。
 * 2. **半开连接**：链路中间被掐断（运营商 NAT 超时、切网、手机锁屏）时，
 *    本地 socket 还是 OPEN，数据却出不去，而 TCP 要几分钟才发现。
 *
 * 所以这里有四道防线，缺一个都会退回上面那两种卡死：
 * - **自动重连**：交给 partysocket（Cloudflare 维护，API 和原生 WebSocket 一样）。
 * - **心跳探活**：定期发 ping，超时收不到 pong 就判定半开、主动重连，不等 TCP。
 * - **可靠送达**：客人发给房主的指令带序号，收不到回执就一直重发，收方按序号去重。
 * - **宽限期**：链路断了先显示"重连中"，超过 PEER_GRACE 才判对局中断。
 */

import { WebSocket as ReconnectingWebSocket } from 'partysocket'
import { asRelayMessage } from './protocol'
import type { RelayMessage } from './protocol'

/**
 * 服务器地址（HTTP 形式，WebSocket 地址由它推导）。
 *
 * 生产环境前端和转发器是**同一个 Worker、同一个域名**，所以默认直接用当前页面的 origin，
 * 不需要配置也不会有跨域问题。
 *
 * 本地开发是两个进程：Vite 在 5173，`wrangler dev` 在 8787，页面 origin 指不到转发器，
 * 这时要在 `packages/client/.env.local` 里设 `VITE_SERVER_URL=http://127.0.0.1:8787`。
 * 两台电脑局域网联调时写成 `http://<局域网IP>:8787`——写 localhost 的话另一台会连到它自己身上。
 * 这样是跨域的，但转发器给 `/api/room` 加了 `Access-Control-Allow-Origin: *`，
 * 所以 fetch 房间码不会被浏览器拦；WebSocket 本身不受 CORS 约束。
 *
 * 写成函数而不是模块级常量：模块一被 import 就读 window 的话，这个文件（以及所有辗转
 * import 到它的界面模块）在没有 window 的环境里加载就会直接抛错。测试跑在 node 里，
 * 有几条测试要 import 界面模块拿它们的预加载清单（test/assetManifest.test.ts），
 * 一路牵进来就会撞上这行。取地址推迟到真要连的时候，那时一定在浏览器里。
 * 末尾的斜杠在这里一次性去掉，调用方直接拼路径即可。
 */
function serverUrl(): string {
  return (import.meta.env.VITE_SERVER_URL ?? window.location.origin).replace(/\/$/, '')
}

/** http→ws、https→wss。两者的前缀只差一个字母，替换掉开头的 "http" 就够了。 */
function wsBase(): string {
  return serverUrl().replace(/^http/, 'ws')
}

/**
 * 这个标签页的玩家身份，重连时靠它让转发器认出"还是刚才那个人"。
 *
 * 只活在内存里：刷新页面 = 新玩家 = 这局没了，这和架构文档"不存对局"是一致的。
 *
 * randomUUID 需要安全上下文，局域网联调走的是 http://192.168.x.x 这类地址，
 * 拿不到它，所以要有退路——这个 id 只用来区分同一个房间里的两个人，不需要密码学强度。
 */
const PEER_ID =
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/** 服务端控制消息的前缀，`#` 后面跟事件名。 */
const CONTROL_PREFIX = '#'
/** 原样转发的对端载荷的前缀，去掉这一个字符剩下的就是对方发的原文。 */
const RELAY_PREFIX = '>'

const ROOM_OK = `${CONTROL_PREFIX}room:ok`
const PEER_JOINED = `${CONTROL_PREFIX}peer:joined`
const PEER_ONLINE = `${CONTROL_PREFIX}peer:online`
const PEER_OFFLINE = `${CONTROL_PREFIX}peer:offline`

/** 心跳内容。转发器配了自动应答，DO 在休眠中就能回 pong，不会被唤醒也不计费。 */
const PING = 'ping'
const PONG = 'pong'

/** 多久发一次心跳。要明显短于运营商 NAT 和 Cloudflare 边缘的空闲超时（后者约 100 秒）。 */
const PING_INTERVAL = 15_000
/** 发出 ping 后等 pong 的上限，超了就认定是半开连接。 */
const PONG_TIMEOUT = 20_000
/** 心跳检查的节拍。比 PING_INTERVAL 短，是为了让超时判定的精度不受节拍拖累。 */
const HEARTBEAT_TICK = 5_000
/** 没收到回执时重发的间隔。 */
const RESEND_INTERVAL = 2_000
/** 链路断了多久算这局没救了。宽限期内重连回来，玩家几乎无感。 */
const PEER_GRACE = 60_000
/** 首次进房的总时限。超时就报错让玩家重试，而不是无限转圈。 */
const FIRST_CONNECT_TIMEOUT = 15_000

/**
 * 业务拒绝的关闭码（见服务端 CLOSE_*）。收到这些说明"再试也没用"，要停掉自动重连；
 * 其余关闭码一律当成网络问题，交给 partysocket 继续重连。
 */
const BUSINESS_REJECTIONS = new Set([4000, 4001, 4002, 4003])

/**
 * 每条载荷外面套的信封。字段名都是一个字母，因为出牌频繁、能省一点是一点。
 *
 * 这一层对上层完全透明：driver 发的还是 RelayMessage，收到的也还是 RelayMessage。
 */
interface Envelope {
  /** 发送方的递增序号。收方靠它去重——重发会让同一条消息到达好几次。 */
  n?: number
  /** 1 表示这条要对方回执，没收到回执就一直重发。 */
  r?: 1
  /** 捎带的回执：确认收到了对方的第几号消息。只有这个字段的帧就是一个纯回执。 */
  a?: number
  /** 业务载荷。纯回执帧没有它。 */
  m?: RelayMessage
}

export interface RoomHandle {
  /** 自己这间房的房间码，给对方念的就是它。 */
  code: string
  /** 有人**第一次**进了我的房 —— 也就是"我是房主"。重连回来不会触发它。 */
  onPeerJoined(listener: () => void): void
  /**
   * 端到端链路通断。通 = 自己连着且对手也连着，只有这时候消息才真的送得到。
   *
   * 界面拿它显示"正在重连"；房主拿它做重同步——链路一恢复就重发一份完整局面，
   * 断线期间丢掉的增量就都不重要了。
   *
   * 注册时会立刻用当前状态回调一次：driver 是在对局中途建出来的，
   * 不补这一次的话，它要等到下一次状态**变化**才知道链路是通是断。
   */
  onLinkChange(listener: (up: boolean) => void): void
  /** 链路断了超过宽限期，这局救不回来了。 */
  onLinkLost(listener: () => void): void
  onRelay(listener: (message: RelayMessage) => void): void
  /** 加入别人的房间。成功返回 null，失败返回服务端给的原因。 */
  join(code: string): Promise<string | null>
  /**
   * 尽力而为地发一条消息：链路断着就丢。
   *
   * 只适合"整份局面"这种后一条能完全覆盖前一条的消息——丢了也没关系，
   * 链路恢复时房主会重发一份最新的。
   */
  relay(message: RelayMessage): void
  /**
   * 可靠地发一条消息：收不到回执就一直重发，收方按序号去重。
   *
   * 出牌指令、锁定卡组这种"每一条都算数、丢了就卡住"的消息必须用它。
   */
  relayReliable(message: RelayMessage): void
  dispose(): void
}

/** 监听器都放在连接之外，因为 join() 会换一条连接，而监听器要跨过这次更换活下来。 */
interface Listeners {
  relay: Set<(message: RelayMessage) => void>
  peerJoined: Set<() => void>
  linkChange: Set<(up: boolean) => void>
  linkLost: Set<() => void>
}

/** 一条连接（连同它的心跳、重发队列）向上报告状态的回调。 */
interface LinkCallbacks {
  onMessage(message: RelayMessage): void
  onPeerJoined(): void
  /** 自己这条 socket 通不通。 */
  onSelfConnected(connected: boolean): void
  /** 对端在不在房里。 */
  onPeerPresent(present: boolean): void
}

interface Link {
  send(message: RelayMessage, reliable: boolean): void
  /** 立刻把还没收到回执的消息重发一遍，不等下一个重发节拍。 */
  flush(): void
  close(): void
}

/**
 * 建一条连着某个房间的连接，等到进房回执才算成功。
 *
 * 被拒绝的连接**也会先握手成功**再被立刻关掉（服务端只能这么做，浏览器拿不到失败握手的
 * 响应体，只拿得到 CloseEvent 上的 code 和 reason）。所以光收到 open 事件不算进房，
 * 必须等第一帧 `#room:ok`。
 *
 * reject 出来的 Error.message 就是服务端给的中文原因（比如「房间不存在」「房间已满」），
 * 上层可以直接显示给玩家。
 */
function openLink(code: string, role: 'host' | 'guest', callbacks: LinkCallbacks): Promise<Link> {
  return new Promise((resolve, reject) => {
    /** 进过一次房之后，后面每次连接都是重连。转发器靠这个标记决定「房里没人」怎么解读。 */
    let joined = false
    let settled = false
    const firstConnect = setTimeout(() => {
      settle(false, new Error('连接超时'))
    }, FIRST_CONNECT_TIMEOUT)

    const socket = new ReconnectingWebSocket(
      () => `${wsBase()}/room/${code}?role=${role}&peer=${PEER_ID}${joined ? '&resume=1' : ''}`,
      [],
      {
        // 默认的首次退避是 1~5 秒随机，对"刚断马上就好"的抖动来说太慢了，压到半秒。
        minReconnectionDelay: 500,
        // 封顶 5 秒（默认 10 秒）。宽限期只有 60 秒，退避太长会白白吃掉重试机会。
        maxReconnectionDelay: 5_000,
        reconnectionDelayGrowFactor: 1.5,
        // 默认 4 秒在弱网下太紧，正常握手都会被判超时然后空转重连。
        connectionTimeout: 8_000,
        maxRetries: Infinity,
        // 断线期间上层还在发消息，全部缓冲下来，连上立刻补发。
        maxEnqueuedMessages: Infinity,
        // 业务拒绝（房间不存在 / 已满 / 被占）重试多少次都是同样的结果，不如立刻告诉玩家。
        shouldReconnectOnClose: (event) => !BUSINESS_REJECTIONS.has(event.code),
      },
    )

    /**
     * 已经主动关掉了。close 事件在这之后还会来一次，但那是我们自己关的，
     * 不能当成"网络断了"报上去——join 换连接时报上去会把刚建好的那条连接状态覆盖掉。
     */
    let closing = false
    /** 自己发出去、还没被对方确认的消息，key 是序号。 */
    const pending = new Map<number, string>()
    let outSeq = 0
    /** 已经收到并投递给上层的最大序号，用来丢掉重发造成的重复。 */
    let lastSeen = 0
    /** 当前这个 ping 是什么时候发的，0 表示没有在等 pong。 */
    let pingSentAt = 0
    let lastPongAt = Date.now()

    function post(frame: string): void {
      socket.send(frame)
    }

    function flush(): void {
      if (socket.readyState !== socket.OPEN) return
      for (const frame of pending.values()) post(frame)
    }

    function send(message: RelayMessage, reliable: boolean): void {
      const n = (outSeq += 1)
      const frame = JSON.stringify(reliable ? { n, r: 1, m: message } : { n, m: message })
      // 先进重发队列再发：万一 send 抛错，这条消息还在队列里等下一次重发。
      if (reliable) pending.set(n, frame)
      post(frame)
    }

    function handleEnvelope(envelope: Envelope): void {
      // 对方确认收到了，可以不用再重发。
      if (envelope.a !== undefined) pending.delete(envelope.a)
      if (envelope.m === undefined) return

      if (envelope.n !== undefined) {
        // 回执要在去重之前发：重复到达恰恰说明上一次回执没送到，得再回一次。
        if (envelope.r) post(JSON.stringify({ a: envelope.n }))
        if (envelope.n <= lastSeen) return
        lastSeen = envelope.n
      }

      // 认不出来的消息直接丢掉，不让它把界面搞崩。
      const message = asRelayMessage(envelope.m)
      if (message) callbacks.onMessage(message)
    }

    function settle(ok: boolean, error?: Error): void {
      if (settled) return
      settled = true
      clearTimeout(firstConnect)
      if (ok) resolve({ send, flush, close })
      else {
        close()
        reject(error)
      }
    }

    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      const frame = event.data
      if (typeof frame !== 'string') return

      if (frame === PONG) {
        pingSentAt = 0
        lastPongAt = Date.now()
        return
      }
      if (frame === ROOM_OK) {
        joined = true
        callbacks.onSelfConnected(true)
        // 断线期间攒下的消息趁现在补发；重连回来的第一件事就是把欠的账还上。
        flush()
        settle(true)
        return
      }
      if (frame === PEER_JOINED) {
        callbacks.onPeerPresent(true)
        callbacks.onPeerJoined()
        return
      }
      if (frame === PEER_ONLINE) {
        callbacks.onPeerPresent(true)
        // 对方刚回来，它没收到的那些消息现在补上。
        flush()
        return
      }
      if (frame === PEER_OFFLINE) {
        callbacks.onPeerPresent(false)
        return
      }
      if (!frame.startsWith(RELAY_PREFIX)) return
      const envelope = asEnvelope(safeParse(frame.slice(RELAY_PREFIX.length)))
      if (envelope) handleEnvelope(envelope)
    })

    socket.addEventListener('close', (event) => {
      pingSentAt = 0
      if (closing) return
      callbacks.onSelfConnected(false)
      // 还没进过房就被拒，说明是业务原因（房间不存在等），直接把原因报给玩家。
      // 网络原因不在这里报错——partysocket 还在重连，交给上面的总时限兜底。
      if (BUSINESS_REJECTIONS.has(event.code)) {
        settle(false, new Error(event.reason || '连接被拒绝'))
      }
    })

    // error 事件不带任何细节（浏览器出于安全考虑不暴露），这里只用来更新链路状态，
    // 报错交给 close 和总时限，避免同一次失败报两遍。
    socket.addEventListener('error', () => {
      if (!closing) callbacks.onSelfConnected(false)
    })

    /**
     * 心跳。除了保活，更重要的作用是识破半开连接：
     * socket 还显示 OPEN、send 也不报错，但数据其实出不去，
     * 光等 TCP 自己发现要好几分钟——对局早就卡死了。
     */
    const heartbeat = setInterval(() => {
      if (socket.readyState !== socket.OPEN) return
      const now = Date.now()
      if (pingSentAt !== 0) {
        if (now - pingSentAt > PONG_TIMEOUT) {
          pingSentAt = 0
          // 用 reconnect 而不是 close：close 会把自动重连一起关掉。
          socket.reconnect(4100, '心跳超时')
        }
        return
      }
      if (now - lastPongAt >= PING_INTERVAL) {
        pingSentAt = now
        post(PING)
      }
    }, HEARTBEAT_TICK)

    const resend = setInterval(flush, RESEND_INTERVAL)

    /**
     * 切回前台时立刻探一次。
     *
     * 手机锁屏或切后台期间定时器会被浏览器节流甚至冻住，连接多半已经死了但事件还没送达。
     * 不主动探的话，玩家切回来会对着一个早就断了的连接干等。
     */
    function onVisible(): void {
      if (document.visibilityState !== 'visible') return
      if (socket.readyState === socket.OPEN) {
        pingSentAt = Date.now()
        post(PING)
      } else {
        socket.reconnect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    function close(): void {
      closing = true
      clearInterval(heartbeat)
      clearInterval(resend)
      clearTimeout(firstConnect)
      document.removeEventListener('visibilitychange', onVisible)
      socket.close()
    }
  })
}

/** 连服务器并立刻开一间自己的房，拿到房间码。连不上时 reject。 */
export async function connectRoom(): Promise<RoomHandle> {
  let code: string
  try {
    const response = await fetch(`${serverUrl()}/api/room`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    code = (await response.json()).code
  } catch (reason) {
    throw new Error(`连不上转发器（${serverUrl()}）：${(reason as Error).message}`)
  }

  const listeners: Listeners = {
    relay: new Set(),
    peerJoined: new Set(),
    linkChange: new Set(),
    linkLost: new Set(),
  }
  const handle = makeHandle(listeners, code)

  try {
    await handle.attach(code, 'host')
    return handle
  } catch (reason) {
    throw new Error(`连不上转发器（${serverUrl()}）：${(reason as Error).message}`)
  }
}

/** RoomHandle 加上一个内部方法：换一条连接。join 和首次建房都走它。 */
type InternalHandle = RoomHandle & {
  attach(code: string, role: 'host' | 'guest'): Promise<void>
}

function makeHandle(listeners: Listeners, code: string): InternalHandle {
  let link: Link | null = null

  /*
   * 链路状态。"通"要求两件事同时成立：自己连着，且对手也在房里——
   * 只有自己连着不算通，消息一样送不到对面。
   *
   * seenPeer 是为了区分"房主在大厅等人"和"对手掉线了"：前者对端也不在，
   * 但那是还没来，不该显示成重连中，更不该走宽限期把对局判死。
   */
  let selfConnected = false
  let peerPresent = false
  let seenPeer = false
  let linkUp = false
  let disposed = false
  let graceTimer: ReturnType<typeof setTimeout> | null = null

  function clearGrace(): void {
    if (graceTimer === null) return
    clearTimeout(graceTimer)
    graceTimer = null
  }

  function updateLink(): void {
    if (disposed) return
    const up = selfConnected && peerPresent
    if (up === linkUp) return
    linkUp = up
    listeners.linkChange.forEach((fn) => fn(up))
    if (up) {
      clearGrace()
      return
    }
    // 还没见过对手就断，说明是"人还没来"，不是"人掉了"，不启动宽限期。
    if (!seenPeer || graceTimer !== null) return
    graceTimer = setTimeout(() => {
      graceTimer = null
      listeners.linkLost.forEach((fn) => fn())
    }, PEER_GRACE)
  }

  /**
   * 换一条连接。首次建房和 join 别人的房都走它。
   *
   * 顺序是先连上新的、成功了才关旧的——见 join 里的说明。
   */
  async function attach(target: string, role: 'host' | 'guest'): Promise<void> {
    const next = await openLink(target, role, callbacks)
    link?.close()
    link = next
  }

  const callbacks: LinkCallbacks = {
    onMessage: (message) => listeners.relay.forEach((fn) => fn(message)),
    onPeerJoined: () => listeners.peerJoined.forEach((fn) => fn()),
    onSelfConnected: (connected) => {
      selfConnected = connected
      updateLink()
    },
    onPeerPresent: (present) => {
      if (present) seenPeer = true
      peerPresent = present
      updateLink()
    },
  }

  return {
    code,
    onPeerJoined(listener) {
      listeners.peerJoined.add(listener)
    },
    onLinkChange(listener) {
      listeners.linkChange.add(listener)
      listener(linkUp)
    },
    onLinkLost(listener) {
      listeners.linkLost.add(listener)
    },
    onRelay(listener) {
      listeners.relay.add(listener)
    },

    attach,

    async join(target) {
      // 一条连接绑定一个房间，所以进别人的房 = 换一条连接。
      //
      // 顺序很重要：**先连上目标房间，成功之后才关掉自己那条**。
      // 反过来先关的话，一旦目标房间不存在或者已满，自己那间房也跟着没了——
      // 界面上还显示着房间码，但那个码已经失效，对方再填只会被告知"房间不存在"。
      // 现在失败时自己那条连接原封不动，玩家可以改个码重试，也可以继续等人进自己的房。
      try {
        await attach(target, 'guest')
        return null
      } catch (reason) {
        // 失败原因是服务端给的中文（「房间不存在」「房间已满」），直接返回给界面显示。
        return (reason as Error).message
      }
    },

    relay(message) {
      link?.send(message, false)
    },
    relayReliable(message) {
      link?.send(message, true)
    },
    dispose() {
      disposed = true
      clearGrace()
      link?.close()
      link = null
    },
  }
}

/**
 * 对端载荷是不透明字符串，服务端从不校验，所以这里解析失败是可能的，不能让它抛出去。
 * 解析不出来就当成一条认不出的消息丢掉。
 */
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 信封只粗筛结构，里面的载荷交给 asRelayMessage 再筛一遍。 */
function asEnvelope(payload: unknown): Envelope | null {
  if (typeof payload !== 'object' || payload === null) return null
  return payload as Envelope
}
