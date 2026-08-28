/**
 * 开发页导航（/dev）。
 *
 * 开发页都是直接敲地址进的，正式流程里没有入口，路径全靠记。这一页把它们收在一处，
 * 记一个 /dev 就够了。页面本身没有逻辑，只是一张表。
 *
 * 唯一特殊的是「测试对局」：它不是一条能直接敲的地址，得先建一局本地对局塞进 MatchSession
 * 再跳 /match（测试房和联机共用同一套对局界面，见 docs/architecture.md 5.1）。
 *
 * 新增开发页时往 ENTRIES 里补一条，否则这一页就又开始漏了。
 */

import { useLocation } from 'wouter'
import { useMatchSession } from '../match/MatchSession'
import { createTestMatchDriver } from '../match/testMatch'

interface DevEntry {
  /** 卡片上那行等宽小字，也是点下去最终停在的路由。 */
  path: string
  title: string
  desc: string
  /** 进去之前要先建 driver 的项打这个标记，其余的直接 navigate(path)。 */
  action?: 'test-match'
}

const ENTRIES: DevEntry[] = [
  {
    path: '/design',
    title: '设计参考页',
    desc: '纸面视觉元素的样板间：纸纹、按钮、图标、卡牌、卡背连同「为什么调成这个值」的说明，页首还挂着纸纹调参面板。',
  },
  {
    path: '/deck',
    title: '组建牌组 demo',
    desc: '假卡池 + 选卡手势：圆圈加减、卡池和牌组之间拖拽、点开放大查看。牌组不落盘也进不了对局，真卡池落地后重做。',
  },
  {
    path: '/card',
    title: '卡牌图鉴 / 卡面调试',
    desc: '左栏列出全部卡牌的缩略卡面，右栏是选中那张的真实尺寸正反面加卡面之外的字段和原始 JSON，用的就是对局里那套卡面组件，改卡面排版时用来对照。',
  },
  {
    path: '/loader',
    title: '加载动画演示',
    desc: 'CardLoader 的各档 size / speed / 颜色摆在一起对比，最后一格换成纸色底，验证这套线框在浅色背景上同样成立。',
  },
  {
    path: '/match',
    title: '测试对局',
    desc: '就地建一局本地对局再跳进对局界面：对方手牌摊开可点（替对方出牌）、底下挂测试面板、结算不记胜场。',
    action: 'test-match',
  },
]

export function DevIndex() {
  const [, navigate] = useLocation()
  const session = useMatchSession()

  function open(entry: DevEntry) {
    if (entry.action === 'test-match') {
      session.start(createTestMatchDriver(), { test: true })
    }
    navigate(entry.path)
  }

  return (
    <div className="dev-index">
      <header className="dev-index__header">
        <h1 className="dev-index__title">开发页</h1>
        <p className="dev-index__lead">
          正式流程里没有这些入口，它们只服务开发。改视觉、改卡面、改对局流程之前先来这里挑一页。
        </p>
      </header>

      <div className="dev-index__grid">
        {ENTRIES.map((entry) => (
          <button
            type="button"
            className="dev-index__item"
            key={entry.title}
            onClick={() => open(entry)}
          >
            <span className="dev-index__item-path">{entry.path}</span>
            <span className="dev-index__item-title">{entry.title}</span>
            <span className="dev-index__item-desc">{entry.desc}</span>
          </button>
        ))}
      </div>

      <button type="button" className="dev-index__back" onClick={() => navigate('/')}>
        回首页
      </button>
    </div>
  )
}
