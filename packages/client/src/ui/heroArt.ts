/**
 * 英雄的原画卡图。
 *
 * public/hero/card-<id>.webp 是 768×1152（2:3）的整张原画，人物名和英文名已经画进图里，
 * 所以拿它当卡面时不用再叠任何文字——选英雄页（screens/HeroScreen）就是这么用的，
 * 对局左侧栏那两张英雄牌现在也走同一批图。
 *
 * 下面这份名单答的是"哪个英雄有原画"，必须和 public/hero/ 里实际存在的文件对得上。
 * 它和 core 的英雄表（packages/core/src/heroes.ts）问的不是同一件事：那张表管英雄数据，
 * 这份名单管图画没画出来。七位现在两边都齐，但两张表各自增删，不保证一直同步——
 * 所以参数类型写成 string 而不是 HeroId：调用方（ui/MatchStage）传进来的虽然都是 HeroId，
 * 这里判的却只是"文件在不在"，没必要跟着 core 的类型走。
 * 查不到就返回 null，调用方退回通用的文字卡面（见 ui/MatchStage 的 PlayerPanel）。
 *
 * 加一位英雄要补三处：core 的 HEROES 表（选英雄页直接读它渲染）、这份名单、以及原画文件本身。
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
