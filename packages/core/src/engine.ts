// pure-rand v8 只提供子路径入口，没有包根入口，所以这几行 import 看起来才这么长。
import { uniformInt } from 'pure-rand/distribution/uniformInt'
// 用 mersenne 而不是更快的 xoroshiro128plus：后者从整数种子起步时，
// 相邻种子头几个输出的低位是强相关的（实测连续种子掷硬币有约 65% 概率翻面，
// 空转多少次都甩不掉），而这里的 seed 就是 Date.now()，会掷出"隔一毫秒换一次先手"的规律。
// mersenne 的种子扩散做得干净，连续种子的首个输出实测就是均匀且互不相关的。
import { mersenne } from 'pure-rand/generator/mersenne'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import { downgradeTargetOf, upgradeTargetOf } from './aiModels'
import { CARDS, getCard } from './cards'
import { QUESTION_POOL } from './questions'
import type {
  AiCard,
  AiInstance,
  AnswerResult,
  CardId,
  CardInstance,
  Command,
  ExecuteResult,
  GameEvent,
  GameState,
  HandCard,
  HeroId,
  InstanceId,
  PlayerId,
  PlayerState,
  Question,
  RoundVerdict,
  SkillCard,
} from './types'

/** 开局手牌数。黑客松阶段不做先后手补偿，双方一样。 */
export const STARTING_HAND_SIZE = 5

/**
 * 第 2 轮起每轮开始双方各补几张。
 *
 * 一张时手牌只出不进，打到后面双方常常无牌可打、只能干等着答题；两张才够一轮出一两张的消耗。
 * 一局最多摸 5 + 4 轮 × 2 = 13 张，预设牌组各 20 张（见 cards.ts 的 PRESET_DECKS）管得住，
 * 不会中途抽空。改大到摸得空牌堆也不会出错（drawCards 抽不到就算了），只是画面上会一直显示 0。
 */
export const ROUND_DRAW_SIZE = 2

/**
 * 第 1 轮的 Token 上限。
 *
 * 5 点买得起最便宜的两三张 AI 牌（费用区间是 1~7，见 aiModels.ts），
 * 又买不起 ChatGPT 5.6 Sol 那种 7 点的顶配，开局就得做取舍。
 * 一轮里 AI 牌和技能牌都不限张数，Token 就是唯一的额度，
 * 而且省着花本身有意义——答对数量相同时比的就是本轮消耗（见 submitAnswers）。
 */
export const INITIAL_TOKEN_MAX = 5

/**
 * 每答完一题，Token 上限涨这么多。
 *
 * 上限只涨不减，所以第 n 轮的上限恒为 INITIAL_TOKEN_MAX + (n - 1) × 这个数；
 * 右侧栏那排星星的格子数就是它算出来的，超过 8 格会自动折成两列。
 * 涨得慢（每轮 1 点）是有意的：一局最短 3 轮就结束，涨太快的话最后一轮想买什么买什么，
 * 「省 Token」这条决胜线就没有分量了。
 */
export const TOKEN_MAX_GROWTH = 1

/**
 * 先拿到这么多分就赢。
 *
 * 但必须**独自**达到：双方同时到线（答对数和消耗相同，各 +1）时不判胜负，继续加赛，
 * 直到某一轮结束后一方分数单独领先（见 submitAnswers）。
 * 题库出完仍未分出的兜底也在那里：总分高者胜，相同才是 'draw'。
 */
export const WIN_TARGET = 3

/**
 * 阿达·洛芙莱斯的「第一算法」给自己加多少 Token 上限。
 *
 * 只在开局加这一次就够贯穿整局：confirmRound 走的是 `tokenMax += TOKEN_MAX_GROWTH` 的增量逻辑，
 * 加高的起点会一路带下去（第 1 轮 7、第 2 轮 8、第 3 轮 9……恒比对手多 2）。
 * 这是**有意的「全程上限 +2」**，不是只加第一轮，改成每轮重算反而会把技能削掉。
 * 一局最短 3 轮（先到 WIN_TARGET 分），所以这 +2 差不多等于白送一张中费 AI 牌，分量不小。
 */
export const ADA_TOKEN_MAX_BONUS = 2

/** 没指定英雄时用谁。留一个兜底是为了让「不关心英雄」的调用方（大多是测试）能少写一个字段。 */
const DEFAULT_HERO: HeroId = 'grace-hopper'

/**
 * 状态内随机种子的取值上界。
 *
 * 取 2^31 - 1 而不是更大的数：种子要跟着 GameState 走 JSON，
 * 停在 32 位有符号整数范围内最不容易在序列化两端出岔子。
 */
const RNG_SEED_MAX = 0x7fffffff

/**
 * 一张牌对这位玩家的**实际费用**：卡面费用减去本轮的核电站减免，最低 1 点。
 *
 * 客户端的"打不起就变灰"和引擎的扣费校验必须用同一个数，所以这个函数导出给 client 用——
 * 两边各算一遍的话，玩家会遇到"看着能打，点下去说 Token 不够"。
 *
 * 金钟罩期间返回卡面原价：那张牌的口径是字面全挡，对自己有利的减费也一样挡在外面
 * （完整口径见 types.ts 的 `PlayerState.shielded`）。
 */
export function effectivePlayCost(state: GameState, playerId: PlayerId, card: HandCard): number {
  if (state.players[playerId].shielded === true) return card.tokenCost
  return Math.max(1, card.tokenCost - state.costReduction)
}

export interface PlayerSetup {
  name: string
  /** 牌组，元素是卡牌定义 id，可以重复。 */
  deck: CardId[]
  /**
   * 这一方的英雄，不填就是 DEFAULT_HERO。
   * 联机对局双方都会明确传（匹配后的选英雄那一步，见 client 的 RoomScreen）；
   * 测试房只在存档里存过英雄时才传，没存过就吃默认值。
   * 传 null 表示这一方不带英雄（现在只有测试会这么用）。
   */
  hero?: HeroId | null
}

export interface GameSetup {
  /** 洗牌种子。同一个种子 + 同一串指令 = 同一场对局，先手也由它掷出。 */
  seed: number
  players: [PlayerSetup, PlayerSetup]
  /**
   * 指定本局的题序，不填就把整个题库洗一遍（noShuffle 时按题库原序）。
   * 留这个口子是给测试、调试和教程用的：只塞一两道题，一两轮就能打到 GAME_OVER，
   * 不必为了看结算界面把整局走完。传进来的顺序原样使用，不再洗。
   */
  questions?: Question[]
  /**
   * 指定第一轮先手，跳过抛硬币。之后每轮照常交换。
   *
   * 教程用：先后手是教学脚本的一部分（第 1 轮玩家先手学出牌、第 2 轮对手先手好让干扰技能
   * 有目标），不能靠掷硬币碰运气。
   * 填了就**不消耗那次随机数**（整个跳过，不是掷完丢掉），所以同一个 seed 下改先手，
   * 后面洗出来的牌堆和题序一字不差——排剧本时定牌序和定先手互不牵连。
   * 反过来，指定先手和不指定先手在同一个 seed 上洗出来的牌不一样，那是两种玩法，本就不必对齐。
   * `GAME_STARTED` 事件照常带 firstPlayer，客户端的抛硬币过场不用为它改。
   */
  firstPlayer?: PlayerId
  /**
   * 双方牌组和题库都按传入顺序原样使用，不洗。
   *
   * 教程用：起手 5 张和每轮抽到的牌要完全由教学牌组的排列决定。
   * **抽牌是从数组末尾取的**（牌堆顶在末尾，见 drawCards），所以排剧本时要把最先抽到的牌
   * 放在牌组数组的**最后**——想让起手是 A、B、C、D、E，牌组就得写成 `[..., E, D, C, B, A]`。
   * 题库相反，是从头往后按轮次取的（questions[round - 1]）。
   */
  noShuffle?: boolean
}

/**
 * 开一局：建好双方状态、洗牌、洗题序、抛硬币定先手、发起始手牌，
 * 最后给状态留一颗随机种子。
 *
 * 开局这一串随机（先手、两副牌堆、题序）在这里一次掷完，之后抽牌就是从牌堆末尾 pop、
 * 题目按洗好的顺序逐轮取，都不再需要随机。
 * `execute` 里只剩「内存紧缺」一处要掷随机，它用的是状态里的 `rngSeed`
 * （为什么不能把生成器本身塞进状态见 types.ts 的 `GameState.rngSeed`）。
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
    // 用 === undefined 而不是 ??：null 是"这一方明确不带英雄"，不能被默认值盖掉。
    // 英雄初始化不碰 rng，所以加了它也不影响下面抛硬币/洗牌那串随机数的顺序。
    const hero = config.hero === undefined ? DEFAULT_HERO : config.hero
    // 阿达·洛芙莱斯的「第一算法」是开局就算进数值的被动，不占 heroSkillUsed 那个标志。
    const tokenMax = INITIAL_TOKEN_MAX + (hero === 'ada-lovelace' ? ADA_TOKEN_MAX_BONUS : 0)
    return {
      id,
      name: config.name,
      score: 0,
      // 开局就是满的：第 1 轮双方各 INITIAL_TOKEN_MAX 点（阿达再加 ADA_TOKEN_MAX_BONUS），
      // 之后每轮补满并涨 TOKEN_MAX_GROWTH（见 confirmRound 那段）。
      tokens: tokenMax,
      tokenMax,
      spentThisRound: 0,
      hand: [],
      deck: setup.noShuffle === true ? deck : shuffle(deck, rng),
      board: [],
      discard: [],
      hero,
      heroSkillUsed: false,
    }
  }

  // 抛硬币定第一轮先手，之后每轮交换，所以只掷这一次。
  // 放在洗牌之前是有意的：洗牌会按牌组长度推进 rng，先手要是排在后面，
  // 换一副牌组或换一份题库就会掷出另一个结果，"同一个 seed 谁先手"这件事就不好复盘了。
  // setup 指定了先手就整个跳过这一掷（?? 的右边根本不求值），不消耗那次随机数。
  // 于是同一个 seed 下改先手不会连带把牌堆和题序也洗成另一副，
  // 教程排剧本时"先定牌序、再单独安排谁先手"这两件事才互不牵连。
  // 代价是指定先手和不指定先手在同一个 seed 上洗出来的牌不一样——那是两种玩法，本就不必对齐。
  const firstPlayer: PlayerId =
    setup.firstPlayer ?? (uniformInt(rng, 0, 1) === 0 ? 0 : 1)
  // 先建好两个玩家再组装 state：makePlayer 会推进 seq，
  // 写在对象字面量里的话 seq 那一行会按书写顺序取到发牌前的旧值。
  const players: [PlayerState, PlayerState] = [
    makePlayer(0, setup.players[0]),
    makePlayer(1, setup.players[1]),
  ]
  const questions = setup.questions
    ? setup.questions.slice()
    : setup.noShuffle === true
      ? QUESTION_POOL.slice()
      : shuffle(QUESTION_POOL, rng)

  const state: GameState = {
    round: 1,
    totalRounds: questions.length,
    firstPlayer,
    activePlayer: firstPlayer,
    phase: 'play',
    questions,
    players,
    winner: null,
    settleConfirmed: [false, false],
    costReduction: 0,
    // 这颗种子必须排在洗牌、洗题序**之后**取：rng 是就地推进的，往前插一次取值
    // 会把后面所有随机的结果整体挪位，"哪个 seed 谁先手、牌堆什么顺序"这些既有对应关系
    // 全部作废（测试里那两个先手种子就是查出来的现成答案）。
    rngSeed: uniformInt(rng, 0, RNG_SEED_MAX),
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
    case 'USE_HERO_SKILL':
      // 和出牌同一道门槛：只能在自己的出牌轮发动。技能本身免费，也不会结束这一轮出牌。
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      if (command.player !== state.activePlayer) return reject(state, '还没轮到你出牌')
      return useHeroSkill(state, command.player, command.targetInstanceId)
    case 'SUBMIT_ANSWERS':
      if (state.phase !== 'quiz') return reject(state, '现在不是答题阶段')
      return submitAnswers(state, command.results)
    case 'CONFIRM_ROUND':
      if (state.phase !== 'settle') return reject(state, '现在不是回合结算阶段')
      return confirmRound(state, command.player)
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
 * 打出一张手牌。
 *
 * 只有一道闸：每张牌按 effectivePlayCost 算出来的实际费用扣 Token、扣不起就整条拒绝。
 * AI 牌和技能牌都不限张数，一轮里 Token 够就能接着打。
 * 实际费用不一定等于卡面 tokenCost：核电站会给它减价，见 effectivePlayCost。
 * 另外只有卡面标了 `target` 的技能牌要指定目标。
 */
function playCard(
  state: GameState,
  playerId: PlayerId,
  instanceId: InstanceId,
  targetInstanceId?: InstanceId,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const foe = next.players[other(playerId)]
  const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId)
  if (handIndex < 0) return reject(state, '手牌里没有这张卡')

  const instance = player.hand[handIndex]!
  const card = getCard(instance.cardId)
  const cost = effectivePlayCost(next, playerId, card)

  // 费用排在选目标之前：Token 不够的话这张牌根本不该进"指定目标"那一步，
  // 否则客户端会先让玩家挑完目标、再回一句打不起，白挑一次。
  if (player.tokens < cost) {
    return reject(state, `Token 不够：这张牌要 ${cost} 点，只剩 ${player.tokens} 点`)
  }

  // 目标和前置条件先校验完再动手牌：拒绝要退回原样的 state（reject 回的就是传进来那份），
  // 而下面这些改动全落在副本 next 上，顺序写反了以后加分支时容易漏掉。
  // 找到的目标是 next 里的那一份，后面直接改它就行。
  let target: AiInstance | undefined
  let handTarget: CardInstance | undefined
  if (card.kind === 'skill') {
    const denied = denyReason(next, playerId, card, targetInstanceId)
    if (denied !== null) return reject(state, denied)
    if (card.target === 'own-hand-ai') {
      handTarget = player.hand.find((c) => c.instanceId === targetInstanceId)
    } else if (card.target !== undefined) {
      const owner = card.target === 'foe-ai' ? foe : player
      target = owner.board.find((a) => a.instanceId === targetInstanceId)
    }
  }

  player.hand.splice(handIndex, 1)
  // 扣费和抽走手牌绑在一起：上面所有会拒绝的分支都已经走完，到这里这张牌必定打得出去。
  player.tokens -= cost
  // 同一笔钱记两处：tokens 是"还剩多少"，会在进下一轮时被补满冲掉；
  // spentThisRound 是"这一轮花了多少"，结算要用它比大小，所以得单独攒着。
  // 技能牌待会儿被英雄技能抵消也不退——Token 是真花出去的，作废的只是效果。
  // 答对数量相同时比的就是这个数（见 submitAnswers），所以这一笔记的是实际费用而不是卡面
  // tokenCost：核电站减了价，真正付出去的就是减价后那个数。
  player.spentThisRound += cost

  const events: GameEvent[] = []
  if (card.kind === 'ai') {
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
    // 「这张会不会被抵消」——被抵消的干扰技能不能给目标盖上 interference，
    // 否则玩家会看到"技能被抵消了，那个 AI 却再也不能被干扰"这种自相矛盾的局面。
    // 每张技能牌的效果都写在下面 applySkillEffect 里，而它只在 canceledBy === null 时被调用。
    const canceledBy: HeroId | null =
      foe.hero === 'grace-hopper' && !foe.heroSkillUsed ? foe.hero : null

    // 带上 instanceId 不是结算需要，是给客户端定位用的：技能牌打出后就进弃牌堆，
    // 客户端只能靠这个 id 在出牌方的手牌里找到起飞的那张，播"飞到中央亮相"的动画。
    events.push({
      type: 'SKILL_PLAYED',
      player: playerId,
      cardId: card.id,
      instanceId: instance.instanceId,
      // 无目标技能、以及打向手牌的模型蒸馏都不带这个字段，客户端据此决定亮相完是原地淡出
      // 还是飞向战场上的某个格子。
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
    } else {
      // 效果事件跟在 SKILL_PLAYED 后面：客户端先演牌打出去，再演它造成了什么。
      applySkillEffect(next, playerId, card, target, handTarget, events)
    }
  }
  return { state: next, events }
}

/**
 * 这张技能牌现在打不打得出去：能打返回 null，不能打返回**直接给玩家看的**那句理由。
 *
 * 拆成单独一个函数是因为这里全是"看一眼就退回去"的检查，一条都不许改状态；
 * 和下面真正动局面的 applySkillEffect 分开写，加新牌时不容易把校验混进结算。
 */
function denyReason(
  state: GameState,
  playerId: PlayerId,
  card: SkillCard,
  targetInstanceId: InstanceId | undefined,
): string | null {
  const player = state.players[playerId]
  const foe = state.players[other(playerId)]

  // 金钟罩「字面全挡」的一半在这里：这三档目标的效果全部落在打出方自己身上，
  // 自己正罩着的时候打出去必定一点作用都没有，与其让玩家白花 Token，不如当场拒掉。
  // 另一半（群体牌跳过被罩的一方、被罩的一方不吃减费）分别在 applySkillEffect
  // 和 effectivePlayCost 里。
  const selfTargeted =
    card.target === 'own-ai' || card.target === 'own-affected-ai' || card.target === 'own-hand-ai'
  if (selfTargeted && player.shielded === true) {
    return '金钟罩生效中，本轮技能牌也影响不到你自己'
  }
  // 金钟罩自己是全挡口径唯一的例外（否则第一张就把自己挡住、这张牌永远打不出去），
  // 所以要单独拦住"再打一张"：第二张什么都不会改变，纯属白扔 7 点。
  if (card.id === 'golden-bell-shield' && player.shielded === true) {
    return '本轮已经有金钟罩了'
  }
  if (card.target === undefined) return null
  if (card.target === 'foe-ai' && foe.shielded === true) {
    return '对方金钟罩生效中，技能牌影响不到他的 Agent'
  }
  if (targetInstanceId === undefined) return '这张技能牌要先指定目标'

  if (card.target === 'own-hand-ai') {
    const inHand = player.hand.find((c) => c.instanceId === targetInstanceId)
    // 技能牌自己也在手牌里，但它不是 AI 牌，所以这一条顺带挡住了"拿自己当目标"。
    if (inHand === undefined || getCard(inHand.cardId).kind !== 'ai') {
      return '目标必须是你手牌里的一张 AI 牌'
    }
    return null
  }

  const owner = card.target === 'foe-ai' ? foe : player
  const target = owner.board.find((a) => a.instanceId === targetInstanceId)
  // "选错了人"和"这个人不符合条件"分开报：玩家该看到的提示不一样。
  if (target === undefined) {
    return card.target === 'foe-ai' ? '目标必须是对方场上的 AI' : '目标必须是你自己场上的 AI'
  }
  switch (card.target) {
    case 'foe-ai':
      // 一个 AI 同时只挂一种干扰，已经挂着的不能再被选。
      return target.interference === undefined ? null : '这个 AI 已经被干扰过了'
    case 'own-ai':
      return target.safePassed === true ? '这个 AI 已经被保送了' : null
    case 'own-affected-ai':
      // 玉净瓶要有东西可移除才打得出去，空放一张 2 点的牌不合算，也没法给玩家交代。
      return target.interference === undefined ? '这个 AI 身上没有可以移除的效果' : null
  }
}

/**
 * 一张技能牌打出后真正改局面的那一步，只在"没被英雄技能抵消"时调用。
 *
 * 按 `card.id` 分派而不是按 `target`：目标只说明"选谁"，选中之后要干什么是每张牌自己的事。
 * 24 张里 10 张在这里有分支，其余的落到 default——那些还是占位牌，打出即进弃牌堆。
 *
 * `target` / `handTarget` 由 playCard 校验完传进来，用得上它们的分支必定拿得到值，
 * 所以下面直接用 `!`。
 */
function applySkillEffect(
  state: GameState,
  playerId: PlayerId,
  card: SkillCard,
  target: AiInstance | undefined,
  handTarget: CardInstance | undefined,
  events: GameEvent[],
): void {
  const player = state.players[playerId]
  switch (card.id) {
    // 干扰两张：记下是被哪张打中的，答题时按这个种类去查对应那一档的预生成回答
    // （见 script.ts；写字面量而不是 card.id 是为了对上 InterferenceCardId 的类型）。
    // 这个函数只在没被英雄技能抵消时才被调用，所以被抵消的那一下目标身上什么都不会留。
    case 'fixed-answer':
      target!.interference = 'fixed-answer'
      markAffected(target!, 'fixed-answer')
      return
    case 'black-white-reversal':
      target!.interference = 'black-white-reversal'
      markAffected(target!, 'black-white-reversal')
      return
    case 'jade-purification-vase': {
      // 解掉干扰之后这个 AI 又是"没被干扰过"的了，本轮还可能被对面再打一张。
      // 被解掉的那张也要从 affectedBy 里撤掉，否则小卡会一直挂着「复读中」这种已经不存在的角标；
      // 换上玉净瓶自己这一笔，玩家才看得出这个单位本轮被净化过（也就是还吃得下一张干扰）。
      const cleansed = target!.interference!
      delete target!.interference
      unmarkAffected(target!, cleansed)
      markAffected(target!, 'jade-purification-vase')
      return
    }
    case 'safe-pass':
      target!.safePassed = true
      markAffected(target!, 'safe-pass')
      return
    case 'golden-bell-shield':
      player.shielded = true
      return
    case 'nuclear-power-station':
      state.costReduction += 1
      return
    case 'model-distillation': {
      // 手牌数组在打出这张技能牌时已经变短了，所以要按 id 重新定位那张 AI 牌。
      const index = player.hand.findIndex((c) => c.instanceId === handTarget!.instanceId)
      const removed = player.hand.splice(index, 1)[0]!
      player.discard.push(removed)
      // 用印刷费用而不是 effectivePlayCost：核电站减的是"打出去要花多少"，
      // 不该连带把回收价也压下去。
      // 换来的 Token 可能顶破 tokenMax，这是有意允许的——多出来的部分在下一轮补满时被覆盖。
      player.tokens += getCard(removed.cardId).tokenCost
      events.push({ type: 'CARD_REMOVED', player: playerId, instanceId: removed.instanceId })
      return
    }
    case 'memory-shortage':
      // 一次 withRng 覆盖双方：两边各洗一次也行，但那样每打一张牌种子要推进两次，
      // 复盘时不好数。
      withRng(state, (rng) => {
        for (const side of state.players) {
          if (side.shielded === true) continue
          // 空场就什么都不发生：这张牌允许打空（对面也许正好被清干净了）。
          if (side.board.length === 0) continue
          const keep = Math.ceil(side.board.length / 2)
          const survivors = new Set(
            shuffle(
              side.board.map((a) => a.instanceId),
              rng,
            ).slice(0, keep),
          )
          removeFromBoard(side, (ai) => !survivors.has(ai.instanceId), card.id, events)
        }
      })
      return
    case 'domestic-substitution':
      for (const side of state.players) {
        if (side.shielded === true) continue
        removeFromBoard(side, (ai) => boardCard(ai).domestic !== true, card.id, events)
      }
      return
    case 'rising-tide':
      for (const side of state.players) {
        if (side.shielded === true) continue
        for (const ai of side.board) {
          const toCardId = boardCard(ai).evolvesTo
          if (toCardId === undefined) continue
          const fromCardId = ai.cardId
          // 只换卡面身份：instanceId 不变，interference / safePassed 也跟着这个单位留下，
          // 因为它还是刚才那个单位，只是升了一级。
          ai.cardId = toCardId
          // 换脸本身不在单位上留任何状态（levelShift 是英雄技能专用的，见 types.ts），
          // 不补这一笔的话，本轮结束前谁都看不出这个单位是被哪张牌变成现在这副样子的。
          markAffected(ai, 'rising-tide')
          events.push({
            type: 'AI_TRANSFORMED',
            instanceId: ai.instanceId,
            owner: ai.owner,
            fromCardId,
            toCardId,
          })
        }
      }
      return
    default:
      // 其余 14 张还是占位牌：打出即进弃牌堆，什么都不发生（名单见 skillCards.ts）。
      return
  }
}

/**
 * 记一笔"这个单位本轮被这张技能牌打中过"，只给界面画角标和放大查看时列牌名用
 *（字段口径见 types.ts 的 `AiInstance.affectedBy`）。
 *
 * 效果落在场上单位身上的技能牌都要调它一次，不然那张牌打出去战场上不留痕迹。
 * 同一张牌不会重复记：干扰和保送本来就不允许打第二次，玉净瓶要有干扰可解，
 * 「鸡犬升天」倒是一轮里能连打两张，但两次说的是同一件事（这个单位被升级过），
 * 挂两枚一模一样的角标只是把小卡糊住。
 */
function markAffected(ai: AiInstance, cardId: CardId): void {
  const list = ai.affectedBy ?? []
  if (!list.includes(cardId)) list.push(cardId)
  ai.affectedBy = list
}

/**
 * 撤掉一笔（效果被别的牌移除了，眼下只有玉净瓶解干扰这一处）。
 * 撤到空就把字段整个删掉，让"没被打过的单位不带这一项"这条始终成立。
 */
function unmarkAffected(ai: AiInstance, cardId: CardId): void {
  const list = (ai.affectedBy ?? []).filter((id) => id !== cardId)
  if (list.length === 0) delete ai.affectedBy
  else ai.affectedBy = list
}

/**
 * 把场上符合条件的单位移进弃牌堆，各发一条 AI_REMOVED。
 *
 * 留下的按原顺序排好，客户端的战场格子才不会因为清场而整排重新洗位置。
 * `by` 是干这件事的那张技能牌，客户端靠它给不同的牌配不同的演出。
 */
function removeFromBoard(
  player: PlayerState,
  doomed: (ai: AiInstance) => boolean,
  by: CardId,
  events: GameEvent[],
): void {
  const removed = player.board.filter(doomed)
  player.board = player.board.filter((ai) => !doomed(ai))
  for (const ai of removed) {
    player.discard.push({ instanceId: ai.instanceId, cardId: ai.cardId, owner: ai.owner })
    events.push({
      type: 'AI_REMOVED',
      instanceId: ai.instanceId,
      owner: ai.owner,
      // 事件发出时这个单位已经不在场上了，界面要画它只剩这里这一份卡面身份。
      cardId: ai.cardId,
      by,
    })
  }
}

/**
 * 场上单位的卡面定义。
 * board 里只可能站着 AI 牌，查出别的说明有人把技能牌塞进了场上，属于数据错误而不是
 * 玩家操作能触发的情况，所以和 getCard 一样直接抛错。
 */
function boardCard(ai: AiInstance): AiCard {
  const card = getCard(ai.cardId)
  if (card.kind !== 'ai') throw new Error(`场上出现了非 AI 牌：${ai.cardId}`)
  return card
}

/**
 * 用状态里的种子跑一次随机，跑完把下一颗种子写回状态。
 *
 * 这样引擎既保持"同一份状态 + 同一条指令 = 同一个结果"，又不用把生成器本身
 * （不可 JSON 序列化）塞进状态。联机时房主广播完快照，客人手上的种子和房主一致。
 */
function withRng<T>(state: GameState, use: (rng: RandomGenerator) => T): T {
  const rng = mersenne(state.rngSeed)
  const result = use(rng)
  state.rngSeed = uniformInt(rng, 0, RNG_SEED_MAX)
  return result
}

/**
 * 发动主动英雄技能：把场上一个 AI 换成同系列的上一代或下一代。
 *
 * 两位英雄共用这一条路径，升还是降、目标该在哪一侧，全由英雄自己决定，指令里不带方向：
 * 陈丹琦「精准检索」升**己方**一个，梅拉妮·珀金斯「化繁为简」降**对方**一个。
 *
 * 完全免费：不扣 tokens、不记 spentThisRound，也不结束出牌轮——发动完照样接着出牌或 END_PLAY。
 * 不记消耗这一点会影响胜负：答对数量相同时比的就是本轮 spentThisRound（见 submitAnswers），
 * 发动技能不会让自己在那条决胜线上吃亏。
 * 每局只能发一次，用掉就置上 heroSkillUsed。
 */
function useHeroSkill(
  state: GameState,
  playerId: PlayerId,
  targetInstanceId: InstanceId,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const hero = player.hero
  // 只有这两位的技能是"指定一个 AI 升/降级"。霍珀的 Debug 是被动（在 playCard 里触发），
  // 其余几位还没实装（见 heroes.ts 的 comingSoon），发这条指令一律拒绝。
  // hero === null 这半边是给类型收窄用的：没英雄时 direction 本来就是 null。
  const direction: 'upgrade' | 'downgrade' | null =
    hero === 'danqi-chen' ? 'upgrade' : hero === 'melanie-perkins' ? 'downgrade' : null
  if (hero === null || direction === null) return reject(state, '你的英雄没有可发动的技能')
  if (player.heroSkillUsed) return reject(state, '英雄技能这一局已经用过了')

  // 升级只能打自己场上、降级只能打对面场上。选错边和目标压根不存在报同一句：
  // 对玩家来说这两种都是"这个格子不能选"。
  const ownerId = direction === 'upgrade' ? playerId : other(playerId)
  const target = next.players[ownerId].board.find((a) => a.instanceId === targetInstanceId)
  if (target === undefined) {
    return reject(
      state,
      direction === 'upgrade' ? '目标必须是你场上的 AI' : '目标必须是对方场上的 AI',
    )
  }

  const fromCardId = target.cardId
  const toCardId =
    direction === 'upgrade' ? upgradeTargetOf(fromCardId) : downgradeTargetOf(fromCardId)
  // 链顶、链底，以及压根不在任何升级链上的那 8 张，都到头了（见 aiModels.ts 的 AI_UPGRADE_CHAINS）。
  if (toCardId === null) {
    return reject(
      state,
      direction === 'upgrade' ? '这个 AI 没有可升级的下一代' : '这个 AI 没有可降级的上一代',
    )
  }

  // 换掉 cardId 就是这个技能的全部效果：费用、卡面、预生成的答题表现全部跟着新卡走。
  // 身上那几个「本轮」标记（affectedBy / interference / safePassed）原样留着——被干扰、
  // 被保送和升降级是三码事，同一个单位身上互不影响：升完仍按新卡查被干扰那一档的回答，
  // 也照样答错不罚下。英雄技能自己不往 affectedBy 里记（那份只记技能牌），
  // 它留下的是永久的 levelShift 角标。
  // 降到链底可能降出 GPT-2 这种没跑过预生成的卡，那一档由 script.ts 兜底，不会缺格抛错。
  // 金钟罩同理管不着这里：它挡的是技能牌，而英雄技能不是技能牌（见 types.ts 的 shielded）。
  target.cardId = toCardId
  target.levelShift = (target.levelShift ?? 0) + (direction === 'upgrade' ? 1 : -1)
  player.heroSkillUsed = true
  return {
    state: next,
    events: [
      {
        type: 'HERO_SKILL_USED',
        player: playerId,
        heroId: hero,
        targetInstanceId,
        fromCardId,
        toCardId,
        direction,
      },
    ],
  }
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
 * 结算本轮答题：判对错、罚下答错的、算出这一轮谁拿分，然后停在 settle 等双方确认。
 *
 * results 由房主/本地 driver 在进入答题阶段后一次性生成，覆盖场上每一个 AI；
 * 对不上就整条拒绝——那说明 driver 拿的是过期状态，宁可什么都不做也别结算出错的局面。
 *
 * 这里**不**推进轮次也不判终局：那一段搬去了 confirmRound。
 * 结算界面要播一整套揭晓动画，中途局面不能变（补牌、换先手、Token 补满都会让界面跳），
 * 所以这条指令只把分算完写进快照就收手。
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

  const events: GameEvent[] = []
  // 本轮先数双方各有几个 AI 答对，第一判据直接比较这个数量。
  // 初值 0 顺带覆盖了"场上一个 AI 都没有"的一方：它一条结果都没有，自然是答对 0 个。
  // 只认答题结果、不看罚完之后场上还剩谁：被保送的单位答错也留在场上（见下面那条分支），
  // 照场上还有没有人来判就会把它算成答对了。
  const correctCounts: [number, number] = [0, 0]
  for (const result of results) {
    // 上面刚校验过 results 和场上一一对应，所以这里必定找得到人。
    const owner = next.players.find((p) =>
      p.board.some((a) => a.instanceId === result.instanceId),
    )!
    if (result.correct) correctCounts[owner.id] += 1
    const index = owner.board.findIndex((a) => a.instanceId === result.instanceId)
    const ai = owner.board[index]!
    events.push({
      type: 'AI_ANSWERED',
      instanceId: ai.instanceId,
      owner: ai.owner,
      // 这个 AI 马上可能被罚下，从快照里消失；界面画头像要的卡面身份只剩事件里这一份。
      cardId: ai.cardId,
      correct: result.correct,
      answer: result.answer,
      reasoning: result.reasoning,
    })
    // 答对的原地留场，只有答错的才要处理去留。
    if (!result.correct) {
      if (ai.safePassed === true) {
        // 「保送」：答错也不罚下，但这一题仍然算他答错（计分口径不变）。
        // 这条占的就是本该发 AI_ELIMINATED 的位置，客户端照着改演出。
        events.push({ type: 'AI_SAFE_PASSED', instanceId: ai.instanceId, owner: ai.owner })
      } else {
        owner.board.splice(index, 1)
        owner.discard.push({
          instanceId: ai.instanceId,
          cardId: ai.cardId,
          owner: ai.owner,
        })
        events.push({ type: 'AI_ELIMINATED', instanceId: ai.instanceId, owner: ai.owner })
      }
    }
  }

  // 计分：每轮就 1 分，按三档判（见 RoundVerdict）。
  // 场上一个 AI 都没有的一方答对数是 0，但对局照常走下去。
  const spent: [number, number] = [
    next.players[0].spentThisRound,
    next.players[1].spentThisRound,
  ]
  let gains: [number, number]
  let verdict: RoundVerdict
  if (correctCounts[0] !== correctCounts[1]) {
    verdict = 'more-correct'
    gains = correctCounts[0] > correctCounts[1] ? [1, 0] : [0, 1]
  } else if (spent[0] !== spent[1]) {
    // 只有答对数相同，才比本轮为新牌花掉的 Token，严格少的一方拿这一分。
    // 场上留着的老 AI 这一轮不重复付费，所以"什么都不打"是消耗 0 的合法打法。
    verdict = 'fewer-tokens'
    gains = spent[0] < spent[1] ? [1, 0] : [0, 1]
  } else {
    // 连消耗都一样：不设赢家，双方各拿 1 分（分差不变，所以才可能同时到线要加赛）。
    verdict = 'equal-tokens'
    gains = [1, 1]
  }
  next.players[0].score += gains[0]
  next.players[1].score += gains[1]
  const scores: [number, number] = [next.players[0].score, next.players[1].score]
  events.push({ type: 'ROUND_SCORED', gains, scores, correctCounts, spent, verdict })

  // 停在这里等双方点"进入下一轮"。轮次、Token、手牌全都保持本轮的样子，
  // 结算界面读快照就能显示"本轮消耗"这类只在这一刻有意义的数。
  next.phase = 'settle'
  next.settleConfirmed = [false, false]
  return { state: next, events }
}

/**
 * 某一方确认本轮结算。双方都确认了才真的推进：推进下一轮，或在最后一轮结束整局。
 *
 * 为什么要等两边：结算界面是一整套逐步揭晓的动画，两端各播各的、快慢不同步，
 * 先看完的一方直接把局面推走的话，另一边的动画会被下一轮的横幅和补牌打断。
 */
function confirmRound(state: GameState, playerId: PlayerId): ExecuteResult {
  if (state.settleConfirmed[playerId]) return reject(state, '这一轮你已经确认过了')

  const next = clone(state)
  next.settleConfirmed[playerId] = true
  const events: GameEvent[] = [{ type: 'ROUND_CONFIRMED', player: playerId }]
  if (!next.settleConfirmed[0] || !next.settleConfirmed[1]) return { state: next, events }

  // 收场有两条路：有人**单独**到 WIN_TARGET 分（题库还剩题也当场结束），
  // 或者题库出完了保底判一次。双方同时到线且分数相同不算结束，继续加赛下一轮。
  // 分数在 submitAnswers 里就加完了，这里只是读快照来判要不要收场。
  const scores: [number, number] = [next.players[0].score, next.players[1].score]
  const decided = (scores[0] >= WIN_TARGET || scores[1] >= WIN_TARGET) && scores[0] !== scores[1]
  if (decided || next.round >= next.totalRounds) {
    next.phase = 'finished'
    // 'draw' 只可能来自"题库出完还同分"这一路：decided 那一路已经要求分数不相等。
    next.winner = scores[0] === scores[1] ? 'draw' : scores[0] > scores[1] ? 0 : 1
    events.push({ type: 'GAME_OVER', winner: next.winner })
    return { state: next, events }
  }

  next.round += 1
  next.firstPlayer = other(next.firstPlayer)
  next.activePlayer = next.firstPlayer
  next.phase = 'play'
  // 技能牌留下的"本轮"效果全部在这里失效：核电站的减费、金钟罩、场上单位身上的干扰和保送，
  // 连同小卡上那一列角标读的 affectedBy 一起清（那份是"本轮被哪几张牌打过"，见 types.ts）。
  // 清除点定在真的进下一轮这一步（而不是提交答题结果时），是因为结算界面还要照着这些标记
  // 演一遍"这个被干扰了 / 这个是被保送留下的"。玉净瓶卡面上「本轮作用于你的 Agent 的效果」
  // 那句口径也是靠这里成立的。
  next.costReduction = 0
  // 第 2 轮起每轮开始双方各补牌，起手那 5 张之外的牌都是这么来的（张数见 ROUND_DRAW_SIZE）。
  // Token 同时补满并抬高上限：省下来的不跨轮累积，直接被新的满额盖掉
  //（模型蒸馏顶破上限的那部分也是在这里被覆盖的）。
  // 本轮消耗和"派过 AI 了"两个标志一起清零，新一轮从头算。
  // 消耗那一份的读者是结算界面，所以一直留到真的离开结算这一刻才失效。
  for (const player of next.players) {
    delete player.shielded
    for (const ai of player.board) {
      delete ai.affectedBy
      delete ai.interference
      delete ai.safePassed
    }
    player.tokenMax += TOKEN_MAX_GROWTH
    player.tokens = player.tokenMax
    player.spentThisRound = 0
    drawCards(player, ROUND_DRAW_SIZE, events)
  }
  announceRound(next, events)
  return { state: next, events }
}

/** 宣告新一轮开始并让先手行动。开局和每轮换手都走这里，保证两处事件序一致。 */
function announceRound(state: GameState, events: GameEvent[]): void {
  const question = currentQuestion(state)
  events.push({
    type: 'ROUND_STARTED',
    round: state.round,
    firstPlayer: state.firstPlayer,
    category: question.category,
    // 关键词拷一份出来：事件会被 JSON 深拷贝、联机时还要原样转发，
    // 直接引用题库那个数组的话，改事件等于改题库。
    keywords: question.keywords.slice(),
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
