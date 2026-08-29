// pure-rand v8 只提供子路径入口，没有包根入口，所以这几行 import 看起来才这么长。
import { uniformInt } from 'pure-rand/distribution/uniformInt'
// 用 mersenne 而不是更快的 xoroshiro128plus：后者从整数种子起步时，
// 相邻种子头几个输出的低位是强相关的（实测连续种子掷硬币有约 65% 概率翻面，
// 空转多少次都甩不掉），而这里的 seed 就是 Date.now()，会掷出"隔一毫秒换一次先手"的规律。
// mersenne 的种子扩散做得干净，连续种子的首个输出实测就是均匀且互不相关的。
import { mersenne } from 'pure-rand/generator/mersenne'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import { CARDS, getCard } from './cards'
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
} from './types'

/** 开局手牌数。黑客松阶段不做先后手补偿，双方一样。 */
export const STARTING_HAND_SIZE = 5

/**
 * 第 2 轮起每轮开始双方各补几张。
 *
 * 一张时手牌只出不进，打到后面双方常常无牌可打、只能干等着答题；两张才够一轮出一两张的消耗。
 * 一局最多摸 5 + 4 轮 × 2 = 13 张，默认牌组 20 张（见 cards.ts 的 STARTER_DECK）管得住，
 * 不会中途抽空。改大到摸得空牌堆也不会出错（drawCards 抽不到就算了），只是画面上会一直显示 0。
 */
export const ROUND_DRAW_SIZE = 2

/**
 * 第 1 轮的 Token 上限。
 *
 * 4 点刚好买得起最便宜的两三张 AI 牌（费用区间是 1~7，见 aiModels.ts），
 * 又买不起 ChatGPT 5.6 Sol 那种 7 点的顶配，开局就得做取舍。
 */
export const INITIAL_TOKEN_MAX = 4

/**
 * 每答完一题，Token 上限涨这么多。
 *
 * 上限只涨不减，所以第 n 轮的上限恒为 INITIAL_TOKEN_MAX + (n - 1) × 这个数；
 * 右侧栏那排星星的格子数就是它算出来的，超过 8 格会自动折成两列。
 */
export const TOKEN_MAX_GROWTH = 2

/** 没指定英雄时用谁。留一个兜底是为了让「不关心英雄」的调用方（大多是测试）能少写一个字段。 */
const DEFAULT_HERO: HeroId = 'grace-hopper'

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
    return {
      id,
      name: config.name,
      score: 0,
      // 开局就是满的：第 1 轮双方各 4 点，之后每轮补满并涨 2（见 confirmRound 那段）。
      tokens: INITIAL_TOKEN_MAX,
      tokenMax: INITIAL_TOKEN_MAX,
      roundTokenSpent: 0,
      hand: [],
      deck: shuffle(deck, rng),
      board: [],
      discard: [],
      // 用 === undefined 而不是 ??：null 是"这一方明确不带英雄"，不能被默认值盖掉。
      // 英雄初始化不碰 rng，所以加了它也不影响下面抛硬币/洗牌那串随机数的顺序。
      hero: config.hero === undefined ? DEFAULT_HERO : config.hero,
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
    settleConfirmed: [false, false],
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
 * 一轮内能打几张由剩余 Token 决定：每张牌按卡面 tokenCost 扣，扣不起就整条拒绝。
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
  const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId)
  if (handIndex < 0) return reject(state, '手牌里没有这张卡')

  const instance = player.hand[handIndex]!
  const card = getCard(instance.cardId)

  // 费用排在选目标之前：Token 不够的话这张牌根本不该进"指定目标"那一步，
  // 否则客户端会先让玩家挑完目标、再回一句打不起，白挑一次。
  if (player.tokens < card.tokenCost) {
    return reject(state, `Token 不够：这张牌要 ${card.tokenCost} 点，只剩 ${player.tokens} 点`)
  }

  // 目标先校验完再动手牌：拒绝要退回原样的 state（reject 回的就是传进来那份），
  // 而下面这些改动全落在副本 next 上，顺序写反了以后加分支时容易漏掉。
  // 找到的是 next 里的那个单位，直接给它盖 interfered 就行。
  let target: AiInstance | undefined
  if (card.kind === 'skill' && card.target === 'foe-ai') {
    if (targetInstanceId === undefined) return reject(state, '这张技能牌要先指定目标')
    target = next.players[other(playerId)].board.find((a) => a.instanceId === targetInstanceId)
    // 两条分开报：客户端选错人和选了个已经被干扰的，玩家该看到的提示不一样。
    if (target === undefined) return reject(state, '目标必须是对方场上的 AI')
    if (target.interfered === true) return reject(state, '这个 AI 已经被干扰过了')
  }

  player.hand.splice(handIndex, 1)
  // 扣费和抽走手牌绑在一起：上面所有会拒绝的分支都已经走完，到这里这张牌必定打得出去。
  player.tokens -= card.tokenCost
  // 同一笔钱记两处：tokens 是"还剩多少"，会在进下一轮时被补满冲掉；
  // roundTokenSpent 是"这一轮花了多少"，结算要用它比大小，所以得单独攒着。
  player.roundTokenSpent += card.tokenCost

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
    // 「这张会不会被抵消」——被抵消的干扰技能不能给目标盖上 interfered，
    // 否则玩家会看到"技能被抵消了，那个 AI 却再也不能被干扰"这种自相矛盾的局面。
    // 以后给别的技能牌写效果，同样都要写进下面这个 canceledBy === null 的分支里。
    const foe = next.players[other(playerId)]
    const canceledBy: HeroId | null =
      foe.hero === 'grace-hopper' && !foe.heroSkillUsed ? foe.hero : null
    // 干扰类技能的全部效果就是这一下：目标从此不能再被干扰，战场小卡上也会挂个角标。
    // 它不影响答题——真正往 AI 上下文里塞话的效果还没做。
    if (canceledBy === null && target !== undefined) target.interfered = true

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
  for (const result of results) {
    // 上面刚校验过 results 和场上一一对应，所以这里必定找得到人。
    const owner = next.players.find((p) =>
      p.board.some((a) => a.instanceId === result.instanceId),
    )!
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
    if (!result.correct) {
      owner.board.splice(index, 1)
      owner.discard.push({
        instanceId: ai.instanceId,
        cardId: ai.cardId,
        owner: ai.owner,
      })
      events.push({ type: 'AI_ELIMINATED', instanceId: ai.instanceId, owner: ai.owner })
    }
  }

  // 计分：一轮最多分出 1 分，先比答对数（罚下之后还站着的就是答对的），
  // 一样多再比谁花的 Token 少——用更省的牌拿到同样的正确数，这一分归他。
  // 两条都打平就各拿 1 分：谁也没占到便宜，不该有人被扣着不给分。
  const correct: [number, number] = [next.players[0].board.length, next.players[1].board.length]
  const spent: [number, number] = [
    next.players[0].roundTokenSpent,
    next.players[1].roundTokenSpent,
  ]
  const gains: [number, number] =
    correct[0] !== correct[1]
      ? correct[0] > correct[1]
        ? [1, 0]
        : [0, 1]
      : spent[0] !== spent[1]
        ? spent[0] < spent[1]
          ? [1, 0]
          : [0, 1]
        : [1, 1]
  next.players[0].score += gains[0]
  next.players[1].score += gains[1]
  const scores: [number, number] = [next.players[0].score, next.players[1].score]
  events.push({ type: 'ROUND_SCORED', gains, scores, correct, spent })

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

  if (next.round >= next.totalRounds) {
    next.phase = 'finished'
    const [score0, score1] = [next.players[0].score, next.players[1].score]
    next.winner = score0 === score1 ? 'draw' : score0 > score1 ? 0 : 1
    events.push({ type: 'GAME_OVER', winner: next.winner })
    return { state: next, events }
  }

  next.round += 1
  next.firstPlayer = other(next.firstPlayer)
  next.activePlayer = next.firstPlayer
  next.phase = 'play'
  // 第 2 轮起每轮开始双方各补牌，起手那 5 张之外的牌都是这么来的（张数见 ROUND_DRAW_SIZE）。
  // Token 同时补满并抬高上限：省下来的不跨轮累积，直接被新的满额盖掉。
  // 本轮消耗也在这里清零——它的读者是结算界面，一直留到真的离开结算才失效。
  for (const player of next.players) {
    player.tokenMax += TOKEN_MAX_GROWTH
    player.tokens = player.tokenMax
    player.roundTokenSpent = 0
    drawCards(player, ROUND_DRAW_SIZE, events)
  }
  announceRound(next, events)
  return { state: next, events }
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
