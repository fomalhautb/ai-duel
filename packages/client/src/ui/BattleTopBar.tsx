function ConstellationMark() {
  return (
    <svg className="battle-topbar__constellation" viewBox="0 0 54 30" aria-hidden="true">
      <path d="M4 26 19 10l14-7 17 16" />
      <circle cx="4" cy="26" r="2" />
      <circle cx="19" cy="10" r="2" />
      <circle cx="33" cy="3" r="2" />
      <circle cx="50" cy="19" r="2" />
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

export function BattleTopBar() {
  return (
    <header className="battle-topbar">
      <div className="battle-topbar__brand" aria-label="斗 AI">
        <span className="battle-topbar__brand-cn">斗</span>
        <span className="battle-topbar__brand-ai">AI</span>
        <ConstellationMark />
      </div>

      <nav className="battle-topbar__nav" aria-label="主导航">
        <button className="battle-topbar__tab is-active" type="button" aria-current="page">
          对战
        </button>
        <button className="battle-topbar__tab" type="button">
          牌组
        </button>
        <button className="battle-topbar__tab" type="button">
          图鉴
        </button>
      </nav>

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
