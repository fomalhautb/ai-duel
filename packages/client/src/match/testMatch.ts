/**
 * dev 测试房：一个人就能把对局界面整套跑一遍。
 *
 * 它不是另开一条渲染路径——本地 driver → MatchSession → MatchScreen → MatchStage
 * 这条链和联机对局完全一样，只是把"对手的指令从 socket 来"换成"从测试面板来"。
 * 所以在测试房里看到的界面行为，就是联机时真实会发生的行为。
 *
 * 座位固定 0，不用热座的 seat: 'active'：视角跟着行动方跑的话，
 * "我方 / 对方"每次换手都互换，替对方出牌的入口就没法稳定指向同一边了。
 * 注意 0 号不一定先出牌——第一轮先手由 createGame 抛硬币掷出，之后每轮交换。
 *
 * 己方用存档里确认过的牌组和英雄，这样调完牌组能直接进来验；没选过才落回示例牌组。
 * 对手固定示例牌组，测试房是一个人直接开的，没有第二个玩家可问。
 */

import { QUESTION_POOL, STARTER_DECK } from '@ai-duel/core'
import { loadSave } from '../save/save'
import { createLocalDriver } from './localDriver'
import type { MatchDriver } from './driver'

export function createTestMatchDriver(): MatchDriver {
  const save = loadSave()
  return createLocalDriver({
    seat: 0,
    setup: {
      seed: Date.now(),
      // 测试房只跑一轮，视觉和流程调试可以在一次答题后直接检查最终结算页。
      questions: [QUESTION_POOL[0]!],
      players: [
        {
          name: '我',
          deck: save.savedDeck ? [...save.savedDeck] : [...STARTER_DECK],
          // 没选过英雄时字段整个不出现，而不是写成 hero: undefined：
          // engine 用 `=== undefined` 区分"用默认英雄"和"明确不带英雄"，
          // 而且条件展开在 exactOptionalPropertyTypes 打开后也不会报错。
          ...(save.savedHero ? { hero: save.savedHero } : {}),
        },
        { name: '测试对手', deck: [...STARTER_DECK] },
      ],
    },
  })
}
