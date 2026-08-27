/**
 * socket.io 客户端的唯一封装：连服务器、建房、进房、转发消息。
 *
 * 这一层不认识卡牌和回合，跟服务端一样只管"把 payload 送到房里的另一个人"。
 * 对局逻辑在 hostDriver / guestDriver 里。
 */

import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { asRelayMessage } from './protocol'
import type { RelayMessage } from './protocol'

/**
 * 服务器地址。
 *
 * 默认取当前页面的主机名而不是写死 localhost：黑客松是两台电脑局域网对战，
 * 另一台是用 http://192.168.x.x:5173 打开页面的，写死 localhost 它会连到自己身上。
 * 要连别处（比如部署到公网的转发器）就设 VITE_SERVER_URL。
 */
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? `http://${window.location.hostname}:3001`

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

/** 连服务器并立刻开一间自己的房，拿到房间码。连不上时 reject。 */
export function connectRoom(): Promise<RoomHandle> {
  return new Promise((resolve, reject) => {
    const socket: Socket = io(SERVER_URL, {
      // 默认会先试 HTTP 长轮询再升级，局域网里直接上 WebSocket 更快也更少坑。
      transports: ['websocket'],
      // 失败就报错让界面显示"连不上服务器"，比无声重连转圈强。
      reconnection: false,
    })

    socket.on('connect_error', (error: Error) => {
      socket.close()
      reject(new Error(`连不上转发器（${SERVER_URL}）：${error.message}`))
    })

    socket.on('connect', () => {
      socket.emit('room:create', (code: string) => {
        resolve(makeHandle(socket, code))
      })
    })
  })
}

function makeHandle(socket: Socket, code: string): RoomHandle {
  const relayListeners = new Set<(message: RelayMessage) => void>()

  socket.on('relay', (payload: unknown) => {
    const message = asRelayMessage(payload)
    // 认不出来的消息直接丢掉，不让它把界面搞崩。
    if (message) relayListeners.forEach((fn) => fn(message))
  })

  return {
    code,
    onPeerJoined(listener) {
      socket.on('peer:joined', listener)
    },
    onPeerLeft(listener) {
      socket.on('peer:left', listener)
    },
    onRelay(listener) {
      relayListeners.add(listener)
    },
    join(target) {
      return new Promise((resolve) => {
        socket.emit('room:join', target, (error: string | null) => resolve(error))
      })
    },
    relay(message) {
      socket.emit('relay', message)
    },
    dispose() {
      socket.close()
    },
  }
}
