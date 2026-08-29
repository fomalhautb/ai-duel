import { HEROES } from '@ai-duel/core'
import type { HeroId } from '@ai-duel/core'

const STORAGE_KEY = 'ai-duel:selected-hero'
const DEFAULT_HERO: HeroId = 'grace-hopper'

/** 读取本机选择的英雄；旧值或未实现的展示英雄一律退回格蕾丝·霍珀。 */
export function loadSelectedHero(): HeroId {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored !== null && Object.hasOwn(HEROES, stored) ? (stored as HeroId) : DEFAULT_HERO
}

/** 英雄选择页确认时保存。类型已经保证只能写入 core 正式英雄表里的 id。 */
export function saveSelectedHero(heroId: HeroId): void {
  window.localStorage.setItem(STORAGE_KEY, heroId)
}
