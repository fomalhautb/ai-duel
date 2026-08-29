/**
 * 炉石式扇形手牌：纯 DOM + GSAP，没有画布。
 *
 * 组件只管"一排牌怎么摆、怎么抬、怎么拖"，不关心牌从哪来、打出去之后发生什么。
 * 出牌有两条路：把牌拖进 dropZoneRef 指的那块区域再松手，或者原地轻点一下
 * （按下松开，没走过拖拽阈值）。两条路最后都是喊一声 onPlay，组件自己不区分是哪种触发的，
 * 只把是哪一种（via: 'drag' | 'tap'）一起报上去。打出的卡要飞到哪个容器由父组件决定
 * （见 MatchStage 里的 Flip 用法），因为跨容器的 FLIP 必须由同时看得见
 * "手牌"和"战场"的那一层来做。
 *
 * 鼠标和触屏共用同一套指针事件，只有四处按 pointerType 分开，都写在各自的代码旁边：
 *
 * 1. **轻点的后果不同**（见 handleTap）：鼠标点一下就打出；触屏点一下只是把牌**选中**，
 *    牌抬起放大、顶上冒出一颗「打出」，再点那颗才真的打出。手指划过屏幕太容易蹭出一次点击，
 *    而出牌不可撤销，所以触屏多一步确认；鼠标点哪儿是哪儿，多一步只是拖慢节奏。
 * 2. 触屏按住即抬起放大——不用特意做，浏览器在按下时就发 pointerenter。
 * 3. 触屏拖拽时把牌抬到手指上方，免得手指盖住卡面（见 dragTargetOf 和 TOUCH_DRAG_LIFT）。
 * 4. 卡面的倾斜跟随和高光在触屏上整个关掉（见 ui/cardTilt.ts），问号从"移入翻面"
 *    换成"点一下翻面"（见 handleHelpToggle）。
 *
 * 一张牌的 transform 拆成三层，每层只管一件事（详见下面 JSX 里的注释）：
 * slot 管扇形摆位和拖拽跟随（x / y / rotation / scale），
 * .hand-fan__tilt 管跟着指针的三维倾斜（rotationX / rotationY），
 * .hand-fan__inner 管翻到背面的 3D 翻转（rotationY 180°）。
 *
 * 新牌进场是"从侧栏那摞牌堆飞到自己的扇形槽位"：起点由父组件通过 getDealOrigin 给，
 * 飞行本身就是那张牌的第一次布局补间（位移 + 从牌堆那么小放大到手牌尺寸）。
 * 拿不到起点时退回原来的"从基准位下方淡入"。飞行途中不翻面：这里的背面是玩家主动翻牌才看到的
 * 详情面——AI 牌是名称加专属技能，技能牌是效果说明——不是牌堆或对手手牌的隐藏牌背。
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
 * 「这一张现在打不出去」是另一条线：传 tokens 之后逐张判，只压暗那几张，
 * 见 HandFanProps.tokens。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { cardArtFor } from './cardArt'
import { midFor } from './cardArtThumb'
import { CardHelpMark } from './CardHelpMark'
import { isIllustratedSkillCard } from './skillCardArt'
import { AI_MODEL_FACE } from './aiModelFace'
import { CardFaceOverlay } from './CardFaceOverlay'
import { PlaqueButton } from './PlaqueButton'
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
 * AI 牌的 skillName / skillText 来自 core，正面铭牌和详情背面必须共用；
 * backText 是其他牌翻面时的补充说明，由调用方自己拼文案。
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
  /** AI 牌的专属技能名；技能牌和英雄牌不用这两个字段。 */
  skillName?: string
  /** AI 牌的专属技能效果。 */
  skillText?: string
  /** 卡面正面的描述文案。 */
  text: string
  /** 非 AI 牌翻到背面时展示的补充说明。 */
  backText: string
  /**
   * 打出这张牌要花的 Token，卡面左上角那枚费用章画的就是它。
   *
   * 数值来自 core 的卡牌定义，不在客户端另存一份（见 ui/aiModelFace.ts 的说明）。
   * 英雄牌没有费用这回事，所以它是可选的。
   */
  tokenCost?: number
  /** 卡面插画地址；不填时按定义 id 查找原画，其余卡牌使用占位图。 */
  art?: string
}

/**
 * 这次出牌是怎么触发的：拖进落点区松手，还是点出来的（鼠标轻点 / 触屏选中后点「打出」）。
 *
 * 组件自己不区分这两条路（对它来说都是"打出去了"），但父组件可能要区分：
 * 要选目标的技能牌拖出去是"松手落在谁身上就打谁"，点出来则是进选目标态等玩家再点一次。
 * 拖拽那条路调 onPlay 时牌正停在松手位置，父组件可以就地量它落在哪；
 * 'tap' 那条路牌还停在扇形里被抬起的位置，一步都没挪过。
 * 触屏那颗「打出」不单开一档 via：对父组件来说它和鼠标轻点是同一件事，
 * 多一档只会让每个判 via 的地方都要多写一个分支。
 */
export type CardPlayVia = 'drag' | 'tap'

/**
 * 手牌被锁住的原因，也就是"为什么现在出不了牌"。
 *
 * 只收那些会持续一整段时间、玩家会盯着看的等待（轮到对方、AI 在答题、正在发牌），
 * 不收 disabled 里那些一闪而过的瞬态锁（等回包、牌正在飞、展示层演着）——
 * 那些锁在自己回合里也会反复开关，跟着它们把整排手牌染灰再恢复就是在闪。
 * 判据由父组件给（见 MatchStage 的 waitingForFoe / quizWait / dealing）。
 *
 * 'deal' 比另外两档短（开局约 1 秒、每轮补牌约半秒），但它不是瞬态锁：
 * 发牌是强制过场，一轮只发生一次，而且时机固定——开局那次从挂载就亮着，
 * 每轮那次直接从 'quiz' 接过来（灰墨态一路不断，落地才一起解开），不会一闪一闪。
 */
export type HandLockReason = 'foe-turn' | 'quiz' | 'deal'

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
   * 玩家打出了某张牌（拖进落点区松手，或者点出来的）。父组件负责把这张牌从手牌里移走。
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
   * 现在出不了牌是因为"在等一段流程走完"（轮到对方、AI 在答题、正在发牌），
   * 非空即进入灰墨态：整排下沉褪色、光标收回箭头、点一下会摇头并弹一条小字提示。
   *
   * 传了 lockReason 就等于同时传了 disabled：组件内部把两者并起来用，不指望调用方
   * 记得两个都给——否则漏给 disabled 就会得到一排画成灰墨态、却照样拖得动的牌。
   * 之所以不干脆合成一个 prop：disabled 里那些一闪而过的瞬态锁不该染灰整排手牌，
   * 两者的时间尺度不一样，理由见 HandLockReason。
   */
  lockReason?: HandLockReason | null
  /**
   * 这一轮还剩多少 Token。费用（HandCardData.tokenCost）超过它的牌单独画成"打不起"：
   * 卡面压暗、拖不动也点不出，按一下摇个头并弹一句「Token 不够」。
   *
   * 和 lockReason 那种"整排一起锁"是两回事，两者可以同时成立：轮到自己出牌时整排是亮的，
   * 但最贵的那一两张仍可能打不出。判断逐张做，其余的牌照常能拖。
   *
   * 传 null / 不传就是**不做费用判断**（对手的倒扇形只负责显示张数，图鉴也没有额度可言）。
   */
  tokens?: number | null
  /**
   * 这张牌现在**实际**要扣多少 Token，只影响上面那条"打不起"的判断。
   *
   * 卡面印的 `tokenCost` 是原价，而局面里可能有减费（「核电站」本轮全场便宜 1 点、可叠加），
   * 两者能差好几点。变灰的判据必须和引擎扣费用同一个口径，否则玩家会看到
   * "明明还剩 3 点、卡面写 4 点的牌却是灰的"，而那张牌其实打得出去。
   *
   * 不传就按卡面原价判：对局之外的地方（图鉴、演示页）没有局面可问。
   */
  playCostOf?: (card: HandCardData) => number
  /**
   * 调用方额外锁上的几张牌：**牌的 id（对局里就是手牌实例 id）** → 点它时弹的那句提示。
   *
   * 现在只有新手教程用：教学的前两轮只放行指定的那一两张牌，其余的一律锁住
   * （规格 §15）。挂进下面那张 blocked 表就自动获得和「Token 不够」同一套压暗 + 摇头 + 弹提示，
   * 不用另写一条锁的画法，也不会出现"点了没反应"。
   *
   * 优先级排在规则判据之前：一张牌既被教程锁着又刚好买不起时，玩家该看到的是
   * "这一步不该打它"，而不是"钱不够"。
   */
  extraBlocked?: ReadonlyMap<string, string> | null
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
   * 给"屏幕正被一整层全屏过场（z-index 1100）盖着"的时刻用，这时候发牌等于发给遮罩看，
   * 玩家一张都瞧不见。现在有两处：开局等抛硬币演完、每轮结算的补牌等答题揭晓层退场
   *（见 MatchStage 的 dealHeld）。
   */
  dealHold?: boolean
  /**
   * 还压在卡堆上、没起飞的新牌张数变了。
   *
   * 父组件把它和局面里的剩余张数相加当卡堆上的数字，开局那 5 张才是从 20 一张张数下去的
   *（见 MatchStage 的 dealPending）。不关心这件事的调用方不传即可。
   */
  onDealPendingChange?: (count: number) => void
  /**
   * "进场动画还没全部落地"这件事变了（只在变化沿通知，不是每帧报）。
   *
   * 和上面那个 onDealPendingChange 是**两个不同的信号**，别混：那个在牌起飞的瞬间就销账
   *（卡堆上的数字必须那时候减），而这个要等最后一张真的落进扇形槽位才变回 false。
   * 父组件拿它锁住整段发牌期间的操作（见 MatchStage 的 dealBusy / actionsLocked）——
   * 牌还在半空中时就能出牌的话，手牌会一边飞一边被打出去。
   *
   * 被 dealHold 压着的牌也算 busy：牌已经进了 cards、只是还没开始演。
   */
  onDealBusyChange?: (busy: boolean) => void
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
 * 触屏拖拽时把牌整体往上抬多少（舞台内像素），让手指托在卡的下边缘而不是压在卡脸上。
 *
 * 取"拖拽尺寸下的半张卡高"，也就是手指正好落在卡的下沿：再少一点手指就开始盖住卡面，
 * 再多一点牌会飘得离手太远、瞄准全靠猜。鼠标不抬——光标只有几个像素，挡不住什么。
 *
 * 抬起来之后有一处连带影响要知道：落点判定看的是**指针**在不在战场矩形里
 * （useCardDrag 那边），而选目标的命中判定看的是**牌自己的中心**（MatchStage 的 dropTargetOf）。
 * 于是触屏上"手指还在战场里、牌已经压在对手那张小卡上"是正常状态，也正是想要的——
 * 玩家瞄的是牌，不是自己的指尖。战场落点区下沿离屏幕底边还有 250px（--battle-hand-zone-h），
 * 比这里抬的距离宽裕，手指够得进去。
 */
const TOUCH_DRAG_LIFT = (DRAG_SCALE * CARD_HEIGHT) / 2

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
  deal: '发牌中…',
}
/** 这一轮剩下的 Token 买不起这张牌时弹的小字。 */
const UNAFFORDABLE_TIP_TEXT = 'Token 不够'

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
 * 不能拿舞台宽、也不能直接拿战场那一栏的宽了事：扇形两侧各压着一块 z-index 30 的 UI，
 * 都画在手牌（20）之上，手牌一多，扇形那一端就整片钻到它底下去——
 * 左边是整条不透明的侧栏（战场左沿就是它的右沿），右边是悬在右下角的「结束出牌」按钮。
 *
 * 扇形以锚点 .hand-fan 的中线为对称轴摊开，而锚点已经在 CSS 里让开侧栏、对着战场居中了，
 * 所以这里量的是"中线到左右两个障碍物的距离"，取较小的那个再翻倍：
 * 按窄的那侧算，宽的那侧自然也放得下。设计尺寸下右侧是窄的那边——
 * 中线在 x=989，到战场左沿 306 有 683，到按钮左沿 1456 只有 467，可用宽度因此是 934。
 *
 * 返回值是舞台内坐标（和 fanMath 的那套像素同一口径），所以量到的视口矩形要除以 scale
 * 换算回来，见 ui/battleStage.ts。量不到锚点或战场（比如手牌被搬到别的页面上用）
 * 就退回舞台宽，那种情况下 battleStage 会给出"没有舞台"的口径，也就是视口宽。
 */
function fanAreaWidth(anchor: DOMRect | null): number {
  const stageWidth = battleStageWidth()
  const field = document.querySelector('.battle__battlefield')
  if (anchor === null || field === null) return stageWidth

  const fieldRect = field.getBoundingClientRect()
  if (fieldRect.width === 0) return stageWidth

  // 按钮在别的页面上没有；量不到就只受战场右沿约束，也就是"右边没人挡"。
  const endTurn = document.querySelector('.battle__end-turn')?.getBoundingClientRect()
  const rightEdge =
    endTurn === undefined || endTurn.width === 0 ? fieldRect.right : endTurn.left

  const center = anchor.left + anchor.width / 2
  return (Math.min(center - fieldRect.left, rightEdge - center) * 2) / battleStageMetrics().scale
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
 * 拿理论值算的话，牌的起飞点会比卡堆低 12px；而发牌本身就是一档灰墨态
 *（lockReason 的 'deal'），整段飞行里整排一直是沉着的，这一笔必然踩上。
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
  tokens = null,
  playCostOf,
  extraBlocked = null,
  frozen = false,
  lockReason = null,
  castingId = null,
  onDragStateChange,
  getDealOrigin,
  dealHold = false,
  onDealPendingChange,
  onDealBusyChange,
}: HandFanProps) {
  /**
   * 组件内部真正用的"出不了牌"：lockReason 非空自带禁用，不指望调用方另外把 disabled 也打开。
   *
   * 组件里凡是读"现在能不能出牌"的地方一律用这一份，disabled 这个 prop 只在这里读一次。
   * 光靠约定的话，哪天有人只给 lockReason 就会得到一排画成灰墨态、却照样拖得动的牌。
   */
  const effectiveDisabled = disabled || lockReason !== null
  /**
   * 这一刻打不出去的那几张牌：id → 点它时该弹的那句提示。
   *
   * 判据只剩「Token 不够」一条（AI 牌和技能牌都不限张数），但仍然收进一张表里：
   * canDrag 和渲染两条路问的是同一个问题「这张现在能不能打」，只是一个要理由、一个只要压暗。
   * 用 Map 而不是每处现算：tokens 每出一张牌就变，整排都要重判一次。
   *
   * 调用方给的 extraBlocked 排在最前面，理由见那个 prop 的说明。
   */
  const blocked = useMemo(() => {
    const tips = new Map<string, string>()
    for (const card of cards) {
      const extra = extraBlocked?.get(card.id)
      if (extra !== undefined) {
        tips.set(card.id, extra)
      } else if (tokens !== null && card.tokenCost !== undefined) {
        // 没给 playCostOf 就按卡面印的原价判（图鉴、演示页这类没有减费概念的地方）。
        const cost = playCostOf === undefined ? card.tokenCost : playCostOf(card)
        if (cost > tokens) tips.set(card.id, UNAFFORDABLE_TIP_TEXT)
      }
    }
    return tips
    // 刻意不把 playCostOf 列进依赖：它每次渲染都是个新函数，列了等于每次都重算一遍。
    // 它读的那份局面（剩余额度、核电站的减免）一变，tokens 必然跟着变
    // ——减免和金钟罩都是打出一张牌才会变的，而打牌就要扣 Token，靠 tokens 当变化沿够用。
  }, [cards, tokens, extraBlocked])
  const rootRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef(new Map<string, HTMLDivElement>())
  /** 灰墨态下点牌弹出来的那条小字提示。整排共用这一个节点，位置按被点的牌现算。 */
  const lockTipRef = useRef<HTMLDivElement>(null)
  /** 小字提示的停留计时器。重复点牌要重置它，卸载时要清掉。 */
  const lockTipTimerRef = useRef<number | null>(null)
  /** 当前被 hover 的牌。放在 ref 里而不是 state，避免每次移入移出都重渲染整排手牌。 */
  const hoverRef = useRef<string | null>(null)
  /**
   * 触屏轻点选中的那张牌：它一直保持抬起放大，顶上挂着一颗「打出」，点了才真出牌。
   * 鼠标那条路点一下就直接打出，永远不会走到这里，所以桌面上这一份恒为 null。
   *
   * 这一份不能像 hover 那样只放 ref——按钮是要渲染出来的，得有 state 来触发重渲染。
   * 同时又必须留一份 ref：applyLayout 常常是上一次渲染留下的闭包（理由见 frozenRef），
   * 读 state 会读到过期的值。两份永远一起改，统一走 setSelected。
   */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
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
   * 发牌那几个 prop 的最新值。理由同 frozenRef：applyLayout 常常是上一次渲染留下的闭包，
   * 而 dealHold 变化时 cards 没变、闭包不会刷新；几个回调则会被延迟很久才调到。
   *
   * dealHoldRef 必须在**渲染期间**就写好（不能挪进 effect）：父组件是把 dealHold 和新手牌
   * 放在同一次提交里送过来的（回合末补牌就是这样），而下面那个 useGSAP 是 layout effect，
   * 它跑 applyLayout 时读的就是这一份。写进 passive effect 的话它会晚一步，
   * applyLayout 拿到的还是上一次的 false，牌会在遮罩后面白飞一趟。
   */
  const dealHoldRef = useRef(dealHold)
  dealHoldRef.current = dealHold
  const dealOriginRef = useRef(getDealOrigin)
  dealOriginRef.current = getDealOrigin
  const dealPendingRef = useRef(onDealPendingChange)
  dealPendingRef.current = onDealPendingChange
  const dealBusyRef = useRef(onDealBusyChange)
  dealBusyRef.current = onDealBusyChange
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
  /**
   * 进场动画还没演完的牌（含还压在卡堆上等放行的）。
   *
   * 和 dealQueueRef 的分界线不一样，两份都要留着：那一份在牌**起飞**时就销账
   *（卡堆上的数字得那时候减），这一份要等牌真的**落位**才销账，父组件靠它锁操作。
   */
  const dealBusySetRef = useRef(new Set<string>())
  /** 上一次报给父组件的 busy，用来只在变化沿通知（不然每次布局都会白惊动一次）。 */
  const dealBusyReportedRef = useRef(false)
  /** 给 resize 监听和延迟回位用：它们要拿到最新一次渲染的布局函数。 */
  const layoutRef = useRef<(mode: LayoutMode) => void>(() => {})

  /** 把"还压着几张"报给父组件。没人关心时什么都不做。 */
  const reportDealPending = () => dealPendingRef.current?.(dealQueueRef.current.size)

  /** 把"进场动画演完没有"报给父组件，只在变化沿报一次。 */
  const reportDealBusy = () => {
    const busy = dealBusySetRef.current.size > 0
    if (busy === dealBusyReportedRef.current) return
    dealBusyReportedRef.current = busy
    dealBusyRef.current?.(busy)
  }

  /** 这张牌的进场动画演完了（或者不会再演了）。重复调用是安全的。 */
  const finishDealBusy = (id: string) => {
    if (!dealBusySetRef.current.delete(id)) return
    reportDealBusy()
  }

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
   * 加正反两面各一个的问号圆章（.hand-fan__help-mark，只管样子）。
   * 它们必须一起淡入淡出，否则会出现"看得见问号但点不动"或者反过来的错位。
   * 拿不到槽位（牌刚被打出去）时返回空数组，调用方都先判了长度。
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
    // 锚点这一份矩形两处都要：一处是扇形摊多宽（fanAreaWidth 拿它的中线当对称轴），
    // 一处是发牌飞行的起点（灰墨态下整排是沉着的，见 dealStartVars）。量不到锚点就都退回兜底。
    const anchorRect = rootRef.current?.getBoundingClientRect() ?? null
    const areaWidth = fanAreaWidth(anchorRect)
    // 走 ref 不走闭包：这个函数常常是上一次渲染留下的那一份（见 castingIdRef）。
    const casting = castingIdRef.current
    const ids = new Set(cards.map((card) => card.id))
    /**
     * 减少动效时不做发牌飞行：起点取 null，新牌退回原来那段"从基准位下方淡入"，
     * 也不排队错开（下面的 delay 一并压成 0）。
     */
    const reduce = prefersReducedMotion()
    const dealOriginRect = reduce ? null : (dealOriginRef.current?.() ?? null)
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
      // 选中的那张牌离开了手牌（打出去了、或者被测试面板弃掉了）：选中状态跟着作废，
      // 否则那颗「打出」会挂在一张已经不存在的牌的位置上。
      // 这里直接写两份而不是调 setSelected：重排本来就正在进行，不用再触发一次。
      if (selectedIdRef.current !== null && !ids.has(selectedIdRef.current)) {
        selectedIdRef.current = null
        setSelectedId(null)
      }
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

    // 只有会被排布到的牌才可能有进场补间在跑；离开手牌、被拖起来、已经打出去等结果的牌
    // 这一轮不会拿到任何补间，也就再没有谁替它们销账，留在账上会把父组件的锁挂死。
    const laidIds = new Set(laid.map((card) => card.id))
    for (const id of dealBusySetRef.current) if (!laidIds.has(id)) dealBusySetRef.current.delete(id)

    // 冻结期间一律按"没有 hover"排布。下面那个 frozen 的 layout effect 会把 hoverRef 清掉，
    // 但重排的入口不止一处（resize、手牌增减都会走到这里），冻结和清空之间隔着一次提交；
    // 中间这次重排要是照旧读 hoverRef，就会把那张牌又补间回放大位。
    // 选中的那张牌即便指针早就离开也要一直抬着：它顶上挂着「打出」，落回扇形就点不到了。
    // hover 排在前面不会和选中打架——指针进到别的牌上时 handleEnter 会先把选中清掉，
    // 所以这两份最多只可能同时指着同一张牌。
    const hoveredId = frozenRef.current ? null : (hoverRef.current ?? selectedIdRef.current)
    const hoverIndex = hoveredId === null ? -1 : laid.findIndex((card) => card.id === hoveredId)
    // 邻牌要让到 hover 那张牌放大后的轮廓之外；放大不改 x，所以让位量只跟基准位有关，
    // 全部在 neighborPushes 里按几何算好。
    const pushes = neighborPushes(hoverIndex, count, areaWidth)

    laid.forEach((card, index) => {
      const slot = slotsRef.current.get(card.id)
      if (!slot) {
        // 没有节点就没有补间，也就不会有 onComplete 来销账；不在这儿清掉的话锁会一直挂着。
        finishDealBusy(card.id)
        return
      }

      const base = fanTransform(index, count, areaWidth, PLAYER_FAN)
      const isCasting = card.id === casting
      // 选目标态下父组件会一并打开 frozen，上面那行已经把 hover 抹平了；
      // 判 isCasting 优先只是兜底，免得哪天两个开关没一起给，这张牌又被摆成放大的样子。
      const isHovered = !isCasting && index === hoverIndex
      const isNew = !placedRef.current.has(card.id)
      if (isNew) {
        placedRef.current.add(card.id)
        dealQueueRef.current.add(card.id)
        dealBusySetRef.current.add(card.id)
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
        // 全屏过场（开局抛硬币 / 回合末的答题揭晓）还盖着屏幕，这张牌先原地压在卡堆上，
        // 这一轮不给它任何补间。上一轮万一已经排过起飞——开局事件比第一次布局晚一拍到，
        // 就会这样——那条补间还没跑过，得亲手掐掉并把牌退回卡堆位，
        // 否则它会在过场演着的时候自己跑起来。
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
      // 进场还没落地的牌：这条补间跑完就算落地了。收尾要挂在**每一条**补间上，不能只挂进场那条——
      // 飞到一半来一次重排（hover、resize、手牌增减）时，旧补间会被 overwrite: 'auto' 掐掉，
      // 它的 onComplete 再也不会跑，账只能由接管它的这条新补间来销，否则父组件的锁永远解不开。
      if (dealBusySetRef.current.has(card.id)) vars.onComplete = () => finishDealBusy(card.id)
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
    // busy 是个布尔，上面加加减减完统一看一眼变没变（reportDealBusy 自己只在变化沿通知）。
    reportDealBusy()
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
        // busy 反过来必须报最后一次：父组件拿它锁着操作，只卸载这一排扇形（对局还在）时
        // 不报的话锁就永远挂在那儿了。父组件也在卸载的话这一次 setState 是空转，无害。
        dealBusySetRef.current.clear()
        reportDealBusy()
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

  /**
   * 换掉当前选中的那张牌（传 null 就是取消选中），顺手重排一次。
   *
   * ref 和 state 一起写：排布读 ref（applyLayout 常是上一次渲染的闭包），按钮的渲染读 state。
   * 重排走 layoutRef 而不是直接调 applyLayout，理由同 returnToFan——
   * 这个函数也会在事件回调之外被调到（几个 effect、document 上那个"点别处取消"的监听）。
   */
  const setSelected = (id: string | null) => {
    if (selectedIdRef.current === id) return
    selectedIdRef.current = id
    setSelectedId(id)
    layoutRef.current('hover')
  }

  /**
   * 发牌进场演完之前一律不动 hover 状态。
   *
   * 发牌期间父组件只给 disabled、不给 frozen（frozen 一变就要重排，重排会亲手掐掉
   * 正在飞的进场补间），所以上面那道 frozenRef 的闸拦不住 hover。而 hover 会调
   * applyLayout('hover')，那一下正好把发牌搅烂：正在飞的牌被改判成放大姿态，半空里弹一下；
   * 还在等 stagger 的牌被 kill 重排，dealSeq 从头数，剩下几张的延迟一起塌掉，
   * duration 也被压成更短的 HOVER_DUR。
   *
   * 以前碰不到是因为发牌全程藏在全屏过场后面，指针够不着；现在发牌特意等到过场退场才飞，
   * 而揭晓层退场那一瞬玩家的鼠标往往正落回手牌区，扇形重排也会把牌滑到静止的光标底下，
   * 两种都会实打实地发出 pointerenter。
   *
   * 落地之后不主动补一次抬牌：浏览器不会为"指针原本就停在那儿"补发 pointerenter，
   * 玩家动一下鼠标就恢复了，和 frozen 关掉时的处理是同一个口径。
   */
  const dealAnimating = () => dealBusySetRef.current.size > 0

  const handleEnter = contextSafe((id: string) => {
    // 只要鼠标还按着（不管进没进入拖拽，所以判的是 pressedId 而不是 draggingId）就不接 hover：
    // 指针被 capture 之后，各浏览器发不发、什么时候发边界事件并不统一，
    // 与其猜它们的行为，不如在这里挡掉。
    // 松手时若指针确实已经不在牌上，浏览器会补一发 leave，hover 状态自己就对上了。
    if (cardDrag.pressedId() !== null) return
    // 冻结期间连抬牌都不接（见 frozen）。注意不能靠 pressedId 那道闸代劳：
    // 冻结时 useCardDrag 在 pointerdown 就返回了，pressedId 恒为 null，那道闸形同虚设。
    if (frozenRef.current) return
    if (dealAnimating()) return
    cancelLeaveTimer()
    if (hoverRef.current === id) return
    // 指针进到另一张牌上 = 玩家改主意了，上一张的选中（连同那颗「打出」）当场作废。
    // 不然屏幕上会同时有两张抬起来的牌，而按钮还挂在其中一张的头上。
    // 直接写两份不走 setSelected：下面紧接着就要重排，不用为它单独再排一次。
    if (selectedIdRef.current !== null && selectedIdRef.current !== id) {
      selectedIdRef.current = null
      setSelectedId(null)
    }
    hoverRef.current = id
    applyLayout('hover')
  })

  const handleLeave = contextSafe((id: string) => {
    // 同 handleEnter：按着的时候一律不动 hover 状态。
    if (cardDrag.pressedId() !== null) return
    // 同 handleEnter：发牌演完之前不动 hover。这里也要挡——进场那一下没被受理，
    // 对应的 leave 再去排一次缩回补间就是凭空多出来一次重排。
    if (dealAnimating()) return
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

  /**
   * 触屏点一下问号：正面翻过去，再点一下翻回来。
   *
   * 触屏没有 hover 可用——按下发 pointerenter、抬手发 pointerleave，照着 hover 那套做
   * 就成了"按住才看得见背面"，手一松就翻回正面，字都没读完。所以这边改成点一次翻一次。
   * 翻回来另有一条兜底：牌不再被抬起时 applyLayout 会把它转正（见那里），
   * 所以取消选中、或者指针挪到别的牌上，都不会留下一张背面朝上的牌。
   *
   * 判"现在是哪一面"读的是元素当前的实际角度，和 flipTo 内部的口径一致：
   * 翻到一半再点也能接着往回转，不用另记一份状态。
   */
  const handleHelpToggle = contextSafe((id: string) => {
    if (frozenRef.current) return
    const inner = innerOf(id)
    if (inner === null) return
    const facingBack = Number(gsap.getProperty(inner, 'rotationY')) >= 90
    flipTo(inner, facingBack ? 0 : 180, 0.4)
  })

  const clearLockTipTimer = () => {
    if (lockTipTimerRef.current === null) return
    clearTimeout(lockTipTimerRef.current)
    lockTipTimerRef.current = null
  }

  /**
   * 把小字提示挪到某张牌正上方，淡入停一会儿再淡出。
   *
   * 文案由调用方在按下那一刻传进来，而不是交给 JSX 跟着 lockReason 渲染：淡出还要跑 0.25s，
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
  const showLockTip = contextSafe((slot: HTMLElement, text: string) => {
    const tip = lockTipRef.current
    const root = rootRef.current
    if (tip === null || root === null) return
    tip.textContent = text
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
   * 出不了牌的时候按了一下手牌：摇个头，再按需在牌顶弹一句为什么。
   * 两种情况共用——整排锁着（轮到对方、AI 在答题），或者只有这一张打不起。
   *
   * 反馈在组件内部做完，不上抛给父组件：父组件既不知道牌摆在哪，也没有理由为一次
   * "什么都没发生"的点击重渲染整排手牌。
   *
   * 摇头做在 tilt 层的 z 轴 rotation 上：那一层现有的 quickTo 只写 rotationX / rotationY，
   * z 轴空着；slot 层的扇形摆位和 hover 放大则完全不碰，摇完牌还停在原处。
   * frozen 期间不摇（屏幕上正演着别的东西，再抖一下只是添乱），但小字提示照给——
   * 只要有话要说，玩家就该知道现在是怎么回事。tip 传 null 表示只摇头不说话。
   *
   * 唯一整个跳过的是"这张牌自己还在飞"：小字提示的位置是按牌当场的矩形算死的，
   * 牌接着飞走，那句话就孤零零地停在半路上；对一张正在飞的牌摇头也不知道在摇什么。
   * 只看被按的这一张——同一次发牌里先落地的那几张已经停稳了，照常给反馈。
   */
  const refusePlay = contextSafe((id: string, tip: string | null) => {
    const slot = slotsRef.current.get(id)
    if (slot === undefined) return
    if (dealBusySetRef.current.has(id)) return
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
    if (tip !== null) showLockTip(slot, tip)
  })

  /** 整排锁着的时候按下了某张牌（被 useCardDrag 的 enabled 挡掉的那一记）。 */
  const handleLockedPress = (id: string) =>
    refusePlay(id, lockReason === null ? null : LOCK_TIP_TEXT[lockReason])

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
  const dragTargetOf = (clientX: number, clientY: number, drag: CardDragInfo) => {
    const metrics = battleStageMetrics()
    const point = toStagePoint(clientX, clientY, metrics)
    const anchor = rootRef.current?.getBoundingClientRect()
    /*
     * 原点的横坐标是锚点的横向中线，它不等于舞台中线：锚点让开了左侧栏、对着战场居中
     *（见 styles.css 的 .hand-fan），设计尺寸下在 x=989 而不是 836。
     *
     * 只现量横向、纵向照旧用舞台底边那个理论值，是有意的：锚点身上那份 CSS transform
     * 只写 translateY（灰墨态整排下沉 12px，见 styles.css 的 .hand-fan[data-locked]），
     * 还带 0.45s 过渡，纵向现量会在过渡那几百毫秒里给出一个正在移动的原点，拖着的牌跟着漂。
     * 横向那一维没人动过，现量是安全的。
     */
    const originX =
      anchor === undefined || anchor.width === 0
        ? battleStageWidth() / 2
        : (anchor.left + anchor.width / 2 - metrics.left) / metrics.scale
    // 触屏再往上抬半张卡：手指本身有一指宽，压在卡中心就把要看的东西全挡住了，
    // 抬完手指托在卡的下沿，牌整个露在指尖上方（推导和连带影响见 TOUCH_DRAG_LIFT）。
    const lift = drag.pointerType === 'mouse' ? 0 : TOUCH_DRAG_LIFT
    return {
      x: point.x - originX,
      y: point.y - battleStageHeight() + (DRAG_SCALE * CARD_HEIGHT) / 2 - lift,
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
    // 选中态和拖拽是两条互斥的出牌路：牌已经在手上了，那颗「打出」没有存在的意义，
    // 留着还会跟着牌一起满屏飞。直接写两份不走 setSelected：这个函数末尾本来就要重排一次。
    selectedIdRef.current = null
    setSelectedId(null)
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
   * settle 问的是"这次出牌有没有把牌挪离它在扇形里该在的位置"，三个调用点各自回答：
   *
   * - 拖拽：牌停在松手的落点上，要 true；
   * - 触屏那颗「打出」：牌被抬起放大着，而且这时它已经进了 playedRef、排布会整个跳过它，
   *   没人替它回位，也要 true。触屏尤其不能省——那边没有 pointerleave，
   *   指望玩家挪一下指针把牌"蹭"回去是不成立的；
   * - 鼠标轻点：slot 一步没挪过（还停在 hover 抬起的位置，指针也还压在上面），false。
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
   * 真正把一张牌打出去。鼠标轻点和触屏那颗「打出」共用这一段。
   *
   * 顺序是有讲究的——先记进 playedRef（防重复），再清选中态，最后才 onPlay：
   * 清选中态会重排一次，而这时这张牌已经在 playedRef 里，排布会把它整个跳过（见 laid 那里），
   * 于是它一动不动地留在原处，正好当父组件 Flip 飞行的起点；同排其余的牌趁这一下先合拢。
   * 反过来先 onPlay 的话，父组件在回调里同步改的状态会先带来一次重渲染，
   * 那颗按钮多留一帧，看着像点了没反应。没有选中态时 setSelected 直接返回，不多排一次。
   *
   * 这里不判 disabled / frozen：两条调用路各自已经挡过了（鼠标那条由 useCardDrag 的 enabled 挡，
   * 按钮那条根本不会被渲染出来）。
   */
  const playCard = (id: string, settle: boolean) => {
    if (playedRef.current.has(id)) return
    playedRef.current.add(id)
    setSelected(null)
    onPlay(id, 'tap')
    restoreIfRejected(id, settle)
  }

  /**
   * 按下之后原地松手（没走过拖拽阈值）。**鼠标和触屏在这里分道扬镳**，出牌这条路上仅此一处：
   *
   * - 鼠标：直接打出。光标是尖的、点哪儿是哪儿，误点概率低，再插一步确认只是拖慢节奏。
   * - 触屏：只是**选中**——牌抬起放大不再落回去，顶上冒出一颗「打出」，点那颗才真出牌。
   *   手指划过屏幕太容易在牌上蹭出一次点击，而出牌不可撤销，这一步确认是必须的。
   *   再点一次同一张就是取消选中：手指已经在这张牌上了，想收回来最顺手的就是再点一下。
   *
   * 判据用这次按下的 pointerType 而不是设备类型：带触屏的笔记本用鼠标时走的仍是鼠标那条。
   * disabled / frozen 期间两条都走不到：useCardDrag 那边已经挡掉了。
   */
  const handleTap = (id: string, drag: CardDragInfo) => {
    // 鼠标那条不用 settle：slot 一步没挪过（还停在 hover 抬起的位置），原地就是正确位置。
    if (drag.pointerType === 'mouse') {
      playCard(id, false)
      return
    }
    // 已经打出、正在等父组件受理的牌不该再被选中：那颗按钮会让人以为还能再打一次。
    if (playedRef.current.has(id)) return
    setSelected(selectedIdRef.current === id ? null : id)
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
    // 这两块小控件上按下都不算抓牌：问号只管翻面，「打出」只管出牌。
    // 不排掉的话，按在按钮上会先起一次拖拽/选中，click 还没来选中态就被自己翻掉了。
    ignoreSelector: '.hand-fan__help, .hand-fan__play',
    // 两道各自的闸：已经打出、正在等父组件受理的牌不能再抓（防重复出牌），
    // 这一刻打不出去的牌（见 blocked）也抓不起来。后者要给反馈，所以在这里就地摇头弹提示——
    // canDrag 挡掉的按下不会走 onLockedPress（见 UseCardDragOptions 那边的说明）。
    canDrag: (id) => {
      if (playedRef.current.has(id)) return false
      const tip = blocked.get(id)
      if (tip !== undefined) {
        refusePlay(id, tip)
        return false
      }
      return true
    },
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
    if (effectiveDisabled) {
      // 现在出不了牌了（轮到对方、正在发牌、指令发出去等回包…）：那颗「打出」点了也没用，
      // 选中态一起收掉，牌落回扇形。等能出牌了玩家再点一次就是了。
      setSelected(null)
      return
    }
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
    const selected = selectedIdRef.current
    if (hovered === null && selected === null) return
    hoverRef.current = null
    selectedIdRef.current = null
    setSelectedId(null)
    // 倾斜只有被 hover 的那张才挂着；靠选中抬起来的那张指针早就不在上面，没有倾斜要收。
    if (hovered !== null) tiltsRef.current.get(hovered)?.reset()
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
    // 选中态也一起清：这张牌已经打出去了（正在等玩家指目标），它顶上不该还挂着一颗「打出」。
    selectedIdRef.current = null
    setSelectedId(null)
    layoutRef.current('hover')
  }, [castingId])

  /**
   * 选中期间点到手牌以外的任何地方 = 取消选中。
   *
   * 触屏上这是唯一顺手的"我不打了"：手指没有 hover，牌只要不落回去就会一直举在那儿。
   * 挂在 document 上而不是某块遮罩上——选中态刻意不压暗也不拦指针（玩家常常要一边举着牌
   * 一边看战场），所以根本没有一块现成的层能接这一下。
   * 用 pointerdown 而不是 click：按下那一刻就该收，等 click 的话手指按住不放期间牌还举着。
   * 只在真选中了什么的时候才挂监听，平时 document 上什么都不留。
   */
  useEffect(() => {
    if (selectedId === null) return
    const onOutsidePress = (event: PointerEvent) => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return
      setSelected(null)
    }
    document.addEventListener('pointerdown', onOutsidePress)
    return () => document.removeEventListener('pointerdown', onOutsidePress)
  }, [selectedId])

  /** 上一次的 dealHold，用来认出"憋着的发牌被放开"这一个瞬间（React 不给上一次的 props）。 */
  const prevDealHoldRef = useRef(dealHold)
  /**
   * 盖着屏幕的那层过场演完了（开局是抛硬币，回合末是答题揭晓）：
   * 重排一次，把压在卡堆上的那几张牌依次放出去。
   *
   * 只在这个值真的变了才动手。挂载那一次不用管：useGSAP 的回调已经跑过一遍布局，
   * 这里再跑一次只会把刚排好的进场补间掐掉重排一遍，白忙一趟。
   * 用 layout effect 而不是 useEffect：起飞和这一帧一起发生，不会先空一帧再开始飞。
   *
   * 反方向（false → true）也会走到这里再排一次，同样是必要的：回合末那次 hold 和新手牌
   * 是同一次提交送来的，上面 useGSAP 那一遍已经按 dealHold 压住了，这里只是白排一遍；
   * 但万一父组件分两次提交送过来（先来牌、后来 hold），就靠这一遍把已经排出去的进场补间收回。
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
   * 提示说的是"现在在等什么"，等的事情一换（对方回合 → 答题 → 发牌）它就过期了，
   * 留在屏幕上会指向一件已经结束的事。
   *
   * 醒一下是从左到右挨个轻弹，只为把"能出牌了"这件事送进余光里——玩家这段时间多半在看战场，
   * 手牌那排恢复彩色是个静态变化，不动一下很容易整轮都没注意到。
   * 弹的是 tilt 层的 y：slot 层归扇形摆位和拖拽管，碰了就会和它们的补间打架。
   *
   * 判据是"由非空变 null"，不认具体是哪一档：轮到自己那一下现在多半是从 'deal' 解开的
   *（每轮都是「答题中」→「发牌中」→ 解开，中间灰墨态一路不断），开局也一样，
   * 于是这一弹正好落在最后一张牌飞进扇形之后。
   *
   * 但"锁清空"不等于"能出牌了"，所以还要再看一眼 effectiveDisabled 和 frozen，有一个真就不弹：
   * 一是对局打完或中断（status 变 finished / aborted），那时 lockReason 跟着清空，
   * 可 actionsLocked 仍然是真，这时候说"能出牌了"是句假话；
   * 二是演出还没收尾（frozen），屏幕上正演着别的东西，再抖一排牌只是添乱
   *（和 handleLockedPress 里不摇头是同一个道理）。
   * 这一条要求父组件把两件事放在同一次提交里松开——发牌那档就是这么办的
   *（MatchStage 的 actionsLocked 和 handLockReason 读的是同一个 dealing）。
   * 差一次提交的话，这里读到的 effectiveDisabled 还是旧的真值，这一弹就白丢了。
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
    // 它和 data-casting 不会同时出现，这一条由调用方保证：选目标只发生在自己回合的出牌段，
    //「对方回合 / 答题」两档天然撞不上，「发牌」那档 MatchStage 显式排掉了选目标态
    //（测试房的 DevPanel 能在选目标途中凭空加一张手牌，不排就会同时打上两个）。
    <div
      className="hand-fan"
      ref={rootRef}
      // 教程用的语义锚点（见 tutorial/steps.ts 的 TutorialAnchorName）。
      // 写死在这里是安全的：这个组件只有对局界面在用，别处用的是 HandCardFace 或 OpponentFan。
      data-tutorial-anchor="hand"
      data-casting={castingId === null ? undefined : 'true'}
      data-locked={lockReason === null ? undefined : lockReason}
      style={{ '--hand-card-zoom': HOVER_SCALE } as CSSProperties}
    >
      {cards.map((card) => {
        const dragBindings = cardDrag.bind(card.id)
        /*
         * 能不能翻面。AI 牌不能：正面已经把要看的都印全了，翻过去没有新东西，
         * 问号只是白点一下（卡组页同一条口径，见 screens/DeckScreen.tsx 的 flippable）。
         * 问号、热区和背面整层一起不渲染——热区留着还会盖在卡右上角吃掉指针。
         */
        const flippable = card.kind !== 'ai'
        return (
          <div
            key={card.id}
            className="hand-fan__slot"
            data-flip-id={card.id}
            /* 这张牌现在打不出去（Token 不够，或者本轮已经派过 AI 了）：
               只画成压暗 + 禁止光标，位置和层级一概不动
               （CSS 里只写 filter 和 cursor，都是 GSAP 碰不到的属性，见 [data-locked] 那段）。
               拖不动点不出那件事归上面 canDrag 管，不写在 CSS 里。 */
            data-unplayable={blocked.has(card.id) ? 'true' : undefined}
            ref={(el) => {
              if (el) slotsRef.current.set(card.id, el)
              else slotsRef.current.delete(card.id)
            }}
            /* 抬牌只给鼠标。触屏上手指划过手牌会一路发 enter，牌被一张张抬起来，
               看着像自己选了一堆；而真正的触屏选牌是点一下（见 handleTap），
               走的是 selectedId 那条路，和 hoverRef 无关，拦掉这里什么都不少。
               判据用这次事件的 pointerType 而不是设备类型：带触屏的笔记本用鼠标时照常抬牌。 */
            onPointerEnter={(event) => {
              if (event.pointerType !== 'mouse') return
              handleEnter(card.id)
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== 'mouse') return
              handleLeave(card.id)
            }}
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
              if (event.pointerType !== 'mouse') return
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
            AI 牌这三样（两个圆圈 + 热区）和背面整层都不渲染，见上面的 flippable。
          */}
            <div className="hand-fan__tilt">
              <div className="hand-fan__inner">
                <div className="hand-fan__face hand-fan__face--front" data-flip-face="front">
                  <HandCardFace card={card} />
                  {/* 看得见的问号圆章之一。放在这里而不是 HandCardFace 里面：
                    那个组件被战场小卡复用，而小卡没有翻面这回事，不该跟着长出一个问号。 */}
                  {flippable ? <CardHelpMark className="hand-fan__help-mark" /> : null}
                </div>
                {flippable ? (
                  <div className="hand-fan__face hand-fan__face--back" data-flip-face="back">
                    <div className={cardBackClassName(card.kind)}>
                      <span className="card-back__title">{card.name}</span>
                      <p className="card-back__text">{card.backText}</p>
                      {/* 背面也要有高光层，否则翻过去之后反光会凭空消失。
                        这一层和正面共用 --glare-x / --glare-y，位置是对的：
                        .hand-fan__face--back 自带的 rotateY(180deg) 单看是镜像，
                        而背面只有在 inner 也转过 90° 之后才显示，两个 180° 正好抵消。 */}
                      <div className="card-glare" />
                      {/* 背面同一个角上的问号圆章：翻过去之后指针底下仍然压着一个问号，
                        看起来就是"同一个问号跟着卡转到了背面"。
                        排在高光层后面，免得被那层 soft-light 混得发灰。 */}
                      <CardHelpMark className="hand-fan__help-mark" />
                    </div>
                  </div>
                ) : null}
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

              翻不了的牌（AI 牌）整个不挂它：那一块是盖在卡右上角的透明按钮，
              留着只会白吃掉指针，翻面还什么都不会发生。
            */}
              {flippable ? (
                <button
                  type="button"
                  className="hand-fan__help"
                  aria-label="查看卡牌详情"
                  /* 移入翻过去、移出翻回来只给鼠标。触屏走下面的 pointerup 点一次翻一次，
                     理由见 handleHelpToggle。 */
                  onPointerEnter={(event) => {
                    if (event.pointerType !== 'mouse') return
                    handleHelpEnter(card.id)
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType !== 'mouse') return
                    handleHelpLeave(card.id)
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerType === 'mouse') return
                    handleHelpToggle(card.id)
                  }}
                />
              ) : null}
            </div>
            {/*
              触屏轻点选中之后，浮在牌顶上方的「打出」。鼠标点一下就直接打出，
              永远不会有牌处在选中态，所以桌面上这一段一次都不会渲染。

              只有"这张牌被选中"且"现在真能出牌"时才渲染：锁上的那一刻选中态会被
              effectiveDisabled 那个 effect 清掉，这里再判一次是防两者差一帧——
              渲染的时机永远比 effect 早一拍。

              挂在 slot 里而不是整排共用一个（像 lock-tip 那样现算位置）：slot 就是这张牌，
              牌抬起来、被推开、跟着窗口缩放，按钮全都自动跟着走，一行定位代码都不用写。
              放在倾斜层**外面**是必须的：那一层有 zoom（见 CSS），按钮会跟着被放大 1.9 倍。
              这时 slot 的 scale 正好是 1（被抬起的牌就是放大到顶那一档），所以按钮是原尺寸。
            */}
            {selectedId === card.id && !effectiveDisabled && !frozen ? (
              <PlaqueButton
                className="hand-fan__play"
                /* 新手教程给这张牌挖洞时要把这颗按钮一起圈进去：它浮在卡的上方、
                   在 slot 的矩形之外，不圈进去就会被压暗层盖灰、还会被引导气泡整个压住
                   （气泡贴着洞的上沿放）。见 tutorial/TutorialOverlay.tsx 的 anchorRect。 */
                data-tutorial-extend="true"
                onClick={() => playCard(card.id, true)}
              >
                打出
              </PlaqueButton>
            ) : null}
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
 * 圆章上那个数字是引擎真扣的费用（card.tokenCost，出处在 core 的卡牌定义），
 * 主色来自 AI_MODEL_FACE；技能名来自 core，和背面技能详情共用同一份。
 */
/**
 * 一张牌翻到背面时那层容器该带哪些 class。
 *
 * 三处（对局手牌、卡池 / 牌组格子、图鉴页）画的是同一面背面，class 各写一份的话，
 * 加了新卡种的样式总会漏掉其中一处，玩家就会看到同一张牌在两个页面长得不一样。
 * AI 牌铺满整张美术卡背，技能牌铺星象边框底图再压文字，英雄牌沿用默认的深色底。
 */
export function cardBackClassName(kind: HandCardData['kind']): string {
  if (kind === 'ai') return 'card-back card-back--ai-art'
  if (kind === 'skill') return 'card-back card-back--skill'
  return 'card-back'
}

export function HandCardFace({ card }: { card: HandCardData }) {
  const definitionId = card.definitionId ?? card.id
  // 两样缺一不可：非具名 AI 查不到装饰配置，英雄牌没有费用，任缺一样都退回下面的渐变信息层。
  const face = card.kind === 'ai' ? AI_MODEL_FACE[definitionId] : undefined
  const cost = card.tokenCost
  const illustratedSkill = card.kind === 'skill' && isIllustratedSkillCard(definitionId)
  return (
    <div
      className={`card-face card-face--${card.kind}`}
      role={illustratedSkill ? 'img' : undefined}
      aria-label={illustratedSkill ? `${card.name}。${card.text}` : undefined}
    >
      {/* 普通插画的信息由文字层提供；完整技能牌的烘焙文字通过外层 aria-label 朗读。
          draggable 关掉是因为原生图片拖拽会把出牌的拖拽整个截走。

          图一律过 midFor：这个组件是全站唯一画卡面的地方（手牌、战场小卡、强制展示、
          回合结算、牌库放大查看都是它），而这些场合里卡最大也只到 524 个设备像素，
          600 宽那一档全盖得住。铺原画（1024×1536）的话每张卡都要解码 157 万像素再降采样，
          手机上是掉帧的主因之一。卡牌自带的外部图（card.art 可以是任意 URL）
          midFor 会原样放行，不用在这儿判。 */}
      <img
        className="card-face__art"
        src={midFor(card.art ?? cardArtFor(definitionId))}
        alt=""
        draggable={false}
      />
      {face !== undefined && cost !== undefined ? (
        <CardFaceOverlay
          cost={cost}
          skillName={card.skillName ?? '技能待定'}
          name={card.name}
          accent={face.accent}
        />
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
