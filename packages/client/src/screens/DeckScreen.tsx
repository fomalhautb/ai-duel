/**
 * 组建牌组页。
 *
 * 卡池是玩家存档里已拥有的真卡（core 的 CardId，能直接进对局）。
 * 整页的存档读写走 save/deckStore.ts：加一张牌、改一次名都立刻写回 localStorage，
 * 所以界面上没有"未保存"这个状态，也没有保存按钮。
 *
 * 受控组件：不导航，「确认牌组」把当前牌组的卡 id 交给 props.onConfirm，返回走 props.onBack。
 * 于是同一个组件既能当大厅里的独立页（/deck），也能嵌进匹配后的流程（RoomScreen 的选卡组一步），
 * 还能当新手教程的组牌一步（/tutorial，多传一个 tutorial prop）。
 * 没有 initialDeck 这种 prop——预填天生来自 deckStore 里的当前牌组，这一页自己读写它，
 * 教程的 17 张预填也是同一条路：进这一页之前先把那套牌组写进 deckStore 并设为当前。
 *
 * 教程模式（DeckScreenTutorial）只做减法：除了引导指定的那张卡和「确认牌组」，
 * 其余操作（移除、加别的卡、改名、切换/新建/删除牌组、切页签、放大查看）一律挡下并喊一声，
 * 由教程去显示一句提示。不传这个 prop 的两条入口行为一字不变。
 *
 * 三块复用件：
 * - 卡面用对局那套 HandCardFace（150×225），牌组里的迷你卡是同一份排版整体缩小（--deck-mini-scale）；
 * - 拖拽用 ui/useCardDrag，卡池和牌组各一个实例，手感参数全走 hook 默认值，和对局手牌一致；
 * - 放大查看用 ui/CardZoomOverlay，这一页只有它一条链路会动遮罩，所以用组件自带的那块
 *   （不传 veilRef），点遮罩和 ESC 都能关。
 *
 * 性能上有三处刻意的安排，改这一页时别顺手拆掉：
 * 1. 卡池卡和格子里的迷你卡各自是 React.memo 组件，传给它们的 props 全部引用稳定
 *    （回调 useCallback、拖拽事件按 id 缓存、卡数据是模块级常量），加一张牌只会重渲染
 *    受影响的那一两张，而不是整屏几十张；
 * 2. 这两处的卡面走缩略图（thumbFor），放大查看仍用原画；
 * 3. 卡面挂了 content-visibility: auto，离屏的卡不渲染内部（见 deck.css）。
 *
 * 视觉沿用 /design 那套纸面 token：整页是羊皮纸，左边卡池是嵌在纸上的深蓝星图面板
 * （和对局界面"纸侧栏夹着深色战场"的关系一致），右边牌组面板是纸面雕花框。
 * 桌面鼠标环境 only，不做触屏和窄屏适配，口径和对局页一致。
 *
 * 版面锁在 16:9 舞台里，和对局页同一套（见 deck.css 的「16:9 舞台」一节）：排版永远按
 * 设计稿的 1672×941 走，整块画面交给 .deck-scaler 的 transform: scale() 缩到窗口里。
 * 对这个文件的直接影响只有一处——那个 transform 让 .deck-scaler 成了内部 position: fixed
 * 元素的包含块，所以 liftCardOut 写 left/top 之前要先把视口坐标换算成舞台内坐标
 * （ui/battleStage.ts）。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { CARD_POOL, getCard } from '@ai-duel/core'
import type { CardId, HandCard } from '@ai-duel/core'
import { BackButton } from '../ui/BackButton'
import { cardArtFor } from '../ui/cardArt'
import { thumbFor } from '../ui/cardArtThumb'
import { CardZoomOverlay, ZOOM_OUT_DUR } from '../ui/CardZoomOverlay'
import type { CardZoomHandle, CardZoomTarget } from '../ui/CardZoomOverlay'
import { HandCardFace } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { HandDrawnFilterDefs } from '../ui/HandDrawnFilterDefs'
import { OrnateFrame } from '../ui/OrnateFrame'
import { PlaqueButton } from '../ui/PlaqueButton'
import { battleStageMetrics, toStagePoint } from '../ui/battleStage'
import { cardBackText } from '../ui/cardText'
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
import { loadSave } from '../save/save'
import './deck.css'

gsap.registerPlugin(useGSAP)

/** 拖拽结束后把卡送回原位的补间时长。成功和取消都走它，所以两种结果的收束速度一致。 */
const RETURN_DUR = 0.28

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
    return { ...base, kind: 'ai', model: card.model }
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
 * 建的是**整个卡池**而不是玩家已拥有的那部分：卡池是编译期就定死的常量（core 的 CARDS），
 * 建成模块级常量才能保证对象身份稳定——它是传给下面两个 React.memo 卡片组件的 props，
 * 每次渲染现拼的话 memo 就永远命不中。玩家拥有哪些卡是渲染时再筛的（见 pool）。
 */
const CARD_BY_ID = new Map<CardId, HandCardData>(
  CARD_POOL.map((cardId) => [cardId, handCardOfDefinition(getCard(cardId))]),
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
  CARD_POOL.map((cardId) => {
    const card = handCardOfDefinition(getCard(cardId))
    return [cardId, { ...card, art: thumbFor(cardArtFor(cardId)) }]
  }),
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
 * 存 key 而不是直接用下标当身份：同一张卡可以带两份，而删掉中间一份会让后面所有份的下标平移，
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
}

/** 卡池那张卡的 Flip 配对键。加前缀是因为同一张卡在牌组里还有一份，两边的键不能撞。 */
function poolFlipId(cardId: CardId): string {
  return `pool:${cardId}`
}

/** 牌组里那一份的 Flip 配对键。用 entry.key，所以删掉别的份不会让它换 id。 */
function deckFlipId(entryKey: string): string {
  return `deck:${entryKey}`
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

export interface DeckScreenProps {
  /**
   * 满 DECK_SIZE 张点确认时回调，参数是牌组的卡 id，顺序即玩家的选牌顺序。
   * 不用在回调里落盘：这一页每改一张牌就写过 deckStore 了。
   */
  onConfirm: (deck: CardId[]) => void
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

export function DeckScreen({ onConfirm, onBack, tutorial, overlay }: DeckScreenProps) {
  const [kindTab, setKindTab] = useState(0)
  const [zoomed, setZoomed] = useState<ZoomState | null>(null)
  /** 发号器，只保证 key 不重复，数值本身没有含义。 */
  const nextKeyRef = useRef(0)

  const pageRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLElement>(null)
  const sideInnerRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef<HTMLUListElement>(null)
  const zoomRef = useRef<CardZoomHandle>(null)
  const manageRef = useRef<HTMLDivElement>(null)

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
   * 卡池 = 存档里已拥有的卡，挂载时读一次。
   * 这一页不会解锁新卡（收藏只在对局结束后变，见 save/save.ts 的 recordWin），
   * 所以中途不用重读，读一次还能保证卡池顺序稳定、网格不会莫名重排。
   */
  const pool = useMemo<readonly CardId[]>(() => loadSave().ownedCards, [])

  /**
   * 页签上的数字。按整个卡池实算，不跟着当前页签变：
   * 它说的是"这一类我一共有多少张"，跟着筛选跳的话就没法用它判断筛掉了多少。
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
   * 现在还能不能再加一份这张卡。
   *
   * 读 deckRef 而不是上面那个 copies：拖拽回调是跨渲染活着的，闭包里的 state 会过期。
   * 渲染时算 canAdd 走 copies，两边结论一致，只是取数的地方不同。
   */
  const canAddNow = useCallback((cardId: CardId) => {
    const current = deckRef.current
    if (current.length >= DECK_SIZE) return false
    let owned = 0
    for (const entry of current) {
      if (entry.cardId === cardId) owned += 1
    }
    return owned < MAX_COPIES
  }, [])

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

  const addCard = useCallback(
    (cardId: CardId) => {
      const guide = tutorialRef.current
      // 教程期间只放行当前这一步点名的那张，连"再加一份已经加过的牌"也一起挡掉：
      // 不挡的话玩家连点两下就把牌组填满了，后面几步没牌可加。
      if (guide !== undefined && guide.allowedCardId !== cardId) {
        guide.onBlocked(guide.blockTip)
        return
      }
      if (!canAddNow(cardId)) return
      nextKeyRef.current += 1
      commitDeck([...deckRef.current, { key: `pick-${nextKeyRef.current}`, cardId }])
      guide?.onCardAdded(cardId)
    },
    [canAddNow, commitDeck],
  )

  const removeEntry = useCallback(
    (entryKey: string) => {
      // 教程阶段牌组里的牌一张都不许动（规格 §15）。
      if (blockedByTutorial()) return
      const current = deckRef.current
      const next = current.filter((entry) => entry.key !== entryKey)
      // 这份牌已经不在了（同一拍里被移过一次）就什么都别做：
      // 否则白写一次存档，还会让整排格子跟着重渲染一遍。
      if (next.length === current.length) return
      commitDeck(next)
    },
    [blockedByTutorial, commitDeck],
  )

  const cardOfEntry = (entryKey: string): HandCardData | undefined => {
    const entry = deckRef.current.find((item) => item.key === entryKey)
    return entry === undefined ? undefined : CARD_BY_ID.get(entry.cardId)
  }

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

  const openZoom = (card: HandCardData, side: ZoomState['side'], flipId: string) => {
    const zoom = zoomRef.current
    // hasPendingFlip：上一次的点击已经受理、对应的 effect 还没跑，这一拍抢进来会把那份状态丢掉。
    if (zoom === null || zoomed !== null || zoom.hasPendingFlip()) return
    const origin = findOrigin(side, flipId)
    if (origin === null) return
    // 上一次的飞回还没走完就又点开一张：先把面板的临时抬升撤掉，
    // 否则这次放大期间它会浮在遮罩之上不被压暗（晚一点到期的那次 delayedCall 只是再删一遍，无害）。
    const sideEl = sideRef.current
    if (sideEl !== null) delete sideEl.dataset.zoomFlight
    // 此刻原位那张还是可见的（下面 setZoomed 之后才会被藏起来），量到的正是起飞位置，两步不能对调。
    zoom.captureOrigin(origin)
    setZoomed({ card, flipId, side })
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
     * getBoundingClientRect 量到的是**变换之后**的视觉框，而这截 transform 起拖后不会消失
     * （useCardDrag 起拖时正是拿元素当前的 x / y 当位移基准接着用），照抄进
     * left / top / width / height 就等于把它算两遍：卡会在起拖瞬间跳开一截，尺寸也按放大后的定死。
     *
     * 所以这里把视觉框换算回"元素没有 transform 时的那个框"再写上去，
     * 于是「新的 left/top/width/height + 留着的那截 transform」正好还是此刻的视觉位置，切换看不出来。
     * 静止起拖时位移是 0、缩放是 1，算出来和直接用 rect 一模一样。
     *
     * 两步换算的顺序不能反：rect 是视口坐标，先除掉舞台的 scale 落到舞台内坐标，
     * 才和 GSAP 的 x / y、scaleX / scaleY 处在同一套单位里，然后才谈得上把它们扣掉。
     */
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
    // 被拖的这两种元素（.deck-pool-card / .deck-mini）都没改 transform-origin，缩放是绕盒子中心
    // 往四周撑开的，所以按中心反推左上角：视觉中心减掉位移就是原中心，再退回半个原尺寸。
    element.style.position = 'fixed'
    element.style.left = `${center.x - x - width / 2}px`
    element.style.top = `${center.y - y - height / 2}px`
    element.style.width = `${width}px`
    element.style.height = `${height}px`
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
   * 拖拽失败（或加入成功之后卡还留在卡池里）时把元素送回原位。
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
   * 卡池 → 牌组。落点是整个右面板。
   *
   * 加不进去的牌（牌组满了、或这张已经两份）不靠 canDrag 挡：canDrag 在 pointerdown 就返回，
   * 连"原地点一下放大看看"都会被一起挡掉。改成过了阈值再在 onDragStart 里掐掉这次拖拽——
   * 这是 hook 明确支持的用法，此时姿态和落点高亮都还没建起来，牌一动不动，而点击照常。
   */
  const poolDragRef = useRef<CardDragHandle | null>(null)
  const poolDrag = useCardDrag({
    zones: [{ ref: sideRef, id: 'deck' }],
    contextSafe,
    // 圆圈按钮另有用途（加入 / 移除），按在它上面不算抓牌。
    ignoreSelector: '.deck-circle',
    onDragStart: (drag) => {
      // 教程期间只有放行的那张拖得动；别的牌当场掐掉这次拖拽，并说明原因。
      const guide = tutorialRef.current
      if (guide !== undefined && guide.allowedCardId !== drag.id) {
        guide.onBlocked(guide.blockTip)
        poolDragRef.current?.endDrag()
        return
      }
      if (!canAddNow(drag.id)) {
        poolDragRef.current?.endDrag()
        return
      }
      // 掐掉这次拖拽的分支要先返回：那种情况下牌一动不动，不该被拎出文档流。
      liftCardOut(drag.element)
    },
    onDrop: (drag) => {
      addCard(drag.id)
      // 加入之后这张卡仍然留在卡池里（还能再加一份），所以照样要送回原位。
      returnHome(drag.element, true)
    },
    onCancel: (drag) => returnHome(drag.element, true),
    onTap: (id) => {
      /*
       * 教程模式下点一张卡池卡就是"加入牌组"，不再是放大查看（规格 §12 写的正是
       * "玩家点击指定 AI 牌后，卡牌进入牌组"）。放大查看这一步整段关掉：
       * 它会铺一层遮罩把引导层压住，而这一段教学也没有需要细看卡面的地方。
       */
      if (tutorialRef.current !== undefined) {
        addCard(id)
        return
      }
      const card = CARD_BY_ID.get(id)
      if (card !== undefined) openZoom(card, 'pool', poolFlipId(id))
    },
  })
  // onDragStart 要调 endDrag，而 handle 是本次 useCardDrag 的返回值，只能事后存进 ref 里绕开这个循环。
  poolDragRef.current = poolDrag
  attachPoolBind(poolDrag.bind)

  /**
   * 牌组 → 拖出面板 = 移除。
   *
   * onDragStart 里要调 endDrag（教程期间不让拖），handle 又是本次 useCardDrag 的返回值，
   * 只能事后存进 ref 里绕开这个循环——同上面卡池那侧的 poolDragRef。
   *
   * 靠 zones 的顺序做"面板外面才算数"：面板排在前面且 accepts: false，整页容器排在后面且接受，
   * 于是"压在面板上松手 = 取消（回弹）"、"面板外松手 = 移除"。
   * 面板那块用的是内层 .deck-side__inner 而不是 .deck-side 本身：外层是卡池那个 hook 的落点，
   * 两个 hook 都会往落点元素上打 data-drop-hot，共用一个节点的话 CSS 就分不出
   * "拖进来要加入"和"拖着自己的牌在面板里晃"这两件完全相反的事。
   */
  const deckDragRef = useRef<CardDragHandle | null>(null)
  const deckDrag = useCardDrag({
    zones: [
      { ref: sideInnerRef, accepts: false },
      { ref: pageRef, id: 'out' },
    ],
    contextSafe,
    ignoreSelector: '.deck-circle',
    // 格子区自己滚（见 .deck-slots），拖出去的牌不切成 fixed 就会被裁在格子区里。
    onDragStart: (drag) => {
      // 教程期间牌组里的牌一张都不许动，拖也不行：当场掐掉，别让牌跟着指针跑一段再弹回去。
      if (blockedByTutorial()) {
        deckDragRef.current?.endDrag()
        return
      }
      liftCardOut(drag.element)
    },
    // 落点成立 = 移除，这一份牌下一拍就从 DOM 上摘走了，不用再管它切回文档流。
    onDrop: (drag) => removeEntry(drag.id),
    onCancel: (drag) => returnHome(drag.element, true),
    onTap: (entryKey) => {
      // 同卡池那边：教程期间不开放大查看，点一下只会得到一句"这一步别动牌组"。
      if (blockedByTutorial()) return
      const card = cardOfEntry(entryKey)
      if (card !== undefined) openZoom(card, 'deck', deckFlipId(entryKey))
    },
  })
  deckDragRef.current = deckDrag
  attachDeckBind(deckDrag.bind)

  // ---------- 牌组管理条 ----------

  const [menuOpen, setMenuOpen] = useState(false)
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

  /** 两块浮层（下拉、删除确认）任意时刻最多开一块，切页面状态前统一收掉。 */
  const closePopovers = useCallback(() => {
    setMenuOpen(false)
    setDeleting(false)
  }, [])

  // 展开时点外面收起。用 pointerdown 而不是 click：抓卡池的牌是 pointerdown 起手，
  // 等到 click 才收的话，拖拽全程浮层都还开着。
  useEffect(() => {
    if (!menuOpen && !deleting) return
    const onPointerDown = (event: PointerEvent) => {
      const bar = manageRef.current
      if (bar !== null && event.target instanceof Node && bar.contains(event.target)) return
      setMenuOpen(false)
      setDeleting(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen, deleting])

  const selectDeck = (id: string) => {
    closePopovers()
    if (id === savedRef.current.currentId) return
    closeZoom()
    openDeck(setCurrentDeck(id))
  }

  const createNewDeck = () => {
    closePopovers()
    if (blockedByTutorial()) return
    const next = createDeck()
    // 已经 12 套。按钮此时本来就是禁用的，这里只是不让 null 往下走。
    if (next === null) return
    closeZoom()
    openDeck(next)
  }

  const confirmDelete = () => {
    closePopovers()
    closeZoom()
    // 删掉当前牌组后 store 会自己挑一套新的当前（删到一套不剩时补一套空的），跟着它走就行。
    openDeck(deleteDeck(savedRef.current.currentId))
  }

  const startRename = () => {
    closePopovers()
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

  // 只按种类筛。以前还有一排阵营药丸，那是 demo 卡自带的分组维度，core 的卡池没有阵营。
  const kindFilter: KindTabId = KIND_TABS[kindTab]?.id ?? 'all'
  const shown = useMemo(
    () =>
      kindFilter === 'all'
        ? pool
        : pool.filter((cardId) => CARD_BY_ID.get(cardId)?.kind === kindFilter),
    [pool, kindFilter],
  )

  const shortfall = DECK_SIZE - deck.length
  const percent = Math.round((deck.length / DECK_SIZE) * 100)

  return (
    // 纸面（底色 + 两层纸纹 + 暗角）铺在最外层，16:9 舞台之外的留边也就是同一张纸，
    // 接缝看不出来；舞台只负责把版面锁进设计稿的比例里（见 deck.css 的 .deck-frame）。
    //
    // pageRef（既是 useGSAP 的 scope，也是「把牌拖出面板 = 移除」那块落点）挂在最外层
    // 而不是舞台上：挂舞台上的话，往右一甩正好落进右边那条留边，判不出落点、牌会飞回去。
    <div className="deck-frame paper-page grain" ref={pageRef}>
      {/* 全页共用的 SVG 定义，各挂一次：少了 <use> 找不到 symbol、CSS 里的 url(#…) 找不到滤镜。
          两者都是 0 尺寸，不占布局。 */}
      <HandDrawnFilterDefs />
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
                </div>

                <div className="deck-grid" ref={gridRef}>
                  {shown.map((cardId) => {
                    const thumb = THUMB_CARD_BY_ID.get(cardId)
                    if (thumb === undefined) return null
                    const flipId = poolFlipId(cardId)
                    const picked = copies.get(cardId) ?? 0
                    return (
                      <PoolCard
                        key={cardId}
                        card={thumb}
                        picked={picked}
                        canAdd={!deckFull && picked < MAX_COPIES}
                        bind={bindPoolCard(cardId)}
                        onAdd={addCard}
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
                      ? `牌组已满 ${DECK_SIZE} 张 · 点击放大，先移除才能再加`
                      : '点击放大 · 圆圈或拖拽加入'}
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
                            <button
                              type="button"
                              className="deck-manage__btn"
                              aria-expanded={menuOpen}
                              onClick={() => {
                                if (blockedByTutorial()) return
                                setDeleting(false)
                                setMenuOpen((open) => !open)
                              }}
                            >
                              切换
                            </button>
                            <button type="button" className="deck-manage__btn" onClick={startRename}>
                              改名
                            </button>
                            <button
                              type="button"
                              className="deck-manage__btn"
                              onClick={() => {
                                if (blockedByTutorial()) return
                                setMenuOpen(false)
                                setDeleting((open) => !open)
                              }}
                            >
                              删除
                            </button>
                            <button
                              type="button"
                              className="deck-manage__btn"
                              disabled={decksFull}
                              onClick={createNewDeck}
                            >
                              新建
                            </button>
                          </div>
                        </div>

                        {/* 下拉和删除确认都绝对定位，不占文档流：整页锁在一屏内，
                            管理条一旦能撑高，右面板就会顶出屏幕底部。 */}
                        {menuOpen ? (
                          <div className="deck-manage__menu">
                            <ul className="deck-manage__list">
                              {saved.decks.map((item) => (
                                <li key={item.id}>
                                  <button
                                    type="button"
                                    className="deck-manage__item"
                                    data-current={item.id === saved.currentId}
                                    onClick={() => selectDeck(item.id)}
                                  >
                                    <span className="deck-manage__item-name">{item.name}</span>
                                    <span className="deck-manage__item-count">
                                      {item.cards.length}/{DECK_SIZE}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                            <button
                              type="button"
                              className="deck-manage__new"
                              disabled={decksFull}
                              onClick={createNewDeck}
                            >
                              {decksFull ? `最多 ${MAX_DECKS} 套牌组` : '＋ 新建牌组'}
                            </button>
                          </div>
                        ) : null}

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
                            const entry = deck[index]
                            if (entry === undefined) return <EmptyDeckSlot key={`empty-${index}`} />
                            const card = THUMB_CARD_BY_ID.get(entry.cardId)
                            if (card === undefined) return null
                            return (
                              <DeckSlotItem
                                key={entry.key}
                                card={card}
                                entryKey={entry.key}
                                bind={bindDeckCard(entry.key)}
                                onRemove={removeEntry}
                                hidden={zoomed?.flipId === deckFlipId(entry.key)}
                              />
                            )
                          })}
                        </ul>
                      </div>

                      <div className="deck-side__foot">
                        <div className="deck-side__notes">
                          {/* 文案照实写：这一页是"点一下放大"，移除走圆圈或者把牌拖出面板，
                              没有悬停放大这回事。 */}
                          <p className="deck-side__hint">
                            {tutorial === undefined
                              ? '点击放大 · 圆圈或拖出移除'
                              : '教学阶段：牌组里的牌暂时不能改动'}
                          </p>
                          {shortfall > 0 ? (
                            <p className="deck-shortfall">还需选择 {shortfall} 张</p>
                          ) : (
                            <p className="deck-done">牌组已满 · 可以出发</p>
                          )}
                        </div>
                        {/* 存档是实时写的，这里不用"保存"，只负责满 DECK_SIZE 张之后把牌组交出去。
                            教程模式下还要等引导走到最后一步才解锁（规格 §12：加满 20 张，按钮才亮）。 */}
                        <PlaqueButton
                          className="deck-confirm"
                          data-tutorial-anchor="deckConfirm"
                          disabled={shortfall > 0 || (tutorial !== undefined && !tutorial.allowConfirm)}
                          onClick={() => onConfirm(deck.map((entry) => entry.cardId))}
                        >
                          确认牌组
                        </PlaqueButton>
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
                if (zoomed !== null) {
                  liftCardForFlight(zoomed.side, zoomed.flipId)
                  if (zoomed.side === 'deck') liftSideForFlight()
                }
                setZoomed(null)
              }}
              closeOnEscape
            />
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
 * onAdd 是 useCallback，hidden 用布尔值而不是现拼的 style 对象。
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
  bind: CardDragBindings
  onAdd: (cardId: CardId) => void
  /** 这张卡正被放大，原位要就地藏起来。 */
  hidden: boolean
}

const PoolCard = memo(function PoolCard({
  card,
  picked,
  canAdd,
  bind,
  onAdd,
  hidden,
}: PoolCardProps) {
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
        style={hidden ? HIDDEN_IN_PLACE : undefined}
        {...bind}
      >
        <HandCardFace card={card} />
        {/* hover 高亮预先画好，只切 opacity（合成器就能做完，不重画卡面）。
            排在卡面之后、按钮之前：卡面不透明会盖住它，而按钮和圆章不该被它罩上一层白。 */}
        <i className="deck-pool-card__glow" aria-hidden="true" />
        <button
          type="button"
          className="deck-circle deck-circle--add"
          disabled={!canAdd}
          aria-label={`把「${card.name}」加入牌组`}
          onClick={() => onAdd(card.id)}
        >
          <CircleGlyph kind="add" />
        </button>
        {picked > 0 ? (
          <span className="deck-pool-card__seal" aria-hidden="true">
            {picked >= MAX_COPIES ? '×2' : '✓'}
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
  hidden: boolean
}

const DeckSlotItem = memo(function DeckSlotItem({
  card,
  entryKey,
  bind,
  onRemove,
  hidden,
}: DeckSlotItemProps) {
  return (
    <li className="deck-slot">
      <div
        className="deck-mini"
        data-flip-id={deckFlipId(entryKey)}
        style={hidden ? HIDDEN_IN_PLACE : undefined}
        {...bind}
      >
        {/* 缩放写在内层：外层要留给 hook 和归位补间写 transform，
            两边写同一个属性会互相抹掉（GSAP 是内联 transform，压得死 CSS 那份）。 */}
        <div className="deck-mini__card">
          <HandCardFace card={card} />
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
          <CircleGlyph kind="remove" />
        </button>
      </div>
    </li>
  )
})

/** 空格子。没有 props，memo 之后整页只会渲染这一份输出。 */
const EmptyDeckSlot = memo(function EmptyDeckSlot() {
  return (
    <li className="deck-slot">
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
 * 卡角上那个圆圈图标（加入 ＋ / 移除 ×）。
 *
 * 用内联 SVG 而不是文字符号：这一页所有线条都挂着手绘抖动滤镜，圆圈得跟着一起歪，
 * 字符画的圆是字体轮廓，滤镜作用在它上面会糊成一团。
 */
function CircleGlyph({ kind }: { kind: 'add' | 'remove' }) {
  return (
    <svg className="deck-circle__ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9.4" />
      {kind === 'add' ? (
        <path d="M12 7.2 L12 16.8 M7.2 12 L16.8 12" />
      ) : (
        <path d="M8.4 8.4 L15.6 15.6 M15.6 8.4 L8.4 15.6" />
      )}
    </svg>
  )
}
