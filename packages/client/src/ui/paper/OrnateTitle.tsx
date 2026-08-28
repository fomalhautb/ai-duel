import type { ReactNode } from 'react'

export type OrnateTitleProps = {
  children: ReactNode
  /** 小号：字更小、字距更宽，用在「卡牌详情」这类次级标题上 */
  small?: boolean
  /** 渲染成哪个标签。默认 h2；纯装饰或已经有别的标题层级时传 'div' */
  as?: 'h2' | 'h3' | 'div'
  className?: string
}

/**
 * 区块标题装饰：文字两侧各一段细线，线的外端点各一个小菱形。
 *
 * 节点顺序写死为 菱形 — 线 — 文字 — 线 — 菱形。细线是 flex: 1 撑开的，
 * 菱形必须排在线的外侧才会落在端点上，顺序调换就会挤到文字旁边。
 *
 * 标签可换是因为它既当页面区块标题（h2/h3，进大纲），也当侧栏「卡牌详情」
 * 那种纯装饰小标题（div，不该进大纲）。
 */
export function OrnateTitle({ children, small, as = 'h2', className = '' }: OrnateTitleProps) {
  const Tag = as
  return (
    <Tag
      className={`paper-orn-title ${small ? 'paper-orn-title--sm' : ''} ${className}`
        .replace(/\s+/g, ' ')
        .trim()}
    >
      <i className="paper-orn-title__dia" aria-hidden="true" />
      <span className="paper-orn-title__ln" aria-hidden="true" />
      <span className="paper-orn-title__tx">{children}</span>
      <span className="paper-orn-title__ln" aria-hidden="true" />
      <i className="paper-orn-title__dia" aria-hidden="true" />
    </Tag>
  )
}
