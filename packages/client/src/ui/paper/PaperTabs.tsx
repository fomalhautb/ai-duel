export type PaperTabsProps = {
  items: string[]
  /** 当前项的下标 */
  active: number
  /** 不传就是纯展示，点了不会有任何反应 */
  onChange?: (index: number) => void
}

/**
 * 顶栏 tab：当前项下方一条赭红短横线，横线两个端点各一颗小菱形。
 *
 * 每一项用 <button> 而不是 <span>：键盘能 Tab 过去、回车能选中，
 * 屏幕阅读器也读得出这是可选的。样式里已经把浏览器自带的按钮外观清掉了。
 */
export function PaperTabs({ items, active, onChange }: PaperTabsProps) {
  return (
    <div className="paper-tabs" role="tablist">
      {items.map((label, i) => {
        const isActive = i === active
        return (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`paper-tab ${isActive ? 'paper-tab--active' : ''}`.trim()}
            onClick={() => onChange?.(i)}
          >
            {label}
            <i className="paper-tab__ul" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
