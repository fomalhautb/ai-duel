/**
 * 对局界面。只认一个 MatchDriver，不知道自己在打热座、联机还是 dev 测试房。
 *
 * 画面骨架照设计稿来：顶栏 + 左右两块纸面侧栏 + 中间战场，底部一排扇形手牌。
 * 位置和动画一律交给 GSAP 直接改 DOM（架构 5.5），React 只负责"有哪些元素、它们是什么状态"。
 *
 * 两条订阅各司其职：
 * - `useMatch` 拿快照，渲染"事件全部应用完"的结果；
 * - `useMatchEvents` 拿事件流，播过程动画（回合横幅、伤害飘字、对手打出的提示卡）。
 *   事件订阅者全局只允许一个（架构 5.2），所以整个应用里只能有这一处 useMatchEvents。
 */

import { useRef, useState, useEffect, useMemo } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { getCard, other, WEAKNESS_KINDS } from '@ai-duel/core'
import type {
  Card,
  CardId,
  CardInstance,
  Command,
  GameState,
  InstanceId,
  ModelInstance,
  PlayerState,
  WeaknessKind,
} from '@ai-duel/core'
import { useMatch, useMatchEvents } from '../match/useMatch'
import type { MatchDriver, MatchView } from '../match/driver'
import { BattleTopBar } from './BattleTopBar'
import { HandCardFace, HandFan } from './HandFan'
import type { HandCardData } from './HandFan'
import { HandDrawnFilterDefs } from './HandDrawnFilterDefs'
import { OrnateFrame } from './OrnateFrame'
import { PlaqueButton } from './PlaqueButton'
import { attachCardTilt } from './cardTilt'
import type { CardTiltHandle } from './cardTilt'
import { WEAKNESS_LABELS } from './labels'

gsap.registerPlugin(useGSAP, Flip)

/**
 * 战场小卡跟着指针倾斜的最大角度。
 *
 * 比手牌大卡（10°）大一点：小卡在屏幕上只占 110×154，同样的角度看起来位移小得多，
 * 要稍微加点量才看得出来。小卡不放大也不位移，倾斜就是它唯一的 hover 反馈。
 */
const TILE_TILT_DEG = 12
/** 对手打出的提示卡在战场中央停留多久（秒），停完淡出。 */
const PROMPT_SHOWCASE_HOLD = 1.2

export interface MatchStageProps {
  driver: MatchDriver
  /**
   * dev 测试房模式：对方手牌摊开显示真实卡面，点一下就替对方打出去（走 DEBUG_PLAY_CARD，
   * 提示卡不选目标、直击我方本体）。正式对局一律为 false，那时对方手牌只是一叠卡背。
   */
  testMode?: boolean
  /** 结算层里的按钮，由各个界面自己决定是"再来一局"还是"回首页"。 */
  resultActions?: ReactNode
}

/**
 * 正在等玩家选目标的提示卡。
 *
 * 只有本端自己出牌会进这个状态（测试房替对方出牌不选目标，见 playForFoe），
 * 所以出牌方恒为本端座位、目标恒在对方那一侧，这里只记牌是哪张。
 */
interface PendingPrompt {
  instanceId: InstanceId
}

export function MatchStage({ driver, testMode = false, resultActions }: MatchStageProps) {
  const view = useMatch(driver)

  // 还没拿到局面（联机客人在等房主开局），或者开局前就断了。
  // 下面那个组件的一整套 hook 都要求 state 存在，所以拆成两个组件而不是在中间早退。
  if (view.state === null) {
    return (
      <div className="battle battle--waiting">
        <HandDrawnFilterDefs />
        <BattleTopBar />
        <div className="battle__waiting">
          <p className="battle__waiting-text">
            {view.status === 'aborted' ? view.abortReason : '正在等房主开局…'}
          </p>
          {view.status === 'aborted' ? (
            <div className="battle__result-actions">{resultActions}</div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <BattleField
      driver={driver}
      view={view}
      state={view.state}
      testMode={testMode}
      resultActions={resultActions}
    />
  )
}

function BattleField({
  driver,
  view,
  state,
  testMode,
  resultActions,
}: {
  driver: MatchDriver
  view: MatchView
  /** 就是 view.state，由上面判过空之后传进来，省得这里到处写 ?. */
  state: GameState
  testMode: boolean
  resultActions?: ReactNode
}) {
  const mySeat = view.seat
  const foeSeat = other(mySeat)
  const me = state.players[mySeat]
  const foe = state.players[foeSeat]
  const myTurn = state.activePlayer === mySeat && state.phase === 'playing'

  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null)
  /**
   * 已经发出我方指令、还没等到新局面。
   *
   * 只有联机客人真的会停在这个状态（send 只是把指令丢给房主，要等回包）；
   * 本地和房主 driver 下 send 是同步的，下面那个 effect 当场就把它清掉，只闪一帧。
   * 它的作用是把 HandFan 的 disabled 打开，让打出去的牌按 HandFanProps 的约定
   * 停在落点上等结果，而不是被当成"父组件没受理"立刻飞回手牌。
   */
  const [awaiting, setAwaiting] = useState(false)
  /** 对手打出的提示卡，短暂展示在战场中央。key 让连打同一张卡也能重新播一遍。 */
  const [promptShow, setPromptShow] = useState<{ cardId: CardId; key: number } | null>(null)

  /**
   * 战场容器，一个 ref 三用：
   * 交给 HandFan 当拖拽落点区、当战场小卡倾斜跟随的 useGSAP scope、以及查 Flip 的落点元素。
   */
  const boardRef = useRef<HTMLDivElement>(null)
  /** 手牌上方的取消落点，只负责显示"放回手牌"的拖拽反馈。 */
  const returnZoneRef = useRef<HTMLDivElement>(null)
  /** 特效层：横幅和飘字都由 GSAP 直接往里塞节点，pointer-events: none，不参与交互。 */
  const fxRef = useRef<HTMLDivElement>(null)
  const promptShowRef = useRef<HTMLDivElement>(null)
  /** 战场上每张小卡的倾斜跟随，按 tile 元素存着（tile 上没有别的稳定标识可用）。 */
  const tiltsRef = useRef(new Map<HTMLElement, CardTiltHandle>())
  /** 松手那一刻记下的手牌位置，等 React 把 DOM 换好之后再拿它补飞行动画。 */
  const flipStateRef = useRef<{ state: Flip.FlipState; id: string } | null>(null)
  /** 对方新上场、等下一次提交后才播进场动画的模型（收到事件那一刻它的 DOM 还不存在）。 */
  const popQueueRef = useRef<InstanceId[]>([])
  /**
   * 事件回调要读最新的座位号。
   * 不能直接闭包捕获：useMatchEvents 把 handler 存在 ref 里就是为了不重新订阅
   * （重订会丢掉 driver 攒着的那批开局事件，见架构 5.2），所以这里也走 ref。
   */
  const seatRef = useRef(mySeat)
  seatRef.current = mySeat

  /**
   * 只为了拿 contextSafe：事件回调、定时回调里新建的补间必须包一层，
   * 否则不归 useGSAP 的 context 管，组件卸载时 revert 不掉，会继续去改脱离文档的节点（架构 5.5）。
   */
  const { contextSafe } = useGSAP()

  /** 局面一变就说明上一条指令有结果了（成功或被拒都会换一个新的 view 对象）。 */
  useEffect(() => {
    setAwaiting(false)
  }, [view])

  // ---------- 事件动画 ----------

  /** 中央横幅：回合交接时闪一下"你的回合"/"对方回合"。 */
  const showBanner = contextSafe((text: string) => {
    const layer = fxRef.current
    if (layer === null) return
    const node = document.createElement('div')
    node.className = 'battle__banner'
    node.textContent = text
    layer.appendChild(node)
    gsap
      .timeline({ onComplete: () => node.remove() })
      .fromTo(
        node,
        { autoAlpha: 0, scale: 0.86 },
        { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(1.6)', overwrite: 'auto' },
      )
      .to(node, { autoAlpha: 0, scale: 1.05, duration: 0.35, ease: 'power2.in' }, '+=0.75')
  })

  /** 在某个元素上方飘一个「-N」并让它抖一下。找不到元素就当没这回事。 */
  const showHit = contextSafe((selector: string, amount: number) => {
    const layer = fxRef.current
    const target = document.querySelector<HTMLElement>(selector)
    if (layer === null || target === null) return
    const rect = target.getBoundingClientRect()
    const origin = layer.getBoundingClientRect()
    const node = document.createElement('span')
    node.className = 'battle__damage'
    node.textContent = `-${amount}`
    node.style.left = `${rect.left + rect.width / 2 - origin.left}px`
    node.style.top = `${rect.top - origin.top}px`
    layer.appendChild(node)
    gsap
      .timeline({ onComplete: () => node.remove() })
      .fromTo(
        node,
        { y: 0, autoAlpha: 0, scale: 0.7 },
        { y: -44, autoAlpha: 1, scale: 1, duration: 0.32, ease: 'back.out(2)' },
      )
      .to(node, { y: -70, autoAlpha: 0, duration: 0.4, ease: 'power1.in' }, '+=0.3')
    // 抖的是倾斜层而不是 tile 本身：tile 的 transform 归 Flip 飞行管，两边写一层就是互相覆盖。
    // 玩家面板没有这一层，就直接抖它自己。
    const shaken = target.querySelector<HTMLElement>('.battle__tile-tilt') ?? target
    gsap.fromTo(
      shaken,
      { x: -5 },
      {
        x: 5,
        duration: 0.05,
        repeat: 5,
        yoyo: true,
        ease: 'none',
        overwrite: 'auto',
        // 抖完必须把 x 归零：yoyo 来回跑完最后停在 -5，留着的话这张卡会一直歪在旁边几个像素。
        //
        // 归零只能用 gsap.set，不能用 clearProps: 'x'——GSAP 清任何一个 transform 分量都会
        // 把元素整条内联 transform 删掉，连这一层上 cardTilt 正在写的 rotationX / rotationY
        // 一起清掉。指针要是正停在这张卡上，倾斜会突然弹平，而且指针不动就没有下一次
        // pointermove，再也恢复不了。gsap.set 只写 x，GSAP 的 transform 缓存会保留其余分量。
        //
        // 这个回调在 contextSafe 包住的同步执行期之外才触发，但它只是一次性写值、不新建补间，
        // 没有需要 context 回收的东西，所以不用再包一层 contextSafe。
        onComplete: () => gsap.set(shaken, { x: 0 }),
      },
    )
  })

  useMatchEvents(driver, (events) => {
    for (const event of events) {
      switch (event.type) {
        case 'TURN_STARTED':
          showBanner(event.player === seatRef.current ? '你的回合' : '对方回合')
          break
        case 'MODEL_DAMAGED':
          // 事件是在 React 提交新局面之前送到的，所以被打的那张卡即使马上就要碎，
          // 此刻 DOM 里也还在，飘字正好落在它当时的位置上。
          showHit(`[data-model-id="${CSS.escape(event.instanceId)}"]`, event.amount)
          break
        case 'PLAYER_DAMAGED':
          showHit(`[data-player="${event.player}"]`, event.amount)
          break
        case 'MODEL_DEPLOYED':
          // 我方模型走 Flip 从手牌飞过去，不要再叠一层进场动画。
          if (event.player !== seatRef.current) popQueueRef.current.push(event.model.instanceId)
          break
        case 'PROMPT_RESOLVED':
          // 对手打提示卡时画面上只有数字跳一下，根本看不出他打了什么，所以把卡面亮出来。
          if (event.player !== seatRef.current) {
            setPromptShow((current) => ({ cardId: event.cardId, key: (current?.key ?? 0) + 1 }))
          }
          break
        default:
          break
      }
    }
  })

  // 对手打出的提示卡：淡入、停一会儿、淡出，播完把 state 清掉（清掉会让这段再跑一次并直接返回）。
  useGSAP(
    () => {
      const node = promptShowRef.current
      if (promptShow === null || node === null) return
      const shownKey = promptShow.key
      gsap
        .timeline()
        .fromTo(
          node,
          { autoAlpha: 0, scale: 0.82, y: 24 },
          { autoAlpha: 1, scale: 1, y: 0, duration: 0.28, ease: 'back.out(1.6)' },
        )
        .to(
          node,
          { autoAlpha: 0, scale: 0.94, duration: 0.32, ease: 'power2.in' },
          `+=${PROMPT_SHOWCASE_HOLD}`,
        )
        // 只清掉自己这一次的展示：依赖变化时 useGSAP 默认不 revert 旧 context，
        // 对手连打两张提示卡时上一张的时间线还在跑，它到点后也会来执行这个 call。
        // 无条件 setPromptShow(null) 的话，刚开始展示的第二张会被上一条时间线提前掐掉。
        .call(() => setPromptShow((current) => (current?.key === shownKey ? null : current)))
    },
    { dependencies: [promptShow] },
  )

  // ---------- 出牌与选目标 ----------

  /** 我方指令发出去了：打开 awaiting，让 HandFan 把牌停在落点上等结果。 */
  function sendMine(command: Command): void {
    setAwaiting(true)
    driver.send(command)
  }

  /**
   * 手牌被打出（拖进战场松手，或者原地点一下）。
   *
   * 模型卡：先截 Flip 状态再发指令，牌一离开手牌就从原位飞到战场。
   * 提示卡：这一步只进入选目标态、不发指令。setPendingPrompt 会在本轮事件处理结束前
   * 同步 flush，于是 HandFan 的 disabled 当场变成 true，那张牌按 HandFanProps 的约定
   * 停在落点上等着——取消选目标时 disabled 回到 false，HandFan 自己会把它送回扇形；
   * 确认目标则发指令，牌离开手牌，什么都不用收拾。
   */
  const handlePlay = (instanceId: string) => {
    const instance = me.hand.find((item) => item.instanceId === instanceId)
    if (instance === undefined) return
    if (getCard(instance.cardId).kind === 'prompt') {
      setPendingPrompt({ instanceId })
      return
    }
    // 此刻手牌那张卡还在 DOM 里、还停在松手那一刻的位置，正好当飞行起点。
    // 查询限定在 .hand-fan 里：战场小卡用的是同一套 data-flip-id，不限定会抓错元素。
    const slot = document.querySelector(`.hand-fan [data-flip-id="${CSS.escape(instanceId)}"]`)
    flipStateRef.current = slot === null ? null : { state: Flip.getState(slot), id: instanceId }
    sendMine({ type: 'PLAY_CARD', player: mySeat, instanceId })
  }

  /** 选中了一个目标（不传 instanceId 就是打本体）。 */
  const confirmTarget = (targetInstanceId?: InstanceId) => {
    const pending = pendingPrompt
    if (pending === null) return
    setPendingPrompt(null)
    sendMine({
      type: 'PLAY_CARD',
      player: mySeat,
      instanceId: pending.instanceId,
      targetInstanceId,
    })
  }

  /**
   * 测试房里点对方手牌：不管什么卡都当场打出去，提示卡不传 targetInstanceId，
   * 按引擎语义直击我方本体。
   *
   * 刻意简化：替对方出牌只是为了快速摆局面，让它也走一遍选目标，
   * 等于在测试房里多养一条"目标在我方这一侧"的分支，而这条分支真实对局里根本不存在。
   * 选目标只留给本端真实出牌那条路，测的才是玩家真会走的流程。
   */
  const playForFoe = (instance: CardInstance) => {
    driver.send({ type: 'DEBUG_PLAY_CARD', player: foeSeat, instanceId: instance.instanceId })
  }

  // 选目标时只放行对方那一侧：出牌方恒是本端，我方的小卡和面板永远不是提示卡的目标，
  // 所以下面我方侧的 targetable 一律写死 false。
  const picking = pendingPrompt !== null
  const pendingCard = findPendingCard(me, pendingPrompt)

  /**
   * 点空白处取消选目标。
   *
   * 绑 pointerdown 而不是 click：拖着提示卡在战场上松手时，pointerup 之后浏览器还会补一发
   * click，它会一路冒泡到根节点，用 click 的话刚进入的选目标态当场就被自己取消掉。
   * 与之配套，所有自己响应 pointerdown 的元素（战场小卡、玩家面板、测试房里的对方手牌）
   * 都要 stopPropagation，否则点它们会先被这里取消。
   */
  const cancelPick = () => {
    if (pendingPrompt !== null) setPendingPrompt(null)
  }

  const handDisabled = !myTurn || picking || view.status !== 'playing' || awaiting
  const endTurnDisabled = !myTurn || picking || awaiting || view.status !== 'playing'

  /**
   * 现算的话每次渲染都是个新数组，HandFan 的 useGSAP 会跟着重跑一遍归位补间；
   * 而这个组件光是 awaiting / promptShow / pendingPrompt 变一下就要重渲染好几次，
   * 手牌根本没动却在那儿反复补间。按 me.hand 记住，手牌真换了才重建。
   */
  const handCards = useMemo(() => me.hand.map(handCardOfInstance), [me.hand])

  // ---------- 飞行与进场 ----------

  useGSAP(
    () => {
      const pending = flipStateRef.current
      if (pending !== null) {
        flipStateRef.current = null
        // 必须显式把战场上的新元素交给 Flip：不传 targets 的话它会退回用 state.targets，
        // 也就是手牌里那个已经被 React 摘掉的旧节点，补间挂在脱离文档的 div 上，
        // 战场小卡一动不动。Flip 不会自己按 data-flip-id 去全文档找新元素（架构 5.5）。
        const target = document.querySelector(
          `.battle__board [data-flip-id="${CSS.escape(pending.id)}"]`,
        )
        if (target !== null) {
          Flip.from(pending.state, {
            targets: target,
            duration: 0.65,
            ease: 'power2.inOut',
            // 用 scale 而不是 width/height，卡面里的字会跟着一起缩，看起来才像同一张卡在变小。
            scale: true,
            // 飞行途中盖住手牌；战场容器本身没有层叠上下文，所以这个层级是全局有效的。
            zIndex: 60,
          })
        }
      }

      const pops = popQueueRef.current
      if (pops.length === 0) return
      popQueueRef.current = []
      for (const id of pops) {
        const tile = boardRef.current?.querySelector<HTMLElement>(
          `[data-model-id="${CSS.escape(id)}"]`,
        )
        if (tile == null) continue
        gsap.fromTo(
          tile,
          { scale: 0.6, autoAlpha: 0 },
          { scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(1.7)', overwrite: 'auto' },
        )
      }
    },
    { dependencies: [view] },
  )

  // 战场小卡的倾斜跟随。单独开一个 useGSAP 而不是并进上面那个：
  // 那边有"没有待播的进场动画就直接 return"的早退，挂在它后面会被跳过。
  useGSAP(
    () => {
      // 只给新落到战场上的 tile 挂、只摘掉已经不在场上的，其余原样留着。
      // 不能图省事整批重挂：detach 会把倾斜和高光硬切回零，而指针很可能正停在一张
      // 早就在场上的小卡上——再打出一张牌，那张卡的倾斜就会突然弹平、高光凭空消失，
      // 指针不动就不再有 pointermove，也就再也回不来（架构 5.7）。
      //
      // 另外，依赖数组非空时 useGSAP 只在**卸载**时 revert，下面 return 的清理函数
      // 在 view 变化时根本不会跑，所以离场的 tile 必须在这里自己摘。
      const root = boardRef.current
      const tiles = root === null ? [] : root.querySelectorAll<HTMLElement>('.battle__tile')
      const alive = new Set<HTMLElement>(tiles)
      for (const tile of tiles) {
        if (tiltsRef.current.has(tile)) continue
        // 倾斜写在 tile 内层：飞行途中 tile 自己的 transform 归 Flip 管，
        // 往上面再写 rotationX 就是两边抢同一个属性。
        tiltsRef.current.set(
          tile,
          attachCardTilt(tile, { tiltLayer: '.battle__tile-tilt', maxTilt: TILE_TILT_DEG }),
        )
      }
      for (const [tile, handle] of tiltsRef.current) {
        if (alive.has(tile)) continue
        handle.detach()
        tiltsRef.current.delete(tile)
      }
      // 只有卸载会走到这里，但还是要留着：卸载时得把监听和补间一起收掉。
      return () => {
        for (const handle of tiltsRef.current.values()) handle.detach()
        tiltsRef.current.clear()
      }
    },
    { scope: boardRef, dependencies: [view] },
  )

  const finished = view.status === 'finished' || view.status === 'aborted'

  return (
    <div className="battle" onPointerDown={cancelPick}>
      <HandDrawnFilterDefs />
      <BattleTopBar />

      <div className="battle__layout">
        <aside className="battle__sidebar battle__sidebar--left" aria-label="双方状态">
          <OrnateFrame className="battle__sidebar-frame battle__sidebar-frame--players">
            <PlayerPanel player={foe} targetable={picking} onPick={() => confirmTarget()} />
            <PlayerPanel player={me} targetable={false} onPick={() => confirmTarget()} />
          </OrnateFrame>
        </aside>

        <main className={`battle__battlefield${testMode ? ' battle__battlefield--test' : ''}`}>
          <FoeHand hand={foe.hand} testMode={testMode} onPlay={playForFoe} />

          <div className="battle__board" ref={boardRef}>
            <span className="battle__drop-cue battle__drop-cue--board" aria-hidden="true">
              <strong>松手</strong>
              放到场上
            </span>

            <div className="battle__row battle__row--foe">
              {foe.board.map((model) => (
                <BoardTile
                  key={model.instanceId}
                  model={model}
                  mine={false}
                  targetable={picking}
                  onPick={() => confirmTarget(model.instanceId)}
                />
              ))}
            </div>

            <div className="battle__row battle__row--mine">
              {me.board.length === 0 ? (
                <span className="battle__board-hint">将手牌拖入战场</span>
              ) : (
                me.board.map((model) => (
                  <BoardTile
                    key={model.instanceId}
                    model={model}
                    mine
                    targetable={false}
                    onPick={() => confirmTarget(model.instanceId)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="battle__return-zone" ref={returnZoneRef} aria-hidden="true">
            <span className="battle__drop-cue battle__drop-cue--return">
              <strong>松手</strong>
              放回手牌
            </span>
          </div>

          {picking ? (
            <div className="battle__pick-hint">
              <span>选一个目标打出「{pendingCard?.name ?? '这张牌'}」</span>
              <button type="button" className="battle__pick-cancel" onClick={cancelPick}>
                取消
              </button>
            </div>
          ) : null}
          {view.lastRejection !== null ? (
            <div className="battle__reject">{view.lastRejection}</div>
          ) : null}
        </main>

        <aside className="battle__sidebar battle__sidebar--right" aria-label="回合操作">
          <OrnateFrame className="battle__sidebar-frame battle__sidebar-frame--actions">
            <div className="battle__turn">
              <span className="battle__turn-round">第 {state.turn} 回合</span>
              <span className="battle__turn-who">
                {view.status !== 'playing'
                  ? '对局结束'
                  : myTurn
                    ? '轮到你了'
                    : `${state.players[state.activePlayer].name} 行动中…`}
              </span>
            </div>
            <PlaqueButton
              disabled={endTurnDisabled}
              onClick={() => sendMine({ type: 'END_TURN', player: mySeat })}
            >
              结束回合
            </PlaqueButton>
          </OrnateFrame>
        </aside>
      </div>

      <HandFan
        cards={handCards}
        dropZoneRef={boardRef}
        returnZoneRef={returnZoneRef}
        onPlay={handlePlay}
        disabled={handDisabled}
      />

      <div className="battle__fx" ref={fxRef} aria-hidden="true">
        {promptShow !== null ? (
          <div className="battle__prompt-show" key={promptShow.key} ref={promptShowRef}>
            <HandCardFace card={handCardOfDefinition(promptShow.cardId)} />
          </div>
        ) : null}
      </div>

      {finished ? (
        <div className="battle__result">
          <p className="battle__result-title">
            {view.status === 'aborted'
              ? view.abortReason
              : state.winner === mySeat
                ? '你赢了'
                : '你输了'}
          </p>
          <div className="battle__result-actions">{resultActions}</div>
        </div>
      ) : null}
    </div>
  )
}

/** 侧栏里的一块玩家面板，同时是"打本体"的目标和 PLAYER_DAMAGED 飘字的定位锚。 */
function PlayerPanel({
  player,
  targetable,
  onPick,
}: {
  player: PlayerState
  targetable: boolean
  onPick: () => void
}) {
  return (
    <div
      className="battle__player-panel"
      data-player={player.id}
      data-targetable={targetable ? 'true' : undefined}
      // 目标一律绑 pointerdown 并挡住冒泡，原因见 cancelPick 上的说明。
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (!targetable) return
        event.stopPropagation()
        onPick()
      }}
    >
      <span className="battle__player-name">{player.name}</span>
      <span className="battle__player-integrity">{player.integrity}</span>
      <span className="battle__player-compute">
        算力 {player.compute}/{player.computeMax}
      </span>
      <span className="battle__player-piles">
        手牌 {player.hand.length} · 牌堆 {player.deck.length}
      </span>
    </div>
  )
}

/** 场上的一张小卡。三层结构：tile 管 Flip 飞行，tilt 管倾斜和裁剪，inner 是整张卡面缩小。 */
function BoardTile({
  model,
  mine,
  targetable,
  onPick,
}: {
  model: ModelInstance
  mine: boolean
  targetable: boolean
  onPick: () => void
}) {
  return (
    <div
      className="battle__tile"
      // data-model-id 全场唯一，事件层靠它定位伤害飘字和抖动。
      // data-flip-id 只给我方：它是 Flip 用来把"手牌里的旧节点"和"战场上的新节点"对号的键，
      // 对方的卡不从我的手牌飞出来，标了只是白白多一份撞车风险（这个 id 必须全局唯一）。
      data-model-id={model.instanceId}
      data-flip-id={mine ? model.instanceId : undefined}
      data-targetable={targetable ? 'true' : undefined}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (!targetable) return
        event.stopPropagation()
        onPick()
      }}
    >
      <div className="battle__tile-tilt">
        <div className="battle__tile-inner">
          <HandCardFace card={handCardOfModel(model)} />
        </div>
      </div>
    </div>
  )
}

/**
 * 对方手牌条。
 *
 * 正常模式只是一叠重叠的卡背加一个张数。本项目不防作弊（架构 4.1），
 * 客人手里其实有对手的完整手牌数据，但把它明晃晃摊在屏幕上没法玩，所以这里只画卡背。
 * 测试房里换成真实卡面并且能点，方便一个人调试双方的出牌流程。
 */
function FoeHand({
  hand,
  testMode,
  onPlay,
}: {
  hand: readonly CardInstance[]
  testMode: boolean
  onPlay: (instance: CardInstance) => void
}) {
  if (!testMode) {
    return (
      <div className="battle__foe-hand" aria-label={`对方手牌 ${hand.length} 张`}>
        <div className="battle__foe-stack">
          {hand.map((instance) => (
            <span key={instance.instanceId} className="battle__foe-back" aria-hidden="true" />
          ))}
        </div>
        <span className="battle__foe-count">{hand.length} 张</span>
      </div>
    )
  }
  return (
    <div className="battle__foe-hand battle__foe-hand--open" aria-label="对方手牌（测试房）">
      {hand.length === 0 ? <span className="battle__foe-count">对方没有手牌</span> : null}
      {hand.map((instance) => (
        <div
          key={instance.instanceId}
          className="battle__foe-card"
          title="点一下替对方打出这张牌"
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
            // 同样要挡冒泡：这一下要是传到根节点，会被当成"点空白处取消"，
            // 把我方正在进行的选目标态顺手清掉。
            event.stopPropagation()
            onPlay(instance)
          }}
        >
          <div className="battle__foe-card-inner">
            <HandCardFace card={handCardOfInstance(instance)} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 从手牌实例拼出卡面数据。id 用实例 id：Flip 和事件定位都靠它对号。 */
function handCardOfInstance(instance: CardInstance): HandCardData {
  return { ...handCardOfDefinition(instance.cardId), id: instance.instanceId }
}

/** 从卡牌定义拼出卡面数据。id 只是给 React 当 key 用，不参与 Flip。 */
function handCardOfDefinition(cardId: CardId): HandCardData {
  const card = getCard(cardId)
  if (card.kind === 'model') {
    return {
      id: card.id,
      name: card.name,
      cost: card.cost,
      kind: 'model',
      power: card.power,
      integrity: card.integrity,
      weaknesses: exposedWeaknesses(card.weaknesses),
      text: card.text,
      backText: `完整画像：${fullWeaknessText(card.weaknesses)}。对手的提示卡打中哪一维，伤害就加上这一维的数值。`,
    }
  }
  return {
    id: card.id,
    name: card.name,
    cost: card.cost,
    kind: 'prompt',
    damage: card.damage,
    targetWeakness: card.targetWeakness,
    text: card.text,
    backText: `伤害 = 基础 ${card.damage} + 目标的「${WEAKNESS_LABELS[card.targetWeakness]}」暴露度。不选模型就直击对手本体。`,
  }
}

/**
 * 从场上的模型实例拼出卡面数据。
 *
 * 数值一律读实例：受伤和增益都写在实例上，读卡牌定义的话战场小卡会永远显示满血。
 */
function handCardOfModel(model: ModelInstance): HandCardData {
  const card = getCard(model.cardId)
  return {
    id: model.instanceId,
    name: card.name,
    cost: card.cost,
    kind: 'model',
    power: model.power,
    integrity: model.integrity,
    weaknesses: exposedWeaknesses(model.weaknesses),
    text: card.text,
    // 战场小卡不翻面，这份文案没有地方会显示出来。
    backText: '',
  }
}

/** 只留下大于 0 的维度，卡面上那一行才不会被六个 0 撑满。 */
function exposedWeaknesses(profile: Record<WeaknessKind, number>): Partial<Record<WeaknessKind, number>> {
  const exposed: Partial<Record<WeaknessKind, number>> = {}
  for (const kind of WEAKNESS_KINDS) {
    if (profile[kind] > 0) exposed[kind] = profile[kind]
  }
  return exposed
}

/** 背面用的完整六维画像，0 也列出来——"打哪一维没用"同样是要读的信息。 */
function fullWeaknessText(profile: Record<WeaknessKind, number>): string {
  return WEAKNESS_KINDS.map((kind) => `${WEAKNESS_LABELS[kind]}${profile[kind]}`).join(' ')
}

/** 正在选目标的那张提示卡，用来在提示条上写卡名。它还在我方手里，没离开手牌。 */
function findPendingCard(me: PlayerState, pending: PendingPrompt | null): Card | null {
  if (pending === null) return null
  const instance = me.hand.find((item) => item.instanceId === pending.instanceId)
  return instance === undefined ? null : getCard(instance.cardId)
}
