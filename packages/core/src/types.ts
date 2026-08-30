/**
 * 规则引擎的全部数据形状。
 *
 * 约束：这里的所有类型都必须是纯数据（可 JSON 序列化）。
 * 引擎靠 JSON 深拷贝推进状态，联机时房主也要把状态/事件原样发出去，
 * 一旦混进函数、Map、Date 之类的东西这两条路都会断。
 */

/** 玩家固定两人，用 0/1 当座位号，省掉一层 id 映射。 */
export type PlayerId = 0 | 1

/** 卡牌定义 id（同一张卡在牌组里可以出现多次）。 */
export type CardId = string

/** 卡牌实例 id：牌组里每一份拷贝都有独立身份，用来定位手牌和场上单位。 */
export type InstanceId = string

/** 题目类别。界面右侧常驻的「下一题：XX」显示的就是它。 */
export type QuestionCategory =
  | 'meme' // 梗题：谐音、断句、望文生义那一类
  | 'bias' // 刻板印象：题面故意不给关键信息，看模型会不会自己补一个
  | 'life' // 生活类：日常场景里的常识和空间想象

export interface Question {
  id: string
  category: QuestionCategory
  text: string
  /**
   * 从题面提炼的几个关键词，出牌阶段就公开（题面本身要等双方出完牌才揭晓）。
   *
   * 它是出牌阶段唯一的情报：玩家只能靠这几个词猜这道题考什么方向、该派哪张 AI 上场。
   * 所以词要指向题目的**考点**（「谐音梗」「性别判断」），不要泄题也不要写成同义复述。
   */
  keywords: string[]
  /**
   * 正确答案，答题阶段直接摊给玩家看。
   * 本项目不防作弊（见 docs/architecture.md 4.1），所以整份题库连答案一起放在
   * GameState 里发给双方，不做"只在结算时下发"这种服务器权威式的遮挡。
   *
   * 写成短语而不是整句：结算界面把它当大字标题排版，长句会挤成两三行。
   * 说明的部分放到 explanation 里。
   */
  answer: string
  /**
   * 标准答案下面那行小字，讲清楚"为什么是这个答案"。
   * 和 answer 分开是排版需要：一行大字 + 一行小字，两者不能揉进同一个字段。
   */
  explanation: string
}

interface CardBase {
  id: CardId
  /** 卡面名（中文）。 */
  name: string
  /** 卡面描述文案。 */
  text: string
  /**
   * 打出这张牌要花的 Token（见 docs/AI卡牌对战游戏_游戏机制与流程_V0.3.md 第 5 节）。
   *
   * 这是费用的唯一出处：卡面上那枚费用章、手牌"打不起就变灰"的判断、引擎的扣费校验
   * 读的都是它。客户端曾经在 ui/aiModelFace.ts 里另存过一份展示用数值，
   * 那份已经删掉——两份数字一旦对不上，玩家会看到"卡面写 4 点，却提示 Token 不够"。
   */
  tokenCost: number
}

/** AI 牌：打出后作为单位留在场上，每轮答题阶段跟着答题，答错才罚下。 */
export interface AiCard extends CardBase {
  kind: 'ai'
  /** 卡面上印的模型名，纯展示用，引擎不读它。 */
  model: string
  /** AI 的专属技能名；正面铭牌和背面详情共用这一份。 */
  skillName: string
  /** AI 的专属技能效果；当前只用于卡背说明，规则实现仍由引擎单独接入。 */
  skillText: string
  /**
   * 答题时去 OpenRouter 调的那个模型 id，`null` 表示 OpenRouter 上根本没有这个模型。
   *
   * 写成必填的 `string | null` 而不是可选字段：漏填会被静默当成"调不到"，
   * 而"调不到"是要把整张牌挡在卡池外的（见 aiModels.ts 的 PLAYABLE_AI_CARD_IDS），
   * 代价太大，宁可让类型检查在漏填的那一刻就报错。
   */
  openrouter: string | null
  /**
   * 国产模型。「国产替代」按它决定谁留在场上（没标的一律罚下）。
   *
   * 只标 true、不写 false：没这一项就是非国产，JSON 里少一份冗余，
   * 也免得以后有人误以为 `domestic: false` 和不写是两种状态。
   *
   * 和 openrouter 各管各的：标签说的是"这张卡算不算国产"，openrouter 说的是"调不调得到"。
   * 文心一言调不到模型、进不了卡池，但它照样是国产牌——真被调试指令摆上场就吃这条规则。
   */
  domestic?: true
  /**
   * 进化链的下一级卡（「鸡犬升天」把场上单位换成它）。
   *
   * 不填 = 这张卡不可进化：链尾（如 ChatGPT 5.6 Sol）和没有前后代的单张都不填。
   * 进化链写在卡牌定义上而不是引擎里，再补一条链只要改这里。
   *
   * 链头 GPT-2 调不到模型、进不了卡池，链条本身照样成立：牌组里带不了它，
   * 但它经调试指令上场后仍然能进化成 GPT-3.5，所以这条链不要跟着删。
   */
  evolvesTo?: CardId
}

/** 干扰类技能牌的 id。命中后写进 `AiInstance.interference`，答案生成层按种类模拟。 */
export type InterferenceCardId = 'fixed-answer' | 'black-white-reversal'

/**
 * 技能牌：打出即效果结算、随后进弃牌堆，效果可以持续到本轮结束。
 *
 * 24 张里有 10 张接进了引擎（名单和各自的结算见 skillCards.ts 的文件头注释），
 * 其余 14 张还带着 `plannedEffect` 走占位路径：打出后亮个相就进弃牌堆，什么都不发生。
 */
export interface SkillCard extends CardBase {
  kind: 'skill'
  /**
   * 打出时必须指定的目标；不填就是无目标技能，打出即结算。
   *
   * - `'foe-ai'`：对方场上一个还没被干扰过的 AI（`AiInstance.interference` 没设置）。复读机、黑白颠倒。
   * - `'own-ai'`：己方场上一个还没被保送的 AI。保送。
   * - `'own-affected-ai'`：己方场上一个身上带着 `interference` 的 AI。玉净瓶。
   * - `'own-hand-ai'`：**自己手牌里**的一张 AI 牌，`targetInstanceId` 指的是手牌实例
   *   而不是场上单位。模型蒸馏。
   *
   * 目标规则写在卡牌定义上而不是引擎里：新技能只要标上其中一档，
   * `playCard` 那段校验和客户端的选目标交互都不用改。
   */
  target?: 'foe-ai' | 'own-ai' | 'own-affected-ai' | 'own-hand-ai'
  /**
   * 设计稿定下的效果全文，**规则引擎尚未实装**，只供卡背展示。
   *
   * 带着它的牌走的是占位路径：打出后亮个相就进弃牌堆，什么都不会发生。
   * 所以客户端拼卡背文案时必须一并说明"还没实装"（见 client 的 ui/cardText.ts）——
   * 直接把这句话摆出来，玩家会以为打出去真有效果。
   * 哪天某张牌接进引擎，就把这个字段删掉、改成真正的结算逻辑。
   */
  plannedEffect?: string
}

/**
 * 英雄 id。英雄总共就这 7 位、不会随版本增删，直接用字面量联合，写错名字当场就是类型错误。
 * 这里的排列顺序不代表展示顺序——展示顺序由 heroes.ts 里 HEROES 的键序决定。
 */
export type HeroId =
  | 'fei-fei-li'
  | 'danqi-chen'
  | 'melanie-perkins'
  | 'mira-murati'
  | 'ada-lovelace'
  | 'margaret-hamilton'
  | 'grace-hopper'

/**
 * 英雄牌：开局就跟着玩家，不是牌组里的一张牌。
 *
 * 字段风格对齐 CardBase（id / name / text），另加英文名和技能两项。
 *
 * **它刻意不进 HandCard 联合，也不进 CARDS / CARD_POOL / 预设牌组**：
 * 英雄技能不占 20 张牌的牌组空间（见 docs/AI卡牌对战游戏_游戏机制与流程_V0.3.md 第 4 节），
 * 混进卡池还会连累存档过滤、抽卡和牌组洗牌——那几处都是"遍历卡池"的写法，
 * 多出一张抽不到也打不出的卡只会变成脏数据。英雄的表在 heroes.ts，查表走 getHero。
 */
export interface HeroCard {
  kind: 'hero'
  id: HeroId
  /** 中文名，卡面主标题。 */
  name: string
  /** 英文名，卡面上当副标题印一行。 */
  enName: string
  /** 人物简介。 */
  text: string
  /** 技能名，界面上要单独拎出来显示（如抵消过场的大字）。 */
  skillName: string
  /** 技能效果的说明文案。 */
  skillText: string
  /**
   * 技能只有设计稿、**规则引擎尚未实装**，选英雄界面要把这位置灰禁选。
   *
   * 和技能牌的 `plannedEffect` 同一个路子（见 SkillCard）：skillText 写的是定案的效果，
   * 但选了他打起来就是没技能，所以宁可先不让选，也别让玩家以为技能会生效。
   * 哪天这一位接进引擎，就把这个字段删掉。
   */
  comingSoon?: boolean
  /**
   * 这位英雄在对局里的定位（"经济发育型"、"节奏压制"……），选英雄界面的详情面板展示。
   *
   * 和 skillText 分开：那一条说的是技能**怎么结算**，这一条说的是**该什么时候选他**。
   * 只有已实装的英雄才写，comingSoon 的几位不写——定位得等技能真打起来才谈得上。
   */
  roleText?: string
}

/** 牌组、手牌、弃牌堆里唯二可能出现的牌。 */
export type HandCard = AiCard | SkillCard

/**
 * 全部三类牌。只有需要"任意一张牌"的展示代码才用它（卡面渲染、牌组页、背面文案）；
 * 一切和牌组沾边的地方一律用 HandCard，英雄牌进不去。
 */
export type Card = HandCard | HeroCard

/** 牌堆/手牌/弃牌堆里的一张牌。 */
export interface CardInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
}

/**
 * 场上的 AI 单位。
 *
 * 除了身份三件套只有四个标记，分两类，别混：
 * - `affectedBy` / `interference` / `safePassed` 是**本轮**标记，双方确认结算、真的进下一轮时
 *   一起清掉（见 engine.ts 的 confirmRound）。
 * - `levelShift` 跟着单位走，不按轮清——它记的是这个单位这一局被升降过几级，只给界面画角标用。
 *
 * 之后要加"上场后被增益/削弱"的数值时再往这里拷贝卡面数值。
 *
 * 四个都写成可选字段、只设不为空的那一档：没被打过的单位就不带这一项，
 * JSON 深拷贝和联机转发都少一份冗余。
 */
export interface AiInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
  /**
   * 本轮打在这个单位身上的技能牌，按命中先后排。**只给界面用**，引擎的判定一概不读它。
   *
   * 它回答的是玩家在战场上问的那句"这张卡怎么了"：每一项在小卡上挂一枚角标，
   * 点开放大查看时列出牌名（见 client 的 MatchStage）。所以凡是效果落在某个场上单位身上的
   * 技能牌，结算时都要往这里补一笔，否则那张牌打出去画面上不留痕迹。
   * 不落在单位身上的不记：核电站改的是费用、模型蒸馏打的是手牌、
   * 国产替代和内存紧缺清掉的单位已经不在场上了。
   * 金钟罩也不记——它罩的是整个人（`PlayerState.shielded`），连本轮之后才上场的单位一起罩着，
   * 记在实例上反而会漏掉那些，界面直接读那个字段。
   *
   * 效果被移除时对应那一项也要跟着删（眼下只有玉净瓶解干扰这一处），
   * 不然角标会停在一个已经不存在的效果上。所以它是"现在身上有什么"，不是一本流水账。
   *
   * 和 `interference` / `safePassed` 有重叠是有意的：那两个是引擎自己要读的机制
   *（按种类取预生成回答、答错免罚下），这一份只管展示。两边必须一起写，
   * 引擎里统一走 markAffected / unmarkAffected 两个小工具，别在别处手写。
   */
  affectedBy?: CardId[]
  /**
   * 被哪张干扰类技能命中了。
   *
   * 干扰的本体是"往这个 AI 的 prompt 里注入一句话"（注入文案见 script.ts 的
   * `INTERFERENCE_PROMPTS`）。那两句是提示词不是开关，模型完全可以不理——复读机那句
   * 尤其是编出来骗它的，上不上钩由模型自己权衡。这两句已经离线跑过一遍了：答题时按这个字段
   * 去查对应那一档的**真实模型回答**（见 script.ts），所以同一张牌打在不同模型身上结果不一样。
   *
   * 记的是种类而不是一个布尔，因为下游要分三处用：答案生成层按种类选变体、
   * 玉净瓶按"身上有没有它"挑目标、战场小卡按种类显示不同角标。
   * 一个 AI 同时只能挂一种：已经带着它的单位不能再被第二张干扰技能选中。
   */
  interference?: InterferenceCardId
  /**
   * 被「保送」选中过：本轮结算答错也不罚下（改发 `AI_SAFE_PASSED`）。
   *
   * 它只免掉罚下，**不改计分**：保送留场的那个 AI 不计入 `ROUND_SCORED.correctCounts`。
   */
  safePassed?: true
  /**
   * 净升降级次数：每被升一级 +1、降一级 -1。
   *
   * **纯粹给 UI 画角标用**（战场小卡上那个「↑1」之类的标记）。
   * 能力变化不靠它：升降级当场就把 `cardId` 换成了同系列的另一张卡（见 aiModels.ts 的升级链），
   * 费用、卡面、答题表现全部跟着新卡走，引擎不会再去读这个数。
   * 同样写成可选字段，没被升降过的单位不带这一项。
   * 一方升、另一方又降回去的话这里会留下一个 0（字段不删），界面把 0 当作"没有角标"处理。
   *
   * 和上面那几个「本轮」标记不同，它**不在 confirmRound 里清**：英雄技能每局只发得动一次，
   * 换掉的卡面身份也是永久的，角标跟着单位走到它下场为止。
   * 「鸡犬升天」（技能牌）走的是另一条路——它发 AI_TRANSFORMED、只加下面的 `evolvedTimes`，
   * 因为那是全场一起进化，不是"这一个被单独强化了"，两种来源的角标文案也不一样。
   */
  levelShift?: number
  /**
   * 被「鸡犬升天」升过几级，只增不减。
   *
   * 和 `levelShift` 一样是**纯 UI 用**、跟着单位走不按轮清：进化换掉的卡面身份是永久的，
   * 玩家隔了几轮回头看战场，也该一眼看出哪几个单位是升上来的，
   * 所以不能只靠本轮标记 `affectedBy`（那个进下一轮就清了）。
   *
   * 单独记一个数而不是并进 `levelShift`：那个数是英雄技能的净升降次数，可能被降级抵消成 0，
   * 而这里要回答的是"这个单位这一局被鸡犬升天带飞过几次"，两件事的角标文案也不同
   *（「已升级」对「已进化」，见 client 的 tileMarks）。
   */
  evolvedTimes?: number
}

/** 一次答题的结果，由房主/本地 driver 生成后喂进引擎。 */
export interface AnswerResult {
  instanceId: InstanceId
  correct: boolean
  /** 这个 AI 的回答本身，一个短语。结算界面拿它当大字排版，所以别写成整段话。 */
  answer: string
  /** 这个 AI 给出的理由，两行以内的小字，排在 answer 下面。 */
  reasoning: string
}

/**
 * 一轮分四段：双方轮流出牌（play）→ 全场答题（quiz）→ 结算等双方确认（settle）→ 下一轮。
 *
 * 分数在 quiz 末尾就算完了，但要等 settle 里双方都确认才推进；到那一刻若有一方
 * 单独到 WIN_TARGET 分、或者题库已经出完，就直接进 finished 而不是开下一轮。
 *
 * settle 单独占一段是为了让结算界面有一段"局面不再变"的时间：
 * 计分已经算完写进快照，但轮次、Token、手牌都还停在本轮的样子，界面可以放心读快照。
 */
export type GamePhase = 'play' | 'quiz' | 'settle' | 'finished'

/**
 * 本轮那 1 分是怎么分出来的。三档按判定顺序排，客户端照它选结算文案。
 *
 * - `'more-correct'`：答对 AI 数量更多的一方 +1。
 * - `'fewer-tokens'`：答对数量相同，本轮 Token 消耗**严格**较少的一方 +1。
 * - `'equal-tokens'`：答对数量和消耗都相同，各 +1（这一档会把两边分数一起推高，
 *   所以才会有"双方同时到 3 分"这种要加赛的局面）。
 */
export type RoundVerdict = 'more-correct' | 'fewer-tokens' | 'equal-tokens'

export interface PlayerState {
  id: PlayerId
  name: string
  /**
   * 累计得分。每轮 1 分制：答对 AI 更多的一方 +1；数量相同才比本轮 Token 消耗，
   * 少的一方 +1、消耗也相同则各 +1（判定见 engine 的 submitAnswers）。先到 WIN_TARGET 分且
   * 双方分数不相等即获胜，所以它最高可能停在 3 分以上（加赛时双方一起涨）。
   */
  score: number
  /**
   * 本轮打出过「金钟罩」：这一方和他场上所有 AI 不受**任何**技能牌影响，
   * 进下一轮时清掉（见 engine.ts 的 confirmRound）。
   *
   * 挡的范围是**落在场上单位身上的技能牌效果**，对己方有利的也一样挡：
   * 对方的干扰技能选不中他的 AI（直接拒绝出牌）、他自己也打不出玉净瓶/保送
   * 这类作用于自己场上单位的牌、群体牌结算时跳过他的场面。
   * 够不着场上单位的就管不着：核电站减的是出牌费用，罩着照样享受
   * （见 engine.ts 的 effectivePlayCost）；模型蒸馏弃的是手牌，罩着照样能打。
   * 金钟罩自己也不受自己影响，否则第一张就会把自己挡住、这张牌永远打不出去。
   *
   * 只设 true 不设 false：和场上单位的两个标记同一套写法。
   */
  shielded?: true
  /**
   * 本轮还剩多少 Token。出牌时按卡面 tokenCost 扣，扣光了就打不出更贵的牌。
   *
   * 双方确认结算、进下一轮时补满到 tokenMax，不跨轮攒：省下来的 Token 不会带到下一轮，
   * 所以"这一轮的额度尽量用掉"本身就是一条策略。
   */
  tokens: number
  /**
   * 本轮已经花掉的 Token，等双方确认结算、真的进下一轮时才清零。
   *
   * 单独记一份而不是拿 `tokenMax - tokens` 现算：那个差值在出牌阶段对得上，
   * 但它表达的是"额度剩多少"，而计分要的是"这一轮为新打出的牌付了多少"；
   * 而且进下一轮时 tokens 会补满、tokenMax 还要涨，差值当场就没了。
   * 结算界面正需要在那之前把"本轮消耗"显示出来，它也是同对/同错时的判据，
   * 所以清零必须押后到离开 settle 那一刻。
   *
   * 技能牌被英雄技能抵消也照样计入：Token 是真花出去的，作废的只是效果。
   */
  spentThisRound: number
  /**
   * 本轮的 Token 上限。开局 INITIAL_TOKEN_MAX，之后每答完一题涨 TOKEN_MAX_GROWTH。
   * 右侧栏那排四芒星画的就是它：亮着的是 tokens，灰的是这一轮已经花掉的。
   */
  tokenMax: number
  hand: CardInstance[]
  /** 牌堆，数组末尾是牌堆顶（抽牌用 pop）。 */
  deck: CardInstance[]
  board: AiInstance[]
  discard: CardInstance[]
  /**
   * 这一方选的英雄。英雄不进牌组，只是挂在玩家身上的一份身份 + 一个技能。
   * 为 null 表示这一方没有英雄（技能一律不发动）。
   */
  hero: HeroId | null
  /**
   * 英雄技能这一局用掉了没有。
   *
   * 已实装的技能都是"每局一次"，所以一个布尔够用；
   * 将来有"每若干轮一次"的技能时再换成记轮次的字段。
   * 一个 GameState 的生命周期就是一局，createGame 重新建状态时它天然回到 false。
   *
   * 被动技能（格蕾丝·霍珀的 Debug）由引擎自己在触发时置上，主动技能
   * （陈丹琦、梅拉妮·珀金斯）由玩家发 USE_HERO_SKILL 置上。
   * 阿达·洛芙莱斯的 Token 上限加成是开局就算进数值的，不占这个标志。
   */
  heroSkillUsed: boolean
}

export interface GameState {
  /** 轮次序号，从 1 开始。一轮 = 双方各出一次牌 + 一次答题结算。 */
  round: number
  /**
   * 最多能打几轮 = 题库长度：题目在一局里不重复，出完就必须收场。
   *
   * 它是上限而不是"这局要打几轮"——正常先到 WIN_TARGET 分就结束了，
   * 打满只发生在双方一路同分加赛的情况下。
   */
  totalRounds: number
  /** 本轮先出牌的一方。第一轮抛硬币决定（教程可用 GameSetup.firstPlayer 指定），之后每轮交换。 */
  firstPlayer: PlayerId
  /**
   * play 阶段轮到谁出牌。
   * 不另设"先手是否已结束出牌"的标志位：activePlayer === firstPlayer 就是先手在出，
   * 否则就是后手在出，后手再 END_PLAY 即进答题。
   */
  activePlayer: PlayerId
  phase: GamePhase
  /** 本局的题目序列（开局洗好），questions[round - 1] 是本轮的题。 */
  questions: Question[]
  players: [PlayerState, PlayerState]
  /**
   * 谁赢了。没打完是 null；'draw' 只可能出现在"题库出完了双方还同分"这一种保底情况下
   * （先到 WIN_TARGET 分那条路要求分数不相等，同时到分会继续加赛）。
   */
  winner: PlayerId | 'draw' | null
  /**
   * settle 阶段里两位玩家分别确认过没有，按座位号排。
   *
   * 双方都点了"进入下一轮"才推进（见 engine.ts 的 confirmRound）：结算界面要播一整套
   * 揭晓动画，谁看完了谁先点，不能让先看完的一方把还在看的那一方拖走。
   * 每次进 settle 重置成 [false, false]。
   */
  settleConfirmed: [boolean, boolean]
  /**
   * 本轮打出过几张「核电站」：双方后续每张牌都便宜这么多点，最低 1 点
   * （算法见 engine.ts 的 effectivePlayCost）。进下一轮时清零。
   *
   * 记张数而不是一个布尔：这张牌可叠加，打两张就是 -2。
   * 它是全局的一份而不是每方一份——核电站减的是双方的费用。
   */
  costReduction: number
  /**
   * 状态内的随机种子，让引擎在保持"纯函数 + 可序列化"的前提下也能掷随机
   * （眼下只有「内存紧缺」要随机保留一半场上单位）。
   *
   * 用法：`mersenne(rngSeed)` 起一把生成器，取完要用的值再把下一个种子写回这里。
   * 随机数生成器本身进不了状态（它不可 JSON 序列化），种子可以。
   * 这样"同一份状态 + 同一条指令 = 同一个结果"仍然成立：房主广播完快照，
   * 客人手上那份状态里的种子和房主的是同一个，重放也不会分叉。
   */
  rngSeed: number
  /**
   * 下一个卡牌实例序号，开局发完双方牌组后接着往下走。
   * 调试指令凭空造牌时靠它保证 instanceId 不撞车。引擎里不许用 Math.random / Date，
   * 所以这个计数器必须留在状态里，才能跟着状态一起被拷贝和发给客人。
   */
  seq: number
}

/** 玩家能对引擎发出的全部指令。 */
export type Command =
  /**
   * 打出一张手牌。
   *
   * 只有一道闸：每张按**实际费用**扣 Token、剩的不够就整条被拒——实际费用是卡面 tokenCost
   * 减去核电站的减免，见 engine.ts 的 effectivePlayCost。
   * AI 牌和技能牌都不限张数，一轮里 Token 够就能接着打。
   *
   * `targetInstanceId` 只有卡牌定义标了 `target` 的技能牌要填，指的是场上单位还是手牌实例
   * 由那一档 `target` 决定（见 `SkillCard.target`）。该填不填、或者填了个不合法的目标都会被拒；
   * 无目标的卡带上它则直接忽略。
   */
  | {
      type: 'PLAY_CARD'
      player: PlayerId
      instanceId: InstanceId
      targetInstanceId?: InstanceId
    }
  /** 结束本方出牌：先手发就轮到后手，后手发就进答题阶段。 */
  | { type: 'END_PLAY'; player: PlayerId }
  /**
   * 发动主动英雄技能，指定场上一个 AI 单位。
   *
   * 只有"每局一次、指定一个目标"的那两位能发：陈丹琦把**己方**一个 AI 升一级、
   * 梅拉妮·珀金斯把**对方**一个 AI 降一级（目标在哪一侧由英雄决定，指令本身不带方向）。
   * 其余英雄发这条一律被拒——霍珀是被动、剩下三位还没实装。
   *
   * 只能在自己的出牌轮发动，但**完全免费**：不扣 Token，也不结束出牌轮，发动完还能接着出牌。
   */
  | { type: 'USE_HERO_SKILL'; player: PlayerId; targetInstanceId: InstanceId }
  /**
   * 提交本轮全场 AI 的答题结果。
   * 玩家不发这条指令，由房主/本地 driver 在进入答题阶段后自动生成并发出
   * （结果来自 script.ts 查的那份离线预生成的真实模型回答）。
   */
  | { type: 'SUBMIT_ANSWERS'; results: AnswerResult[] }
  /**
   * 结算界面上点"进入下一轮"。双方都发过才真的推进（或在最后一轮结束整局）。
   * 重复发会被拒，所以界面按下之后要把按钮置灰等对方。
   */
  | { type: 'CONFIRM_ROUND'; player: PlayerId }
  // 下面四条是 dev 测试房专用的调试指令，走的是和正常指令一样的 execute 路径，
  // 所以联机时客人发给房主也照样会被执行。本项目不防作弊（见 docs/architecture.md 4.1），
  // 客户端只在测试房里给出入口，引擎这一层不做任何身份或来源限制。
  /** 给某位玩家加一张手牌：不带 cardId 从他牌堆抽一张，带 cardId 则凭空造一张新实例（不消耗牌堆）。 */
  | { type: 'DEBUG_ADD_CARD'; player: PlayerId; cardId?: CardId }
  /** 弃掉某位玩家的一张手牌：不带 instanceId 移最后一张，带则移指定那张；被移的牌进弃牌堆。 */
  | { type: 'DEBUG_REMOVE_CARD'; player: PlayerId; instanceId?: InstanceId }
  /** 无视出牌轮次打出一张手牌，其余结算与 PLAY_CARD 完全一致（含选目标那套校验）。 */
  | {
      type: 'DEBUG_PLAY_CARD'
      player: PlayerId
      instanceId: InstanceId
      targetInstanceId?: InstanceId
    }
  /** 直接结束本轮双方出牌跳到答题阶段，省掉为了看结算连点两次「结束出牌」。 */
  | { type: 'DEBUG_SKIP_TO_QUIZ' }

/**
 * 引擎产出的事件流，客户端照着它播动画。
 * 事件描述"已经发生的事实"，客户端不该再自己算一遍规则。
 */
export type GameEvent =
  /** 开局抛硬币的结果，客户端拿它播全场硬币动画。 */
  | { type: 'GAME_STARTED'; firstPlayer: PlayerId }
  | { type: 'CARD_DRAWN'; player: PlayerId; card: CardInstance }
  /**
   * 一张手牌被直接弃掉（不是打出去的：打出去走 AI_DEPLOYED / SKILL_PLAYED）。
   * 两个来源：调试指令 DEBUG_REMOVE_CARD，以及「模型蒸馏」弃掉的那张 AI 牌。
   */
  | { type: 'CARD_REMOVED'; player: PlayerId; instanceId: InstanceId }
  | {
      type: 'ROUND_STARTED'
      round: number
      firstPlayer: PlayerId
      /** 本轮题目的类别；题目全文要等到 QUESTION_REVEALED 才展示。 */
      category: QuestionCategory
      /** 本轮题目的关键词，和类别一样属于出牌阶段就公开的情报（见 Question.keywords）。 */
      keywords: string[]
    }
  /** 轮到某方出牌，客户端打出牌横幅。 */
  | { type: 'PLAY_TURN_STARTED'; player: PlayerId }
  | { type: 'AI_DEPLOYED'; player: PlayerId; ai: AiInstance }
  /** 技能牌打出：中央亮相一下再进弃牌堆。 */
  | {
      type: 'SKILL_PLAYED'
      player: PlayerId
      cardId: CardId
      /**
       * 打出的那张手牌的实例 id。结算完全用不上它，纯粹给客户端定位用：
       * 对手出牌时要从他手牌里揪出这张牌飞到屏幕中央，而不是让它凭空出现。
       */
      instanceId: InstanceId
      /**
       * 这张技能打向的那个**场上单位**（`target` 是 foe-ai / own-ai / own-affected-ai 的卡才有）。
       *
       * 同样是给客户端定位用的：技能牌亮相完要飞向这个 AI 的战场格子并在那儿播命中特效。
       * 「模型蒸馏」那种打向手牌的（`target: 'own-hand-ai'`）刻意不带这个字段——
       * 客户端拿它去战场上找格子会扑空，那张手牌的去向由随后的 CARD_REMOVED 交代。
       *
       * 结算在事件发出前就做完了，但**别拿它当"效果一定生效了"的凭据**：
       * 这张牌可能紧接着被一条 SKILL_CANCELED 抵消掉，那时目标身上什么标记都没留下。
       * 目标身上到底有什么永远以快照里的 `AiInstance` 为准。
       */
      targetInstanceId?: InstanceId
    }
  /**
   * 一张技能牌的效果被英雄技能抵消。
   *
   * 紧跟在被抵消的那张牌的 SKILL_PLAYED 之后：牌照常打出、照常进弃牌堆，只是效果作废，
   * 客户端也就先演出牌、再演抵消。
   *
   * 两个玩家 id 方向相反，别弄混：
   * - `player` 是打出这张技能牌的一方（被抵消的那一方）；
   * - `by` 是发动英雄技能的一方，也就是 `player` 的对手。
   */
  | {
      type: 'SKILL_CANCELED'
      player: PlayerId
      by: PlayerId
      heroId: HeroId
      cardId: CardId
      /** 被抵消的那张牌的实例 id，和它的 SKILL_PLAYED 是同一个，客户端要靠它对上号。 */
      instanceId: InstanceId
    }
  /**
   * 主动英雄技能发动了：场上某个 AI 被换成同系列的另一代。
   *
   * `player` 是发动技能的一方；目标不一定是他自己的单位——升级打己方、降级打对方，
   * 看 `direction` 才知道该去谁的战场上找那个格子。
   *
   * 前后两张卡都报出来，客户端才能把"这张脸换成那张脸"演出来：
   * 新快照里只剩换完的 `cardId`，旧的那张查不回来了。
   */
  | {
      type: 'HERO_SKILL_USED'
      player: PlayerId
      heroId: HeroId
      targetInstanceId: InstanceId
      fromCardId: CardId
      toCardId: CardId
      direction: 'upgrade' | 'downgrade'
    }
  /** 进入答题阶段，全屏揭晓题目和正确答案。 */
  | { type: 'QUESTION_REVEALED'; question: Question }
  | {
      type: 'AI_ANSWERED'
      instanceId: InstanceId
      owner: PlayerId
      /**
       * 这个 AI 是哪张卡。结算界面靠它画头像和卡名。
       *
       * 明明快照里查得到，还要在事件里再报一遍，是因为答错的 AI 紧接着就被罚下了：
       * 界面拿到这批事件时新快照还没提交，等提交完那个单位已经从场上消失，再查就查不到。
       */
      cardId: CardId
      correct: boolean
      /** 回答本身（短语），界面上是那行大字。 */
      answer: string
      /** 回答的理由（两行以内），排在大字下面。 */
      reasoning: string
    }
  /** 答错被罚下，从场上移进弃牌堆。 */
  | { type: 'AI_ELIMINATED'; instanceId: InstanceId; owner: PlayerId }
  /**
   * 答错了但因为被「保送」而留在场上。
   *
   * 排在它自己那条 AI_ANSWERED 之后，占的就是本该发 AI_ELIMINATED 的位置：
   * 客户端在结算层里照常演"这个答错了"，但别演罚下，改标一个「保送」。
   */
  | { type: 'AI_SAFE_PASSED'; instanceId: InstanceId; owner: PlayerId }
  /**
   * 被技能牌罚下，从场上移进弃牌堆（不是答错罚下，那条走 AI_ELIMINATED）。
   *
   * `by` 是干这件事的那张技能牌，眼下只可能是 'memory-shortage' 或 'domestic-substitution'，
   * 客户端可以据此给两张牌配不同的演出。
   * 还带一个 `cardId` 是因为事件发出时快照里这个单位已经不在场上了，
   * 界面要画"谁被清掉了"只剩事件里这一份卡面身份（和 AI_ANSWERED 同一个道理）。
   */
  | {
      type: 'AI_REMOVED'
      instanceId: InstanceId
      owner: PlayerId
      cardId: CardId
      by: CardId
    }
  /**
   * 场上单位进化成了另一张卡（眼下只有「鸡犬升天」会产生）。
   *
   * 换的是同一个单位的卡面身份，`instanceId` 不变，身上的本轮标记也都留着——
   * 客户端换图即可，不要当成"旧的下场、新的上场"来演。
   */
  | {
      type: 'AI_TRANSFORMED'
      instanceId: InstanceId
      owner: PlayerId
      fromCardId: CardId
      toCardId: CardId
    }
  /**
   * 本轮计分。所有成对的字段一律按座位号排，[0] 是 0 号玩家。
   *
   * 除了得分本身还带上判定的全部依据（谁答对了、各花了多少 Token、按哪条规则分的），
   * 客户端的结算演出和教程的提示语都直接读它，不要自己回头再算一遍——
   * `correctCounts` 是双方实际答对的 AI 数量，光看结算后场上人数推不出来：
   * 被保送的单位答错也留在场上（见 AI_SAFE_PASSED）。
   */
  | {
      type: 'ROUND_SCORED'
      /** 本轮各得几分：0 或 1，双方答对数和消耗都相同时是 [1, 1]。 */
      gains: [number, number]
      /** 加完这一轮之后的累计总分。 */
      scores: [number, number]
      /** 本轮双方各有几个 AI 答对；场上没 AI 就是 0。 */
      correctCounts: [number, number]
      /** 本轮各方为新打出的牌花掉的 Token（见 PlayerState.spentThisRound）。 */
      spent: [number, number]
      /** 这一分是按哪条规则分出来的。 */
      verdict: RoundVerdict
    }
  /** 某一方在结算界面上确认了本轮。双方都确认后才会有后续的推进事件。 */
  | { type: 'ROUND_CONFIRMED'; player: PlayerId }
  | { type: 'GAME_OVER'; winner: PlayerId | 'draw' }
  /**
   * 非法指令。状态保持不变，只回这一条事件。
   * 房主模式下房主可以只把它回给发指令的人，不必广播。
   */
  | { type: 'COMMAND_REJECTED'; reason: string }

/** 引擎的统一返回：新状态 + 本次产生的事件。 */
export interface ExecuteResult {
  state: GameState
  events: GameEvent[]
}
