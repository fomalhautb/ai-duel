/**
 * 路由表 + 全局壳。这里是唯一列出全部界面的地方。
 *
 * 用 wouter 而不是 react-router：整个应用只有几个静态页面加一个 :level 参数，
 * 用不上 loader / data API 那一套。它的 API 是 react-router 的子集，将来要换基本只改 import。
 *
 * MatchSessionProvider 挂在路由外面，对局才跨得过"房间页 → 对局页"那次跳转。
 * 它不写 localStorage，所以刷新页面这局就没了——和架构文档"不存对局"一致。
 */

import { useEffect } from 'react'
import { Route, Switch, useLocation } from 'wouter'
import { MatchSessionProvider } from './match/MatchSession'
import { startBackgroundPreload } from './ui/backgroundPreload'
import { OrientationNotice } from './ui/OrientationNotice'
import { FullscreenEntry } from './ui/FullscreenEntry'
import { HomeScreen } from './screens/HomeScreen'
import { InfoScreen } from './screens/InfoScreen'
import { HeroScreen } from './screens/HeroScreen'
import { RoomScreen } from './screens/RoomScreen'
import { MatchScreen } from './screens/MatchScreen'
import { TutorialScreen } from './screens/TutorialScreen'
import { DesignScreen } from './screens/DesignScreen'
import { DeckScreen } from './screens/DeckScreen'
import { GenerationScreen } from './screens/GenerationScreen'
import { SettleTestScreen } from './screens/SettleTestScreen'
import { CardGallery } from './dev/CardGallery'
import { DevIndex } from './dev/DevIndex'
import { LoaderDemo } from './dev/LoaderDemo'
import { ResultDemo } from './dev/ResultDemo'
import { loadSave, saveHero } from './save/save'
import { useBackgroundMusic } from './ui/backgroundMusic'

/** 没有 requestIdleCallback 时的退让时长：等这么久再开始后台加载。 */
const IDLE_FALLBACK_MS = 1000

export function App() {
  useBackgroundPreload()

  return (
    <MatchSessionProvider>
      {/* 竖屏时盖在所有页面之上的「请横屏」提示，自己判定要不要显示。 */}
      <OrientationNotice />
      {/* 手机上常驻的全屏入口：画面边上那颗小按钮，iOS 上还带一份「添加到主屏幕」引导。
          和上面一样自己判定要不要显示，桌面上不出现。 */}
      <FullscreenEntry />
      <Switch>
        <Route path="/" component={HomeScreen} />
        {/* 关于本作：黑客松出处、团队名单、外链。首页导航「信息」那一项进来。 */}
        <Route path="/info" component={InfoScreen} />
        {/* 选择英雄的独立入口，见下面 HeroRoute。对局流程里的那一步在 /room 里，不走这条路由。 */}
        <Route path="/hero" component={HeroRoute} />
        {/* 匹配房。整条「匹配 → 选卡组 → 选英雄 → 开局」都在这一个组件里，
            因为选择期间房间连接必须一直活着，换路由就等于换房间码（见 RoomScreen 文件头）。 */}
        <Route path="/room" component={RoomScreen} />
        {/* 联机对局和 dev 测试房共用这一个路由，区别只在 MatchSession 里放的是哪种 driver。 */}
        <Route path="/match" component={MatchScreen} />
        {/* 新手教程的教学对战。自己建 driver、自己收，不进 MatchSession，也不记胜场
            （教学局是写死结局的剧本）。组牌 / 选英雄 / 完成页是后面接的另一段。 */}
        <Route path="/tutorial" component={TutorialScreen} />
        {/* 开发页导航，集中收录调试入口。 */}
        <Route path="/dev" component={DevIndex} />
        {/* 设计参考页，纸面元素的样板间。 */}
        <Route path="/design" component={DesignScreen} />
        {/* 组建牌组的独立入口，见下面 DeckRoute。 */}
        <Route path="/deck" component={DeckRoute} />
        {/* 卡牌图鉴 / 卡面调试页：左栏列出全部卡牌的缩略卡面，右栏是选中那张的真实尺寸正反面
            加卡面之外的字段，改卡面排版时用来对照，也方便和协作的 AI 隔着屏幕指同一张卡。 */}
        <Route path="/card" component={CardGallery} />
        {/* 加载动画的演示/调参页：各档 size、speed、颜色和浅色底一起摆开对比。
            没跟着放进 /dev：这个 loader 是要给真实加载场景用的，
            短路径方便随手打开对着看，也方便之后直接当"正在加载"的空页复用。 */}
        <Route path="/loader" component={LoaderDemo} />
        {/* 回合结算界面的独立测试页：把结算层单独放进对局舞台里，
            按钮直接摆出各种结果分支（答对数取胜 / 消耗决胜 / 打平 / 对方赢 / 空场），
            不用打完整一局就能反复看那一整套动画。 */}
        <Route path="/test" component={SettleTestScreen} />
        {/* 终局结算界面调试页：胜/负/平/中断四种结果加可改的比分，套在和对局同样的 16:9 舞台里，
            省得为了调结算版式真去打完一局。和上面的 /test 分工：这里调"整局打完"的底板，
            那里调"每一轮答完"的结算层。 */}
        <Route path="/result" component={ResultDemo} />
        {/* 预生成答题结果对照页：把离线跑好的「模型 × 题目 × 技能」结果摊成一张表，
            用来看哪张技能卡真的把模型带偏了。数据是构建期生成的静态 JSON，不联网。 */}
        <Route path="/generation" component={GenerationScreen} />
        <Route component={NotFound} />
      </Switch>
    </MatchSessionProvider>
  )
}

/*
 * /deck 和 /hero 这两条路由是**独立入口**，留给视觉迭代：敲个短地址就能单独打开这一页调样式，
 * 不用先凑够两台机器匹配上。正式流程里的选卡组 / 选英雄不经过这里，它们是 RoomScreen 的两个阶段。
 *
 * 两个页面本身都是受控组件（不导航），所以这两条薄包装负责把它们接回首页。
 *
 * 两页的存档口径不一样：选牌页每改一张牌就自己写 save/deckStore.ts，所以这里确认时无事可做，
 * 只管跳转；选英雄页不写存档，确认后由这里 saveHero，下次匹配时 RoomScreen 拿它预填。
 */
function DeckRoute() {
  const [, navigate] = useLocation()
  useBackgroundMusic('cardsSelecting')
  return <DeckScreen onConfirm={() => navigate('/')} onBack={() => navigate('/')} />
}

function HeroRoute() {
  const [, navigate] = useLocation()
  useBackgroundMusic('cardsSelecting')
  return (
    <HeroScreen
      initialHeroId={loadSave().savedHero}
      onConfirm={(hero) => {
        saveHero(hero)
        navigate('/')
      }}
      onBack={() => navigate('/')}
    />
  )
}

/**
 * 挑一个不打扰首页的时机，开始后台预加载剩下的素材。
 *
 * 为什么要等 load 事件：index.html 里给首页的关键图写了 <link rel="preload">，
 * 玩家这会儿正盯着 loader 等它们。这时候再插进去几十张后台图，会和它们抢同一批连接，
 * 首页反而更晚出来。load 事件的含义正好是"页面自己的资源都下完了"，从这一刻起带宽才是空的。
 *
 * 再等一个 idle：load 之后紧接着是首页的入场动画和 GSAP 初始化，
 * 挑浏览器闲下来的那一帧再开始，图片解码就不会插在动画中间掉帧。
 */
function useBackgroundPreload(): void {
  useEffect(() => {
    let cancel: (() => void) | undefined

    function schedule(): void {
      // requestIdleCallback 在 Safari 16.4 之前没有，退回定时器等一秒——
      // 差别只是开始得早一点晚一点，反正后面的加载本来就是慢慢来的。
      if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(() => startBackgroundPreload())
        cancel = () => cancelIdleCallback(handle)
      } else {
        const handle = window.setTimeout(startBackgroundPreload, IDLE_FALLBACK_MS)
        cancel = () => window.clearTimeout(handle)
      }
    }

    // 从别的页面回到这里时 App 早就挂载过了，load 事件不会再来，所以要先查一次状态。
    if (document.readyState === 'complete') {
      schedule()
    } else {
      window.addEventListener('load', schedule, { once: true })
      cancel = () => window.removeEventListener('load', schedule)
    }

    // schedule 跑过之后 cancel 会被换成取消 idle 回调的那个，load 监听器 once 已经自己摘了。
    return () => cancel?.()
  }, [])
}

function NotFound() {
  const [location, navigate] = useLocation()
  return (
    <main className="page">
      <h1>没有这个页面</h1>
      <p className="page__muted">{location}</p>
      <button type="button" onClick={() => navigate('/')}>
        回首页
      </button>
    </main>
  )
}
