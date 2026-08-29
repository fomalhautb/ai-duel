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
 * 己方用存档里当前那套牌组和确认过的英雄，这样调完牌组能直接进来验；没选过才落回默认卡组。
 * 对手固定默认卡组（core 三副预设里平衡的那副），测试房是一个人直接开的，没有第二个玩家可问。
 */

import { BALANCED_DECK, DECK_SIZE } from '@ai-duel/core'
import type { CardId } from '@ai-duel/core'
import { loadDecks } from '../save/deckStore'
import { loadSave } from '../save/save'
import { createLocalDriver } from './localDriver'
import type { MatchDriver } from './driver'

/**
 * 己方牌组：选牌页当前正编辑的那一套，凑不满一副就用默认卡组。
 *
 * 必须自己查张数——deckStore 存的是编辑中的牌组，允许只有几张甚至一张都没有
 *（玩家可以编到一半就走人），直接拿去开局会摸空。
 */
function myDeck(): CardId[] {
  const data = loadDecks()
  const cards = data.decks.find((deck) => deck.id === data.currentId)?.cards ?? []
  return cards.length === DECK_SIZE ? [...cards] : [...BALANCED_DECK]
}

export function createTestMatchDriver(): MatchDriver {
  const save = loadSave()
  return createLocalDriver({
    seat: 0,
    setup: {
      // 题库不裁：一轮最多拿 1 分，而先到 3 分才结束（见 core 的 WIN_TARGET），
      // 只塞一道题的话永远打不出真实终局，测试房也就验不到"先到 3 分提前收场"这条。
      // 想快点看结算页就用测试面板的「跳到答题」连点几轮。
      seed: Date.now(),
      players: [
        {
          name: '我',
          deck: myDeck(),
          // 没选过英雄时字段整个不出现，而不是写成 hero: undefined：
          // engine 用 `=== undefined` 区分"用默认英雄"和"明确不带英雄"，
          // 而且条件展开在 exactOptionalPropertyTypes 打开后也不会报错。
          ...(save.savedHero ? { hero: save.savedHero } : {}),
        },
        { name: '测试对手', deck: [...BALANCED_DECK] },
      ],
    },
  })
}
