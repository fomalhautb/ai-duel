/**
 * 「这张技能牌现在能打谁」——选目标那套交互要亮哪一批东西，全按这里算。
 *
 * 规则的**唯一权威**是引擎（core 的 `playCard` 那几句校验），这里算的是同一件事的另一份说法：
 * 客户端得提前知道哪些目标合法，才谈得上把它们亮起来、把不合法的挡在压暗层底下。
 * 两份说法一旦不一致，玩家就会点一个当场被引擎拒掉的目标——所以单独拎成纯函数，
 * 由 test/skillTargets.test.ts 拿真引擎逐个目标对一遍。
 *
 * 只算"合法目标是哪些"，不算"这张牌现在打不打得出"（费用够不够、是不是自己回合、
 * 有没有被金钟罩挡住）：那些不影响该亮哪几张卡，仍旧交给引擎回一条 COMMAND_REJECTED。
 */

import { getCard } from '@ai-duel/core'
import type { AiInstance, CardInstance, PlayerState, SkillCard } from '@ai-duel/core'

/**
 * 技能牌要选哪一类目标。就是 core 卡牌定义上那四档，抽个别名省得到处写这一长串。
 * 各档的口径见 core 的 `SkillCard.target`。
 */
export type SkillTargetMode = NonNullable<SkillCard['target']>

/**
 * 某一档目标此刻在**战场上**的全部合法单位。
 *
 * me / foe 是出牌方和他的对手（不是座位 0 / 1）：三档里有两档打的是自己那一行。
 * `'own-hand-ai'`（模型蒸馏）选的是手牌，战场上一张都不亮，所以返回空数组——
 * 它的候选走下面的 handTargetsOf。
 */
export function boardTargetsOf(
  mode: SkillTargetMode,
  me: PlayerState,
  foe: PlayerState,
): AiInstance[] {
  switch (mode) {
    // 干扰类（复读机、黑白颠倒）：对方场上还没挂着干扰的那些。一个 AI 同时只能挂一种。
    case 'foe-ai':
      return foe.board.filter((ai) => ai.interference === undefined)
    // 保送：己方场上还没被保送过的。已经保送过的再打一次没有任何效果，所以引擎也不认。
    case 'own-ai':
      return me.board.filter((ai) => ai.safePassed !== true)
    // 玉净瓶：己方场上正挂着干扰的那些——没有干扰可解就没得选。
    case 'own-affected-ai':
      return me.board.filter((ai) => ai.interference !== undefined)
    case 'own-hand-ai':
      return []
  }
}

/**
 * 「模型蒸馏」能弃掉的那些手牌：自己手上的 AI 牌，技能牌不算
 * （换来的 Token 就是被弃那张 AI 的印刷费用，弃技能牌无从计价）。
 */
export function handTargetsOf(hand: readonly CardInstance[]): CardInstance[] {
  return hand.filter((instance) => getCard(instance.cardId).kind === 'ai')
}
