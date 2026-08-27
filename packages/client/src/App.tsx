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
import { TutorialScreen } from './screens/TutorialScreen'
import { RoomScreen } from './screens/RoomScreen'
import { MatchScreen } from './screens/MatchScreen'
import { HandDemo } from './dev/HandDemo'

export function App() {
  return (
    <MatchSessionProvider>
      <Switch>
        <Route path="/" component={HomeScreen} />
        <Route path="/tutorial/:level">
          {(params) => <TutorialScreen level={Number(params.level)} />}
        </Route>
        <Route path="/room" component={RoomScreen} />
        <Route path="/match" component={MatchScreen} />
        {/* 动画调试页。原来走 ?demo=hand，现在归到 /dev 下面。 */}
        <Route path="/dev/hand" component={HandDemo} />
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
