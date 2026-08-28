/** 轮次和比分中间那颗小菱形，纯装饰。 */
function DiamondMark() {
  return (
    <svg className="battle-topbar__diamond" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 .6 11.4 6 6 11.4.6 6Z" />
    </svg>
  )
}

function BookIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4.5 6.5c4.7-1.2 8.1-.2 11.5 2.6v17.4c-3.4-2.8-6.8-3.8-11.5-2.6V6.5Zm23 0c-4.7-1.2-8.1-.2-11.5 2.6v17.4c3.4-2.8 6.8-3.8 11.5-2.6V6.5Z" />
      <path d="M8 10.5c2.5-.2 4.4.4 6.1 1.7M8 14c2.5-.2 4.4.4 6.1 1.7M24 10.5c-2.5-.2-4.4.4-6.1 1.7M24 14c-2.5-.2-4.4.4-6.1 1.7" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="m12.6 5.2.9-2.7h5l.9 2.7 2.2.9 2.5-1.3 3.5 3.5-1.3 2.5.9 2.2 2.7.9v5l-2.7.9-.9 2.2 1.3 2.5-3.5 3.5-2.5-1.3-2.2.9-.9 2.7h-5l-.9-2.7-2.2-.9-2.5 1.3-3.5-3.5L5.7 21l-.9-2.2-2.7-.9v-5l2.7-.9.9-2.2-1.3-2.5 3.5-3.5 2.5 1.3 2.2-.9Z" />
      <circle cx="16" cy="15.4" r="4.3" />
    </svg>
  )
}

export interface BattleTopBarProps {
  /**
   * 顶栏正中那块「第几轮 + 比分」。局面还没到手时（联机客人在等房主开局）不传，
   * 这块留空。
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
      {/* 左侧留白：顶栏靠三栏网格让中间那块居中显示，撤掉品牌区后仍需占位保持对齐 */}
      <div className="battle-topbar__brand" aria-hidden="true" />

      {/* 没有 status 时这个 div 也照样渲染：顶栏是「左 / 中 / 右」三列网格，
          少一个子元素的话右边那组图标按钮会被自动排进中间那列。 */}
      <div className="battle-topbar__status">
        {status === undefined ? null : (
          <>
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
          </>
        )}
      </div>

      <div className="battle-topbar__actions">
        <button className="battle-topbar__icon-button" type="button" aria-label="规则手册">
          <BookIcon />
        </button>
        <button className="battle-topbar__icon-button" type="button" aria-label="设置">
          <SettingsIcon />
        </button>
      </div>
    </header>
  )
}
