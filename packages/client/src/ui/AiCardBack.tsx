import type { CSSProperties } from 'react'
import { AI_CARD_BACK_ART } from './cardArt'
import { AI_MODEL_FACE } from './aiModelFace'
import './aiCardBack.css'

export interface AiCardBackData {
  id: string
  definitionId?: string
  name: string
  skillName?: string
  skillText?: string
}

/**
 * 玩家主动翻开 AI 牌时看到的详情背面。
 *
 * 对手手牌和牌堆仍使用 CardBackHidden：那是用来隐藏牌面身份的卡背，不能把名称和技能泄露出去。
 * 这里保留同一张星图底图，只在中央叠一块纸面详情，让对局、组卡页和图鉴共用同一份排版。
 */
export function AiCardBack({ card }: { card: AiCardBackData }) {
  const definitionId = card.definitionId ?? card.id
  const accent = AI_MODEL_FACE[definitionId]?.accent ?? '#46584b'
  const skillName = card.skillName ?? '技能待定'
  const skillText = card.skillText ?? '技能效果待补充'

  return (
    <div
      className="ai-card-back"
      style={{ '--card-accent': accent } as CSSProperties}
      role="img"
      aria-label={`${card.name}。${skillName}：${skillText}`}
    >
      <img className="ai-card-back__art" src={AI_CARD_BACK_ART} alt="" draggable={false} />
      <div className="ai-card-back__panel grain">
        <span className="ai-card-back__eyebrow">AI AGENT</span>
        <strong className="ai-card-back__name">{card.name}</strong>
        <span className="ai-card-back__divider" aria-hidden="true" />
        <strong className="ai-card-back__skill">{skillName}</strong>
        <p className="ai-card-back__effect">{skillText}</p>
      </div>
    </div>
  )
}
