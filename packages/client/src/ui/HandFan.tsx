/**
 * 炉石式扇形手牌：纯 DOM + GSAP，没有画布。
 *
 * 组件只管"一排牌怎么摆、怎么 hover、怎么拖"，不关心牌从哪来、打出去之后发生什么。
 * 出牌有两条路：把牌拖进 dropZoneRef 指的那块区域再松手，或者直接点一下
 * （按下、原地松手，没有拖动过阈值）——两条路殊途同归，都在松手那一刻喊一声 onPlay，
 * 组件自己不区分是哪种触发的。打出的卡要飞到哪个容器由父组件决定
 * （见 MatchStage 里的 Flip 用法），因为跨容器的 FLIP 必须由同时看得见
 * "手牌"和"战场"的那一层来做。
 *
 * 只面向电脑浏览器 + 鼠标：拖拽走原生 pointer 事件，不做触屏和多指适配。
 *
 * 一张牌的 transform 拆成三层，每层只管一件事（详见下面 JSX 里的注释）：
 * slot 管扇形摆位和拖拽跟随（x / y / rotation / scale），
 * .hand-fan__tilt 管跟着指针的三维倾斜（rotationX / rotationY），
 * .hand-fan__inner 管翻到背面的 3D 翻转（rotationY 180°）。
 *
 * 新牌进场是"从侧栏那摞牌堆飞到自己的扇形槽位"：起点由父组件通过 getDealOrigin 给，
 * 飞行本身就是那张牌的第一次布局补间（位移 + 从牌堆那么小放大到手牌尺寸）。
 * 拿不到起点时退回原来的"从基准位下方淡入"。飞行途中不翻面：这边的背面是"看详情"用的
 * 那一面，印着卡名和说明，拿它当牌堆的牌背用是两回事（见下面 JSX 里那两层 face）。
 *
 * 扇形的布局数学（fanTransform 和那一批常量）在 ui/fanMath.ts，翻面在 ui/flipCard.ts——
 * 两样都和对手的倒扇形 OpponentFan / 强制展示层共用，不要在这里另抄一份。
 * 拖拽的那台指针状态机（阈值、指针捕获、跟随、落点高亮、松手判定）在 ui/useCardDrag.ts，
 * 和卡组页共用；这里只保留扇形自己的部分：排布时把被拖的牌摘出去、抓起牌时收拾 hover 那一套、
 * 以及"没落进落点就补间回扇形"。
 *
 * 三个和"关掉手牌"有关的开关不要混（详见 HandFanProps）：
 * disabled 只管出不了牌，玩家照样能 hover 把牌抬起来看；
 * frozen 是整排手牌彻底冻住，连 hover 和问号翻面都不接，给父组件在出牌演出期间用；
 * lockReason 是 disabled 加上一句"为什么"——它自带禁用，另外还把理由画出来
 *（灰墨态 + 点击摇头 + 小字提示）。
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { cardArtFor } from './cardArt'
import { isIllustratedSkillCard } from './skillCardArt'
import { AI_MODEL_FACE, aiModelTokenCost } from './aiModelFace'
import { CardFaceOverlay } from './CardFaceOverlay'
import { attachCardTilt } from './cardTilt'
import type { CardTiltHandle } from './cardTilt'
import { flipTo } from './flipCard'
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  LAYOUT_DUR,
  SPREAD_DEG,
  PLAYER_FAN,
  fanTransform,
} from './fanMath'
import { prefersReducedMotion } from './reducedMotion'
import {
  battleStageHeight,
  battleStageMetrics,
  battleStageWidth,
  toStagePoint,
} from './battleStage'
import { DRAG_SCALE, useCardDrag } from './useCardDrag'
import type { CardDragInfo, CardDropZone } from './useCardDrag'

gsap.registerPlugin(useGSAP)

/**
 * 一张手牌的展示数据。
 *
 * 字段照着 core 的 Card 取名，由调用方从 Card + CardInstance（或场上的 AiInstance）拼出来。
 * 目前场上的 AI 单位没有会变的数值，所以战场小卡直接读卡牌定义就够了；
 * 哪天单位上有了"被增益/削弱"的属性，这里要改成传实例的当前值，否则小卡会永远显示原始数值。
 *
 * backText 是翻面时的补充说明，core 里没有对应字段，由调用方自己拼文案。
 */
export interface HandCardData {
  id: string
  /** 动画使用实例 id；原画和铭牌使用定义 id，避免出牌后丢失图层。 */
  definitionId?: string
  name: string
  /**
   * 卡种。'hero' 是英雄牌：它不进牌组、不进手牌，只在对局侧栏和图鉴里当一张小卡画出来，
   * 借的是同一份卡面排版（见 ui/heroCard.ts）。
   */
  kind: 'ai' | 'skill' | 'hero'
  /** AI 牌印在卡面上的模型名，纯展示。技能牌和英雄牌没有这一项。 */
  model?: string
  /** 卡面正面的描述文案。 */
  text: string
  /** 翻到背面时展示的补充说明。 */
  backText: string
  /** 卡面插画地址；不填时按定义 id 查找原画，其余卡牌使用占位图。 */
  art?: string
}

/**
 * 这次出牌是怎么触发的：拖进落点区松手，还是原地点了一下。
 *
 * 组件自己不区分这两条路（对它来说都是"打出去了"），但父组件可能要区分：
 * 要选目标的技能牌拖出去是"松手落在谁身上就打谁"，点一下则是进选目标态等玩家再点一次。
 * 拖拽那条路调 onPlay 时牌正停在松手位置，父组件可以就地量它落在哪。
 */
export type CardPlayVia = 'drag' | 'tap'

/**
 * 手牌被锁住的原因，也就是"为什么现在出不了牌"。
 *
 * 只收那些会持续一整段时间、玩家会盯着看的等待（轮到对方、AI 在答题），
 * 不收 disabled 里那些一闪而过的瞬态锁（等回包、牌正在飞、展示层演着）——
 * 那些锁在自己回合里也会反复开关，跟着它们把整排手牌染灰再恢复就是在闪。
 * 判据由父组件给（见 MatchStage 的 waitingForFoe / quizWait）。
 */
export type HandLockReason = 'foe-turn' | 'quiz'

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
  onPlay: (id: string, via: CardPlayVia) => void
  /**
   * 为 true 时拖不出牌（比如不是自己的回合、正在等对方确认），但仍然可以 hover 看牌。
   *
   * 这是刻意的：轮不到自己时玩家还是想把牌抬起来看清楚手上有什么。
   * 要连 hover 一起关掉得用下面的 frozen。
   *
   * 拖到一半才变成 true 的话不会把牌从手上抢走：还能继续拖，只是落点区的高亮会立刻熄掉
   * （高亮必须和松手的实际结果一致），松手一律按取消算。
   */
  disabled?: boolean
  /**
   * 为 true 时整排手牌彻底冻住：不接 hover、不接问号翻面、也拖不出牌。
   *
   * 给"屏幕上正在演一段动画"的时刻用（牌飞向战场、落地冒烟、展示层演着）。
   * 那段时间手牌只要还能 hover，抬起来的下一张牌就会盖住正在演的那张——
   * 放大后的手牌高约 400px，必然戳进我方战场行，而 .hand-fan 是 z-index 20 的层叠上下文，
   * 落位后的战场格子（z-index auto）压不过它，光靠调层级解决不了，只能不让 hover 发生。
   *
   * 打开的那一刻已经抬起来的那张牌会被主动收回扇形（连倾斜、高光、翻面一起收）；
   * 关掉时不主动抬牌，等玩家动一下鼠标——指针停在原地不动的话浏览器不会补发 enter，
   * 所以那一下靠 slot 的 onPointerMove 接住（见那里）。
   *
   * 它不参与"等回包"那套约定：父组件要等网络结果，仍然得按上面 onPlay 的说明打开 disabled。
   */
  frozen?: boolean
  /**
   * 现在出不了牌是因为"在等一段别人的流程"（轮到对方、AI 在答题），非空即进入灰墨态：
   * 整排下沉褪色、光标收回箭头、点一下会摇头并弹一条小字提示。
   *
   * 传了 lockReason 就等于同时传了 disabled：组件内部把两者并起来用，不指望调用方
   * 记得两个都给——否则漏给 disabled 就会得到一排画成灰墨态、却照样拖得动的牌。
   * 之所以不干脆合成一个 prop：disabled 里那些一闪而过的瞬态锁不该染灰整排手牌，
   * 两者的时间尺度不一样，理由见 HandLockReason。
   */
  lockReason?: HandLockReason | null
  /**
   * 已经点出去、正在等玩家指定目标的那张牌（父组件的"选目标态"，见 MatchStage 的 targeting）。
   *
   * 这张牌**留在扇形里**，只是抬高一点、单独亮着，同一时刻整排其余的牌一起压暗
   * （压暗走 opacity，因为全屏那层压暗在扇形下面，够不着手牌自己）。
   * 它只管这一层"哪张在等目标"的排布：那期间不该有 hover 的事归 frozen 管，
   * 父组件两个都要给（选目标态同样要冻住整排，否则指针还压在那张牌上，它会一直放大挡住战场）。
   *
   * 注意这张牌同时也在"已经打出、正在等结果"的记录里（playedRef），
   * 但它和等网络回包的牌不一样：那种停在落点上不参与排布，这种要照常排回扇形。
   */
  castingId?: string | null
  /**
   * 拖拽起止通知：过了阈值真正拖起来时给牌的 id，松手/取消/被中断时给 null。
   *
   * 给父组件用来"拖着这张牌时把场上合法目标标出来"。组件自己不需要这个状态，
   * 所以只是通知，不接受父组件的回话。
   */
  onDragStateChange?: (id: string | null) => void
  /**
   * 发牌飞行的起点：我方卡堆最上面那张牌此刻在屏幕上的位置（视口坐标）。
   *
   * 每次要摆一张新牌时现调一次，不缓存——卡堆跟着侧栏大小走，窗口一变位置就变了。
   * 不传、或者当场返回 null（侧栏还没挂上、这排手牌被搬到别的页面上用）时，
   * 新牌退回原来的"从基准位下方淡入"。
   */
  getDealOrigin?: () => DOMRect | null
  /**
   * 为 true 时新牌先压在卡堆上不动，变回 false 才依次飞出去。
   *
   * 只给开局用：抛硬币过场是一整层盖住屏幕的遮罩（z-index 1100），
   * 这时候发牌等于发给遮罩看，玩家一张都瞧不见。
   */
  dealHold?: boolean
  /**
   * 还压在卡堆上、没起飞的新牌张数变了。
   *
   * 父组件把它和局面里的剩余张数相加当卡堆上的数字，开局那 5 张才是从 20 一张张数下去的
   *（见 MatchStage 的 dealPending）。不关心这件事的调用方不传即可。
   */
  onDealPendingChange?: (count: number) => void
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
 * 写成公式而不是常数，是为了改 SPREAD_DEG 时不用手工重新对表。
 */
const MAX_TILT_RAD = ((SPREAD_DEG / 2) * Math.PI) / 180
const MIN_HOVER_SCALE =
  ((CARD_WIDTH / 2) * Math.cos(MAX_TILT_RAD) + CARD_HEIGHT * Math.sin(MAX_TILT_RAD)) / (CARD_WIDTH / 2)
/**
 * hover 放大的倍数：想要 1.75，但不能低于上面那条几何下限（40° 时下限约 1.9）。
 *
 * 它同时是 CSS 那边的 --hand-card-zoom：slot 的盒子直接按放大到顶的尺寸布局
 * （见 styles.css 的 .hand-fan__slot / .hand-fan__tilt 和下面的 slotScale）。
 * 所以这个值只能算一次、从这里传给 CSS，不能两边各写一份。
 */
const HOVER_SCALE = Math.max(1.75, MIN_HOVER_SCALE)

/**
 * 把「想让人看到多大」换算成写给 GSAP 的 scale。
 *
 * slot 的盒子已经是放大到顶的尺寸了（HOVER_SCALE 倍），所以静置那张牌反而要缩到
 * 1 / HOVER_SCALE 才是设计稿上的 150×225，放大到顶就是 scale 1。
 * 这么绕是为了让倾斜时的卡面按原生分辨率栅格化，理由写在 styles.css 的 .hand-fan__tilt 上。
 *
 * 注意只有 scale 要换算：x / y 是平移，不受盒子变大影响，照旧用显示尺寸那套坐标算。
 */
function slotScale(shown: number): number {
  return shown / HOVER_SCALE
}

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
 * 只给放大的那张牌用。扇形里的小卡本身就是斜的（最多 SPREAD_DEG / 2），
 * 再叠一层三维倾斜看着就是一团乱，所以那时候不启用（见 attachCardTilt 的 enabled）。
 * 10° 是看着调出来的：再小几乎看不出"卡在跟着手动"，再大卡面的透视就开始明显变形。
 */
const HOVER_TILT_DEG = 10

/**
 * 选目标期间，除正在施放的那张之外整排手牌压到这个不透明度。
 *
 * 走 opacity 而不是 CSS 的 filter / 外面盖一层：slot 的 opacity 本来就归 GSAP 管
 * （新牌进场的淡入就在用它），两边抢同一个属性会闪；
 * 而全屏那层压暗在扇形下面（扇形这时被抬到它上面去了），够不着手牌自己。
 */
const CASTING_DIM = 0.3
/** 正在施放的那张牌从扇形位往上抬多少像素，让人一眼看出在等谁。 */
const CASTING_LIFT = 26
/**
 * 正在施放的那张牌在扇形内部的层级。
 * 扇形里其余的牌是按下标排的 1..N（见 applyLayout），给个够大的数就压得住整排。
 */
const CASTING_Z = 50

/**
 * 拿不到卡堆位置时，新牌先在基准位下方沉这么多再滑上来。
 * 卡高 225，沉 140 之后露在视口里的只剩顶上一小条，看着就像刚从屏幕外被抽上来。
 */
const ENTER_SINK = 140
/**
 * 开局那几张牌依次起飞的间隔（秒）。
 *
 * 太密看着像一把甩出去，太疏又要干等：0.12 × 5 张 = 0.6 秒，正好是"一张张发"
 * 又不至于拖住开局的那个点。每轮补牌只有两张（core 的 ROUND_DRAW_SIZE），
 * 那时这个间隔只多出 0.12 秒，察觉不到。
 */
const DEAL_STAGGER = 0.12

/** 灰墨态下点一张牌时，小字提示浮在牌顶上方多少像素。 */
const LOCK_TIP_GAP = 10
/** 小字提示自己停留多久（毫秒）再淡出。够读完四个字，又不至于一直挂在屏幕上。 */
const LOCK_TIP_HOLD_MS = 1100
/** 每种锁对应的小字文案。 */
const LOCK_TIP_TEXT: Record<HandLockReason, string> = {
  'foe-turn': '对方出牌中',
  quiz: 'AI 答题中',
}

/** hover 引起的补间要更快，重排则用统一的慢一点的节奏。 */
type LayoutMode = 'hover' | 'reflow'

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
/**
 * 扇形可以铺开多宽。
 *
 * 不能拿舞台宽了事：对局界面两侧是不透明的侧栏，而且 z-index 30 压在手牌（20）之上，
 * 手牌一多，扇形两端就整片钻到侧栏底下去了。所以量的是中间那栏（.battle__battlefield）。
 * 这栏并不严格居中（左右侧栏宽度差十来个像素），而扇形是以舞台中线为对称轴摊开的，
 * 所以取"中线到左右两边距离里较小的那个"再翻倍——按窄的那侧算，宽的那侧自然也放得下。
 *
 * 返回值是舞台内坐标（和 fanMath 的那套像素同一口径），所以量到的视口矩形要除以 scale
 * 换算回来，见 ui/battleStage.ts。量不到中栏（比如手牌被搬到别的页面上用）就退回舞台宽，
 * 那种情况下 battleStage 会给出"没有舞台"的口径，也就是视口宽。
 */
function fanAreaWidth(): number {
  const stageWidth = battleStageWidth()
  const field = document.querySelector('.battle__battlefield')
  if (field === null) return stageWidth

  const rect = field.getBoundingClientRect()
  if (rect.width === 0) return stageWidth

  const metrics = battleStageMetrics()
  const center = metrics.left + (stageWidth * metrics.scale) / 2
  return (Math.min(center - rect.left, rect.right - center) * 2) / metrics.scale
}

/**
 * 把卡堆的位置换算成 slot 的起始变换（发牌飞行的起点）。
 *
 * 坐标系和 dragTargetOf 是同一套：slot 的原点在锚点 .hand-fan 的底边中点、y 向下为正，
 * 而变换原点在卡牌底边中点，所以按 s 缩放之后卡心落在原点上方 s × 卡高 / 2 处，
 * 想让卡心对准卡堆中心就得把这段补回来。
 *
 * 两个入参都是 getBoundingClientRect 量的**视口**矩形（缩放之后的屏幕像素），
 * 而写给 GSAP 的 x / y / scale 全是**舞台内**像素，所以位置要过一次 toStagePoint、
 * 宽度要除一次 scale（口径见 ui/battleStage.ts）。
 *
 * 原点取**现量的锚点矩形**，而不是"舞台底边中点"那个理论值：.hand-fan 自己身上有一份
 * CSS transform——灰墨态那一下整排下沉 12px（见 styles.css 的 [data-locked]）。
 * 拿理论值算的话，轮到对方出牌时整排正好沉着，牌的起飞点会比卡堆低 12px。
 * 而 slot 的 x / y 本来就是锚点局部坐标（fanTransform 算出来的也是），
 * 照锚点当场在哪儿来算，无论锚点被谁挪过都对得上。
 *
 * 缩放取"卡堆那张牌在舞台里有多宽 ÷ 150"：起飞那一瞬间的大小和卡堆上那张一模一样，
 * 飞行途中再一路涨到手牌尺寸。旋转归零，因为卡堆上的牌是正着摞的，
 * 扇形的倾角留给飞行途中转出来。
 */
function dealStartVars(origin: DOMRect, anchor: DOMRect): gsap.TweenVars {
  const metrics = battleStageMetrics()
  const center = toStagePoint(origin.left + origin.width / 2, origin.top + origin.height / 2, metrics)
  // 锚点 .hand-fan 高度为 0、贴着底边，所以它的 top 就是 slot 那套坐标的原点所在的那条线。
  const base = toStagePoint(anchor.left + anchor.width / 2, anchor.top, metrics)
  const shown = origin.width / metrics.scale / CARD_WIDTH
  return {
    x: center.x - base.x,
    y: center.y - base.y + (shown * CARD_HEIGHT) / 2,
    rotation: 0,
    scale: slotScale(shown),
  }
}

function neighborPushes(hoverIndex: number, count: number, areaWidth: number): number[] {
  const pushes = new Array<number>(count).fill(0)
  if (hoverIndex < 0) return pushes

  const hovered = fanTransform(hoverIndex, count, areaWidth, PLAYER_FAN)
  const half = (CARD_WIDTH / 2) * HOVER_SCALE + NEIGHBOR_CLEARANCE
  // 一张牌朝扇形中间伸出多远：底边那个角，随倾角变小。
  const reachOf = (index: number) =>
    (CARD_WIDTH / 2) *
    Math.cos((fanTransform(index, count, areaWidth, PLAYER_FAN).rotation * Math.PI) / 180)

  let carry = 0
  for (let i = hoverIndex - 1; i >= 0; i -= 1) {
    const base = fanTransform(i, count, areaWidth, PLAYER_FAN)
    carry = Math.min(carry, hovered.x - half - reachOf(i) - base.x)
    pushes[i] = carry
  }
  carry = 0
  for (let i = hoverIndex + 1; i < count; i += 1) {
    const base = fanTransform(i, count, areaWidth, PLAYER_FAN)
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
  frozen = false,
  lockReason = null,
  castingId = null,
  onDragStateChange,
  getDealOrigin,
  dealHold = false,
  onDealPendingChange,
}: HandFanProps) {
  /**
   * 组件内部真正用的"出不了牌"：lockReason 非空自带禁用，不指望调用方另外把 disabled 也打开。
   *
   * 组件里凡是读"现在能不能出牌"的地方一律用这一份，disabled 这个 prop 只在这里读一次。
   * 光靠约定的话，哪天有人只给 lockReason 就会得到一排画成灰墨态、却照样拖得动的牌。
   */
  const effectiveDisabled = disabled || lockReason !== null
  const rootRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef(new Map<string, HTMLDivElement>())
  /** 灰墨态下点牌弹出来的那条小字提示。整排共用这一个节点，位置按被点的牌现算。 */
  const lockTipRef = useRef<HTMLDivElement>(null)
  /** 小字提示的停留计时器。重复点牌要重置它，卸载时要清掉。 */
  const lockTipTimerRef = useRef<number | null>(null)
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
  /**
   * 最新的 effectiveDisabled。松手那一帧的 rAF 回调只能读它：
   * 闭包里的那份是松手那一刻的旧值，而父组件恰恰是在 onPlay 里才把 disabled 打开的。
   */
  const disabledRef = useRef(effectiveDisabled)
  /**
   * 最新的 frozen。在渲染期间就写好，因为读它的地方等不到 effect：
   * applyLayout 被存进 layoutRef，而那份闭包只在 cards 变化时才重建（见下面 useGSAP 的依赖数组），
   * frozen 一变它是不会刷新的，只能走 ref 拿当前值。
   */
  const frozenRef = useRef(frozen)
  frozenRef.current = frozen
  /** 最新的 castingId。理由和上面那个 frozenRef 一模一样：applyLayout 读的是这一份。 */
  const castingIdRef = useRef(castingId)
  castingIdRef.current = castingId
  /**
   * 发牌那三个 prop 的最新值。理由同 frozenRef：applyLayout 常常是上一次渲染留下的闭包，
   * 而 dealHold 变化时 cards 没变、闭包不会刷新；两个回调则会被延迟很久才调到。
   */
  const dealHoldRef = useRef(dealHold)
  dealHoldRef.current = dealHold
  const dealOriginRef = useRef(getDealOrigin)
  dealOriginRef.current = getDealOrigin
  const dealPendingRef = useRef(onDealPendingChange)
  dealPendingRef.current = onDealPendingChange
  /**
   * 还压在卡堆上、没起飞的新牌。进场时加进来，补间真的开跑（或者这张牌离开手牌）时移走，
   * size 就是报给父组件的张数。
   */
  const dealQueueRef = useRef(new Set<string>())
  /**
   * 已经排好队、还在等 stagger 延迟的那些进场补间，按牌 id 存着。
   *
   * 必须自己留一份句柄：这种补间一帧都还没跑过，GSAP 的 overwrite: 'auto' 认不出它
   *（那是给已经在跑的补间用的），重排时不亲手掐掉的话，它会晚一步起跑，
   * 把已经摆回扇形的牌又拽回卡堆。
   */
  const dealTweensRef = useRef(new Map<string, gsap.core.Tween>())
  /** 给 resize 监听和延迟回位用：它们要拿到最新一次渲染的布局函数。 */
  const layoutRef = useRef<(mode: LayoutMode) => void>(() => {})

  /** 把"还压着几张"报给父组件。没人关心时什么都不做。 */
  const reportDealPending = () => dealPendingRef.current?.(dealQueueRef.current.size)

  /**
   * 这张牌不再压在卡堆上了：起飞（进场补间开跑）时调一次，牌被打出去/被弃掉时也调一次。
   * 重复调用是安全的——不在队里就直接返回，不会白报一次。
   */
  const finishDeal = (id: string) => {
    dealTweensRef.current.delete(id)
    if (!dealQueueRef.current.delete(id)) return
    reportDealPending()
  }

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
   * 已经打出、正在等结果的牌（playedRef）同样不参与，原因见下面 laid 那里。
   */
  const applyLayout = (mode: LayoutMode) => {
    const areaWidth = fanAreaWidth()
    // 走 ref 不走闭包：这个函数常常是上一次渲染留下的那一份（见 castingIdRef）。
    const casting = castingIdRef.current
    const ids = new Set(cards.map((card) => card.id))
    /**
     * 减少动效时不做发牌飞行：起点取 null，新牌退回原来那段"从基准位下方淡入"，
     * 也不排队错开（下面的 delay 一并压成 0）。
     */
    const reduce = prefersReducedMotion()
    const dealOriginRect = reduce ? null : (dealOriginRef.current?.() ?? null)
    // 起点要按锚点当场的位置算（灰墨态下整排是沉着的，见 dealStartVars），量不到锚点就不飞。
    const anchorRect = rootRef.current?.getBoundingClientRect() ?? null
    const dealStart =
      dealOriginRect === null || anchorRect === null
        ? null
        : dealStartVars(dealOriginRect, anchorRect)
    /** 这一轮排上队的新牌数；攒到最后统一报一次，不用一张一张地惊动父组件。 */
    let dealAdded = 0
    /** 这一轮真正安排起飞的第几张，决定各自的 stagger 延迟。 */
    let dealSeq = 0

    if (mode === 'reflow') {
      // 按住的那张牌被父组件从 cards 里拿掉了（测试面板的"去1张"弃的就是手牌末尾那张，可能正是它）：
      // 它的 DOM 节点这一帧已经没了，再留着拖拽状态，松手时就会去动一个不存在的节点。
      // 这里走 endDrag 而不是让它自然取消：牌都没了，没有"回扇形"这回事。
      const pressedId = cardDrag.pressedId()
      if (pressedId !== null && !ids.has(pressedId)) {
        cardDrag.endDrag()
        // endDrag 是"这次拖拽当没发生过"，不走 onCancel，所以拖拽通知得在这儿自己收。
        onDragStateChange?.(null)
      }
      // 只清理"已经不在手牌里"的记录。hover 期间调用得太频繁，不该顺手改这些状态。
      // 注意 reflow 也会被 resize 触发，所以这里不能把整份记录一股脑清空：
      // 拖一下窗口就把防重复的记录抹掉，同一张牌会被打出两次。
      if (hoverRef.current !== null && !ids.has(hoverRef.current)) hoverRef.current = null
      for (const id of placedRef.current) if (!ids.has(id)) placedRef.current.delete(id)
      for (const id of playedRef.current) if (!ids.has(id)) playedRef.current.delete(id)
      // 还没起飞就离开手牌的（憋着发牌时被测试面板弃掉了）：补间得亲手掐掉，
      // 否则它到点会去动一个已经被 React 摘掉的节点，卡堆上的数字也永远少不回去。
      for (const id of dealQueueRef.current) {
        if (ids.has(id)) continue
        dealTweensRef.current.get(id)?.kill()
        finishDeal(id)
      }
    }

    // 拖出来的牌从队里摘掉，剩下的按"少了一张"重算扇形，手牌会自己合拢（炉石就是这样）。
    //
    // 已经打出、正在等父组件受理的牌（playedRef）也一起摘掉，和拖拽中的牌同等待遇：
    // 父组件为了打开 disabled 必然重渲染，重渲染就带来一次 reflow，
    // 排布只要碰它就会把它补间回扇形，和 HandFanProps 约定的"停在落点上等结果"正好相反
    // （拖一张牌进战场松手，牌会当场飞回手里）。
    // 豁免不需要额外的解除逻辑：两处收尾（disabled 关掉时的 layout effect、松手后的 rAF 兜底）
    // 都是先把 id 从 playedRef 删掉再 returnToFan，那一次 reflow 就会把牌送回扇形。
    const draggingId = cardDrag.draggingId()
    // 正在等玩家选目标的那张牌（castingId）是 playedRef 里的例外：它也已经"打出去"了，
    // 但父组件要它留在手里等玩家点目标，所以照常参与排布，只是抬高一点、单独亮着。
    const laid = cards.filter(
      (card) => card.id !== draggingId && (card.id === casting || !playedRef.current.has(card.id)),
    )
    const count = laid.length

    // 冻结期间一律按"没有 hover"排布。下面那个 frozen 的 layout effect 会把 hoverRef 清掉，
    // 但重排的入口不止一处（resize、手牌增减都会走到这里），冻结和清空之间隔着一次提交；
    // 中间这次重排要是照旧读 hoverRef，就会把那张牌又补间回放大位。
    const hoveredId = frozenRef.current ? null : hoverRef.current
    const hoverIndex = hoveredId === null ? -1 : laid.findIndex((card) => card.id === hoveredId)
    // 邻牌要让到 hover 那张牌放大后的轮廓之外；放大不改 x，所以让位量只跟基准位有关，
    // 全部在 neighborPushes 里按几何算好。
    const pushes = neighborPushes(hoverIndex, count, areaWidth)

    laid.forEach((card, index) => {
      const slot = slotsRef.current.get(card.id)
      if (!slot) return

      const base = fanTransform(index, count, areaWidth, PLAYER_FAN)
      const isCasting = card.id === casting
      // 选目标态下父组件会一并打开 frozen，上面那行已经把 hover 抹平了；
      // 判 isCasting 优先只是兜底，免得哪天两个开关没一起给，这张牌又被摆成放大的样子。
      const isHovered = !isCasting && index === hoverIndex
      const isNew = !placedRef.current.has(card.id)
      if (isNew) {
        placedRef.current.add(card.id)
        dealQueueRef.current.add(card.id)
        dealAdded += 1
        // 拿得到卡堆位置就从那儿起飞，拿不到退回原来的"从基准位下方淡入"。
        //
        // 从卡堆起飞的那张一开始就是不透明的：起点在左侧栏里，而侧栏（z-index 30）
        // 压在整排手牌（20）之上，牌是从侧栏后面滑出来的，本来就看不见，
        // 不需要再淡入一次。淡入那条路用 opacity 而不是 autoAlpha：
        // autoAlpha 会把 visibility 也改掉，万一补间被打断，牌就会一直是隐藏的。
        gsap.set(slot, {
          transformOrigin: '50% 100%',
          ...(dealStart === null
            ? {
                x: base.x,
                y: base.y + ENTER_SINK,
                rotation: base.rotation,
                scale: slotScale(0.85),
                opacity: 0,
              }
            : { ...dealStart, opacity: 1 }),
        })
      }

      /** 这张牌还在发牌队里：要么正压着卡堆等放行，要么这一轮该给它排一次起飞。 */
      const dealing = dealQueueRef.current.has(card.id)
      if (dealing && dealHoldRef.current) {
        // 过场（开局抛硬币）还盖着屏幕，这张牌先原地压在卡堆上，这一轮不给它任何补间。
        // 上一轮万一已经排过起飞——开局事件比第一次布局晚一拍到，就会这样——
        // 那条补间还没跑过，得亲手掐掉并把牌退回卡堆位，否则它会在过场演着的时候自己跑起来。
        const scheduled = dealTweensRef.current.get(card.id)
        if (scheduled !== undefined) {
          scheduled.kill()
          dealTweensRef.current.delete(card.id)
          if (dealStart !== null) gsap.set(slot, dealStart)
        }
        gsap.set(slot, { zIndex: index + 1 })
        return
      }

      const push = pushes[index] ?? 0

      // 层级永远只有"右边的牌压住左边的"这一个固定顺序（和炉石一致），hover 和返程都不改它。
      //
      // 早先的做法是把放大的牌顶到最上层、缩回去的时候再放回原来那层。但 zIndex 没法补间，
      // 这个"放回去"必然是瞬间完成的，而且正好落在牌已经缩回原位、和邻牌重叠面积最大的那一帧，
      // 看着就是闪一下。把切换挪到别的时刻、或者拆成多次小切换都只是把闪烁挪个地方而已。
      // 现在改成靠位置解决遮挡：邻牌让到放大卡的轮廓外边去，谁也压不着谁，层级就不用动了。
      // 正在施放的那张要压住整排（它抬起来了，邻牌不让位，靠层级不被压住）。
      gsap.set(slot, { zIndex: isCasting ? CASTING_Z : index + 1 })

      const vars: gsap.TweenVars = isCasting
        ? // 只往上抬一点、不放大：放大就又把战场挡住了，而选目标时战场正是要看的地方。
          { x: base.x, y: base.y - CASTING_LIFT, rotation: base.rotation, scale: slotScale(1) }
        : isHovered
          ? { x: base.x, y: HOVER_BOTTOM, rotation: 0, scale: slotScale(HOVER_SCALE) }
          : { x: base.x + push, y: base.y, rotation: base.rotation, scale: slotScale(1) }
      vars.duration = mode === 'hover' ? HOVER_DUR : LAYOUT_DUR
      vars.ease = isHovered ? 'back.out(1.4)' : 'power3.out'
      // 快速扫过多张牌时，旧补间要被新补间干净地接管，不能各改各的。
      vars.overwrite = 'auto'
      // 选目标期间只有正在施放的那张亮着，其余整排压暗；不在选目标态时这一行就是把
      // opacity 补回 1（新牌进场那条 0 → 1 的淡入也是靠它跑完的）。
      vars.opacity = casting !== null && !isCasting ? CASTING_DIM : 1
      if (dealing) {
        // 上一条还没跑过的进场补间要亲手换掉（理由见 dealTweensRef）。
        const scheduled = dealTweensRef.current.get(card.id)
        if (scheduled !== undefined) {
          scheduled.kill()
          dealTweensRef.current.delete(card.id)
        }
        vars.delay = reduce ? 0 : dealSeq * DEAL_STAGGER
        dealSeq += 1
        // 起飞才算离开卡堆：延迟那段时间里牌还压在堆上，数字不能提前减。
        vars.onStart = () => finishDeal(card.id)
      }
      const tween = gsap.to(slot, vars)
      if (dealing) dealTweensRef.current.set(card.id, tween)

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

    // 新排上队的牌攒到这儿一次报完：一张一张报的话，开局那 5 张会白白惊动父组件 5 次。
    if (dealAdded > 0) reportDealPending()
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
      // 拖到一半被卸载不用在这里管：useCardDrag 自己会在卸载时收尾（清落点高亮、停跟随补间）。
      return () => {
        detachTilts()
        placedRef.current.clear()
        // 卸载时 useGSAP 会 revert 掉这些补间、onStart 再也不会跑，发牌的账得自己清干净，
        // 否则严格模式下的二次挂载会带着上一份队列继续记数。
        // 刻意不报最后一次张数：这时父组件多半也正在卸载。
        for (const tween of dealTweensRef.current.values()) tween.kill()
        dealTweensRef.current.clear()
        dealQueueRef.current.clear()
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
      if (lockTipTimerRef.current !== null) clearTimeout(lockTipTimerRef.current)
    }
  }, [])

  const cancelLeaveTimer = () => {
    if (leaveTimerRef.current === null) return
    clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = null
  }

  const handleEnter = contextSafe((id: string) => {
    // 只要鼠标还按着（不管进没进入拖拽，所以判的是 pressedId 而不是 draggingId）就不接 hover：
    // 指针被 capture 之后，各浏览器发不发、什么时候发边界事件并不统一，
    // 与其猜它们的行为，不如在这里挡掉。
    // 松手时若指针确实已经不在牌上，浏览器会补一发 leave，hover 状态自己就对上了。
    if (cardDrag.pressedId() !== null) return
    // 冻结期间连抬牌都不接（见 frozen）。注意不能靠 pressedId 那道闸代劳：
    // 冻结时 useCardDrag 在 pointerdown 就返回了，pressedId 恒为 null，那道闸形同虚设。
    if (frozenRef.current) return
    cancelLeaveTimer()
    if (hoverRef.current === id) return
    hoverRef.current = id
    applyLayout('hover')
  })

  const handleLeave = contextSafe((id: string) => {
    // 同 handleEnter：按着的时候一律不动 hover 状态。
    if (cardDrag.pressedId() !== null) return
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
    // 热区平时是 visibility: hidden，根本吃不到指针；但冻结那一刻已经显形的那张牌，
    // 热区还要淡 0.2 秒才关掉 visibility，这段空窗里指针挪进去仍然能翻一次面。
    // 对应的 leave 不加闸：翻回正面这种"收回去"的动作冻结期照做不误。
    if (frozenRef.current) return
    const inner = innerOf(id)
    if (inner) flipTo(inner, 180, 0.4)
  })

  const handleHelpLeave = contextSafe((id: string) => {
    const inner = innerOf(id)
    if (inner) flipTo(inner, 0, 0.4)
  })

  const clearLockTipTimer = () => {
    if (lockTipTimerRef.current === null) return
    clearTimeout(lockTipTimerRef.current)
    lockTipTimerRef.current = null
  }

  /**
   * 把小字提示挪到某张牌正上方，淡入停一会儿再淡出。
   *
   * 文案在这里现写而不是交给 JSX 跟着 lockReason 渲染：淡出还要跑 0.25s，
   * 锁要是正好在这段时间里换了（对方回合 → 答题）或者解开了，React 会当场把字换掉甚至清空，
   * 玩家眼睁睁看着一句自己没点出来过的话在那儿淡出。写死在触发那一刻，淡出的就是那句话。
   *
   * 位置用两个 getBoundingClientRect 相减而不是直接拿 slot 的 rect：灰墨态下根节点整排
   * 下沉了 12px（CSS 的 transform），两个 rect 都是变换之后的视口坐标，相减才得到
   * 提示相对根节点的偏移——直接用 slot 的视口坐标写进 left / top，提示会再往下掉 12px。
   * 相减的结果还要除以舞台缩放：两个 rect 是屏幕像素，而 left / top 写的是舞台内像素。
   * 居中和"贴着牌顶往上长"交给 GSAP 的 xPercent / yPercent，不写 CSS 的 translate：
   * GSAP 接管 transform 时会往内联样式里写 translate: none，把独立变换属性压死。
   */
  const showLockTip = contextSafe((slot: HTMLElement, reason: HandLockReason) => {
    const tip = lockTipRef.current
    const root = rootRef.current
    if (tip === null || root === null) return
    tip.textContent = LOCK_TIP_TEXT[reason]
    const slotRect = slot.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const { scale } = battleStageMetrics()
    gsap.set(tip, {
      left: (slotRect.left + slotRect.width / 2 - rootRect.left) / scale,
      top: (slotRect.top - rootRect.top) / scale - LOCK_TIP_GAP,
      xPercent: -50,
      yPercent: -100,
    })
    gsap.fromTo(
      tip,
      { autoAlpha: 0, y: 8 },
      { autoAlpha: 1, y: 0, duration: 0.18, ease: 'power2.out', overwrite: true },
    )
    // 连点同一张牌时重新计时，提示不会因为上一次的计时到点而在刚弹出来时就消失。
    clearLockTipTimer()
    lockTipTimerRef.current = window.setTimeout(() => {
      lockTipTimerRef.current = null
      gsap.to(tip, { autoAlpha: 0, duration: 0.25, overwrite: true })
    }, LOCK_TIP_HOLD_MS)
  })

  /**
   * 出不了牌的时候按了一下手牌（useCardDrag 那边被 enabled 挡掉的那记按下）。
   *
   * 反馈在组件内部做完，不上抛给父组件：父组件既不知道牌摆在哪，也没有理由为一次
   * "什么都没发生"的点击重渲染整排手牌。
   *
   * 摇头做在 tilt 层的 z 轴 rotation 上：那一层现有的 quickTo 只写 rotationX / rotationY，
   * z 轴空着；slot 层的扇形摆位和 hover 放大则完全不碰，摇完牌还停在原处。
   * frozen 期间不摇（屏幕上正演着别的东西，再抖一下只是添乱），但小字提示照给——
   * 只要 lockReason 非空，玩家就该知道现在在等什么。
   */
  const handleLockedPress = contextSafe((id: string) => {
    const slot = slotsRef.current.get(id)
    if (slot === undefined) return
    const tilt = slot.querySelector<HTMLElement>('.hand-fan__tilt')
    if (tilt !== null && !frozen && !prefersReducedMotion()) {
      gsap.to(tilt, {
        keyframes: [
          { rotation: -3 },
          { rotation: 2.4 },
          { rotation: -1.6 },
          { rotation: 0.8 },
          { rotation: 0 },
        ],
        duration: 0.35,
        ease: 'power2.out',
      })
    }
    if (lockReason !== null) showLockTip(slot, lockReason)
  })

  /** 解锁那一下整排牌的回弹，从左到右挨个来。传进来的是每张牌的 tilt 层，顺序即扇形从左到右。 */
  const playWake = contextSafe((tilts: HTMLElement[]) => {
    gsap.to(tilts, {
      keyframes: [
        { y: -6, duration: 0.12, ease: 'power2.out' },
        { y: 0, duration: 0.14, ease: 'power2.inOut' },
      ],
      stagger: 0.04,
    })
  })

  /**
   * 把光标位置换算成 slot 的 x / y 目标值（交给 useCardDrag 当跟随目标）。
   *
   * slot 的坐标原点是锚点 .hand-fan 的底边中点、y 向下为正，变换原点又在卡牌底边中点，
   * 所以放大 DRAG_SCALE 之后卡牌中心跑到了原点上方 DRAG_SCALE × 卡高 / 2 处，
   * 想让这个中心对准光标就得把这段距离补回来。
   * 这里的 DRAG_SCALE 和 CARD_HEIGHT 都是**显示尺寸**那套口径（拖着的牌看起来有 1.1 × 225 高），
   * 和 slot 盒子实际有多大无关——盒子被放大、scale 被 slotScale 折算，两下正好抵消。
   *
   * 坐标系要先从视口换算到舞台：.hand-fan 是 fixed，而对局页的 .battle-scaler 带着
   * transform，fixed 的包含块因此是舞台那 1672×941 的盒子，slot 的 x / y 也是舞台内像素；
   * 指针给的 clientX / clientY 却是缩放之后的屏幕像素。不换算的话窗口一旦不是设计尺寸，
   * 牌就会离光标越来越远（换算口径见 ui/battleStage.ts）。
   */
  const dragTargetOf = (clientX: number, clientY: number) => {
    const point = toStagePoint(clientX, clientY)
    return {
      x: point.x - battleStageWidth() / 2,
      y: point.y - battleStageHeight() + (DRAG_SCALE * CARD_HEIGHT) / 2,
    }
  }

  /** 让一张牌补间回扇形里自己的位置（拖拽取消、或者出牌被父组件拒了）。 */
  const returnToFan = () => {
    // 用 layoutRef 而不是直接调 applyLayout：这个函数也会在 requestAnimationFrame
    // 回调里被调到，那时已经出了 contextSafe 的同步区间，补间得靠它才能归到 context 里。
    layoutRef.current('reflow')
  }

  /**
   * 抓起一张牌时扇形自己要做的事：把 hover 那一套收干净，再让剩下的牌合拢。
   *
   * useCardDrag 保证这里跑在它换拖拽姿态（转正、放大、接管跟随）之前，
   * 所以下面建的这些补间不会被它那一发 killTweensOf 顺手杀掉。
   */
  const handleDragStart = (drag: CardDragInfo) => {
    // 先告诉父组件"这张牌被拖起来了"：要选目标的技能牌一离手，场上的合法目标就该亮起来。
    onDragStateChange?.(drag.id)
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

    // 这时 cardDrag.draggingId() 已经是这张牌，applyLayout 会把它从队里摘掉，
    // 剩下的牌按"少了一张"重算扇形、自己合拢。
    applyLayout('hover')
  }

  /**
   * 打出之后的兜底：下一帧这张牌要是还在手牌里，就说明父组件没受理，得把占用记录还回去，
   * 否则之后再打它会被 playedRef 的防重复挡住，怎么点都没反应。
   *
   * 出牌被受理的话，React 会在这一帧结束前把这张牌从 DOM 里摘掉，slotsRef 的记录跟着没。
   * 下一帧它还在，只有两种可能：父组件当场拒了（不是自己的出牌轮、局面已经结束……），
   * 或者按 props 文档的约定打开 disabled 去等网络回包。
   * 前者要立刻收拾干净，否则牌会僵在原地再也拖不动——父组件拒绝时往往根本不改 state，
   * 也就不会有下一次 reflow 来兜底；后者只能等，判据就是 disabledRef
   * （闭包里的 disabled 是松手那一刻的旧值，父组件是在 onPlay 里才改的），
   * 之后由 disabled 关掉时的 layout effect 接手决定送不送回去。
   *
   * settle 只有拖拽那条路要开：牌被挪到落点上了，得补间回扇形；
   * 点击那条路压根没挪过 slot，原地就是正确位置。
   */
  const restoreIfRejected = (id: string, settle: boolean) => {
    requestAnimationFrame(() => {
      if (!slotsRef.current.has(id)) return
      if (disabledRef.current) return
      playedRef.current.delete(id)
      if (settle) returnToFan()
    })
  }

  const handleDrop = (drag: CardDragInfo) => {
    playedRef.current.add(drag.id)
    // 拖拽已经结束，先把高亮通知收掉再交给父组件：onPlay 里父组件八成要改自己的状态，
    // 让它一次性看到"没在拖了"更省事。它要判这次是拖出来的还是点出来的，看 via 参数。
    onDragStateChange?.(null)
    // 父组件在这一步里同步截取 Flip 状态、或者量这张牌落在了谁身上，
    // 所以此刻 slot 必须还停在松手那一刻的拖拽位置——useCardDrag 已经在调过来之前
    // 把跟随补间停掉了。
    onPlay(drag.id, 'drag')
    restoreIfRejected(drag.id, true)
  }

  /** 拖拽没成（落在别处、被 disabled、被浏览器中断）：收掉高亮通知，把牌送回扇形。 */
  const handleDragCancel = () => {
    onDragStateChange?.(null)
    returnToFan()
  }

  /**
   * 按下之后原地松手（没走过拖拽阈值），等价于直接打出这张牌——不用真的拖进战场。
   *
   * 这时 slot 还停在点击前的扇形/hover 位置，onPlay 里查 DOM 拿到的就是这个位置当飞行起点，
   * 不需要专门归位，也不存在"落在别处"的取消场景。
   * disabled 期间走不到这里：useCardDrag 那边已经挡掉了。
   */
  const handleTap = (id: string) => {
    if (playedRef.current.has(id)) return
    playedRef.current.add(id)
    onPlay(id, 'tap')
    restoreIfRejected(id, false)
  }

  /**
   * 两块落点交给拖拽内核。数组顺序就是判定优先级：指针同时压在两块上时算战场。
   *
   * “放回手牌”区 accepts 为 false，只吃高亮、不改判定——反正没落进战场的都会飞回手牌。
   */
  const dropZones: CardDropZone[] = [
    { ref: dropZoneRef },
    ...(returnZoneRef ? [{ ref: returnZoneRef, accepts: false }] : []),
  ]

  const cardDrag = useCardDrag({
    zones: dropZones,
    // frozen 是 effectiveDisabled 的超集：冻结期间连拖带点一律不受理。
    enabled: !effectiveDisabled && !frozen,
    // 拖拽建的补间要和布局补间归进同一个 useGSAP context，卸载时才会被一起 revert 掉。
    contextSafe,
    targetOf: dragTargetOf,
    // slot 的盒子已经按 HOVER_SCALE 放大过了，写给 GSAP 的 scale 得折算回去（见 slotScale）。
    dragScale: slotScale(DRAG_SCALE),
    // 问号热区上按下不算抓牌，它只管翻面。
    ignoreSelector: '.hand-fan__help',
    // 已经打出、正在等父组件受理的牌不能再抓起来（防重复出牌）。
    canDrag: (id) => !playedRef.current.has(id),
    onDragStart: handleDragStart,
    onDrop: handleDrop,
    // 落在别处（包括拖回手牌上方）、拖到一半被 disabled、被浏览器中断，都是取消，一律回扇形。
    onCancel: handleDragCancel,
    onTap: handleTap,
    // 被上面那个 enabled 挡掉的按下：出不了牌也得让玩家看见"我收到了这一下"。
    onLockedPress: handleLockedPress,
  })

  /**
   * 禁用解除时的异步确认收尾：父组件在 onPlay 里打开 disabled 去等回包，
   * 这段时间牌停在落点上；解除时牌要是还在手牌里，说明这次出牌没被受理，
   * 这时才把它送回扇形。
   *
   * 落点区高亮同样得跟着立刻变（禁用期间松手一律按取消算，
   * 那就连"正在拖牌"的 ready 都不该亮，更不能亮成"松手就打出"的 hot），
   * 但那件事归 useCardDrag 自己的 effect 管，这里不用碰。
   *
   * 用 layout effect 而不是 useEffect：restoreIfRejected 的 rAF 兜底要读 disabledRef，
   * 而 passive effect 不保证赶在下一帧的 rAF 之前跑完。
   */
  useLayoutEffect(() => {
    disabledRef.current = effectiveDisabled
    if (effectiveDisabled) return
    for (const id of playedRef.current) {
      // 牌已经不在手牌里 = 父组件受理了这次出牌，没什么要收拾的
      // （playedRef 里的记录由 applyLayout 的 reflow 清理）。
      if (!slotsRef.current.has(id)) continue
      playedRef.current.delete(id)
      returnToFan()
    }
  }, [effectiveDisabled])

  /**
   * frozen 打开的那一刻，把已经抬起来的那张牌主动收回扇形。
   *
   * 只在 handleEnter 加闸是不够的：hoverRef 不清空的话，冻结期间的一次 resize
   * 或者一次手牌增减（出牌成功那次 cards 变化必然落在冻结期内）都会重排一遍，
   * 那张牌会被重新摆回放大位。
   *
   * 要收拾的东西和抓起牌时（handleDragStart）是同一份：
   * 停掉延迟缩回的定时器 → 清 hoverRef（顺带关掉这张牌的倾斜跟随，attachCardTilt 的
   * enabled 判的就是它）→ 让倾斜和高光归零 → 重排回基准位。
   * 翻到背面的牌转正、问号热区淡出这两件事由 applyLayout 自己收（见那里）。
   *
   * 倾斜必须显式 reset：cardTilt 只在 pointermove / pointerleave 时归零，而冻结时玩家的指针
   * 往往就停在那张牌上不动，两个事件一个都不会来，倾斜角和高光会原地冻住。
   *
   * frozen 关掉时刻意什么都不做：浏览器不会为"指针原本就停在某张牌上"补发一次 pointerenter，
   * 这里猜着抬一张起来反而更怪，等玩家动一下鼠标自然就恢复了（和 disabled 现有的行为一致）。
   */
  useLayoutEffect(() => {
    if (!frozen) return
    cancelLeaveTimer()
    const hovered = hoverRef.current
    if (hovered === null) return
    hoverRef.current = null
    tiltsRef.current.get(hovered)?.reset()
    layoutRef.current('hover')
  }, [frozen])

  /**
   * 进出选目标态时重排一次：那张牌要抬起来单独亮着，或者从抬起的位置落回扇形。
   *
   * 和上面那段 frozen 的收尾分工不同，两个都要留着：那段只在"当时有牌被抬起来"时才重排
   * （它管的是收 hover），而这里两个方向都必须重排一次，不然点出去的牌不会抬起来、
   * 取消之后也落不回去。指针八成还停在这张牌上，hover 一并清掉——
   * 选目标态下父组件同时会打开 frozen，之后也不会再有新的 hover 进来。
   * 用 layout effect：抬起和压暗要和这一帧一起出现，不能等到下一帧再跳一下。
   */
  useLayoutEffect(() => {
    cancelLeaveTimer()
    hoverRef.current = null
    layoutRef.current('hover')
  }, [castingId])

  /** 上一次的 dealHold，用来认出"憋着的发牌被放开"这一个瞬间（React 不给上一次的 props）。 */
  const prevDealHoldRef = useRef(dealHold)
  /**
   * 开局的抛硬币演完了：重排一次，把压在卡堆上的那几张牌依次放出去。
   *
   * 只在这个值真的变了才动手。挂载那一次不用管：useGSAP 的回调已经跑过一遍布局，
   * 这里再跑一次只会把刚排好的进场补间掐掉重排一遍，白忙一趟。
   * 用 layout effect 而不是 useEffect：起飞和这一帧一起发生，不会先空一帧再开始飞。
   */
  useLayoutEffect(() => {
    if (prevDealHoldRef.current === dealHold) return
    prevDealHoldRef.current = dealHold
    layoutRef.current('reflow')
  }, [dealHold])

  /** 上一次的 lockReason，用来认出"锁解开了"这一个瞬间（React 不给上一次的 props）。 */
  const prevLockReasonRef = useRef(lockReason)
  /**
   * 锁一变就收掉小字提示；从"锁着"变成"解开"时再让整排牌醒一下。
   *
   * 提示说的是"现在在等什么"，等的事情一换（对方回合 → 答题）它就过期了，
   * 留在屏幕上会指向一件已经结束的事。
   *
   * 醒一下是从左到右挨个轻弹，只为把"能出牌了"这件事送进余光里——玩家这段时间多半在看战场，
   * 手牌那排恢复彩色是个静态变化，不动一下很容易整轮都没注意到。
   * 弹的是 tilt 层的 y：slot 层归扇形摆位和拖拽管，碰了就会和它们的补间打架。
   *
   * 但"锁清空"不等于"能出牌了"，所以还要再看一眼 effectiveDisabled 和 frozen，有一个真就不弹：
   * 一是对局打完或中断（status 变 finished / aborted），那时 lockReason 跟着清空，
   * 可 actionsLocked 仍然是真，这时候说"能出牌了"是句假话；
   * 二是演出还没收尾（frozen），屏幕上正演着别的东西，再抖一排牌只是添乱
   *（和 handleLockedPress 里不摇头是同一个道理）。
   */
  useEffect(() => {
    const prev = prevLockReasonRef.current
    prevLockReasonRef.current = lockReason
    if (prev === lockReason) return
    clearLockTipTimer()
    const tip = lockTipRef.current
    if (tip !== null) gsap.to(tip, { autoAlpha: 0, duration: 0.2, overwrite: true })
    if (prev === null || lockReason !== null) return
    if (effectiveDisabled || frozen) return
    if (prefersReducedMotion()) return
    const tilts = cards
      .map((card) => slotsRef.current.get(card.id)?.querySelector<HTMLElement>('.hand-fan__tilt'))
      .filter((tilt): tilt is HTMLElement => tilt !== null && tilt !== undefined)
    if (tilts.length > 0) playWake(tilts)
    // 依赖只列 lockReason：cards 在这里只当"现在有哪几张牌"的快照用，
    // 抽一张牌就重播一次醒来是错的；effectiveDisabled / frozen 同理，要的正是
    // "锁清空那一次渲染"时它们的值，之后它们自己再变不该补一次回弹。
  }, [lockReason])

  return (
    // --hand-card-zoom 是 slot 盒子的放大倍数，CSS 那边全靠它算宽高和 zoom；
    // 值来自 HOVER_SCALE（按扇形几何算出来的），所以只能由 JS 传下去。
    // data-casting 只管一件样式：把整个扇形抬到全屏压暗层之上，正在施放的那张才亮得起来
    //（同排其余的靠上面那份 opacity 自己压暗）。不接指针那件事归 frozen 管，不写在 CSS 里。
    // data-locked 是灰墨态的总开关（整排下沉、牌面褪色、光标收回箭头），全在 CSS 里做，
    // 走的属性（根节点的 transform、卡面的 filter）GSAP 一个都不碰，不会和补间抢。
    // 它和 data-casting 不会同时出现：选目标只发生在自己回合，那时 lockReason 必是 null。
    <div
      className="hand-fan"
      ref={rootRef}
      data-casting={castingId === null ? undefined : 'true'}
      data-locked={lockReason === null ? undefined : lockReason}
      style={{ '--hand-card-zoom': HOVER_SCALE } as CSSProperties}
    >
      {cards.map((card) => {
        const dragBindings = cardDrag.bind(card.id)
        return (
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
            {...dragBindings}
            /*
            指针已经在牌上、却没抬起来的那些情况，全靠 move 补一次 hover：
            浏览器只在指针跨过边界时发 enter，而"指针没动、牌自己变了"的场合它一次都不发——
            解冻那一刻（frozen 期间的 enter 被挡掉了）、重排把另一张牌挪到指针底下、
            出牌后手牌合拢，都是这样。补上之后玩家动一下鼠标牌就抬起来，不用先挪出去再挪回来。
            拖拽的 move 要先跑（它管跟随），而且必须写在 dragBindings 之后才盖得住它的同名 prop。
            handleEnter 自己会挡掉按着不放和已经 hover 的情况，move 这么密也不会白跑补间。
          */
            onPointerMove={(event) => {
              dragBindings.onPointerMove(event)
              handleEnter(card.id)
            }}
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
              靠的是传给 useCardDrag 的 ignoreSelector），样子全交给上面 inner 里那两个圆圈。

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
        )
      })}

      {/*
        点了一张出不了的牌时弹出来的小字提示。整排共用这一个节点、常驻 DOM：
        每张牌各挂一个的话，同一句话会在 DOM 里躺五份，而同一时刻最多只看得见一条。
        默认 visibility: hidden（GSAP 的 autoAlpha 会连它一起改），位置由 showLockTip 现算。
        这里刻意渲染成空的：文案也归 showLockTip 在按下那一刻写进去（理由见那里）。
        交给 React 跟着 lockReason 渲染的话，锁一变字就当场换掉或清空，而淡出还要再跑 0.25s。
      */}
      <div className="hand-fan__lock-tip" ref={lockTipRef} aria-hidden="true" />
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
 * 具名 AI 叠加原设计的 Token 圆章、技能简称和模型铭牌；完整技能牌原画直接展示；
 * 没有专属原画的卡继续使用渐变信息层。
 * AI 牌的 Token 沿用原稿、仍只展示；已实现技能牌原画上的费用已经接入规则引擎。
 */
export function HandCardFace({ card }: { card: HandCardData }) {
  const definitionId = card.definitionId ?? card.id
  const face = card.kind === 'ai' ? AI_MODEL_FACE[definitionId] : undefined
  const illustratedSkill = card.kind === 'skill' && isIllustratedSkillCard(definitionId)
  return (
    <div
      className={`card-face card-face--${card.kind}`}
      role={illustratedSkill ? 'img' : undefined}
      aria-label={illustratedSkill ? `${card.name}。${card.text}` : undefined}
    >
      {/* 普通插画的信息由文字层提供；完整技能牌的烘焙文字通过外层 aria-label 朗读。
          draggable 关掉是因为原生图片拖拽会把出牌的拖拽整个截走。 */}
      <img
        className="card-face__art"
        src={card.art ?? cardArtFor(definitionId)}
        alt=""
        draggable={false}
      />
      {face ? (
        <CardFaceOverlay cost={aiModelTokenCost(definitionId)} skillName={face.skillName} name={card.name} accent={face.accent} />
      ) : illustratedSkill ? null : (
        <div className="card-face__body">
          <div className="card-face__name">{card.name}</div>
          <p className="card-face__text">{card.text}</p>
          <div className="card-face__stats">
            {/* AI 牌印模型名，技能牌和英雄牌印卡种：这一行的作用就是一眼分清场上站的是谁。 */}
            <span>{faceStamp(card)}</span>
          </div>
        </div>
      )}
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

/**
 * 卡面底部那一行印什么。
 *
 * AI 牌印模型名（没填就退回"AI"，卡面上留空比印错更难看），其余按卡种印两个字。
 */
function faceStamp(card: HandCardData): string {
  if (card.kind === 'ai') return card.model ?? 'AI'
  return card.kind === 'hero' ? '英雄' : '技能'
}
