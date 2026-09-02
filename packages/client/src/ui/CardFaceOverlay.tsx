import type { CSSProperties } from 'react'
import { CardCostBadge } from './CardCostBadge'
import './cardFaceOverlay.css'

export interface CardFaceOverlayProps {
  cost: number
  skillName: string
  name: string
  /** 使用插画的主色；可传十六进制颜色或 /design 的 CSS 色板变量。 */
  accent?: string
  /**
   * 费用圆章的圆心（百分比，见 aiModelFace.ts 的 costBadge）。直径全场统一，不由这里给。
   * 不传就按 CSS 里的默认位置摆，用于没有专属原画的场合（比如 /design 的样例卡）。
   */
  costBadge?: { x: number; y: number }
}

/** 让长名称完整留在铭牌内，不依赖测量 DOM，也不在手牌动画期间重新排版。 */
function nameWidth(name: string): number {
  const units = Array.from(name).reduce((sum, char) => sum + (/^[\x00-\x7F]$/.test(char) ? 0.6 : 1), 0)
  return Math.min(610, units * 76)
}

/**
 * 与插画分离的正面图层。费用章单独保持正圆，铭牌按卡宽缩放，兼容 2:3 的手牌和原图。
 * 只装饰边框，不给文字套手绘滤镜，缩成手牌时仍能辨认费用和名称。
 */
export function CardFaceOverlay({
  cost,
  skillName,
  name,
  accent = 'var(--c-green)',
  costBadge,
}: CardFaceOverlayProps) {
  return (
    <div className="card-overlay" style={{ '--card-accent': accent } as CSSProperties}>
      <CardCostBadge cost={cost} center={costBadge} />

      <div className="card-overlay__plaque">
        <div className="card-overlay__paper grain" aria-hidden="true" />
        <svg className="card-overlay__frame" viewBox="0 0 760 230" preserveAspectRatio="none" aria-hidden="true">
          <path className="card-overlay__frame-shadow" d="M90 17H347Q368 17 380 4Q392 17 413 17H670Q714 17 714 53Q748 66 748 115Q748 164 714 177Q714 213 670 213H413Q392 213 380 226Q368 213 347 213H90Q46 213 46 177Q12 164 12 115Q12 66 46 53Q46 17 90 17Z" />
          <path className="card-overlay__rim" strokeWidth="3" d="M90 17H347Q368 17 380 4Q392 17 413 17H670Q714 17 714 53Q748 66 748 115Q748 164 714 177Q714 213 670 213H413Q392 213 380 226Q368 213 347 213H90Q46 213 46 177Q12 164 12 115Q12 66 46 53Q46 17 90 17Z" />
          <path className="card-overlay__rim-light" strokeWidth="2" d="M90 23H347Q368 23 380 12Q392 23 413 23H670Q707 23 707 58Q741 72 741 115Q741 158 707 172Q707 207 670 207H413Q392 207 380 218Q368 207 347 207H90Q53 207 53 172Q19 158 19 115Q19 72 53 58Q53 23 90 23Z" />
          <path className="card-overlay__rim" strokeWidth="1.5" d="M93 31H347Q368 31 380 21Q392 31 413 31H667Q697 31 697 65Q730 78 730 115Q730 152 697 165Q697 199 667 199H413Q392 199 380 209Q368 199 347 199H93Q63 199 63 165Q30 152 30 115Q30 78 63 65Q63 31 93 31Z" />
          <g className="card-overlay__flourish">
            <path d="M54 84C15 70 20 42 37 49C51 57 34 68 28 60M54 146C15 160 20 188 37 181C51 173 34 162 28 170M706 84C745 70 740 42 723 49C709 57 726 68 732 60M706 146C745 160 740 188 723 181C709 173 726 162 732 170" />
            <path d="M87 30C65 13 50 36 65 41C76 45 78 33 73 31M673 30C695 13 710 36 695 41C684 45 682 33 687 31M87 200C65 217 50 194 65 189C76 185 78 197 73 199M673 200C695 217 710 194 695 189C684 185 682 197 687 199" />
            <path d="M373 20L380 10L387 20L380 31ZM373 210L380 200L387 210L380 220Z" />
          </g>
        </svg>
        <svg className="card-overlay__lettering" viewBox="0 0 760 230" role="img" aria-label={`${skillName} · ${name}`}>
          <text className="card-overlay__skill" x="380" y="89" textAnchor="middle"
            textLength={Math.min(560, Array.from(skillName).length * 43)} lengthAdjust="spacingAndGlyphs">{skillName}</text>
          <text className="card-overlay__name" x="380" y="171" textAnchor="middle"
            textLength={nameWidth(name)} lengthAdjust="spacingAndGlyphs">{name}</text>
        </svg>
      </div>
    </div>
  )
}
