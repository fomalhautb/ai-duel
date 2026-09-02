/**
 * 答题阶段的自动驾驶：进入 quiz 后隔一小会儿替引擎把本轮答题结果提交上去。
 *
 * 为什么要有这么一层：`SUBMIT_ANSWERS` 不是玩家能点出来的指令，
 * 它代表"场上这批 AI 已经答完题了"。跑引擎的那一端（本地 driver / 房主）负责生成结果——
 * 默认结果来自 core 的 `scriptedAnswers`，也就是那份离线预生成的真实模型回答表；
 * 也可以由调用方用 `answersFor` 换一份（眼下没人换：教学对战也查同一张表，
 * 它的"可预测"靠挑题和挑牌挑出来，见 tutorial/content.ts）。
 * 将来换成对局中途真去调模型 API 同样只改这一处实现，指令形状和这层的时序都不用动。
 *
 * 延迟纯粹是给客户端留出播"揭晓题目 + AI 作答中"的时间，
 * 不追求和动画精确对齐：动画层收不到结果只是少播一段，不会把局面卡住。
 */

import { scriptedAnswers } from '@ai-duel/core'
import type {
  AiInstance,
  AnswerResult,
  Command,
  GamePhase,
  GameState,
  Question,
} from '@ai-duel/core'

/** 进入答题阶段后等多久自动提交结果（毫秒）。 */
export const QUIZ_AUTOPILOT_DELAY_MS = 2500

/**
 * 生成本轮答题结果的那一步，形状和 core 的 `scriptedAnswers` 一致。
 *
 * 单独起个类型名是为了让"换一份结果来源"变成传一个参数：
 * 正式对局和教学对战都查 core 那份预生成的真实模型回答，
 * 将来改成对局中途实时调模型 API 也是换掉这一处实现，指令形状和这层的时序都不用动。
 */
export type QuizAnswersFor = (
  question: Question,
  aiUnits: readonly AiInstance[],
) => AnswerResult[]

export interface QuizAutopilotOptions {
  /**
   * 取当前局面。
   * 定时器到点时必须读**最新**的一份，而不是触发那一刻的快照：
   * 这中间玩家还能用测试面板改手牌，拿旧快照算出来的结果会和场上对不上，被引擎整条拒掉。
   */
  getState(): GameState | null
  /** 把指令喂给引擎，和玩家自己发指令走同一条路径。 */
  apply(command: Command): void
  /** 延迟毫秒数，留给测试调短。 */
  delayMs?: number
  /**
   * 结果从哪来，不填就是 core 的 `scriptedAnswers`（查预生成的真实模型回答）。
   * 眼下所有对局都用默认那份，这个口子留给"某一局要换一份结果来源"的情况。
   */
  answersFor?: QuizAnswersFor
}

export interface QuizAutopilot {
  /** 每执行完一条指令调用一次，传入执行后的最新局面。 */
  observe(state: GameState | null): void
  /** 清掉还没到点的定时器。driver dispose 时必须调，否则界面都卸载了它还会往引擎发指令。 */
  dispose(): void
}

export function createQuizAutopilot({
  getState,
  apply,
  delayMs = QUIZ_AUTOPILOT_DELAY_MS,
  answersFor = scriptedAnswers,
}: QuizAutopilotOptions): QuizAutopilot {
  let timer: ReturnType<typeof setTimeout> | null = null
  /**
   * 上一次看到的阶段。只在"从非 quiz 变成 quiz"这个变化沿上排一次定时器：
   * 答题阶段里测试面板照样能发 DEBUG_ADD_CARD 之类的指令，每条都触发的话
   * 会排出好几个定时器，同一轮被提交多次（第二次起会被引擎拒掉，但事件流里会多出噪音）。
   */
  let lastPhase: GamePhase | null = null
  let disposed = false

  function clear(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function submit(): void {
    timer = null
    if (disposed) return
    const state = getState()
    // 到点时局面可能已经不在答题阶段了（比如测试面板手动推进过），那就什么都不做。
    if (state === null || state.phase !== 'quiz') return
    const question = state.questions[state.round - 1]
    if (question === undefined) return
    // 双方在场的 AI 合并成一批一起答题，顺序固定为「0 号玩家的场，然后 1 号玩家的场」，
    // 两端算出来的结果才完全一致。
    const aiUnits = [...state.players[0].board, ...state.players[1].board]
    apply({ type: 'SUBMIT_ANSWERS', results: answersFor(question, aiUnits) })
  }

  return {
    observe(state) {
      if (disposed) return
      const phase = state?.phase ?? null
      if (phase === 'quiz' && lastPhase !== 'quiz') {
        clear()
        timer = setTimeout(submit, delayMs)
      }
      lastPhase = phase
    },
    dispose() {
      disposed = true
      clear()
    },
  }
}
