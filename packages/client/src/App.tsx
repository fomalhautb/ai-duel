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
import { TouchDeviceNotice } from './ui/TouchDeviceNotice'
import { HomeScreen } from './screens/HomeScreen'
import { HeroScreen } from './screens/HeroScreen'
import { RoomScreen } from './screens/RoomScreen'
import { MatchScreen } from './screens/MatchScreen'
import { DesignScreen } from './screens/DesignScreen'
import { DeckScreen } from './screens/DeckScreen'
import { CardGallery } from './dev/CardGallery'
import { DevIndex } from './dev/DevIndex'
import { LoaderDemo } from './dev/LoaderDemo'

/** 没有 requestIdleCallback 时的退让时长：等这么久再开始后台加载。 */
const IDLE_FALLBACK_MS = 1000

export function App() {
  useBackgroundPreload()

  return (
    <MatchSessionProvider>
      {/* 触屏设备的一次性提示，盖在所有页面之上（自己判定要不要显示）。 */}
      <TouchDeviceNotice />
      <Switch>
        <Route path="/" component={HomeScreen} />
        {/* 选择英雄界面：照设计稿复原的纯 UI demo，选中态和动画都在，但没接对局——
            点「确认英雄」只播一段光效，不跳转也不落任何状态。首页的「英雄」导航项仍是敬请期待。 */}
        <Route path="/hero" component={HeroScreen} />
        <Route path="/room" component={RoomScreen} />
        {/* 联机对局和 dev 测试房共用这一个路由，区别只在 MatchSession 里放的是哪种 driver。 */}
        <Route path="/match" component={MatchScreen} />
        {/* 开发页导航，集中收录调试入口。 */}
        <Route path="/dev" component={DevIndex} />
        {/* 设计参考页，纸面元素的样板间。 */}
        <Route path="/design" component={DesignScreen} />
        {/* 组建牌组的交互 demo 页：卡池用的是 screens/deckDemoCards.ts 里那批假卡，
            选出来的牌组不落盘也进不了对局，只用来跑通选卡的手势和版式。真卡池落地后重做。 */}
        <Route path="/deck" component={DeckScreen} />
        {/* 卡牌图鉴 / 卡面调试页：左栏列出全部卡牌的缩略卡面，右栏是选中那张的真实尺寸正反面
            加卡面之外的字段，改卡面排版时用来对照，也方便和协作的 AI 隔着屏幕指同一张卡。 */}
        <Route path="/card" component={CardGallery} />
        {/* 加载动画的演示/调参页：各档 size、speed、颜色和浅色底一起摆开对比。
            没跟着放进 /dev：这个 loader 是要给真实加载场景用的，
            短路径方便随手打开对着看，也方便之后直接当"正在加载"的空页复用。 */}
        <Route path="/loader" component={LoaderDemo} />
        <Route component={NotFound} />
      </Switch>
    </MatchSessionProvider>
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
