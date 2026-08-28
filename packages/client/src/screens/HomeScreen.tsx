/**
 * 首页。
 *
 * 整页是照着一张 1672×941 的设计稿复原的，做法是把它当成一个固定宽高比的"舞台"塞进视口居中，
 * 舞台内所有尺寸都用 cqi（1cqi = 舞台宽的 1%）。这样窗口怎么变都只是整体等比缩放，
 * 不用为各种分辨率写断点，也不会出现"字大了图小了"的错位。
 *
 * 层叠自下而上是：夜空底 → 四张展示卡 → 人物占位方块 → 桌面弧 → 前景道具 → 文字类 UI
 * （标题、副标题、开始按钮、导航、设置、调试入口）。顺序完全由 JSX 的先后决定，没有一处 z-index。
 * 桌面弧夹在人物和道具中间，对应的是现实关系：人站在桌子后面被桌沿挡住下半身，
 * 而地球仪、望远镜这些道具又摆在桌沿上。
 * 压在卡牌上面的那三层（人物、桌面弧、道具）都是 pointer-events: none，不会挡住卡牌 hover。
 * 人物抠图还没做，先用方块占住位置，下半截被桌面弧和道具挡掉正是设计稿里的效果。
 *
 * 新手教程已经删掉还没重做，"开始游戏"目前直接进匹配房。
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useLocation } from 'wouter'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { HandCardFace } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { attachCardTilt } from '../ui/cardTilt'
import type { CardTiltHandle } from '../ui/cardTilt'
import { loadSave, resetSave } from '../save/save'

gsap.registerPlugin(useGSAP)

/** 卡面内部是写死的 150px 排版，缩放比例要按它算。必须和 styles.css 的 --card-w 一致。 */
const CARD_FACE_WIDTH = 150
/** 首页展示卡的目标宽度，单位 cqi（舞台宽的百分之几）。改它就等于改整组卡的大小。 */
const CARD_WIDTH_CQI = 11
/**
 * hover 时卡牌上浮的距离，写成卡高的百分比。
 *
 * 设计上想要的是"抬起约 1.5cqi"，但 GSAP 的 y 只认 px 和 %，不认 cqi；
 * 换算成卡自身高度的百分比（1.5 / 15.4 ≈ 9.7%）就和单位无关了，缩放到任何窗口都一样高。
 */
const CARD_LIFT_PERCENT = -9.7
/** 卡面跟着指针倾斜的最大角度。和手牌里的大卡取同一档。 */
const CARD_TILT_DEG = 10
/** hover 上浮 / 落回的时长，两边一致，来回扫动时不会一边快一边慢。 */
const CARD_HOVER_DUR = 0.28

interface Seat {
  card: HandCardData
  /** 卡牌中心在舞台里的横向位置，占舞台宽的百分比。 */
  x: number
  /** 卡牌中心在舞台里的纵向位置，占舞台高的百分比。 */
  y: number
  /** 静止时的倾角。写在卡槽上（见 styles.css），GSAP 只负责 hover 时把它转回正。 */
  rot: number
}

/**
 * 首页橱窗里的四张卡：卡面数据是纯占位（不是真卡池里的东西），
 * 位置和倾角照着设计稿量。注意两端的卡不是抬起而是**沉下去**一点（y 差约 1.6%），弧口朝上。
 */
const SEATS: Seat[] = [
  {
    x: 36.6,
    y: 49.7,
    rot: -9,
    card: {
      id: 'home-chatgpt',
      kind: 'model',
      name: 'ChatGPT',
      cost: 4,
      power: 7,
      integrity: 6,
      text: '占位描述：老成持重的通才，什么都会一点，什么都不算最强。',
      backText: '占位背面：稀有度 ★★☆ · 这里之后会放模型的六维弱点画像。',
    },
  },
  {
    x: 45.5,
    y: 48.1,
    rot: -3,
    card: {
      id: 'home-claude',
      kind: 'model',
      name: 'Claude',
      cost: 5,
      power: 6,
      integrity: 8,
      text: '占位描述：话多且讲究，越是被追问越要把话说圆。',
      backText: '占位背面：稀有度 ★★★ · 这里之后会放模型的六维弱点画像。',
    },
  },
  {
    x: 54.5,
    y: 48.1,
    rot: 3,
    card: {
      id: 'home-deepseek',
      kind: 'model',
      name: 'DeepSeek',
      cost: 3,
      power: 8,
      integrity: 5,
      text: '占位描述：算得又快又狠，可惜偶尔算错了也一样理直气壮。',
      backText: '占位背面：稀有度 ★★☆ · 这里之后会放模型的六维弱点画像。',
    },
  },
  {
    x: 63.4,
    y: 49.7,
    rot: 9,
    card: {
      id: 'home-gemini',
      kind: 'model',
      name: 'Gemini',
      cost: 4,
      power: 7,
      integrity: 7,
      text: '占位描述：看得见听得见，就是记性差了点。',
      backText: '占位背面：稀有度 ★★☆ · 这里之后会放模型的六维弱点画像。',
    },
  },
]

/**
 * 七个人物的占位方块，位置是照着设计稿目测量的（单位都是舞台宽/高的百分比）。
 *
 * 数组顺序就是叠放顺序，后面的盖住前面的，所以站在前排的人排在后面。
 * 整层压在卡牌之上：设计稿里两侧的人是挡住最外侧那两张卡的边缘的。
 * 方块下半截又会被桌面弧和前景道具盖掉，这和设计稿里人物半身埋在桌后是一致的。
 */
const CAST: Array<{ id: string; left: number; top: number; width: number; height: number }> = [
  { id: 'left-back', left: 14.5, top: 22.0, width: 13.0, height: 38.0 },
  { id: 'left-officer', left: 1.5, top: 26.0, width: 15.5, height: 62.0 },
  { id: 'left-front', left: 18.0, top: 41.0, width: 14.5, height: 44.0 },
  { id: 'right-glasses', left: 82.0, top: 21.5, width: 14.5, height: 45.0 },
  { id: 'right-laugh', left: 69.0, top: 18.5, width: 15.5, height: 57.0 },
  { id: 'right-classic', left: 64.0, top: 42.5, width: 11.0, height: 50.0 },
  { id: 'right-front', left: 76.0, top: 44.5, width: 20.0, height: 52.0 },
]

export function HomeScreen() {
  const [, navigate] = useLocation()
  // 首页现在不展示任何存档数据，留着 state 只是为了"重置存档"后触发一次重渲染。
  const [, setSave] = useState(loadSave)
  const stageRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

  // 卡面里的字号、内边距全是写死的像素，只能整张按比例缩。
  // 而 scale() 只吃无单位数字，CSS 里又没法把 cqi 换算成数字，所以这个比例只能在这儿量。
  // 用 layout effect 是为了赶在首帧绘制之前把值写进去，否则会先闪一下原始大小的卡。
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const sync = () => {
      const target = (stage.clientWidth * CARD_WIDTH_CQI) / 100
      stage.style.setProperty('--home-card-scale', String(target / CARD_FACE_WIDTH))
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useGSAP(
    () => {
      const root = cardsRef.current
      if (root === null) return
      const slots = Array.from(root.querySelectorAll<HTMLElement>('.home__card'))
      const tilts: CardTiltHandle[] = []
      const unbinds: Array<() => void> = []

      slots.forEach((slot, index) => {
        const lift = slot.querySelector<HTMLElement>('.home__card-lift')
        const seat = SEATS[index]
        if (lift === null || seat === undefined) return
        // 倾斜写在最里面那层：上浮/放大/回正归 GSAP 写在 lift 上，
        // 两者共用一个 transform 的话会互相覆盖（cardTilt.ts 开头说明了这一点）。
        tilts.push(attachCardTilt(slot, { tiltLayer: '.home__card-tilt', maxTilt: CARD_TILT_DEG }))

        // 静止的倾角在卡槽的 CSS 上，这里补的是"相对卡槽再转多少"：
        // 转 -rot 正好抵消卡槽的倾角，卡就立正了。
        const straighten = -seat.rot
        // hover 只做上浮、放大、回正，不动层级：卡与卡的遮挡一律按 DOM 顺序，
        // 抬起来的卡照样被右边的邻居、以及上层的人物和道具压住，这正是设计稿要的效果。
        const enter = () => {
          gsap.to(lift, {
            yPercent: CARD_LIFT_PERCENT,
            scale: 1.06,
            rotation: straighten,
            duration: CARD_HOVER_DUR,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        }
        const leave = () => {
          gsap.to(lift, {
            yPercent: 0,
            scale: 1,
            rotation: 0,
            duration: CARD_HOVER_DUR,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        }

        slot.addEventListener('pointerenter', enter)
        slot.addEventListener('pointerleave', leave)
        unbinds.push(() => {
          slot.removeEventListener('pointerenter', enter)
          slot.removeEventListener('pointerleave', leave)
        })
      })

      return () => {
        for (const handle of tilts) handle.detach()
        for (const unbind of unbinds) unbind()
      }
    },
    { scope: cardsRef },
  )

  return (
    <div className="home">
      <div className="home__stage" ref={stageRef}>
        <img className="home__layer" src="/home/home-bg.jpg" alt="" draggable={false} />

        <div className="home__cards" ref={cardsRef}>
          {SEATS.map((seat) => (
            <div
              key={seat.card.id}
              className="home__card"
              style={
                {
                  left: `${seat.x}%`,
                  top: `${seat.y}%`,
                  '--home-card-rot': `${seat.rot}deg`,
                } as CSSProperties
              }
            >
              <div className="home__card-lift">
                <div className="home__card-tilt">
                  {/* 里面是整张 150×210 的卡面，靠 scale 缩到 11cqi 宽，和战场小卡一个套路。 */}
                  <div className="home__card-inner">
                    <HandCardFace card={seat.card} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="home__cast">
          {CAST.map((figure) => (
            <div
              key={figure.id}
              className="home__figure"
              style={{
                left: `${figure.left}%`,
                top: `${figure.top}%`,
                width: `${figure.width}%`,
                height: `${figure.height}%`,
              }}
            >
              人物占位
            </div>
          ))}
        </div>

        <img className="home__layer" src="/home/home-table.png" alt="" draggable={false} />
        <img className="home__layer" src="/home/home-props.png" alt="" draggable={false} />

        {/*
          感叹号用半角而不是全角「！」：中文字体（现在是 Noto Serif SC）里全角标点独占一整格，
          笔画只画在其中一侧，另外大半格是空的。那半格照样算进行宽，整行看上去就偏左了。
          半角号配一段 padding 自己撑出设计稿里「I」和「!」之间的空当，行宽和视觉重心才对得上。
        */}
        <h1 className="home__title">
          出牌吧，AI<span className="home__title-bang">!</span>
        </h1>

        <p className="home__subtitle">
          <span className="home__flourish" aria-hidden="true">
            <i className="home__flourish-line" />
            <Sparkle className="home__flourish-star" />
          </span>
          <span className="home__subtitle-text">这题你ai会吗？</span>
          <span className="home__flourish home__flourish--right" aria-hidden="true">
            <Sparkle className="home__flourish-star" />
            <i className="home__flourish-line" />
          </span>
        </p>

        <button type="button" className="home__start" onClick={() => navigate('/room')}>
          <span className="home__start-label">开始游戏</span>
        </button>

        {/*
          英雄 / 牌组 / 图鉴还没有对应页面。这里刻意不用 <button> 或 <a>：
          做成能按的样子却什么都不发生，比直接写"敬请期待"更让人困惑。
        */}
        <nav className="home__nav" aria-label="主菜单">
          <span className="home__nav-item" title="敬请期待">
            英雄
          </span>
          <Sparkle className="home__nav-dot" />
          <span className="home__nav-item" title="敬请期待">
            牌组
          </span>
          <Sparkle className="home__nav-dot" />
          <span className="home__nav-item" title="敬请期待">
            图鉴
          </span>
        </nav>

        <span className="home__settings" title="敬请期待">
          <GearIcon />
          设置
        </span>

        {/* 开发期入口，压到角落里：这两个功能正式版不留，但现在天天要用。 */}
        <div className="home__dev">
          <button type="button" className="home__dev-link" onClick={() => navigate('/dev/hand')}>
            手牌演示
          </button>
          <button type="button" className="home__dev-link" onClick={() => setSave(resetSave())}>
            重置存档
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 四角星装饰。设计稿里那颗星的边是内凹的，字符 ✦ 是直边、还得指望系统装了对应字体，
 * 所以自己画一条路径更稳。
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

/** 描边风格的齿轮。路径是按 8 齿等分算出来的，圆心 (12,12)，齿顶半径 10.4、齿根 8。 */
function GearIcon() {
  return (
    <svg
      className="home__gear"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10.1 1.77 A10.4 10.4 0 0 1 13.9 1.77 L13.94 4.24 A8 8 0 0 1 16.12 5.14 L17.89 3.43 A10.4 10.4 0 0 1 20.57 6.11 L18.86 7.88 A8 8 0 0 1 19.76 10.06 L22.23 10.1 A10.4 10.4 0 0 1 22.23 13.9 L19.76 13.94 A8 8 0 0 1 18.86 16.12 L20.57 17.89 A10.4 10.4 0 0 1 17.89 20.57 L16.12 18.86 A8 8 0 0 1 13.94 19.76 L13.9 22.23 A10.4 10.4 0 0 1 10.1 22.23 L10.06 19.76 A8 8 0 0 1 7.88 18.86 L6.11 20.57 A10.4 10.4 0 0 1 3.43 17.89 L5.14 16.12 A8 8 0 0 1 4.24 13.94 L1.77 13.9 A10.4 10.4 0 0 1 1.77 10.1 L4.24 10.06 A8 8 0 0 1 5.14 7.88 L3.43 6.11 A10.4 10.4 0 0 1 6.11 3.43 L7.88 5.14 A8 8 0 0 1 10.06 4.24 Z" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  )
}
