/**
 * 关于本作（/info）。首页导航「信息」那一项进来。
 *
 * 内容只回答「这东西是谁做的、哪来的」：团队名单和黑客松出处。
 * 玩法不写在这儿——首页和对局里自会说明。
 * 之所以做成页面而不是写进 README 就算：README 只有翻到 GitHub 的人看得到，
 * 而这一页是玩家在游戏里能点到的唯一出处说明。
 *
 * 版式和首页是同一套路：一张 16:9 的背景图当"舞台"塞进视口居中，舞台内所有尺寸用 cqi
 * （1cqi = 舞台宽的 1%），窗口怎么变都只是整体等比缩放，不写断点。
 *
 * 字号只有两档：页面标题一档，其余所有文字（作品名那行稍大一点除外）共用 .info__line。
 * 加新内容时也用这一档，别再开新样式——这一页的信息量撑不起更多层级。
 *
 * **金框和三处星饰都画在背景图里**，代码一个都没画。所以下面每一块文字的位置都是
 * 照着图里那些元素的实测比例定的，不能随便挪：
 *   - 框顶 27.6%、框底 84.4%、左右 20.5% / 79.4%；
 *   - 框上方那颗大星饰在 23%，标题要落在它上面；
 *   - 框内那道小花饰在 68.8%，正文块必须收在它之前；
 *   - 花饰下面左右两颗小星在 74.6%（x 37.5% 和 62.5%），结尾那句就摆在它们中间。
 * 换背景图就得重新量这几个数（量法：把图里金色像素扫一遍取包围盒）。
 */

import { useLocation } from 'wouter'
import { BackButton } from '../ui/BackButton'
import { LoadingScreen } from '../ui/LoadingScreen'
import { useAssetsProgress } from '../ui/preloadAssets'
import './info.css'

/** 团队名单，不写分工——四个人的活儿是混着干的。 */
const TEAM = ['石在', '司马冰清', '刘利剑', '叶丁元']

const BACKGROUND = '/info/info-bg.webp'

/**
 * 这一页要用到的全部图片，就一张背景。
 *
 * 必须是模块级常量：useAssetsProgress 拿它当 effect 依赖，每次渲染现拼一个新数组会让 effect 反复重跑。
 *
 * 导出是给 ui/backgroundPreload.ts 用的：后台预加载要照着同一份清单排队，
 * 两边各写一遍迟早会对不上。
 */
export const INFO_ASSETS = [BACKGROUND]

export function InfoScreen() {
  // 整页就压在这一张背景图上，它没到位的话文字会先浮在一片空底上，所以等它加载完再上场。
  const assets = useAssetsProgress(INFO_ASSETS)
  return assets.ready ? <InfoStage /> : <LoadingScreen progress={assets.progress} />
}

function InfoStage() {
  const [, navigate] = useLocation()

  return (
    <div className="info">
      <div className="info__stage">
        <img className="info__bg" src={BACKGROUND} alt="" draggable={false} />

        <BackButton className="info__back" onClick={() => navigate('/')} />

        <h1 className="info__title">开发者信息</h1>

        {/* 金框里那块正文。上边界躲开框顶，下边界收在框内那道小花饰之前。 */}
        <div className="info__body">
          <p className="info__lead">出牌吧！AI！ 开发团队</p>
          <p className="info__line">{TEAM.join(' · ')}</p>
          <p className="info__line">SheNicest 2026 年 8 月黑客松 · 五天之内完成</p>
        </div>

        {/* 收尾那句，摆在背景图里左右两颗小星中间。 */}
        <p className="info__line info__thanks">感谢你的游玩与支持</p>
      </div>
    </div>
  )
}
