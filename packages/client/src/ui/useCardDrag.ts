/**
 * 卡牌拖拽的通用内核：一台「按下 → 走过阈值起拖 → 跟着光标走 → 松手判定」的指针状态机。
 *
 * 从手牌扇形（ui/HandFan.tsx）里抽出来的，为的是卡组页那种「网格卡池把卡拖进侧栏、
 * 侧栏再把卡拖出面板」的场景能直接复用同一套手感，而不用把扇形那一堆东西也搬过去。
 * 所以这里只留了和「牌本来该摆在哪」无关的部分：位移阈值、指针捕获、
 * gsap.quickTo 跟随、拖拽姿态（转正 + 放大 DRAG_SCALE）、
 * data-dragging / data-drop-ready / data-drop-hot 这几个 DOM 标记，以及松手成功/失败的判定。
 *
 * 反过来说，布局、邻牌让位、装饰淡出、失败之后把牌送回哪里，全都由调用方在回调里做：
 * hook 不知道这张牌原本在哪，也就没法替调用方把它放回去。
 *
 * 只面向电脑浏览器 + 鼠标：走原生 pointer 事件，不做触屏和多指适配。
 */

import { useLayoutEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import gsap from 'gsap'

/**
 * 按下之后指针要走过这么多像素才算拖拽，没走到就只是一次点击。
 *
 * 4px 足够吸收按鼠标时手抖带出来的一两个像素，又不至于让人觉得"拖了半天才动"。
 */
export const DRAG_THRESHOLD = 4
/**
 * 拖拽时的放大倍数：比静置（1）大一点，好认出"这张牌被抓在手上"，
 * 又不能大到把落点区盖住——拖着的牌是要去找落点的，看不见落在哪就没法瞄准。
 */
export const DRAG_SCALE = 1.1
/**
 * 拖拽中的牌要压在同一层里所有别的牌之上。
 *
 * 1000 是照展示层那几档挑的（见 styles.css「屏幕中央的展示层」一节）：
 * 压暗遮罩 1100、展示卡的裁剪层 1101、进出展示位的飞行层 1200 都在它之上。
 * 顺序不能反过来——对手出牌的强制展示可能正好赶在手上还拖着一张牌的时候，
 * 那张牌该跟着被压暗，而不是浮在遮罩前面。
 */
export const DRAG_Z = 1000
/** 从原来的姿态切到拖拽姿态（转正 + 缩到 DRAG_SCALE）的时长。 */
export const DRAG_POSE_DUR = 0.25
/**
 * 卡牌中心追上光标的时长。
 *
 * 故意不设成 0：留一点滞后，牌才像被拽着走而不是钉在光标上。
 * 顺带还吃掉了起拖那一下的姿态突变——手牌是从 hover 的 1.9 倍缩到 1.1 倍，
 * 卡牌中心会跟着位移，交给这个缓动去追，画面上就看不到跳变。
 */
export const DRAG_FOLLOW_DUR = 0.18

/**
 * useGSAP 返回的那个 contextSafe 的签名。
 *
 * 这里自己写一份是因为 @gsap/react 没把这个类型导出来，形状必须和它一模一样，
 * 否则调用方把 useGSAP 的 contextSafe 传进来会对不上。
 */
export type ContextSafeFn = <T extends Function>(fn: T) => T

/** 一块落点区。 */
export interface CardDropZone {
  /** 区域元素。current 为 null（还没挂载、调用方没给）时这块区域当作不存在。 */
  ref: RefObject<HTMLElement | null>
  /**
   * 指针在这块区域里松手算不算成功。
   *
   * false 表示它只吃高亮、不改判定：松手照样走 onCancel。
   * 手牌的"放回手牌"提示区就是这样——它只是把取消这个结果画出来，不是第二个落点。
   * 不填按 true 算。
   */
  accepts?: boolean
  /** 这块落点的标识，给 onDrop 认人用（`zone.id === 'sidebar'`）。只有一块落点的话不用管。 */
  id?: string
}

/** 一次拖拽交给回调的信息。 */
export interface CardDragInfo {
  /** 调用方给这张牌的 id，就是 bind(id) 传进去的那个。 */
  id: string
  /** 被拖的那个 DOM 节点，也就是绑了 bind(id) 那几个事件的元素。 */
  element: HTMLElement
  /**
   * 最后一次收到的指针位置（clientX / clientY）。
   * enabled 中途变化时要靠它重算落点高亮，不用干等下一次移动。
   */
  x: number
  y: number
}

export interface UseCardDragOptions {
  /**
   * 落点区，按数组顺序判定：指针同时落在好几块里时，排在前面的那块赢。
   *
   * 拖拽期间每块都会被打上 data-drop-ready，指针进到哪块，哪块再加一个 data-drop-hot。
   */
  zones: CardDropZone[]
  /**
   * false 时抓不起牌。
   *
   * 拖到一半才变成 false 的不会把牌从手上抢走：还能继续拖，只是落点高亮会立刻全熄
   * （高亮必须和松手的实际结果一致），松手一律按取消算。
   */
  enabled?: boolean
  /**
   * useGSAP 给的 contextSafe。
   *
   * 传了的话 hook 建的补间就归调用方那个 context 管，组件卸载时能被一起 revert 掉；
   * 不传就是裸调 gsap，补间的生命周期得调用方自己想办法。
   */
  contextSafe?: ContextSafeFn
  /**
   * 把光标位置换算成写给元素的 x / y 目标值——也就是"牌中心怎么对准光标"这件事。
   *
   * 换算方式和元素的坐标原点、变换原点、放大倍数全都有关，只有调用方知道，所以必须由它给。
   * 不传就退化成"起拖那一刻的 x / y 加上指针走过的位移"，
   * 也就是原地把牌拎起来平移，网格卡池这种按文档流摆位的页面直接用它就行。
   */
  targetOf?: (clientX: number, clientY: number, drag: CardDragInfo) => { x: number; y: number }
  /**
   * 拖拽时写给 GSAP 的 scale，默认就是 DRAG_SCALE。
   *
   * 元素的盒子被预放大过的要按自己的口径折算完再传进来
   * （手牌 slot 就是这样，见 HandFan 的 slotScale）。
   */
  dragScale?: number
  /** 拖拽时写给 GSAP 的 zIndex，默认 DRAG_Z。 */
  dragZ?: number
  /**
   * 按在匹配这个选择器的元素（或它的后代）上不算抓牌。
   * 卡面上另有用途的小控件靠它让开，比如手牌的问号热区只管翻面、不该把牌抓起来。
   */
  ignoreSelector?: string
  /**
   * 这张牌现在能不能抓。用来挡住"已经打出、正在等结果"之类的牌。不传就是都能抓。
   *
   * 只在按下那一刻问一次：拖到一半才不能抓了不会把牌抢走，那种情况归 enabled 管。
   */
  canDrag?: (id: string) => boolean
  /**
   * 刚走过阈值、正式进入拖拽，**在 hook 换姿态之前**调用。
   *
   * 顺序是有讲究的：调用方在这里收拾自己的旧状态（hover 放大、倾斜跟随、装饰淡出）
   * 并重排剩下的牌，这些活都得赶在 hook 那一发 killTweensOf 之前干完，
   * 不然刚建的补间会被顺手杀掉。
   * 想在这里直接把这次拖拽掐掉（比如发现这张牌其实已经没了、或者它根本加不进去）也可以，
   * 调 endDrag 就行：hook 会发现拖拽没了、不再往下换姿态，那一发 killTweensOf 也不会跑，
   * 元素上原有的补间（比如上一次拖拽还没走完的归位）原样留着。
   */
  onDragStart?: (drag: CardDragInfo) => void
  /** 拖拽中每次指针移动都调一次，在 hook 更新完跟随和落点高亮之后。 */
  onDragMove?: (drag: CardDragInfo) => void
  /**
   * 在一块接受落点里松手了。
   *
   * 收尾（清高亮、停跟随补间）已经做完，元素就停在松手那一刻的位置，
   * 调用方常要拿这个位置当 FLIP 飞行的起点。
   */
  onDrop?: (drag: CardDragInfo, zone: CardDropZone) => void
  /**
   * 这次拖拽没成：落在接受落点之外、enabled 中途被关掉、
   * 或者被浏览器中断（切窗口、按下 Esc、指针捕获被抢走）。
   *
   * 元素同样停在松手那一刻的位置，把它送回原位是调用方的事——hook 不知道原位在哪。
   */
  onCancel?: (drag: CardDragInfo) => void
  /**
   * 按下又原地松手（没走过 DRAG_THRESHOLD），等价于点了一下这张牌。
   * enabled 为 false 时不会调。
   */
  onTap?: (id: string, drag: CardDragInfo) => void
  /**
   * enabled 为 false 时按下了这张牌，给调用方一个做「拒绝反馈」的钩子。
   *
   * 被 enabled 挡掉的按下什么都不会发生：既没有拖拽也没有 onTap，玩家点了半天没动静，
   * 分不清是"现在不能出"还是"界面卡了"。手牌就靠它做摇头加小字提示
   *（见 HandFan 的 handleLockedPress）。
   *
   * 只认这一条闸，另外两条不给：按在 ignoreSelector 上压根不是"想出这张牌"；
   * 被 canDrag 挡掉的那些同样静默，但那是调用方自己按牌况判的（手牌那边是"已经打出、
   * 正在等受理"），它想反馈的话在 canDrag 里就能做，不必绕这个钩子。
   *
   * 只是通知，调不调都不改变这次按下被忽略这个结果。
   */
  onLockedPress?: (id: string) => void
}

/** 绑到卡牌根节点上的那几个事件。 */
export interface CardDragBindings {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: () => void
  onLostPointerCapture: () => void
}

export interface CardDragHandle {
  /** 把这几个事件绑到要被拖的那个元素上（`{...bind(card.id)}`）。 */
  bind: (id: string) => CardDragBindings
  /** 当前按住的那张牌的 id，可能还没过阈值；没按住就是 null。 */
  pressedId: () => string | null
  /** 当前真正拖着的那张牌的 id（已经过了阈值）；没在拖就是 null。 */
  draggingId: () => string | null
  /**
   * 强行收掉当前这次拖拽，**不触发 onCancel**。
   *
   * 给"被拖的这张牌整个没了"用：调用方把它从列表里删掉之后，既没有原位可回，
   * 留着拖拽状态还会让松手去动一个已经不在文档里的节点。
   */
  endDrag: () => void
  /**
   * 按最后一次指针位置重算落点高亮。
   * enabled 变化时 hook 自己会调；调用方那边还有别的东西会改变判定结果时也可以手动调。
   */
  refreshZones: () => void
}

/** 一次拖拽的全部状态。按下时就建，但此刻 active 还是 false——没过阈值的话它只是"按住"。 */
interface DragState extends CardDragInfo {
  /** 只认这一个指针的后续事件，别的指针（多按键、第二根手指）一律不管。 */
  pointerId: number
  /** 按下时的指针位置，用来量有没有走过 DRAG_THRESHOLD。 */
  originX: number
  originY: number
  /** 过了阈值才为 true。只有 true 的拖拽才有松手后的成功/失败。 */
  active: boolean
  /**
   * hook 是不是已经接管这个元素的补间（清场 + 换姿态 + 建跟随）。
   *
   * 和 active 分开记，是因为 onDragStart 正好跑在这两件事中间：调用方在那里调 endDrag
   * 掐掉这次拖拽时，active 已经是 true，而 hook 一条补间都还没建，元素上跑的仍然是调用方
   * 自己的补间（卡组页那边是上一次拖拽还没走完的归位）。拿 active 当判据就会把它杀掉，
   * 归位补间的 onComplete 收尾也跟着不跑，卡会永久停在半路。
   */
  owned: boolean
  /** 起拖那一刻元素的 x / y，只有没给 targetOf、走默认位移跟随时才有意义。 */
  baseX: number
  baseY: number
  /** gsap.quickTo 出来的跟随函数，进入拖拽时才建。 */
  moveX: ((value: number) => void) | null
  moveY: ((value: number) => void) | null
}

export function useCardDrag(options: UseCardDragOptions): CardDragHandle {
  /** 当前这次拖拽；没在拖就是 null。放 ref 是因为拖动过程中一次都不该重渲染。 */
  const dragRef = useRef<DragState | null>(null)
  /**
   * 最新一次渲染传进来的 options。
   *
   * 一次拖拽会横跨好几次渲染（起拖、跟随、松手、兜底收尾），闭包里抓到的旧值会过期，
   * 尤其是 enabled——它常常正好是在拖拽途中被翻掉的。
   * 在渲染期间赋值而不是放进 effect：refreshZones 会被调用方在自己的 layout effect 里调，
   * 那时必须已经读得到这一帧的 enabled。
   */
  const optionsRef = useRef(options)
  optionsRef.current = options

  const contextSafe = options.contextSafe
  const wrap = <T extends Function>(fn: T): T => (contextSafe === undefined ? fn : contextSafe(fn))

  /** 指针是不是落在某块区域里。每次移动现算：读一次 rect 的开销比缓存失效的坑小得多。 */
  const isInsideZone = (zone: CardDropZone, clientX: number, clientY: number) => {
    const el = zone.ref.current
    if (el === null || el === undefined) return false
    const rect = el.getBoundingClientRect()
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    )
  }

  /**
   * 指针落在哪块落点里。
   *
   * 判定用的是指针坐标落没落进矩形，不是卡牌和它相交，这样"卡画得多大、歪多少"
   * 都不影响落点，和炉石一致。重叠时按数组顺序取第一块命中的。
   */
  const zoneAt = (clientX: number, clientY: number): CardDropZone | null => {
    for (const zone of optionsRef.current.zones) {
      if (isInsideZone(zone, clientX, clientY)) return zone
    }
    return null
  }

  /**
   * 两级高亮，打在落点元素身上（样式由调用方写）：
   * data-drop-ready = 手上正拖着一张牌，data-drop-hot = 指针已经进到这块区域里。
   *
   * 不接受落点的区域（accepts: false）一样吃这两个标记：它们描述的是"现在松手会发生什么"，
   * 只不过那边的结果叫取消。
   */
  const markZones = (ready: boolean, hot: CardDropZone | null) => {
    for (const zone of optionsRef.current.zones) {
      const el = zone.ref.current
      if (el === null || el === undefined) continue
      if (ready) el.dataset.dropReady = 'true'
      else delete el.dataset.dropReady
      if (zone === hot) el.dataset.dropHot = 'true'
      else delete el.dataset.dropHot
    }
  }

  const refreshZones = () => {
    const drag = dragRef.current
    if (drag === null || !drag.active) return
    // enabled 关着的时候松手一律按取消算，那就一点都别亮：亮成 hot 却什么都不会发生，
    // 等于骗玩家"现在松手就成了"，牌却直接飞回去。
    const enabled = optionsRef.current.enabled !== false
    markZones(enabled, enabled ? zoneAt(drag.x, drag.y) : null)
  }

  /**
   * 收掉拖拽状态：停跟随补间、清高亮、清 dragRef，返回刚才那次拖拽。
   *
   * 跟随补间必须在这里停掉，牌才会停在松手那一刻的位置——
   * 成功时调用方要拿这个位置当 FLIP 的起点，失败时归位补间也要从这里接着走。
   */
  const endDrag = (): DragState | null => {
    const drag = dragRef.current
    if (drag === null) return null
    dragRef.current = null
    markZones(false, null)
    // 用 drag.element 而不是让调用方再查一遍：最需要收尾的那条路径（拖到一半这张牌
    // 被调用方从列表里拿掉了）上，节点这一帧已经从 DOM 里摘走、调用方的登记表里也没了，
    // 查出来是空，跟随补间就会一直挂在脱离文档的节点上。
    delete drag.element.dataset.dragging
    // hook 还没接管这张牌的话，它身上跑的是别人的补间（手牌那边是 hover 放大，
    // 卡组页是上一次拖拽的归位），不能顺手杀掉。判据是 owned 不是 active，理由见那里。
    if (drag.owned) gsap.killTweensOf(drag.element)
    return drag
  }

  /** 真正进入拖拽：让调用方先收拾旧状态，然后换姿态、接管跟随。 */
  const beginDrag = (drag: DragState) => {
    const element = drag.element
    const opts = optionsRef.current
    drag.active = true
    // 默认跟随（没给 targetOf）要拿起拖这一刻的位置当基准，所以得赶在调用方动手之前读。
    if (opts.targetOf === undefined) {
      drag.baseX = Number(gsap.getProperty(element, 'x'))
      drag.baseY = Number(gsap.getProperty(element, 'y'))
    }
    opts.onDragStart?.(drag)
    // 调用方可能在 onDragStart 里就把这次拖拽收了，那下面的姿态和跟随都不该再建。
    if (dragRef.current !== drag) return

    drag.owned = true
    gsap.killTweensOf(element)
    // 顺手把 opacity 补满：上面是无差别全杀，牌进场那条 opacity 0→1 的补间也在里面，
    // 抓住一张正在淡入的牌却不补，这张牌就会永久停在半透明。
    gsap.set(element, { zIndex: opts.dragZ ?? DRAG_Z, opacity: 1 })
    // 只是给调用方一个换光标（"握拳"）之类的钩子，样式全在 CSS 里。
    element.dataset.dragging = 'true'

    // 跟随只动 x / y，姿态只动 rotation / scale，两组补间属性不重叠，可以同时跑。
    drag.moveX = gsap.quickTo(element, 'x', { duration: DRAG_FOLLOW_DUR, ease: 'power3.out' })
    drag.moveY = gsap.quickTo(element, 'y', { duration: DRAG_FOLLOW_DUR, ease: 'power3.out' })
    gsap.to(element, {
      rotation: 0,
      scale: opts.dragScale ?? DRAG_SCALE,
      duration: DRAG_POSE_DUR,
      ease: 'power2.out',
      overwrite: 'auto',
    })

    // 按下之后、走够阈值之前 enabled 有可能被翻掉，那就一开始就别亮。
    refreshZones()
  }

  const handlePointerDown = wrap((id: string, event: ReactPointerEvent<HTMLElement>) => {
    const opts = optionsRef.current
    // 只认鼠标主键：中键、右键、以及多指里的副指针都不该把牌抓起来。
    if (!event.isPrimary || event.button !== 0) return
    // 这道闸要排在 enabled 前面：按在卡面上另有用途的小控件（手牌的问号热区）上不是
    // "想出这张牌"，锁着的时候也就不该触发下面那记拒绝反馈。
    // 挪到最前面不影响原来的行为——它和 enabled / canDrag 三条闸的结果都是同一个"直接返回"。
    if (
      opts.ignoreSelector !== undefined &&
      (event.target as HTMLElement).closest(opts.ignoreSelector) !== null
    ) {
      return
    }
    if (opts.enabled === false) {
      opts.onLockedPress?.(id)
      return
    }
    if (opts.canDrag !== undefined && !opts.canDrag(id)) return
    // 挡掉浏览器默认的文字选中和图片拖拽，不然拖到一半会拖出一片蓝色选区。
    event.preventDefault()
    dragRef.current = {
      id,
      element: event.currentTarget,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      owned: false,
      baseX: 0,
      baseY: 0,
      moveX: null,
      moveY: null,
    }
    // 立刻捕获指针：后面就算光标跑出卡面（拖拽时必然会），move / up 也还是发到这张牌上。
    event.currentTarget.setPointerCapture(event.pointerId)
  })

  const handlePointerMove = wrap((id: string, event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.id !== id || drag.pointerId !== event.pointerId) return
    drag.x = event.clientX
    drag.y = event.clientY
    if (!drag.active) {
      const dx = event.clientX - drag.originX
      const dy = event.clientY - drag.originY
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      beginDrag(drag)
      // 调用方在 onDragStart 里把这次拖拽收掉了（见 beginDrag），跟随函数根本没建起来。
      if (dragRef.current !== drag) return
    }
    const opts = optionsRef.current
    const target =
      opts.targetOf === undefined
        ? {
            x: drag.baseX + (event.clientX - drag.originX),
            y: drag.baseY + (event.clientY - drag.originY),
          }
        : opts.targetOf(event.clientX, event.clientY, drag)
    drag.moveX?.(target.x)
    drag.moveY?.(target.y)
    refreshZones()
    opts.onDragMove?.(drag)
  })

  const handlePointerUp = wrap((id: string, event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.id !== id || drag.pointerId !== event.pointerId) return
    const opts = optionsRef.current
    const enabled = opts.enabled !== false
    const wasActive = drag.active
    // 松手位置也记进 drag：下面几个回调拿到的就是这一刻的坐标，而不是最后一次移动时的。
    drag.x = event.clientX
    drag.y = event.clientY
    const zone = zoneAt(event.clientX, event.clientY)
    endDrag()
    // 没过阈值就是原地点了一下。这时元素还停在按下之前的位置，没挪过，也就谈不上归位。
    if (!wasActive) {
      if (enabled) opts.onTap?.(id, drag)
      return
    }
    // 落在别处、落进只吃高亮的区域、或者拖到一半被关掉 enabled，都是取消。
    if (!enabled || zone === null || zone.accepts === false) {
      opts.onCancel?.(drag)
      return
    }
    opts.onDrop?.(drag, zone)
  })

  /**
   * 拖拽被浏览器中断（切窗口、按下 Esc、指针捕获被抢走）时的收尾，一律按取消处理。
   *
   * 正常松手时 lostpointercapture 也会来一发，但那时 pointerup 已经把 dragRef 清空了，
   * 这里就是个空转，不会重复归位。
   */
  const handlePointerAbort = wrap((id: string) => {
    const drag = dragRef.current
    if (drag === null || drag.id !== id) return
    const wasActive = drag.active
    endDrag()
    if (wasActive) optionsRef.current.onCancel?.(drag)
  })

  // enabled 一变就立刻重算高亮，不能干等玩家下一次移动指针：
  // 高亮必须随时和"现在松手会发生什么"对得上。
  // refreshZones 每次渲染都是新函数，但它读到的全是 ref，所以不进依赖数组。
  useLayoutEffect(() => {
    refreshZones()
  }, [options.enabled])

  // 拖到一半组件被卸载也要收尾：落点区是调用方（往往还是它的父层）的元素，
  // 卡牌没了它还在，高亮不清掉就会永远亮着。
  useLayoutEffect(() => {
    return () => {
      endDrag()
    }
  }, [])

  const bind = (id: string): CardDragBindings => ({
    onPointerDown: (event) => handlePointerDown(id, event),
    onPointerMove: (event) => handlePointerMove(id, event),
    onPointerUp: (event) => handlePointerUp(id, event),
    onPointerCancel: () => handlePointerAbort(id),
    onLostPointerCapture: () => handlePointerAbort(id),
  })

  return {
    bind,
    pressedId: () => dragRef.current?.id ?? null,
    draggingId: () => (dragRef.current?.active === true ? dragRef.current.id : null),
    endDrag: () => {
      endDrag()
    },
    refreshZones,
  }
}
