/**
 * 战场小卡上那一列角标，以及放大查看时卡下面那行「本轮受影响」字幕。
 *
 * 单拎出来是因为这两个都是纯函数（只读一份 AiInstance 加一个布尔），不碰 DOM 也不碰动画，
 * 测试直接手工造单位就能跑（同 ui/skillTargets.ts 的路子）。
 * 渲染在 ui/MatchStage.tsx 的 BoardTile / handleInspect。
 */

import { getCard } from '@ai-duel/core'
import type { AiInstance, CardId } from '@ai-duel/core'

/** 小卡上的一枚角标，直接喂给渲染。 */
export interface TileMark {
  /** 药丸上印的字，两三个字为宜——小卡就那么大。 */
  text: string
  /** 药丸完整的 class（底样式 + 配色那一档的修饰类，见 styles.css 的 .battle__tile-mark）。 */
  className: string
}

/**
 * 本轮打在场上单位身上的技能牌各挂一枚什么角标，键就是牌 id（跟着 `AiInstance.affectedBy` 查）。
 *
 * 凡是效果落在某个单位身上的技能牌都得在这里有一格，否则那张牌打出去战场上不留痕迹——
 * 引擎那边往 affectedBy 记一笔的同时，这里也要补上对应的文案（漏了会走 tileMarksOf 里那句
 * 通用的「被影响」）。「金钟罩」不在这份表里：它罩的是整个人而不是某个单位，另算一档。
 *
 * 写的是这个单位**现在是什么状态**而不是牌名（「复读中」不是「复读机」），因为角标要回答的是
 * "这张卡怎么了"；牌名留给放大查看时的那行字幕（见 affectedCaptionOf）。
 * 干扰按种类分而不是笼统写「已干扰」：两种干扰这一轮的后果完全不同
 * （复读机必错、黑白颠倒把判定翻面），玩家要据此决定救哪一个。
 *
 * modifier 只是配色那一档：默认（干扰的琥珀色）留空，其余各带一个。
 * 玉净瓶和保送同属"这是好事"的青色，鸡犬升天借升级那档的绿色。
 */
export const SKILL_EFFECT_MARKS: Record<CardId, { text: string; modifier: string }> = {
  'fixed-answer': { text: '复读中', modifier: '' },
  'black-white-reversal': { text: '已颠倒', modifier: '' },
  'jade-purification-vase': { text: '已净化', modifier: 'battle__tile-mark--safe' },
  'safe-pass': { text: '保送', modifier: 'battle__tile-mark--safe' },
  'rising-tide': { text: '已进化', modifier: 'battle__tile-mark--up' },
}

/** 拼出一枚角标完整的 class。配色那一档留空就只有底样式。 */
function markOf(text: string, modifier: string): TileMark {
  return {
    text,
    className: modifier === '' ? 'battle__tile-mark' : `battle__tile-mark ${modifier}`,
  }
}

/**
 * 这个单位现在该挂哪几枚常驻角标，按从上到下的顺序排。
 *
 * 先排本轮打在它身上的技能牌（按命中先后，进下一轮会自己消失），接着是主人的金钟罩，
 * 最后才是跟着单位走的升降级标记。顺序固定是为了同时挂两三枚时不会跳来跳去。
 *
 * 技能牌那一批直接照 `AiInstance.affectedBy` 排，不再各写各的判断：
 * 引擎那边只要往那个字段记一笔，这里就挂得出角标（文案见 SKILL_EFFECT_MARKS）。
 * 表里查不到的落到通用的「被影响」，宁可含糊也别让一张真的改了局面的牌在战场上不留痕迹。
 *
 * 金钟罩单独一档：它罩的是整个人（连本轮之后才上场的单位一起罩着），记不进单位身上，
 * 所以由调用方把 `PlayerState.shielded` 传进来。侧栏面板上那枚说的是"这个人被罩着"，
 * 这一枚说的是"这个单位现在打不动"——选目标时玩家看的是战场，那句话得在卡上说一遍。
 *
 * levelShift 是净升降次数（升 +1 降 -1，见 core 的 AiInstance）：一方升、另一方又降回去
 * 会留下一个 0，那时这张卡的 cardId 已经变回原样，所以 0 不挂角标。
 * 它记的是英雄技能干的事，和上面那批技能牌各走各的。
 */
export function tileMarksOf(ai: AiInstance, shielded: boolean): TileMark[] {
  const marks: TileMark[] = []
  for (const cardId of ai.affectedBy ?? []) {
    const mark = SKILL_EFFECT_MARKS[cardId] ?? { text: '被影响', modifier: '' }
    marks.push(markOf(mark.text, mark.modifier))
  }
  if (shielded) marks.push(markOf('金钟罩', 'battle__tile-mark--safe'))
  const shift = ai.levelShift ?? 0
  if (shift > 0) marks.push(markOf('已升级', 'battle__tile-mark--up'))
  else if (shift < 0) marks.push(markOf('已降级', 'battle__tile-mark--down'))
  return marks
}

/**
 * 放大查看战场小卡时，卡下面那行字幕：本轮它被哪几张技能牌影响了。
 *
 * 角标只写状态（「复读中」「已净化」），说不出是谁干的；玩家点开一张卡最想知道的正是这个，
 * 所以这里报牌名，顺序和角标一致。金钟罩同样要算进来——它护着这个单位，
 * 只是记在主人身上（见 tileMarksOf）。
 * 什么都没挂就返回 null，字幕整行不渲染（约定见 MatchStage 的 InspectTarget.caption）。
 */
export function affectedCaptionOf(ai: AiInstance, shielded: boolean): string | null {
  const names = (ai.affectedBy ?? []).map((cardId) => getCard(cardId).name)
  if (shielded) names.push(getCard('golden-bell-shield').name)
  if (names.length === 0) return null
  return `本轮受影响：${names.join('、')}`
}
