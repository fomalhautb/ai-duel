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
 */

import { QUESTION_POOL, STARTER_DECK } from '@ai-duel/core'
import { createLocalDriver } from './localDriver'
import type { MatchDriver } from './driver'

export function createTestMatchDriver(): MatchDriver {
  return createLocalDriver({
    seat: 0,
    setup: {
      seed: Date.now(),
      // 测试房只跑两轮：一轮用来看"结算完接着开下一轮"，第二轮结束直接进最终结算页，
      // 两条路径各走一次，又不用把整局五道题打完。
      questions: QUESTION_POOL.slice(0, 2),
      players: [
        { name: '我', deck: [...STARTER_DECK] },
        { name: '测试对手', deck: [...STARTER_DECK] },
      ],
    },
  })
}
