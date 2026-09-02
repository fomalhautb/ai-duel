/**
 * 技能牌卡面展示配置：费用圆章盖在原画那枚上面时要用的颜色和位置。
 *
 * 技能牌的原画是整张烘焙好的（连「N TOKEN」圆章一起画进去了），费用一调，画上的数字就成了
 * 旧价。所以卡面照原样再画一枚圆章盖上去（见 ui/CardCostBadge.tsx），数字取 core 的 tokenCost，
 * 以后调平衡不用重出原画。
 *
 * `fill` 是从各自原画那枚圆章盘心采下来的颜色：盖上去要接得住原画外圈那道金环，
 * 统一成一种颜色的话，紫底的「复读机」和酱红底的「重复轰炸」会当场露馅。
 * `center` 只有四张要单独给——它们那枚印得比别人偏，其余 20 张都落在 CSS 的默认位置上。
 * 换原画这两样都得重量。
 */
export interface SkillCardFace {
  fill: string
  center?: { x: number; y: number }
}

export const SKILL_CARD_FACE: Record<string, SkillCardFace> = {
  'anti-addiction': { fill: '#464f4e' },
  'black-white-reversal': { fill: '#434340' },
  'boomerang': { fill: '#4f5452' },
  'character-lock': { fill: '#323c46', center: { x: 12.9, y: 8.9 } },
  'clean-sweep': { fill: '#4b524b' },
  'compute-compression': { fill: '#4e5451' },
  'context-flood': { fill: '#484f4c' },
  'domestic-substitution': { fill: '#4d5652' },
  'far-ahead': { fill: '#554951' },
  'fixed-answer': { fill: '#584954', center: { x: 14.1, y: 10.0 } },
  'golden-bell-shield': { fill: '#525541' },
  'jade-purification-vase': { fill: '#47514c' },
  'kids-mode': { fill: '#4f5653' },
  'memory-shortage': { fill: '#4f5451' },
  'model-distillation': { fill: '#484c46' },
  'nuclear-power-station': { fill: '#4e5450' },
  'one-sentence-answer': { fill: '#3e4a35', center: { x: 12.7, y: 8.7 } },
  'open-source-reproduction': { fill: '#464f4a' },
  'repetition-bombardment': { fill: '#59382b', center: { x: 13.7, y: 9.6 } },
  'rising-tide': { fill: '#4e5553' },
  'safe-pass': { fill: '#4f5652' },
  'topic-drift': { fill: '#404d43' },
  'version-rollback': { fill: '#464857' },
  'version-upgrade': { fill: '#4e5552' },
}
