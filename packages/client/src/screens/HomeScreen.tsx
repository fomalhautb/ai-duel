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
 * → 桌面弧 → 前景道具 → 文字类 UI（标题、副标题、开始按钮、导航、调试入口）→ 人物介绍卡片。
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
 * "开始游戏"按存档分流：没走完新手教程的进 /tutorial，走完的直接进匹配房。
 * 分流在点下去那一刻现读存档，不在挂载时读一次——教程和首页之间来回跳时，
 * 提前读的那份会是过期的。
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useLocation } from 'wouter'
import { getCard } from '@ai-duel/core'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { HandCardFace } from '../ui/HandFan'
import { MuteButton } from '../ui/MuteButton'
import type { HandCardData } from '../ui/HandFan'
import { attachCardTilt } from '../ui/cardTilt'
import type { CardTiltHandle } from '../ui/cardTilt'
import { cardArtFor } from '../ui/cardArt'
import { midFor } from '../ui/cardArtThumb'
import { toHandCardData } from '../ui/handCardData'
import { LoadingScreen } from '../ui/LoadingScreen'
import { useBackgroundMusic } from '../ui/backgroundMusic'
import { useHomeIntroSound } from '../ui/soundEffects'
import { useAssetsProgress } from '../ui/preloadAssets'
import { enterLandscapeFullscreen, isCoarsePointer } from '../ui/fullscreen'
import { createTestMatchDriver } from '../match/testMatch'
import { useMatchSession } from '../match/MatchSession'
import { loadSave, resetSave } from '../save/save'
import { resetDecks } from '../save/deckStore'
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
 * 换算成卡自身高度的百分比（1.5 / 16.5 ≈ 9.1%）就和单位无关了，缩放到任何窗口都一样高。
 */
const CARD_LIFT_PERCENT = -9.1
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
 * 首页橱窗里的四张卡：直接取 core 卡池里的真卡，卡面走对局那套 HandCardFace，
 * 展示数据走公共的 toHandCardData（见 ui/handCardData.ts），
 * 所以这里看到的名字、描述、插画和对局里抽到同一张时完全一致，不需要在这一页维护占位文案。
 *
 * 挑的是四家各自的旗舰款（GPT / Claude / DeepSeek / 豆包）：首页是门面，
 * 摆一眼能认出品牌的那张，比摆早期型号更说明这游戏在玩什么。
 *
 * 位置和倾角照着设计稿量。注意两端的卡不是抬起而是**沉下去**一点（y 差约 1.6%），弧口朝上。
 */
const SEATS: Seat[] = [
  { x: 36.6, y: 49.7, rot: -9, card: toHandCardData(getCard('chatgpt-5-6-sol')) },
  { x: 45.5, y: 48.1, rot: -3, card: toHandCardData(getCard('claude-fable-5')) },
  { x: 54.5, y: 48.1, rot: 3, card: toHandCardData(getCard('deepseek-v4')) },
  { x: 63.4, y: 49.7, rot: 9, card: toHandCardData(getCard('doubao')) },
]

interface CastMember {
  /** public/home/ 下的抠图文件名（不含扩展名）。 */
  file: string
  name: string
  /** 人物经历的简介。 */
  intro: string
  skillName: string
  /** 对局中的具体技能效果。 */
  skillEffect: string
  /** 技能的使用定位。 */
  role: string
}

/**
 * 七个人物：抠图文件名 + hover 时那张介绍卡片的内容。
 *
 * 每张抠图都是和舞台等比的整幅透明图，人物已经画在各自该在的位置上，所以这里不需要任何坐标——
 * 整张铺满舞台叠上去就是对的位置，和夜空底、桌面弧、前景道具是同一种用法（共用 .home__layer）。
 * 换人只要重新导出同比例的整幅图，不用回来改代码；尺寸越大越清晰，理由见文件头「素材分辨率」。
 * 介绍卡片的定位也不用跟着改：它是从图片的 alpha 包围盒算出来的，而包围盒存的是 0~1 的比例，
 * 和图片到底多少像素无关，所以换成 2x 素材照样对得上（见 castHitTest.ts）。
 *
 * 数组顺序就是叠放顺序，后面的盖住前面的，所以站在前排的人排在后面。
 * 这个顺序同时也是 hover 命中的优先级：两个人重叠的地方判给排在后面的那个。
 * 整层压在卡牌之上：设计稿里两侧的人是挡住最外侧那两张卡的边缘的。
 * 每个人下半截又会被桌面弧和前景道具盖掉，这和设计稿里人物半身埋在桌后是一致的。
 *
 * 文案保留人物成就和技能规则，把长句压缩到 hover 卡能快速读完的长度。
 */
const CAST: CastMember[] = [
  {
    file: 'cast-left-back',
    name: '玛格丽特·汉密尔顿 Margaret Hamilton',
    intro: '领导阿波罗登月软件工程，以优先级与容错设计守住关键任务。',
    skillName: '容错系统',
    skillEffect: '己方 Agent 答错时，可免费换手牌中另一名 Agent 重答 1 次。',
    role: '关键题的翻盘保险，避免一次失误直接出局。',
  },
  {
    file: 'cast-left-officer',
    name: '格蕾丝·霍珀 Grace Hopper',
    intro: '编译器先驱，推动高级语言与现代调试文化发展。',
    skillName: 'Debug',
    skillEffect: '每局限 1 次：移除对手当前生效的 1 个技能效果。',
    role: '专门拆解对手的增益、复活、晋级或资源优势。',
  },
  {
    file: 'cast-left-front',
    name: '李飞飞 Fei-Fei Li',
    intro: '推动建立 ImageNet，让 AI 开始系统学习“看懂”现实世界。',
    skillName: '再看一眼',
    skillEffect: '题目含图片、图表或视觉信息时，可保送 1 个 Agent 晋级。',
    role: '视觉题王牌，优先应对读图、识图与图表分析。',
  },
  {
    file: 'cast-right-glasses',
    name: '陈丹琦 Danqi Chen',
    intro: '推动开放域问答、信息检索与语言模型结合，让 AI 找到可靠答案。',
    skillName: '精准检索',
    skillEffect: '每局限 1 次：指定 1 个 Agent 免费升级 1 轮。',
    role: '提前强化关键 Agent，建立知识与推理优势。',
  },
  {
    file: 'cast-right-laugh',
    name: '梅拉妮·珀金斯 Melanie Perkins',
    intro: 'Canva 联合创始人，让专业设计工具变得人人都能快速上手。',
    skillName: '化繁为简',
    skillEffect: '每局限 1 次：指定 1 个 Agent 降级 1 轮。',
    role: '压制对手的核心 Agent，打断其高等级组合。',
  },
  {
    file: 'cast-right-classic',
    name: '阿达·洛芙莱斯 Ada Lovelace',
    intro: '最早提出机器能按规则处理复杂信息，其算法被视为程序设计的起点。',
    skillName: '第一算法',
    skillEffect: '每局开始时，额外获得 2 个 Token。',
    role: '开局经济优势，可更早选强 Agent 并保留调整空间。',
  },
  {
    file: 'cast-right-front',
    name: '米拉·穆拉蒂 Mira Murati',
    intro: '推动生成式 AI 产品化，将前沿模型转化为真实可用的工具。',
    skillName: '快速部署',
    skillEffect: '每局限 1 次：双方选定 Agent、题目揭晓前，可重选己方 Agent，只补 Token 差价。',
    role: '阵容不匹配时临场换人，降低选错 Agent 的损失。',
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
const UI_CONTROL_SELECTOR = '.home__start, .home__nav, .home__dev'

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
 * 按 styles.css 里的 .home__cast-panel 逐项加起来，人物、技能和定位文案约需舞台高度的 39%。
 * 换成明显更长的角色文案后要回来重估这个值。
 */
const CAST_PANEL_HEIGHT = 39
/**
 * 卡片顶边允许的范围（舞台高的百分比）。
 *
 * 下限是副标题的下沿（副标题中心在 27.2%、行高约 3%）：卡片再往上就会压住那行字。
 * 上限用「开始游戏」匾额的顶边 74.5% 减去卡片估算高度反推，保证整张卡片停在主 CTA 之上；
 * 匾额之下还有底部导航，被匾额挡住的范围一并避开了。
 */
const CAST_PANEL_TOP_MIN = 30
const CAST_PANEL_TOP_MAX = 74.5 - CAST_PANEL_HEIGHT

/** 命中检测要用的一整套 alpha 通道：七个人物，加上压在他们之上的两张遮挡层。 */
interface CastAlphaMaps {
  cast: AlphaMap[]
  occluders: AlphaMap[]
}

/**
 * 由人物的 alpha 包围盒算出介绍卡片的位置。
 *
 * 横向看人在舞台的哪半边：左半边的人把卡片放到他右侧，右半边的放到左侧（用 right 定位，
 * 卡片自己多宽都不会越过人物）。这样卡片永远朝画面中间展开，不会挤出舞台。
 *
 * 只在 alpha 通道加载完那一次给七个人各算一遍，之后既不跟指针也不跟窗口变：
 * 包围盒存的是 0~1 的比例，换算出来的百分比和窗口多大无关，算一次就是定值。
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
 * 外面还要再套一层 midFor：这四张卡是 HandCardFace 画的，而它铺的是 600 宽那一档，
 * 不是原画。这里少套一层，预载下来的和卡面请求的就是两个地址——图照下不误、
 * 首页闸门照过不误，然后玩家眼看着四张卡一张张显影。
 * （test/assetManifest.test.ts 有一条断言专门守这个"档位分家"。）
 *
 * 600 宽在这里是够用的：卡按 11cqi 排版，2 倍 DPR 下 2560 宽的屏幕要 563 个设备像素。
 * 再宽的超宽屏（3440）会略微超出、插画轻微变软——这是全站唯一会碰到上界的地方，
 * 真觉得看得出来，就把 scripts/gen-card-thumbs.sh 里 mid 档的宽度调大重烤。
 *
 * index.html 里给 /home/ 下这几张写了 <link rel="preload">，那份清单要跟这里对得上：
 * 少写了只是晚一点开始下载，多写了会白下一张用不上的图。
 *
 * 人物的发光副本用的是和本人完全相同的 src，浏览器按地址认图，所以这里不用为它多列七条。
 *
 * 导出是给 ui/backgroundPreload.ts 用的：那边把全站的图按页分组列了一遍，
 * 首页这一份轮到时早就下完了，列进去只为让"public 下每张图都在某份清单里"这条不变量成立。
 */
export const HOME_ASSETS = Array.from(
  new Set([
    '/home/home-bg.webp',
    ...CAST.map((member) => `/home/${member.file}.webp`),
    ...CAST_OCCLUDERS.map((file) => `/home/${file}.webp`),
    // 匾额是「开始游戏」按钮的 CSS 背景图（见 styles.css 的 .home__start），
    // 页面里没有对应的 <img>，但同样得等它，否则按钮会先空着一块。
    '/home/home-plaque.webp',
    ...SEATS.map((seat) => midFor(cardArtFor(seat.card.id))),
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
  useBackgroundMusic('beginning')
  useHomeIntroSound()
  const assets = useAssetsProgress(HOME_ASSETS)
  return assets.ready ? <HomeStage /> : <LoadingScreen progress={assets.progress} />
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
  /**
   * 七张介绍卡片各自的位置样式，下标和 CAST 对齐。
   *
   * 抠图 alpha 抽完之前这份数组是空的，七张卡片一张都还没进 DOM；不过 hover 命中读的是同一批
   * 抠图，所以不会出现"能 hover 却没卡片"的空窗。抽完之后，某个人没抠出包围盒
   *（加载失败或整张全透明）时那一格是 null，卡片摆哪无从算起，那一张就一直不渲染。
   */
  const [castPanelStyles, setCastPanelStyles] = useState<Array<CSSProperties | null>>([])
  /**
   * 命中检测用的 alpha 通道：七个人物 + 两张遮挡层（桌面弧、前景道具）。
   *
   * 放 ref 不放 state：它只被指针回调读，不参与渲染；这又是九张图的逐像素数组，
   * 放进 state 只是让它白白挂在渲染路径上跟着走一遍。
   * 它同时是 hover 的总开关——还是 null 时命中检测直接不跑，什么都不会高亮。
   */
  const castAlphaRef = useRef<CastAlphaMaps | null>(null)
  /** 抠图已经抽完、但还不许拿去 hover 的中转站，理由见下面放行它的那个 effect。 */
  const pendingCastAlphaRef = useRef<CastAlphaMaps | null>(null)

  /*
   * 抠图解码 + 抽 alpha 是异步的，加载完成前 hover 静默不生效（宁可没反应，也别乱高亮）。
   * 九张图一次请完，是为了让它们共用同一块离屏画布（见 loadCastAlphaMaps）。
   *
   * 这九个地址全都在 HOME_ASSETS 里，而 HomeStage 要等那批图就绪才挂载，
   * 所以这里的 new Image 命中的是浏览器缓存，不会再下一遍。
   * 但"下载好了"不等于"解得出来"：九张大图一起解时浏览器会取消掉一部分，
   * 那种情况下 castHitTest.ts 会退回等 load 事件再画，不会把人丢掉（理由写在那边）。
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
      const cast = maps.slice(0, CAST.length)
      // 先搁在中转站，不当场开 hover，理由见下面放行它的那个 effect。
      pendingCastAlphaRef.current = { cast, occluders: maps.slice(CAST.length) }
      // 这一次 setState 躲不掉：七张介绍卡片必须先进 DOM 才谈得上淡入（理由见渲染处），
      // 而它们摆在哪要等包围盒算完才知道，只能靠这次重渲染把它们放进去。
      setCastPanelStyles(cast.map((map) => (map.bbox === null ? null : castPanelStyle(map.bbox))))
    })
    return () => {
      alive = false
    }
  }, [])

  /*
   * 等七张卡片以关闭态提交进 DOM 之后，再把 alpha 通道交给命中检测。
   *
   * 两件事挤进同一次提交会毁掉首次淡入：抠图抽完的那一刻指针要是正压在某个人身上，
   * 命中检测排的那次 setHoveredCast 会和上面的 setCastPanelStyles 被合并成同一次渲染，
   * 七张卡片首次插进 DOM 时，指针底下那张就已经带着 is-open 了——而 CSS 过渡对刚插入的元素
   * 不生效（没有"变化前"的样式可比），第一次又变回"啪"地弹出，正好是这次要消灭的那个毛病。
   * 隔开一次提交之后，加 is-open 必然发生在卡片已经渲染过关闭态之后，也就必然是一次真正的过渡。
   */
  useEffect(() => {
    const pending = pendingCastAlphaRef.current
    if (pending === null) return
    castAlphaRef.current = pending
    pendingCastAlphaRef.current = null
  }, [castPanelStyles])

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
      setHoveredCast(hit)
    })
  }

  /**
   * 触屏上点一下人物也要能亮起来。
   *
   * 高亮本来全靠 pointermove，而手指点一下（不划动）压根不会发 pointermove，
   * 只有 pointerdown。所以触屏这边补一发：按在谁身上就照亮谁，点到空处自然什么都不亮。
   * 鼠标不走这条——它的 move 已经足够，按下再探一次是白跑一帧。
   */
  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return
    handleStagePointerMove(event)
  }

  const handleStagePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 触屏的 pointerleave 是**手指抬起**那一刻发的，照做的话点谁都只亮一下就灭，
    // 介绍卡片根本来不及看。所以触屏上不靠它收：高亮一直留着，
    // 直到下一次点在别人身上或者点到空处（那一下 handleStagePointerDown 会算出 null）。
    if (event.pointerType !== 'mouse') return
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
        // 上浮只给鼠标：触屏的 pointerenter / pointerleave 是按下和抬手那一刻发的，
        // 照做就是"按住抬起来、松手掉回去"，一闪而过，除了掉帧什么也没留下。
        // 和 /hero 选英雄页那排卡是同一个处理。
        const enter = (event: PointerEvent) => {
          if (event.pointerType !== 'mouse') return
          gsap.to(lift, {
            yPercent: CARD_LIFT_PERCENT,
            scale: 1.06,
            rotation: straighten,
            duration: CARD_HOVER_DUR,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        }
        const leave = (event: PointerEvent) => {
          if (event.pointerType !== 'mouse') return
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
      <div
        className={`home__stage${hoveredCast !== null ? ' is-cast-hover' : ''}`}
        ref={stageRef}
        onPointerMove={handleStagePointerMove}
        onPointerDown={handleStagePointerDown}
        onPointerLeave={handleStagePointerLeave}
      >
        <img className="home__layer" src="/home/home-bg.webp" alt="" draggable={false} />

        {/* 静音钮画进舞台里，跟着页面一起缩放（位置见 .home__mute）。 */}
        <MuteButton className="home__mute" />

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
                  {/* 里面是整张 150×225 的卡面，靠 scale 缩到 11cqi 宽，和战场小卡一个套路。 */}
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

        <button
          type="button"
          className="home__start"
          onClick={() => {
            // 手机上顺手进全屏并锁横屏：这是整个流程里第一次、也是最自然的一次用户点击，
            // 而全屏和方向锁都只认用户手势。不支持（iPhone）或被拒都只是没生效，
            // 不影响往下走，玩家仍会在 OrientationNotice 上看到「请横屏」（见 ui/fullscreen.ts）。
            // 只对触屏做：电脑上按个"开始游戏"就把浏览器变全屏太越界了，那边有 F11。
            if (isCoarsePointer()) void enterLandscapeFullscreen()
            // 新号先走一遍新手教程，走完（或中途跳过）之后每次都直接进匹配房。
            navigate(loadSave().tutorialDone ? '/room' : '/tutorial')
          }}
        >
          <span className="home__start-label">开始游戏</span>
        </button>

        {/*
          图鉴 / 牌组还没有对应页面。这两项刻意不用 <button> 或 <a>：
          做成能按的样子却什么都不发生，比直接写"敬请期待"更让人困惑。
          「信息」已经有 /info 了，所以只有它是真按钮（样式差别见 .home__nav-item--link）。
        */}
        <nav className="home__nav" aria-label="主菜单">
          <span className="home__nav-item" title="敬请期待">
            图鉴
          </span>
          <Sparkle className="home__nav-dot" />
          <span className="home__nav-item" title="敬请期待">
            牌组
          </span>
          <Sparkle className="home__nav-dot" />
          <button
            type="button"
            className="home__nav-item home__nav-item--link"
            onClick={() => navigate('/info')}
          >
            信息
          </button>
        </nav>

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
          <button
            type="button"
            className="home__dev-link"
            onClick={() => {
              // 收藏和牌组是两份存档，两边都要清，不然重置完还留着上次编的牌组。
              resetDecks()
              setSave(resetSave())
            }}
          >
            重置存档
          </button>
        </div>

        {/*
          人物介绍卡片放在舞台的最后一层，压在所有东西之上（包括标题和道具）——
          它是临时浮出来的信息，被夜空里的任何东西挡住都会显得像画错了。

          抠图 alpha 抽完之后，七个人各有一份卡片一直挂在这儿，和上面那圈发光副本是同一套写法：
          显不显示只由 .is-open 这一个类决定。按需挂载做不到淡入——CSS 过渡对刚插进 DOM 的元素不生效
          （没有"变化前"的样式可比），第一次 hover 必然是"啪"地弹出。常驻之后加类才是一次真正的过渡。
          指针从一个人直接滑到另一个人也顺带解决了：那是两张卡片各自淡出、淡入，
          不需要定时器等旧内容退场，也不用去过渡位置——每张卡的位置是它自己的定值，
          正好绕开"左半边用 left、右半边用 right，两个属性之间没法插值"这个死结。
          抽完之前整份位置数组还是空的，所以下面既要挡 undefined（还没抽完）也要挡 null
          （抽完了但这个人没抠出包围盒，卡片摆哪无从算起）——两种情况都不渲染这一张。

          aria-hidden 是有意的：整块内容只有 hover 得到的人看得见，读屏和键盘用户本来就到不了，
          留在无障碍树里只会变成一段没有上下文、还会随指针来回出现的游离文字。
          TODO：角色文案从占位换成真设定之后，这些信息就不能只挂在 hover 上了，
          得另给一个可聚焦、触屏也点得到的入口（比如"图鉴"页），那时再把这里接进无障碍树。
        */}
        {CAST.map((member, index) => {
          const panelStyle = castPanelStyles[index]
          if (panelStyle === undefined || panelStyle === null) return null
          return (
            <aside
              key={member.file}
              className={`home__cast-panel${hoveredCast === index ? ' is-open' : ''}`}
              style={panelStyle}
              aria-hidden="true"
            >
              <span className="home__cast-panel-kicker">角色档案</span>
              <span className="home__cast-panel-name">{member.name}</span>
              {/* 分隔线和副标题两侧那组花饰共用 .home__flourish 的零件，只是把线和星改小一档、
                  星色调淡（覆盖的三个变量见 styles.css 的 .home__cast-panel-rule）。 */}
              <span className="home__flourish home__cast-panel-rule">
                <i className="home__flourish-line" />
                <Sparkle className="home__flourish-star" />
                <i className="home__flourish-line home__flourish-line--right" />
              </span>
              <span className="home__cast-panel-section-label">人物</span>
              <p className="home__cast-panel-copy">{member.intro}</p>
              <span className="home__cast-panel-section-label">技能 · {member.skillName}</span>
              <p className="home__cast-panel-copy">{member.skillEffect}</p>
              <p className="home__cast-panel-role">{member.role}</p>
            </aside>
          )
        })}
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
