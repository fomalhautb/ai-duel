/**
 * 组建牌组页。
 *
 * 卡池是玩家存档里已拥有的真卡（core 的 CardId，能直接进对局）。
 * 整页的存档读写走 save/deckStore.ts：加一张牌、改一次名都立刻写回 localStorage，
 * 所以界面上没有"未保存"这个状态，也没有保存按钮。
 *
 * 受控组件：不导航，「确认牌组」把当前牌组的卡 id 交给 props.onConfirm，返回走 props.onBack
 * （左上角的返回按钮，纯查看时右下角还有一颗同样调 onBack 的「返回匹配」）。
 * 于是同一个组件既能当大厅里的独立页（/deck），也能嵌进匹配后的流程（RoomScreen 的选卡组一步），
 * 还能当新手教程的组牌一步（/tutorial，多传一个 tutorial prop）。
 * 没有 initialDeck 这种 prop——预填天生来自 deckStore 里的当前牌组，这一页自己读写它，
 * 教程的 17 张预填也是同一条路：进这一页之前先把那套牌组写进 deckStore 并设为当前。
 *
 * 教程模式（DeckScreenTutorial）只做减法：除了引导指定的那张卡和「确认牌组」，
 * 其余操作（移除、加别的卡、改名、切换/新建/删除牌组、切页签、放大查看）一律挡下并喊一声，
 * 由教程去显示一句提示。不传这个 prop 的两条入口行为一字不变。
 *
 * 四块复用件：
 * - 卡面用对局那套 HandCardFace（写死 150×225）。卡池卡放大、牌组迷你卡缩小，都是在内层套一个
 *   缩放盒整体缩放（--deck-pool-scale / --deck-mini-scale），卡面自己一个像素都不用改；
 * - 每张卡的层级抄手牌那套（见 ui/HandFan.tsx 的三层分工）：外层是拖拽 / Flip 的 transform 元素，
 *   里面 __tilt 管倾斜（ui/cardTilt.ts 写 rotationX / rotationY）、__inner 管翻面
 *   （ui/flipCard.ts，由右上角的问号热区驱动），再里面是正反两个 face。
 *   两面身上的 data-flip-face 是 flipCard.ts 认人的契约。倾斜句柄按 id 存在
 *   poolTiltsRef / deckTiltsRef 里，卡增减时增量挂 / 摘（见下面那个 useGSAP）。
 *   **只有技能牌有背面这一层和那个问号**：AI 牌翻过去没有新东西（想看它那张卡背走放大查看，
 *   伴随层右边就摆着一张），即将上线的牌翻过去只是一段还没生效的效果说明，
 *   两类的问号留着都只会让人白点（见 flippable）；
 * - 拖拽用 ui/useCardDrag，卡池和牌组各一个实例，手感参数全走 hook 默认值，和对局手牌一致；
 * - 放大查看用 ui/CardZoomOverlay，这一页只有它一条链路会动遮罩，所以用组件自带的那块
 *   （不传 veilRef），点遮罩和 ESC 都能关。正面大卡落在中央偏左（落位由 deck.css 覆盖），
 *   右边由本页自己渲染的伴随层 .deck-zoom-side 摆一张同尺寸的背面大卡和一行操作。
 *   两张大卡都跟着指针倾斜（同 cardTilt.ts），落位后没有别的自发动效。
 *
 * 牌组里的顺序是玩家自己排的，所以"加在哪一格"有两套口径：拖进来的按松手时指针离哪一格
 * 最近算（insertIndexAt），点「＋」或放大层里那颗按钮的按当前视野那一页的第一格算
 * （pageInsertIndex，这样点完新牌一定在眼前）。牌组里的牌在面板里拖一下就是换位置，
 * 拖出面板才是移除。
 *
 * 从卡池拖进来的时候，落点那一格是**一路空着**的（previewGap）：牌落在指针底下，飞行几乎
 * 没有行程，不提前让出位置的话松手那一下看着就是凭空闪进去一张。牌组内部换位置没有这一手，
 * 因为被拖的那一份自己占的格子已经空着，本身就是那个空位；也不能有——重排格子会让 React
 * 把被拖的节点摘下来再插回去，浏览器当场释放 pointer capture，这次拖拽直接告吹。
 *
 * 牌组一变就补一段 Flip，不是"瞬间填进格子"：改牌组之前先量下整排格子的旧位置存进
 * pendingFlipRef（加牌时把卡池那张牌一起量进去当起点），等 React 挂完新格子再从旧位置补过来，
 * 于是让位 / 补位和那一份牌自己的飞行是同一段动画。
 *
 * 反过来，把一份牌送回卡池是同一套动作换个方向演（returnToPool + pendingPoolFlipRef）：
 * 飞的是卡池里那张真牌，起点借牌组格子里那张迷你卡的位置。落在卡池哪一格也有两套口径——
 * 拖回卡池的按松手时离哪一格最近算，点「送回」的那张卡池卡还在视野里就不动它、
 * 已经滚出去了才挪到当前这一页的最后一格；不管哪一种，卡池都跟着重排（顺序会写回存档），
 * 灰着的那两类始终排在最后、插不进去。
 * 加不进去（牌组满了 / 份数选满了 / 这张还没上线）时不是静默失败，而是摇头 + 在卡上方
 * 弹一句原因（见 refuseAdd）。三种原因由 blockReasonNow 一处判完，拖拽、「＋」、
 * 放大层那颗按钮说的是同一句话；灰着的那两类牌因此也拖不动——起拖那一下当场被掐掉，牌一动不动。
 *
 * 性能上有三处刻意的安排，改这一页时别顺手拆掉：
 * 1. 卡池卡和格子里的迷你卡各自是 React.memo 组件，传给它们的 props 全部引用稳定
 *    （回调 useCallback、拖拽事件按 id 缓存、卡数据是模块级常量），加一张牌只会重渲染
 *    受影响的那一两张，而不是整屏几十张；
 * 2. 这两处的卡面走 300 宽那一档（thumbFor）；放大查看那张卡走的是公共卡面组件，
 *    它自己吃 600 宽那一档（见 ui/cardArtThumb.ts）。原画在这一页任何地方都不再加载；
 * 3. 卡面挂了 content-visibility: auto，离屏的卡不渲染内部（见 deck.css）。
 *
 * 视觉沿用 /design 那套纸面 token：整页是羊皮纸，左边卡池是嵌在纸上的深蓝星图面板
 * （和对局界面"纸侧栏夹着深色战场"的关系一致），右边牌组面板是纸面雕花框。
 * 触屏和鼠标都要能用（口径和对局页一致，见 docs/architecture.md 1.1），但不做窄屏版式：
 * 版面锁在下面那个 16:9 舞台里，手机横屏是整块等比缩小，竖屏由全局的竖屏提示拦掉。
 * 触屏上和鼠标不一样的只有两处：卡池卡和迷你卡写 touch-action: pan-y
 * （竖滑滚列表、横拖加牌移牌，见 deck.css），同时两个拖拽 hook 都开 touchScrollGuard，
 * 让起拖判定变成"横滑或长按"、竖滑一律让给滚动（见 ui/useCardDrag.ts）；
 * 以及技能牌上那个问号从"移入翻面"换成"点一下翻一次"。
 * 另外问号和格子上那颗「×」在粗指针下常驻显示——它们原本只在 hover 时露出来，
 * 触屏永远等不到，背面就再也看不到、加进去的牌也再拿不出来。
 *
 * 版面锁在 16:9 舞台里，和对局页同一套（见 deck.css 的「16:9 舞台」一节）：排版永远按
 * 设计稿的 1672×941 走，整块画面交给 .deck-scaler 的 transform: scale() 缩到窗口里。
 * 对这个文件的直接影响只有一处——那个 transform 让 .deck-scaler 成了内部 position: fixed
 * 元素的包含块，所以 liftCardOut 写 left/top 之前要先把视口坐标换算成舞台内坐标
 * （ui/battleStage.ts）。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import {
  CARD_POOL,
  COMING_SOON_SKILL_CARD_IDS,
  getCard,
  UNAVAILABLE_AI_CARD_IDS,
} from '@ai-duel/core'
import type { CardId, HandCard } from '@ai-duel/core'
import { BackButton } from '../ui/BackButton'
import { AiCardBack } from '../ui/AiCardBack'
import { CARD_ART_PLACEHOLDERS, cardArtFor } from '../ui/cardArt'
import { midFor, thumbFor } from '../ui/cardArtThumb'
import { CardHelpMark } from '../ui/CardHelpMark'
import { CardZoomOverlay, ZOOM_IN_DUR, ZOOM_OUT_DUR } from '../ui/CardZoomOverlay'
import type { CardZoomHandle, CardZoomTarget } from '../ui/CardZoomOverlay'
import { cardBackClassName, HandCardFace } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { LoadingScreen } from '../ui/LoadingScreen'
import { OrnateFrame } from '../ui/OrnateFrame'
import { PlaqueButton } from '../ui/PlaqueButton'
import { battleStageMetrics, toStagePoint } from '../ui/battleStage'
import { attachCardTilt } from '../ui/cardTilt'
import type { CardTiltHandle } from '../ui/cardTilt'
import { cardBackText } from '../ui/cardText'
import { flipTo, setFlipAngle } from '../ui/flipCard'
import { useAssetsProgress } from '../ui/preloadAssets'
import { prefersReducedMotion } from '../ui/reducedMotion'
import { useCardDrag } from '../ui/useCardDrag'
import type { CardDragBindings, CardDragHandle } from '../ui/useCardDrag'
import { useStageScale } from '../ui/useStageScale'
import { OrnateTitle, PaperCardBack, PaperIconDefs } from '../ui/paper'
import {
  DECK_NAME_MAX,
  DECK_SIZE,
  MAX_COPIES,
  MAX_DECKS,
  createDeck,
  deleteDeck,
  loadDecks,
  renameDeck,
  setCurrentDeck,
  updateDeckCards,
} from '../save/deckStore'
import type { DecksData } from '../save/deckStore'
import { loadSave, saveOwnedOrder } from '../save/save'
import { FACTIONS, filterDeckCards } from './deckFactions'
import type { DeckFaction } from './deckFactions'
import './deck.css'

gsap.registerPlugin(useGSAP, Flip)

/**
 * 拖拽取消后把卡送回原位的补间时长。
 *
 * 只有取消才走它。卡池那张牌加入成功之后不再播归位：那一刻格子里已经多出一份牌，
 * 正从松手位置飞过去（见 pendingInsertRef），卡池位当场补回原状才是"这张变成了那一份"的语义；
 * 再补一段归位就成了两张牌同时从同一个地方各飞各的。
 */
const RETURN_DUR = 0.28

/** 卡池卡跟着指针倾斜的最大角度。比手牌小一档：这一屏卡多，幅度大了整片都在晃。 */
const POOL_TILT_DEG = 6
/** 迷你卡的倾角。卡更小，同样的角度看着更夸张，所以再收一点。 */
const MINI_TILT_DEG = 5
/** 放大查看那张大卡的倾角。 */
const ZOOM_TILT_DEG = 5

/** 问号热区翻面的时长，和手牌那份（HandFan 的 handleHelpEnter）保持一致。 */
const HELP_FLIP_DUR = 0.4

/** 新加的那一份牌从起点飞进格子的时长。挪位置（拖着牌组里的牌换顺序）走的也是这一档。 */
const INSERT_DUR = 0.4

/**
 * 拖拽途中让位 / 收位那一下的时长。比落牌那一程（INSERT_DUR）快一档：
 * 手还在拖，这一下只是"松手会落这儿"的提示，慢了会觉得界面跟不上手。
 */
const GAP_SHIFT_DUR = 0.22

/**
 * 从牌组送回卡池那一程的时长。和加入的飞行（INSERT_DUR）同一档：一来一回是同一段路，
 * 回去比来时快或慢都会显得这两件事不是互逆的。
 */
const RETURN_FLIGHT_DUR = 0.4
/**
 * 送回的替身在飞行的最后这一段里淡掉（占全程的比例）。
 *
 * 落点正好压在卡池那张牌上时其实可以硬收——两张画的是同一张卡；
 * 但落在卡池视野右下角那一档（那张牌根本不在视野里）不淡就是凭空消失，
 * 两档共用一条淡出更简单，也看不出差别。
 */
const RETURN_FADE_PORTION = 0.35
/**
 * 飞行跑完再多等这一会儿，才把卡从 fixed 切回文档流。
 * 正好卡在补间末帧切会看到一次跳动，这 0.06 秒是留给收尾的余量（同 liftCardForFlight）。
 */
const DROP_BACK_DELAY = 0.06
/**
 * 飞进格子那一程的层级。
 * 同层的其它格子都没有 z-index，飞行途中从它们上空经过时不抬一层就会被盖住。
 * 值和拖拽用的 DRAG_Z 一档，两者不会同时发生在同一张卡上。
 */
const INSERT_FLIGHT_Z = 1000
/**
 * 送回卡池那一程的层级。
 *
 * 比加入那一档（INSERT_FLIGHT_Z）再高一级：这一程要飞过整个卡池，途中会从灰着的那几张
 * 「即将上线 / 暂未接入」上空经过（它们正排在卡池末尾，也就是右下角那一带，
 * 正好是这段飞行的落点），压不过去的话最后几帧会钻到卡背后面。
 */
const RETURN_FLIGHT_Z = 1200
/** 送回落到卡池视野右下角那一档时，落点离卡池网格右下角留的余量（舞台内像素，同网格自己的内边距）。 */
const POOL_CORNER_INSET = 22

/** 放大查看的伴随层淡入淡出时长。比遮罩（0.25 / 0.3）稍快一点收，不抢卡的戏。 */
const ZOOM_SIDE_FADE = 0.25
/** 「移出牌组」时那张大卡自己先淡掉的时长，免得它跟着状态一起硬消失。 */
const ZOOM_REMOVE_FADE = 0.18

/** 提示浮字停留多久开始淡出（毫秒）。 */
const ADD_TIP_HOLD_MS = 1200
/** 提示浮字底边到卡顶的距离（舞台内像素）。 */
const ADD_TIP_GAP = 10

/**
 * 加不进牌组的两种原因。浮字提示和放大层里那行小字用的是同一句话，所以只留一份。
 */
const DECK_FULL_TIP = `牌组已满 ${DECK_SIZE} 张`
const MAX_COPIES_TIP = `同一张牌最多带 ${MAX_COPIES} 份`
/**
 * 摆在卡池里、但永远选不进牌组的那两类牌各自点上去说的话。
 * 和上面两句一样走 blockReasonNow，所以拖拽、「＋」、放大层那颗按钮都说同一句。
 *
 * 两类的界面待遇完全一样（灰着排在最后、不给问号、点了只弹一句），差的只有这句话：
 * 技能牌是产品还没开放，AI 牌是 OpenRouter 上调不到对应的模型。
 * 「暂未接入」不提 OpenRouter：玩家不关心我们从哪家调模型，只要知道这张牌上不了场。
 */
const COMING_SOON_TIP = '即将上线'
const NO_MODEL_TIP = '暂未接入'

/**
 * 选不进牌组的牌 → 它那句话。牌子上印的和点击时弹的是同一句，不另写一份。
 *
 * 用 Map 而不是两个 Set：渲染期每张卡都要问一次"你是不是选不了、要印哪句"，
 * 一次查表就都拿到了；将来再多一类选不了的牌，也只是往这儿多拼一段。
 */
const BLOCKED_CARD_LABELS = new Map<CardId, string>([
  ...COMING_SOON_SKILL_CARD_IDS.map((id): [CardId, string] => [id, COMING_SOON_TIP]),
  ...UNAVAILABLE_AI_CARD_IDS.map((id): [CardId, string] => [id, NO_MODEL_TIP]),
])

/**
 * 卡池里能摆出来的全部 id：能选的（CARD_POOL）在前，选不了的那两类在后。
 *
 * 「排序永远在最后」这条就落在这一行——不是靠排序函数，而是靠拼接顺序，
 * 后面的筛选（filterDeckCards）只做过滤、不重排，所以这个先后关系一路保持到网格上。
 */
const DISPLAY_CARD_IDS: CardId[] = [
  ...CARD_POOL,
  ...COMING_SOON_SKILL_CARD_IDS,
  ...UNAVAILABLE_AI_CARD_IDS,
]

/**
 * 一张卡里那两层的选择器。卡池卡和迷你卡的类名不一样，但要找的层是同一个角色，
 * 所以写成两个逗号选择器放在一处，免得每个调用点各记一份对照表。
 */
const TILT_LAYER_SELECTOR = '.deck-pool-card__tilt, .deck-mini__tilt'
const FLIP_LAYER_SELECTOR = '.deck-pool-card__inner, .deck-mini__inner'

/**
 * 把 core 的卡牌定义转成卡面要的展示数据。
 *
 * ui/MatchStage.tsx 里有一份同样的（handCardOfDefinition），这里是刻意抄的：
 * 那是个三千行文件里的私有函数，为这十来行去动它的导出面，牵动的比重复一份还多。
 * 两边要一起改的触发条件只有一个——HandCardData 加了卡面必须显示的新字段。
 */
function handCardOfDefinition(card: HandCard): HandCardData {
  // backText 走 ui/cardText.ts 那一份：对局和图鉴显示的是同一段话，拼法只留一处。
  const base = {
    id: card.id,
    definitionId: card.id,
    name: card.name,
    text: card.text,
    backText: cardBackText(card),
    tokenCost: card.tokenCost,
  }
  if (card.kind === 'ai') {
    return {
      ...base,
      kind: 'ai',
      model: card.model,
      skillName: card.skillName,
      skillText: card.skillText,
    }
  }
  return { ...base, kind: 'skill' }
}

/**
 * kind 页签。数组顺序就是页签从左到右的顺序。
 *
 * 页签是本页私有实现（.deck-kind 那组牌匾），没有用组件库的 PaperTabs：
 * 那份是"文字 + 下划线"的形态，改成牌匾要把它自己的下划线和菱形整套抵消掉，
 * 而 PaperTabs 还被 /design 用着，全局样式动不得。
 */
const KIND_TABS = [
  { id: 'all', label: '全部' },
  { id: 'ai', label: 'AI 牌' },
  { id: 'skill', label: '技能牌' },
] as const

type KindTabId = (typeof KIND_TABS)[number]['id']

/**
 * id → 卡（原画版）。放大查看和统计口径都读它。
 *
 * 建的是**这一页画得出的全部卡**（DISPLAY_CARD_IDS，含选不了的那两类）而不是玩家已拥有的
 * 那部分：这批 id 是编译期就定死的常量（core 的 CARDS），建成模块级常量才能保证对象身份稳定
 * ——它是传给下面两个 React.memo 卡片组件的 props，每次渲染现拼的话 memo 就永远命不中。
 * 玩家拥有哪些卡是渲染时再筛的（见 pool）。
 */
const CARD_BY_ID = new Map<CardId, HandCardData>(
  DISPLAY_CARD_IDS.map((cardId) => [cardId, handCardOfDefinition(getCard(cardId))]),
)

/**
 * id → 卡（缩略图版）。卡池格子和牌组迷你卡都画这一份。
 *
 * 卡面上那张图默认是按 id 现查的原画（1024×1536，见 HandCardFace 里的 cardArtFor），
 * 而这一页一屏就要摆几十张 150×225 的小卡（左边整个卡池 + 右边二十个格子），
 * 铺原图等于让浏览器解码几十张大图再高倍降采样。
 * 这里预先把 art 换成缩略图路径，HandCardFace 就直接用它、不再去查原画。
 * 缩略图是 scripts/gen-card-thumbs.sh 按 public/cards/ 逐张烤的，卡池里每张卡的原画
 * （具名 AI 原画或按 id 分到的占位图）都有对应产物，所以这里不用为"缺图"另写回落。
 *
 * **放大查看必须继续走 CARD_BY_ID 那份原画**：屏幕中央那张占到大半个屏幕，300 宽拉上去一眼就糊。
 */
const THUMB_CARD_BY_ID = new Map<CardId, HandCardData>(
  DISPLAY_CARD_IDS.map((cardId) => {
    const card = handCardOfDefinition(getCard(cardId))
    return [cardId, { ...card, art: thumbArtFor(cardId) }]
  }),
)

/**
 * 一张卡在这一页的缩略图地址。
 *
 * 上面那份卡表和下面的预加载清单都走这一个函数：两处各写一遍 thumbFor(cardArtFor(id)) 的话，
 * 哪天改了取图规则却只改一边，预加载等的就不是卡面真正显示的那张，白卡照旧。
 */
function thumbArtFor(cardId: CardId): string {
  return thumbFor(cardArtFor(cardId))
}

/**
 * 这一页要用到的全部图片，加载完之前不上场（见文件末尾的 DeckScreen）。
 *
 * 主要是卡池和格子里那几十张缩略图——它们是这一页唯一"铺满屏幕"的图，
 * 不等的话进页面看到的是一片白卡，然后一张张显影。
 * 放大查看用的原画不在这里：那是玩家点开某一张才用得上的，为它把进页面拖慢十几秒不划算，
 * 它们由后台预加载负责（见 ui/backgroundPreload.ts 的 CARD_ART_ASSETS）。
 *
 * 必须是模块级常量：useAssetsProgress 拿它当 effect 依赖，每次渲染现拼一个新数组会让 effect 反复重跑。
 *
 * 导出是给 ui/backgroundPreload.ts 用的：后台预加载要照着同一份清单排队，
 * 两边各写一遍迟早会对不上。
 */
export const DECK_ASSETS = Array.from(
  new Set([
    // 卡池背景那张深蓝星图，和对局的战场底图是同一张（见 deck.css 的 .deck-pool）。
    '/battle/battle-bg.webp',
    // 放大查看时右边那张技能牌背面的边框底图（见下面的 SkillCardBack）。
    // 它是这一页少数几张不走卡面的图，而且一翻开就要用，所以并进闸门一起等。
    // 走 mid 档：这张底图设计尺寸 284×426，2 倍 DPR 下 568 像素，600 宽那一档正好够。
    // 地址在下面 SkillCardBack 的 <img> 里再写一遍，两处必须是同一个 URL，否则等于没预载。
    midFor('/cards/skills/skill-card-back.webp'),
    ...DISPLAY_CARD_IDS.map(thumbArtFor),
    // 占位图的缩略图。眼下卡池里每张卡都有专属原画，谁也分不到占位图，
    // 但新卡的原画补齐之前会先落到这儿（见 ui/cardArt.ts 的 placeholderArtFor），
    // 到那时不用回来改这份清单。四张加起来 100 KB 出头，白等也不心疼。
    ...CARD_ART_PLACEHOLDERS.map(thumbFor),
  ]),
)

/**
 * 被放大的那张卡要就地藏起来，否则屏幕中央和原位会同时出现两张一模一样的卡。
 *
 * 只能用 visibility 不能用 display：位置得留着，飞回时才有落点。
 * 提到模块级是为了对象身份稳定（同 THUMB_CARD_BY_ID 的理由）。
 */
const HIDDEN_IN_PLACE: CSSProperties = { visibility: 'hidden' }

/**
 * 牌组里的一份牌。
 *
 * 存 key 而不是直接用下标当身份：同一张卡可以带好几份，而删掉中间一份会让后面所有份的下标平移，
 * React 的 key、拖拽的 id、Flip 的配对键就全跟着换了一遍，正在拖 / 正在放大的那份会被认成另一份。
 * key 只在这次会话里有效，不落盘——存档里存的是纯 id 数组，进页面时现发一轮新 key。
 */
interface DeckEntry {
  key: string
  cardId: CardId
}

/** 正在放大查看的那张卡。side 决定飞回时去哪个容器里找原位元素。 */
interface ZoomState {
  card: HandCardData
  flipId: string
  side: 'pool' | 'deck'
  /**
   * 这张卡在它那一侧的身份：卡池侧是 CardId，牌组侧是这一份牌的 entry.key。
   * 伴随层上那两颗按钮（加入 / 移出）要拿它去改牌组，光有 flipId 还得再解析一遍前缀。
   */
  sourceId: string
}

/** 卡池那张卡的 Flip 配对键。加前缀是因为同一张卡在牌组里还有一份，两边的键不能撞。 */
function poolFlipId(cardId: CardId): string {
  return `pool:${cardId}`
}

/** 牌组里那一份的 Flip 配对键。用 entry.key，所以删掉别的份不会让它换 id。 */
function deckFlipId(entryKey: string): string {
  return `deck:${entryKey}`
}

/**
 * 元素此刻的「没有 transform 时的那个框」，用舞台内坐标表示，外加它身上那截变换。
 *
 * 两个调用方都要这份换算：把牌切成 fixed（liftCardOut）、以及给送回动画摆一个替身
 * （flyBackToPool）。两处都必须做**同样**的两步换算，写成一份才不会哪天只改一边。
 *
 * 为什么要扣掉变换：getBoundingClientRect 量到的是**变换之后**的视觉框，而这截 transform
 * 在切成 fixed 之后不会消失（拖拽正是拿元素当前的 x / y 当位移基准接着用），
 * 照抄进 left / top / width / height 就等于把它算了两遍。
 * 换算回原始框之后，「新的 left/top/width/height + 留着的那截 transform」正好还是此刻的视觉位置。
 *
 * 两步的顺序不能反：rect 是视口坐标，先除掉舞台的 scale 落到舞台内坐标，
 * 才和 GSAP 的 x / y、scaleX / scaleY 处在同一套单位里，然后才谈得上把它们扣掉。
 */
function stageBoxOf(element: HTMLElement) {
  const x = Number(gsap.getProperty(element, 'x'))
  const y = Number(gsap.getProperty(element, 'y'))
  // 没写过 transform 的元素 GSAP 就返回 1，`|| 1` 只是兜住 0 / NaN 免得下面除出无穷大；
  // 真兜住了也无非退化成"只扣位移不扣缩放"，不会写出坏值。
  const scaleX = Number(gsap.getProperty(element, 'scaleX')) || 1
  const scaleY = Number(gsap.getProperty(element, 'scaleY')) || 1
  const rect = element.getBoundingClientRect()
  const metrics = battleStageMetrics()
  // 视觉中心，换到舞台内坐标。
  const center = toStagePoint(rect.left + rect.width / 2, rect.top + rect.height / 2, metrics)
  const width = rect.width / metrics.scale / scaleX
  const height = rect.height / metrics.scale / scaleY
  return {
    // 被拖的这两种元素（.deck-pool-card / .deck-mini）都没改 transform-origin，缩放是绕盒子中心
    // 往四周撑开的，所以按中心反推左上角：视觉中心减掉位移就是原中心，再退回半个原尺寸。
    left: center.x - x - width / 2,
    top: center.y - y - height / 2,
    width,
    height,
    x,
    y,
    scale: scaleX,
    rotation: Number(gsap.getProperty(element, 'rotation')),
  }
}

/** 取存档里某一套牌组的卡表；id 指不到人时按空牌组算（loadDecks 保证不会发生）。 */
function cardsOf(data: DecksData, id: string): readonly CardId[] {
  return data.decks.find((deck) => deck.id === id)?.cards ?? []
}

/** attach 之前（正常流程里不会出现）取到的空绑定，只是给类型一个交代。 */
const EMPTY_BINDINGS: CardDragBindings = {
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
  onLostPointerCapture: () => {},
}

/**
 * 按 id 缓存 useCardDrag 的 bind 结果。
 *
 * bind(id) 每次调用都新建一组事件闭包，直接写进 JSX 的话，每次渲染都会给下面那两个
 * React.memo 卡片组件换一份新 props，memo 就等于没做。
 *
 * 缓存住旧闭包是安全的：那几个处理器读到的全是 hook 内部的 ref（当前拖拽状态、最新一份
 * options）和 useGSAP 那个常驻的 contextSafe，跟它是哪一次渲染建的没有关系。
 *
 * attach 要在渲染期调（同 useCardDrag 里 optionsRef 的写法）：拖拽 hook 的回调里会用到
 * 下面定义的 addCard / removeEntry，而那些回调又要先拿到 retain，两边只能靠这个空壳先建后接。
 */
function useBindCache() {
  const bindRef = useRef<((id: string) => CardDragBindings) | null>(null)
  const cacheRef = useRef(new Map<string, CardDragBindings>())

  const attach = useCallback((bind: (id: string) => CardDragBindings) => {
    bindRef.current = bind
  }, [])

  const bindOf = useCallback((id: string): CardDragBindings => {
    const cache = cacheRef.current
    const hit = cache.get(id)
    if (hit !== undefined) return hit
    const fresh = bindRef.current?.(id) ?? EMPTY_BINDINGS
    cache.set(id, fresh)
    return fresh
  }, [])

  /**
   * 只留下还在场的 id。
   * 牌组那边每加一份牌就发一个新 key，不清的话缓存会随着一次会话里的加加减减一直长。
   */
  const retain = useCallback((ids: readonly string[]) => {
    const keep = new Set(ids)
    for (const id of cacheRef.current.keys()) {
      if (!keep.has(id)) cacheRef.current.delete(id)
    }
  }, [])

  return { attach, bindOf, retain }
}

/**
 * 新手教程挂上来的限制（规格 §15 末段：组牌阶段只能点引导指定的卡和按钮）。
 *
 * 这一层刻意只有"放行哪张卡 / 确认能不能点 / 被挡了喊一声"三件事：
 * 步骤怎么走、提示说什么全在 tutorial/ 那边，这一页对教程本身一无所知。
 * 不传这个 prop 时整页就是原来的自由编辑页（/deck 和匹配流程都走那条）。
 */
export interface DeckScreenTutorial {
  /** 这一步唯一放得进牌组的卡；null = 现在一张都不许加。 */
  allowedCardId: CardId | null
  /** 「确认牌组」能不能点。 */
  allowConfirm: boolean
  /** 被锁住的操作统一说这句话。 */
  blockTip: string
  /** 玩家点了锁住的东西，由教程去把提示显示出来（锁必须有话说，不能没反应）。 */
  onBlocked: (tip: string) => void
  /** 放行的那张卡真进牌组了，教程据此推进到下一步。 */
  onCardAdded: (cardId: CardId) => void
}

/**
 * 把「每次渲染都换一份新身份」的回调钉成一个稳定的函数。
 *
 * 专门给要往下传给那两个 React.memo 卡片组件的回调用：contextSafe 包出来的函数每次渲染
 * 都是新对象，直接传下去 memo 就永远命不中，加一张牌会重画整屏几十张卡。
 * 返回的壳子身份不变，每次调用都转给最新那一份实现，所以闭包里读到的永远是这一拍的状态。
 */
function useStable<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: A) => ref.current(...args), [])
}

export interface DeckScreenProps {
  /**
   * 满 DECK_SIZE 张点确认时回调，参数是牌组的卡 id，顺序即玩家的选牌顺序。
   * 不用在回调里落盘：这一页每改一张牌就写过 deckStore 了。
   * 不传就不渲染「确认牌组」：大厅横幅进来的是纯查看，牌组的增删本来就已经实时存档了，
   * 右下角那一格改放「返回匹配」。
   */
  onConfirm?: (deck: CardId[]) => void
  /** 不传就不渲染返回按钮：匹配之后的流程不允许退回大厅。 */
  onBack?: () => void
  /** 新手教程模式。不传 = 自由编辑，也就是这一页原本的样子。 */
  tutorial?: DeckScreenTutorial
  /**
   * 盖在整页之上的额外一层，现在只有教程的引导层。
   *
   * 必须由这里挂进 `.deck-scaler` 里面：那一层有 transform，
   * 既是层叠上下文（挂在外面的浮层压不住页内元素），
   * 也是引导层 `position: fixed` 的包含块（挂在外面坐标就对不上舞台）。
   */
  overlay?: ReactNode
}

/**
 * 这一页的加载闸门。
 *
 * 拆成两个组件而不是在 DeckStage 里写条件渲染，理由同 HomeScreen：里面的 useGSAP
 * 和量尺寸的那些 effect 都只在挂载时跑一次，必须等真实 DOM 就位再挂。
 *
 * 正常情况下这一步是白给的——后台预加载在玩家还看着首页时就把缩略图下完了，
 * settled 缓存让 useAssetsProgress 第一帧就返回 ready，loader 一眼都不会闪。
 * 它挡的是预加载还没轮到这一组、玩家已经点进来的情况。
 */
export function DeckScreen(props: DeckScreenProps) {
  const assets = useAssetsProgress(DECK_ASSETS)
  return assets.ready ? <DeckStage {...props} /> : <LoadingScreen progress={assets.progress} />
}

function DeckStage({ onConfirm, onBack, tutorial, overlay }: DeckScreenProps) {
  const [kindTab, setKindTab] = useState(0)
  /**
   * 选中的阵营，null = 不按阵营筛。只在「AI 牌」页签下生效（见 shown）。
   *
   * 切去别的页签时刻意**不重置**：那两页压根不显示阵营药丸（「技能牌」没有阵营，
   * 「全部」是一屏铺开的总览），玩家去别处看一眼再切回来，多半是想接着挑刚才那家的 AI。
   */
  const [faction, setFaction] = useState<DeckFaction | null>(null)
  const [zoomed, setZoomed] = useState<ZoomState | null>(null)
  /**
   * 伴随层（.deck-zoom-side）渲染用的那份放大状态。
   *
   * 和 zoomed 分成两份，是因为关闭时伴随层还要接着演 0.25 秒淡出，而那一刻 zoomed 已经被清空了
   *（清空是 CardZoomOverlay 的约定，见它 onClose 的说明）。所以这一份只在打开时更新、从不清空，
   * 淡出期间它渲染的就是"刚才那张卡"。
   */
  const [zoomSide, setZoomSide] = useState<ZoomState | null>(null)
  /** 发号器，只保证 key 不重复，数值本身没有含义。 */
  const nextKeyRef = useRef(0)

  const pageRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLElement>(null)
  const sideInnerRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef<HTMLUListElement>(null)
  const zoomRef = useRef<CardZoomHandle>(null)
  const manageRef = useRef<HTMLDivElement>(null)
  /** 当前那一枚牌组 tab。切牌组后要把它滚进视野，所以只给当前项挂 ref。 */
  const currentTabRef = useRef<HTMLButtonElement>(null)
  /** 放大查看的伴随层。GSAP 只改它的 autoAlpha，里面的排版照常用 CSS transform。 */
  const zoomSideRef = useRef<HTMLDivElement>(null)
  /** 常驻的单例浮字（「牌组已满」之类），位置和文案都由 showAddTip 现写。 */
  const addTipRef = useRef<HTMLDivElement>(null)
  /** 浮字淡出的计时。连着触发两次要重新计时，所以得记下来能撤。 */
  const addTipTimerRef = useRef<number | null>(null)

  /**
   * 每张卡的倾斜句柄，按 id 存：卡池按 CardId，牌组按 entry.key。
   *
   * 存起来是为了两件事：卡增减时只挂新的、只摘走了的（整批重挂的坏处见下面那个 useGSAP），
   * 以及起拖 / 点开放大之前拿它 reset()，把高光一起收掉。
   */
  const poolTiltsRef = useRef(new Map<string, CardTiltHandle>())
  const deckTiltsRef = useRef(new Map<string, CardTiltHandle>())
  /** 屏幕中央那张大卡的倾斜句柄。它随放大层挂载 / 卸载，所以只有一个。 */
  const zoomTiltRef = useRef<CardTiltHandle | null>(null)
  /** 伴随层那张背面大卡的倾斜句柄。和上面那张一起挂、一起摘，所以同样只有一个。 */
  const zoomSideTiltRef = useRef<CardTiltHandle | null>(null)

  // 缩放系数由 JS 量 .deck-page 的宽算出来写进 --deck-scale，不在 CSS 里算
  //（纯 CSS 那套在 Safari 上会让整页塌掉，原因见 ui/useStageScale.ts）。
  const scalerRef = useStageScale<HTMLDivElement>('--deck-scale')

  /**
   * 教程限制的镜像。拖拽和管理条的回调跨渲染活着，直接闭包捕获 prop 会读到过期的那份；
   * 而把 tutorial 写进 addCard / removeEntry 的依赖，又会让它们每次渲染都换身份，
   * 底下两个 React.memo 卡片组件就再也命不中（见 PoolCard 的说明）。
   */
  const tutorialRef = useRef(tutorial)
  tutorialRef.current = tutorial

  /**
   * 教程期间挡下一次操作：喊一声由教程去显示提示，返回 true 表示"这一步到此为止"。
   * 不在教程模式时恒返回 false，调用点照常往下走。
   */
  const blockedByTutorial = useCallback((): boolean => {
    const guide = tutorialRef.current
    if (guide === undefined) return false
    guide.onBlocked(guide.blockTip)
    return true
  }, [])

  // 这一页没有挂载动画，useGSAP 在这儿只是为了拿 contextSafe：
  // 拖拽 hook 和归位补间建的 tween 都归这个 context 管，离开页面时一起 revert。
  const { contextSafe } = useGSAP(() => {}, { scope: pageRef })

  // 卡池那批 id 在一次会话里是固定的，缓存不会长，所以只有牌组这边要 retain。
  const { bindOf: bindPoolCard, attach: attachPoolBind } = useBindCache()
  const { bindOf: bindDeckCard, attach: attachDeckBind, retain: retainDeckBinds } = useBindCache()

  // ---------- 卡池 ----------

  /**
   * 卡池 = 存档里已拥有的卡 + 选不了的那两类，挂载时读一次。
   *
   * 后面那批是灰着摆出来给人看的（选不进牌组，见 blockReasonNow），拼在末尾就是
   * 「排序永远在最后」那条要求；它们不在存档的已拥有列表里，所以要在这儿另接上。
   *
   * 是 state 而不是常量：从牌组把牌送回来时可以指定它落在卡池的哪一格（见 movePoolCard），
   * 那一下会改这个顺序。但只有那一条路改得动它——这一页不会解锁新卡（收藏只在对局结束后变，
   * 见 save/save.ts 的 recordWin），所以中途不用重读存档，网格也不会莫名重排。
   */
  const [pool, setPool] = useState<readonly CardId[]>(() => [
    ...loadSave().ownedCards,
    ...COMING_SOON_SKILL_CARD_IDS,
    ...UNAVAILABLE_AI_CARD_IDS,
  ])
  // 卡池的重排发生在拖拽 / 按钮的回调里，那些回调跨渲染活着，读 state 会读到过期的那份。
  const poolRef = useRef(pool)
  poolRef.current = pool

  /**
   * 卡池里第一张"选不了的牌"的位置，也就是可选卡那一段的长度。
   *
   * 灰着的那两类永远排在最后（见 DISPLAY_CARD_IDS），送回来的牌只能插到这个位置之前，
   * 所有算落点的地方都要拿它封顶。
   */
  const blockedStart = useMemo(() => {
    const first = pool.findIndex((cardId) => BLOCKED_CARD_LABELS.has(cardId))
    return first < 0 ? pool.length : first
  }, [pool])
  const blockedStartRef = useRef(blockedStart)
  blockedStartRef.current = blockedStart

  /**
   * 把卡池里的一张牌挪到第 to 格（送回牌时决定它落在哪儿）。
   *
   * to 是"挪走这张之后的下标"，口径同 moveEntry。灰卡那一段挪不进去，也不能被挪。
   * 顺序当场写回存档：这是玩家自己摆的架子，刷新之后还该是这个样子。
   */
  const movePoolCard = (cardId: CardId, to: number) => {
    const list = poolRef.current
    const from = list.indexOf(cardId)
    if (from < 0 || BLOCKED_CARD_LABELS.has(cardId)) return
    const target = Math.min(Math.max(to, 0), blockedStartRef.current - 1)
    if (target === from) return
    const next = [...list]
    next.splice(from, 1)
    next.splice(target, 0, cardId)
    poolRef.current = next
    setPool(next)
    saveOwnedOrder(next)
  }

  /**
   * 卡池网格里现在摆着的那些格子，以及每格是哪张牌。
   *
   * 落点是照**屏幕上看得见的排列**算的，而卡池此刻多半正被页签或阵营筛着，
   * 所以直接读 DOM，而不是拿完整的 pool 去猜第几格是谁。
   */
  const poolCells = (): { slot: HTMLElement; cardId: CardId }[] => {
    const grid = gridRef.current
    if (grid === null) return []
    const cells: { slot: HTMLElement; cardId: CardId }[] = []
    for (const card of grid.querySelectorAll<HTMLElement>('.deck-pool-card')) {
      const slot = card.parentElement
      const flipId = card.dataset.flipId
      if (slot === null || flipId === undefined) continue
      cells.push({ slot, cardId: flipId.slice('pool:'.length) as CardId })
    }
    return cells
  }

  /**
   * 把"插在网格第 cell 格之前"换算成完整卡池里的插入下标。
   *
   * 中间这一步换算是必要的：网格上摆的只是筛过一遍的一部分牌，两边的下标对不上。
   * 一律封在灰卡那一段之前（blockedStart）——选不了的牌永远排在最后。
   */
  const poolIndexOfCell = (cell: number): number => {
    const cells = poolCells()
    const end = blockedStartRef.current
    const anchor = cells[cell]?.cardId
    if (anchor === undefined) return end
    return Math.min(poolRef.current.indexOf(anchor), end)
  }

  /**
   * 指针停在这儿的话，送回来的牌该插进卡池的第几格。
   *
   * 口径同牌组那边的 insertIndexAt：找最近的一格，再按指针在这一格的左半边还是右半边，
   * 决定插在它前面还是后面。
   */
  const poolInsertIndexAt = (clientX: number, clientY: number): number => {
    const cells = poolCells()
    let nearest = -1
    let nearestDist = Infinity
    let after = false
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]
      if (cell === undefined) continue
      const rect = cell.slot.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dist = Math.hypot(clientX - cx, clientY - cy)
      if (dist >= nearestDist) continue
      nearestDist = dist
      nearest = index
      after = clientX > cx
    }
    if (nearest < 0) return blockedStartRef.current
    return poolIndexOfCell(after ? nearest + 1 : nearest)
  }

  /**
   * 点「送回」时，那张卡池卡已经滚出视野的话，把它挪到哪一格。
   *
   * 取当前视野这一页的最后一格（口径同牌组那边的 pageInsertIndex，只是取的是末尾那一格，
   * 因为原话是"撤到最右下角"）：落点一定看得见，玩家能看着牌回到卡池里的某个位置，
   * 而不是飞向一个屏幕外的坐标。
   *
   * 返回的是"插在那一格之后"，这样这张牌最后正好占住那一格；插在它之前的话会差一位
   *（挪走自己那一格会让后面整体前移）。
   */
  const poolPageLastIndex = (): number => {
    const grid = gridRef.current
    const cells = poolCells()
    if (grid === null || cells.length === 0) return blockedStartRef.current
    const page = grid.clientHeight
    if (page <= 0) return blockedStartRef.current
    const pageBottom = Math.round(grid.scrollTop / page) * page + page
    const gridTop = grid.getBoundingClientRect().top
    let last = -1
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]
      if (cell === undefined) continue
      const rect = cell.slot.getBoundingClientRect()
      // 格子底边换算到内容坐标（网格自己不是定位祖先，offsetTop 指的不是它）。
      const bottom = rect.bottom - gridTop + grid.scrollTop
      // 半像素的误差会让整行被跳过，留 1px 余量。
      if (bottom > pageBottom + 1) break
      last = index
    }
    if (last < 0) return blockedStartRef.current
    return poolIndexOfCell(last + 1)
  }

  /** 这张卡池卡此刻在不在卡池的可视范围里。卡池只竖着滚，所以只看上下。 */
  const poolCardVisible = (card: HTMLElement): boolean => {
    const grid = gridRef.current
    if (grid === null) return false
    const rect = card.getBoundingClientRect()
    const box = grid.getBoundingClientRect()
    // 按卡的中心算：贴着边露出小半张也算看得见，用不着整张都在。
    const center = rect.top + rect.height / 2
    return center >= box.top && center <= box.bottom
  }

  /**
   * 页签上的数字。按整个卡池实算，既不跟着当前页签变，也不跟着阵营筛选变：
   * 它说的是"这一类我一共有多少张"，跟着筛选跳的话就没法用它判断筛掉了多少。
   *
   * 选不了的那两类也算在里面：它们就摆在这个页签底下的网格里，数字对不上网格里的张数
   * 才更让人犯嘀咕。数字是"这一类一共有几张卡"，不是"我能选几张"。
   */
  const kindCounts = useMemo<Record<KindTabId, number>>(() => {
    const cards = pool.map((cardId) => CARD_BY_ID.get(cardId))
    return {
      all: cards.length,
      ai: cards.filter((card) => card?.kind === 'ai').length,
      skill: cards.filter((card) => card?.kind === 'skill').length,
    }
  }, [pool])

  // ---------- 存档 ----------

  /** 全部牌组 + 当前选中的是哪一套。loadDecks 保证至少一套、currentId 一定指得到人。 */
  const [saved, setSaved] = useState<DecksData>(loadDecks)
  // 拖拽和管理条的回调都跨渲染活着，读 state 会读到过期的那份，一律读这个镜像。
  const savedRef = useRef(saved)
  savedRef.current = saved

  /**
   * 接住 store 返回的新存档。
   *
   * 镜像要立刻写，不能等下一次渲染：同一拍里紧接着的回调（比如切完牌组马上又改了张牌）
   * 拿 currentId 是从镜像读的，晚一步就会把新牌组的卡表写到旧牌组头上。
   */
  const applySaved = useCallback((data: DecksData) => {
    savedRef.current = data
    setSaved(data)
  }, [])

  /** 把一串卡 id 铺成带 key 的编辑态。key 现发，只保证不重复。 */
  const mintEntries = useCallback((cards: readonly CardId[]): DeckEntry[] => {
    return cards.map((cardId) => {
      nextKeyRef.current += 1
      return { key: `pick-${nextKeyRef.current}`, cardId }
    })
  }, [])

  /** 当前牌组的编辑态。存档里那份是纯 id 数组，两边靠 commitDeck 保持同步。 */
  const [deck, setDeck] = useState<DeckEntry[]>(() => mintEntries(cardsOf(saved, saved.currentId)))
  const deckRef = useRef(deck)
  deckRef.current = deck

  /**
   * 改当前牌组的唯一入口：state 和存档一起写，页面上没有"未保存"这个状态。
   *
   * 先写 deckRef 再 setDeck，是为了让同一拍里连着调两次也能各自读到上一次的结果
   * （比如一次拖拽落点里连加两张）。
   */
  const commitDeck = useCallback(
    (next: DeckEntry[]) => {
      deckRef.current = next
      setDeck(next)
      retainDeckBinds(next.map((entry) => entry.key))
      applySaved(
        updateDeckCards(
          savedRef.current.currentId,
          next.map((entry) => entry.cardId),
        ),
      )
    },
    [applySaved, retainDeckBinds],
  )

  /** 换一套牌组进编辑态：接住 store 返回的新存档，并按它的 currentId 重建 key。 */
  const openDeck = useCallback(
    (data: DecksData) => {
      const entries = mintEntries(cardsOf(data, data.currentId))
      deckRef.current = entries
      setDeck(entries)
      retainDeckBinds(entries.map((entry) => entry.key))
      applySaved(data)
    },
    [applySaved, mintEntries, retainDeckBinds],
  )

  // ---------- 牌组状态 ----------

  /** 每张卡已经选了几份。一次渲染只统计一遍，卡池里每张牌各自去查表。 */
  const copies = useMemo(() => {
    const counted = new Map<CardId, number>()
    for (const entry of deck) counted.set(entry.cardId, (counted.get(entry.cardId) ?? 0) + 1)
    return counted
  }, [deck])

  const deckFull = deck.length >= DECK_SIZE

  /**
   * 现在加不了这张卡的原因；能加就是 null。
   *
   * 读 deckRef 而不是上面那个 copies：拖拽和按钮回调都是跨渲染活着的，闭包里的 state 会过期。
   * 渲染期也照样调它——deckRef 在渲染里就已经跟着 deck 更新过了，两边读到的是同一份。
   *
   * 返回原因而不是布尔，是因为"加不了"现在要说话（浮字提示、放大层里的小字），
   * 让判定和话术留在同一处，免得两边各写一次 if 又对不上。
   *
   * 选不了的那两类排在最前面判：它和牌组的状态无关（牌组空着也一样加不了），
   * 而且这一句要盖过"牌组已满"——牌组正好满着的时候说"先移除才能再加"是在骗人，
   * 移空了它照样加不进来。
   */
  const blockReasonNow = useCallback((cardId: CardId): string | null => {
    const blocked = BLOCKED_CARD_LABELS.get(cardId)
    if (blocked !== undefined) return blocked
    const current = deckRef.current
    if (current.length >= DECK_SIZE) return DECK_FULL_TIP
    let owned = 0
    for (const entry of current) {
      if (entry.cardId === cardId) owned += 1
    }
    return owned >= MAX_COPIES ? MAX_COPIES_TIP : null
  }, [])

  const canAddNow = useCallback(
    (cardId: CardId) => blockReasonNow(cardId) === null,
    [blockReasonNow],
  )

  /** 牌组里 AI 牌 / 技能牌各多少张。 */
  const mix = useMemo(() => {
    let ai = 0
    let skill = 0
    for (const entry of deck) {
      const card = CARD_BY_ID.get(entry.cardId)
      if (card === undefined) continue
      if (card.kind === 'ai') ai += 1
      else skill += 1
    }
    return { ai, skill }
  }, [deck])

  /**
   * 牌组即将变样，变完之后要从这份旧状态补一段 Flip。
   *
   * 牌组一改就是"整排格子重排"：插在中间的一份会把后面所有牌各推一格，移走一份则让后面
   * 全部往前补位。所以量的是**格子区里全部迷你卡**的旧位置，而不只是动了的那一张，
   * 补间才能把"其它牌让出位置"这件事一起演出来（不这么做的话它们是瞬间跳过去的）。
   *
   * flyKey 是这次里"自己也要飞一段"的那份牌：加牌时是新发的 key（起点在卡池那张牌上，
   * 所以量的时候要把它一起算进去，见 addCard），拖着换顺序时是被拖的那份（起点是松手位置）。
   * 移走一份牌时没有谁要飞，是 null——它的送回动画由另一条路负责（见 flyBackToPool）。
   *
   * 存起来而不是当场播：改牌组是"发 key → React 挂/挪格子"，落点元素得等下一拍才就位，
   * 所以由下面那个依赖 deck 的 useGSAP 接手。
   */
  const pendingFlipRef = useRef<{
    state: Flip.FlipState
    flyKey: string | null
    duration: number
  } | null>(null)

  /**
   * 拖拽途中为落点让出来的那一格（0 = 让在最前，null = 现在没有落点）。
   *
   * 只有"从卡池拖一张进来"才用得上：那张牌还不在牌组里，不先空出一格的话，
   * 松手前根本看不出它会插到哪儿，而落点又正好在指针底下，飞行几乎没有行程，
   * 看着就是凭空闪进去（这一版之前正是这个毛病）。
   * 牌组内部换位置不走这条路——被拖的那一份自己占着的格子已经是空的（牌被拎成了 fixed），
   * 它就是那个空位，所以那边改成边拖边把顺序调过去（见 deckDrag 的 onDragMove）。
   */
  const [previewGap, setPreviewGap] = useState<number | null>(null)
  // 拖拽回调跨渲染活着，读 state 会读到过期的那份。
  const previewGapRef = useRef(previewGap)
  previewGapRef.current = previewGap

  /**
   * 同上，只是这一份是卡池那边的：一张牌被送回卡池时，卡池也要补一段 Flip。
   *
   * flyId 那张卡池卡是从牌组格子飞过来的（起点由 returnToPool 借迷你卡量下），
   * 其余的牌只是因为它插了队而往后让一格。
   */
  const pendingPoolFlipRef = useRef<{ state: Flip.FlipState; flyId: CardId } | null>(null)

  /**
   * 量下格子区里全部迷你卡此刻的位置，外加一个额外的起点元素（加牌时是卡池那张牌）。
   *
   * 必须在改牌组**之前**调，量到的才是"变化前"的那一帧。
   */
  const captureSlotsFlip = (flyKey: string | null, extra?: HTMLElement): Flip.FlipState => {
    const minis = flipMinis(flyKey)
    return Flip.getState(extra === undefined ? minis : [...minis, extra])
  }

  /**
   * 格子区里该由这段 Flip 管位置的迷你卡。
   *
   * 被拎出文档流（position: fixed）的那些要排除掉：它们要么正贴在指针上被拖着，要么正飞在
   * 上一程的半路上，位置各有各的主人。漏掉这一道的话，Flip 会把"位移归零"写到正被拖的那张
   * 牌上，手还没松牌就先跳回格子里去了。
   * flyKey 那一份是例外——它正是这一段要飞的那个。
   */
  const flipMinis = (flyKey: string | null): HTMLElement[] => {
    const flyer = flyKey === null ? null : deckFlipId(flyKey)
    return Array.from(slotsRef.current?.querySelectorAll<HTMLElement>('.deck-mini') ?? []).filter(
      (mini) => mini.style.position !== 'fixed' || mini.dataset.flipId === flyer,
    )
  }

  /**
   * 加一份牌。
   *
   * captureFrom 是这一份牌"从哪儿飞进来"的起点元素（拖着的那张卡池卡、或卡池里的原位卡）；
   * 不传就没有飞行，牌直接出现在格子里（眼下没有这样的调用方，留着是因为飞行是锦上添花，
   * 起点元素查不到时应该照样加得进去）。
   *
   * at 是插进牌组的第几个位置，不传就接在末尾。拖拽落点按离指针最近的格子算（insertIndexAt），
   * 点击加入按当前视野那一页的第一格算（pageInsertIndex），两者都要能插进中间。
   */
  const addCard = useCallback(
    (cardId: CardId, captureFrom?: HTMLElement, at?: number) => {
      const guide = tutorialRef.current
      // 教程期间只放行当前这一步点名的那张，连"再加一份已经加过的牌"也一起挡掉：
      // 不挡的话玩家连点两下就把牌组填满了，后面几步没牌可加。
      if (guide !== undefined && guide.allowedCardId !== cardId) {
        guide.onBlocked(guide.blockTip)
        return
      }
      if (!canAddNow(cardId)) return
      nextKeyRef.current += 1
      const key = `pick-${nextKeyRef.current}`
      const current = deckRef.current
      const index = at === undefined ? current.length : Math.min(Math.max(at, 0), current.length)
      if (captureFrom !== undefined) {
        /*
         * Flip 靠 data-flip-id 把"起点元素"和"落点元素"认成同一张牌，而这两个元素本来
         * 带着各自的 id（卡池那张是 pool:xxx，格子里这一份是 deck:key），对不上就不会飞。
         * 所以量之前先把起点临时改名成这一份牌的 id，量完立刻改回去——
         * 全在同一拍的同步代码里，React 不会看见中间那一下，下次渲染写回来的也还是原来那个。
         */
        const original = captureFrom.dataset.flipId
        captureFrom.dataset.flipId = deckFlipId(key)
        pendingFlipRef.current = {
          state: captureSlotsFlip(key, captureFrom),
          flyKey: key,
          duration: INSERT_DUR,
        }
        if (original === undefined) delete captureFrom.dataset.flipId
        else captureFrom.dataset.flipId = original
      } else {
        // 没有起点也要量一份：插在中间时后面那些牌照样要演"让出一格"。
        pendingFlipRef.current = { state: captureSlotsFlip(null), flyKey: null, duration: INSERT_DUR }
      }
      const next = [...current]
      next.splice(index, 0, { key, cardId })
      commitDeck(next)
      // 教学靠这一声推进到下一步，所以它排在真的落牌之后：加不进去的分支上面已经 return 了。
      guide?.onCardAdded(cardId)
    },
    [canAddNow, commitDeck],
  )

  /**
   * 从牌组里拿掉一份牌，它同时会回到卡池里的某一格。
   *
   * poolAt 指定回到卡池的第几格，只有"拖回卡池"那条路会传（＝离指针最近的那一格）；
   * 点按钮的两条路不传，由 returnToPool 按默认规则决定。
   */
  const removeEntry = useCallback(
    (entryKey: string, poolAt?: number) => {
      // 教程阶段牌组里的牌一张都不许动（规格 §15）。
      if (blockedByTutorial()) return
      const current = deckRef.current
      const gone = current.find((entry) => entry.key === entryKey)
      // 这份牌已经不在了（同一拍里被移过一次）就什么都别做：
      // 否则白写一次存档，还会让整排格子跟着重渲染一遍。
      if (gone === undefined) return
      // 两件事都得赶在改牌组之前做完：送回那一程要照着还在格子里的那张迷你卡量起点，
      // Flip 也要量到"后面那些牌还没往前补位"的那一帧。
      returnToPool(gone, poolAt)
      pendingFlipRef.current = { state: captureSlotsFlip(null), flyKey: null, duration: INSERT_DUR }
      commitDeck(current.filter((entry) => entry.key !== entryKey))
    },
    [blockedByTutorial, commitDeck],
  )

  /** 把某一份牌挪到第 to 格之后的新顺序；已经在那儿了就返回 null。 */
  const reordered = (entryKey: string, to: number): DeckEntry[] | null => {
    const current = deckRef.current
    const from = current.findIndex((entry) => entry.key === entryKey)
    if (from < 0) return null
    const target = Math.min(Math.max(to, 0), current.length - 1)
    if (target === from) return null
    const next = [...current]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return null
    next.splice(target, 0, moved)
    return next
  }

  /**
   * 指针停在这儿的话，这张牌该插进牌组的第几格（0 = 排在最前，deck.length = 接在最后）。
   *
   * 量的是格子（.deck-slot）而不是牌：空格子也要算进来，不然把牌丢在末尾那片空格上时，
   * 最近的仍然是最后一张牌，落点会往回跳一格。
   * 找到最近的一格之后再按"指针在这一格的左半边还是右半边"决定插在它前面还是后面，
   * 这样两列的网格里左右两个落点是分得开的。
   */
  const insertIndexAt = (clientX: number, clientY: number): number => {
    const list = slotsRef.current
    const length = deckRef.current.length
    if (list === null) return length
    const slots = Array.from(list.children) as HTMLElement[]
    let nearest = -1
    let nearestDist = Infinity
    let after = false
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]
      if (slot === undefined) continue
      const rect = slot.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dist = Math.hypot(clientX - cx, clientY - cy)
      if (dist >= nearestDist) continue
      nearestDist = dist
      nearest = index
      after = clientX > cx
    }
    if (nearest < 0) return length
    /*
     * 已经让出一格空位时，量到的"第几格"是**带着那一格**的排法，要换算回牌组真正的下标，
     * 否则落点会自己走：指针停在空位右半边算出来是它后面一格，空位挪过去之后指针又落在
     * 新空位的左半边，于是来回跳。
     * 指针就停在空位上时直接维持原样——那正是"松手就落这儿"。
     */
    const gap = previewGapRef.current
    if (gap !== null && nearest === gap) return gap
    const real = gap !== null && nearest > gap ? nearest - 1 : nearest
    // 最近的是一格空位（后面已经没有牌了）＝ 排在现有的牌后面。
    if (real >= length) return length
    return after ? real + 1 : real
  }

  /**
   * 拖拽途中把空位挪到某一格（null = 收起来）。
   *
   * 每挪一格都补一段 Flip，让让位的牌是滑过去的而不是瞬移。比落牌那一程快一档：
   * 手还在拖，这一下只是提示，不该让人等它。
   */
  const showGapAt = (next: number | null) => {
    if (next === previewGapRef.current) return
    pendingFlipRef.current = { state: captureSlotsFlip(null), flyKey: null, duration: GAP_SHIFT_DUR }
    previewGapRef.current = next
    setPreviewGap(next)
  }

  /** 指针在不在某块区域里。拖拽回调只拿得到坐标，落点区自己的判定在 hook 内部，这里另算一次。 */
  const pointerInside = (ref: RefObject<HTMLElement | null>, x: number, y: number): boolean => {
    const el = ref.current
    if (el === null) return false
    const rect = el.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  /**
   * 点击加入（「＋」、放大层里那颗按钮）时，这张牌该插进第几格。
   *
   * 取"当前视野里最完整的那一页"的第一格：格子区是一块滚动区，一屏正好是一页，
   * 滚过一半时算下一页赢。这样点完之后新牌一定就在眼前，而不是接在末尾、落到看不见的地方。
   * 牌不够铺满一屏（列表根本没得滚）时这就是第 0 格，新牌排在最前面。
   */
  const pageInsertIndex = (): number => {
    const list = slotsRef.current
    const length = deckRef.current.length
    if (list === null) return length
    const page = list.clientHeight
    if (page <= 0) return length
    // 这一页的顶边在内容坐标里的位置。
    const pageTop = Math.round(list.scrollTop / page) * page
    const listTop = list.getBoundingClientRect().top
    const slots = Array.from(list.children) as HTMLElement[]
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]
      if (slot === undefined) continue
      // 格子顶边换算到内容坐标（滚动区自己不是定位祖先，offsetTop 指的不是它）。
      const top = slot.getBoundingClientRect().top - listTop + list.scrollTop
      // 半像素的误差会让整行被跳过，留 1px 余量。
      if (top >= pageTop - 1) return Math.min(index, length)
    }
    return length
  }

  const cardOfEntry = (entryKey: string): HandCardData | undefined => {
    const entry = deckRef.current.find((item) => item.key === entryKey)
    return entry === undefined ? undefined : CARD_BY_ID.get(entry.cardId)
  }

  // ---------- 倾斜 / 翻面 / 拒绝反馈 ----------

  /**
   * 问号热区：指针进来翻到背面，离开翻回正面。
   *
   * 拿到的是热区本身，翻面层是它的兄弟节点（热区在 __tilt 里、__inner 外，理由见 deck.css
   * 的「问号」一节），所以从父级往下查。卡池卡和迷你卡共用这一个函数，两边的类名都在
   * FLIP_LAYER_SELECTOR 里。
   */
  const flipHelp = contextSafe((help: HTMLElement, toBack: boolean) => {
    const inner = help.parentElement?.querySelector<HTMLElement>(FLIP_LAYER_SELECTOR) ?? null
    if (inner === null) return
    flipTo(inner, toBack ? 180 : 0, HELP_FLIP_DUR)
  })

  /**
   * 把一张卡的倾斜和翻面就地归零，并收掉高光。
   *
   * 起拖（liftCardOut）和点开放大（Flip.getState）之前必须先做这一下：那两处量的都是
   * getBoundingClientRect 给的**外接**矩形，而歪着或转了一半的卡，外接矩形比卡本身大一圈，
   * 照那个矩形接着算，起拖和起飞的第一帧就会看见卡跳一下、还连带缩错大小。
   *
   * 两步的顺序不能反：先把角度写死再 reset()。反过来的话，reset 里那条归零补间会在重启的
   * 那一刻记下"当时的角度"当起点，随后我们把角度抹成 0，它下一帧又从记下的角度补回来，
   * 等于白归零（cardTilt 的 settle(true) 里有这条补间的来龙去脉）。
   */
  const settleCard = contextSafe((element: HTMLElement, tilt?: CardTiltHandle) => {
    const inner = element.querySelector<HTMLElement>(FLIP_LAYER_SELECTOR)
    // setFlipAngle 自带 overwrite，还在跑的翻面补间会被它一并收掉（见 ui/flipCard.ts）。
    if (inner !== null) setFlipAngle(inner, 0)
    const layer = element.querySelector<HTMLElement>(TILT_LAYER_SELECTOR)
    if (layer !== null) gsap.set(layer, { rotationX: 0, rotationY: 0 })
    tilt?.reset()
  })

  const clearAddTipTimer = () => {
    if (addTipTimerRef.current === null) return
    clearTimeout(addTipTimerRef.current)
    addTipTimerRef.current = null
  }

  /**
   * 把提示浮字挪到某张卡正上方，淡入停一会儿再淡出。
   *
   * 文案由调用方在触发那一刻写进节点，而不是交给 JSX 跟着状态渲染：淡出还要跑 0.25 秒，
   * 这段时间里牌组要是又变了（比如玩家紧接着移掉一张），React 会当场把字换掉甚至清空，
   * 玩家就眼睁睁看着一句自己没触发过的话在那儿淡出（同 HandFan 的 showLockTip）。
   *
   * 定位：卡的矩形是视口坐标（舞台带着 scale），浮字写的 left / top 是舞台内像素，
   * 所以要减掉浮字那个定位祖先的原点再除以缩放。用 offsetParent 现查而不是写死某个 ref，
   * 挪动这个节点在 DOM 里的位置时不用回来改这里。
   * 居中和"贴着卡顶往上长"交给 GSAP 的 xPercent / yPercent：GSAP 接管 transform 时会往内联
   * 样式里写 translate: none，CSS 那份独立变换属性根本活不下来。
   */
  const showAddTip = contextSafe((cardEl: HTMLElement, text: string) => {
    const tip = addTipRef.current
    const host = tip?.offsetParent ?? null
    if (tip === null || host === null) return
    tip.textContent = text
    const cardRect = cardEl.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const { scale } = battleStageMetrics()
    gsap.set(tip, {
      left: (cardRect.left + cardRect.width / 2 - hostRect.left) / scale,
      top: (cardRect.top - hostRect.top) / scale - ADD_TIP_GAP,
      xPercent: -50,
      yPercent: -100,
    })
    gsap.fromTo(
      tip,
      { autoAlpha: 0, y: 8 },
      { autoAlpha: 1, y: 0, duration: 0.18, ease: 'power2.out', overwrite: true },
    )
    // 连着触发同一句提示时重新计时，免得它刚弹出来就被上一次的计时收走。
    clearAddTipTimer()
    addTipTimerRef.current = window.setTimeout(() => {
      addTipTimerRef.current = null
      gsap.to(tip, { autoAlpha: 0, duration: 0.25, overwrite: true })
    }, ADD_TIP_HOLD_MS)
  })

  /**
   * 加不进去的时候摇个头，再在卡顶弹一句为什么。
   *
   * 摇头写在 tilt 层的 z 轴 rotation 上：那一层现有的倾斜只写 rotationX / rotationY，
   * z 轴空着，两边互不干扰（同 HandFan 的 refusePlay）。外层是拖拽和 Flip 的地盘，动不得。
   */
  const refuseAdd = contextSafe((cardEl: HTMLElement, reason: string) => {
    const layer = cardEl.querySelector<HTMLElement>(TILT_LAYER_SELECTOR)
    if (layer !== null && !prefersReducedMotion()) {
      gsap.to(layer, {
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
    showAddTip(cardEl, reason)
  })

  // 组件卸载时把还排着的淡出计时撤掉：回调里会去碰一个已经卸载的节点。
  useEffect(() => clearAddTipTimer, [])

  // ---------- 放大查看 ----------

  /**
   * 找放大 / 飞回要用的原位元素。
   *
   * 限定在卡池网格或格子网格里查，不能对整页查：屏幕中央那张展示卡带的是同一个 data-flip-id，
   * 全页查会先撞上它自己。
   */
  const findOrigin = (side: ZoomState['side'], flipId: string): HTMLElement | null => {
    const scope = side === 'pool' ? gridRef.current : slotsRef.current
    return scope?.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(flipId)}"]`) ?? null
  }

  /**
   * 交给 CardZoomOverlay 的放大目标。用 useMemo 记住是为了对象身份稳定——
   * 组件拿它当 useGSAP 的依赖，每次渲染现拼的话，牌组一动就会白跑一遍那个 effect。
   */
  const zoomTarget = useMemo<CardZoomTarget | null>(() => {
    if (zoomed === null) return null
    const { card, flipId, side } = zoomed
    // getOrigin 里的 findOrigin 只读 ref，捕获到哪一次渲染的那份都一样，所以不必进依赖。
    return { card, flipId, getOrigin: () => findOrigin(side, flipId) }
  }, [zoomed])

  /**
   * 牌组侧那张卡飞回格子的这 0.6 秒里，把整块面板临时抬到展示遮罩（z 1100）之上。
   *
   * CardZoomOverlay 会给飞回的原位元素写 zIndex: 1200 去压过正在淡出的遮罩，但这个值出不了
   * .deck-side——它是 position: relative + z-index: 3（为了压过卡池那两条横条），
   * 定位元素带 z-index 就建了层叠上下文，里面的 z-index 只在这块面板内部排序——
   * 所以只能连整块面板一起抬。
   * 代价是面板比页面其余部分早 0.3 秒恢复清晰（遮罩还在淡出），
   * 总好过让飞行的前半程整段糊在遮罩后面。
   * 卡池侧不用这一手：遮罩就渲染在 .paper-page__inner 里，卡池卡和它同处一个层叠上下文。
   */
  const liftSideForFlight = contextSafe(() => {
    const side = sideRef.current
    if (side === null) return
    side.dataset.zoomFlight = 'true'
    // 用 gsap.delayedCall 而不是 setTimeout：它归 useGSAP 的 context 管，离开页面时一起收掉。
    gsap.delayedCall(ZOOM_OUT_DUR, () => {
      delete side.dataset.zoomFlight
    })
  })

  /**
   * 每张卡身上挂着的「飞回原位跑完之后把它切回文档流」的定时器（由 liftCardForFlight 排下）。
   *
   * 记下来是为了能提前掐掉。遮罩 0.3 秒就淡完了，而飞回要 0.6 秒，中间这段时间玩家能直接
   * 抓住还在飞的那张卡。定时器不认识拖拽，到点照样清掉内联定位，正拖着的卡就会瞬间跳回
   * 格子里、还被容器的 overflow 裁掉。useCardDrag 起拖时那发 killTweensOf 也管不到它——
   * delayedCall 不是挂在元素上的补间，按元素杀补间杀不到。
   *
   * 用 WeakMap：卡片节点被 React 换掉之后不用手动清表。
   */
  const pendingDropRef = useRef(new WeakMap<HTMLElement, gsap.core.Tween>())

  /**
   * 关掉放大查看之前的另一半准备：让即将飞回原位的那张卡在飞行途中不被裁掉。
   *
   * 飞回不是在遮罩里播的——CardZoomOverlay 的 Flip.from 直接对**格子里那张原位卡**做补间
   * （没有传 absolute，所以它全程留在文档流里）。而卡池网格和牌组格子区现在都是 overflow
   * 容器（见 deck.css 文件头），飞行起点在屏幕中央、离容器很远，不处理的话前半程整张卡
   * 都被裁在容器外面，看到的是一段凭空出现的动画。
   *
   * 办法就是拖拽那一套：起飞前把它切成 fixed（位置完全重合，切换看不出来），飞完切回来。
   * 多等 0.06 秒才切回，是留给 Flip 收尾的余量——正好卡在补间末帧切，会看到一次跳动。
   */
  const liftCardForFlight = contextSafe((side: ZoomState['side'], flipId: string) => {
    const origin = findOrigin(side, flipId)
    if (origin === null) return
    liftCardOut(origin)
    // 用 gsap.delayedCall 而不是 setTimeout：它归 useGSAP 的 context 管，离开页面时一起收掉。
    // 存进 pendingDropRef：这张卡还在飞的时候就可能被抓起来拖，那时要先把这一发掐掉。
    pendingDropRef.current.set(
      origin,
      gsap.delayedCall(ZOOM_OUT_DUR + 0.06, () => dropCardBack(origin)),
    )
  })

  /**
   * 点开放大。sourceId 卡池侧是 CardId、牌组侧是 entry.key，flipId 照它拼。
   */
  const openZoom = (card: HandCardData, side: ZoomState['side'], sourceId: string) => {
    const zoom = zoomRef.current
    // hasPendingFlip：上一次的点击已经受理、对应的 effect 还没跑，这一拍抢进来会把那份状态丢掉。
    if (zoom === null || zoomed !== null || zoom.hasPendingFlip()) return
    const flipId = side === 'pool' ? poolFlipId(sourceId) : deckFlipId(sourceId)
    const origin = findOrigin(side, flipId)
    if (origin === null) return
    // 上一次的飞回还没走完就又点开一张：先把面板的临时抬升撤掉，
    // 否则这次放大期间它会浮在遮罩之上不被压暗（晚一点到期的那次 delayedCall 只是再删一遍，无害）。
    const sideEl = sideRef.current
    if (sideEl !== null) delete sideEl.dataset.zoomFlight
    // 起飞前先把这张卡摆正：指针刚在它上面，多半正歪着甚至翻了一半，
    // 下面 captureOrigin 量的是外接矩形，不摆正的话第一帧会跳（理由见 settleCard）。
    const tilts = side === 'pool' ? poolTiltsRef.current : deckTiltsRef.current
    settleCard(origin, tilts.get(sourceId))
    // 此刻原位那张还是可见的（下面 setZoomed 之后才会被藏起来），量到的正是起飞位置，两步不能对调。
    zoom.captureOrigin(origin)
    setZoomed({ card, flipId, side, sourceId })
    setZoomSide({ card, flipId, side, sourceId })
  }

  /**
   * 收掉正在放大的那张卡，走的就是点遮罩 / 按 ESC 那条路（会淡出遮罩、播飞回）。
   *
   * 切换牌组前要调一次：格子里的牌马上就要整批换掉，飞回的落点很可能已经不在了。
   * 眼下遮罩（z 1100）本来就盖住了整块面板、管理条点不到，所以这一步是兜底；
   * 但飞回的落点是现查的（getOrigin），查不到就只淡出遮罩、不播飞行，不会留下半截动画。
   */
  const closeZoom = useCallback(() => {
    zoomRef.current?.requestClose()
  }, [])

  /**
   * 摘掉放大层两张大卡（中央的正面、伴随层的背面）的倾斜，顺手把角度和高光收回零。
   *
   * 要在展示卡卸载**之前**同步调（也就是 CardZoomOverlay 的 onClose 里）：
   * 晚一步的话中央那张已经从 DOM 上摘走，玩家会看见它在消失前先弹平一下。
   * 背面那张不卸载，但它接着要演 0.25 秒淡出，倾斜留着就成了"一边淡出一边还跟着指针歪"。
   */
  const detachZoomTilt = useCallback(() => {
    zoomTiltRef.current?.detach()
    zoomTiltRef.current = null
    zoomSideTiltRef.current?.detach()
    zoomSideTiltRef.current = null
  }, [])

  /**
   * 放大层上那颗「加入牌组」。
   *
   * 起点取卡池里的原位卡（此刻它是 visibility: hidden 的，位置照样量得到），
   * 所以关掉放大之后看到的是两段各自说得通的动画：屏幕中央那张飞回卡池格子，
   * 同时新的那一份从卡池格子飞进牌组。
   */
  const zoomAdd = () => {
    if (zoomSide === null || zoomSide.side !== 'pool') return
    const cardId = zoomSide.sourceId
    if (!canAddNow(cardId)) return
    // 落位口径和「＋」一致：都是点击加入，见 pageInsertIndex。
    addCard(cardId, findOrigin('pool', zoomSide.flipId) ?? undefined, pageInsertIndex())
    closeZoom()
  }

  /**
   * 放大层上那颗「移出牌组」。
   *
   * 先让屏幕中央那张自己淡掉再收摊：这一份牌马上就不在了，飞回的落点也就没了
   *（CardZoomOverlay 查不到 origin 就只淡出遮罩、不播飞行），不淡一下的话大卡是硬消失的。
   */
  const zoomRemove = contextSafe(() => {
    if (zoomSide === null || zoomSide.side !== 'deck') return
    const entryKey = zoomSide.sourceId
    const finish = () => {
      removeEntry(entryKey)
      closeZoom()
    }
    const showcase = pageRef.current?.querySelector<HTMLElement>('.reveal-card') ?? null
    if (showcase === null) {
      finish()
      return
    }
    gsap.to(showcase, {
      autoAlpha: 0,
      scale: 0.94,
      duration: ZOOM_REMOVE_FADE,
      ease: 'power2.in',
      onComplete: finish,
    })
  })

  // ---------- 拖拽 ----------

  /**
   * 把卡池里的这张牌从文档流里"拎出来"：切成 position: fixed，钉在它此刻所在的位置。
   *
   * 为的是绕开 .deck-grid 的 overflow——卡池网格是整页唯一的滚动容器，会把溢出的子元素裁掉，
   * 而这张牌正要被拖出网格丢进右面板。fixed 元素不受祖先 overflow 裁剪。
   * 它原来占的格子由外层 .deck-pool-slot 撑着，所以这一步不会让邻牌塌陷补位。
   *
   * 牌组那边的迷你卡也要走这一手：格子区（.deck-slots）现在自己滚，同样是 overflow 容器，
   * 而"拖出面板"正是移除的操作方式。它原来占的格子由外层 .deck-slot 撑着，同理不会塌。
   *
   * 舞台 .deck-scaler 带着 transform，fixed 的包含块因此是舞台而不是视口，
   * 写进 left/top/width/height 的必须是舞台内坐标；而 getBoundingClientRect 给的是
   * 缩放之后的视口坐标，所以要过一次换算（口径见 ui/battleStage.ts）。
   * 不换算的话，窗口一旦不是设计尺寸，起拖那一瞬间牌就会跳到别处、还连带缩错大小。
   *
   * 要在 hook 接管补间之前调（onDragStart 里）：那正是 hook 留给调用方收拾自己状态的一步，
   * 见 useCardDrag 的 onDragStart。

   */
  const liftCardOut = (element: HTMLElement) => {
    // 这张卡可能是"上一次放大查看正在飞回原位"的途中被抓起来的，那就先把排在后面的
    // 「飞完切回文档流」掐掉，否则它到点后会把正拖着的卡清回格子（见 pendingDropRef）。
    // 排在量位置之前：先掐掉，下面读到的和写上去的才对得上同一份状态。
    const pendingDrop = pendingDropRef.current.get(element)
    if (pendingDrop !== undefined) {
      pendingDrop.kill()
      pendingDropRef.current.delete(element)
    }

    /*
     * 卡身上未必是干净的：归位补间（0.28s）还没跑完就又被抓起来时留着一截位移，
     * 放大查看飞回原位的途中被抓起来时，Flip 还写着一大截位移 + 放大。
     * 所以写进 left / top / width / height 的是**扣掉那截变换之后**的框（换算见 stageBoxOf），
     * 于是「新的 left/top/width/height + 留着的那截 transform」正好还是此刻的视觉位置，切换看不出来。
     * 静止起拖时位移是 0、缩放是 1，算出来和直接用 rect 一模一样。
     */
    const box = stageBoxOf(element)
    element.style.position = 'fixed'
    element.style.left = `${box.left}px`
    element.style.top = `${box.top}px`
    element.style.width = `${box.width}px`
    element.style.height = `${box.height}px`
  }

  /** liftCardOut 的反操作：清掉内联定位，牌回到格子里。位置和 fixed 时完全重合，所以看不出切换。 */
  const dropCardBack = (element: HTMLElement) => {
    // 这一发已经执行了，从待办表里划掉（也可能是拖拽 / 归位提前调过来的，那时表里本来就没有）。
    pendingDropRef.current.delete(element)
    element.style.position = ''
    element.style.left = ''
    element.style.top = ''
    element.style.width = ''
    element.style.height = ''
  }

  /**
   * 把拖拽写上去的那套 transform / zIndex 就地清掉，并切回文档流。
   *
   * 给"加入成功"那条路用：卡池那张牌不播归位补间，当场恢复原状——它的位置本来就没变过
   *（一直由外层 .deck-pool-slot 占着），玩家看到的语义是"拖走的那张变成了格子里的迷你卡，
   * 卡池位当场补上一张"。
   */
  const snapHome = (element: HTMLElement) => {
    // 把该归零的属性一个个写成 0 / 1，而不是靠 clearProps 抹掉整份 transform：
    // GSAP 接管 transform 时会连带写死 translate / rotate / scale 三个独立属性，
    // 逐个写零是"结果一定对"的那条路（归位补间 returnHome 也是这么收的）。
    // zIndex 是拖拽时为了压过邻牌写的，必须清掉，否则这张牌会一直浮在同层所有牌之上。
    gsap.set(element, { x: 0, y: 0, rotation: 0, scale: 1, clearProps: 'zIndex' })
    dropCardBack(element)
  }

  /**
   * 拖拽失败时把元素送回原位。
   *
   * hook 只负责把牌停在松手那一刻，不知道原位在哪。这一页的牌全按文档流摆位，
   * 所以"回原位"就是把 hook 写上去的那套 transform 清零。
   *
   * lifted 传 true 表示这张牌起拖时被 liftCardOut 切成了 fixed，归位跑完要再切回文档流。
   * 现在卡池和牌组两侧都要传 true（两边的容器都会滚），默认的 false 只是留给不滚的容器。
   */
  const returnHome = contextSafe((element: HTMLElement, lifted = false) => {
    gsap.to(element, {
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      duration: RETURN_DUR,
      ease: 'power3.out',
      overwrite: 'auto',
      onComplete: () => {
        // zIndex 是拖拽时为了压过邻牌写的内联样式，落回原位后必须清掉，
        // 否则这张牌会一直浮在同层所有牌之上（下一次 hover 的阴影会被它切掉）。
        gsap.set(element, { clearProps: 'zIndex' })
        // 归位补间跑完才切回文档流：中途切的话 fixed 的坐标基准一换，牌会跳一下。
        if (lifted) dropCardBack(element)
      },
    })
  })

  /**
   * 送回卡池：牌组里那份牌消失之前，先安排好它在卡池里落在哪一格，以及怎么飞过去。
   *
   * 三条移除的路（格子上那颗「送回」圆钮、把牌拖出面板、放大层里的「移出牌组」）都走这儿，
   * 因为它们最后都汇进 removeEntry。
   *
   * poolAt 是调用方指定的落点（拖回卡池时＝离指针最近的那一格）；不传就按默认规则来：
   * 卡池里那张牌还在视野里就不动它、牌直接飞回它身上；已经滚出视野了就把它挪到
   * 当前这一页的最后一格（poolPageLastIndex），卡池跟着重排，于是落点永远看得见。
   *
   * 飞的是卡池里那张**真牌**，不是替身：起点借迷你卡此刻的位置（把它的 data-flip-id 临时
   * 改成卡池那张的，Flip 才认得出是同一张），落点就是它自己的格子，重排的让位动画也一起演
   *（见下面那个依赖 shown / deck 的 useGSAP）。
   * 唯一的例外是这张牌被页签或阵营筛掉、网格上根本没有它：那时没有落点元素可飞，
   * 退回替身那条路（flyGhostToPool），往卡池的右下角淡出。
   */
  const returnToPool = (entry: DeckEntry, poolAt?: number) => {
    const mini = findOrigin('deck', deckFlipId(entry.key))
    if (mini === null || prefersReducedMotion()) return
    const poolCard = findOrigin('pool', poolFlipId(entry.cardId))
    if (poolCard === null) {
      flyGhostToPool(mini)
      return
    }
    const at = poolAt ?? (poolCardVisible(poolCard) ? undefined : poolPageLastIndex())

    /*
     * 量旧位置。卡池那张牌要排除在外：它的起点不是自己现在待的格子，而是迷你卡此刻的位置，
     * 所以由临时改名的迷你卡顶替它进这份状态——两个元素同时挂着 pool:xxx 的话 Flip 就分不清了。
     * 改名和量都在同一拍的同步代码里，React 看不见中间那一下。
     */
    const others = Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>('.deck-pool-card') ?? [],
    ).filter((card) => card !== poolCard)
    const original = mini.dataset.flipId
    mini.dataset.flipId = poolFlipId(entry.cardId)
    pendingPoolFlipRef.current = {
      state: Flip.getState([...others, mini]),
      flyId: entry.cardId,
    }
    if (original === undefined) delete mini.dataset.flipId
    else mini.dataset.flipId = original

    if (at !== undefined) {
      const from = poolRef.current.indexOf(entry.cardId)
      // at 是"插在第几个之前"，而这张牌此刻还占着自己那一格，落点排在它后面时
      // 要减掉它自己占的那一格，否则会往后多挪一位（同 moveEntry 那边的换算）。
      movePoolCard(entry.cardId, from >= 0 && at > from ? at - 1 : at)
    }
  }

  /**
   * 送回卡池的退路：卡池网格上根本没有这张牌（被页签或阵营筛掉了）时，
   * 克隆一个替身从格子飞向卡池可视区的右下角再淡掉。
   *
   * 那是"往卡池那边去了"的方向，而不是往一个屏幕外的坐标飞、半路就飞出画面。
   * 替身走 fixed + RETURN_FLIGHT_Z：卡池是个 overflow 容器，不脱出去的话前半程会被裁掉；
   * 层级要压过灰着的那几张选不了的牌（它们正排在右下角那一带，见 RETURN_FLIGHT_Z）。
   */
  const flyGhostToPool = contextSafe((mini: HTMLElement) => {
    const host = scalerRef.current
    const grid = gridRef.current
    if (host === null || grid === null) return

    const box = stageBoxOf(mini)
    const metrics = battleStageMetrics()
    const gridRect = grid.getBoundingClientRect()
    // 卡池卡的尺寸随手量一张现成的；一张都没有（页签筛空了）就按迷你卡自己的大小飞。
    const sample = grid.querySelector<HTMLElement>('.deck-pool-card')?.getBoundingClientRect()
    const width = sample === undefined ? box.width : sample.width / metrics.scale
    const height = sample === undefined ? box.height : sample.height / metrics.scale
    const corner = toStagePoint(gridRect.right, gridRect.bottom, metrics)
    const target = {
      x: corner.x - POOL_CORNER_INSET - width / 2,
      y: corner.y - POOL_CORNER_INSET - height / 2,
      width,
    }

    const ghost = mini.cloneNode(true) as HTMLElement
    // 替身只是一张画：不接指针、不进无障碍树，也不能顶着 data-flip-id
    // 去和真正的牌抢 Flip 的配对（findOrigin 只在两个网格里查，够不到这儿，但别留这个坑）。
    delete ghost.dataset.flipId
    delete ghost.dataset.dragging
    ghost.setAttribute('aria-hidden', 'true')
    ghost.style.pointerEvents = 'none'
    // 放大查看时格子里那张是藏起来的（HIDDEN_IN_PLACE），替身要露出来。
    ghost.style.visibility = 'visible'
    host.appendChild(ghost)

    // 替身摆成和原件完全重合：原始框写进 left/top/width/height，那截变换原样抄过来
    //（.deck-mini 是 inset: 0 撑开的，离开格子之后必须自己写死尺寸）。
    gsap.set(ghost, {
      position: 'fixed',
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      x: box.x,
      y: box.y,
      rotation: box.rotation,
      scale: box.scale,
      zIndex: RETURN_FLIGHT_Z,
    })
    gsap
      .timeline({ onComplete: () => ghost.remove() })
      .to(ghost, {
        // 位移按"盒子中心 → 落点中心"算：缩放绕中心，中心对上了整张就对上了。
        x: target.x - (box.left + box.width / 2),
        y: target.y - (box.top + box.height / 2),
        scale: target.width / box.width,
        rotation: 0,
        duration: RETURN_FLIGHT_DUR,
        ease: 'power3.out',
      })
      .to(
        ghost,
        {
          autoAlpha: 0,
          duration: RETURN_FLIGHT_DUR * RETURN_FADE_PORTION,
          ease: 'power2.in',
        },
        RETURN_FLIGHT_DUR * (1 - RETURN_FADE_PORTION),
      )
  })

  /**
   * 卡池 → 牌组。落点是整个右面板。
   *
   * 加不进去的牌（牌组满了、份数选满了、或这张还没上线）不靠 canDrag 挡：canDrag 在
   * pointerdown 就返回，
   * 连"原地点一下放大看看"都会被一起挡掉。改成过了阈值再在 onDragStart 里掐掉这次拖拽——
   * 这是 hook 明确支持的用法，此时姿态和落点高亮都还没建起来，牌一动不动，而点击照常。
   */
  const poolDragRef = useRef<CardDragHandle | null>(null)
  const poolDrag = useCardDrag({
    zones: [{ ref: sideRef, id: 'deck' }],
    contextSafe,
    // 卡池是一整块竖向滚动区：触屏改走"横滑或长按才起拖"，别让滚卡池顺手把牌抓起来
    // （见 useCardDrag 的 touchScrollGuard，和 .deck-pool-card 的 touch-action: pan-y 是一套）。
    touchScrollGuard: true,
    // 圆圈按钮（加入 / 移除）和问号热区（看背面）另有用途，按在它们上面不算抓牌。
    ignoreSelector: '.deck-circle, .deck-help',
    onDragStart: (drag) => {
      // 教程期间只有放行的那张拖得动；别的牌当场掐掉这次拖拽，由教程去说原因。
      // 这一关排在 blockReasonNow 前面：教学里被挡下的理由永远是"这一步别动它"，
      // 不该冒出"牌组已满"这种和当前教学对不上的话。
      const guide = tutorialRef.current
      if (guide !== undefined && guide.allowedCardId !== drag.id) {
        guide.onBlocked(guide.blockTip)
        poolDragRef.current?.endDrag()
        return
      }
      const reason = blockReasonNow(drag.id)
      if (reason !== null) {
        // 拖不动这一下不能什么都不发生：摇个头再说一句为什么。
        refuseAdd(drag.element, reason)
        poolDragRef.current?.endDrag()
        return
      }
      // 掐掉这次拖拽的分支要先返回：那种情况下牌一动不动，不该被拎出文档流，
      // 倾斜也留着——摇头正是绕着那一层的 z 轴演的。
      settleCard(drag.element, poolTiltsRef.current.get(drag.id))
      liftCardOut(drag.element)
    },
    // 拖到面板里就先把落点那一格空出来：这张牌还不在牌组里，不空一格的话松手前看不出它会
    // 插到哪儿，而落点又正好在指针底下、几乎没有飞行行程，看着就是凭空闪进去。
    onDragMove: (drag) => {
      showGapAt(pointerInside(sideRef, drag.x, drag.y) ? insertIndexAt(drag.x, drag.y) : null)
    },
    onDrop: (drag) => {
      // 落在早就让出来的那一格里（拖出面板又拖回来这种极端情况下空位可能还没建，现算一次）。
      const at = previewGapRef.current ?? insertIndexAt(drag.x, drag.y)
      // 收空位和加牌是同一批状态更新：下一拍那一格里坐的就是这张新牌，位置分毫不差，
      // 于是这一段 Flip 只有它自己在飞，旁边的牌一动不动。
      showGapAt(null)
      // 先量起点再改牌组：此刻卡还停在松手的位置，格子里那份新牌就是从这儿飞过去的。
      addCard(drag.id, drag.element, at)
      snapHome(drag.element)
    },
    onCancel: (drag) => {
      showGapAt(null)
      returnHome(drag.element, true)
    },
    onTap: (id, drag) => {
      /*
       * 教程模式下点一张卡池卡就是"加入牌组"，不再是放大查看（规格 §12 写的正是
       * "玩家点击指定 AI 牌后，卡牌进入牌组"）。放大查看这一步整段关掉：
       * 它会铺一层遮罩把引导层压住，而这一段教学也没有需要细看卡面的地方。
       *
       * 走的是「＋」那条路（addFromPool），于是加牌飞行动画和 onCardAdded 都照常，
       * 点错卡则由它里面的教程闸门挡下并让教程说话。
       *
       * 这一关排在「选不了的牌」前面，和 onDragStart、addFromPool 里的顺序一致：
       * 教学里点错卡的理由永远是"这一步先点高亮那张"，不该冒出"即将上线"这种
       * 和当前教学对不上的话。要加的那三张教学卡本来就都是已开放的，
       * 所以选不了的牌在教学里只会走上面这道教程闸门，加不进牌组。
       */
      if (tutorialRef.current !== undefined) {
        addFromPool(id, drag.element)
        return
      }
      // 选不了的牌不放大：点它就是在问"这张怎么选不了"，那就当场回这一句。
      // 这也是这类卡唯一会说话的地方——它们不给问号、也不给 hover 提示（见 PoolCard）。
      const blockedLabel = BLOCKED_CARD_LABELS.get(id)
      if (blockedLabel !== undefined) {
        refuseAdd(drag.element, blockedLabel)
        return
      }
      const card = CARD_BY_ID.get(id)
      if (card !== undefined) openZoom(card, 'pool', id)
    },
  })
  // onDragStart 要调 endDrag，而 handle 是本次 useCardDrag 的返回值，只能事后存进 ref 里绕开这个循环。
  poolDragRef.current = poolDrag
  attachPoolBind(poolDrag.bind)

  /**
   * 牌组里的牌，松手的三种结局：
   * - 还在面板里：挪到离指针最近的那一格（改牌组顺序）；
   * - 落在左边卡池里：从牌组移除，并且回到卡池里离指针最近的那一格（卡池跟着重排）；
   * - 落在这两块之外（顶栏、留边）：同样是移除，但落回卡池哪一格由默认规则定（见 returnToPool）。
   *
   * onDragStart 里要调 endDrag（教程期间不让拖），handle 又是本次 useCardDrag 的返回值，
   * 只能事后存进 ref 里绕开这个循环——同上面卡池那侧的 poolDragRef。
   *
   * 靠 zones 的顺序分这三种结局：范围小的排在前面，指针同时落在好几块里时前者赢。
   * 面板那块用的是内层 .deck-side__inner 而不是 .deck-side 本身：外层是卡池那个 hook 的落点，
   * 两个 hook 都会往落点元素上打 data-drop-hot，共用一个节点的话 CSS 就分不出
   * "拖进来要加入"和"拖着自己的牌在面板里换位置"这两件不一样的事。
   */
  const deckDragRef = useRef<CardDragHandle | null>(null)
  const deckDrag = useCardDrag({
    zones: [
      { ref: sideInnerRef, id: 'reorder' },
      { ref: gridRef, id: 'pool' },
      { ref: pageRef, id: 'out' },
    ],
    contextSafe,
    // 格子区同样自己滚，理由同卡池那侧。
    touchScrollGuard: true,
    ignoreSelector: '.deck-circle, .deck-help',
    onDragStart: (drag) => {
      // 教程期间牌组里的牌一张都不许动，拖也不行：当场掐掉，别让牌跟着指针跑一段再弹回去。
      // 排在摆正之前：这条路上牌根本不该动，摆正和拎出文档流都没必要做。
      if (blockedByTutorial()) {
        deckDragRef.current?.endDrag()
        return
      }
      // 起拖前先摆正，理由见 settleCard：liftCardOut 量的是外接矩形。
      settleCard(drag.element, deckTiltsRef.current.get(drag.id))
      // 格子区自己滚（见 .deck-slots），拖出去的牌不切成 fixed 就会被裁在格子区里。
      liftCardOut(drag.element)
    },
    onDrop: (drag, zone) => {
      // 拖出面板 = 移除。这一份牌下一拍就从 DOM 上摘走了，不用再管它切回文档流
      //（送回卡池那段动画由 removeEntry 接手，见 returnToPool）。
      // 落在卡池里的还多给一句"回到哪一格"，落在别处的按默认规则来。
      if (zone.id === 'pool') {
        removeEntry(drag.id, poolInsertIndexAt(drag.x, drag.y))
        return
      }
      if (zone.id === 'out') {
        removeEntry(drag.id)
        return
      }
      /*
       * 还在面板里 = 换位置。
       *
       * 这边不像"从卡池拖进来"那样一路让着空位：被拖的这一份自己占的格子已经空着
       * （牌被拎成了 fixed 贴在指针上），本身就是个看得见的空位；而真去边拖边重排的话，
       * React 重排格子等于把被拖的那个节点摘下来再插回去，浏览器会当场释放 pointer capture，
       * 这次拖拽直接被判成取消（实测过）。
       *
       * 所以顺序在松手这一下才定：重新铺一份数组是为了换个身份，好让那段 Flip 的 effect
       * 跑起来——顺序没变过时（原地松手）它也得跑，不然牌会停在指针底下不回格子。
       */
      const at = insertIndexAt(drag.x, drag.y)
      const from = deckRef.current.findIndex((item) => item.key === drag.id)
      // insertIndexAt 给的是"插在第几个之前"，而这份牌此刻还占着自己那一格，
      // 落点排在它后面时要减掉它自己占的那一格，否则会往后多挪一位。
      const next = reordered(drag.id, from >= 0 && at > from ? at - 1 : at)
      pendingFlipRef.current = {
        state: captureSlotsFlip(drag.id),
        flyKey: drag.id,
        duration: INSERT_DUR,
      }
      commitDeck(next ?? [...deckRef.current])
    },
    // 拖拽告吹（松在页面外、被浏览器打断）：牌飞回自己那一格，牌组没动过。
    onCancel: (drag) => returnHome(drag.element, true),
    onTap: (entryKey) => {
      // 同卡池那边：教程期间不开放大查看，点一下只会得到一句"这一步别动牌组"。
      if (blockedByTutorial()) return
      const card = cardOfEntry(entryKey)
      if (card !== undefined) openZoom(card, 'deck', entryKey)
    },
  })
  deckDragRef.current = deckDrag
  attachDeckBind(deckDrag.bind)

  // ---------- 卡角上那两颗按钮 ----------

  /**
   * 卡池卡右下角那颗「＋」。
   *
   * 加不了的时候按钮不是 disabled 而是 aria-disabled（见 PoolCard），点得着但走不通，
   * 就是为了能在这儿给一句反馈——真禁用的按钮连 click 都不发，玩家点半天没动静。
   */
  const addFromPool = useStable((cardId: CardId, cardEl: HTMLElement) => {
    // 教程期间点错卡的话，理由归教程说（"这一步先点高亮那张"），
    // 不能弹 blockReasonNow 那套和当前教学对不上的原因，所以这一关排在最前面。
    const guide = tutorialRef.current
    if (guide !== undefined && guide.allowedCardId !== cardId) {
      guide.onBlocked(guide.blockTip)
      return
    }
    const reason = blockReasonNow(cardId)
    if (reason !== null) {
      refuseAdd(cardEl, reason)
      return
    }
    // 指针正停在这张卡上，多半歪着；Flip 量的是外接矩形，得先摆正（理由见 settleCard）。
    settleCard(cardEl, poolTiltsRef.current.get(cardId))
    // 点击加入落在当前视野那一页的第一格，飞过去之后新牌一定就在眼前（见 pageInsertIndex）。
    addCard(cardId, cardEl, pageInsertIndex())
  })

  /** 问号热区的进出。卡池卡和迷你卡共用，翻面层由 flipHelp 自己从热区往上找。
      热区只长在能翻面的牌上（见 PoolCard 的 flippable），AI 牌和即将上线的牌都到不了这里。 */
  const handleHelpEnter = useStable((help: HTMLElement) => flipHelp(help, true))
  const handleHelpLeave = useStable((help: HTMLElement) => flipHelp(help, false))
  /**
   * 触屏点一下问号：正面翻过去，再点一下翻回来。
   *
   * 触屏没有 hover——pointerenter 是按下那一刻发的、pointerleave 是抬手那一刻发的，
   * 照着上面两个抄就成了"按住才看得见背面"，手一松就翻回去，字都没读完。
   * 和手牌那边同一个处理（见 ui/HandFan.tsx 的 handleHelpToggle），
   * 判"现在是哪一面"同样读元素当前的实际角度，翻到一半再点也接得上。
   */
  const handleHelpToggle = useStable((help: HTMLElement) => {
    const inner = help.parentElement?.querySelector<HTMLElement>(FLIP_LAYER_SELECTOR) ?? null
    if (inner === null) return
    flipHelp(help, Number(gsap.getProperty(inner, 'rotationY')) < 90)
  })

  // ---------- 牌组管理条 ----------

  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  /**
   * 按 Esc 取消改名后，输入框会被摘掉；某些浏览器还会再补一发 blur。
   * 用它把那一发挡掉，否则"取消"会变成"照草稿提交"。
   */
  const renameAbortRef = useRef(false)

  const currentDeck = useMemo(
    () => saved.decks.find((item) => item.id === saved.currentId),
    [saved],
  )
  const currentName = currentDeck?.name ?? ''
  const decksFull = saved.decks.length >= MAX_DECKS

  /** 管理条上只剩删除确认这一块浮层，切页面状态前统一收掉。 */
  const closeConfirm = useCallback(() => {
    setDeleting(false)
  }, [])

  // 展开时点外面收起。用 pointerdown 而不是 click：抓卡池的牌是 pointerdown 起手，
  // 等到 click 才收的话，拖拽全程浮层都还开着。
  useEffect(() => {
    if (!deleting) return
    const onPointerDown = (event: PointerEvent) => {
      const bar = manageRef.current
      if (bar !== null && event.target instanceof Node && bar.contains(event.target)) return
      setDeleting(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [deleting])

  /**
   * 切牌组后把当前那一枚 tab 滚进视野。
   *
   * tab 行装不下时横向滚动，而新建 / 删除都会让当前项跑到看不见的地方
   *（新建的排在最末，删除后接手的那套可能在任意位置）。
   * block / inline 都取 nearest：已经露在外面时一动不动，不会为了居中白滚一段。
   */
  useEffect(() => {
    currentTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [saved.currentId, saved.decks.length])

  const selectDeck = (id: string) => {
    closeConfirm()
    // 教程阶段不许切牌组：预填的那一套（「我的第一套牌组」）就是这一步要组的牌，
    // 换一套的话引导说的"已选 17 / 20"当场对不上。
    // 这条闸门原本挂在管理条的「切换」按钮上，那颗按钮已经摊成了这一行 tab。
    if (blockedByTutorial()) return
    if (id === savedRef.current.currentId) return
    closeZoom()
    openDeck(setCurrentDeck(id))
  }

  const createNewDeck = () => {
    closeConfirm()
    // 教程阶段不许新建牌组：这一步玩的就是眼前这套预填牌组。
    if (blockedByTutorial()) return
    const next = createDeck()
    // 已经 12 套。按钮此时本来就是禁用的，这里只是不让 null 往下走。
    if (next === null) return
    closeZoom()
    openDeck(next)
  }

  const confirmDelete = () => {
    closeConfirm()
    closeZoom()
    // 删掉当前牌组后 store 会自己挑一套新的当前（删到一套不剩时补一套空的），跟着它走就行。
    openDeck(deleteDeck(savedRef.current.currentId))
  }

  const startRename = () => {
    closeConfirm()
    // 教程阶段不许改名：牌组名「我的第一套牌组」是教学文案的一部分。
    if (blockedByTutorial()) return
    renameAbortRef.current = false
    setNameDraft(currentName)
    setRenaming(true)
  }

  const finishRename = () => {
    setRenaming(false)
    if (renameAbortRef.current) {
      renameAbortRef.current = false
      return
    }
    // 空名、超长名的处理都在 store 里（空名保持原名、按码点截到 10 字符）。
    applySaved(renameDeck(savedRef.current.currentId, nameDraft))
  }

  const cancelRename = () => {
    renameAbortRef.current = true
    setRenaming(false)
  }

  // ---------- 筛选 ----------

  // 种类 + 阵营两道筛，语义都在 deckFactions.ts 里。
  // 阵营只在「AI 牌」页签下参与筛选：另外两页不摆药丸，界面上看不见的筛选条件不该偷偷生效。
  const kindFilter: KindTabId = KIND_TABS[kindTab]?.id ?? 'all'
  const factionFilter = kindFilter === 'ai' ? faction : null
  const shown = useMemo(
    () => filterDeckCards(pool, kindFilter, factionFilter),
    [pool, kindFilter, factionFilter],
  )

  /**
   * 真正铺进格子的那一串：牌组本身，外加拖拽时为落点让出来的那一格（null 占位，见 previewGap）。
   *
   * 空位是"多插一个"而不是"占掉一张牌的位置"，所以尾巴上会挤掉一个空格子——牌组满着时
   * 卡池那张牌根本拖不动（blockReasonNow 会当场掐掉），不会挤掉一张真牌。
   */
  const slotEntries = useMemo<(DeckEntry | null)[]>(() => {
    if (previewGap === null) return deck
    const list: (DeckEntry | null)[] = [...deck]
    list.splice(Math.min(previewGap, deck.length), 0, null)
    return list
  }, [deck, previewGap])

  const shortfall = DECK_SIZE - deck.length
  const percent = Math.round((deck.length / DECK_SIZE) * 100)

  /**
   * 放大层上「加入牌组」点不了的原因；能加、或者看的是牌组里那一份时就是 null。
   * 这里调 blockReasonNow 是安全的：deckRef 在渲染期就已经跟着 deck 更新过了。
   */
  const zoomBlockReason =
    zoomSide === null || zoomSide.side !== 'pool' ? null : blockReasonNow(zoomSide.sourceId)

  // ---------- 动效 ----------

  /**
   * 给每张卡挂倾斜跟随。
   *
   * 必须在 useGSAP 回调里挂：attachCardTilt 建的补间要装进这个 context，离开页面时才一起收掉
   *（那个函数自己也是这么要求的）。
   *
   * 只给新出现的卡挂、只摘掉已经不在的卡，已经挂着的原样留着——**不能**整批重挂：
   * detach 会把倾斜和高光硬切回零，而正 hover 的那张卡并不会因为别处加了一张牌就离开指针，
   * 玩家会看到高光凭空消失，指针不动就再也不会有 pointermove，得晃一下鼠标才回来
   *（同 HandFan 里那段增量挂 / 摘）。
   *
   * 依赖非空时 useGSAP 只在**卸载**时跑清理，所以走掉的卡必须在这里自己摘，否则监听会一直留着。
   */
  useGSAP(
    () => {
      const sync = <T extends string>(
        handles: Map<string, CardTiltHandle>,
        ids: readonly T[],
        attach: (el: HTMLElement, id: T) => CardTiltHandle,
        elementOf: (id: T) => HTMLElement | null,
      ) => {
        const alive = new Set<string>(ids)
        for (const id of ids) {
          if (handles.has(id)) continue
          const el = elementOf(id)
          if (el === null) continue
          handles.set(id, attach(el, id))
        }
        for (const [id, handle] of handles) {
          if (alive.has(id)) continue
          handle.detach()
          handles.delete(id)
        }
      }

      sync(
        poolTiltsRef.current,
        shown,
        (el) =>
          attachCardTilt(el, {
            tiltLayer: '.deck-pool-card__tilt',
            maxTilt: POOL_TILT_DEG,
            // 拖起来之后不再跟指针歪：牌已经被 setPointerCapture 抓着，pointermove 照样发到它身上，
            // 不挡的话会拖着一张歪的牌满屏找落点（hover 高亮另有 __glow 那一层，所以不传 hoverScale）。
            enabled: () => poolDragRef.current?.draggingId() === null,
          }),
        (cardId) => findOrigin('pool', poolFlipId(cardId)),
      )

      sync(
        deckTiltsRef.current,
        deck.map((entry) => entry.key),
        (el) =>
          attachCardTilt(el, {
            tiltLayer: '.deck-mini__tilt',
            maxTilt: MINI_TILT_DEG,
            enabled: () => deckDragRef.current?.draggingId() === null,
          }),
        (entryKey) => findOrigin('deck', deckFlipId(entryKey)),
      )

      return () => {
        for (const handle of poolTiltsRef.current.values()) handle.detach()
        poolTiltsRef.current.clear()
        for (const handle of deckTiltsRef.current.values()) handle.detach()
        deckTiltsRef.current.clear()
      }
    },
    { dependencies: [shown, deck], scope: pageRef },
  )

  /**
   * 牌组变样之后，把整排格子从旧位置补一段过来。
   *
   * 旧位置是三个改牌组的地方在动手之前量下的那一份（见 pendingFlipRef）。这一段同时演两件事：
   * - 让位 / 补位：插在中间的一份会把后面的牌各推一格，移走一份则让后面全部往前补位。
   *   不补这一段的话它们是瞬间跳过去的，看着像整排牌闪了一下；
   * - 飞行：flyKey 那一份自己还要从别处飞进格子（加牌是从卡池那张牌，换位置是从松手的位置）。
   *
   * 播完就把状态清掉，所以严格模式下的二次执行只会空转一次。
   */
  useGSAP(
    () => {
      const pending = pendingFlipRef.current
      if (pending === null) return
      pendingFlipRef.current = null
      const flyer = pending.flyKey === null ? null : findOrigin('deck', deckFlipId(pending.flyKey))
      if (flyer !== null) {
        // 拖着换位置的那一份，身上还留着上一段拖拽写下的 fixed 定位和位移，先清干净：
        // 不清的话下面 liftCardOut 会拿"已经算过一次"的位置再算一遍。
        // 刚加进来的那一份是全新的节点，这两下写在它身上是空转。
        gsap.set(flyer, { x: 0, y: 0, rotation: 0, scale: 1, clearProps: 'zIndex' })
        dropCardBack(flyer)
        // 格子区是 overflow 容器，飞行的前半程整个在面板外面，不切成 fixed 会被裁掉
        //（理由同 liftCardForFlight）。
        liftCardOut(flyer)
        // 同层的其它格子都没有 z-index，从它们上空经过时不抬一层就会被盖住。
        gsap.set(flyer, { zIndex: INSERT_FLIGHT_Z })
      }
      // 取 targets 要排在 liftCardOut 之后：那一下会把飞的这张切成 fixed，
      // 而 flipMinis 正是按"是不是 fixed"筛人的（flyKey 那一份例外）。
      const targets = flipMinis(pending.flyKey)
      if (targets.length === 0) return
      Flip.from(pending.state, {
        targets,
        duration: pending.duration,
        ease: 'power3.out',
        // 用 scale 而不是 width / height：卡面里的字跟着一起缩，才像同一张牌变小了。
        scale: true,
      })
      if (flyer === null) return
      // 收尾走 delayedCall 而不是 Flip 的 onComplete，为的是能登记进 pendingDropRef：
      // 这一份牌还在飞的时候就可能被玩家抓起来拖，那时 liftCardOut 会先把这一发掐掉，
      // 否则它到点会把正拖着的牌清回格子里、还被格子区的 overflow 裁掉（同 liftCardForFlight）。
      pendingDropRef.current.set(
        flyer,
        gsap.delayedCall(pending.duration + DROP_BACK_DELAY, () => {
          // 逐个归零而不是 clearProps 抹整份 transform，理由同 snapHome。
          gsap.set(flyer, { x: 0, y: 0, rotation: 0, scale: 1, clearProps: 'zIndex' })
          dropCardBack(flyer)
        }),
      )
    },
    { dependencies: [deck], scope: pageRef },
  )

  /**
   * 送回卡池那一程：那张卡池卡从牌组格子飞回自己的格子，被它挤开的牌同时让位。
   *
   * 和上面那段是一对，只是演的是卡池这一侧（旧位置由 returnToPool 量下，见 pendingPoolFlipRef）。
   * 依赖里 shown 和 deck 都要有：卡池重排了看 shown，而"卡还在原地、只是牌飞回来"这一档
   *（点送回、卡池那张就在视野里）卡池根本没变，只能靠 deck 那一下把这段带起来。
   */
  useGSAP(
    () => {
      const pending = pendingPoolFlipRef.current
      if (pending === null) return
      pendingPoolFlipRef.current = null
      const targets = Array.from(
        gridRef.current?.querySelectorAll<HTMLElement>('.deck-pool-card') ?? [],
      )
      const flyer = findOrigin('pool', poolFlipId(pending.flyId))
      if (targets.length === 0 || flyer === null) return
      // 卡池是 overflow 容器，飞行的前半程整个在网格外面，不切成 fixed 会被裁掉。
      liftCardOut(flyer)
      // 落点常在右下角那一带，正压着灰卡；不抬一层最后几帧会钻到它们后面。
      gsap.set(flyer, { zIndex: RETURN_FLIGHT_Z })
      Flip.from(pending.state, {
        targets,
        duration: RETURN_FLIGHT_DUR,
        ease: 'power3.out',
        // 用 scale 而不是 width / height：卡面里的字跟着一起放大，才像同一张牌变大了。
        scale: true,
      })
      // 收尾走 delayedCall 而不是 Flip 的 onComplete，理由同上面那段：还在飞的时候
      // 就可能被玩家抓起来拖，那时 liftCardOut 会先把这一发掐掉。
      pendingDropRef.current.set(
        flyer,
        gsap.delayedCall(RETURN_FLIGHT_DUR + DROP_BACK_DELAY, () => {
          gsap.set(flyer, { x: 0, y: 0, rotation: 0, scale: 1, clearProps: 'zIndex' })
          dropCardBack(flyer)
        }),
      )
    },
    { dependencies: [shown, deck], scope: pageRef },
  )

  /**
   * 放大层：伴随层的淡入淡出，以及两张大卡（中央的正面、伴随层的背面）的倾斜。
   *
   * 中央那张的倾斜层取 .reveal-card__inner——这条链路整段不翻面（CardZoomOverlay 一上来就把它
   * 定死在正面），那一层的 rotationY 空着，正好借给倾斜用，不用再往展示卡里加一层。
   * 背面那张没有现成的空层可借（它的缩放层被 CSS 的 transform: scale() 占着，
   * GSAP 往同一个元素写 transform 会把缩放整个抹掉），所以另开了一层 .deck-zoom-side__tilt。
   *
   * 摘除不在这儿做：关闭那一拍中央那张会跟着卸载，得赶在它消失之前把角度收干净，
   * 所以 detach 放在 CardZoomOverlay 的 onClose 里（同一拍同步执行），两张一起摘。
   */
  useGSAP(
    () => {
      const sideLayer = zoomSideRef.current
      if (sideLayer !== null) {
        const opening = zoomed !== null
        gsap.to(sideLayer, {
          autoAlpha: opening ? 1 : 0,
          duration: ZOOM_SIDE_FADE,
          // 等大卡落位了再露面。除了"先看牌、再看操作"这个顺序更顺之外，还挡掉一个死角：
          // 飞入途中 CardZoomOverlay 不受理关闭（见它 requestClose 里的 heldRef），
          // 这时按下「加入 / 移出」牌是真的改了，放大层却关不掉，会僵在那儿。
          // autoAlpha 的 visibility 在延迟期间还是 hidden，所以延迟期间这一层根本吃不到点击。
          delay: opening ? ZOOM_IN_DUR : 0,
          ease: 'power2.out',
          overwrite: 'auto',
        })
      }
      if (zoomed !== null) {
        const showcase = pageRef.current?.querySelector<HTMLElement>('.reveal-card') ?? null
        if (showcase !== null) {
          zoomTiltRef.current = attachCardTilt(showcase, {
            tiltLayer: '.reveal-card__inner',
            maxTilt: ZOOM_TILT_DEG,
          })
        }
        // 背面那张此刻还是 visibility: hidden（上面那条淡入要等大卡落位），收不到指针事件，
        // 所以现在挂上不会提前歪；等它露面时指针一动就跟上了。
        const sideCard = sideLayer?.querySelector<HTMLElement>('.deck-zoom-side__card') ?? null
        if (sideCard !== null) {
          zoomSideTiltRef.current = attachCardTilt(sideCard, {
            tiltLayer: '.deck-zoom-side__tilt',
            // 和正面同一个角度，两张并排的卡歪起来才像一对。
            maxTilt: ZOOM_TILT_DEG,
          })
        }
      }
      // 依赖非空时这段只在卸载时跑：正常关闭走的是 onClose 里那一发 detachZoomTilt。
      return detachZoomTilt
    },
    { dependencies: [zoomed], scope: pageRef },
  )

  return (
    // 纸面（底色 + 两层纸纹 + 暗角）铺在最外层，16:9 舞台之外的留边也就是同一张纸，
    // 接缝看不出来；舞台只负责把版面锁进设计稿的比例里（见 deck.css 的 .deck-frame）。
    //
    // pageRef（既是 useGSAP 的 scope，也是「把牌拖出面板 = 移除」那块落点）挂在最外层
    // 而不是舞台上：挂舞台上的话，往右一甩正好落进右边那条留边，判不出落点、牌会飞回去。
    <div className="deck-frame paper-page grain" ref={pageRef}>
      {/* 纸面组件的 <use> 要在同一个文档里找得到 symbol，每页各挂一次（0 尺寸，不占布局）。
          手绘滤镜不用管，App 已经全局挂了一份。 */}
      <PaperIconDefs />

      <div className="deck-page">
        {/* 缩放层：整页按设计稿的 1672×941 排版，再整体等比缩到舞台大小（见 deck.css 的 16:9 舞台一节）。
            它带的 transform 顺带成了内部 position: fixed 元素的包含块，拖起来的牌和放大查看的遮罩
            因此是钉在舞台上而不是视口上；stage-scaler 是给 ui/battleStage.ts 认舞台用的公共类。 */}
        <div className="deck-scaler stage-scaler" ref={scalerRef}>
          {/* .paper-page__inner 把内容抬到两层纸纹之上（纸纹是 .grain 的两个绝对定位伪元素）。 */}
          <div className="paper-page__inner">
            {/* 整行左对齐，五件东西排在同一条基线上：返回 — 花饰 — 大标题 — 竖线 — 副标题。
                没给 onBack 时第一件直接不渲染，后面几件跟着往左挪一格——匹配流程里退不回大厅，
                与其留一颗点不动的按钮占位，不如让这一行整体左移。 */}
            <header className="deck-top">
              {/* 定位、字号、配色留在 .deck-back（deck.css），箭头和排版由公共的 .ui-back 负责。 */}
              {onBack === undefined ? null : <BackButton className="deck-back" onClick={onBack} />}
              <Sparkle className="deck-top__spark" />
              <h1 className="deck-top__title">组建牌组</h1>
              <i className="deck-top__rule" aria-hidden="true" />
              <p className="deck-top__sub">挑选你的 AI 与技能，准备迎战</p>
            </header>

            <main className="deck-body">
              {/* ---------- 左：卡池 ---------- */}
              <section className="deck-pool">
                <div className="deck-pool__head">
                  <div className="deck-kinds" role="tablist" aria-label="按种类筛选">
                    {KIND_TABS.map((tab, index) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={index === kindTab}
                        className="deck-kind"
                        data-active={index === kindTab}
                        // 教程期间不许切页签：一切就可能把当前要点的那张卡筛掉，
                        // 引导圈会指向一个已经不在页面上的元素。
                        onClick={() => {
                          if (blockedByTutorial()) return
                          setKindTab(index)
                        }}
                      >
                        {tab.label} {kindCounts[tab.id]}
                      </button>
                    ))}
                    {/* 三块牌匾坐着的那条基线。线和两端菱形都装在这一个盒子里，
                        手绘滤镜才只算一遍，也才有一个够高的计算盒不把菱形裁掉（见 deck.css）。 */}
                    <i className="deck-kinds__rule" aria-hidden="true">
                      <i className="deck-kinds__dia" />
                      <i className="deck-kinds__dia" />
                    </i>
                  </div>
                  {/* 阵营药丸只摆在「AI 牌」页签下：技能牌和阵营无关，「全部」是不加筛的总览。
                      另外两页各留一颗常亮的「全部卡牌」占住这一行——整行抽掉的话，
                      切页签时下面的卡池网格会跟着上下跳一截。 */}
                  <div
                    className="deck-factions"
                    role="group"
                    aria-label={kindFilter === 'ai' ? '按阵营筛选' : '卡池范围'}
                  >
                    {kindFilter !== 'ai' ? (
                      <button type="button" className="deck-faction" data-active>
                        全部卡牌
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="deck-faction"
                          data-active={faction === null}
                          onClick={() => setFaction(null)}
                        >
                          全部阵营
                        </button>
                        {FACTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className="deck-faction"
                            data-active={faction === option.id}
                            onClick={() => setFaction(option.id)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>

                <div className="deck-grid" ref={gridRef}>
                  {shown.map((cardId) => {
                    const thumb = THUMB_CARD_BY_ID.get(cardId)
                    if (thumb === undefined) return null
                    const flipId = poolFlipId(cardId)
                    const picked = copies.get(cardId) ?? 0
                    const blockedLabel = BLOCKED_CARD_LABELS.get(cardId) ?? null
                    return (
                      <PoolCard
                        key={cardId}
                        card={thumb}
                        picked={picked}
                        canAdd={blockedLabel === null && !deckFull && picked < MAX_COPIES}
                        blockedLabel={blockedLabel}
                        bind={bindPoolCard(cardId)}
                        onAdd={addFromPool}
                        onHelpEnter={handleHelpEnter}
                        onHelpLeave={handleHelpLeave}
                        onHelpToggle={handleHelpToggle}
                        hidden={zoomed?.flipId === flipId}
                      />
                    )
                  })}
                </div>

                {/* 教程模式下点一张卡就是加入牌组、也不开放大查看，这行字必须跟着改口，
                    否则它说的操作和实际行为对不上。 */}
                <p className="deck-pool__hint">
                  {tutorial !== undefined
                    ? '点击高亮的卡牌，把它加入牌组'
                    : deckFull
                      ? `牌组已满 ${DECK_SIZE} 张 · 先移除才能再加`
                      : '问号看背面 · 点击放大 · 加号或拖拽加入'}
                </p>
              </section>

              {/* ---------- 右：我的牌组 ---------- */}
              <aside className="deck-side" ref={sideRef} aria-label="我的牌组">
                <div className="deck-side__inner" ref={sideInnerRef}>
                  <OrnateFrame>
                    <div className="deck-side__body">
                      {/* OrnateTitle 自带「菱形—线—文字—线—菱形」，两侧再各挂一枚花饰收尾。 */}
                      <div className="deck-side__title">
                        <Sparkle />
                        <OrnateTitle>我的牌组</OrnateTitle>
                        <Sparkle />
                      </div>

                      {/*
                        牌组切换。以前是管理条上一颗「切换」按钮弹下拉，现在整套摊成一行 tab：
                        最多 12 套，一眼看全比点开再找快，也省掉一块要管开合和点外面收起的浮层。
                        末尾那颗「＋」不在滚动区里（是 .deck-tabs 的第二个孩子），tab 多到要滚时它仍然在原地。
                      */}
                      <div className="deck-tabs">
                        <div className="deck-tabs__list" role="tablist" aria-label="切换牌组">
                          {saved.decks.map((item) => {
                            const current = item.id === saved.currentId
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={current}
                                className="deck-tab"
                                data-current={current}
                                // 名字被省略号截掉时靠它看全，所以 title 一直挂着。
                                title={item.name}
                                ref={current ? currentTabRef : undefined}
                                onClick={() => selectDeck(item.id)}
                              >
                                {item.name}
                              </button>
                            )
                          })}
                        </div>
                        <button
                          type="button"
                          className="deck-tabs__new"
                          disabled={decksFull}
                          title={decksFull ? `最多 ${MAX_DECKS} 套` : '新建牌组'}
                          aria-label="新建牌组"
                          onClick={createNewDeck}
                        >
                          ＋
                        </button>
                      </div>

                      <div className="deck-manage" ref={manageRef}>
                        <div className="deck-manage__row">
                          {renaming ? (
                            <input
                              className="deck-manage__input"
                              value={nameDraft}
                              maxLength={DECK_NAME_MAX}
                              aria-label="牌组名"
                              // 点「改名」的下一拍输入框才出现，光标得自己送进去。
                              // 不用回调 ref 抢焦点：内联回调 ref 每次渲染都会重跑一遍，
                              // 打字打到一半光标会被拽回去。
                              autoFocus
                              onChange={(event) => setNameDraft(event.target.value)}
                              onBlur={finishRename}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') finishRename()
                                else if (event.key === 'Escape') cancelRename()
                              }}
                            />
                          ) : (
                            <span className="deck-manage__name" title={currentName}>
                              {currentName}
                            </span>
                          )}

                          <div className="deck-manage__actions">
                            <button type="button" className="deck-manage__btn" onClick={startRename}>
                              改名
                            </button>
                            <button
                              type="button"
                              className="deck-manage__btn"
                              onClick={() => {
                                // 教程阶段不许删牌组：预填的这一套正是教学要用的。
                                if (blockedByTutorial()) return
                                setDeleting((open) => !open)
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </div>

                        {/* 删除确认绝对定位，不占文档流：整页锁在一屏内，
                            管理条一旦能撑高，右面板就会顶出屏幕底部。 */}
                        {deleting ? (
                          <div className="deck-manage__confirm">
                            <span className="deck-manage__confirm-text">确认删除？</span>
                            <button
                              type="button"
                              className="deck-manage__mini deck-manage__mini--yes"
                              onClick={confirmDelete}
                            >
                              确定
                            </button>
                            <button
                              type="button"
                              className="deck-manage__mini"
                              onClick={() => setDeleting(false)}
                            >
                              取消
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {/* data-tutorial-anchor 是新手教程的语义锚点（见 tutorial/deckSteps.ts）：
                          组牌教学第一句话高亮的就是这块「已选 N / 20」。 */}
                      <div className="deck-tally" data-tutorial-anchor="deckCounter">
                        <p className="deck-tally__count">
                          已选 <b>{deck.length}</b>
                          <span className="deck-tally__total">/ {DECK_SIZE}</span>
                        </p>
                        <p className="deck-tally__mix">
                          AI 牌 {mix.ai} · 技能牌 {mix.skill}
                        </p>
                      </div>

                      <div className="deck-progress">
                        {/* 细线、右端菱形、墨绿填充块三层都在 __track 里，手绘滤镜挂在它身上算一次。
                            百分比数字留在外面：滤镜会把字扯糊。 */}
                        <div className="deck-progress__track">
                          <i className="deck-progress__fill" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="deck-progress__num">{percent}%</span>
                      </div>

                      {/* 外层只为了给滚动条两端的菱形装饰一个不跟着内容滚的定位参照，
                          滚的是里面那个 <ul>。 */}
                      <div className="deck-slots-wrap">
                        <ul className="deck-slots" ref={slotsRef}>
                          {Array.from({ length: DECK_SIZE }, (_, index) => {
                            const entry = slotEntries[index]
                            if (entry === undefined || entry === null) {
                              return (
                                <EmptyDeckSlot key={`empty-${index}`} gap={previewGap === index} />
                              )
                            }
                            const card = THUMB_CARD_BY_ID.get(entry.cardId)
                            if (card === undefined) return null
                            return (
                              <DeckSlotItem
                                key={entry.key}
                                card={card}
                                entryKey={entry.key}
                                bind={bindDeckCard(entry.key)}
                                onRemove={removeEntry}
                                onHelpEnter={handleHelpEnter}
                                onHelpLeave={handleHelpLeave}
                                onHelpToggle={handleHelpToggle}
                                hidden={zoomed?.flipId === deckFlipId(entry.key)}
                              />
                            )
                          })}
                        </ul>
                      </div>

                      <div className="deck-side__foot">
                        <div className="deck-side__notes">
                          {/* 教程阶段牌组是锁死的，这行字得跟着改口，
                              否则它说的操作一样都做不了。 */}
                          <p className="deck-side__hint">
                            {tutorial === undefined
                              ? '问号看背面 · 点击放大 · 拖动换位 · 拖回卡池移除'
                              : '教学阶段：牌组里的牌暂时不能改动'}
                          </p>
                          {shortfall > 0 ? (
                            <p className="deck-shortfall">还需选择 {shortfall} 张</p>
                          ) : null}
                        </div>
                        {/* 存档是实时写的，这里不用"保存"，只负责满 DECK_SIZE 张之后把牌组交出去。
                            教程模式下还要等引导走到最后一步才解锁（规格 §12：加满 20 张，按钮才亮）。
                            纯查看时（没有 onConfirm）这一格换成「返回匹配」，
                            省得只能去左上角找返回按钮。 */}
                        {onConfirm !== undefined ? (
                          <PlaqueButton
                            className="deck-confirm"
                            data-tutorial-anchor="deckConfirm"
                            disabled={
                              shortfall > 0 || (tutorial !== undefined && !tutorial.allowConfirm)
                            }
                            onClick={() => onConfirm(deck.map((entry) => entry.cardId))}
                          >
                            确认牌组
                          </PlaqueButton>
                        ) : onBack === undefined ? null : (
                          <PlaqueButton className="deck-confirm" onClick={onBack}>
                            返回匹配
                          </PlaqueButton>
                        )}
                      </div>
                    </div>
                  </OrnateFrame>
                </div>
              </aside>
            </main>

            {/* 无条件渲染：遮罩要常驻才演得出淡出，handle 也要一直在。
                必须挂在 .paper-page__inner 里面：这一层是 z-index: 1 的层叠上下文，遮罩留在它外面的话，
                飞回原位时写给卡池卡的 zIndex 1200 出不来，整段飞行会被正在淡出的遮罩压暗 + 模糊
                （见 CardZoomOverlay 里 ZOOM_FLIGHT_Z 的注释）。牌组侧还被 .deck-side 那个
                层叠上下文（relative + z-index: 3）关着，靠 liftSideForFlight 处理。 */}
            <CardZoomOverlay
              ref={zoomRef}
              target={zoomTarget}
              onClose={() => {
                // 赶在展示卡卸载之前收掉倾斜，否则它会在消失前先弹平一下。
                detachZoomTilt()
                if (zoomed !== null) {
                  liftCardForFlight(zoomed.side, zoomed.flipId)
                  if (zoomed.side === 'deck') liftSideForFlight()
                }
                setZoomed(null)
              }}
              closeOnEscape
            />

            {/*
              放大查看的伴随层：右边那张背面大卡 + 一行操作。
              第一次打开之后就一直挂着（zoomSide 只写不清），关闭时靠 GSAP 的 autoAlpha 演淡出——
              跟着 zoomed 挂载 / 卸载的话，那 0.25 秒的淡出根本没有节点可演（同遮罩的做法）。
            */}
            {zoomSide === null ? null : (
              <div className="deck-zoom-side" ref={zoomSideRef} aria-hidden={zoomed === null}>
                <div className="deck-zoom-side__card">
                  {/* 倾斜层，和卡池卡的 __tilt 同一个角色：ui/cardTilt.ts 只往这一层写
                      rotationX / rotationY，所以它自己不能带 CSS transform——下面那层缩放层
                      因此不能兼任。透视挂在外面的 __card 上（见 deck.css）。 */}
                  <div className="deck-zoom-side__tilt">
                    {/* 两种卡背的原始尺寸不一样（AI 走全局 .card-back 那份 150×225，
                        技能牌走本页的星象边框底图 284×426），所以各自缩到同一个盒子里，
                        缩放比在 deck.css 的 __scale--ai / --skill 两条上。 */}
                    <div
                      className={
                        zoomSide.card.kind === 'ai'
                          ? 'deck-zoom-side__scale deck-zoom-side__scale--ai'
                          : 'deck-zoom-side__scale deck-zoom-side__scale--skill'
                      }
                    >
                      {zoomSide.card.kind === 'ai' ? (
                        <CardBackFace card={zoomSide.card} />
                      ) : (
                        <SkillCardBack card={zoomSide.card} />
                      )}
                    </div>
                  </div>
                </div>
                <div className="deck-zoom-side__actions">
                  <BackButton className="deck-zoom-side__back" onClick={closeZoom} />
                  {zoomSide.side === 'pool' ? (
                    <>
                      <PlaqueButton
                        className="deck-zoom-side__do"
                        disabled={zoomBlockReason !== null}
                        onClick={zoomAdd}
                      >
                        加入牌组
                      </PlaqueButton>
                      {/* 按钮为什么点不了，就写在它旁边——这块遮罩盖住了整页，
                          玩家看不到底下卡池那条提示。 */}
                      {zoomBlockReason === null ? null : (
                        <span className="deck-zoom-side__why">{zoomBlockReason}</span>
                      )}
                    </>
                  ) : (
                    <PlaqueButton className="deck-zoom-side__do" onClick={zoomRemove}>
                      移出牌组
                    </PlaqueButton>
                  )}
                </div>
              </div>
            )}

            {/* 单例浮字（「牌组已满」之类）。常驻一个节点、位置和文案由 showAddTip 现写，
                理由见那里。留在 .paper-page__inner 里面：它的层级要压过拖起来的牌（1000）、
                又要低于展示遮罩（1100），出了这个层叠上下文就排不进这两者中间。 */}
            <div className="deck-add-tip" ref={addTipRef} aria-hidden="true" />
          </div>

          {/* 额外浮层的插槽，现在只有教程的引导层。挂在 .paper-page__inner 外面、
              仍然在 .deck-scaler 里面：前者是 z-index: 1 的层叠上下文（放进去就压不住页内元素），
              后者带着 transform（放出去引导层的 fixed 坐标就不再以舞台为准）。 */}
          {overlay}
        </div>
      </div>
    </div>
  )
}

/**
 * 卡池里的一张卡（含外面那个占位格子）。
 *
 * 拆成 memo 组件是为了让"加一张牌"只重画受影响的那一两张：一屏几十张，
 * 每张里面还有一整份 HandCardFace（图 + 文字层 + 羽化伪元素 + 高光层）。
 * 因此传进来的 props 必须个个引用稳定——card 是模块级常量、bind 按 id 缓存、
 * 三个回调走 useStable（contextSafe 包出来的函数每次渲染都换身份，直接传下去 memo 就废了），
 * hidden 用布尔值而不是现拼的 style 对象。
 *
 * 点击放大不走这里：那是 useCardDrag 的 onTap（按下没走过阈值才算点击），
 * 单独挂 onClick 会和拖拽抢同一次按下。
 */
interface PoolCardProps {
  /** 缩略图版的卡数据（见 THUMB_CARD_BY_ID）。 */
  card: HandCardData
  /** 这张卡已经选了几份。 */
  picked: number
  canAdd: boolean
  /**
   * 这张牌永远选不进牌组时，牌子上要印的那句话（「即将上线」或「暂未接入」，
   * 名单见 BLOCKED_CARD_LABELS）；能选的牌传 null。
   *
   * 卡面灰掉、常驻一枚印着这句话的小牌子，另外**不给问号**：翻过去也只是一段还没生效的
   * 效果说明，不如让这类卡安静地待在卡池末尾，一眼就知道是占位。
   * 拦下"加不进去"这件事的不是它，而是 blockReasonNow：三个入口都走那一条判定。
   */
  blockedLabel: string | null
  bind: CardDragBindings
  /**
   * 点了「＋」。第二个参数是这张卡的外层元素（.deck-pool-card）：
   * 加得进去时它是飞进格子那段动画的起点，加不进去时摇头和浮字也定位到它。
   * 加不加得进由调用方判，这里连 canAdd 都不看——按钮不是真禁用，理由见 addFromPool。
   */
  onAdd: (cardId: CardId, cardEl: HTMLElement) => void
  /** 问号热区的进出，翻到背面 / 翻回正面。参数是热区自己。只有技能牌挂问号（见 flippable）。 */
  onHelpEnter: (help: HTMLElement) => void
  onHelpLeave: (help: HTMLElement) => void
  onHelpToggle: (help: HTMLElement) => void
  /** 这张卡正被放大，原位要就地藏起来。 */
  hidden: boolean
}

const PoolCard = memo(function PoolCard({
  card,
  picked,
  canAdd,
  blockedLabel,
  bind,
  onAdd,
  onHelpEnter,
  onHelpLeave,
  onHelpToggle,
  hidden,
}: PoolCardProps) {
  /*
   * 能不能翻面。不能翻的牌，问号、热区和背面整层一起不渲染，两类：
   * - AI 牌：正面已经把要看的都印全了，翻过去没有新东西，问号只是白点一下
   *   （对局手牌同一条口径，见 ui/HandFan.tsx 的 flippable）。想看那张卡背仍然有路：
   *   点开放大，伴随层右边就摆着一张背面大卡。
   * - 选不了的牌（「即将上线」和「暂未接入」）：背面只是一段还没生效的效果说明，
   *   问号留着只会让人一直去点，热区还会把「点卡面 = 弹一句原因」那一下吃掉。
   */
  const flippable = blockedLabel === null && card.kind !== 'ai'
  return (
    // 外层格子只管占位：里面那张牌拖起来时会切成 fixed 脱离文档流（见 liftCardOut），
    // 没有这个盒子的话邻牌会立刻塌陷补位。
    <div className="deck-pool-slot">
      <div
        className="deck-pool-card"
        // 拖拽、Flip 起飞、藏起来，全都对着这一个元素：hook 写 transform 的是它，
        // Flip 量的也得是它，两者错开的话飞行的起点就不是牌真正所在的位置。
        data-flip-id={poolFlipId(card.id)}
        data-picked={picked > 0 ? picked : undefined}
        // 「选满了」交给这个布尔属性，而不是让 CSS 去对 data-picked 的具体数字：
        // 那样每次调 MAX_COPIES 都得记得回去改选择器里的那个数（见 deck.css）。
        data-full={picked >= MAX_COPIES ? 'true' : undefined}
        data-blocked={blockedLabel === null ? undefined : 'true'}
        style={hidden ? HIDDEN_IN_PLACE : undefined}
        {...bind}
      >
        {/*
          三层分工照抄手牌（ui/HandFan.tsx 的 slot / __tilt / __inner）：
          外层这个元素归拖拽和 Flip 写 transform，__tilt 留给倾斜（rotationX / rotationY），
          __inner 留给翻面（rotationY 180°）。倾斜和翻面都要动 rotationY，挤在同一层就是打架。
          倾斜由上面那个依赖 shown / deck 的 useGSAP 挂上去，翻面由问号热区触发（flipHelp）；
          两面身上的 data-flip-face 是 ui/flipCard.ts 认人的契约，改类名可以，这个属性不能动。
        */}
        <div className="deck-pool-card__tilt">
          <div className="deck-pool-card__inner">
            <div className="deck-pool-card__face deck-pool-card__face--front" data-flip-face="front">
              {/* 卡面是写死的 150×225，放大靠这一层缩放；它在 __face 里面，
                  所以外层那些要按屏幕像素算的东西（问号、圆圈按钮）不会跟着放大。 */}
              <div className="deck-pool-card__scale">
                <HandCardFace card={card} />
              </div>
              {/* 看得见的问号圆章。正面这一份不用另加 .card-glare：HandCardFace 自带一层。 */}
              {flippable ? <CardHelpMark className="deck-pool-card__help-mark" /> : null}
            </div>
            {/* 背面整层只给能翻面的牌渲染（理由见 flippable）。一屏几十张卡，
                白铺一层看不到的卡背不便宜。 */}
            {flippable ? (
              <div
                className="deck-pool-card__face deck-pool-card__face--back"
                data-flip-face="back"
              >
                <div className="deck-pool-card__scale">
                  <CardBackFace card={card} />
                </div>
                {/* 背面同一个角上也放一个：翻过去之后指针底下仍然压着一个问号。 */}
                <CardHelpMark className="deck-pool-card__help-mark" />
              </div>
            ) : null}
          </div>
          {/*
            问号的透明热区，只管交互，样子全交给上面 __inner 里那两个圆圈。
            必须留在 __inner 外面：跟着翻面转的话，牌一翻到背面它就转到指针够不着的地方，
            pointerleave 立刻翻回来、又被 hover 到，来回抖个没完（原委见 styles.css 的 .hand-fan__help）。
            靠 ignoreSelector 让「按在问号上」不等于抓牌（见两个 useCardDrag 的 ignoreSelector）。

            翻不了的牌（AI 牌、选不了的牌）整个不挂它：热区留着就是一块盖在卡右上角、
            按下去什么都不发生的死区，还会把「点卡面 = 放大 / 弹一句原因」那一下吃掉。
          */}
          {flippable ? (
            <button
              type="button"
              className="deck-help"
              aria-label={`查看「${card.name}」的背面`}
              /* 移入翻过去、移出翻回来只给鼠标；触屏走 pointerup 点一次翻一次，
                 理由见 handleHelpToggle。 */
              onPointerEnter={(event) => {
                if (event.pointerType !== 'mouse') return
                onHelpEnter(event.currentTarget)
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== 'mouse') return
                onHelpLeave(event.currentTarget)
              }}
              onPointerUp={(event) => {
                if (event.pointerType === 'mouse') return
                onHelpToggle(event.currentTarget)
              }}
            />
          ) : null}
        </div>
        {/* hover 高亮预先画好，只切 opacity（合成器就能做完，不重画卡面）。
            排在卡面之后、按钮之前：卡面不透明会盖住它，而按钮和圆章不该被它罩上一层白。
            和下面两个角标一样是 .deck-pool-card 的直接子级，不进 __tilt——它们按屏幕正对着看，
            不该跟着卡面一起歪。 */}
        <i className="deck-pool-card__glow" aria-hidden="true" />
        {/*
          加不进去时用 aria-disabled + data-disabled，而不是真的 disabled：
          真禁用的按钮连 click 都不发，玩家点半天没反应还是不知道为什么；
          现在点得着，由 onAdd 那边摇个头再说一句原因。样式上仍然是一副禁用相（见 deck.css）。
        */}
        <button
          type="button"
          className="deck-circle deck-circle--add"
          aria-disabled={!canAdd}
          data-disabled={canAdd ? undefined : 'true'}
          aria-label={`把「${card.name}」加入牌组`}
          onClick={(event) => {
            const cardEl = event.currentTarget.closest<HTMLElement>('.deck-pool-card')
            if (cardEl !== null) onAdd(card.id, cardEl)
          }}
        >
          <CircleGlyph kind="add" />
        </button>
        {/*
          常驻的小牌子，印着这张牌为什么选不了。光把卡面刷灰不够：选满份数的卡也是灰的
          （见 deck.css），几种灰摆在同一屏里分不出来，得有一行字说明这张是哪一种。
          和下面那枚圆章一样是 .deck-pool-card 的直接子级，不跟着卡面倾斜、翻面。
        */}
        {blockedLabel === null ? null : (
          <span className="deck-pool-card__blocked">{blockedLabel}</span>
        )}
        {picked > 0 ? (
          <span className="deck-pool-card__seal" aria-hidden="true">
            {`×${picked}`}
          </span>
        ) : null}
      </div>
    </div>
  )
})

/** 牌组里的一格牌。拆 memo 的理由同 PoolCard，props 的稳定性要求也一样。 */
interface DeckSlotItemProps {
  /** 缩略图版的卡数据（见 THUMB_CARD_BY_ID）。 */
  card: HandCardData
  /** 这一份牌的 key，同时是拖拽 id 和 Flip 配对键的来源。 */
  entryKey: string
  bind: CardDragBindings
  onRemove: (entryKey: string) => void
  /** 问号热区的进出，同 PoolCardProps。 */
  onHelpEnter: (help: HTMLElement) => void
  onHelpLeave: (help: HTMLElement) => void
  onHelpToggle: (help: HTMLElement) => void
  hidden: boolean
}

const DeckSlotItem = memo(function DeckSlotItem({
  card,
  entryKey,
  bind,
  onRemove,
  onHelpEnter,
  onHelpLeave,
  onHelpToggle,
  hidden,
}: DeckSlotItemProps) {
  // 同 PoolCard 的 flippable：AI 牌翻过去没有新东西，问号、热区和背面整层一起不渲染。
  // 牌组里不会有选不了的牌，所以这边只判卡种。
  const flippable = card.kind !== 'ai'
  return (
    <li className="deck-slot">
      <div
        className="deck-mini"
        data-flip-id={deckFlipId(entryKey)}
        style={hidden ? HIDDEN_IN_PLACE : undefined}
        {...bind}
      >
        {/* 层级和卡池那张卡完全一样，只是缩放比换成 --deck-mini-scale，逐层的理由见 PoolCard。 */}
        <div className="deck-mini__tilt">
          <div className="deck-mini__inner">
            <div className="deck-mini__face deck-mini__face--front" data-flip-face="front">
              {/* 缩放写在内层：外层要留给 hook 和归位补间写 transform，
                  两边写同一个属性会互相抹掉（GSAP 是内联 transform，压得死 CSS 那份）。 */}
              <div className="deck-mini__card">
                <HandCardFace card={card} />
              </div>
              {flippable ? <CardHelpMark className="deck-mini__help-mark" /> : null}
            </div>
            {/* 背面整层只给能翻面的牌渲染，理由同 PoolCard 的 flippable。 */}
            {flippable ? (
              <div className="deck-mini__face deck-mini__face--back" data-flip-face="back">
                <div className="deck-mini__card">
                  <CardBackFace card={card} />
                </div>
                <CardHelpMark className="deck-mini__help-mark" />
              </div>
            ) : null}
          </div>
          {/* 同 PoolCard 里那颗：只管交互的透明热区，留在 __inner 外面不跟着翻面。
              翻不了的牌整个不挂它：热区盖在卡右上角，留着会把「点卡面 = 放大查看」那一下吃掉。 */}
          {flippable ? (
            <button
              type="button"
              className="deck-help deck-help--mini"
              aria-label={`查看「${card.name}」的背面`}
              /* 移入翻过去、移出翻回来只给鼠标；触屏走 pointerup 点一次翻一次，
                 理由见 handleHelpToggle。 */
              onPointerEnter={(event) => {
                if (event.pointerType !== 'mouse') return
                onHelpEnter(event.currentTarget)
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== 'mouse') return
                onHelpLeave(event.currentTarget)
              }}
              onPointerUp={(event) => {
                if (event.pointerType === 'mouse') return
                onHelpToggle(event.currentTarget)
              }}
            />
          ) : null}
        </div>
        {/* 同 .deck-pool-card__glow：hover 只切 opacity。挂在外层而不是缩放层里，
            这样它按格子的实际尺寸铺满，不用跟着 --deck-mini-scale 反算。 */}
        <i className="deck-mini__glow" aria-hidden="true" />
        <button
          type="button"
          className="deck-circle deck-circle--remove"
          aria-label={`从牌组移除「${card.name}」`}
          onClick={() => onRemove(entryKey)}
        >
          {/* 画的是「送回卡池」的回退箭头而不是叉：这一格里的牌没有被销毁，只是回到左边的卡池。 */}
          <CircleGlyph kind="return" />
        </button>
      </div>
    </li>
  )
})

/**
 * 卡牌背面（写死 150×225，和 HandCardFace 同一个口径，外面套缩放层用）。
 *
 * 技能牌那一支的 markup 和对局手牌那份（ui/HandFan.tsx 里 .hand-fan__face--back 那段）保持一致，
 * 用的也是全局的 .card-back 一套样式：同一张牌在对局里和在这一页翻过来必须长得一样，
 * 铺的是星象边框底图再压卡名和 backText（底图见 .card-back--skill）。
 * AI 牌那一支铺的是 AiCardBack：统一星图卡背上叠一块纸面，写 AI 名称和它的专属技能，
 * 卡池卡、牌组格子翻面和放大查看的伴随层共用同一份。
 */
function CardBackFace({ card }: { card: HandCardData }) {
  return (
    <div className={cardBackClassName(card.kind)}>
      {card.kind === 'ai' ? (
        <AiCardBack card={card} />
      ) : (
        <>
          <span className="card-back__title">{card.name}</span>
          <p className="card-back__text">{card.backText}</p>
        </>
      )}
      {/* 背面也要有高光层，否则翻过去之后跟着指针的反光会凭空消失（正面那层在 HandCardFace 里）。 */}
      <div className="card-glare" />
    </div>
  )
}

/**
 * 放大查看时右边那张「星象边框」技能牌背面（写死 284×426，外面套缩放层用）。
 *
 * 和卡池 / 格子里翻面看到的那张（CardBackFace 的技能牌分支，走全局 .card-back）不是一份：
 * 那份要在 150×225 里挤下一整段说明，只能小字紧排；这里卡足够大，才撑得起这张带边框的
 * 底图和居中的名称 / 效果排版。
 * 边框只是一张底图，名称和效果由卡牌数据覆盖在中央——新增技能或改文案都不用再烤一张新图。
 */
function SkillCardBack({ card }: { card: HandCardData }) {
  // 文案长了就换一档更紧的排版（字号、行距、间距，见 deck.css 的 data-copy-size）。
  // 42 是照这张底图的可用高度试出来的：再长就会顶到边框的花纹上。
  const longCopy = card.text.length > 42
  return (
    <div className="deck-skill-back" data-copy-size={longCopy ? 'long' : 'normal'}>
      <img
        className="deck-skill-back__frame"
        src={midFor('/cards/skills/skill-card-back.webp')}
        alt=""
        draggable={false}
      />
      <div className="deck-skill-back__content">
        <span className="deck-skill-back__eyebrow">技能说明</span>
        <h2 className="deck-skill-back__title">{card.name}</h2>
        <span className="deck-skill-back__divider" aria-hidden="true">
          ✦
        </span>
        <p className="deck-skill-back__effect">{card.text}</p>
      </div>
      {/* 跟着指针跑的高光。放大层给这张卡挂了倾斜（见上面那个管放大层的 useGSAP），
          attachCardTilt 是在挂载的那个元素里找 .card-glare 的，没有这一层就只有倾斜没有反光，
          和左边正面那张（高光在 HandCardFace 里）对不上。 */}
      <div className="card-glare" />
    </div>
  )
}

/** 空格子。没有 props，memo 之后整页只会渲染这一份输出。 */
const EmptyDeckSlot = memo(function EmptyDeckSlot({ gap = false }: { gap?: boolean }) {
  return (
    // gap = 这是拖拽时为落点让出来的那一格（见 previewGap），亮着告诉玩家松手会落在这儿。
    <li className="deck-slot" data-gap={gap ? 'true' : undefined}>
      {/* 空格用纸面组件库那个「空卡槽」形态：虚线框 + 淡罗盘。 */}
      <PaperCardBack slot className="deck-slot__back" />
    </li>
  )
})

/**
 * 四角星花饰「✦」。顶栏和「我的牌组」标题两侧用的都是它。
 *
 * 用内联 SVG 而不是字符：这一页的线条都套着手绘抖动滤镜，字符画出来的是字体轮廓，
 * 位移滤镜作用在它上面会糊成一团（同下面 CircleGlyph 的理由）。
 * 四条边都是往中心拉的二次曲线，所以星角是内凹的，而不是一个方块转 45°。
 */
function Sparkle({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`deck-spark ${className}`.trim()}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 0.8 Q8.9 7.1 15.2 8 Q8.9 8.9 8 15.2 Q7.1 8.9 0.8 8 Q7.1 7.1 8 0.8 Z" />
    </svg>
  )
}

/**
 * 卡角上那个圆圈图标（加入 ＋ / 送回卡池 ↩）。
 *
 * 用内联 SVG 而不是文字符号：这一页所有线条都挂着手绘抖动滤镜，圆圈得跟着一起歪，
 * 字符画的圆是字体轮廓，滤镜作用在它上面会糊成一团。
 */
function CircleGlyph({ kind }: { kind: 'add' | 'return' }) {
  return (
    <svg className="deck-circle__ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9.4" />
      {kind === 'add' ? (
        <path d="M12 7.2 L12 16.8 M7.2 12 L16.8 12" />
      ) : (
        /* 掉头箭头：右边一竖上行，绕过顶上的半圆折回左边，箭头朝下——
           «这张牌顺原路回卡池去»。全是直线加一段圆弧，和上面那个「＋」是同一种线条风格。 */
        <path d="M15.4 16.6 L15.4 11.6 A3.4 3.4 0 0 0 8.6 11.6 L8.6 15.6 M6.4 13.2 L8.6 15.9 L10.8 13.2" />
      )}
    </svg>
  )
}
