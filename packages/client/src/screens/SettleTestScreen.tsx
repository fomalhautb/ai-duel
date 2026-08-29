/**
 * 回合结算界面的独立测试页（访问 /test 进入）。
 *
 * 结算层（ui/RoundSettleLayer.tsx）的每一种结果分支都藏在一局真实对局的深处：
 * 要看「消耗决胜」得刚好打成答对数相同，要看「查看终局结算」得先打到最后一轮。
 * 这一页把那一层单独拎出来，直接喂造好的数据，点一下就能反复看某一个分支的完整动画。
 *
 * 三件事必须和对局页一模一样，否则这一层的排版和滤镜会整个塌掉：
 * 1. 外面套 BattleFrame（复用 MatchStage 导出的那一个，不另抄一份）。结算层是
 *    position: fixed 铺满舞台的，靠 .battle-scaler 的 transform 当包含块才不会跑到留边上去。
 * 2. 里面那层 .battle 不能省：结算层的纸色、线色全是 --battle-* 变量，从它身上继承。
 *
 * 数据也全是真的：题目取自题库，回答取自 script.ts 那张「题目 × 卡牌」的剧本表，
 * 消耗按各张卡的 tokenCost 现加。所以只要挑对卡，对错分布和胜负判据就自然自洽，
 * 不用手写「假装它答对了」这种和回答文本对不上的数据。
 *
 * 事件节奏也照对局里那一套模拟：先只给题目（结果为空、未计分），
 * 过 2.5 秒再一次性补上全部回答和计分——自动驾驶的 driver 就是这么一批交上来的。
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import gsap from 'gsap'
import { QUESTION_POOL, getCard, scriptedAnswers } from '@ai-duel/core'
import type { AiInstance, CardId, GamePhase, Question, RoundVerdict } from '@ai-duel/core'
import { BattleFrame } from '../ui/MatchStage'
import { RoundSettleLayer } from '../ui/RoundSettleLayer'
import type {
  RoundSettle,
  SettleAiResult,
  SettleCorrect,
  SettleScore,
  SettleSides,
} from '../ui/RoundSettleLayer'
import './settle-test.css'

/**
 * 模拟结果事件的到达延迟（毫秒）。
 * 取 2.5 秒是照着自动驾驶 driver 的交卷时间来的（见结算层里 QUESTION_READ_HOLD 的说明）。
 */
const ARRIVE_DELAY_MS = 2500
/** 双方都确认之后隔多久把 phase 推走（毫秒）。对局里这一步是等引擎回新快照，也就一瞬。 */
const EXIT_DELAY_MS = 600
/**
 * 「加速」勾上时全局时间线的倍速。
 *
 * 光把结果的到达延迟调成 0 是快不了的：读题那 4 秒是从整层挂载算起的，
 * 结果早到只会让它多等一会儿，主线开跑的时刻不变（见结算层的 holdLeft）。
 * 想快进只能整体调快 GSAP，所以这一档单独给一个开关。
 */
const FAST_TIME_SCALE = 3

/** 一个可复现的结算场景。回答和对错不写在这里，按 question × 卡牌去剧本表里查。 */
interface Scenario {
  id: string
  /** 按钮上那行短名。 */
  label: string
  /** 控制条上那行说明：这个场景想看的是哪条判据。 */
  desc: string
  questionId: string
  round: number
  totalRounds: number
  /** 计分之前的总分，顶栏比分先显示它，主线跑到最后才跳到加完之后的数。 */
  scoresBefore: SettleSides
  /** 我方上场的 AI，按屏幕上从左到右排。 */
  mine: CardId[]
  foe: CardId[]
}

/*
 * 五个场景覆盖计分的三档判定（见 core 的 RoundVerdict）：
 * 只有一方答对（① ④ ⑤）→ 双方同对时比消耗（②）→ 消耗也相同各拿 1 分（③）。
 * 同时把上场张数铺开：3v3、2v4、1v1、5v4、0v2。
 * 张数是另一条独立的排版变量——列数跟着张数涨、单边空场怎么排，只有真摆出来才看得见。
 *
 * 注意「这一方答没答对」是**团队口径**：己方至少一个 AI 答对就算答对，答对几个不参与判定。
 * 所以场景注释里那串 O/X 只是各张卡的实际对错（照 packages/core/src/script.ts 挑的），
 * 真正决定胜负的是"这一侧有没有 O"和两侧的消耗，换卡之前先去那张表对一眼。
 * 同一个场景里不要重复用同一张卡：instanceId 带了座位和序号所以不会撞 key，
 * 但一排两张一模一样的卡面会让人以为是渲染错了。
 */
const SCENARIOS: Scenario[] = [
  {
    id: 'mine-correct',
    label: '① 3v3 我方独对',
    desc: '3v3，我方 2/3 对手 0/3；只有我方答对，消耗更多（14 对 9）也照样拿下这一分',
    questionId: 'q-triangles',
    round: 2,
    totalRounds: 5,
    scoresBefore: { mine: 1, theirs: 1 },
    // O O X = 有人答对，消耗 4+4+6=14
    mine: ['gpt-4o', 'gemini', 'claude-fable-5'],
    // X X X = 全错，消耗 3+2+4=9（更省也没用，这一档根本不比消耗）
    foe: ['deepseek-r1', 'doubao', 'glm-5'],
  },
  {
    id: 'spend-tiebreak',
    label: '② 2v4 消耗决胜',
    desc: '2v4，双方都有人答对；判定落到消耗，我方 6 对 20，靠省 Token 拿下这一分',
    questionId: 'q-carwash',
    round: 3,
    totalRounds: 5,
    scoresBefore: { mine: 2, theirs: 1 },
    // O O = 有人答对，消耗 3+3=6
    mine: ['qwen', 'minimax'],
    // O O X X = 也有人答对，消耗 7+4+4+5=20（人多不占便宜，还把消耗堆上去了）
    foe: ['chatgpt-5-6-sol', 'glm-5', 'gemini', 'kimi-k3'],
  },
  {
    id: 'draw',
    label: '③ 1v1 势均力敌',
    desc: '1v1，各出一张且都答对；消耗也相同，两边都挂「平分秋色」徽章、各 +1 分',
    questionId: 'q-husky',
    round: 4,
    totalRounds: 5,
    scoresBefore: { mine: 2, theirs: 2 },
    // O = 有人答对，消耗 5
    mine: ['deepseek-v4'],
    // O = 也有人答对，消耗 5（和我方同价，消耗这一条也分不出胜负）
    foe: ['kimi-k3'],
  },
  {
    id: 'foe-wins',
    label: '④ 5v4 多张（末轮）',
    desc: '5v4 共九张，两侧一起变成五列、仍各排一行；我方全错落败，末轮按钮换成「查看终局结算」',
    questionId: 'q-nurse',
    round: 5,
    totalRounds: 5,
    scoresBefore: { mine: 2, theirs: 3 },
    // X X X X X = 全错，消耗 1+2+2+3+5=13（省下的钱救不回来，只有一方答对时不比消耗）
    mine: ['gpt-2', 'gpt-3-5', 'doubao', 'minimax', 'deepseek-v4'],
    // O O O X = 有人答对，消耗 6+4+5+3=18
    foe: ['claude-fable-5', 'gemini', 'kimi-k3', 'wenxin-yiyan'],
  },
  {
    id: 'one-side-empty',
    label: '⑤ 0v2 单边空场',
    desc: '0v2，我方一个 AI 都没上：场上没 AI 就算没答对，消耗 0 也救不了，验证单边空场的排版',
    questionId: 'q-surgeon',
    round: 1,
    totalRounds: 5,
    scoresBefore: { mine: 0, theirs: 0 },
    // 一张都不上，消耗 0；没有 AI 作答 = 这一方没答对
    mine: [],
    // O O = 有人答对，消耗 5+4=9
    foe: ['deepseek-v4', 'glm-5'],
  },
]

export function SettleTestScreen() {
  const [, navigate] = useLocation()

  /** 当前选中的场景 id，null 表示还没点过任何场景。 */
  const [scenarioId, setScenarioId] = useState<string | null>(null)
  /** 喂给结算层的数据。退场之后置 null，整层被卸掉。 */
  const [settle, setSettle] = useState<RoundSettle | null>(null)
  /** 结果没到时是 quiz，到了是 settle，双方确认完推到 play 触发退场——和引擎的阶段顺序一致。 */
  const [phase, setPhase] = useState<GamePhase>('quiz')
  const [myConfirmed, setMyConfirmed] = useState(false)
  const [foeConfirmed, setFoeConfirmed] = useState(false)
  /** 勾上之后结果不再延迟 2.5 秒，选完场景当场到齐。 */
  const [instant, setInstant] = useState(false)
  const [fast, setFast] = useState(false)
  /** 控制条收起时只留一个小按钮，方便截图看完整画面。 */
  const [barOpen, setBarOpen] = useState(true)

  /** 每重播一次 +1。它同时是结算层的 React key，换了就是一套全新的 DOM、动画从头演。 */
  const keyRef = useRef(0)
  /**
   * 待触发的模拟事件定时器。
   * 数组对象本身从不替换（清的时候改 length），卸载时那个 effect 捕获的才一直是同一个数组。
   */
  const timersRef = useRef<number[]>([])

  const scenario = SCENARIOS.find((item) => item.id === scenarioId) ?? null
  const settleKey = settle === null ? null : settle.key

  // 双方都确认之后把阶段推走，结算层看到 phase 不再是 quiz / settle 就播退场。
  useEffect(() => {
    if (settleKey === null || !myConfirmed || !foeConfirmed) return
    const timer = window.setTimeout(() => setPhase('play'), EXIT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [settleKey, myConfirmed, foeConfirmed])

  // 加速是调全局时间线，离开这一页必须调回来，否则别的页面也会跟着变快。
  useEffect(() => {
    gsap.globalTimeline.timeScale(fast ? FAST_TIME_SCALE : 1)
    return () => {
      gsap.globalTimeline.timeScale(1)
    }
  }, [fast])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [])

  /** 从头演一遍某个场景：先只给题目，隔一会儿再把回答和计分一次性补上。 */
  function play(next: Scenario): void {
    for (const timer of timersRef.current) window.clearTimeout(timer)
    timersRef.current.length = 0

    keyRef.current += 1
    const key = keyRef.current
    setScenarioId(next.id)
    setMyConfirmed(false)
    setFoeConfirmed(false)
    setPhase('quiz')
    setSettle({
      key,
      question: questionOf(next.questionId),
      round: next.round,
      scoresBefore: next.scoresBefore,
      results: [],
      score: null,
    })

    const results = buildResults(next)
    const score = buildScore(next, results)
    const timer = window.setTimeout(
      () => {
        // 期间又点了别的场景的话这一批就作废了，靠 key 认出来直接丢掉。
        setSettle((current) =>
          current === null || current.key !== key ? current : { ...current, results, score },
        )
        setPhase('settle')
      },
      instant ? 0 : ARRIVE_DELAY_MS,
    )
    timersRef.current.push(timer)
  }

  return (
    <div className="settle-test">
      <BattleFrame>
        <div className="battle">
          {settle === null || scenario === null ? (
            <p className="settle-test__empty">
              {scenarioId === null ? '选个场景开始' : '已退场，选个场景重播'}
            </p>
          ) : (
            <RoundSettleLayer
              key={settle.key}
              settle={settle}
              totalRounds={scenario.totalRounds}
              phase={phase}
              myConfirmed={myConfirmed}
              foeConfirmed={foeConfirmed}
              onConfirm={() => setMyConfirmed(true)}
              onExited={() => {
                setSettle(null)
                setMyConfirmed(false)
                setFoeConfirmed(false)
              }}
            />
          )}
        </div>
      </BattleFrame>

      {/* 控制条挂在 BattleFrame **外面**：进到缩放层里会跟着 transform 一起被缩小，字就糊了。 */}
      <div className="settle-test__bar" data-open={barOpen ? 'true' : 'false'}>
        <div className="settle-test__bar-head">
          <span className="settle-test__bar-title">回合结算测试页</span>
          <button
            type="button"
            className="settle-test__mini"
            onClick={() => setBarOpen((current) => !current)}
          >
            {barOpen ? '收起' : '展开'}
          </button>
        </div>

        {barOpen ? (
          <>
            <div className="settle-test__row">
              {SCENARIOS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="settle-test__btn"
                  data-active={item.id === scenarioId ? 'true' : 'false'}
                  onClick={() => play(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="settle-test__row">
              <button
                type="button"
                className="settle-test__btn"
                disabled={scenario === null}
                onClick={() => scenario !== null && play(scenario)}
              >
                重播
              </button>
              <button
                type="button"
                className="settle-test__btn"
                disabled={settle === null || foeConfirmed}
                onClick={() => setFoeConfirmed(true)}
              >
                对方确认
              </button>
              <label className="settle-test__toggle">
                <input
                  type="checkbox"
                  checked={instant}
                  onChange={(event) => setInstant(event.target.checked)}
                />
                立即到达
              </label>
              <label className="settle-test__toggle">
                <input
                  type="checkbox"
                  checked={fast}
                  onChange={(event) => setFast(event.target.checked)}
                />
                {FAST_TIME_SCALE}× 加速
              </label>
              <button type="button" className="settle-test__btn" onClick={() => navigate('/dev')}>
                回 /dev
              </button>
            </div>

            <p className="settle-test__status">
              {scenario === null ? '未选场景' : `${scenario.label} · ${scenario.desc}`}
            </p>
            <p className="settle-test__status settle-test__status--state">
              状态：
              {scenarioId === null
                ? '未开始'
                : stateTextOf(settle, phase, myConfirmed, foeConfirmed)}
            </p>
          </>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 控制条上那行「现在演到哪」，和结算层自己的步骤条无关，看的是喂进去的数据。
 * 一次都没点过场景的情况由调用方拦掉，这里的 settle 为空一律当成「已退场」。
 */
function stateTextOf(
  settle: RoundSettle | null,
  phase: GamePhase,
  myConfirmed: boolean,
  foeConfirmed: boolean,
): string {
  if (settle === null) return '已退场'
  if (settle.score === null) return '作答中（结果未到）'
  if (phase !== 'settle') return '退场中'
  if (myConfirmed && foeConfirmed) return '双方已确认 · 即将退场'
  if (myConfirmed) return '我方已确认 · 等待对方'
  if (foeConfirmed) return '对方已确认 · 等我方'
  return '已计分 · 等确认'
}

function questionOf(questionId: string): Question {
  const question = QUESTION_POOL.find((item) => item.id === questionId)
  if (question === undefined) throw new Error(`题库里没有这道题：${questionId}`)
  return question
}

/**
 * 按场景查剧本表，攒出结算层要的那一批结果。
 *
 * 走的就是对局里那个 scriptedAnswers，所以回答文本和 correct 天然对得上——
 * 手写一个「答对了」再配一句「护士都是女的」那种数据，界面上一眼就穿帮。
 */
function buildResults(scenario: Scenario): SettleAiResult[] {
  const question = questionOf(scenario.questionId)
  const units: AiInstance[] = [
    ...scenario.mine.map((cardId, index) => unitOf(cardId, 0, index)),
    ...scenario.foe.map((cardId, index) => unitOf(cardId, 1, index)),
  ]
  // 结果按 instanceId 认回各自的卡：scriptedAnswers 现在是照原序返回的，
  // 但结算层要的 cardId / mine 只有 units 这边有，按 id 配对就不用依赖那个顺序。
  const answers = new Map(scriptedAnswers(question, units).map((item) => [item.instanceId, item]))
  return units.map((unit) => {
    const answer = answers.get(unit.instanceId)
    if (answer === undefined) throw new Error(`剧本没给出 ${unit.cardId} 的回答`)
    return {
      instanceId: unit.instanceId,
      cardId: unit.cardId,
      mine: unit.owner === 0,
      correct: answer.correct,
      answer: answer.answer,
      reasoning: answer.reasoning,
    }
  })
}

/**
 * instanceId 带上座位和序号：同一张卡两边各上一个在对局里是常见场景
 *（上面五个场景刻意都避开了，但换卡随时会遇到），光用 cardId 当 id 的话结果卡的 React key 会撞车。
 */
function unitOf(cardId: CardId, owner: 0 | 1, index: number): AiInstance {
  return { instanceId: `${owner === 0 ? 'mine' : 'foe'}-${index}-${cardId}`, cardId, owner }
}

/**
 * 按引擎那套判据算本轮计分（见 core 的 submitAnswers）：
 * 只有一方答对就那方拿分；双方同对或同错就比谁花的 Token 少；消耗也一样就各拿 1 分。
 *
 * 「这一方答没答对」是团队口径的布尔值：己方**至少一个** AI 答对就算答对，
 * 场上一个 AI 都没有的一方算没答对（filter 出来是空数组，some 自然是 false）。
 *
 * 消耗直接取这一侧全部上场卡的 tokenCost 之和——当成「这些 AI 都是本轮打出来的」，
 * 这样场景里改一张卡，消耗和胜负会跟着自己变，不用再手工对一遍数。
 */
function buildScore(scenario: Scenario, results: SettleAiResult[]): SettleScore {
  const correct: SettleCorrect = {
    mine: results.some((item) => item.mine && item.correct),
    theirs: results.some((item) => !item.mine && item.correct),
  }
  const spent: SettleSides = {
    mine: tokenSum(scenario.mine),
    theirs: tokenSum(scenario.foe),
  }
  const verdict: RoundVerdict =
    correct.mine !== correct.theirs
      ? 'sole-correct'
      : spent.mine !== spent.theirs
        ? 'fewer-tokens'
        : 'equal-tokens'
  const gains: SettleSides =
    verdict === 'sole-correct'
      ? correct.mine
        ? { mine: 1, theirs: 0 }
        : { mine: 0, theirs: 1 }
      : verdict === 'fewer-tokens'
        ? spent.mine < spent.theirs
          ? { mine: 1, theirs: 0 }
          : { mine: 0, theirs: 1 }
        : { mine: 1, theirs: 1 }
  return {
    correct,
    spent,
    gains,
    totals: {
      mine: scenario.scoresBefore.mine + gains.mine,
      theirs: scenario.scoresBefore.theirs + gains.theirs,
    },
    verdict,
  }
}

function tokenSum(cardIds: CardId[]): number {
  return cardIds.reduce((total, cardId) => total + getCard(cardId).tokenCost, 0)
}
