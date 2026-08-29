// pure-rand v8 只提供子路径入口，没有包根入口，所以这几行 import 看起来才这么长。
import { uniformInt } from 'pure-rand/distribution/uniformInt'
// 用 mersenne 而不是更快的 xoroshiro128plus：后者从整数种子起步时，
// 相邻种子头几个输出的低位是强相关的（实测连续种子掷硬币有约 65% 概率翻面，
// 空转多少次都甩不掉），而这里的 seed 就是 Date.now()，会掷出"隔一毫秒换一次先手"的规律。
// mersenne 的种子扩散做得干净，连续种子的首个输出实测就是均匀且互不相关的。
import { mersenne } from 'pure-rand/generator/mersenne'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import { CARDS, getCard } from './cards'
import { AI_MODEL_DOWNGRADES, AI_MODEL_UPGRADES } from './aiModels'
import { QUESTION_POOL } from './questions'
import type {
  AiInstance,
  AnswerResult,
  CardId,
  CardInstance,
  Command,
  ExecuteResult,
  GameEvent,
  GameState,
  HeroId,
  InstanceId,
  PlayerId,
  PlayerState,
  Question,
  SkillCard,
} from './types'

/** 开局手牌数。黑客松阶段不做先后手补偿，双方一样。 */
export const STARTING_HAND_SIZE = 5

/** 每名玩家开局拥有的整局 Token。当前规则不会在换轮时恢复。 */
export const STARTING_TOKENS = 100

/**
 * 第 2 轮起每轮开始双方各补几张。
 *
 * 一张时手牌只出不进，打到后面双方常常无牌可打、只能干等着答题；两张才够一轮出一两张的消耗。
 * 一局最多摸 5 + 4 轮 × 2 = 13 张，默认牌组 20 张（见 cards.ts 的 STARTER_DECK）管得住，
 * 不会中途抽空。改大到摸得空牌堆也不会出错（drawCards 抽不到就算了），只是画面上会一直显示 0。
 */
export const ROUND_DRAW_SIZE = 2

/** 没指定英雄时用谁。外部入口漏传选择时仍用格蕾丝·霍珀兜底。 */
const DEFAULT_HERO: HeroId = 'grace-hopper'

/** 阿达·洛芙莱斯「第一算法」开局额外获得的 Token 数。 */
export const ADA_LOVELACE_TOKEN_BONUS = 2

export interface PlayerSetup {
  name: string
  /** 牌组，元素是卡牌定义 id，可以重复。 */
  deck: CardId[]
  /** 开局 Token；不填使用 STARTING_TOKENS。主要给平衡调整和规则测试留入口。 */
  tokens?: number
  /**
   * 这一方的英雄，不填就是 DEFAULT_HERO。
   * 暂时没有选英雄的界面，联机和测试房都不传这一项，双方都拿到默认英雄。
   * 传 null 表示这一方不带英雄（现在只有测试会这么用）。
   */
  hero?: HeroId | null
}

export interface GameSetup {
  /** 洗牌种子。同一个种子 + 同一串指令 = 同一场对局，先手也由它掷出。 */
  seed: number
  players: [PlayerSetup, PlayerSetup]
  /**
   * 指定本局的题序，不填就把整个题库洗一遍。
   * 留这个口子是给测试和调试用的：只塞一两道题，一两轮就能打到 GAME_OVER，
   * 不必为了看结算界面把整局走完。传进来的顺序原样使用，不再洗。
   */
  questions?: Question[]
}

/**
 * 开一局：建好双方状态、洗牌、洗题序、抛硬币定先手、发起始手牌。
 *
 * 随机只出现在这里。牌堆洗完之后抽牌就是从末尾 pop、题目按洗好的顺序逐轮取，
 * 所以 execute 全程没有随机数，GameState 也不需要保存 RNG 状态。
 */
export function createGame(setup: GameSetup): ExecuteResult {
  const rng = mersenne(setup.seed)
  let seq = 0

  const makePlayer = (id: PlayerId, config: PlayerSetup): PlayerState => {
    const deck: CardInstance[] = config.deck.map((cardId) => ({
      instanceId: `p${id}-c${seq++}`,
      cardId,
      owner: id,
    }))
    // 用 === undefined 而不是 ??：null 是"这一方明确不带英雄"。先定好英雄再算初始 Token，
    // 阿达·洛芙莱斯「第一算法」开局额外 +2，直接加在起始额度上，不进任何"待发动"标记。
    const hero = config.hero === undefined ? DEFAULT_HERO : config.hero
    const baseTokens = config.tokens ?? STARTING_TOKENS
    return {
      id,
      name: config.name,
      score: 0,
      tokens: hero === 'ada-lovelace' ? baseTokens + ADA_LOVELACE_TOKEN_BONUS : baseTokens,
      skillShielded: false,
      playsThisRound: 0,
      hand: [],
      deck: shuffle(deck, rng),
      board: [],
      discard: [],
      // 英雄初始化不碰 rng，所以加了它也不影响下面抛硬币/洗牌那串随机数的顺序。
      hero,
      heroSkillUsed: false,
    }
  }

  // 抛硬币定第一轮先手，之后每轮交换，所以只掷这一次。
  // 放在洗牌之前是有意的：洗牌会按牌组长度推进 rng，先手要是排在后面，
  // 换一副牌组或换一份题库就会掷出另一个结果，"同一个 seed 谁先手"这件事就不好复盘了。
  const firstPlayer: PlayerId = uniformInt(rng, 0, 1) === 0 ? 0 : 1
  // 先建好两个玩家再组装 state：makePlayer 会推进 seq，
  // 写在对象字面量里的话 seq 那一行会按书写顺序取到发牌前的旧值。
  const players: [PlayerState, PlayerState] = [
    makePlayer(0, setup.players[0]),
    makePlayer(1, setup.players[1]),
  ]
  const questions = setup.questions ? setup.questions.slice() : shuffle(QUESTION_POOL, rng)

  const state: GameState = {
    round: 1,
    totalRounds: questions.length,
    firstPlayer,
    activePlayer: firstPlayer,
    phase: 'play',
    questions,
    players,
    winner: null,
    seq,
  }

  const events: GameEvent[] = [{ type: 'GAME_STARTED', firstPlayer }]
  for (const player of state.players) {
    drawCards(player, STARTING_HAND_SIZE, events)
  }
  announceRound(state, events)
  return { state, events }
}

/**
 * 执行一条指令。
 *
 * 纯函数：不改传入的 state，返回新状态和本次产生的事件。
 * 指令非法时状态原样返回，只带一条 COMMAND_REJECTED。
 */
export function execute(state: GameState, command: Command): ExecuteResult {
  if (state.phase === 'finished') return reject(state, '对局已结束')

  switch (command.type) {
    case 'PLAY_CARD':
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      if (command.player !== state.activePlayer) return reject(state, '还没轮到你出牌')
      return playCard(state, command.player, command.instanceId, command.targetInstanceId)
    case 'END_PLAY':
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      if (command.player !== state.activePlayer) return reject(state, '还没轮到你出牌')
      return endPlay(state)
    case 'SUBMIT_ANSWERS':
      if (state.phase !== 'quiz') return reject(state, '现在不是答题阶段')
      return submitAnswers(state, command.results)
    case 'USE_HERO_SKILL':
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      if (command.player !== state.activePlayer) return reject(state, '还没轮到你出牌')
      return useHeroSkill(state, command.player, command.targetInstanceId)
    // 容错系统的补位/放弃只在 rescue 阶段有效，阶段判断放在各自函数里，
    // 这样非 rescue 阶段发来也能回一条明确的拒绝理由，而不是被上面的 phase 兜底吃掉。
    case 'USE_RESCUE':
      return useRescue(state, command.player, command.substituteInstanceId)
    case 'DECLINE_RESCUE':
      return declineRescue(state, command.player)
    // DEBUG_ADD_CARD / DEBUG_REMOVE_CARD 不限阶段：测试房要能在答题阶段先把手牌摆好。
    case 'DEBUG_ADD_CARD':
      return debugAddCard(state, command.player, command.cardId)
    case 'DEBUG_REMOVE_CARD':
      return debugRemoveCard(state, command.player, command.instanceId)
    case 'DEBUG_PLAY_CARD':
      // 和 PLAY_CARD 只差"轮到谁"这一条检查：测试房要能替对手出牌看结算动画。
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      return playCard(state, command.player, command.instanceId, command.targetInstanceId)
    case 'DEBUG_SKIP_TO_QUIZ':
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      return skipToQuiz(state)
  }
}

/**
 * 发动一项需要玩家选 Agent 的英雄技能。
 *
 * 所有校验都先落在副本上定位，失败时仍返回原始 state；成功后才写使用标志和本轮效果。
 * Debug 是对手出技能牌时自动触发，不经过这里。
 */
function useHeroSkill(
  state: GameState,
  playerId: PlayerId,
  targetInstanceId: InstanceId,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const foe = next.players[other(playerId)]
  const heroId = player.hero

  if (heroId === null) return reject(state, '你没有英雄')
  if (heroId === 'grace-hopper') return reject(state, 'Debug 会在对方打出技能牌时自动发动')
  if (heroId === 'margaret-hamilton') {
    return reject(state, '「容错系统」会在己方 Agent 答错时才可发动')
  }
  if (player.heroSkillUsed) return reject(state, '英雄技能已经用过了')

  // 米拉·穆拉蒂「快速部署」：把一个已上场的 Agent 撤回手牌，玩家随后可重新部署别的 Agent。
  // 撤回是"战场 → 手牌"的移动，和升降级/保送那套"改场上单位字段"完全不同，所以单独早返回。
  if (heroId === 'mira-murati') {
    const index = player.board.findIndex((ai) => ai.instanceId === targetInstanceId)
    if (index < 0) return reject(state, '目标必须是己方场上的 Agent')
    const recalled = player.board[index]!
    player.board.splice(index, 1)
    // 撤回后回到手牌的是玩家当初打出的那张牌：沿用原始 cardId 和 instanceId，
    // 本轮临时挂上的升降级/提示词/保送标记全部丢弃（这些本来就只持续本轮）。
    player.hand.push({
      instanceId: recalled.instanceId,
      cardId: recalled.cardId,
      owner: playerId,
    })
    player.heroSkillUsed = true
    return {
      state: next,
      events: [
        {
          type: 'AI_RECALLED',
          player: playerId,
          heroId,
          instanceId: recalled.instanceId,
          cardId: recalled.cardId,
        },
      ],
    }
  }

  let target: AiInstance | undefined
  let fromCardId: CardId | undefined
  let toCardId: CardId | undefined

  if (heroId === 'fei-fei-li') {
    if (currentQuestion(next).includesImage !== true) {
      return reject(state, '「再看一眼」只能在包含图片的题目中发动')
    }
    target = player.board.find((ai) => ai.instanceId === targetInstanceId)
    if (target === undefined) return reject(state, '目标必须是己方场上的 Agent')
    if (target.guaranteedNextRound !== undefined) return reject(state, '这个 Agent 本轮已经被保送')
    target.guaranteedNextRound = heroId
  } else if (heroId === 'danqi-chen') {
    target = player.board.find((ai) => ai.instanceId === targetInstanceId)
    if (target === undefined) return reject(state, '目标必须是己方场上的 Agent')
    fromCardId = target.roundModelOverride ?? target.cardId
    toCardId = AI_MODEL_UPGRADES[fromCardId]
    if (toCardId === undefined) return reject(state, '这个 Agent 已经无法继续升级')
    target.roundModelOverride = toCardId
  } else {
    target = foe.board.find((ai) => ai.instanceId === targetInstanceId)
    if (target === undefined) return reject(state, '目标必须是对方场上的 Agent')
    fromCardId = target.roundModelOverride ?? target.cardId
    toCardId = AI_MODEL_DOWNGRADES[fromCardId]
    if (toCardId === undefined) return reject(state, '这个 Agent 已经无法继续降级')
    target.roundModelOverride = toCardId
  }

  player.heroSkillUsed = true
  return {
    state: next,
    events: [
      {
        type: 'HERO_SKILL_USED',
        player: playerId,
        heroId,
        targetInstanceId: target.instanceId,
        ...(fromCardId === undefined ? {} : { fromCardId }),
        ...(toCardId === undefined ? {} : { toCardId }),
      },
    ],
  }
}

interface ResolvedSkillTarget {
  /** 玩家在界面上点选的场上 AI。 */
  target: AiInstance | undefined
  /** 反弹后真正承接原效果的对方 AI。 */
  reflectedTarget: AiInstance | undefined
  /**
   * 玩家点选的一张手牌 / 弃牌区里的牌。
   * 模型蒸馏（选手牌 AI）和开源复现（选弃牌区 AI）用它；这两类技能不作用于场上单位，
   * 所以走的是 CardInstance 而不是上面的 AiInstance。
   */
  cardTarget?: CardInstance
}

type SkillTargetResult = ResolvedSkillTarget | { reason: string }

/**
 * 按卡牌定义校验并解析技能目标。
 *
 * 这里只读/定位 `next` 里的实例，不做结算；所有拒绝都发生在扣 Token 和移动手牌之前。
 */
function resolveSkillTarget(
  state: GameState,
  playerId: PlayerId,
  card: SkillCard,
  targetInstanceId: InstanceId | undefined,
): SkillTargetResult {
  if (card.target === undefined) return { target: undefined, reflectedTarget: undefined }

  const player = state.players[playerId]
  const foe = state.players[other(playerId)]

  // 上下文洪水：群体干扰，不用点选目标，效果落在对方全部作答 Agent 身上。
  // 校验放在这里、赶在下面"必须指定目标"那条之前：金钟罩照样能挡住整张牌。
  // 具体落点在 applySkillEffect 里遍历 foe.board 完成。
  if (card.target === 'foe-all-ai') {
    if (foe.skillShielded) return { reason: '对方正受金钟罩保护' }
    return { target: undefined, reflectedTarget: undefined }
  }

  if (targetInstanceId === undefined) return { reason: '这张技能牌要先指定目标' }

  if (card.target === 'foe-ai') {
    if (foe.skillShielded) return { reason: '对方正受金钟罩保护' }
    const target = foe.board.find((ai) => ai.instanceId === targetInstanceId)
    if (target === undefined) return { reason: '目标必须是对方场上的 AI' }
    if (target.promptEffect !== undefined) return { reason: '这个 AI 本轮已经受到技能效果' }
    return { target, reflectedTarget: undefined }
  }

  // 模型蒸馏、开源复现选的是手牌/弃牌区里的一张 AI 牌，不是场上单位，所以先单独处理。
  if (card.target === 'own-hand-ai') {
    const cardTarget = player.hand.find((c) => c.instanceId === targetInstanceId)
    if (cardTarget === undefined) return { reason: '目标必须是你手牌里的一张卡' }
    if (getCard(cardTarget.cardId).kind !== 'ai') return { reason: '只能弃置手牌里的 Agent 牌' }
    return { target: undefined, reflectedTarget: undefined, cardTarget }
  }

  if (card.target === 'own-discard-ai') {
    const cardTarget = player.discard.find((c) => c.instanceId === targetInstanceId)
    if (cardTarget === undefined) return { reason: '目标必须是你弃牌区里的一张卡' }
    if (getCard(cardTarget.cardId).kind !== 'ai') return { reason: '只能回收弃牌区里的 Agent 牌' }
    return { target: undefined, reflectedTarget: undefined, cardTarget }
  }

  // 版本回退 / 版本升级：双方场上任意一个还能沿版本链退化 / 进化的 Agent。
  // 金钟罩按目标的主人判断——被罩住的那一方的 Agent 一律选不了，不分敌我。
  if (card.target === 'any-ai-downgradable' || card.target === 'any-ai-upgradable') {
    const own = player.board.find((ai) => ai.instanceId === targetInstanceId)
    const target = own ?? foe.board.find((ai) => ai.instanceId === targetInstanceId)
    if (target === undefined) return { reason: '目标必须是场上的 Agent' }
    if ((own !== undefined ? player : foe).skillShielded) {
      return { reason: own !== undefined ? '你正受金钟罩保护' : '对方正受金钟罩保护' }
    }
    const fromCardId = target.roundModelOverride ?? target.cardId
    const chain = card.target === 'any-ai-downgradable' ? AI_MODEL_DOWNGRADES : AI_MODEL_UPGRADES
    if (chain[fromCardId] === undefined) {
      return {
        reason:
          card.target === 'any-ai-downgradable'
            ? '这个 Agent 已经无法继续退化'
            : '这个 Agent 已经无法继续进化',
      }
    }
    return { target, reflectedTarget: undefined }
  }

  const target = player.board.find((ai) => ai.instanceId === targetInstanceId)
  if (target === undefined) return { reason: '目标必须是己方场上的 AI' }

  // 保送：己方场上任意一个还没被保送的 AI。
  if (card.target === 'own-ai') {
    if (target.guaranteedNextRound !== undefined) return { reason: '这个 Agent 本轮已经被保送' }
    return { target, reflectedTarget: undefined }
  }

  if (card.target === 'own-ai-interference' || card.target === 'own-ai-restriction') {
    const expected = card.target === 'own-ai-interference' ? 'interference' : 'restriction'
    if (target.promptEffect?.category !== expected) {
      return { reason: expected === 'interference' ? '该 AI 没有可移除的干扰效果' : '该 AI 没有可移除的限制效果' }
    }
    return { target, reflectedTarget: undefined }
  }

  const applied = target.promptEffect
  if (applied === undefined || applied.sourcePlayer !== foe.id) {
    return { reason: '该 AI 没有对方本轮施加的可反弹效果' }
  }
  const sourceCard = getCard(applied.sourceCardId)
  if (sourceCard.kind !== 'skill' || sourceCard.category === 'environment') {
    return { reason: '环境技能牌不能被反弹' }
  }
  if (foe.skillShielded) return { reason: '对方正受金钟罩保护' }
  // 牌面只让选「哪张效果」，没有要求再选一次落点；因此按场上顺序取第一个合法 AI。
  const reflectedTarget = foe.board.find((ai) => ai.promptEffect === undefined)
  if (reflectedTarget === undefined) return { reason: '对方场上没有能承接反弹效果的 AI' }
  return { target, reflectedTarget }
}

/**
 * 在英雄抵消判定之后结算一张正式技能牌。
 *
 * 需要 state / foe / cardTarget / events 四个额外入参：
 * - state：核电站把折扣写在整个对局的场地状态上，不在任何一个玩家名下；
 * - foe：防沉迷要把出牌上限压在对手身上；
 * - cardTarget：模型蒸馏 / 开源复现操作的是手牌或弃牌区里的牌，不是场上单位；
 * - events：国产替代的罚下、开源复现的收回牌等要往事件流里补条目。
 */
function applySkillEffect(
  state: GameState,
  playerId: PlayerId,
  player: PlayerState,
  foe: PlayerState,
  card: SkillCard,
  target: AiInstance | undefined,
  reflectedTarget: AiInstance | undefined,
  cardTarget: CardInstance | undefined,
  events: GameEvent[],
): void {
  const effect = card.effect
  if (effect === undefined) return

  if (effect.kind === 'round-skill-shield') {
    player.skillShielded = true
    // 「不受影响」从打出时立即成立：既有负面效果一并清掉，后续技能由目标校验拦住。
    for (const ai of player.board) delete ai.promptEffect
    return
  }

  // 核电站：把折扣挂到对局状态上，本轮内双方后续的每张牌都按它减价（消费在 playCard）。
  // 多座核电站叠加时减免额累加——两座就是所有牌减 2；最低费用取更低的那档。
  if (effect.kind === 'discount-round-cards') {
    const prev = state.roundCardDiscount
    state.roundCardDiscount =
      prev === undefined
        ? { amount: effect.amount, minCost: effect.minCost }
        : {
            amount: prev.amount + effect.amount,
            minCost: Math.min(prev.minCost, effect.minCost),
          }
    return
  }

  // 遥遥领先：这里不写任何状态——"本轮作废、直接推进"牵扯清标记、换先手、补牌一整串
  // 收尾，还必须排在 SKILL_PLAYED 事件之后播，所以整个挪到 playCard 里牌照常亮相完再执行。
  if (effect.kind === 'end-round-immediately') return

  // 国产替代：把双方场上不带国产标记的 Agent 一次性罚下。环境效果对两边一视同仁，
  // 金钟罩也拦不住它（罩子只挡"打向某一方"的技能，见 resolveSkillTarget 各目标分支）。
  if (effect.kind === 'eliminate-non-domestic') {
    for (const boardPlayer of [player, foe]) {
      for (let i = boardPlayer.board.length - 1; i >= 0; i--) {
        const ai = boardPlayer.board[i]!
        const aiCard = getCard(ai.cardId)
        if (aiCard.kind === 'ai' && aiCard.domestic === true) continue
        boardPlayer.board.splice(i, 1)
        boardPlayer.discard.push({ instanceId: ai.instanceId, cardId: ai.cardId, owner: ai.owner })
        events.push({ type: 'AI_ELIMINATED', instanceId: ai.instanceId, owner: ai.owner })
      }
    }
    return
  }

  // 儿童模式 / 鸡犬升天：把双方场上每个还能沿版本链退化 / 进化的 Agent 各挪一步。
  // 只改本轮生效的 roundModelOverride，回合结束统一恢复；不在链上的 Agent 原样不动。
  // 和国产替代一样是环境效果，对两边一视同仁，金钟罩拦不住。
  if (effect.kind === 'mass-downgrade' || effect.kind === 'mass-upgrade') {
    const chain = effect.kind === 'mass-downgrade' ? AI_MODEL_DOWNGRADES : AI_MODEL_UPGRADES
    for (const boardPlayer of [player, foe]) {
      for (const ai of boardPlayer.board) {
        const toCardId = chain[ai.roundModelOverride ?? ai.cardId]
        if (toCardId !== undefined) ai.roundModelOverride = toCardId
      }
    }
    return
  }

  // 内存紧缺：双方各随机保留己方场上一半的 Agent（向上取整），其余罚下进弃牌区。
  // 引擎的 execute 全程不摸随机数（同一 seed + 同一串指令必须复现，房主客人才不会算出两样），
  // 所以这里不能用 Math.random，而是拿当前局面派生出一个确定性种子现开一个 mersenne：
  // 只要双方看到的是同一份局面，掷出的"保留哪几个"就一模一样。
  if (effect.kind === 'memory-shortage') {
    const rng = mersenne(memoryShortageSeed(state))
    for (const boardPlayer of [player, foe]) {
      const keepCount = Math.ceil(boardPlayer.board.length / 2)
      // 从后往前删：先掷出要淘汰的下标集合，再倒序 splice，避免删一个就打乱后面的下标。
      const dropCount = boardPlayer.board.length - keepCount
      const dropIndices = pickDistinctIndices(rng, boardPlayer.board.length, dropCount)
      for (const i of dropIndices) {
        const ai = boardPlayer.board[i]!
        boardPlayer.board.splice(i, 1)
        boardPlayer.discard.push({ instanceId: ai.instanceId, cardId: ai.cardId, owner: ai.owner })
        events.push({ type: 'AI_ELIMINATED', instanceId: ai.instanceId, owner: ai.owner })
      }
    }
    return
  }

  // 防沉迷：把出牌上限压在对手头上；已经打出的牌数不倒扣，只挡住之后想打的牌。
  if (effect.kind === 'limit-foe-plays') {
    // 取更小的那个：对方本轮要是已被压得更低，防沉迷不该反而把上限放宽。
    foe.playLimitThisRound =
      foe.playLimitThisRound === undefined
        ? effect.maxPlays
        : Math.min(foe.playLimitThisRound, effect.maxPlays)
    return
  }

  // 算力压缩：只记下折扣，等下一张 AI 牌打出时在 playCard 里消费。
  if (effect.kind === 'discount-next-ai') {
    player.nextAiDiscount = { amount: effect.amount, minCost: effect.minCost }
    return
  }

  // 模型蒸馏：弃掉手里选中的那张 AI 牌，按它的费用加成折算成 Token。
  if (effect.kind === 'distill-hand-ai') {
    if (cardTarget === undefined) throw new Error(`技能牌 ${card.id} 缺少要弃置的手牌`)
    const handIndex = player.hand.findIndex((c) => c.instanceId === cardTarget.instanceId)
    if (handIndex < 0) throw new Error(`模型蒸馏找不到目标手牌 ${cardTarget.instanceId}`)
    const distilled = player.hand.splice(handIndex, 1)[0]!
    const distilledCard = getCard(distilled.cardId)
    const baseCost = distilledCard.kind === 'ai' ? (distilledCard.tokenCost ?? 0) : 0
    player.tokens += baseCost + effect.bonus
    player.discard.push(distilled)
    events.push({ type: 'CARD_REMOVED', player: playerId, instanceId: distilled.instanceId })
    return
  }

  // 开源复现：把弃牌区里选中的那张 AI 牌收回手牌。
  if (effect.kind === 'recover-discard-ai') {
    if (cardTarget === undefined) throw new Error(`技能牌 ${card.id} 缺少要回收的弃牌`)
    const discardIndex = player.discard.findIndex((c) => c.instanceId === cardTarget.instanceId)
    if (discardIndex < 0) throw new Error(`开源复现找不到目标弃牌 ${cardTarget.instanceId}`)
    const recovered = player.discard.splice(discardIndex, 1)[0]!
    player.hand.push(recovered)
    // 复用 CARD_DRAWN：对客户端来说"手上多了一张牌"要播的动画是一样的。
    events.push({ type: 'CARD_DRAWN', player: playerId, card: recovered })
    return
  }

  // 上下文洪水：apply-prompt + foe-all-ai，把同一条干扰效果盖到对方每个作答 Agent 身上。
  // 已经带着别的效果的 Agent 也照样覆盖——牌面写的是"所有 Agent"，不做"跳过已受影响"的例外。
  if (effect.kind === 'apply-prompt' && card.target === 'foe-all-ai') {
    for (const ai of foe.board) {
      ai.promptEffect = {
        sourceCardId: card.id,
        sourcePlayer: playerId,
        category: effect.prompt.category,
        instruction: effect.prompt.instruction,
        answerMode: { ...effect.prompt.answerMode },
      }
    }
    return
  }

  if (target === undefined) throw new Error(`技能牌 ${card.id} 缺少结算目标`)

  // 保送：本轮结算时即使答错也留场，标记来源便于客户端区分李飞飞的保送。
  if (effect.kind === 'guarantee-survival') {
    target.guaranteedNextRound = 'safe-pass'
    return
  }

  // 版本回退：沿版本链退一步，只改本轮生效的 roundModelOverride（回合结束统一恢复）。
  // 能不能退化已在 resolveSkillTarget 校验过，这里查不到链属于数据错误，直接抛错。
  if (effect.kind === 'downgrade-model') {
    const toCardId = AI_MODEL_DOWNGRADES[target.roundModelOverride ?? target.cardId]
    if (toCardId === undefined) throw new Error(`版本回退找不到 ${target.cardId} 的退化链`)
    target.roundModelOverride = toCardId
    return
  }

  // 版本升级：沿版本链进一步，同样只改本轮的 roundModelOverride，是版本回退的镜像。
  if (effect.kind === 'upgrade-model') {
    const toCardId = AI_MODEL_UPGRADES[target.roundModelOverride ?? target.cardId]
    if (toCardId === undefined) throw new Error(`版本升级找不到 ${target.cardId} 的进化链`)
    target.roundModelOverride = toCardId
    return
  }

  if (effect.kind === 'apply-prompt') {
    target.promptEffect = {
      sourceCardId: card.id,
      sourcePlayer: playerId,
      category: effect.prompt.category,
      instruction: effect.prompt.instruction,
      answerMode: { ...effect.prompt.answerMode },
    }
    return
  }

  if (effect.kind === 'remove-prompt') {
    delete target.promptEffect
    return
  }

  if (reflectedTarget === undefined || target.promptEffect === undefined) {
    throw new Error(`反弹技能牌 ${card.id} 缺少原效果或落点`)
  }
  reflectedTarget.promptEffect = {
    ...target.promptEffect,
    answerMode: { ...target.promptEffect.answerMode },
  }
  delete target.promptEffect
}

/**
 * 打出一张手牌。
 * 一轮内想打几张打几张；技能牌按卡牌定义立即扣除 Token，只有卡面标了 `target` 的技能牌要指定目标。
 */
function playCard(
  state: GameState,
  playerId: PlayerId,
  instanceId: InstanceId,
  targetInstanceId?: InstanceId,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId)
  if (handIndex < 0) return reject(state, '手牌里没有这张卡')

  // 防沉迷：对手压在本方头上的出牌上限，AI 牌和技能牌都算。超了就整条拒绝，不动任何资源。
  if (player.playLimitThisRound !== undefined && player.playsThisRound >= player.playLimitThisRound) {
    return reject(state, `本轮受「防沉迷」限制，最多只能打出 ${player.playLimitThisRound} 张牌`)
  }

  const instance = player.hand[handIndex]!
  const card = getCard(instance.cardId)
  // 费用分两层折：核电站先折（对双方、AI 牌和技能牌都生效），「算力压缩」再叠在它上面
  // （只折本方的 AI 牌）。两张折扣的最低价各自独立兜底，和 core 的计价保持同一套规则。
  let tokenCost = card.tokenCost ?? 0
  const nuclear = next.roundCardDiscount
  if (nuclear !== undefined) tokenCost = Math.max(nuclear.minCost, tokenCost - nuclear.amount)
  if (card.kind === 'ai' && player.nextAiDiscount !== undefined) {
    tokenCost = Math.max(
      player.nextAiDiscount.minCost,
      tokenCost - player.nextAiDiscount.amount,
    )
  }

  if (player.tokens < tokenCost) {
    return reject(state, `Token 不足：${card.name}需要 ${tokenCost}，当前只有 ${player.tokens}`)
  }

  // 目标先校验完再动手牌：拒绝要退回原样的 state（reject 回的就是传进来那份），
  // 而下面这些改动全落在副本 next 上，顺序写反了以后加分支时容易漏掉。
  const targetResult =
    card.kind === 'skill'
      ? resolveSkillTarget(next, playerId, card, targetInstanceId)
      : { target: undefined, reflectedTarget: undefined, cardTarget: undefined }
  if ('reason' in targetResult) return reject(state, targetResult.reason)
  const { target, reflectedTarget, cardTarget } = targetResult

  player.tokens -= tokenCost
  player.playsThisRound += 1
  player.hand.splice(handIndex, 1)

  const events: GameEvent[] = []
  if (card.kind === 'ai') {
    // 打出 AI 牌即消费掉「算力压缩」的一次性折扣，无论这张牌原价高低。
    delete player.nextAiDiscount
    // AI 牌进场后跨轮留在场上，答错才罚下，所以实例 id 沿用手牌那一份，
    // 罚下时才能原样塞回弃牌堆。
    const ai: AiInstance = {
      instanceId: instance.instanceId,
      cardId: card.id,
      owner: playerId,
    }
    player.board.push(ai)
    events.push({ type: 'AI_DEPLOYED', player: playerId, ai })
  } else {
    player.discard.push(instance)
    // 格蕾丝·霍珀的 Debug：抵消对方本局打出的第一张技能牌。
    // 牌本身照常打出、照常进弃牌堆，作废的只是**效果**，所以要赶在结算之前先问一句
    // 「这张会不会被抵消」——被抵消的技能不能改动任何规则状态，
    // 否则玩家会看到"技能被抵消了，效果却仍然存在"这种自相矛盾的局面。
    // 以后给别的技能牌写效果，同样都要写进下面这个 canceledBy === null 的分支里。
    const foe = next.players[other(playerId)]
    const canceledBy: HeroId | null =
      foe.hero === 'grace-hopper' && !foe.heroSkillUsed ? foe.hero : null
    if (canceledBy === null && card.effect !== undefined) {
      applySkillEffect(next, playerId, player, foe, card, target, reflectedTarget, cardTarget, events)
    }

    // 带上 instanceId 不是结算需要，是给客户端定位用的：技能牌打出后就进弃牌堆，
    // 客户端只能靠这个 id 在出牌方的手牌里找到起飞的那张，播"飞到中央亮相"的动画。
    events.push({
      type: 'SKILL_PLAYED',
      player: playerId,
      cardId: card.id,
      instanceId: instance.instanceId,
      // 无目标技能不带这个字段，客户端据此决定亮相完是原地淡出还是飞向目标格。
      // 被抵消时也照常带：牌确实是冲着那个 AI 打出去的，客户端先演飞过去、再演抵消，
      // 玩家才看得懂"这一下本来要打谁"。
      ...(target === undefined ? {} : { targetInstanceId: target.instanceId }),
    })
    // 抵消这条排在 SKILL_PLAYED 之后：客户端才能先演出牌、再演抵消。
    if (canceledBy !== null) {
      foe.heroSkillUsed = true
      events.push({
        type: 'SKILL_CANCELED',
        player: playerId,
        by: foe.id,
        heroId: canceledBy,
        cardId: card.id,
        instanceId: instance.instanceId,
      })
    }
    // 遥遥领先：牌照常亮相（以及可能的抵消）播完，本轮才作废跳过。
    // 被格蕾丝·霍珀抵消时不跳——效果作废就是整张牌作废，轮次照常进行。
    if (canceledBy === null && card.effect?.kind === 'end-round-immediately') {
      events.push({ type: 'ROUND_SKIPPED', player: playerId })
      clearRoundMarks(next)
      advanceRound(next, events)
    }
  }
  return { state: next, events }
}

/** 结束本方出牌：先手发就轮到后手，后手发就进答题阶段。 */
function endPlay(state: GameState): ExecuteResult {
  const next = clone(state)
  if (next.activePlayer === next.firstPlayer) {
    next.activePlayer = other(next.firstPlayer)
    return { state: next, events: [{ type: 'PLAY_TURN_STARTED', player: next.activePlayer }] }
  }
  return { state: next, events: enterQuiz(next) }
}

/** 测试房：跳过双方剩下的出牌，直接进答题阶段。 */
function skipToQuiz(state: GameState): ExecuteResult {
  const next = clone(state)
  return { state: next, events: enterQuiz(next) }
}

/** 进答题阶段：揭晓本轮题目全文（含正确答案）。 */
function enterQuiz(state: GameState): GameEvent[] {
  state.phase = 'quiz'
  return [{ type: 'QUESTION_REVEALED', question: currentQuestion(state) }]
}

/**
 * 找出本轮能发动玛格丽特·汉密尔顿「容错系统」的玩家。
 *
 * 发动条件：英雄是玛格丽特、本局技能还没用过、这一批答题结果里有己方 Agent 答错
 * （且不是被李飞飞保送的），并且手牌里还留着至少一张 Agent 牌能补位。都满足才给她机会。
 *
 * 只按座位号返回第一个满足条件的玩家（0 号优先）。双方都是玛格丽特、又都答错的镜像局里，
 * 这一轮只有一方能发动容错系统——这种"同英雄且同轮都答错"的情况很罕见，暂不做双方轮流补位。
 */
function findRescuer(state: GameState, results: AnswerResult[]): PlayerId | null {
  for (const player of state.players) {
    if (player.hero !== 'margaret-hamilton') continue
    if (player.heroSkillUsed) continue
    const hasWrong = results.some((result) => {
      const ai = player.board.find((a) => a.instanceId === result.instanceId)
      return ai !== undefined && !result.correct && ai.guaranteedNextRound === undefined
    })
    if (!hasWrong) continue
    const hasSpare = player.hand.some((card) => getCard(card.cardId).kind === 'ai')
    if (!hasSpare) continue
    return player.id
  }
  return null
}

/**
 * 结算本轮答题。
 *
 * results 由房主/本地 driver 在进入答题阶段后一次性生成，覆盖场上每一个 AI；
 * 对不上就整条拒绝——那说明 driver 拿的是过期状态，宁可什么都不做也别结算出错的局面。
 *
 * 若己方有玛格丽特·汉密尔顿且满足容错系统的发动条件，这里不立刻结算：先把答题结果亮出来
 * （AI_ANSWERED）并暂存，停在 rescue 阶段等她决定补位或跳过，真正的罚下计分交给 resolveRound。
 */
function submitAnswers(state: GameState, results: AnswerResult[]): ExecuteResult {
  const next = clone(state)
  const onBoard = new Set(
    [...next.players[0].board, ...next.players[1].board].map((a) => a.instanceId),
  )
  // 用 delete 的返回值一次挡掉三种情况：混进不在场的、重复提交同一个、漏掉在场的
  // （前两种当场为 false，第三种靠数量相等推出来）。
  if (results.length !== onBoard.size) return reject(state, '答题结果与场上 AI 不符')
  for (const result of results) {
    if (!onBoard.delete(result.instanceId)) return reject(state, '答题结果与场上 AI 不符')
  }

  const rescuerId = findRescuer(next, results)
  if (rescuerId !== null) {
    // 容错系统可发动：先把每个 Agent 答得对不对亮出来，再停下问玩家要不要补位。
    // 这里只揭晓、不罚下——罚下与计分要等 USE_RESCUE / DECLINE_RESCUE 之后才做。
    const events: GameEvent[] = []
    for (const result of results) {
      const owner = next.players.find((p) =>
        p.board.some((a) => a.instanceId === result.instanceId),
      )!
      const ai = owner.board.find((a) => a.instanceId === result.instanceId)!
      events.push({
        type: 'AI_ANSWERED',
        instanceId: ai.instanceId,
        owner: ai.owner,
        correct: result.correct,
        answerText: result.answerText,
      })
    }
    next.phase = 'rescue'
    next.pendingAnswers = results
    next.rescuingPlayer = rescuerId
    events.push({ type: 'RESCUE_OFFERED', player: rescuerId })
    return { state: next, events }
  }

  return resolveRound(next, results, [], { emitAnswered: true })
}

/**
 * 清掉所有"只持续本轮"的标记：AI 身上的提示词/升降级/保送/补位，玩家的金钟罩、
 * 防沉迷出牌上限与计数，以及核电站挂在对局上的全体折扣。
 *
 * 正常答题结算和「遥遥领先」跳轮都要走这里：跳轮虽然不答题，这些标记同样过期作废。
 * 「算力压缩」的折扣是"下一张 AI 牌"级别、跨轮保留直到用掉，所以不在清理之列。
 */
function clearRoundMarks(next: GameState): void {
  for (const player of next.players) {
    for (const ai of player.board) {
      delete ai.promptEffect
      delete ai.roundModelOverride
      delete ai.guaranteedNextRound
      delete ai.rescueSubstitute
    }
    player.skillShielded = false
    player.playsThisRound = 0
    delete player.playLimitThisRound
  }
  delete next.roundCardDiscount
}

/**
 * 推进到下一轮（换先手、给李飞飞恢复技能、补牌、宣告），最后一轮则按现有比分直接终局。
 *
 * 正常结算和「遥遥领先」跳轮共用：跳过的轮不加分，终局比分就是跳轮那一刻的比分。
 */
function advanceRound(next: GameState, events: GameEvent[]): void {
  if (next.round >= next.totalRounds) {
    next.phase = 'finished'
    next.winner =
      next.players[0].score === next.players[1].score
        ? 'draw'
        : next.players[0].score > next.players[1].score
          ? 0
          : 1
    events.push({ type: 'GAME_OVER', winner: next.winner })
    return
  }

  next.round += 1
  // 「再看一眼」不是每局一次，而是每个图片题回合可以选一个 Agent；进入下一轮后恢复可用。
  for (const player of next.players) {
    if (player.hero === 'fei-fei-li') player.heroSkillUsed = false
  }
  next.firstPlayer = other(next.firstPlayer)
  next.activePlayer = next.firstPlayer
  next.phase = 'play'
  // 第 2 轮起每轮开始双方各补牌，起手那 5 张之外的牌都是这么来的（张数见 ROUND_DRAW_SIZE）。
  for (const player of next.players) {
    drawCards(player, ROUND_DRAW_SIZE, events)
  }
  announceRound(next, events)
}

/**
 * 罚下、清理本轮标记、计分，并推进到下一轮或结束整局。
 *
 * `emitAnswered` 决定要不要在这里补发 AI_ANSWERED：正常结算时为 true（逐个揭晓再罚下）；
 * 容错系统跳过（DECLINE_RESCUE）时答题结果已经在 rescue 阶段亮过了，为 false，只补罚下与计分。
 *
 * 传入的 `events` 会被就地追加并原样返回，方便调用方在结算事件前塞入 RESCUE_RESOLVED 之类的前置事件。
 */
function resolveRound(
  next: GameState,
  results: AnswerResult[],
  events: GameEvent[],
  { emitAnswered }: { emitAnswered: boolean },
): ExecuteResult {
  for (const result of results) {
    // 调用方已校验 results 和场上一一对应，所以这里必定找得到人。
    const owner = next.players.find((p) =>
      p.board.some((a) => a.instanceId === result.instanceId),
    )!
    const index = owner.board.findIndex((a) => a.instanceId === result.instanceId)
    const ai = owner.board[index]!
    if (emitAnswered) {
      events.push({
        type: 'AI_ANSWERED',
        instanceId: ai.instanceId,
        owner: ai.owner,
        correct: result.correct,
        answerText: result.answerText,
      })
    }
    if (!result.correct && ai.guaranteedNextRound === undefined) {
      owner.board.splice(index, 1)
      owner.discard.push({
        instanceId: ai.instanceId,
        cardId: ai.cardId,
        owner: ai.owner,
      })
      events.push({ type: 'AI_ELIMINATED', instanceId: ai.instanceId, owner: ai.owner })
    }
  }

  clearRoundMarks(next)

  // 计分：罚下之后各自数一遍还站着几个 AI，就是本轮拿多少分。
  // 场上一个 AI 都没有也照样走完剩下的轮次，只是这轮拿 0 分。
  const gains: [number, number] = [next.players[0].board.length, next.players[1].board.length]
  next.players[0].score += gains[0]
  next.players[1].score += gains[1]
  const scores: [number, number] = [next.players[0].score, next.players[1].score]
  events.push({ type: 'ROUND_SCORED', gains, scores })

  advanceRound(next, events)
  return { state: next, events }
}

/**
 * 玛格丽特·汉密尔顿「容错系统」：用手牌里的一个 Agent 补位，替下一个答错的己方 Agent 重答本题。
 *
 * 替补顶掉那个答错 Agent 的战场位置，答错的原 Agent 进弃牌堆；随后局面退回 quiz 阶段，
 * 等 driver 为新的场面重新生成一份答题结果（替补答对与否由新结果决定）。多个 Agent 同时答错时，
 * 只替下按场上顺序的第一个——一次补位只能救一个。
 */
function useRescue(
  state: GameState,
  playerId: PlayerId,
  substituteInstanceId: InstanceId,
): ExecuteResult {
  if (state.phase !== 'rescue') return reject(state, '现在不能发动容错系统')
  const next = clone(state)
  if (next.rescuingPlayer !== playerId) return reject(state, '现在不是你发动容错系统的时机')
  const pending = next.pendingAnswers
  if (pending === undefined) return reject(state, '没有待处理的答题结果')

  const player = next.players[playerId]
  const handIndex = player.hand.findIndex((c) => c.instanceId === substituteInstanceId)
  if (handIndex < 0) return reject(state, '手牌里没有这张卡')
  const handInstance = player.hand[handIndex]!
  if (getCard(handInstance.cardId).kind !== 'ai') return reject(state, '补位的必须是一张 Agent 牌')

  // 找出这一批结果里第一个答错、且没被保送的己方 Agent。
  const wrong = pending.find((result) => {
    const ai = player.board.find((a) => a.instanceId === result.instanceId)
    return ai !== undefined && !result.correct && ai.guaranteedNextRound === undefined
  })
  if (wrong === undefined) return reject(state, '没有可以补位的答错 Agent')
  const boardIndex = player.board.findIndex((a) => a.instanceId === wrong.instanceId)
  const failed = player.board[boardIndex]!

  player.hand.splice(handIndex, 1)
  player.discard.push({ instanceId: failed.instanceId, cardId: failed.cardId, owner: playerId })
  player.board[boardIndex] = {
    instanceId: handInstance.instanceId,
    cardId: handInstance.cardId,
    owner: playerId,
    rescueSubstitute: 'margaret-hamilton',
  }
  player.heroSkillUsed = true

  // 退回 quiz 阶段，等重新答题：暂存的旧结果作废（新场面会生成新结果）。
  delete next.pendingAnswers
  delete next.rescuingPlayer
  next.phase = 'quiz'
  return {
    state: next,
    events: [
      {
        type: 'RESCUE_RESOLVED',
        player: playerId,
        used: true,
        substituteInstanceId: handInstance.instanceId,
        replacedInstanceId: failed.instanceId,
      },
    ],
  }
}

/** 玛格丽特·汉密尔顿「容错系统」：放弃补位，按暂存结果直接结算本轮。 */
function declineRescue(state: GameState, playerId: PlayerId): ExecuteResult {
  if (state.phase !== 'rescue') return reject(state, '现在没有可放弃的容错系统')
  const next = clone(state)
  if (next.rescuingPlayer !== playerId) return reject(state, '现在不是你发动容错系统的时机')
  const pending = next.pendingAnswers
  if (pending === undefined) return reject(state, '没有待处理的答题结果')

  delete next.pendingAnswers
  delete next.rescuingPlayer
  // 答题结果已在 rescue 阶段揭晓过，这里只补罚下与计分，不再重复 AI_ANSWERED。
  const events: GameEvent[] = [{ type: 'RESCUE_RESOLVED', player: playerId, used: false }]
  return resolveRound(next, pending, events, { emitAnswered: false })
}

/** 宣告新一轮开始并让先手行动。开局和每轮换手都走这里，保证两处事件序一致。 */
function announceRound(state: GameState, events: GameEvent[]): void {
  events.push({
    type: 'ROUND_STARTED',
    round: state.round,
    firstPlayer: state.firstPlayer,
    category: currentQuestion(state).category,
  })
  events.push({ type: 'PLAY_TURN_STARTED', player: state.firstPlayer })
}

/**
 * 本轮的题。
 * round 由引擎自己推进且永远不超过 totalRounds，取不到只可能是外部塞了一份坏状态，
 * 属于数据错误而不是玩家操作能触发的情况，所以直接抛错而不是回 COMMAND_REJECTED。
 */
function currentQuestion(state: GameState): Question {
  const question = state.questions[state.round - 1]
  if (!question) throw new Error(`第 ${state.round} 轮没有对应的题目`)
  return question
}

/** 抽牌。牌堆空了就是抽不到，不做疲劳伤害——牌组比一局用得到的张数长，先不管。 */
function drawCards(player: PlayerState, count: number, events: GameEvent[]): void {
  for (let i = 0; i < count; i++) {
    const card = player.deck.pop()
    if (!card) return
    player.hand.push(card)
    events.push({ type: 'CARD_DRAWN', player: player.id, card })
  }
}

/**
 * 测试房：给某位玩家加一张手牌。
 *
 * 不带 cardId 就是正常从牌堆抽一张；带 cardId 则凭空造一张新实例塞进手牌，牌堆不动，
 * 这样想测某张卡不用先把牌组调成一水儿的那张卡。
 */
function debugAddCard(state: GameState, playerId: PlayerId, cardId?: CardId): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const events: GameEvent[] = []

  if (cardId === undefined) {
    if (player.deck.length === 0) return reject(state, '牌堆已空')
    drawCards(player, 1, events)
    return { state: next, events }
  }

  // 这里直接查表而不用 getCard：cardId 是客户端传来的，写错很正常，
  // 得退一条 COMMAND_REJECTED 回去，不能让 getCard 抛的异常把房主的引擎打断。
  if (!CARDS[cardId]) return reject(state, `未知卡牌：${cardId}`)
  const card: CardInstance = {
    // 凭空造的牌不属于任何一副牌组，用 dbg- 前缀跟发牌时的 p0-c3 这类 id 区分开。
    instanceId: `dbg-${next.seq++}`,
    cardId,
    owner: playerId,
  }
  player.hand.push(card)
  // 复用 CARD_DRAWN：对客户端来说"手上多了一张牌"要播的动画是一样的。
  events.push({ type: 'CARD_DRAWN', player: playerId, card })
  return { state: next, events }
}

/** 测试房：弃掉某位玩家的一张手牌，不填 instanceId 就弃最后一张。 */
function debugRemoveCard(
  state: GameState,
  playerId: PlayerId,
  instanceId?: InstanceId,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  if (player.hand.length === 0) return reject(state, '手牌为空')

  const index =
    instanceId === undefined
      ? player.hand.length - 1
      : player.hand.findIndex((c) => c.instanceId === instanceId)
  if (index < 0) return reject(state, '手牌里没有这张卡')

  const removed = player.hand.splice(index, 1)[0]!
  player.discard.push(removed)
  return {
    state: next,
    events: [{ type: 'CARD_REMOVED', player: playerId, instanceId: removed.instanceId }],
  }
}

function reject(state: GameState, reason: string): ExecuteResult {
  return { state, events: [{ type: 'COMMAND_REJECTED', reason }] }
}

export function other(playerId: PlayerId): PlayerId {
  return playerId === 0 ? 1 : 0
}

/**
 * JSON 深拷贝。
 * 慢，但顺带把"GameState 必须可序列化"这条约束钉死了：
 * 一旦有人往状态里塞函数或 Map，拷贝会立刻丢数据暴露问题。
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Fisher-Yates 洗牌。rng 会被就地推进，所以用同一个生成器连洗两副牌不会得到相同顺序。 */
function shuffle<T>(items: readonly T[], rng: RandomGenerator): T[] {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = uniformInt(rng, 0, i)
    const tmp = result[i]!
    result[i] = result[j]!
    result[j] = tmp
  }
  return result
}

/**
 * 「内存紧缺」用的确定性种子。
 *
 * execute 全程不许摸真随机（同一 seed + 同一串指令要能复现，房主客人才算得出同一份结果），
 * 所以这里从当前局面本身派生出一个整数种子：把开局种子、轮次、下一实例序号，
 * 以及双方场上所有单位的实例 id 揉进一个 32 位哈希。同一份局面必然得到同一个种子，
 * 换一份局面（哪怕只差一个在场单位）种子就变，不会每轮都掷出同一批弃牌。
 */
function memoryShortageSeed(state: GameState): number {
  const ids = [...state.players[0].board, ...state.players[1].board].map((ai) => ai.instanceId)
  const material = `${state.round}|${state.seq}|${ids.join(',')}`
  // FNV-1a 32 位：够散、实现短，且不依赖任何平台特有的数值行为。
  let hash = 0x811c9dc5
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * 从 [0, size) 里等概率挑 count 个互不相同的下标，返回时按从大到小排序。
 *
 * 倒序返回是给调用方就地 splice 用的：从大下标先删，删一个不会打乱还没删的小下标。
 * rng 会被就地推进。count ≥ size 时返回全部下标。
 */
function pickDistinctIndices(rng: RandomGenerator, size: number, count: number): number[] {
  const pool = Array.from({ length: size }, (_, i) => i)
  // 部分 Fisher-Yates：只洗出前 count 个就够，把选中的搬到数组尾部再截出来。
  const picked: number[] = []
  for (let k = 0; k < count && pool.length > 0; k++) {
    const j = uniformInt(rng, 0, pool.length - 1)
    picked.push(pool[j]!)
    pool.splice(j, 1)
  }
  return picked.sort((a, b) => b - a)
}
