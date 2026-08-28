/** 轮次和比分中间那颗小菱形，纯装饰。 */
function DiamondMark() {
  return (
    <svg className="battle-topbar__diamond" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 .6 11.4 6 6 11.4.6 6Z" />
    </svg>
  )
}

export interface BattleTopBarProps {
  /**
   * 顶栏正中那块「第几轮 + 比分」。局面还没到手时（联机客人在等房主开局）不传，
   * 顶栏就整条空着。
   */
  status?: {
    round: number
    myScore: number
    foeScore: number
  }
}

export function BattleTopBar({ status }: BattleTopBarProps) {
  return (
    <header className="battle-topbar">
      {/* 手册和设置图标撤掉之后顶栏只剩这一块，所以它铺满整条顶栏、内容自己居中。
          没有 status 时这里什么都不渲染也不会让下面的战场往上跳：
          顶栏高度是 .battle 网格里写死的 --battle-topbar-h，和有没有内容无关。 */}
      {status === undefined ? null : (
        <div className="battle-topbar__status">
          <span className="battle-topbar__round">
            第 <span className="battle-topbar__round-num">{status.round}</span> 轮
          </span>
          <DiamondMark />
          <span className="battle-topbar__score">
            <span className="battle-topbar__score-side">我方</span>
            <span className="battle-topbar__score-num">{status.myScore}</span>
            <span className="battle-topbar__score-colon">:</span>
            <span className="battle-topbar__score-num">{status.foeScore}</span>
            <span className="battle-topbar__score-side">对方</span>
          </span>
        </div>
      )}
    </header>
  )
}
