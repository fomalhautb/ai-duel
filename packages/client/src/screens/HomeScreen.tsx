/**
 * 首页。
 *
 * 整页是照着一张 1672×941 的设计稿复原的，做法是把它当成一个固定宽高比的"舞台"塞进视口居中，
 * 舞台内所有尺寸都用 cqi（1cqi = 舞台宽的 1%）。这样窗口怎么变都只是整体等比缩放，
 * 不用为各种分辨率写断点，也不会出现"字大了图小了"的错位。
 * 根节点带 .grain（定义在 src/ui/paper/paper.css）：舞台之外的留边铺成纸张——
 * 纸底色 + 两层纸纹 + 暗角，纹理只出现在舞台外面（怎么做到的见 styles.css 的 .home__stage）。
 *
 * 舞台内部层叠自下而上是：夜空底 → 四张展示卡 → 七张人物抠图（每个人自带一张垫在身下的发光副本）
 * → 桌面弧 → 前景道具 → 文字类 UI（标题、副标题、开始按钮、导航、设置、调试入口）→ 人物介绍卡片。
 * 顺序完全由 JSX 的先后决定，舞台里没有一处 z-index（舞台自己有一个，那是用来压住外层纸纹的，
 * 和内部层叠无关）。
 * 桌面弧夹在人物和道具中间，对应的是现实关系：人站在桌子后面被桌沿挡住下半身，
 * 而地球仪、望远镜这些道具又摆在桌沿上。
 * 压在卡牌上面的那几层（人物、发光副本、桌面弧、道具）都是 pointer-events: none，不会挡住卡牌 hover。
 *
 * 人物的 hover 因此不能靠图层自己收指针事件（一收就把卡牌挡死了），改成在舞台上监听 pointermove，
 * 拿归一化坐标去查预先抽好的 alpha 通道，判断指针停在哪个人身上（见 castHitTest.ts）。
 * 桌面弧和前景道具压住的地方要从命中区里减掉，UI 控件上也不触发，否则会"指着桌子/按钮高亮人"。
 *
 * 整页的图会先全部加载完再一次性亮出来，中途只显示加载动画（见下面的 HomeScreen）。
 *
 * 素材分辨率：大部分图已经换成 2x——七张人物抠图（cast-*.webp）、夜空底 home-bg、桌面弧 home-table
 * 都是 3344×1882（设计稿 1672×941 的两倍），开始按钮的牌匾 home-plaque 是单独一小块，
 * 按它自己 1x 尺寸 521×125 的两倍导出成 1042×250。这几张在高分屏上基本不再靠插值撑大。
 * 全部统一成 webp 是因为 2x 存 PNG 太大：桌面弧那张 PNG 要 5.3MB，webp 只要 87KB。
 * 还是 1x 的只剩前景道具 home-props（1672×941，和设计稿等大；它只是从 PNG 换成 webp，分辨率没变）。
 * 舞台要撑满视口，所以它在高分屏上仍被放大：1440×810 视口配 DPR 2 时舞台宽 1439 CSS px，
 * 要铺满 2878 个物理像素，等于放大 1.72 倍，屏幕越大倍数越高（2560 宽的屏上超过 3 倍），
 * 放大用的插值会把边缘抹平，这就是这一层发糊的来源。
 * 它在导出时做过一遍锐化补偿（半径 0.8px、力度 70%、阈值 3），让放大后的边缘不那么平，
 * 但锐化补不回丢掉的分辨率——这套参数现在只对 home-props 这一张还有意义。
 * 真要清晰只能它也换 2x：按 3344×1882 重新导出、同名覆盖就行，
 * 代码一行都不用改——所有图层都是 width/height: 100%，多大的图都按舞台尺寸铺满。
 *
 * 新手教程已经删掉还没重做，"开始游戏"目前直接进匹配房。
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useLocation } from 'wouter'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { HandDrawnFilterDefs } from '../ui/HandDrawnFilterDefs'
import { HandCardFace } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'
import { attachCardTilt } from '../ui/cardTilt'
import type { CardTiltHandle } from '../ui/cardTilt'
import { cardArtFor } from '../ui/cardArt'
import { LoadingScreen } from '../ui/LoadingScreen'
import { useAssetsReady } from '../ui/preloadAssets'
import { createTestMatchDriver } from '../match/testMatch'
import { useMatchSession } from '../match/MatchSession'
import { loadSave, resetSave } from '../save/save'
import { hitTestAlphaMaps, loadCastAlphaMaps } from './castHitTest'
import type { AlphaMap, NormalizedBox } from './castHitTest'

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
      kind: 'ai',
      name: 'ChatGPT',
      model: 'GPT',
      text: '占位描述：老成持重的通才，什么都会一点，什么都不算最强。',
      backText: '占位背面：稀有度 ★★☆ · 这里之后会放这张卡的更多信息。',
    },
  },
  {
    x: 45.5,
    y: 48.1,
    rot: -3,
    card: {
      id: 'home-claude',
      kind: 'ai',
      name: 'Claude',
      model: 'Claude',
      text: '占位描述：话多且讲究，越是被追问越要把话说圆。',
      backText: '占位背面：稀有度 ★★★ · 这里之后会放这张卡的更多信息。',
    },
  },
  {
    x: 54.5,
    y: 48.1,
    rot: 3,
    card: {
      id: 'home-deepseek',
      kind: 'ai',
      name: 'DeepSeek',
      model: 'DeepSeek',
      text: '占位描述：算得又快又狠，可惜偶尔算错了也一样理直气壮。',
      backText: '占位背面：稀有度 ★★☆ · 这里之后会放这张卡的更多信息。',
    },
  },
  {
    x: 63.4,
    y: 49.7,
    rot: 9,
    card: {
      id: 'home-gemini',
      kind: 'ai',
      name: 'Gemini',
      model: 'Gemini',
      text: '占位描述：看得见听得见，就是记性差了点。',
      backText: '占位背面：稀有度 ★★☆ · 这里之后会放这张卡的更多信息。',
    },
  },
]

interface CastMember {
  /** public/home/ 下的抠图文件名（不含扩展名）。 */
  file: string
  name: string
  /** 一行身份，排在名字下面。 */
  title: string
  /** 一两句介绍。 */
  blurb: string
}

/**
 * 七个人物：抠图文件名 + hover 时那张介绍卡片的内容。
 *
 * 每张抠图都是和舞台等比的整幅透明图，人物已经画在各自该在的位置上，所以这里不需要任何坐标——
 * 整张铺满舞台叠上去就是对的位置，和夜空底、桌面弧、前景道具是同一种用法（共用 .home__layer）。
 * 换人只要重新导出同比例的整幅图，不用回来改代码；尺寸越大越清晰，理由见文件头「素材分辨率」。
 * 介绍卡片的定位也不用跟着改：它是从图片的 alpha 包围盒现算的，而包围盒存的是 0~1 的比例，
 * 和图片到底多少像素无关，所以换成 2x 素材照样对得上（见 castHitTest.ts）。
 *
 * 数组顺序就是叠放顺序，后面的盖住前面的，所以站在前排的人排在后面。
 * 这个顺序同时也是 hover 命中的优先级：两个人重叠的地方判给排在后面的那个。
 * 整层压在卡牌之上：设计稿里两侧的人是挡住最外侧那两张卡的边缘的。
 * 每个人下半截又会被桌面弧和前景道具盖掉，这和设计稿里人物半身埋在桌后是一致的。
 *
 * name / title / blurb 全是占位文案，角色设定定下来之后整组替换。
 */
const CAST: CastMember[] = [
  {
    file: 'cast-left-back',
    name: '占位·后排学者',
    title: '夜航图书馆 · 编目员',
    blurb: '占位介绍：把每一场辩论都记进卡册，翻页比出牌还快。',
  },
  {
    file: 'cast-left-officer',
    name: '占位·左席执事',
    title: '牌桌纪律 · 监场',
    blurb: '占位介绍：只管规则不管输赢，谁想赖牌都会被他记上一笔。',
  },
  {
    file: 'cast-left-front',
    name: '占位·左前少年',
    title: '新入席 · 学徒',
    blurb: '占位介绍：牌技一般，运气极好，常常凭一张废牌把局面搅乱。',
  },
  {
    file: 'cast-right-glasses',
    name: '占位·镜片先生',
    title: '概率推演 · 顾问',
    blurb: '占位介绍：出牌前要算三遍，算完照样跟着直觉走。',
  },
  {
    file: 'cast-right-laugh',
    name: '占位·笑面客',
    title: '气氛担当 · 挑事人',
    blurb: '占位介绍：赢了笑输了也笑，对手最怕的就是猜不透那张脸。',
  },
  {
    file: 'cast-right-classic',
    name: '占位·古典派',
    title: '旧派牌路 · 传承者',
    blurb: '占位介绍：坚持二十年前的老套路，偏偏至今还没被人破解。',
  },
  {
    file: 'cast-right-front',
    name: '占位·右前贵客',
    title: '压轴登场 · 常胜客',
    blurb: '占位介绍：坐在最靠前的位置，牌局的输赢通常在他抬手那一刻定下。',
  },
]

/**
 * 压在人物之上的两张整幅图：桌面弧和前景道具。
 *
 * 它们既是画面的一部分（照数组顺序渲染），又是命中检测的"遮挡层"——
 * 人物下半身被桌沿和地球仪压住的那部分在屏幕上根本看不见，不减掉就会"指着桌子高亮人"
 * （见 castHitTest.ts 的 hitTestAlphaMaps）。下面的 HOME_ASSETS 预加载清单也读这一份。
 * 三个用途共用一份，免得换图时只改了一边。
 */
const CAST_OCCLUDERS = ['home-table', 'home-props']

/** 人物 hover 不该被这些控件触发：指针停在按钮上时，该有反馈的是按钮而不是它身后的人。 */
const UI_CONTROL_SELECTOR = '.home__start, .home__nav, .home__settings, .home__dev'

/**
 * 介绍卡片相对人物包围盒的横向间距，单位 cqi（舞台是容器，1cqi = 舞台宽的 1%）。
 */
const CAST_PANEL_GAP_CQI = 1
/** 卡片顶边比人物包围盒顶边再往下一点，避开头顶留白，让卡片大致对着肩膀。单位：舞台高的百分比。 */
const CAST_PANEL_HEAD_DROP = 4
/**
 * 介绍卡片的估算高度，单位是舞台高的百分比。
 *
 * 卡片高度由内容撑开，CSS 量不到、JS 又要在渲染前就算好位置，所以只能估。
 * 按 styles.css 里的 .home__cast-panel 逐项加起来（上下内边距 3cqi + 标签 ≈1.3 + 姓名 ≈3.2
 * + 分隔线 2.7 + 身份 ≈1.6 + 介绍两行 ≈5.2）约 17cqi；舞台高是舞台宽的 941/1672，
 * 折算过来约 30%，这里取 32% 给三行介绍留一点余量。
 * 换成明显更长的角色文案后要回来重估这个值。
 */
const CAST_PANEL_HEIGHT = 32
/**
 * 卡片顶边允许的范围（舞台高的百分比）。
 *
 * 下限是副标题的下沿（副标题中心在 27.2%、行高约 3%）：卡片再往上就会压住那行字。
 * 上限用「开始游戏」匾额的顶边 74.5% 减去卡片估算高度反推，保证整张卡片停在主 CTA 之上；
 * 匾额之下还有底部导航，被匾额挡住的范围一并避开了。
 */
const CAST_PANEL_TOP_MIN = 30
const CAST_PANEL_TOP_MAX = 74.5 - CAST_PANEL_HEIGHT

/** 介绍卡片当前该出现在哪、显示谁。指针移开时保留最后一次，只让透明度淡出。 */
interface CastPanelState {
  index: number
  style: CSSProperties
}

/**
 * 由人物的 alpha 包围盒算出介绍卡片的位置。
 *
 * 横向看人在舞台的哪半边：左半边的人把卡片放到他右侧，右半边的放到左侧（用 right 定位，
 * 卡片自己多宽都不会越过人物）。这样卡片永远朝画面中间展开，不会挤出舞台。
 */
function castPanelStyle(bbox: NormalizedBox): CSSProperties {
  const top = Math.min(
    CAST_PANEL_TOP_MAX,
    Math.max(CAST_PANEL_TOP_MIN, bbox.minY * 100 + CAST_PANEL_HEAD_DROP),
  )
  const onLeftHalf = (bbox.minX + bbox.maxX) / 2 < 0.5
  return onLeftHalf
    ? { top: `${top}%`, left: `calc(${bbox.maxX * 100}% + ${CAST_PANEL_GAP_CQI}cqi)` }
    : { top: `${top}%`, right: `calc(${(1 - bbox.minX) * 100}% + ${CAST_PANEL_GAP_CQI}cqi)` }
}

/**
 * 首页要用到的全部图片：舞台各层 + 匾额按钮的背景图 + 四张展示卡的插画。
 * 全部加载完之前首页不上场（见紧跟其后的 HomeScreen）。
 *
 * 卡面插画走 cardArtFor 现算而不是写死文件名，是为了跟卡面里实际用的那张永远一致；
 * 四张卡有两张会分到同一张图，Set 去重一下，别为同一个地址排两次队。
 *
 * index.html 里给 /home/ 下这几张写了 <link rel="preload">，那份清单要跟这里对得上：
 * 少写了只是晚一点开始下载，多写了会白下一张用不上的图。
 *
 * 人物的发光副本用的是和本人完全相同的 src，浏览器按地址认图，所以这里不用为它多列七条。
 */
const HOME_ASSETS = Array.from(
  new Set([
    '/home/home-bg.webp',
    ...CAST.map((member) => `/home/${member.file}.webp`),
    ...CAST_OCCLUDERS.map((file) => `/home/${file}.webp`),
    // 匾额是「开始游戏」按钮的 CSS 背景图（见 styles.css 的 .home__start），
    // 页面里没有对应的 <img>，但同样得等它，否则按钮会先空着一块。
    '/home/home-plaque.webp',
    ...SEATS.map((seat) => cardArtFor(seat.card.id)),
  ]),
)

/**
 * 首页的加载闸门。
 *
 * 图没齐就只显示加载动画，不显示半张画面。做成两个组件而不是在一个组件里写条件渲染，
 * 是因为下面 HomeStage 的 GSAP 绑定和量卡牌缩放的 ResizeObserver 都只在挂载时跑一次，
 * 必须等真实 DOM 就位再挂；同一个组件里"先渲染 loader 再切成首页"的话，
 * 那些 effect 会在没有 DOM 的第一帧就跑掉，之后不会再补跑。
 */
export function HomeScreen() {
  const ready = useAssetsReady(HOME_ASSETS)
  return ready ? <HomeStage /> : <LoadingScreen />
}

function HomeStage() {
  const [, navigate] = useLocation()
  // 首页在 MatchSessionProvider 里面，所以 dev 入口可以直接建一局测试对局再跳过去。
  const session = useMatchSession()
  // 首页现在不展示任何存档数据，留着 state 只是为了"重置存档"后触发一次重渲染。
  const [, setSave] = useState(loadSave)
  const stageRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  /** 当前指针压在哪个人身上（CAST 下标），没压到就是 null。只有它变了才重渲染。 */
  const [hoveredCast, setHoveredCast] = useState<number | null>(null)
  // 同一个值再存一份在 ref 里：rAF 回调是在闭包里跑的，读 state 会读到过期值，
  // 拿它来判断"命中变了没"才靠谱，也才能做到没变就不 setState。
  const hoveredCastRef = useRef<number | null>(null)
  const [castPanel, setCastPanel] = useState<CastPanelState | null>(null)
  /**
   * 命中检测用的 alpha 通道：七个人物 + 两张遮挡层（桌面弧、前景道具）。
   * 放 ref 不放 state：它只被指针回调读，进 state 会白白多一次重渲染。
   */
  const castAlphaRef = useRef<{ cast: AlphaMap[]; occluders: AlphaMap[] } | null>(null)

  /*
   * 抠图解码 + 抽 alpha 是异步的，加载完成前 hover 静默不生效（宁可没反应，也别乱高亮）。
   * 九张图一次请完，是为了让它们共用同一块离屏画布（见 loadCastAlphaMaps）。
   *
   * 这九个地址全都在 HOME_ASSETS 里，而 HomeStage 要等那批图就绪才挂载，
   * 所以这里的 new Image 命中的是浏览器缓存，不会再下一遍，decode() 也基本当场返回。
   * 剩下的开销是画进离屏画布再逐像素扫一遍，正好落在首页淡入那段时间（见 castHitTest.ts）。
   * 没把这一步并进加载闸门：hover 高亮晚几百毫秒无所谓，
   * 为它多顶一会儿 loader 却是每个玩家都要付的代价。
   */
  useEffect(() => {
    let alive = true
    const srcs = [
      ...CAST.map((member) => `/home/${member.file}.webp`),
      ...CAST_OCCLUDERS.map((file) => `/home/${file}.webp`),
    ]
    void loadCastAlphaMaps(srcs).then((maps) => {
      if (!alive) return
      castAlphaRef.current = { cast: maps.slice(0, CAST.length), occluders: maps.slice(CAST.length) }
    })
    return () => {
      alive = false
    }
  }, [])

  /**
   * 舞台在视口里的位置和大小，缓存起来给命中检测用。
   *
   * 不在 rAF 回调里现读 getBoundingClientRect：GSAP 的补间也跑在 rAF 里、每帧都在写 transform，
   * 读写交替会逼浏览器提前算一次布局。舞台只在窗口变化时动，缓存下来稳态里每帧零布局读取。
   * 页面本身不滚动（.home 是 height:100% + overflow:hidden），所以只有窗口尺寸会让它挪位。
   */
  const stageRectRef = useRef<DOMRect | null>(null)

  // pointermove 每帧能来好几次，而命中检测要扫九张图，所以用 rAF 压到每帧最多一次。
  // overControl 记的是这次移动落在不落在按钮/导航上，见 UI_CONTROL_SELECTOR。
  const castProbeRef = useRef<{ frame: number; x: number; y: number; overControl: boolean }>({
    frame: 0,
    x: 0,
    y: 0,
    overControl: false,
  })
  const cancelCastProbe = () => {
    const probe = castProbeRef.current
    if (probe.frame === 0) return
    cancelAnimationFrame(probe.frame)
    probe.frame = 0
  }
  useEffect(() => cancelCastProbe, [])

  const handleStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const probe = castProbeRef.current
    probe.x = event.clientX
    probe.y = event.clientY
    probe.overControl =
      event.target instanceof Element && event.target.closest(UI_CONTROL_SELECTOR) !== null
    if (probe.frame !== 0) return
    probe.frame = requestAnimationFrame(() => {
      probe.frame = 0
      const maps = castAlphaRef.current
      const rect = stageRectRef.current
      if (maps === null || rect === null || rect.width <= 0 || rect.height <= 0) return
      // 抠图和舞台等大等比，所以舞台内的归一化坐标可以直接当图片里的归一化坐标用。
      const hit = probe.overControl
        ? null
        : hitTestAlphaMaps(
            maps.cast,
            (probe.x - rect.left) / rect.width,
            (probe.y - rect.top) / rect.height,
            maps.occluders,
          )
      if (hit === hoveredCastRef.current) return
      hoveredCastRef.current = hit
      // 位置在这里一次算定，之后只随下一次命中变化：卡片淡出期间不该跟着指针跑。
      if (hit !== null) {
        const bbox = maps.cast[hit]?.bbox ?? null
        if (bbox !== null) setCastPanel({ index: hit, style: castPanelStyle(bbox) })
      }
      setHoveredCast(hit)
    })
  }

  const handleStagePointerLeave = () => {
    // 已排队的那帧必须取消：它闭包里存的是离场前的坐标，跑起来会把刚清掉的高亮又设回去，
    // 而指针已经在舞台外，不会再有 pointermove 来纠正——高亮和介绍卡片就一直亮着了。
    cancelCastProbe()
    hoveredCastRef.current = null
    setHoveredCast(null)
  }

  // 卡面里的字号、内边距全是写死的像素，只能整张按比例缩。
  // 而 scale() 只吃无单位数字，CSS 里又没法把 cqi 换算成数字，所以这个比例只能在这儿量。
  // 用 layout effect 是为了赶在首帧绘制之前把值写进去，否则会先闪一下原始大小的卡。
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const sync = () => {
      const target = (stage.clientWidth * CARD_WIDTH_CQI) / 100
      stage.style.setProperty('--home-card-scale', String(target / CARD_FACE_WIDTH))
      stageRectRef.current = stage.getBoundingClientRect()
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(stage)
    // ResizeObserver 只管尺寸，而舞台是居中摆的：窗口在"高度受限"那一侧变化时舞台大小不变、
    // 左右位置却会挪，那种情况只有 resize 事件抓得到。
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
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
    <div className="home grain">
      {/* CSS 里的 url(#ai-duel-rough-*) 要在同一个文档里找得到滤镜定义，每个页面各挂一次。
          本身是 0 尺寸的 svg，不占布局。 */}
      <HandDrawnFilterDefs />

      <div
        className={`home__stage${hoveredCast !== null ? ' is-cast-hover' : ''}`}
        ref={stageRef}
        onPointerMove={handleStagePointerMove}
        onPointerLeave={handleStagePointerLeave}
      >
        <img className="home__layer" src="/home/home-bg.webp" alt="" draggable={false} />

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

        {CAST.map((member, index) => (
          <Fragment key={member.file}>
            {/*
              发光副本：同一张图套上"实描边 + 光晕"的滤镜，垫在本人**下面一层**。
              位置正好在这里，是因为需求要的遮挡关系全靠它：
              垫在自己身下，光只能从自己轮廓外露出一圈，成为描边而不是糊在身上的一片光；
              同时它排在更前排的人之前，于是那圈光会被站在前面的人挡住，
              就像光真的是从这个人身上发出来的。放到自己上面或整层最后，这两点都会失效。
            */}
            <img
              className={`home__layer home__cast-glow${hoveredCast === index ? ' is-lit' : ''}`}
              src={`/home/${member.file}.webp`}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <img
              className="home__layer"
              src={`/home/${member.file}.webp`}
              alt=""
              draggable={false}
            />
          </Fragment>
        ))}

        {CAST_OCCLUDERS.map((file) => (
          <img
            key={file}
            className="home__layer"
            src={`/home/${file}.webp`}
            alt=""
            draggable={false}
          />
        ))}

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
          <span className="home__flourish" aria-hidden="true">
            <Sparkle className="home__flourish-star" />
            <i className="home__flourish-line home__flourish-line--right" />
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

        {/* 开发期入口，压到角落里：这几个功能正式版不留，但现在天天要用。
            其余开发页不往这里堆，都收在 /dev 那一页里。 */}
        <div className="home__dev">
          <button type="button" className="home__dev-link" onClick={() => navigate('/dev')}>
            开发页
          </button>
          <button
            type="button"
            className="home__dev-link"
            onClick={() => {
              session.start(createTestMatchDriver(), { test: true })
              navigate('/match')
            }}
          >
            测试对局
          </button>
          <button type="button" className="home__dev-link" onClick={() => navigate('/loader')}>
            加载动画
          </button>
          <button type="button" className="home__dev-link" onClick={() => setSave(resetSave())}>
            重置存档
          </button>
        </div>

        {/*
          人物介绍卡片放在舞台的最后一层，压在所有东西之上（包括标题和道具）——
          它是临时浮出来的信息，被夜空里的任何东西挡住都会显得像画错了。
          指针移开后不卸载、只淡出，所以这里读的是 castPanel 而不是 hoveredCast：
          淡出过程中内容还得留在原地，否则字会先消失、框再慢慢淡。

          aria-hidden 是有意的：整块内容只有 hover 得到的人看得见，读屏和键盘用户本来就到不了，
          留在无障碍树里只会变成一段没有上下文、还会随指针来回出现的游离文字。
          TODO：角色文案从占位换成真设定之后，这些信息就不能只挂在 hover 上了，
          得另给一个可聚焦、触屏也点得到的入口（比如"英雄"页），那时再把这里接进无障碍树。
        */}
        {castPanel !== null && (
          <aside
            className={`home__cast-panel${hoveredCast !== null ? ' is-open' : ''}`}
            style={castPanel.style}
            aria-hidden="true"
          >
            <span className="home__cast-panel-kicker">角色档案</span>
            <span className="home__cast-panel-name">{CAST[castPanel.index]?.name}</span>
            {/* 分隔线和副标题两侧那组花饰共用 .home__flourish 的零件，只是把线和星改小一档、
                星色调淡（覆盖的三个变量见 styles.css 的 .home__cast-panel-rule）。 */}
            <span className="home__flourish home__cast-panel-rule">
              <i className="home__flourish-line" />
              <Sparkle className="home__flourish-star" />
              <i className="home__flourish-line home__flourish-line--right" />
            </span>
            <span className="home__cast-panel-title">{CAST[castPanel.index]?.title}</span>
            <p className="home__cast-panel-blurb">{CAST[castPanel.index]?.blurb}</p>
          </aside>
        )}
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
