/**
 * 匹配房（/room）：左边是自己的 4 位房间码，右边输入对方的房间码。
 *
 * 一进这个界面就先自动开一间自己的房，所以每个人手里都有一个码——
 * 谁先把码念给对方，谁就成了房主（房主是唯一跑规则的一方，见架构文档 4.2）。
 * 也就是说这个界面没有「创建 / 加入」的选择，读码还是输码是当场决定的。
 *
 * 外观和 /hero 同源（做法见 HeroScreen.tsx 文件头）：一个 1672:941 的固定宽高比舞台塞进视口居中，
 * 舞台内所有尺寸写成 cqi（1cqi = 舞台宽的 1%），窗口怎么变都只是整体等比缩放，不写断点。
 * 背景直接复用 /hero 那张夜空图，留边底色和暗角也照抄，两页切换时画面是接得上的。
 * 根节点带 .grain（定义在 src/ui/paper/paper.css）+ .on-dark，理由同 HeroScreen。
 *
 * 画面上的装饰和边框全是切片素材（<img>），不是 CSS 画的：素材图去掉了背景和文字，
 * 文字仍然是 HTML 压在图上。切法和落位见 room.css 文件头。
 *
 * 舞台内的层叠自下而上：背景图 → 返回 / 教程 / 标题区 → 中央面板 → 两块横幅按钮 → 收尾装饰 → dev 入口。
 * 顺序完全由 JSX 的先后决定，舞台里没有一处 z-index（舞台自己那个是用来压住外层纸纹的，
 * 和内部层叠无关）。
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { STARTER_DECK } from '@ai-duel/core'
import { connectRoom } from '../net/socket'
import type { RoomHandle } from '../net/socket'
import { createHostDriver } from '../match/hostDriver'
import { createGuestDriver } from '../match/guestDriver'
import { createTestMatchDriver } from '../match/testMatch'
import { useMatchSession } from '../match/MatchSession'
import { LoadingScreen } from '../ui/LoadingScreen'
import { useAssetsReady } from '../ui/preloadAssets'
import './room.css'

gsap.registerPlugin(useGSAP)

/** 服务端摇的是 4 位数字码，输入框按同样的规则校验。 */
const ROOM_CODE_PATTERN = /^\d{4}$/

/**
 * 这一页要用到的全部图片：背景（和 /hero 共用）+ 全部 UI 切片。
 * 切片是 assets/slice-room-ui.py 从 assets/room-ui-sheet.png 切出来的，改素材要重跑那个脚本。
 *
 * 必须是模块级常量：useAssetsReady 拿它当 effect 依赖，每次渲染现拼一个新数组会让 effect 反复重跑。
 *
 * 导出是给 ui/backgroundPreload.ts 用的：后台预加载要照着同一份清单排队，
 * 两边各写一遍迟早会对不上。
 */
export const ROOM_ASSETS = [
  '/hero/hero-bg.webp',
  '/room/back-arrow.webp',
  '/room/book.webp',
  '/room/flourish-l.webp',
  '/room/flourish-r.webp',
  '/room/substar-l.webp',
  '/room/substar-r.webp',
  '/room/panel.webp',
  '/room/code-plaque.webp',
  '/room/copy-frame.webp',
  '/room/divider.webp',
  '/room/input-frame.webp',
  '/room/join-btn.webp',
  '/room/banner-deck.webp',
  '/room/banner-hero.webp',
  '/room/foot.webp',
]

/** 复制成功后按钮显示「已复制」的时长。够看清又不至于让人以为按钮卡住了。 */
const COPY_FEEDBACK_MS = 1600

/**
 * 系统的「减少动效」开关。每次现读不缓存：这个设置能在页面开着的时候改，
 * 读一次存下来就会一直沿用旧值。
 *
 * room.css 末尾那块 @media 只管得到 CSS 过渡，GSAP 写的位移得在 JS 里自己让路，所以两边都要做。
 */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 加载闸门 + 全部联机逻辑。
 *
 * 拆成两个组件而不是在一个组件里写条件渲染，理由和 HeroScreen 那道闸门一样：
 * 下面 RoomStage 的 GSAP 入场只在挂载时绑一次，必须等真实 DOM 就位再挂；
 * 同一个组件里「先渲染 loader 再切成正页」的话，入场动画会在没有 DOM 的第一帧就跑掉，之后不会再补跑。
 *
 * 连接的 effect 留在闸门这一层，而不是搬进 RoomStage：图还在下载的时候就先去开房，
 * 码能早一点拿到手，等图加载完切进正页时多半已经有码可显示了。
 * 反过来放进 RoomStage 的话，开房要等图下完才开始，白白串起来两段等待。
 */
export function RoomScreen() {
  const [, navigate] = useLocation()
  const session = useMatchSession()
  const ready = useAssetsReady(ROOM_ASSETS)
  const [room, setRoom] = useState<RoomHandle | null>(null)
  /*
   * 两种失败分开存，因为它们该显示在不同的地方：开房失败是左栏（房间码那半边）的事，
   * 加入失败是右栏（输入对方码那半边）的事。合成一个 state 的话，「连不上转发器（http://…）」
   * 这种和右栏毫无关系的消息会挂在「加入对方房间」标题底下。
   * 两者互斥：连不上时 handleJoin 会在第一行就返回，根本没机会写出加入失败。
   */
  const [connectError, setConnectError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
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
        if (!cancelled) setConnectError(reason.message)
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
      setJoinError('房间码是 4 位数字')
      return
    }
    if (input === room.code) {
      setJoinError('这是你自己的房间码')
      return
    }
    setJoining(true)
    setJoinError(null)
    const failure = await room.join(input)
    if (failure) {
      setJoinError(failure)
      setJoining(false)
      return
    }
    // 进别人的房 = 我是客人，本地不跑规则，只发指令。
    handedOff.current = true
    session.start(createGuestDriver({ room }))
    navigate('/match')
  }

  if (!ready) return <LoadingScreen />

  return (
    <RoomStage
      room={room}
      connectError={connectError}
      joinError={joinError}
      input={input}
      joining={joining}
      onInput={setInput}
      onJoin={() => void handleJoin()}
      onTestMatch={() => {
        session.start(createTestMatchDriver(), { test: true })
        navigate('/match')
      }}
    />
  )
}

type RoomStageProps = {
  room: RoomHandle | null
  /** 开房失败的原因。非空即代表连不上服务器，这一页的左半边全部改成失败态。 */
  connectError: string | null
  /** 加入对方房间失败的原因，只影响右栏。 */
  joinError: string | null
  input: string
  joining: boolean
  onInput: (value: string) => void
  onJoin: () => void
  onTestMatch: () => void
}

function RoomStage({
  room,
  connectError,
  joinError,
  input,
  joining,
  onInput,
  onJoin,
  onTestMatch,
}: RoomStageProps) {
  const [, navigate] = useLocation()
  const rootRef = useRef<HTMLDivElement>(null)
  /** 复制按钮的临时反馈态：true 时文字显示「已复制」。 */
  const [copied, setCopied] = useState(false)
  /** 复原「已复制」的定时器。存 ref 是为了连点时能重置、卸载时能清掉。 */
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current)
    }
  }, [])

  useGSAP(
    () => {
      /*
       * 入场。全部用 from 而不是在 CSS 里预设 opacity: 0：
       * 闸门保证挂载时图已经齐了，这段 JS 一挂就跑，中间不会露出「什么都没有」的一帧；
       * 反过来把初始态写进 CSS，一旦 GSAP 出问题页面就永远空着。
       *
       * 顺序照视线走一遍：顶上的三块 → 标题两侧的花饰 → 中央面板 → 两块横幅 → 底部装饰。
       * 整段压在 1s 以内：这是每次进页面都要看一遍的动画。
       *
       * 开了减少动效就整段不建：from 的终点本来就是元素的自然状态，跳过它页面直接是排好的样子，
       * 加上 .room 那段淡入接着，不会闪也不会空。
       */
      if (prefersReducedMotion()) return

      gsap
        .timeline({ defaults: { ease: 'power3.out' } })
        .from(
          ['.room__back', '.room__tutorial', '.room__head'],
          { opacity: 0, yPercent: -30, duration: 0.5, stagger: 0.08 },
          0,
        )
        // 花饰挂在舞台上而不是标题块里（理由见 room.css），所以要单独点名。
        // 起点 0.16 就是上面那三拍的最后一拍（0 / 0.08 / 0.16），花饰和它围着的
        // .room__head 同时起跑，看起来是一整块标题进场，而不是标题先到、装饰再补。
        .from(
          ['.room__flourish', '.room__substar'],
          { opacity: 0, yPercent: -30, duration: 0.5 },
          0.16,
        )
        // 面板用 yPercent 而不是 y：GSAP 的 y 不认 cqi，写百分比才和舞台缩放无关。
        .from('.room__panel', { opacity: 0, yPercent: 2, scale: 0.985, duration: 0.55 }, 0.15)
        // 位移写在横幅内部的 .room__banner-lift 上，不是横幅按钮本身：按钮上挂着
        // transition: transform（给 :active 的下压用），GSAP 每帧写行内 transform 都会被这条
        // 140ms 过渡再插一遍，缓动曲线就不是这里写的那条了。父子各管一套 transform 就不冲突
        // （同 hero.css 里 .hero__back 和箭头的分工）。
        .from('.room__banner-lift', { opacity: 0, yPercent: 8, duration: 0.5, stagger: 0.08 }, 0.3)
        // 收尾装饰只淡入不位移：它就是一条线加一颗星，位移看不出来还占一份重排。
        .from('.room__foot', { opacity: 0, duration: 0.4 }, 0.6)
    },
    { scope: rootRef },
  )

  /*
   * 复制房间码。
   *
   * navigator.clipboard 在非安全上下文（http 访问局域网 IP 这种）里根本不存在，
   * 写入也可能被浏览器拒掉。这两种情况都静默保持「复制」不变：这只是个便利按钮，
   * 码本来就明晃晃印在旁边，玩家照着念一遍即可，为它弹一条报错反而是打扰。
   */
  function handleCopy() {
    if (room === null) return
    const clipboard = navigator.clipboard
    if (!clipboard) return
    void clipboard.writeText(room.code).then(
      () => {
        setCopied(true)
        // 连点时重置计时，免得第一次的定时器提前把文字改回去。
        if (copyTimer.current !== null) clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
      },
      () => {},
    )
  }

  /** 状态行的三态：连上了在等人 / 连不上 / 还在连。码牌上的占位字跟着同一档走，两块不能各说各话。 */
  const status =
    room !== null
      ? { modifier: 'waiting', text: '等待对手加入', dot: true }
      : connectError !== null
        ? { modifier: 'failed', text: '连接失败', dot: false }
        : { modifier: 'connecting', text: '正在连接服务器…', dot: false }

  return (
    <div className="room grain on-dark" ref={rootRef}>
      <div className="room__stage">
        <img className="room__bg" src="/hero/hero-bg.webp" alt="" draggable={false} />

        {/* 图都是纯装饰（alt=""），按钮的可读名字由旁边的文字给。 */}
        <button type="button" className="room__back" onClick={() => navigate('/')}>
          <img className="room__back-arrow" src="/room/back-arrow.webp" alt="" draggable={false} />
          返回
        </button>

        {/* 新手教程页已经删掉还没重做（见 HomeScreen.tsx 文件头），所以这里只是块看得见、
            按不动的文字：做成 span 而不是 disabled 的 button，读屏不会念出「按钮不可用」，
            光标也保持默认，不做出可点的样子。title 说明为什么点不动。 */}
        <span className="room__tutorial" title="敬请期待">
          <img className="room__book" src="/room/book.webp" alt="" draggable={false} />
          新手教程
        </span>

        <div className="room__head">
          <h1 className="room__title">匹配房</h1>
          <p className="room__subtitle">邀请好友，开启对决</p>
        </div>

        <img
          className="room__flourish room__flourish--left"
          src="/room/flourish-l.webp"
          alt=""
          draggable={false}
        />
        <img
          className="room__flourish room__flourish--right"
          src="/room/flourish-r.webp"
          alt=""
          draggable={false}
        />
        <img
          className="room__substar room__substar--left"
          src="/room/substar-l.webp"
          alt=""
          draggable={false}
        />
        <img
          className="room__substar room__substar--right"
          src="/room/substar-r.webp"
          alt=""
          draggable={false}
        />

        <div className="room__panel">
          <img className="room__panel-frame" src="/room/panel.webp" alt="" draggable={false} />

          <div className="room__col room__col--host">
            <h2 className="room__col-title">你的房间码</h2>

            {/* 连不上的时候这行没有意义——根本没有码可以分享——所以整行让位给下面的失败原因。 */}
            {connectError === null ? <p className="room__hint">分享房间码，邀请好友加入</p> : null}

            <p className={`room__status room__status--${status.modifier}`}>
              {status.dot ? <span className="room__dot" aria-hidden="true" /> : null}
              {status.text}
            </p>

            {/* 连接类的报错（连不上转发器、握手失败）显示在左栏：它说的是「我的房间开不出来」，
                和右栏那个「加入对方房间」没有关系。消息里可能带一整条服务器地址，允许折行。 */}
            {connectError !== null ? <p className="room__connect-error">{connectError}</p> : null}
          </div>

          <div className="room__col room__col--join">
            <h2 className="room__col-title">加入对方房间</h2>
            <p className="room__hint">输入好友的房间码，即可加入</p>
            <p className="room__error">{joinError}</p>
          </div>

          {/* 房间码是展示块不是按钮：它没有任何点击行为，复制交给右边那颗按钮。 */}
          <div className="room__code">
            <img className="room__code-plate" src="/room/code-plaque.webp" alt="" draggable={false} />
            <span className="room__code-text">
              {room ? (
                <span className="room__code-value">{room.code}</span>
              ) : (
                <span className="room__code-pending">
                  {connectError !== null ? '未连接' : '连接中'}
                </span>
              )}
            </span>
          </div>

          <button type="button" className="room__copy" disabled={room === null} onClick={handleCopy}>
            <img className="room__copy-frame" src="/room/copy-frame.webp" alt="" draggable={false} />
            <span className="room__copy-body">
              <CopyIcon />
              <span className="room__copy-label">{copied ? '已复制' : '复制'}</span>
            </span>
          </button>

          {/* 竖向分隔，纯装饰：线、两端的箭头尖、中间的圆饰都在图里。 */}
          <img className="room__divider" src="/room/divider.webp" alt="" draggable={false} />

          {/* 用 form 而不是光挂 onClick：输入框里敲回车也能加入，不用非得去点按钮。 */}
          <form
            className="room__form"
            onSubmit={(event) => {
              event.preventDefault()
              onJoin()
            }}
          >
            {/* 输入框排在框图前面：聚焦时的金色光晕靠 .room__input:focus ~ .room__input-frame
                打到框图上，后继兄弟选择器要求图在输入框之后。 */}
            <span className="room__field">
              <input
                className="room__input"
                value={input}
                inputMode="numeric"
                maxLength={4}
                placeholder="输入 4 位房间码"
                disabled={!room || joining}
                onChange={(event) => onInput(event.target.value.replace(/\D/g, ''))}
              />
              <img
                className="room__input-frame"
                src="/room/input-frame.webp"
                alt=""
                draggable={false}
              />
            </span>

            <button type="submit" className="room__join" disabled={!room || joining}>
              <img className="room__join-plate" src="/room/join-btn.webp" alt="" draggable={false} />
              <span className="room__join-label">{joining ? '加入中…' : '加入房间'}</span>
            </button>
          </form>
        </div>

        {/*
         * 两个入口都会离开本页，于是当前这间房的连接被 cleanup 关掉；回来时重新开一间新房，
         * 码也会换一个。眼下两页都还是纯 UI demo（选卡不落盘、选英雄不进对局），
         * 换个码没有任何代价，所以先不为「保住房间」加状态。真接上对局时再说。
         *
         * .room__banner-lift 是专给 GSAP 入场用的一层：位移只写在它身上，
         * 按钮自己那份 transform 留给 :active 的下压（理由见上面入场时间线的注释）。
         * 卡背、月桂徽章、右端的「>」都画在素材里，这里只补一行文字。
         */}
        <button
          type="button"
          className="room__banner room__banner--deck"
          onClick={() => navigate('/deck')}
        >
          <span className="room__banner-lift">
            <img
              className="room__banner-art"
              src="/room/banner-deck.webp"
              alt=""
              draggable={false}
            />
            <span className="room__banner-label">选择AI卡组</span>
          </span>
        </button>

        <button
          type="button"
          className="room__banner room__banner--hero"
          onClick={() => navigate('/hero')}
        >
          <span className="room__banner-lift">
            <img
              className="room__banner-art"
              src="/room/banner-hero.webp"
              alt=""
              draggable={false}
            />
            <span className="room__banner-label">选择英雄</span>
          </span>
        </button>

        <img className="room__foot" src="/room/foot.webp" alt="" draggable={false} />

        {/* 开发期入口：一个人也能把对局界面整套跑一遍，不依赖上面的房间连接建没建起来。
            正式版不留，但现在天天要用，所以压到角落里做成一行淡字。 */}
        <button type="button" className="room__dev" onClick={onTestMatch}>
          测试房（dev）
        </button>
      </div>
    </div>
  )
}

/** 复制图标：两个错位叠放的圆角方框，就是「一份变两份」那个意思。素材图里没有这个图标，仍然自己画。 */
function CopyIcon() {
  return (
    <svg
      className="room__copy-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="7" y="2.5" width="10.5" height="10.5" rx="1.6" />
      <rect x="2.5" y="7" width="10.5" height="10.5" rx="1.6" />
    </svg>
  )
}
