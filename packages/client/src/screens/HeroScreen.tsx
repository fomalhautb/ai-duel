/**
 * 选择英雄页（/hero）。
 *
 * 受控组件：选中谁的初值来自 props.initialHeroId，确认后把英雄交回 props.onConfirm，
 * 返回走 props.onBack。这一页自己不导航、不写存档、不碰 MatchSession——
 * 选完之后去哪、存不存，全由调用方决定。
 * 七位英雄的数据直接读 core 的 HEROES 表，页面不再自带一份。
 *
 * 界面照着一张 1920×1080 的设计稿复原：hover 上浮 / 倾斜、点开看技能详情都做全了。
 *
 * 技能还没实装的几位（core 的 HeroCard.comingSoon）在卡阵上是置灰 + 常驻「即将加入」的：
 * 点不开详情、也选不中，指针交互整套都不挂。她们仍然照原位渲染成一张 .hero__card——
 * 入场动画和 hover 绑定是按 DOM 下标去对 HERO_LIST 的（见下面 cards.forEach），
 * 少渲染一张就会让后面所有卡对错人。
 *
 * 做法和首页同源（见 HomeScreen.tsx 文件头）：一个 1672:941 的固定宽高比舞台塞进视口居中，
 * 舞台内所有尺寸写成 cqi（1cqi = 舞台宽的 1%），窗口怎么变都只是整体等比缩放，不写断点。
 * 根节点带 .grain（定义在 src/ui/paper/paper.css）把舞台之外的留边铺成纸；
 * 和首页不同的是这里加了 .on-dark：留边是近黑的深蓝（跟着背景图边缘色走），
 * 纸纹在深色上要换成「反相 + screen」那一档，否则会糊出一块块黑斑。
 *
 * 舞台内的层叠自下而上：背景图 → 返回 / 标题 / 副标题 → 两排卡牌 → 技能详情层。
 * 顺序基本由 JSX 的先后决定；只有技能详情那一层用了 z-index 把自己抬到卡牌之上
 * （它内部的遮罩和内容也各写了一档，见 hero.css）。舞台自己那个 z-index 是用来压住
 * 外层纸纹的，和内部层叠无关。
 *
 * 素材：public/hero/ 下背景 3344×1882（设计稿的 2x），七张人物卡 768×1152（2:3）。
 * 卡面自带装饰边框和名字牌，所以卡阵上只额外叠了 hover 时那条「点击查看技能」，
 * 名字一律读卡面自己的（详情面板里那行标题是另一回事，见下面 HERO_LIST）。
 * 原图在仓库 assets/人物卡简介/*.png（1024×1536），要更清晰可以从那儿按更大尺寸重导，
 * 同名覆盖即可，代码一行不用改——卡片是 width/height: 100% 铺满卡槽的。
 */

import { useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { HEROES } from '@ai-duel/core'
import type { HeroId } from '@ai-duel/core'
import { BackButton } from '../ui/BackButton'
import { LoadingScreen } from '../ui/LoadingScreen'
import { PlaqueButton } from '../ui/PlaqueButton'
import { HandDrawnFilterDefs } from '../ui/HandDrawnFilterDefs'
import { useAssetsReady } from '../ui/preloadAssets'
import { attachCardTilt } from '../ui/cardTilt'
import type { CardTiltHandle } from '../ui/cardTilt'
import {
  fadeVeilIn,
  fadeVeilOut,
  ZOOM_FLIGHT_Z,
  ZOOM_IN_DUR,
  ZOOM_IN_EASE,
  ZOOM_OUT_DUR,
  ZOOM_OUT_EASE,
} from '../ui/CardZoomOverlay'
import { prefersReducedMotion } from '../ui/reducedMotion'
import './hero.css'

gsap.registerPlugin(useGSAP, Flip)

/**
 * 页面上的七位英雄，直接摊平 core 的英雄表。
 *
 * 不在这儿排序：HEROES 的键序就是设计稿上从左到右、从上到下的摆放顺序（core 那边有约定），
 * 要调排布去改 core 表。
 *
 * 卡阵上不显示 name / enName——那里的名字是画在卡面图里的；它们只出现在技能详情面板
 * （.hero__detail-name / .hero__detail-en）和无障碍文案（按钮 aria-label、图片 alt）里。
 * 所以改这两个字段等于改详情面板的排版：.hero__detail-info 宽度钉死 30cqi，
 * 名字太长不会把面板撑开，而是换行把底下的分隔线和技能整体往下顶。
 */
const HERO_LIST = Object.values(HEROES)

/** 第一排 4 张、第二排 3 张，切分点写成常量免得两处魔数对不上。 */
const FIRST_ROW_COUNT = 4

/** 切好的两排。切分和渲染无关，放模块级，免得每次重画都重切一遍。 */
const HERO_ROWS = [HERO_LIST.slice(0, FIRST_ROW_COUNT), HERO_LIST.slice(FIRST_ROW_COUNT)]

/**
 * 没有预填英雄时的兜底：排在最前面的那位**可选**英雄。
 *
 * 不能直接取 HERO_LIST[0]——第一位现在正好是 comingSoon 的李飞飞，点都点不开，
 * 拿她兜底等于让「确认英雄」交出一位玩家根本选不了的人。
 * 选中在页面上没有任何标记（金框和光环都撤了），这份默认值只是给「确认英雄」兜个底。
 * `!` 是给 noUncheckedIndexedAccess 让路——七位里至少有一位已实装（引擎的默认英雄就在其中）。
 */
const DEFAULT_HERO_ID: HeroId = HERO_LIST.find((hero) => !hero.comingSoon)!.id

/**
 * 这一页要用到的全部图片：背景 + 七张人物卡。加载完之前不上场（见下面的 HeroScreen）。
 *
 * 必须是模块级常量：useAssetsReady 拿它当 effect 依赖，每次渲染现拼一个新数组会让 effect 反复重跑。
 * 没往 index.html 的 preload 清单里加——那份清单只服务首页的关键路径，
 * 多写一条就是每个玩家进首页都白下一张用不上的图。
 *
 * 导出是给 ui/backgroundPreload.ts 用的：后台预加载要照着同一份清单排队，
 * 两边各写一遍迟早会对不上。
 */
export const HERO_ASSETS = [
  '/hero/hero-bg.webp',
  ...HERO_LIST.map((hero) => `/hero/card-${hero.id}.webp`),
]

/** hover 时卡牌上浮的距离，写成卡自身高度的百分比——GSAP 的 y 不认 cqi，用百分比才和缩放无关。 */
const CARD_HOVER_LIFT = -2
const CARD_HOVER_SCALE = 1.035
/** 上浮和落回同一个时长，来回扫动时不会一边快一边慢。 */
const CARD_HOVER_DUR = 0.25
/**
 * 卡面跟着指针倾斜的最大角度。
 * 比首页展示卡（6°）大一档：这一页的卡更大、又是正对着看的，6° 几乎看不出来。
 */
const CARD_TILT_DEG = 8

interface HeroScreenProps {
  /** 预填的英雄；null 表示默认选中第一位。只在挂载时读一次，之后以玩家在页面上的选择为准。 */
  initialHeroId: HeroId | null
  /**
   * 详情飞回卡槽的动画播完才回调——跳转要是抢在动画前面，这段飞行等于白做。
   * 不传就不渲染详情里的「确认英雄」：大厅横幅进来的是纯查看，选谁都不会被记下。
   */
  onConfirm?: (hero: HeroId) => void
  /** 不传就不渲染返回按钮（比如从没有上一步的入口进来）。 */
  onBack?: () => void
}

/**
 * 加载闸门。
 *
 * 图没齐就只显示加载动画，不显示半张画面。做成两个组件而不是在一个组件里写条件渲染，
 * 是因为下面 HeroStage 的 GSAP 绑定只在挂载时跑一次，必须等真实 DOM 就位再挂；
 * 同一个组件里「先渲染 loader 再切成正页」的话，入场动画会在没有 DOM 的第一帧就跑掉，
 * 之后不会再补跑。理由和 HomeScreen 那道闸门完全一样。
 */
export function HeroScreen(props: HeroScreenProps) {
  const ready = useAssetsReady(HERO_ASSETS)
  return ready ? <HeroStage {...props} /> : <LoadingScreen />
}

function HeroStage({ initialHeroId, onConfirm, onBack }: HeroScreenProps) {
  /*
   * 预填的英雄要是 comingSoon 就当没预填。存档那一层已经把她们滤成 null 了（见 save/save.ts），
   * 这里再挡一道是因为 initialHeroId 是外面传进来的，将来多一个不走存档的调用方也不会漏。
   */
  const [selectedId, setSelectedId] = useState<HeroId>(
    initialHeroId !== null && !HEROES[initialHeroId].comingSoon ? initialHeroId : DEFAULT_HERO_ID,
  )
  const rootRef = useRef<HTMLDivElement>(null)
  /**
   * 每张卡的按钮节点。两处要用：详情飞回时拿它当落点，关闭详情后把焦点还给它。
   * 存 ref 不存 state：它只被事件回调和 effect 读，进 state 只会白白多几次重渲染。
   */
  const cardsRef = useRef(new Map<HeroId, HTMLButtonElement>())
  /** 正在看技能的那位英雄；null = 详情没开。 */
  const [detailId, setDetailId] = useState<HeroId | null>(null)
  /** 每张卡的倾斜句柄。打开详情前要先收手，否则 Flip 量到的是一张斜着的卡的外接矩形。 */
  const tiltsRef = useRef(new Map<HeroId, CardTiltHandle>())
  const veilRef = useRef<HTMLDivElement>(null)
  const detailCardRef = useRef<HTMLDivElement>(null)
  /** 详情里那张大卡的倾斜句柄。关详情时要手动摘掉，见下面挂它的那个 effect。 */
  const detailTiltRef = useRef<CardTiltHandle | null>(null)
  /** 详情里那颗「返回」。详情一打开就把焦点挪到它上面，键盘用户不至于卡在遮罩后面。 */
  const detailBackRef = useRef<HTMLButtonElement>(null)
  /** 详情关掉之后要把焦点还给哪张卡。null = 不用还（比如根本没开过）。 */
  const restoreFocusRef = useRef<HeroId | null>(null)
  /** 待播的「飞进详情」，记的是卡槽里那张卡起飞前的位置。 */
  const flipInRef = useRef<Flip.FlipState | null>(null)
  /** 待播的「飞回卡槽」，记的是详情大卡关闭前的位置。 */
  const flipBackRef = useRef<Flip.FlipState | null>(null)
  /**
   * 详情里正在展示的英雄。
   * 飞回那一程跑的时候 detailId 已经被清空了，落点是哪张卡只能靠这一份同步副本去找。
   */
  const detailHeroRef = useRef<HeroId | null>(null)
  /**
   * 按下「确认英雄」之后、等飞回动画播完要交出去的那位；null = 这次关详情不是确认（返回 / ESC）。
   *
   * 把英雄记在这里而不是等回调时现读 selectedId：飞回那 0.6 秒里背景已经不 inert 了，
   * 玩家能再点开另一张卡把选中改掉，那时交出去的就不是他刚确认的那位。
   * 顺带当"确认已经受理"的锁用，挡住连点。存 ref 不存 state：改它不需要重画界面。
   */
  const pendingConfirmRef = useRef<HeroId | null>(null)

  const { contextSafe } = useGSAP(
    () => {
      const root = rootRef.current
      if (root === null) return
      const cards = Array.from(root.querySelectorAll<HTMLElement>('.hero__card'))
      const lifts = cards.map((card) => card.querySelector<HTMLElement>('.hero__card-lift'))
      const unbinds: Array<() => void> = []

      /*
       * 入场。全部用 from/fromTo 而不是在 CSS 里预设 opacity: 0：
       * 闸门保证挂载时图已经齐了，这段 JS 一挂就跑，中间不会露出「什么都没有」的一帧；
       * 反过来把初始态写进 CSS，一旦 GSAP 出问题页面就永远空着。
       *
       * 卡牌的顺序就是 DOM 顺序，也就是「第一排从左到右、再第二排从左到右」，
       * 视线跟着走一遍正好扫完全场。整段压在 1s 以内：这是每次进页面都要看一遍的动画。
       *
       * 开了减少动效就整段不建：from 的终点本来就是元素的自然状态，跳过它页面直接是排好的样子，
       * 加上 .hero 那段淡入接着，不会闪也不会空。
       */
      if (!prefersReducedMotion()) {
        const intro = gsap.timeline({ defaults: { ease: 'power3.out' } })
        intro
          .from(
            ['.hero__back', '.hero__title', '.hero__subtitle'],
            { opacity: 0, yPercent: -30, duration: 0.5, stagger: 0.08 },
            0,
          )
          .from(
            lifts.filter((lift): lift is HTMLElement => lift !== null),
            { opacity: 0, yPercent: 3, scale: 0.96, duration: 0.55, stagger: 0.05 },
            0.1,
          )
      }

      cards.forEach((card, index) => {
        const lift = lifts[index]
        // 卡片是照 HERO_ROWS 铺的，DOM 顺序和 HERO_LIST 一一对应，所以按下标取得到同一位。
        const hero = HERO_LIST[index]
        if (lift === undefined || lift === null || hero === undefined) return

        /*
         * 技能没实装的那几位：一套指针交互都不挂——不跟指针倾斜、hover 也不上浮。
         * 卡面本来就灰着、还压着一条「即将加入」（见 hero.css），再动起来就成了"看着能点"。
         *
         * 只跳过绑定，不把她们从 cards 里剔出去：上面那段入场动画和这里的下标都靠
         * 「DOM 顺序 == HERO_LIST 顺序」，剔一张后面全部对错人。
         */
        if (hero.comingSoon === true) return

        // 倾斜写在最里面那层（.hero__card-tilt）：上浮 / pop 归下面几条补间写在 lift 上，
        // 一层 transform 只许一个人写，理由见 ui/cardTilt.ts 开头。
        const tilt = attachCardTilt(card, { tiltLayer: '.hero__card-tilt', maxTilt: CARD_TILT_DEG })
        tiltsRef.current.set(hero.id, tilt)
        unbinds.push(() => {
          tiltsRef.current.delete(hero.id)
          tilt.detach()
        })

        const enter = (event: PointerEvent) => {
          // 触屏上 pointerenter 也会触发，而手指抬起后不会有 pointerleave，卡就一直吊在上面。
          // 悬停本来就是鼠标才有的语义，非鼠标直接不进入这套状态。
          if (event.pointerType !== 'mouse') return
          gsap.to(lift, {
            yPercent: CARD_HOVER_LIFT,
            scale: CARD_HOVER_SCALE,
            // 减少动效时不取消上浮，只把它压成瞬时——和 hero.css 里把过渡压成 1ms 是同一个处理。
            duration: prefersReducedMotion() ? 0 : CARD_HOVER_DUR,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        }
        const leave = (event: PointerEvent) => {
          if (event.pointerType !== 'mouse') return
          gsap.to(lift, {
            yPercent: 0,
            scale: 1,
            duration: prefersReducedMotion() ? 0 : CARD_HOVER_DUR,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        }

        card.addEventListener('pointerenter', enter)
        card.addEventListener('pointerleave', leave)
        unbinds.push(() => {
          card.removeEventListener('pointerenter', enter)
          card.removeEventListener('pointerleave', leave)
        })
      })

      return () => {
        for (const unbind of unbinds) unbind()
      }
    },
    { scope: rootRef },
  )

  /*
   * 记下选了谁。
   *
   * 这里**不**播任何「被点到」的动画：点击同一拍就会给卡挂上 is-zoomed
   * （.hero__card.is-zoomed .hero__card-lift 是 visibility: hidden，见 hero.css），
   * 而 GSAP 的补间要等下一帧才写第一个值——补间从头到尾跑在一个已经看不见的元素上。
   * 点击的反馈全部交给紧接着那段飞进详情的动画。
   *
   * 选中本身在页面上没有任何标记，它只是「确认英雄」将来要带走的那个值。
   */
  const selectHero = (hero: HeroId) => {
    setSelectedId(hero)
  }

  /*
   * 点一张卡：记下选的是谁，再把技能详情打开。
   *
   * 顺序很关键——Flip.getState 必须在 React 把卡槽那张卡藏起来**之前**同步量好，
   * 那一刻量到的才是真正的起飞位置（.hero__card.is-zoomed 会在下一次提交里把它藏掉）。
   * 量之前还要先让倾斜收手并当场归零：卡歪着时 getBoundingClientRect 给的是外接矩形，
   * 拿它当起点会让飞行头一帧突然缩一下。
   */
  const openHero = contextSafe((hero: HeroId, card: HTMLButtonElement) => {
    selectHero(hero)
    // 上一次飞回如果被打断（补间没跑完 onComplete 就不会来），那次抬高的层级会一直留在卡上。
    // 每次打开先抹掉，卡就不会莫名其妙地压在别的东西上面。
    card.style.zIndex = ''
    const tiltLayer = card.querySelector<HTMLElement>('.hero__card-tilt')
    if (tiltLayer === null) return
    tiltsRef.current.get(hero)?.reset()
    gsap.set(tiltLayer, { rotationX: 0, rotationY: 0 })
    flipInRef.current = Flip.getState(tiltLayer)
    detailHeroRef.current = hero
    setDetailId(hero)
  })

  /** 关详情。同样得趁大卡还在屏幕上，先量下它此刻的位置当飞回的起点。 */
  const closeDetail = contextSafe(() => {
    if (detailId === null) return
    const card = detailCardRef.current
    if (card !== null) flipBackRef.current = Flip.getState(card)
    // 焦点这时还在详情里那两颗按钮上，而它们马上就要被卸载——不还回去的话焦点会掉回 body，
    // 键盘用户得从页面开头重新 Tab 一遍。detailHeroRef 不能用：飞回那段动画会把它清掉。
    restoreFocusRef.current = detailId
    setDetailId(null)
  })

  /** ESC 的监听里要调最新的那份 closeDetail，但它每次渲染都是新函数，进依赖会让监听反复重挂。 */
  const closeDetailRef = useRef(closeDetail)
  closeDetailRef.current = closeDetail

  /*
   * 确认。先记下要交出去的是谁，再走和「返回」一样的关闭流程；
   * onConfirm 排在飞回卡槽那段动画的 onComplete 里（见下面那个 useGSAP），
   * 调用方多半会把整页换掉，跳转抢在动画前面就等于没播。
   *
   * 选中谁在打开详情那一刻就记进 selectedId 了，所以这里的 selectedId 一定是屏幕中央那位。
   */
  const handleConfirm = () => {
    if (detailId === null || pendingConfirmRef.current !== null) return
    pendingConfirmRef.current = selectedId
    closeDetail()
  }

  /*
   * 详情的进 / 出。两个分支各管一程：detailId 从空变成有人时飞进屏幕中央，
   * 从有人变回空时飞回卡槽。做法和 ui/CardZoomOverlay 那条链路一致，
   * 只是这一页展示的内容（大卡 + 技能面板）是自己的，没法直接复用那个组件。
   *
   * 遮罩也归这里开关：.hero__detail-veil 平时是 opacity: 0 + visibility: hidden，
   * 全靠 fadeVeilIn / fadeVeilOut 的 autoAlpha 推起来（挂在 React 状态上的话，
   * 详情一关元素就没了，那 0.3s 的淡出根本演不出来）。
   */
  useGSAP(
    () => {
      /**
       * 这次关详情是「确认」的话，把英雄交给调用方。
       *
       * 详情关掉之后的每一条出口都得走一遍：飞回没播成时动画的 onComplete 不会来，
       * 漏掉这一步玩家就卡在选人页，确认按钮还点不动（pendingConfirmRef 一直锁着）。
       */
      const finishConfirm = () => {
        const confirmed = pendingConfirmRef.current
        if (confirmed === null) return
        pendingConfirmRef.current = null
        onConfirm?.(confirmed)
      }

      const veil = veilRef.current
      if (veil === null) {
        if (detailId === null) finishConfirm()
        return
      }
      // 减少动效时把飞行压成瞬时，但不取消：取消了卡会凭空出现在屏幕中央，反而更难跟上。
      const reduced = prefersReducedMotion()

      const pending = flipInRef.current
      if (pending !== null && detailId !== null) {
        flipInRef.current = null
        const card = detailCardRef.current
        if (card === null) return
        fadeVeilIn(veil)
        // scale 而不是 width / height：卡里的画一起放大，看着才像同一张卡在变大。
        Flip.from(pending, {
          targets: card,
          duration: reduced ? 0 : ZOOM_IN_DUR,
          ease: ZOOM_IN_EASE,
          scale: true,
        })
        return
      }

      const back = flipBackRef.current
      if (back === null || detailId !== null) {
        if (detailId === null) finishConfirm()
        return
      }
      flipBackRef.current = null
      const hero = detailHeroRef.current
      detailHeroRef.current = null
      fadeVeilOut(veil)

      // 卡槽那张卡此刻已经跟着 state 恢复可见了：useGSAP 是 layout effect，
      // 恢复可见和 Flip 把它摆回起飞位置发生在同一次绘制之前，中间不会闪。
      const originCard = hero === null ? null : (cardsRef.current.get(hero) ?? null)
      const origin = originCard?.querySelector<HTMLElement>('.hero__card-tilt') ?? null
      if (originCard === null || origin === null) {
        finishConfirm()
        return
      }
      /*
       * 飞回途中要压过正在淡出的遮罩（遮罩 0.3s 淡完，而飞行有 0.6s），层级得自己给。
       *
       * 不能用 Flip 的 zIndex 选项：它把层级写在飞行目标（也就是倾斜层）上，
       * 而外面那层 .hero__card-lift 有 perspective、还常年挂着 GSAP 写的 inline transform，
       * 两者都会开一个新的层叠上下文，写在里面的 z-index 只在那一层内部排序，
       * 爬不到 z-index: 10 的详情层之上——实测卡的前半程就糊在遮罩后面。
       * 写在卡槽本体（.hero__card，position: relative 且没有自己的层叠上下文）上才管用。
       *
       * 直接改 style 不走 gsap.set：这是一次性的层级开关，不需要补间，
       * 也就不用为它在 context 里留一条零时长补间的记录。
       */
      originCard.style.zIndex = String(ZOOM_FLIGHT_Z)
      Flip.from(back, {
        targets: origin,
        duration: reduced ? 0 : ZOOM_OUT_DUR,
        ease: ZOOM_OUT_EASE,
        scale: true,
        onComplete: () => {
          originCard.style.zIndex = ''
          finishConfirm()
        },
        // 被杀掉的补间永远不会来 onComplete（overwrite、context 清理都可能杀它），
        // 而 pendingConfirmRef 锁着会让玩家永远卡在选人页——onInterrupt 把这条路也兜住。
        // finishConfirm 自带幂等（取走即清空），两个回调不会重复交付。
        onInterrupt: () => {
          originCard.style.zIndex = ''
          finishConfirm()
        },
      })
    },
    { dependencies: [detailId] },
  )

  /*
   * 放大后的大卡照样跟着指针倾斜、照样有反光——卡槽里那张有的，这里一样有。
   *
   * 单独一个 effect，不跟上面那段飞行写在一起：那段是靠 flipInRef「用一次就清空」触发的，
   * 只有真带着起飞状态的那一次才会走进分支；一旦这个 effect 因为别的原因重跑
   * （开发期的热替换、以后往依赖里再加一个值），倾斜就装不上了。这里只认 detailId。
   *
   * 摘除是自己记一个句柄手动做的，不靠回调返回 cleanup：@gsap/react 在「依赖非空」时
   * 会把清理推迟到组件卸载（它的 deferCleanup 分支），返回的 detach 在详情关掉时根本不跑，
   * 每开一次就攒下一个挂在已卸载节点上的句柄和一个没被 kill 的子 context。
   * 给它传 revertOnUpdate 也能让 cleanup 按时跑，但那等于把「什么时候摘」交给库里一个
   * 容易读错的分支；自己记一个句柄，摘除的时机在这段代码里一眼看得到。
   *
   * 倾斜写在里面的 .hero__detail-card-tilt 上，Flip 写的是外面那层，飞行途中两者不抢同一个
   * transform。不传 hoverScale：这张卡多大归 Flip 管，倾斜那边再碰一次 scale 就打架了。
   */
  useGSAP(
    () => {
      // 先把上一次的摘干净：详情关掉、或者换了一位英雄，旧句柄攥着的都是已经卸载的节点。
      detailTiltRef.current?.detach()
      detailTiltRef.current = null
      if (detailId === null) return
      const card = detailCardRef.current
      if (card === null) return
      detailTiltRef.current = attachCardTilt(card, {
        tiltLayer: '.hero__detail-card-tilt',
        maxTilt: CARD_TILT_DEG,
      })
    },
    { dependencies: [detailId] },
  )

  // 组件卸载时补最后一次摘除：上面那个 effect 只在 detailId 变化时跑，卸载时轮不到它。
  useEffect(
    () => () => {
      detailTiltRef.current?.detach()
      detailTiltRef.current = null
    },
    [],
  )

  /*
   * 焦点转移。详情在行为上是个模态框：打开时把焦点送进去，关闭时还给点开的那张卡。
   *
   * 背景那几块（返回、标题、七张卡）打开期间挂 inert，浏览器会连焦点带指针事件一起停掉，
   * 这样就不用自己写一套 focus trap——Tab 到头会走到浏览器界面，而不是溜到遮罩背后的卡上。
   */
  useEffect(() => {
    if (detailId !== null) {
      detailBackRef.current?.focus()
      return
    }
    const hero = restoreFocusRef.current
    if (hero === null) return
    restoreFocusRef.current = null
    cardsRef.current.get(hero)?.focus()
  }, [detailId])

  // ESC 关详情。只在开着的时候挂监听，免得这一页平时也拦一个全局按键。
  useEffect(() => {
    if (detailId === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetailRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [detailId])

  /** 详情要展示的那位英雄。detailId 为空时是 undefined，详情层里只留遮罩。 */
  const detailHero = detailId === null ? undefined : HEROES[detailId]

  return (
    <div className="hero grain on-dark" ref={rootRef}>
      {/* 匾额按钮的框线和文字都引用这里定义的滤镜，页面上必须渲染一份。 */}
      <HandDrawnFilterDefs />
      <div className="hero__stage">
        <img className="hero__bg" src="/hero/hero-bg.webp" alt="" draggable={false} />

        {/* 位置和配色留在 hero.css 的 .hero__back 里，箭头和文字的排版由公共组件管。
            详情打开时整片背景挂 inert：焦点和指针都停掉，等于不用手写 focus trap。
            没给 onBack 就整个不渲染（.hero__back 是绝对定位的，少了它标题也不会挪位）；
            入场动画那条选择器匹配不到元素时 GSAP 直接跳过，不用为这种情况另写一套。 */}
        {onBack === undefined ? null : (
          <BackButton className="hero__back" inert={detailId !== null} onClick={onBack} />
        )}

        <div className="hero__head" inert={detailId !== null}>
          <h1 className="hero__title">
            <span className="hero__flourish" aria-hidden="true">
              <i className="hero__flourish-line" />
              <Sparkle className="hero__flourish-star" />
            </span>
            选择你的英雄
            <span className="hero__flourish hero__flourish--right" aria-hidden="true">
              <i className="hero__flourish-line" />
              <Sparkle className="hero__flourish-star" />
            </span>
          </h1>
          <p className="hero__subtitle">选择一位英雄，开启你的对战</p>
        </div>

        {/* 第一排 4 张、第二排 3 张，两排各自居中——切法见 FIRST_ROW_COUNT。 */}
        <div className="hero__grid" inert={detailId !== null}>
          {HERO_ROWS.map((row, rowIndex) => (
            <div className="hero__row" key={rowIndex}>
              {row.map((hero) => {
                /* 技能还没实装的一位：置灰、点不动。指针交互在上面那段 useGSAP 里一并跳过。 */
                const soon = hero.comingSoon === true
                return (
                  <button
                    key={hero.id}
                    type="button"
                    className={`hero__card${soon ? ' hero__card--soon' : ''}${
                      hero.id === detailId ? ' is-zoomed' : ''
                    }`}
                    // 不写 aria-pressed：选中在页面上已经没有任何可见标记了，读屏念「已按下」
                    // 反而和眼睛看到的对不上。这颗按钮的实际行为是「打开这位英雄的技能详情」，
                    // 所以标题写成那句，再用 haspopup 说明点下去会弹出一个对话框。
                    // 置灰的那几张点下去什么都不会发生，所以 haspopup 要撤掉，
                    // 名字也换成一句把原因说清楚的——卡面上那条「即将加入」是纯视觉的。
                    aria-label={
                      soon ? `${hero.name}：技能即将加入，暂不可选` : `查看 ${hero.name} 的技能`
                    }
                    // 用 aria-disabled + data-disabled 而不是真的 disabled，同选牌页那颗加号
                    // （见 DeckScreen 的 .deck-circle--add）：真禁用的按钮连焦点都进不去，
                    // 读屏用户就只能靠 Tab 跳过一张莫名消失的卡去猜发生了什么。
                    aria-disabled={soon || undefined}
                    data-disabled={soon ? 'true' : undefined}
                    aria-haspopup={soon ? undefined : 'dialog'}
                    ref={(node) => {
                      if (node === null) cardsRef.current.delete(hero.id)
                      else cardsRef.current.set(hero.id, node)
                    }}
                    onClick={(event) => {
                      if (soon) return
                      openHero(hero.id, event.currentTarget)
                    }}
                  >
                    <span className="hero__card-lift">
                      {/* 倾斜和圆角裁剪都在这一层，高光跟着一起被裁（见 hero.css）。 */}
                      {/* data-flip-id 是 Flip 的配对键：起点（这一层）和详情里那张大卡
                          根本不是同一个节点，只有这个属性对得上，Flip 才会把两者当成
                          同一张卡来补间。缺了它 Flip.from 什么都不做，卡就是硬切过去的。 */}
                      <span className="hero__card-tilt" data-flip-id={`hero-card-${hero.id}`}>
                        <img
                          className="hero__card-img"
                          src={`/hero/card-${hero.id}.webp`}
                          alt={hero.name}
                          draggable={false}
                        />
                        {/* 跟着指针跑的那块反光，样式和手牌共用 .card-glare（styles.css）。
                            置灰的卡没挂倾斜，这一层永远是 opacity: 0，留着只是让两种卡结构一致。 */}
                        <span className="card-glare" />
                      </span>
                      {/* 提示条和「即将加入」互斥：一张卡要么点得开、要么点不开，
                          同时挂两条只会互相打架（提示条还是 hover 才出现的）。
                          标签放在灰化层之外，自己不跟着褪色——它正是用来解释褪色的。 */}
                      {soon ? (
                        <span className="hero__card-soon">即将加入</span>
                      ) : (
                        <span className="hero__card-hint">点击查看技能</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* 技能详情。遮罩是常驻节点（GSAP 用 autoAlpha 开关它），
            大卡只有开着的时候才渲染——Flip 每次都要一个新挂载的落点。 */}
        {/* 行为上就是个模态框，语义也照着写：读屏进来会念标题、并把背景当成不可达
            （背景那几块另外挂了 inert）。关着的时候整层不吃指针事件。 */}
        <div
          className="hero__detail"
          role="dialog"
          aria-modal="true"
          aria-label={detailHero === undefined ? undefined : `${detailHero.name} 的技能`}
          aria-hidden={detailId === null || undefined}
          style={detailId === null ? { pointerEvents: 'none' } : undefined}
        >
          {/* 压暗 + 模糊的遮罩。这一页自己一份，没复用对战那块 .reveal-overlay——
              背景是七张高对比的人物卡，得压得更暗、糊得更狠才读得清技能（理由见 hero.css）。 */}
          <div className="hero__detail-veil" ref={veilRef} aria-hidden="true" />
          {detailHero === undefined ? null : (
            <>
              <div className="hero__detail-body">
                <div
                  className="hero__detail-card"
                  ref={detailCardRef}
                  data-flip-id={`hero-card-${detailHero.id}`}
                >
                  {/* 结构和卡槽里那张一样：外层归 Flip 写 transform，里面这层归倾斜写，
                      高光跟着一起被圆角裁掉。 */}
                  <div className="hero__detail-card-tilt">
                    <img
                      className="hero__detail-img"
                      src={`/hero/card-${detailHero.id}.webp`}
                      alt={detailHero.name}
                      draggable={false}
                    />
                    <span className="card-glare" />
                  </div>
                </div>
                <div className="hero__detail-info">
                  <h2 className="hero__detail-name">{detailHero.name}</h2>
                  <p className="hero__detail-en">{detailHero.enName}</p>
                  <div className="hero__detail-rule" />
                  {/* 分隔线下面三块：人物简介、技能、定位。
                      core 里每位英雄只有一个技能（HeroCard 的 skillName / skillText），
                      设计稿上那两栏的第二栏就用人物简介填——总好过编一个不存在的第二技能。
                      能点开详情的都是技能已实装的英雄（comingSoon 的几位在卡阵上就点不动），
                      所以这里写的技能效果都是真会结算的。 */}
                  <div className="hero__detail-skill">
                    <h3 className="hero__detail-skill-name">人物简介</h3>
                    <p className="hero__detail-skill-text">{detailHero.text}</p>
                  </div>
                  <div className="hero__detail-skill">
                    <h3 className="hero__detail-skill-name">{detailHero.skillName}</h3>
                    <p className="hero__detail-skill-text">{detailHero.skillText}</p>
                  </div>
                  {/* 定位（这位英雄适合什么样的打法）。技能说的是「怎么结算」，这一条说的是
                      「什么时候该选他」，所以紧跟在技能后面。
                      没写 roleText 的英雄整块不渲染：留一个空标题比不显示更让人以为是加载坏了。 */}
                  {detailHero.roleText === undefined ? null : (
                    <div className="hero__detail-skill">
                      <h3 className="hero__detail-skill-name">定位</h3>
                      <p className="hero__detail-skill-text">{detailHero.roleText}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 详情只能从这两颗按钮（或 ESC）退出：点空白处会关掉，
                  就没法在大卡上随便挪指针看画，所以那条去掉了。 */}
              <div className="hero__detail-actions">
                {/* 和左上角那颗同一个公共组件（ui/BackButton），只是字号更大，
                    定位交给 .hero__detail-back。 */}
                <BackButton className="hero__detail-back" ref={detailBackRef} onClick={closeDetail} />
                {/* 和对战里「结束出牌」同一颗按钮，只是配色换成这一页的米金（见 hero.css）。 */}
                {onConfirm === undefined ? null : (
                  <PlaqueButton className="hero__confirm" onClick={handleConfirm}>
                    确认英雄
                  </PlaqueButton>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 四角星装饰。设计稿里那颗星的边是内凹的，字符 ✦ 是直边、还得指望系统装了对应字体，
 * 所以自己画一条路径更稳。这一页和首页各留一份：两页的私有零件不互相引用，
 * 谁改自己那份都不会误伤对方。
 */
function Sparkle({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path
        d="M5 0 C5.4 3.2 6.8 4.6 10 5 C6.8 5.4 5.4 6.8 5 10 C4.6 6.8 3.2 5.4 0 5 C3.2 4.6 4.6 3.2 5 0 Z"
        fill="currentColor"
      />
    </svg>
  )
}
