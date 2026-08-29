import type { HandCardData } from '../ui/HandFan'
import { HandCardFace } from '../ui/HandFan'

interface SkillCardHoverPreviewProps {
  card: HandCardData
}

/**
 * 技能牌悬停预览。
 *
 * 正面继续复用真实卡面组件，背面的边框只是一张底图；名称和效果由当前卡牌数据覆盖在中央，
 * 因此新增技能或调整文案时不需要再生成一张新的背面图片。
 */
export function SkillCardHoverPreview({ card }: SkillCardHoverPreviewProps) {
  const longCopy = card.text.length > 42

  return (
    <aside className="deck-skill-preview" role="tooltip" aria-label={`${card.name}正反面预览`}>
      <figure className="deck-skill-preview__side">
        <div className="deck-skill-preview__card">
          <HandCardFace card={card} />
        </div>
        <figcaption>正面</figcaption>
      </figure>

      <figure className="deck-skill-preview__side">
        <div className="deck-skill-back" data-copy-size={longCopy ? 'long' : 'normal'}>
          <img
            className="deck-skill-back__frame"
            src="/cards/skills/skill-card-back.jpg"
            alt=""
            draggable={false}
          />
          <div className="deck-skill-back__content">
            <span className="deck-skill-back__eyebrow">技能说明</span>
            <h2 className="deck-skill-back__title">{card.name}</h2>
            <span className="deck-skill-back__divider" aria-hidden="true">
              ✦
            </span>
            <p className="deck-skill-back__effect">{card.text}</p>
          </div>
        </div>
        <figcaption>背面</figcaption>
      </figure>
    </aside>
  )
}
