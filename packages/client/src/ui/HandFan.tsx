/**
 * 炉石式扇形手牌：纯 DOM + GSAP，没有画布。
 *
 * 组件只管"一排牌怎么摆、怎么 hover、怎么拖"，不关心牌从哪来、打出去之后发生什么。
 * 出牌有两条路：把牌拖进 dropZoneRef 指的那块区域再松手，或者直接点一下
 * （按下、原地松手，没有拖动过阈值）——两条路殊途同归，都在松手那一刻喊一声 onPlay，
 * 组件自己不区分是哪种触发的。打出的卡要飞到哪个容器由父组件决定
 * （见 HandDemo 里的 Flip 用法），因为跨容器的 FLIP 必须由同时看得见
 * "手牌"和"战场"的那一层来做。
 *
 * 只面向电脑浏览器 + 鼠标：拖拽走原生 pointer 事件，不做触屏和多指适配。
 *
 * 一张牌的 transform 拆成三层，每层只管一件事（详见下面 JSX 里的注释）：
 * slot 管扇形摆位和拖拽跟随（x / y / rotation / scale），
 * .hand-fan__tilt 管跟着指针的三维倾斜（rotationX / rotationY），
 * .hand-fan__inner 管翻到背面的 3D 翻转（rotationY 180°）。
 *
 * 扇形的布局数学（fanTransform 和那一批常量）在 ui/fanMath.ts，翻面在 ui/flipCard.ts——
 * 两样都和对手的倒扇形 OpponentFan / 强制展示层共用，不要在这里另抄一份。
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { placeholderArtFor } from './cardArt'
import { attachCardTilt } from './cardTilt'
import type { CardTiltHandle } from './cardTilt'
import { flipTo } from './flipCard'
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  LAYOUT_DUR,
  MAX_SPREAD_DEG,
  PLAYER_FAN,
  fanTransform,
} from './fanMath'

gsap.registerPlugin(useGSAP)

/**
 * 一张手牌的展示数据。
 *
 * 字段照着 core 的 Card 取名，将来接真对局时可以直接从 Card + CardInstance 拼出来；
 * power/integrity 只有模型卡有，damage 只有提示卡有，所以都是可选的。
 *
 * 注意这里还缺核心机制要用的两项：模型卡的六维弱点画像（ModelCard.weaknesses）
 * 和提示卡的目标维度（PromptCard.targetWeakness）。卡面上现在也没有给它们留版面，
 * 接真对局时得先扩字段、再重排卡面，不是加两个 props 就完事。
 * （在此之前，这两项由图鉴页 /card 列在卡面外面，见 dev/CardGallery.tsx。）
 * backText 是演示用的占位文案，core 里没有对应字段。
 */
export interface HandCardData {
  id: string
  name: string
  cost: number
  kind: 'model' | 'prompt'
  power?: number
  integrity?: number
  damage?: number
  /** 卡面正面的描述文案。 */
  text: string
  /** 翻到背面时展示的补充说明。 */
  backText: string
  /** 卡面插画的图片地址。不填就按 id 稳定地分一张占位图（见 ui/cardArt.ts）。 */
  art?: string
}

export interface HandFanProps {
  cards: HandCardData[]
  /**
   * 落点区（战场容器）。指针在它的矩形范围里松手才算打出，其他任何位置都是取消。
   *
   * 判定用的是指针坐标落没落进这个矩形，不是卡牌和它相交，
   * 这样"卡画得多大、歪多少"都不影响落点，和炉石一致。
   * current 为 null（还没挂载、父组件没给）时一切落点都不成立，拖出去只会飞回手牌。
   */
  dropZoneRef: RefObject<HTMLElement | null>
  /**
   * 可选的取消落点，只负责给“放回手牌”之类的 UI 打高亮，不改变拖拽规则：
   * 只要没落进 dropZoneRef，卡牌仍然都会回到手牌。
   *
   * 拖拽期间会和战场一样收到 data-drop-ready / data-drop-hot，父组件可以据此显示提示。
   */
  returnZoneRef?: RefObject<HTMLElement | null>
  /**
   * 玩家打出了某张牌（拖进落点区松手，或者原地点一下）。父组件负责把这张牌从手牌里移走。
   *
   * 同步受理（当场改手牌数组）的话最省心：这张牌立刻从 DOM 里消失，什么都不用管。
   *
   * 要等网络回包再决定的话，必须在 onPlay 里**同步**把 disabled 打开：
   * HandFan 分不清"父组件当场拒了"和"父组件在等回包"，只能看 disabled——
   * disabled 是关的，下一帧牌还在手牌里就按拒绝算，牌会飞回扇形；
   * disabled 是开的就让牌停在落点上等，等 disabled 关掉时再看这张牌走没走：
   * 走了就是打出成功，还在就按拒绝算，这时才送回扇形。
   * 等回包那段空窗里的重复打出由 disabled 挡，HandFan 自己挡不住。
   */
  onPlay: (id: string) => void
  /**
   * 为 true 时拖不出牌（比如不是自己的回合、正在等对方确认），但仍然可以 hover 看牌。
   *
   * 拖到一半才变成 true 的话不会把牌从手上抢走：还能继续拖，只是落点区的高亮会立刻熄掉
   * （高亮必须和松手的实际结果一致），松手一律按取消算。
   */
  disabled?: boolean
}

/**
 * hover 时卡底仍然留在视口下方 6px。
 *
 * 这 6px 是防抖动的安全余量：back 缓动会冲过目标位再弹回来，
 * 冲过头的那一瞬间卡底会比目标位再高几个像素，留出余量才能保证卡底始终在视口外。
 */
const HOVER_BOTTOM = 6
/**
 * 放大倍数的下限，由扇形最大倾角和卡面尺寸算出来，不是拍脑袋定的。
 *
 * 以底边中点为轴、倾斜 θ 的卡牌，最远的那个上角横向伸到
 * (卡宽/2)·cos θ + 卡高·sin θ。放大后的卡半宽必须够到这个距离，
 * 否则扇形两端那张牌的外上角会露在放大后的卡外面（40° 时露出约 11px，
 * 而且这一块正好在视口里）。指针停在那一小块上就会
 * 「放大 → 指针掉到卡外 → 缩回 → 又被 hover 到」无限循环，
 * LEAVE_DELAY_MS 只挡得住扫过去又折返的指针，挡不住停着不动的。
 * 写成公式而不是常数，是为了改 MAX_SPREAD_DEG 时不用手工重新对表。
 */
const MAX_TILT_RAD = ((MAX_SPREAD_DEG / 2) * Math.PI) / 180
const MIN_HOVER_SCALE =
  ((CARD_WIDTH / 2) * Math.cos(MAX_TILT_RAD) + CARD_HEIGHT * Math.sin(MAX_TILT_RAD)) / (CARD_WIDTH / 2)
/** hover 放大的倍数：想要 1.75，但不能低于上面那条几何下限（40° 时下限约 1.9）。 */
const HOVER_SCALE = Math.max(1.75, MIN_HOVER_SCALE)
/**
 * 邻牌让位之后，和放大的那张牌之间还要留出的横向余量。
 *
 * 纯观感：卡边贴着卡边擦过去像是"差点撞上"，留出几个像素才看得出是主动让开的。
 */
const NEIGHBOR_CLEARANCE = 8
/** hover 进出的时长，要比重排更干脆。 */
const HOVER_DUR = 0.28
/**
 * 指针离开卡牌后延迟这么久才缩回去。
 *
 * 几何上放大后的卡已经盖住了自己原来的位置（见 fanTransform 上方的说明），
 * 但补间途中卡还没长到最大，卡角附近会短暂空出几个像素。
 * 这点延迟让"扫过空档又立刻回来"的指针不会触发一次缩放，肉眼察觉不到延迟。
 */
const LEAVE_DELAY_MS = 50
/**
 * 放大后的卡跟着指针倾斜的最大角度。
 *
 * 只给放大的那张牌用。扇形里的小卡本身就是斜的（最多 MAX_SPREAD_DEG / 2），
 * 再叠一层三维倾斜看着就是一团乱，所以那时候不启用（见 attachCardTilt 的 enabled）。
 * 10° 是看着调出来的：再小几乎看不出"卡在跟着手动"，再大卡面的透视就开始明显变形。
 */
const HOVER_TILT_DEG = 10

/**
 * 按下之后指针要走过这么多像素才算拖拽，没走到就只是一次点击。
 *
 * 4px 足够吸收按鼠标时手抖带出来的一两个像素，又不至于让人觉得"拖了半天才动"。
 */
const DRAG_THRESHOLD = 4
/**
 * 拖拽时的放大倍数：比静置（1）大一点，好认出"这张牌被抓在手上"，
 * 又远小于 hover 的 1.9 倍——拖着的牌是要去找落点的，太大会把战场盖住看不见落在哪。
 */
const DRAG_SCALE = 1.1
/** 拖拽中的牌要压在所有手牌之上，也压过 hover 用的 999。 */
const DRAG_Z = 1000
/** 从 hover 姿态切到拖拽姿态（转正 + 缩到 DRAG_SCALE）的时长。 */
const DRAG_POSE_DUR = 0.25
/**
 * 卡牌中心追上光标的时长。
 *
 * 故意不设成 0：留一点滞后，牌才像被拽着走而不是钉在光标上。
 * 顺带还吃掉了 dragStart 那一下的姿态突变——从 1.9 倍缩到 1.1 倍会让卡牌中心位移，
 * 交给这个缓动去追，画面上就看不到跳变。
 */
const DRAG_FOLLOW_DUR = 0.18

/** hover 引起的补间要更快，重排则用统一的慢一点的节奏。 */
type LayoutMode = 'hover' | 'reflow'

/**
 * 一次拖拽的全部状态。
 *
 * 按下时就建，但此刻 active 还是 false——没过阈值的话它只是"按住"，松手什么都不做。
 */
interface DragState {
  id: string
  /**
   * 这张牌的 DOM 节点，按下时就存下来。
   * 不能等到收尾时再去 slotsRef 里查：拖到一半被父组件从 cards 里拿掉的话，
   * React 在 commit 阶段就把 slotsRef 里的记录删了，那时查不到节点，补间也就停不掉。
   */
  slot: HTMLDivElement
  /** 只认这一个指针的后续事件，别的指针（多按键、第二根手指）一律不管。 */
  pointerId: number
  /** 按下时的指针位置，用来量有没有走过 DRAG_THRESHOLD。 */
  originX: number
  originY: number
  /** 最后一次收到的指针位置。disabled 中途变化时要靠它重算落点区高亮，不用等下一次移动。 */
  lastX: number
  lastY: number
  /** 过了阈值才为 true。只有 true 的拖拽才会改布局、才有松手后的打出/取消。 */
  active: boolean
  /** gsap.quickTo 出来的跟随函数，进入拖拽时才建。 */
  moveX: ((value: number) => void) | null
  moveY: ((value: number) => void) | null
}

/**
 * 算出 hover 某张牌时，其余每张牌要横向让开多少（下标和 laid 一致，正数向右）。
 *
 * 让位幅度是"刚好挪出放大卡的轮廓"算出来的，不是按距离衰减的固定值：
 * 放大卡以底边中点为轴放大，横向半宽就是 CARD_WIDTH / 2 * HOVER_SCALE；
 * 邻牌是斜的，朝放大卡那一侧伸得最远的是**底边**那个角，伸出 (CARD_WIDTH / 2) * cos(倾角)
 * （上面那个角被旋转甩向了扇形外侧，够不到中间来）。两者加上余量不重叠，就是下面的式子。
 *
 * 关键是从 hover 卡往外一张张推，每张牌至少要让开和内侧那张一样多（Math.max / Math.min 那一步）：
 * 只按各自的需求算的话，被推开的内侧牌会直接怼到外侧牌身上叠成一坨。
 * 这样整侧牌是"被推着走"的，彼此间距不变，越靠外让得越少，够远的牌一动不动。
 */
function neighborPushes(hoverIndex: number, count: number, viewportWidth: number): number[] {
  const pushes = new Array<number>(count).fill(0)
  if (hoverIndex < 0) return pushes

  const hovered = fanTransform(hoverIndex, count, viewportWidth, PLAYER_FAN)
  const half = (CARD_WIDTH / 2) * HOVER_SCALE + NEIGHBOR_CLEARANCE
  // 一张牌朝扇形中间伸出多远：底边那个角，随倾角变小。
  const reachOf = (index: number) =>
    (CARD_WIDTH / 2) *
    Math.cos((fanTransform(index, count, viewportWidth, PLAYER_FAN).rotation * Math.PI) / 180)

  let carry = 0
  for (let i = hoverIndex - 1; i >= 0; i -= 1) {
    const base = fanTransform(i, count, viewportWidth, PLAYER_FAN)
    carry = Math.min(carry, hovered.x - half - reachOf(i) - base.x)
    pushes[i] = carry
  }
  carry = 0
  for (let i = hoverIndex + 1; i < count; i += 1) {
    const base = fanTransform(i, count, viewportWidth, PLAYER_FAN)
    carry = Math.max(carry, hovered.x + half + reachOf(i) - base.x)
    pushes[i] = carry
  }
  return pushes
}

export function HandFan({
  cards,
  dropZoneRef,
  returnZoneRef,
  onPlay,
  disabled = false,
}: HandFanProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef(new Map<string, HTMLDivElement>())
  /** 当前被 hover 的牌。放在 ref 里而不是 state，避免每次移入移出都重渲染整排手牌。 */
  const hoverRef = useRef<string | null>(null)
  /** 已经摆过位置的牌；不在这里面的是新加入的，要先放到起始位再补间进场。 */
  const placedRef = useRef(new Set<string>())
  /**
   * 已经打出、正在等父组件移走的牌，用来防重复。
   *
   * 三种情况才删记录：这张牌真的离开了 cards（打出成功）、下一帧发现父组件当场就没受理、
   * 以及父组件等回包用的 disabled 关掉时这张牌还在手牌里（回包是拒绝）。
   */
  const playedRef = useRef(new Set<string>())
  const leaveTimerRef = useRef<number | null>(null)
  /** 每张牌的倾斜跟随，按 id 存着，抓起牌时要单独叫它归零。 */
  const tiltsRef = useRef(new Map<string, CardTiltHandle>())
  /** 当前这次拖拽；没在拖就是 null。同样放 ref，拖动过程中一次都不该重渲染。 */
  const dragRef = useRef<DragState | null>(null)
  /**
   * 最新的 disabled。松手那一帧的 rAF 回调只能读它：
   * 闭包里的 disabled 是松手那一刻的旧值，而父组件恰恰是在 onPlay 里才把它打开的。
   */
  const disabledRef = useRef(disabled)
  /** 给 resize 监听和延迟回位用：它们要拿到最新一次渲染的布局函数。 */
  const layoutRef = useRef<(mode: LayoutMode) => void>(() => {})

  const innerOf = (id: string) =>
    slotsRef.current.get(id)?.querySelector<HTMLElement>('.hand-fan__inner') ?? null
  /**
   * 问号的全部零件：一个透明热区（.hand-fan__help，只管交互）
   * 加正反两面各一个的问号圆圈（.hand-fan__help-mark，只管样子）。
   * 它们必须一起淡入淡出，否则会出现"看得见问号但点不动"或者反过来的错位。
   */
  const helpPartsOf = (id: string): HTMLElement[] => {
    const slot = slotsRef.current.get(id)
    if (!slot) return []
    return Array.from(slot.querySelectorAll<HTMLElement>('.hand-fan__help, .hand-fan__help-mark'))
  }

  /**
   * 把每张牌补间到它当前应该在的位置（基准位、被推开的位、或者放大的 hover 位）。
   *
   * 正在拖的那张牌不参与排布：它的 transform 和 zIndex 全归拖拽逻辑管，
   * 布局连碰都不能碰，否则跟随光标的补间会被布局补间抢走。
   */
  const applyLayout = (mode: LayoutMode) => {
    // 扇形锚点 .hand-fan 是 fixed + width: 100%，宽度就是初始包含块的宽（不含滚动条），
    // 和 dragTargetOf 用同一个口径，别混用 innerWidth。
    const viewportWidth = document.documentElement.clientWidth
    const ids = new Set(cards.map((card) => card.id))

    if (mode === 'reflow') {
      // 拖着的牌被父组件从 cards 里拿掉了（demo 的滑杆从末尾砍牌就可能正好砍掉它）：
      // 它的 DOM 节点这一帧已经没了，再留着拖拽状态，松手时就会去动一个不存在的节点。
      if (dragRef.current !== null && !ids.has(dragRef.current.id)) endDrag()
      // 只清理"已经不在手牌里"的记录。hover 期间调用得太频繁，不该顺手改这些状态。
      // 注意 reflow 也会被 resize 触发，所以这里不能把整份记录一股脑清空：
      // 拖一下窗口就把防重复的记录抹掉，同一张牌会被打出两次。
      if (hoverRef.current !== null && !ids.has(hoverRef.current)) hoverRef.current = null
      for (const id of placedRef.current) if (!ids.has(id)) placedRef.current.delete(id)
      for (const id of playedRef.current) if (!ids.has(id)) playedRef.current.delete(id)
    }

    // 拖出来的牌从队里摘掉，剩下的按"少了一张"重算扇形，手牌会自己合拢（炉石就是这样）。
    const draggingId = dragRef.current?.active === true ? dragRef.current.id : null
    const laid = draggingId === null ? cards : cards.filter((card) => card.id !== draggingId)
    const count = laid.length

    const hoveredId = hoverRef.current
    const hoverIndex = hoveredId === null ? -1 : laid.findIndex((card) => card.id === hoveredId)
    // 邻牌要让到 hover 那张牌放大后的轮廓之外；放大不改 x，所以让位量只跟基准位有关，
    // 全部在 neighborPushes 里按几何算好。
    const pushes = neighborPushes(hoverIndex, count, viewportWidth)

    laid.forEach((card, index) => {
      const slot = slotsRef.current.get(card.id)
      if (!slot) return

      const base = fanTransform(index, count, viewportWidth, PLAYER_FAN)
      const isHovered = index === hoverIndex
      const isNew = !placedRef.current.has(card.id)
      if (isNew) {
        placedRef.current.add(card.id)
        // 新牌从基准位下方淡入，看起来像从牌堆抽上来。
        // 这里用 opacity 而不是 autoAlpha：autoAlpha 会把 visibility 也改掉，
        // 万一补间被打断，牌就会一直是隐藏的。
        gsap.set(slot, {
          transformOrigin: '50% 100%',
          x: base.x,
          y: base.y + 140,
          rotation: base.rotation,
          scale: 0.85,
          opacity: 0,
        })
      }

      const push = pushes[index] ?? 0

      // 层级永远只有"右边的牌压住左边的"这一个固定顺序（和炉石一致），hover 和返程都不改它。
      //
      // 早先的做法是把放大的牌顶到最上层、缩回去的时候再放回原来那层。但 zIndex 没法补间，
      // 这个"放回去"必然是瞬间完成的，而且正好落在牌已经缩回原位、和邻牌重叠面积最大的那一帧，
      // 看着就是闪一下。把切换挪到别的时刻、或者拆成多次小切换都只是把闪烁挪个地方而已。
      // 现在改成靠位置解决遮挡：邻牌让到放大卡的轮廓外边去，谁也压不着谁，层级就不用动了。
      gsap.set(slot, { zIndex: index + 1 })

      const vars: gsap.TweenVars = isHovered
        ? { x: base.x, y: HOVER_BOTTOM, rotation: 0, scale: HOVER_SCALE }
        : { x: base.x + push, y: base.y, rotation: base.rotation, scale: 1 }
      vars.duration = mode === 'hover' ? HOVER_DUR : LAYOUT_DUR
      vars.ease = isHovered ? 'back.out(1.4)' : 'power3.out'
      // 快速扫过多张牌时，旧补间要被新补间干净地接管，不能各改各的。
      vars.overwrite = 'auto'
      if (isNew) vars.opacity = 1
      gsap.to(slot, vars)

      const helpParts = helpPartsOf(card.id)
      // autoAlpha 到 0 会顺手把 visibility 关掉，那个透明热区跟着就不再吃指针事件——
      // 没被放大的手牌上，指针扫过右上角不会莫名其妙触发翻面。
      if (helpParts.length > 0) {
        gsap.to(helpParts, { autoAlpha: isHovered ? 1 : 0, duration: 0.2, overwrite: 'auto' })
      }

      const inner = innerOf(card.id)
      // 离开 hover 时把翻到背面的牌转回正面；已经是正面就别白建一个补间。
      if (inner && !isHovered && Number(gsap.getProperty(inner, 'rotationY')) !== 0) {
        flipTo(inner, 0, 0.3)
      }
    })

  }

  /**
   * 摘掉所有牌的倾斜跟随（监听 + 补间）。只在组件卸载时用；
   * 手牌增减走的是下面按 id 增量挂/摘的那段，不能整批重来。重复调用是安全的。
   */
  const detachTilts = () => {
    for (const handle of tiltsRef.current.values()) handle.detach()
    tiltsRef.current.clear()
  }

  const { contextSafe } = useGSAP(
    (_context, safe) => {
      // resize 监听和延迟回位都在这个回调之外触发，里面新建的补间默认不归 useGSAP 的
      // context 管，组件卸载时 revert 不掉，会继续去改已经脱离文档的节点。
      // 用 useGSAP 传进来的 contextSafe 包一层，它们就回到同一个 context 里了。
      layoutRef.current = safe ? safe(applyLayout) : applyLayout
      applyLayout('reflow')

      // 倾斜跟随挂在这里而不是 applyLayout 里：它建的补间必须在 context 里创建一次就够，
      // 而 applyLayout 每次 hover 都会跑。
      //
      // 只给新来的牌挂、只摘掉已经不在手里的牌，已经挂着的原样留着——不能图省事整批重挂。
      // detach 会把倾斜和高光硬切回零，而正 hover 的那张牌在抽牌时并不会离开手牌：
      // 玩家指针停在它上面，倾斜会突然弹平、高光凭空消失，指针不动就不再有 pointermove，
      // 也就再也回不来，得晃一下鼠标才恢复。
      //
      // 另外，依赖数组非空时 useGSAP 只在**卸载**时 revert，下面 return 的清理函数
      // 在 cards 变化时根本不会跑，所以走掉的牌必须在这里自己摘，否则监听会一直留着。
      const alive = new Set<string>()
      for (const card of cards) {
        const slot = slotsRef.current.get(card.id)
        if (!slot) continue
        alive.add(card.id)
        if (tiltsRef.current.has(card.id)) continue
        tiltsRef.current.set(
          card.id,
          attachCardTilt(slot, {
            tiltLayer: '.hand-fan__tilt',
            maxTilt: HOVER_TILT_DEG,
            // 只有当前放大的那张才倾斜。hover 换牌时旧牌的 pointerleave 会自己归零。
            enabled: () => hoverRef.current === card.id,
          }),
        )
      }
      for (const [id, handle] of tiltsRef.current) {
        if (alive.has(id)) continue
        handle.detach()
        tiltsRef.current.delete(id)
      }

      // 组件卸载时 useGSAP 会 revert 掉所有内联样式，这些"已经摆过位"的记录也得跟着清空，
      // 否则严格模式下的二次挂载会以为牌都摆好了，跳过进场那一步。
      // 拖到一半被卸载也在这里收尾：落点区是父组件的元素，手牌没了它还在，
      // 高亮不清掉就会永远亮着。
      return () => {
        endDrag()
        detachTilts()
        placedRef.current.clear()
      }
    },
    { scope: rootRef, dependencies: [cards] },
  )

  useEffect(() => {
    const onResize = () => layoutRef.current('reflow')
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current)
    }
  }, [])

  const cancelLeaveTimer = () => {
    if (leaveTimerRef.current === null) return
    clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = null
  }

  const handleEnter = contextSafe((id: string) => {
    // 只要鼠标还按着（不管进没进入拖拽）就不接 hover：指针被 capture 之后，
    // 各浏览器发不发、什么时候发边界事件并不统一，与其猜它们的行为，不如在这里挡掉。
    // 松手时若指针确实已经不在牌上，浏览器会补一发 leave，hover 状态自己就对上了。
    if (dragRef.current !== null) return
    cancelLeaveTimer()
    if (hoverRef.current === id) return
    hoverRef.current = id
    applyLayout('hover')
  })

  const handleLeave = contextSafe((id: string) => {
    // 同 handleEnter：按着的时候一律不动 hover 状态。
    if (dragRef.current !== null) return
    if (hoverRef.current !== id) return
    cancelLeaveTimer()
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null
      // 这段延迟里指针可能已经移到别的牌上了，那时 hover 已经换人，这里就不该再动手。
      if (hoverRef.current !== id) return
      hoverRef.current = null
      layoutRef.current('hover')
    }, LEAVE_DELAY_MS)
  })

  const handleHelpEnter = contextSafe((id: string) => {
    const inner = innerOf(id)
    if (inner) flipTo(inner, 180, 0.4)
  })

  const handleHelpLeave = contextSafe((id: string) => {
    const inner = innerOf(id)
    if (inner) flipTo(inner, 0, 0.4)
  })

  /** 指针是不是落在指定区域里。每次移动现算：读一次 rect 的开销比缓存失效的坑小得多。 */
  const isInsideZone = (
    zoneRef: RefObject<HTMLElement | null> | undefined,
    clientX: number,
    clientY: number,
  ) => {
    const zone = zoneRef?.current
    if (zone === null || zone === undefined) return false
    const rect = zone.getBoundingClientRect()
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    )
  }

  const isInsideDropZone = (clientX: number, clientY: number) =>
    isInsideZone(dropZoneRef, clientX, clientY)

  /**
   * 两块落点的两级高亮，都由这里打在对应元素上（样式见 styles.css）：
   * ready = 正在拖牌，hot = 指针已经进到区域里、这时松手就打出去了。
   * “放回手牌”区的 hot 只描述取消结果，不参与出牌判定。
   */
  const markZone = (
    zoneRef: RefObject<HTMLElement | null> | undefined,
    ready: boolean,
    hot: boolean,
  ) => {
    const zone = zoneRef?.current
    if (zone === null || zone === undefined) return
    if (ready) zone.dataset.dropReady = 'true'
    else delete zone.dataset.dropReady
    if (hot) zone.dataset.dropHot = 'true'
    else delete zone.dataset.dropHot
  }

  const markDropZones = (ready: boolean, dropHot: boolean, returnHot: boolean) => {
    markZone(dropZoneRef, ready, dropHot)
    markZone(returnZoneRef, ready, returnHot)
  }

  /**
   * 把光标位置换算成 slot 的 x / y 目标值。
   *
   * slot 的坐标原点是锚点 .hand-fan 的底边中点、y 向下为正，变换原点又在卡牌底边中点，
   * 所以放大 DRAG_SCALE 之后卡牌中心跑到了原点上方 DRAG_SCALE × 卡高 / 2 处，
   * 想让这个中心对准光标就得把这段距离补回来。
   *
   * 尺寸取 documentElement 的 clientWidth / clientHeight 而不是 innerWidth / innerHeight：
   * .hand-fan 是 fixed + width: 100%，浏览器解析它的 left / bottom 用的是初始包含块
   * （不含滚动条），clientX / clientY 的原点也是这个矩形的左上角；
   * innerWidth / innerHeight 含滚动条，只在没有滚动条时才和它们相等。
   * 混用的后果是页面一出现竖直滚动条，牌就恒定偏在光标左侧约滚动条宽的一半。
   */
  const dragTargetOf = (clientX: number, clientY: number) => {
    const root = document.documentElement
    return {
      x: clientX - root.clientWidth / 2,
      y: clientY - root.clientHeight + (DRAG_SCALE * CARD_HEIGHT) / 2,
    }
  }

  /**
   * 收掉拖拽状态：停跟随补间、清高亮、清 dragRef，返回刚才那次拖拽。
   *
   * 跟随补间必须在这里停掉，牌才会停在松手那一刻的位置——
   * 打出时父组件要拿这个位置当 Flip 的起点，取消时归位补间也要从这里接着走。
   */
  const endDrag = (): DragState | null => {
    const drag = dragRef.current
    if (drag === null) return null
    dragRef.current = null
    markDropZones(false, false, false)
    // 用 drag.slot 而不是回 slotsRef 里查：最需要收尾的那条路径（拖到一半被父组件
    // 从 cards 里拿掉）上，slotsRef 里的记录在 commit 阶段就被删了，查出来是 undefined，
    // 跟随补间会一直挂在已经脱离文档的节点上，直到组件卸载才被 revert 掉。
    delete drag.slot.dataset.dragging
    // 没进入拖拽的话这张牌身上跑的是 hover 补间，不能顺手杀掉。
    if (drag.active) gsap.killTweensOf(drag.slot)
    return drag
  }

  /** 让一张牌补间回扇形里自己的位置（拖拽取消、或者出牌被父组件拒了）。 */
  const returnToFan = () => {
    // 用 layoutRef 而不是直接调 applyLayout：这个函数也会在 requestAnimationFrame
    // 回调里被调到，那时已经出了 contextSafe 的同步区间，补间得靠它才能归到 context 里。
    layoutRef.current('reflow')
  }

  /**
   * disabled 变化时要立刻处理的两件事。
   *
   * 一是落点区高亮：它必须和"现在松手会发生什么"一致，disabled 期间松手一律按取消算，
   * 那就连"正在拖牌"的 ready 都不该亮，更不能亮成"松手就打出"的 hot。
   * 二是异步确认的收尾：父组件在 onPlay 里打开 disabled 去等回包，这段时间牌停在落点上；
   * disabled 关掉时牌要是还在手牌里，说明这次出牌没被受理，这时才把它送回扇形。
   *
   * 用 layout effect 而不是 useEffect：handlePointerUp 里的 rAF 兜底要读 disabledRef，
   * 而 passive effect 不保证赶在下一帧的 rAF 之前跑完。
   */
  useLayoutEffect(() => {
    disabledRef.current = disabled
    const drag = dragRef.current
    if (drag !== null && drag.active) {
      const dropHot = !disabled && isInsideDropZone(drag.lastX, drag.lastY)
      const returnHot =
        !disabled && !dropHot && isInsideZone(returnZoneRef, drag.lastX, drag.lastY)
      markDropZones(!disabled, dropHot, returnHot)
    }
    if (disabled) return
    for (const id of playedRef.current) {
      // 牌已经不在手牌里 = 父组件受理了这次出牌，没什么要收拾的
      // （playedRef 里的记录由 applyLayout 的 reflow 清理）。
      if (!slotsRef.current.has(id)) continue
      playedRef.current.delete(id)
      returnToFan()
    }
  }, [disabled])

  /** 真正进入拖拽：换姿态、接管跟随、把剩下的牌重排一遍。 */
  const beginDrag = (drag: DragState) => {
    const slot = drag.slot
    drag.active = true
    // hover 的放大补间和延迟缩回都得让位，不然它们会和拖拽姿态抢同一批属性。
    cancelLeaveTimer()
    // 清掉 hover 还顺手关掉了这张牌的倾斜跟随：attachCardTilt 的 enabled 回调判的就是
    // hoverRef.current === card.id。指针被 capture 之后，cardTilt 挂在 slot 上的
    // pointermove 照样会触发，但 enabled 一旦为 false 它只会 settle（归零 + 收高光），
    // 不会再往 tilt 层写角度，也就抢不走拖拽的画面。改 hoverRef 的判据时记得连这条一起想。
    hoverRef.current = null
    // 抓起来之前把 hover 期间攒下的倾斜快速归零：拖着一张歪的牌满屏找落点观感很差，
    // 而且指针已经被 capture，光靠 cardTilt 自己的 pointerleave 等不到归零。
    // 注意这一下总是踩在一条刚被重启的跟随补间上：cardTilt 的 pointermove 是直接挂在 slot 上的，
    // 而 React 的 onPointerMove 走根容器委托，所以越过阈值那一帧一定是它先跟随、这里才归零。
    // 归零能压住跟随，靠的是 cardTilt 在 settle 里先把跟随补间停掉（原因见那里）。
    tiltsRef.current.get(drag.id)?.reset()
    gsap.killTweensOf(slot)
    // 顺手把 opacity 补满：上面是无差别全杀，新牌进场那条 opacity 0→1 的补间也在里面，
    // 而它是唯一负责淡入的补间（applyLayout 只在牌第一次登场时给 opacity）。
    // 抓住一张正在淡入的牌却不补，这张牌就会永久停在半透明。
    gsap.set(slot, { zIndex: DRAG_Z, opacity: 1 })
    // 只为了换成"握拳"光标，样式在 styles.css 里。
    slot.dataset.dragging = 'true'

    // 跟随只动 x / y，姿态只动 rotation / scale，两组补间属性不重叠，可以同时跑。
    drag.moveX = gsap.quickTo(slot, 'x', { duration: DRAG_FOLLOW_DUR, ease: 'power3.out' })
    drag.moveY = gsap.quickTo(slot, 'y', { duration: DRAG_FOLLOW_DUR, ease: 'power3.out' })
    gsap.to(slot, {
      rotation: 0,
      scale: DRAG_SCALE,
      duration: DRAG_POSE_DUR,
      ease: 'power2.out',
      overwrite: 'auto',
    })

    // 问号淡出：拖着的牌不需要它。热区和正反两面的圆圈必须一起淡（见 helpPartsOf），
    // autoAlpha 到 0 顺手关掉 visibility，热区也就不吃指针事件了。
    const helpParts = helpPartsOf(drag.id)
    if (helpParts.length > 0) gsap.to(helpParts, { autoAlpha: 0, duration: 0.2, overwrite: 'auto' })
    // 从背面直接拖出去的话，落点上飞出来的小卡画的是正面，会闪一下，所以先转回正面。
    // 必须走 flipTo（ui/flipCard.ts）：正反两面谁可见是它按角度切 opacity 决定的，
    // 裸补一个 rotationY 只会把卡转回来、opacity 还停在"显示背面"，画面就一直是背面。
    const inner = innerOf(drag.id)
    if (inner && Number(gsap.getProperty(inner, 'rotationY')) !== 0) {
      flipTo(inner, 0, 0.3)
    }

    applyLayout('hover')
    // 按下之后、走够阈值之前 disabled 有可能被翻开，那就一开始就别亮。
    const dropHot = !disabled && isInsideDropZone(drag.lastX, drag.lastY)
    const returnHot =
      !disabled && !dropHot && isInsideZone(returnZoneRef, drag.lastX, drag.lastY)
    markDropZones(!disabled, dropHot, returnHot)
  }

  const handlePointerDown = contextSafe((id: string, event: ReactPointerEvent<HTMLDivElement>) => {
    // 只认鼠标主键：中键、右键、以及多指里的副指针都不该把牌抓起来。
    if (!event.isPrimary || event.button !== 0) return
    if (disabled || playedRef.current.has(id)) return
    // 问号热区上按下不算抓牌，它只管翻面。
    if ((event.target as HTMLElement).closest('.hand-fan__help') !== null) return
    const slot = slotsRef.current.get(id)
    if (!slot) return
    // 挡掉浏览器默认的文字选中和图片拖拽，不然拖到一半会拖出一片蓝色选区。
    event.preventDefault()
    dragRef.current = {
      id,
      slot,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      active: false,
      moveX: null,
      moveY: null,
    }
    // 立刻捕获指针：后面就算光标跑出卡面（拖拽时必然会），move / up 也还是发到这张牌上。
    event.currentTarget.setPointerCapture(event.pointerId)
  })

  const handlePointerMove = contextSafe((id: string, event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.id !== id || drag.pointerId !== event.pointerId) return
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    if (!drag.active) {
      const dx = event.clientX - drag.originX
      const dy = event.clientY - drag.originY
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      beginDrag(drag)
      if (!drag.active) return
    }
    const target = dragTargetOf(event.clientX, event.clientY)
    drag.moveX?.(target.x)
    drag.moveY?.(target.y)
    // disabled 期间松手一律按取消算，那就一点都别亮：亮成 hot 却打不出去，
    // 等于骗玩家"现在松手就能打"，牌却直接飞回手里。
    const dropHot = !disabled && isInsideDropZone(event.clientX, event.clientY)
    const returnHot =
      !disabled && !dropHot && isInsideZone(returnZoneRef, event.clientX, event.clientY)
    markDropZones(!disabled, dropHot, returnHot)
  })

  const handlePointerUp = contextSafe((id: string, event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.id !== id || drag.pointerId !== event.pointerId) return
    const wasActive = drag.active
    const inZone = isInsideDropZone(event.clientX, event.clientY)
    endDrag()
    // 没过阈值就是原地点了一下，等价于直接打出这张牌——不用真的拖进战场。
    // 这时 slot 还停在点击前的扇形/hover 位置，onPlay 里查 DOM 拿到的就是这个位置当飞行起点，
    // 不需要专门归位，也不存在"落在别处"的取消场景。
    if (!wasActive) {
      if (disabled || playedRef.current.has(id)) return
      playedRef.current.add(id)
      onPlay(id)
      // 同下面拖拽分支：出牌没被受理的话，这张牌下一帧还会在手牌里，得把占用记录还回去，
      // 否则之后再点它会被 playedRef 的防重复挡住，怎么点都没反应。
      // 点击没有挪动过 slot，原地就是正确位置，不用像拖拽分支那样再 returnToFan。
      requestAnimationFrame(() => {
        if (!slotsRef.current.has(id)) return
        if (disabledRef.current) return
        playedRef.current.delete(id)
      })
      return
    }
    // 落在别处（包括拖回手牌上方）就是取消；拖到一半才被 disabled 的也按取消算。
    if (disabled || !inZone) {
      returnToFan()
      return
    }
    playedRef.current.add(id)
    // 父组件在这一步里同步截取 Flip 状态，所以此刻 slot 必须还停在松手那一刻的拖拽位置。
    onPlay(id)
    // 出牌被受理的话，React 会在这一帧结束前把这张牌从 DOM 里摘掉，slotsRef 的记录跟着没。
    // 下一帧它还在，只有两种可能：父组件当场拒了（算力不够、不是自己的回合……），
    // 或者按 props 文档的约定打开 disabled 去等网络回包。
    // 前者要立刻把牌送回扇形，否则它会僵在落点上再也拖不动——父组件拒绝时往往根本不改
    // state，也就不会有下一次 reflow 来兜底；后者只能等，判据就是 disabledRef
    // （闭包里的 disabled 是松手那一刻的旧值，父组件是在上面这行 onPlay 里才改的），
    // 之后由 disabled 关掉时的 layout effect 接手决定送不送回去。
    requestAnimationFrame(() => {
      if (!slotsRef.current.has(id)) return
      if (disabledRef.current) return
      playedRef.current.delete(id)
      returnToFan()
    })
  })

  /**
   * 拖拽被浏览器中断（切窗口、按下 Esc、指针捕获被抢走）时的收尾，一律按取消处理。
   *
   * 正常松手时 lostpointercapture 也会来一发，但那时 pointerup 已经把 dragRef 清空了，
   * 这里就是个空转，不会重复归位。
   */
  const handlePointerAbort = contextSafe((id: string) => {
    const drag = dragRef.current
    if (drag === null || drag.id !== id) return
    const wasActive = drag.active
    endDrag()
    if (wasActive) returnToFan()
  })

  return (
    <div className="hand-fan" ref={rootRef}>
      {cards.map((card) => (
        <div
          key={card.id}
          className="hand-fan__slot"
          data-flip-id={card.id}
          ref={(el) => {
            if (el) slotsRef.current.set(card.id, el)
            else slotsRef.current.delete(card.id)
          }}
          onPointerEnter={() => handleEnter(card.id)}
          onPointerLeave={() => handleLeave(card.id)}
          onPointerDown={(event) => handlePointerDown(card.id, event)}
          onPointerMove={(event) => handlePointerMove(card.id, event)}
          onPointerUp={(event) => handlePointerUp(card.id, event)}
          onPointerCancel={() => handlePointerAbort(card.id)}
          onLostPointerCapture={() => handlePointerAbort(card.id)}
        >
          {/*
            三层 transform 各管一件事，分开才不会互相覆盖：
            slot 管扇形摆位（x / y / rotation / scale）和拖拽时跟着光标走，
            tilt 管跟着指针的三维倾斜（rotationX / rotationY），
            inner 管翻到背面的 3D 翻转（rotationY 180°）。
            倾斜和翻转都是 rotationY，挤在同一层就是直接打架。
            正反两面谁可见不归 inner 管，由 flipTo 按角度切 opacity 决定（原因见 ui/flipCard.ts）。
            两面身上的 data-flip-face 就是给 flipTo 认人用的契约，别删。
            问号拆成两半分挂在两层里：看得见的圆圈在 inner 里（跟着倾斜也跟着翻面），
            触发翻面的透明热区在 inner 外（只跟倾斜、绝不跟翻面）。原因见下面两处注释。
          */}
          <div className="hand-fan__tilt">
            <div className="hand-fan__inner">
              <div className="hand-fan__face hand-fan__face--front" data-flip-face="front">
                <HandCardFace card={card} />
                {/* 看得见的问号圆圈之一。放在这里而不是 HandCardFace 里面：
                    那个组件被战场小卡复用，而小卡没有翻面这回事，不该跟着长出一个问号。 */}
                <span className="hand-fan__help-mark" aria-hidden="true">
                  ?
                </span>
              </div>
              <div className="hand-fan__face hand-fan__face--back" data-flip-face="back">
                <div className="card-back">
                  <span className="card-back__title">{card.name}</span>
                  <p className="card-back__text">{card.backText}</p>
                  {/* 背面也要有高光层，否则翻过去之后反光会凭空消失。
                      这一层和正面共用 --glare-x / --glare-y，位置是对的：
                      .hand-fan__face--back 自带的 rotateY(180deg) 单看是镜像，
                      而背面只有在 inner 也转过 90° 之后才显示，两个 180° 正好抵消。 */}
                  <div className="card-glare" />
                  {/* 背面同一个角上的问号圆圈：翻过去之后指针底下仍然压着一个问号，
                      看起来就是"同一个问号跟着卡转到了背面"。
                      排在高光层后面，免得被那层 soft-light 混得发灰。 */}
                  <span className="hand-fan__help-mark" aria-hidden="true">
                    ?
                  </span>
                </div>
              </div>
            </div>
            {/*
              问号的触发热区：完全透明，只管交互（hover 翻面、拦住在它身上按下时抓起牌，
              见 handlePointerDown），样子全交给上面 inner 里那两个圆圈。

              视觉和热区必须分开，因为热区绝对不能跟着翻面：它要是跟着 inner 一起转，
              牌一翻到背面按钮就转到了指针够不着的地方，pointerleave 立刻把牌翻回正面，
              翻回来又被 hover 到，来回抖个没完。留在 inner 外面、位置尺寸都不动，
              指针才会一直稳稳停在触发区里。

              与之配套，卡面那一整棵子树在 CSS 里是 pointer-events: none（见 .hand-fan__inner），
              翻面途中转动的卡面抢不走指针。别给卡面加指针事件，加了这条抖动就会回来。
            */}
            <button
              type="button"
              className="hand-fan__help"
              aria-label="查看卡牌详情"
              onPointerEnter={() => handleHelpEnter(card.id)}
              onPointerLeave={() => handleHelpLeave(card.id)}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 卡牌正面。
 *
 * 战场上的小卡也用它渲染（外面套一个缩放容器），这样打出时的 FLIP 飞行里
 * 画面前后是同一份排版，落位时不会突然换一套内容。
 *
 * 插画是**整张卡面**级别的竖版图（自带装饰边框），所以它铺满整张卡当底，
 * 费用、卡名、描述、数值都是浮在图上的一层，底部靠 .card-face__body 的渐变压住底图保证可读。
 */
export function HandCardFace({ card }: { card: HandCardData }) {
  return (
    <div className={`card-face card-face--${card.kind}`}>
      {/* alt 留空：插画只是气氛，卡上的信息读屏能从下面的文字节点全部拿到，
          念一遍图名反而是噪音。draggable 关掉是因为原生图片拖拽会把出牌的拖拽整个截走。 */}
      <img
        className="card-face__art"
        src={card.art ?? placeholderArtFor(card.id)}
        alt=""
        draggable={false}
      />
      <div className="card-face__cost">{card.cost}</div>
      <div className="card-face__body">
        <div className="card-face__name">{card.name}</div>
        <p className="card-face__text">{card.text}</p>
        <div className="card-face__stats">
          {card.kind === 'model' ? (
            <>
              <span>算力 {card.power ?? 0}</span>
              <span>完整度 {card.integrity ?? 0}</span>
            </>
          ) : (
            <span>伤害 {card.damage ?? 0}</span>
          )}
        </div>
      </div>
      {/*
        跟着指针跑的微高光（落在指针的镜像位置，见 cardTilt.ts）。
        战场小卡也用同一份卡面，所以这一层它们也有。
        没挂倾斜跟随的卡（比如扇形里没被放大的小卡）不会有人把它的 opacity 抬起来，
        这层就一直是透明的，白留一个 DOM 节点而已。
      */}
      <div className="card-glare" />
    </div>
  )
}
