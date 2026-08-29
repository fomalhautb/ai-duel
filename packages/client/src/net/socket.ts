/**
 * 联机通道的唯一封装：建房、进房、转发消息。用的是浏览器原生 WebSocket。
 *
 * 这一层不认识卡牌和回合，跟服务端一样只管"把 payload 送到房里的另一个人"。
 * 对局逻辑在 hostDriver / guestDriver 里。
 *
 * 服务端是 Cloudflare Worker + Durable Object（协议见 docs/deploy.md 第 4 节）：
 * - `GET /api/room` 摇一个 4 位房间码
 * - `GET /room/:code?role=host|guest` 升级成 WebSocket
 * - 服务端发下来的每一帧带一个字符前缀：`#` 是控制消息，`>` 是原样转发的对端载荷
 * - 客户端发上去的不带前缀，整条都是载荷
 */

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

/** 服务端控制消息的前缀，`#` 后面跟事件名。 */
const CONTROL_PREFIX = '#'
/** 原样转发的对端载荷的前缀，去掉这一个字符剩下的就是对方发的原文。 */
const RELAY_PREFIX = '>'

const ROOM_OK = `${CONTROL_PREFIX}room:ok`
const PEER_JOINED = `${CONTROL_PREFIX}peer:joined`
const PEER_LEFT = `${CONTROL_PREFIX}peer:left`

export interface RoomHandle {
  /** 自己这间房的房间码，给对方念的就是它。 */
  code: string
  /** 有人进了我的房 —— 也就是"我是房主"。 */
  onPeerJoined(listener: () => void): void
  /** 对方断线或退出。房主走了对局就没了（架构文档 4.2）。 */
  onPeerLeft(listener: () => void): void
  onRelay(listener: (message: RelayMessage) => void): void
  /** 加入别人的房间。成功返回 null，失败返回服务端给的原因。 */
  join(code: string): Promise<string | null>
  relay(message: RelayMessage): void
  dispose(): void
}

/** 三种监听器都放在连接之外，因为 join() 会换一条连接，而监听器要跨过这次更换活下来。 */
interface Listeners {
  relay: Set<(message: RelayMessage) => void>
  peerJoined: Set<() => void>
  peerLeft: Set<() => void>
}

/**
 * 连上一个房间，等到进房回执才算成功。
 *
 * 被拒绝的连接**也会先握手成功**再被立刻关掉（服务端只能这么做，浏览器拿不到失败握手的
 * 响应体，只拿得到 CloseEvent 上的 code 和 reason）。所以光收到 open 事件不算进房，
 * 必须等第一帧：`#room:ok` 是真进去了，close 就把 reason 当失败原因。
 *
 * reject 出来的 Error.message 就是服务端给的中文原因（比如「房间不存在」「房间已满」），
 * 上层可以直接显示给玩家。
 */
function openConnection(code: string, role: 'host' | 'guest'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase()}/room/${code}?role=${role}`)
    let settled = false

    ws.addEventListener('message', (event: MessageEvent<string>) => {
      if (settled) return
      settled = true
      if (event.data === ROOM_OK) resolve(ws)
      else reject(new Error(`进房第一帧不是回执：${String(event.data)}`))
    })

    ws.addEventListener('close', (event: CloseEvent) => {
      if (settled) return
      settled = true
      reject(new Error(event.reason || '连接被关闭'))
    })

    // error 事件不带任何细节（浏览器出于安全考虑不暴露），能给的只有"连不上"。
    // 它后面通常还会跟一个 close，settled 保证只报一次。
    ws.addEventListener('error', () => {
      if (settled) return
      settled = true
      reject(new Error('连接失败'))
    })
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

  try {
    const ws = await openConnection(code, 'host')
    return makeHandle(ws, code)
  } catch (reason) {
    throw new Error(`连不上转发器（${serverUrl()}）：${(reason as Error).message}`)
  }
}

function makeHandle(initial: WebSocket, code: string): RoomHandle {
  const listeners: Listeners = { relay: new Set(), peerJoined: new Set(), peerLeft: new Set() }
  let ws = initial

  function attach(socket: WebSocket): void {
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const frame = event.data
      if (typeof frame !== 'string') return
      if (frame.startsWith(RELAY_PREFIX)) {
        const message = asRelayMessage(safeParse(frame.slice(RELAY_PREFIX.length)))
        // 认不出来的消息直接丢掉，不让它把界面搞崩。
        if (message) listeners.relay.forEach((fn) => fn(message))
        return
      }
      if (frame === PEER_JOINED) listeners.peerJoined.forEach((fn) => fn())
      else if (frame === PEER_LEFT) listeners.peerLeft.forEach((fn) => fn())
      // 剩下的（将来新增的控制消息）同样丢掉。
    })
  }

  attach(initial)

  return {
    code,
    onPeerJoined(listener) {
      listeners.peerJoined.add(listener)
    },
    onPeerLeft(listener) {
      listeners.peerLeft.add(listener)
    },
    onRelay(listener) {
      listeners.relay.add(listener)
    },
    async join(target) {
      // 一条连接绑定一个房间，所以进别人的房 = 换一条连接。
      //
      // 顺序很重要：**先连上目标房间，成功之后才关掉自己那条**。
      // 反过来先关的话，一旦目标房间不存在或者已满，自己那间房也跟着没了——
      // 界面上还显示着房间码，但那个码已经失效，对方再填只会被告知"房间不存在"。
      // 现在失败时自己那条连接原封不动，玩家可以改个码重试，也可以继续等人进自己的房。
      //
      // 换连接的写法还顺带根治了旧转发器上必须手工提防的一个坑：那时一条连接能同时待在
      // 两个房间里，忘了退出自己那间就会转发串台、空房还占着号。现在"人在哪个房"就是
      // "连着哪条线"，进房成功的那一刻旧连接立刻关掉，不存在长期占着两间房这回事。
      try {
        const next = await openConnection(target, 'guest')
        ws.close()
        ws = next
        attach(next)
        return null
      } catch (reason) {
        // 失败原因是服务端给的中文（「房间不存在」「房间已满」），直接返回给界面显示。
        return (reason as Error).message
      }
    },
    relay(message) {
      ws.send(JSON.stringify(message))
    },
    dispose() {
      ws.close()
    },
  }
}

/**
 * 对端载荷是不透明字符串，服务端从不校验，所以这里解析失败是可能的，不能让它抛出去。
 * 解析不出来就当成一条认不出的消息丢掉（后面 asRelayMessage 收到 null 会返回 null）。
 */
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
