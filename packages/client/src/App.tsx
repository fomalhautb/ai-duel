/**
 * 路由表 + 全局壳。这里是唯一列出全部界面的地方。
 *
 * 用 wouter 而不是 react-router：整个应用只有几个静态页面加一个 :level 参数，
 * 用不上 loader / data API 那一套。它的 API 是 react-router 的子集，将来要换基本只改 import。
 *
 * MatchSessionProvider 挂在路由外面，对局才跨得过"房间页 → 对局页"那次跳转。
 * 它不写 localStorage，所以刷新页面这局就没了——和架构文档"不存对局"一致。
 */

import { Route, Switch, useLocation } from 'wouter'
import { MatchSessionProvider } from './match/MatchSession'
import { HomeScreen } from './screens/HomeScreen'
import { RoomScreen } from './screens/RoomScreen'
import { MatchScreen } from './screens/MatchScreen'
import { DesignScreen } from './screens/DesignScreen'
import { DeckScreen } from './screens/DeckScreen'
import { CardGallery } from './dev/CardGallery'
import { DevIndex } from './dev/DevIndex'
import { LoaderDemo } from './dev/LoaderDemo'

export function App() {
  return (
    <MatchSessionProvider>
      <Switch>
        <Route path="/" component={HomeScreen} />
        <Route path="/room" component={RoomScreen} />
        {/* 联机对局和 dev 测试房共用这一个路由，区别只在 MatchSession 里放的是哪种 driver。 */}
        <Route path="/match" component={MatchScreen} />
        {/* 开发页导航：下面这几个开发页正式流程里都没有入口，这一页把它们列在一处。 */}
        <Route path="/dev" component={DevIndex} />
        {/* 设计参考页，纸面元素的样板间。 */}
        <Route path="/design" component={DesignScreen} />
        {/* 组建牌组的交互 demo 页：卡池用的是 screens/deckDemoCards.ts 里那批假卡，
            选出来的牌组不落盘也进不了对局，只用来跑通选卡的手势和版式。真卡池落地后重做。 */}
        <Route path="/deck" component={DeckScreen} />
        {/* 卡牌图鉴 / 卡面调试页：左栏列出全部卡牌的缩略卡面，右栏是选中那张的真实尺寸正反面
            加全部数值，改卡面排版时用来对照，也方便和协作的 AI 隔着屏幕指同一张卡。 */}
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
