/**
 * dev 测试房：一个人就能把对局界面整套跑一遍。
 *
 * 它不是另开一条渲染路径——本地 driver → MatchSession → MatchScreen → MatchStage
 * 这条链和联机对局完全一样，只是把"对手的指令从 socket 来"换成"从测试面板来"。
 * 所以在测试房里看到的界面行为，就是联机时真实会发生的行为。
 *
 * 座位固定 0（引擎里 0 号先手），不用热座的 seat: 'active'：
 * 视角跟着行动方跑的话，"我方 / 对方"每回合互换，替对方出牌的入口就没法稳定指向同一边了。
 */

import { STARTER_DECK } from '@ai-duel/core'
import { createLocalDriver } from './localDriver'
import type { MatchDriver } from './driver'

export function createTestMatchDriver(): MatchDriver {
  return createLocalDriver({
    seat: 0,
    setup: {
      seed: Date.now(),
      players: [
        { name: '我', deck: [...STARTER_DECK] },
        { name: '测试对手', deck: [...STARTER_DECK] },
      ],
    },
  })
}
