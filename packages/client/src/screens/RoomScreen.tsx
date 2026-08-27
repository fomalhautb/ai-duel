/**
 * 匹配房：上面是自己的 4 位房间码，下面输入对方的房间码。
 *
 * 一进这个界面就先自动开一间自己的房，所以每个人手里都有一个码——
 * 谁先把码念给对方，谁就成了房主（房主是唯一跑规则的一方，见架构文档 4.2）。
 * 也就是说这个界面没有"创建/加入"的选择，读码还是输码是当场决定的。
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { STARTER_DECK } from '@ai-duel/core'
import { connectRoom } from '../net/socket'
import type { RoomHandle } from '../net/socket'
import { createHostDriver } from '../match/hostDriver'
import { createGuestDriver } from '../match/guestDriver'
import { useMatchSession } from '../match/MatchSession'

/** 服务端摇的是 4 位数字码，输入框按同样的规则校验。 */
const ROOM_CODE_PATTERN = /^\d{4}$/

export function RoomScreen() {
  const [, navigate] = useLocation()
  const session = useMatchSession()
  const [room, setRoom] = useState<RoomHandle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [joining, setJoining] = useState(false)
  /** 房间已经交给 driver 了，这个界面卸载时就别去关它的连接。 */
  const handedOff = useRef(false)

  useEffect(() => {
    handedOff.current = false
    let cancelled = false
    let handle: RoomHandle | null = null

    connectRoom()
      .then((connected) => {
        // 严格模式会把这个 effect 跑两遍，第一遍的连接在下面的 cleanup 里已经作废了。
        if (cancelled) {
          connected.dispose()
          return
        }
        handle = connected
        setRoom(connected)
        connected.onPeerJoined(() => {
          // 有人进了我的房 = 我是房主，由我来跑规则、发开局数据。
          handedOff.current = true
          session.start(
            createHostDriver({
              room: connected,
              // 卡组选择还没做，双方先用同一套示例牌组。
              setup: {
                seed: Date.now(),
                players: [
                  { name: '房主', deck: [...STARTER_DECK] },
                  { name: '挑战者', deck: [...STARTER_DECK] },
                ],
              },
            }),
          )
          navigate('/match')
        })
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })

    return () => {
      cancelled = true
      if (!handedOff.current) handle?.dispose()
    }
    // 依赖故意留空：连接只该建一次，session 和 navigate 整个生命周期都是稳定的。
  }, [])

  async function handleJoin(): Promise<void> {
    if (!room || joining) return
    if (!ROOM_CODE_PATTERN.test(input)) {
      setError('房间码是 4 位数字')
      return
    }
    if (input === room.code) {
      setError('这是你自己的房间码')
      return
    }
    setJoining(true)
    setError(null)
    const failure = await room.join(input)
    if (failure) {
      setError(failure)
      setJoining(false)
      return
    }
    // 进别人的房 = 我是客人，本地不跑规则，只发指令。
    handedOff.current = true
    session.start(createGuestDriver({ room }))
    navigate('/match')
  }

  return (
    <main className="page page--room">
      <h1>匹配房</h1>

      <section className="page__section">
        <h2>你的房间码</h2>
        <p className="room__code">{room ? room.code : '连接中…'}</p>
        <p className="page__muted">把这个码念给对方，让他填进下面的框里。对方进来后由你开局。</p>
      </section>

      <section className="page__section">
        <h2>加入对方的房间</h2>
        <input
          className="room__input"
          value={input}
          inputMode="numeric"
          maxLength={4}
          placeholder="4 位数字"
          disabled={!room || joining}
          onChange={(event) => setInput(event.target.value.replace(/\D/g, ''))}
        />
        <button type="button" disabled={!room || joining} onClick={() => void handleJoin()}>
          {joining ? '加入中…' : '加入'}
        </button>
      </section>

      {error ? <p className="page__error">{error}</p> : null}

      <button type="button" onClick={() => navigate('/')}>
        回首页
      </button>
    </main>
  )
}
