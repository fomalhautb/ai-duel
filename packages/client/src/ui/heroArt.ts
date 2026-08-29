/**
 * 英雄的原画卡图。
 *
 * public/hero/card-<id>.webp 是 768×1152（2:3）的整张原画，人物名和英文名已经画进图里，
 * 所以拿它当卡面时不用再叠任何文字——选英雄页（screens/HeroScreen）就是这么用的，
 * 对局左侧栏那两张英雄牌现在也走同一批图。
 *
 * 下面这份名单答的是"哪个英雄有原画"，必须和 public/hero/ 里实际存在的文件对得上。
 * 它和 core 的英雄表（packages/core/src/heroes.ts）不是一回事：那张表只收技能设计定案的英雄
 *（眼下只有格蕾丝·霍珀一位），而原画七张都在。所以参数类型写成 string 而不是 HeroId，
 * 免得 core 补一位英雄就得改这里的类型。
 * 查不到就返回 null，调用方退回通用的文字卡面（见 ui/MatchStage 的 PlayerPanel）。
 *
 * 加新原画时要同时补两处：这份名单，和 screens/HeroScreen 里那份带中文名的 HEROES。
 */

const HERO_ART_IDS: ReadonlySet<string> = new Set([
  'fei-fei-li',
  'danqi-chen',
  'melanie-perkins',
  'mira-murati',
  'ada-lovelace',
  'margaret-hamilton',
  'grace-hopper',
])

export function heroArtSrc(heroId: string): string | null {
  return HERO_ART_IDS.has(heroId) ? `/hero/card-${heroId}.webp` : null
}
