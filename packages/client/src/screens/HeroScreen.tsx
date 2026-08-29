/**
 * 选择英雄页（/hero）。
 *
 * 受控组件：选中谁的初值来自 props.initialHeroId，确认后把英雄交回 props.onConfirm，
 * 返回走 props.onBack。这一页自己不导航、不写存档、不碰 MatchSession——
 * 选完之后去哪、存不存，全由调用方决定。
 * 七位英雄的数据直接读 core 的 HEROES 表，页面不再自带一份。
 *
 * 界面照着一张 1920×1080 的设计稿复原：选中态、hover、确认脉冲都做全了。
 *
 * 做法和首页同源（见 HomeScreen.tsx 文件头）：一个 1672:941 的固定宽高比舞台塞进视口居中，
 * 舞台内所有尺寸写成 cqi（1cqi = 舞台宽的 1%），窗口怎么变都只是整体等比缩放，不写断点。
 * 根节点带 .grain（定义在 src/ui/paper/paper.css）把舞台之外的留边铺成纸；
 * 和首页不同的是这里加了 .on-dark：留边是近黑的深蓝（跟着背景图边缘色走），
 * 纸纹在深色上要换成「反相 + screen」那一档，否则会糊出一块块黑斑。
 *
 * 舞台内的层叠自下而上：背景图 → 返回 / 标题 / 副标题 → 两排卡牌 → 确认按钮。
 * 顺序完全由 JSX 的先后决定，舞台里没有一处 z-index（舞台自己那个是用来压住外层纸纹的，
 * 和内部层叠无关）。
 *
 * 素材：public/hero/ 下背景 3344×1882（设计稿的 2x），七张人物卡 768×1152（2:3）。
 * 卡面自带装饰边框和名字牌，所以页面上不再叠任何文字。
 * 原图在仓库 assets/人物卡简介/*.png（1024×1536），要更清晰可以从那儿按更大尺寸重导，
 * 同名覆盖即可，代码一行不用改——卡片是 width/height: 100% 铺满卡槽的。
 */

import { useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { HEROES } from '@ai-duel/core'
import type { HeroId } from '@ai-duel/core'
import { LoadingScreen } from '../ui/LoadingScreen'
import { useAssetsReady } from '../ui/preloadAssets'
import { prefersReducedMotion } from '../ui/reducedMotion'
import './hero.css'

gsap.registerPlugin(useGSAP)

/**
 * 页面上的七位英雄，直接摊平 core 的英雄表。
 *
 * 不在这儿排序：HEROES 的键序就是设计稿上从左到右、从上到下的摆放顺序（core 那边有约定），
 * 要调排布去改 core 表。名字和英文名已经画在卡面图里，页面上不显示，只拿来写 <img> 的 alt。
 */
const HERO_LIST = Object.values(HEROES)

/** 第一排 4 张、第二排 3 张，切分点写成常量免得两处魔数对不上。 */
const FIRST_ROW_COUNT = 4

/** 切好的两排。切分和渲染无关，放模块级，免得每次重画都重切一遍。 */
const HERO_ROWS = [HERO_LIST.slice(0, FIRST_ROW_COUNT), HERO_LIST.slice(FIRST_ROW_COUNT)]

/**
 * 没有预填英雄时的兜底：选中态是这一页的主要看点，不该等玩家点一下才出现。
 * `!` 是给 noUncheckedIndexedAccess 让路——表是写死的七位，第一位一定在。
 */
const DEFAULT_HERO_ID: HeroId = HERO_LIST[0]!.id

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
/** 选中 / 确认时那一下弹跳的峰值。比 hover 再大一点点，一眼看得出是「刚被选中」而不是「指针路过」。 */
const CARD_POP_SCALE = 1.08

interface HeroScreenProps {
  /** 预填的英雄；null 表示默认选中第一位。只在挂载时读一次，之后以玩家在页面上的选择为准。 */
  initialHeroId: HeroId | null
  /** 确认金光动画播完才回调——跳转要是抢在动画前面，这段光效等于白做。 */
  onConfirm: (hero: HeroId) => void
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
  const [selectedId, setSelectedId] = useState<HeroId>(initialHeroId ?? DEFAULT_HERO_ID)
  const rootRef = useRef<HTMLDivElement>(null)
  /** 每张卡的按钮节点，确认时要拿选中那张来播脉冲。存 ref 不存 state：它只被事件回调读。 */
  const cardsRef = useRef(new Map<HeroId, HTMLButtonElement>())
  /**
   * 指针当前停在哪张卡上。
   * 选中 pop 结束后卡要落回「静止大小」，而静止大小取决于指针还在不在卡上——
   * 不记这一笔的话，鼠标点完不动，卡会从 pop 缩回 1 而不是缩回 hover 的 1.035，看着像掉下去了。
   */
  const hoveredRef = useRef<HTMLElement | null>(null)
  /**
   * 确认动画正在播。挡住重复确认，也挡住中途换人（见 selectHero）——
   * 这样播光的卡和最后交出去的英雄一定是同一位。存 ref 不存 state：改它不需要重画界面。
   */
  const confirmingRef = useRef(false)

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
          // 确认按钮压到最后：卡还没摆完就先亮出「确认」，等于催玩家点一个还没看清的选择。
          // 只淡入不动 transform——按下效果是 CSS 的 :active 在写 transform，两边不能碰同一个属性。
          .from('.hero__confirm', { opacity: 0, duration: 0.4 }, 0.8)
      }

      cards.forEach((card, index) => {
        const lift = lifts[index]
        if (lift === undefined || lift === null) return

        const enter = (event: PointerEvent) => {
          // 触屏上 pointerenter 也会触发，而手指抬起后不会有 pointerleave，卡就一直吊在上面。
          // 悬停本来就是鼠标才有的语义，非鼠标直接不进入这套状态。
          if (event.pointerType !== 'mouse') return
          hoveredRef.current = card
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
          if (hoveredRef.current === card) hoveredRef.current = null
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

  /** 卡的「静止大小」：指针还压在上面就停在 hover 那一档，否则回到 1。 */
  function restScaleOf(card: HTMLElement) {
    return hoveredRef.current === card ? CARD_HOVER_SCALE : 1
  }

  /*
   * 选中。金框只切 opacity（CSS 过渡，见 hero.css），这里额外给卡本身补一下弹跳，
   * 让「换人」这件事有个落点，不然七张卡里只有一圈线在闪。
   * keyframes 的最后一帧收在 restScaleOf 上而不是写死 1，理由见 hoveredRef 的注释。
   * contextSafe 包一层：这个 tween 是在 useGSAP 回调之外创建的，包了才会被同一个 context 回收。
   */
  const selectHero = contextSafe((hero: HeroId, card: HTMLButtonElement) => {
    // 确认动画一开播就锁死选择：否则玩家还能在光效播到一半时改选，
    // 最后交出去的却是按下确认那一刻的英雄，对不上眼前发光的那张卡。
    if (confirmingRef.current || hero === selectedId) return
    setSelectedId(hero)
    const lift = card.querySelector<HTMLElement>('.hero__card-lift')
    if (lift === null) return
    gsap.to(lift, {
      keyframes: [
        { scale: CARD_POP_SCALE, duration: 0.14, ease: 'power2.out' },
        { scale: restScaleOf(card), duration: 0.26, ease: 'power2.inOut' },
      ],
      overwrite: 'auto',
    })
  })

  /*
   * 确认。先播一段金光脉冲，播完（onComplete）才把英雄交给调用方：
   * 这段光效是「就选他了」的落点，跳转抢在前面就等于没播。
   * confirmingRef 挡连点——动画有 0.78 秒，期间反复点会叠出好几段脉冲、也会多次回调。
   * 锁上之后 selectedId 不会再变（见 selectHero），所以下面闭包里直接用它就是最新值。
   */
  const handleConfirm = contextSafe(() => {
    if (confirmingRef.current) return
    const card = cardsRef.current.get(selectedId)
    if (card === undefined) return
    const lift = card.querySelector<HTMLElement>('.hero__card-lift')
    const pulse = card.querySelector<HTMLElement>('.hero__card-pulse')
    if (lift === null || pulse === null) return
    confirmingRef.current = true

    // autoAlpha 而不是 opacity：光晕平时是 visibility: hidden 的，
    // autoAlpha 会连 visibility 一起管，不用自己配一套延迟切换（见 hero.css 的说明）。
    gsap
      .timeline({
        onComplete: () => {
          // 先解锁再回调：调用方多半会把这一页整个换掉，但万一它选择留在原地，
          // 玩家还得能再点一次确认。
          confirmingRef.current = false
          onConfirm(selectedId)
        },
      })
      .to(
        lift,
        {
          keyframes: [
            { scale: CARD_POP_SCALE, duration: 0.16, ease: 'power2.out' },
            { scale: restScaleOf(card), duration: 0.34, ease: 'power2.inOut' },
          ],
          overwrite: 'auto',
        },
        0,
      )
      .fromTo(
        pulse,
        { autoAlpha: 0, scale: 0.94 },
        { autoAlpha: 1, scale: 1, duration: 0.18, ease: 'power2.out' },
        0,
      )
      // 亮到顶之后一边散开一边淡掉，像光被推出去而不是被关掉。
      .to(pulse, { autoAlpha: 0, scale: 1.14, duration: 0.6, ease: 'power2.out' }, 0.18)
  })

  return (
    <div className="hero grain on-dark" ref={rootRef}>
      <div className="hero__stage">
        <img className="hero__bg" src="/hero/hero-bg.webp" alt="" draggable={false} />

        {/* 没给 onBack 就整个不渲染。入场动画那条选择器匹配不到元素时 GSAP 直接跳过，
            不用为这种情况另写一套。 */}
        {onBack === undefined ? null : (
          <button type="button" className="hero__back" onClick={onBack}>
            <BackArrow />
            返回
          </button>
        )}

        <div className="hero__head">
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
        <div className="hero__grid">
          {HERO_ROWS.map((row, rowIndex) => (
            <div className="hero__row" key={rowIndex}>
              {row.map((hero) => (
                <button
                  key={hero.id}
                  type="button"
                  className={`hero__card${hero.id === selectedId ? ' is-selected' : ''}`}
                  // aria-pressed 而不是 aria-checked：这是一组「按下去就保持按下」的按钮，
                  // 读屏会念成「已按下 / 未按下」，正好是选中与否。
                  aria-pressed={hero.id === selectedId}
                  ref={(node) => {
                    if (node === null) cardsRef.current.delete(hero.id)
                    else cardsRef.current.set(hero.id, node)
                  }}
                  onClick={(event) => selectHero(hero.id, event.currentTarget)}
                >
                  {/* 光晕垫在卡片图底下，光只从四周漏出来；确认时才亮一下。 */}
                  <span className="hero__card-pulse" aria-hidden="true" />
                  <span className="hero__card-lift">
                    <img
                      className="hero__card-img"
                      src={`/hero/card-${hero.id}.webp`}
                      alt={hero.name}
                      draggable={false}
                    />
                    {/* 金框放在 lift 里面，跟着 hover 上浮和 pop 一起动：
                        留在外面的话卡一抬起来就会从自己的框里跑出去。 */}
                    <span className="hero__card-frame" aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <button type="button" className="hero__confirm" onClick={handleConfirm}>
          {/* 层层嵌套是为了做出设计稿那圈「描边 + 内衬线」的八边形；八边形从 edge 这层才开始，
              button 自己不裁剪，好让它的投影和焦点圈不被裁掉。理由都在 hero.css。 */}
          <span className="hero__confirm-edge">
            <span className="hero__confirm-plate">
              <span className="hero__confirm-rule">
                <span className="hero__confirm-face">
                  <Sparkle className="hero__confirm-star" />
                  <span className="hero__confirm-label">确认英雄</span>
                  <Sparkle className="hero__confirm-star" />
                </span>
              </span>
            </span>
          </span>
        </button>
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

/** 返回箭头。用画的不用「←」：这个箭头在各家字体里长短粗细差得很远，落到兜底宋体上尤其难看。 */
function BackArrow() {
  return (
    <svg
      className="hero__back-arrow"
      viewBox="0 0 23 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M22 7.5 H1.5" />
      <path d="M8 1.5 L1.5 7.5 L8 13.5" />
    </svg>
  )
}
