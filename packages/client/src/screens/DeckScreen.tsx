/**
 * /deck 组建牌组 demo 页。
 *
 * 只是一个交互演示：卡池是 deckDemoCards.ts 里那 30 张假卡（拿不到 core 的 CardId），
 * 选出来的牌组不落盘、不进对局，刷新就清空——所以整页只有 useState，没有 localStorage。
 * 目的是把"选卡"这套手势先跑通：圆圈按钮加减、卡池 ↔ 牌组拖拽、点开放大看牌面。
 *
 * 三块复用件：
 * - 卡面用对局那套 HandCardFace（150×225），牌组里的迷你卡是同一份排版整体缩小（--deck-mini-scale）；
 * - 拖拽用 ui/useCardDrag，卡池和牌组各一个实例，手感参数全走 hook 默认值，和对局手牌一致；
 * - 放大查看用 ui/CardZoomOverlay，这一页只有它一条链路会动遮罩，所以用组件自带的那块
 *   （不传 veilRef），点遮罩和 ESC 都能关。
 *
 * 视觉沿用 /design 那套纸面 token：整页是羊皮纸，左边卡池是嵌在纸上的深蓝星图面板
 * （和对局界面"纸侧栏夹着深色战场"的关系一致），右边牌组面板是纸面雕花框。
 * 桌面鼠标环境 only，不做触屏和窄屏适配，口径和对局页一致。
 */

import { useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useLocation } from 'wouter'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { CardZoomOverlay, ZOOM_OUT_DUR } from '../ui/CardZoomOverlay'
import type { CardZoomHandle, CardZoomTarget } from '../ui/CardZoomOverlay'
import { HandCardFace } from '../ui/HandFan'
import { HandDrawnFilterDefs } from '../ui/HandDrawnFilterDefs'
import { OrnateFrame } from '../ui/OrnateFrame'
import { PlaqueButton } from '../ui/PlaqueButton'
import { useCardDrag } from '../ui/useCardDrag'
import type { CardDragHandle } from '../ui/useCardDrag'
import { OrnateTitle, PaperCardBack, PaperIconDefs, PaperTabs } from '../ui/paper'
import { DECK_DEMO_CARDS, FACTIONS } from './deckDemoCards'
import type { DeckDemoCard, DeckFaction } from './deckDemoCards'
import './deck.css'

gsap.registerPlugin(useGSAP)

/** 牌组必须正好这么多张才算组好，不满不给确认。 */
const DECK_SIZE = 20
/** 同一张卡最多带几份。 */
const MAX_COPIES = 2
/** 拖拽结束后把卡送回原位的补间时长。成功和取消都走它，所以两种结果的收束速度一致。 */
const RETURN_DUR = 0.28

/** kind 页签。数组顺序就是页签从左到右的顺序。 */
const KIND_TABS = [
  { id: 'all', label: '全部' },
  { id: 'ai', label: 'AI 牌' },
  { id: 'skill', label: '技能牌' },
] as const

type KindTabId = (typeof KIND_TABS)[number]['id']

/**
 * 页签上的数字。按整个卡池实算，**不**跟着阵营筛选变：
 * 它说的是"这一类一共有多少张"，跟着筛选跳的话就没法用它判断筛掉了多少。
 */
const KIND_COUNTS: Record<KindTabId, number> = {
  all: DECK_DEMO_CARDS.length,
  ai: DECK_DEMO_CARDS.filter((card) => card.kind === 'ai').length,
  skill: DECK_DEMO_CARDS.filter((card) => card.kind === 'skill').length,
}

/** id → 卡。牌组里存的是 id，展示时要拿回整张卡的数据。 */
const CARD_BY_ID = new Map(DECK_DEMO_CARDS.map((card) => [card.id, card]))

/**
 * 牌组里的一份牌。
 *
 * 存 key 而不是直接用下标当身份：同一张卡可以带两份，而删掉中间一份会让后面所有份的下标平移，
 * React 的 key、拖拽的 id、Flip 的配对键就全跟着换了一遍，正在拖 / 正在放大的那份会被认成另一份。
 */
interface DeckEntry {
  key: string
  cardId: string
}

/** 正在放大查看的那张卡。side 决定飞回时去哪个容器里找原位元素。 */
interface ZoomState {
  card: DeckDemoCard
  flipId: string
  side: 'pool' | 'deck'
}

/** 卡池那张卡的 Flip 配对键。加前缀是因为同一张卡在牌组里还有一份，两边的键不能撞。 */
function poolFlipId(cardId: string): string {
  return `pool:${cardId}`
}

/** 牌组里那一份的 Flip 配对键。用 entry.key，所以删掉别的份不会让它换 id。 */
function deckFlipId(entryKey: string): string {
  return `deck:${entryKey}`
}

export function DeckScreen() {
  const [, navigate] = useLocation()

  const [kindTab, setKindTab] = useState(0)
  /** null = 不按阵营筛。 */
  const [faction, setFaction] = useState<DeckFaction | null>(null)
  const [deck, setDeck] = useState<DeckEntry[]>([])
  const [zoomed, setZoomed] = useState<ZoomState | null>(null)
  /** 发号器，只保证 key 不重复，数值本身没有含义。 */
  const nextKeyRef = useRef(0)

  const pageRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLElement>(null)
  const sideInnerRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef<HTMLUListElement>(null)
  const zoomRef = useRef<CardZoomHandle>(null)

  // 这一页没有挂载动画，useGSAP 在这儿只是为了拿 contextSafe：
  // 拖拽 hook 和归位补间建的 tween 都归这个 context 管，离开页面时一起 revert。
  const { contextSafe } = useGSAP(() => {}, { scope: pageRef })

  // ---------- 牌组状态 ----------

  /** 每张卡已经选了几份。一次渲染只统计一遍，卡池那 30 张各自去查表。 */
  const copies = useMemo(() => {
    const counted = new Map<string, number>()
    for (const entry of deck) counted.set(entry.cardId, (counted.get(entry.cardId) ?? 0) + 1)
    return counted
  }, [deck])

  const deckFull = deck.length >= DECK_SIZE
  const copiesOf = (cardId: string) => copies.get(cardId) ?? 0
  const canAdd = (cardId: string) => !deckFull && copiesOf(cardId) < MAX_COPIES

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

  const addCard = (cardId: string) => {
    if (!canAdd(cardId)) return
    nextKeyRef.current += 1
    const key = `pick-${nextKeyRef.current}`
    setDeck((current) => (current.length >= DECK_SIZE ? current : [...current, { key, cardId }]))
  }

  const removeEntry = (entryKey: string) => {
    setDeck((current) => current.filter((entry) => entry.key !== entryKey))
  }

  const cardOfEntry = (entryKey: string): DeckDemoCard | undefined => {
    const entry = deck.find((item) => item.key === entryKey)
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
   * .deck-side——它是 position: sticky，本身就是一个层叠上下文——所以只能连整块面板一起抬。
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

  const openZoom = (card: DeckDemoCard, side: ZoomState['side'], flipId: string) => {
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

  /** 被放大的那张要就地藏起来，否则屏幕中央和原位会同时出现两张一模一样的卡。 */
  const hideIfZoomed = (flipId: string): CSSProperties | undefined =>
    // 只能用 visibility 不能用 display：位置得留着，飞回时才有落点。
    zoomed?.flipId === flipId ? { visibility: 'hidden' } : undefined

  // ---------- 拖拽 ----------

  /**
   * 拖拽失败（或加入成功之后卡还留在卡池里）时把元素送回原位。
   *
   * hook 只负责把牌停在松手那一刻，不知道原位在哪。这一页的牌全按文档流摆位，
   * 所以"回原位"就是把 hook 写上去的那套 transform 清零。
   */
  const returnHome = contextSafe((element: HTMLElement) => {
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
      if (!canAdd(drag.id)) poolDragRef.current?.endDrag()
    },
    onDrop: (drag) => {
      addCard(drag.id)
      // 加入之后这张卡仍然留在卡池里（还能再加一份），所以照样要送回原位。
      returnHome(drag.element)
    },
    onCancel: (drag) => returnHome(drag.element),
    onTap: (id) => {
      const card = CARD_BY_ID.get(id)
      if (card !== undefined) openZoom(card, 'pool', poolFlipId(id))
    },
  })
  // onDragStart 要调 endDrag，而 handle 是本次 useCardDrag 的返回值，只能事后存进 ref 里绕开这个循环。
  poolDragRef.current = poolDrag

  /**
   * 牌组 → 拖出面板 = 移除。
   *
   * 靠 zones 的顺序做"面板外面才算数"：面板排在前面且 accepts: false，整页容器排在后面且接受，
   * 于是"压在面板上松手 = 取消（回弹）"、"面板外松手 = 移除"。
   * 面板那块用的是内层 .deck-side__inner 而不是 .deck-side 本身：外层是卡池那个 hook 的落点，
   * 两个 hook 都会往落点元素上打 data-drop-hot，共用一个节点的话 CSS 就分不出
   * "拖进来要加入"和"拖着自己的牌在面板里晃"这两件完全相反的事。
   */
  const deckDrag = useCardDrag({
    zones: [
      { ref: sideInnerRef, accepts: false },
      { ref: pageRef, id: 'out' },
    ],
    contextSafe,
    ignoreSelector: '.deck-circle',
    onDrop: (drag) => removeEntry(drag.id),
    onCancel: (drag) => returnHome(drag.element),
    onTap: (entryKey) => {
      const card = cardOfEntry(entryKey)
      if (card !== undefined) openZoom(card, 'deck', deckFlipId(entryKey))
    },
  })

  // ---------- 筛选 ----------

  const kindFilter: KindTabId = KIND_TABS[kindTab]?.id ?? 'all'
  const shown = useMemo(
    () =>
      DECK_DEMO_CARDS.filter(
        (card) =>
          (kindFilter === 'all' || card.kind === kindFilter) &&
          (faction === null || card.faction === faction),
      ),
    [kindFilter, faction],
  )

  const shortfall = DECK_SIZE - deck.length
  const percent = Math.round((deck.length / DECK_SIZE) * 100)

  return (
    <div className="deck-page paper-page grain" ref={pageRef}>
      {/* 全页共用的 SVG 定义，各挂一次：少了 <use> 找不到 symbol、CSS 里的 url(#…) 找不到滤镜。
          两者都是 0 尺寸，不占布局。 */}
      <HandDrawnFilterDefs />
      <PaperIconDefs />

      {/* .paper-page__inner 把内容抬到两层纸纹之上（纸纹是 .grain 的两个绝对定位伪元素）。 */}
      <div className="paper-page__inner">
        <header className="deck-top">
          <button type="button" className="deck-back" onClick={() => navigate('/')}>
            ← 返回
          </button>
          <h1 className="deck-top__title">组建牌组</h1>
          <p className="deck-top__sub">挑选你的 AI 与技能，准备迎战</p>
        </header>

        <main className="deck-body">
          {/* ---------- 左：卡池 ---------- */}
          <section className="deck-pool">
            <div className="deck-pool__head">
              <PaperTabs
                items={KIND_TABS.map((tab) => `${tab.label} ${KIND_COUNTS[tab.id]}`)}
                active={kindTab}
                onChange={setKindTab}
              />
              <div className="deck-factions" role="group" aria-label="按阵营筛选">
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
              </div>
            </div>

            <div className="deck-grid" ref={gridRef}>
              {shown.map((card) => {
                const picked = copiesOf(card.id)
                const flipId = poolFlipId(card.id)
                return (
                  <div
                    key={card.id}
                    className="deck-pool-card"
                    // 拖拽、Flip 起飞、藏起来，全都对着这一个元素：hook 写 transform 的是它，
                    // Flip 量的也得是它，两者错开的话飞行的起点就不是牌真正所在的位置。
                    data-flip-id={flipId}
                    data-picked={picked > 0 ? picked : undefined}
                    style={hideIfZoomed(flipId)}
                    {...poolDrag.bind(card.id)}
                  >
                    <HandCardFace card={card} />
                    <button
                      type="button"
                      className="deck-circle deck-circle--add"
                      disabled={!canAdd(card.id)}
                      aria-label={`把「${card.name}」加入牌组`}
                      onClick={() => addCard(card.id)}
                    >
                      <CircleGlyph kind="add" />
                    </button>
                    {picked > 0 ? (
                      <span className="deck-pool-card__mark" aria-hidden="true">
                        {picked >= MAX_COPIES ? '×2' : '✓'}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <p className="deck-pool__hint">
              {deckFull ? '牌组已满 20 张 · 点击放大，先移除才能再加' : '点击放大 · 圆圈或拖拽加入'}
            </p>
          </section>

          {/* ---------- 右：我的牌组 ---------- */}
          <aside className="deck-side" ref={sideRef} aria-label="我的牌组">
            <div className="deck-side__inner" ref={sideInnerRef}>
              <OrnateFrame>
                <div className="deck-side__body">
                  <OrnateTitle>我的牌组</OrnateTitle>

                  <div className="deck-tally">
                    <span className="deck-tally__count">
                      已选 <b>{deck.length}</b> / {DECK_SIZE}
                    </span>
                    <span className="deck-tally__mix">
                      AI 牌 {mix.ai} · 技能牌 {mix.skill}
                    </span>
                  </div>

                  <div className="deck-progress">
                    <div className="deck-progress__track">
                      <i className="deck-progress__fill" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="deck-progress__num">{percent}%</span>
                  </div>

                  <ul className="deck-slots" ref={slotsRef}>
                    {Array.from({ length: DECK_SIZE }, (_, index) => {
                      const entry = deck[index]
                      if (entry === undefined) {
                        return (
                          <li className="deck-slot" key={`empty-${index}`}>
                            {/* 空格用纸面组件库那个「空卡槽」形态：虚线框 + 淡罗盘。 */}
                            <PaperCardBack slot className="deck-slot__back" />
                          </li>
                        )
                      }
                      const card = CARD_BY_ID.get(entry.cardId)
                      if (card === undefined) return null
                      const flipId = deckFlipId(entry.key)
                      return (
                        <li className="deck-slot" key={entry.key}>
                          <div
                            className="deck-mini"
                            data-flip-id={flipId}
                            style={hideIfZoomed(flipId)}
                            {...deckDrag.bind(entry.key)}
                          >
                            {/* 缩放写在内层：外层要留给 hook 和归位补间写 transform，
                                两边写同一个属性会互相抹掉（GSAP 是内联 transform，压得死 CSS 那份）。 */}
                            <div className="deck-mini__card">
                              <HandCardFace card={card} />
                            </div>
                            <button
                              type="button"
                              className="deck-circle deck-circle--remove"
                              aria-label={`从牌组移除「${card.name}」`}
                              onClick={() => removeEntry(entry.key)}
                            >
                              <CircleGlyph kind="remove" />
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>

                  <div className="deck-side__foot">
                    {shortfall > 0 ? (
                      <p className="deck-shortfall">还需选择 {shortfall} 张</p>
                    ) : null}
                    {/* demo 只做视觉态：满 20 张就从禁用变成可点，但点了不做任何事。 */}
                    <PlaqueButton className="deck-confirm" disabled={shortfall > 0}>
                      确认牌组
                    </PlaqueButton>
                    <p className="deck-side__hint">点击放大 · 圆圈或拖出移除</p>
                  </div>
                </div>
              </OrnateFrame>
            </div>
          </aside>
        </main>

        {/* 无条件渲染：遮罩要常驻才演得出淡出，handle 也要一直在。
            必须挂在 .paper-page__inner 里面：这一层是 z-index: 1 的层叠上下文，遮罩留在它外面的话，
            飞回原位时写给卡池卡的 zIndex 1200 出不来，整段飞行会被正在淡出的遮罩压暗 + 模糊
            （见 CardZoomOverlay 里 ZOOM_FLIGHT_Z 的注释）。牌组侧另有一层 sticky 挡着，
            靠 liftSideForFlight 处理。 */}
        <CardZoomOverlay
          ref={zoomRef}
          target={zoomTarget}
          onClose={() => {
            if (zoomed?.side === 'deck') liftSideForFlight()
            setZoomed(null)
          }}
          closeOnEscape
        />
      </div>
    </div>
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
