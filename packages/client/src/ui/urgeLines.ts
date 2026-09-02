/**
 * 「催一催」的四句喊话。
 *
 * 单独一个模块而不是并进 soundEffects：net/protocol 要拿 UrgeId 当消息字段的类型
 * （只 import type，不会把音频那一套牵进转发层），气泡也要拿这里的文字。
 *
 * text 就是录音里念的那句话，两者必须对得上——气泡是给听不清或没开声音的人看的字幕。
 */

export interface UrgeLine {
  id: UrgeId
  /** 对应 SOUND_EFFECT_SOURCE 里的键。 */
  effect: 'urgeCanYouDoIt' | 'urgeHurryUp' | 'urgeComeOn' | 'urgeQuestionAi'
  /** 录音内容的文字版，直接显示在气泡里。 */
  text: string
}

export type UrgeId = 'canYouDoIt' | 'hurryUp' | 'comeOn' | 'questionAi'

export const URGE_LINES: readonly UrgeLine[] = [
  { id: 'canYouDoIt', effect: 'urgeCanYouDoIt', text: '到底行不行啊' },
  { id: 'hurryUp', effect: 'urgeHurryUp', text: '快点啊，我等的花都谢了' },
  { id: 'comeOn', effect: 'urgeComeOn', text: '抓紧吧您嘞' },
  { id: 'questionAi', effect: 'urgeQuestionAi', text: '这题你 AI 会吗' },
]

/** 对面发来的 id 可能是任何字符串（转发层不校验内容），查不到就返回 null。 */
export function urgeLineOf(id: string): UrgeLine | null {
  return URGE_LINES.find((line) => line.id === id) ?? null
}

export function pickRandomUrgeId(): UrgeId {
  return URGE_LINES[Math.floor(Math.random() * URGE_LINES.length)]!.id
}
