/**
 * 教程控制器：把步骤表（steps.ts）跑起来。
 *
 * 三路输入汇到这里——引擎事件（tutorialDriver 的事件旁路）、舞台演出信号
 * （MatchStage 的 onStageCue）、以及计时——推着当前步骤往前走；
 * 两路输出交出去：给 MatchStage 的限制（哪几张手牌能打、「结束出牌」能不能点）
 * 和给 TutorialOverlay 的提示（一句话 + 要挖洞高亮的元素）。
 *
 * 步骤推进的判定全在 steps.ts 的纯函数里，这里只负责"什么时候调它们"和排定时器。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCard } from '@ai-duel/core'
import type { CardId, GameEvent, PlayerState } from '@ai-duel/core'
import { useMatch } from '../match/useMatch'
import type { TutorialDriver } from '../match/tutorialDriver'
import type { MatchStageCue, MatchStageTutorial } from '../ui/matchStageTutorial'
import { TUTORIAL_PLAYER_SEAT } from './content'
import {
  TUTORIAL_FIRST_STEP,
  TUTORIAL_STEPS,
  allowanceOf,
  signalSatisfied,
  tutorialStep,
} from './steps'
import type { TutorialHighlight, TutorialSignal, TutorialStep, TutorialStepId } from './steps'

export interface TutorialControllerResult {
  /** 当前这一步的完整定义，Overlay 拿它取提示文案和压暗开关。 */
  step: TutorialStep
  /** readyOn 都到齐了没有。没到齐时提示不出场（多半是在等一段全屏过场演完）。 */
  ready: boolean
  /** 要挖洞高亮的元素，已经换算成 CSS 选择器（找不到的目标会被剔掉）。 */
  highlightSelectors: string[]
  /** 原样交给 MatchStage 的 tutorial prop。 */
  stage: MatchStageTutorial
}

/** 拿一个高亮目标换算成能查到 DOM 的选择器；查不到对应手牌时返回 null。 */
function selectorOf(
  highlight: TutorialHighlight,
  handInstanceIdOf: (cardId: CardId) => string | null,
): string | null {
  if (highlight.kind === 'anchor') return `[data-tutorial-anchor="${highlight.name}"]`
  const instanceId = handInstanceIdOf(highlight.cardId)
  if (instanceId === null) return null
  // 必须限定在 .hand-fan 里：手牌、战场小卡、展示卡共用同一套 data-flip-id。
  return `.hand-fan [data-flip-id="${CSS.escape(instanceId)}"]`
}

/**
 * 手牌里第一张这种卡的实例 id，**并且此刻真的打得出去**；否则返回 null。
 *
 * 判据和 HandFan 的 blocked 一致（本轮已派过 AI、Token 不够）。要判这一下是因为
 * 高亮的含义是"点这张"：第 2 轮增派完一张之后另一张就变灰了，还亮着圈只会让人反复去点它。
 */
function playableInstanceId(player: PlayerState | null, cardId: CardId): string | null {
  if (player === null) return null
  const instance = player.hand.find((item) => item.cardId === cardId)
  if (instance === undefined) return null
  const card = getCard(instance.cardId)
  if (card.kind === 'ai' && player.aiPlayedThisRound) return null
  if (card.tokenCost > player.tokens) return null
  return instance.instanceId
}

/**
 * readyOn 等信号的兜底时限：超过这么久还没等齐就强行让提示出场。
 *
 * 取值要盖得住这里最长的那一段演出（答题揭晓层从立起到退场约 4~5 秒，加上后面
 * 一串轮次横幅约 3 秒），又不至于让真出问题时的等待长到玩家以为界面死了。
 */
const READY_TIMEOUT_MS = 12000

/** 局面还没到手时的空手牌。写成常量是为了别每次渲染都造个新数组，白白让下面的 useMemo 重算。 */
const EMPTY_HAND: PlayerState['hand'] = []

/** readyOn 里那几个 delay 的最长一个，用来排一条定时器（没有 delay 就返回 null）。 */
function longestDelay(signals: readonly TutorialSignal[]): number | null {
  let max: number | null = null
  for (const signal of signals) {
    if (signal.kind !== 'delay') continue
    if (max === null || signal.ms > max) max = signal.ms
  }
  return max
}

export function useTutorialController(driver: TutorialDriver): TutorialControllerResult {
  const view = useMatch(driver)
  const [stepId, setStepId] = useState<TutorialStepId>(TUTORIAL_FIRST_STEP)
  const [ready, setReady] = useState(false)
  const [idleHintOn, setIdleHintOn] = useState(false)

  /**
   * 机器本身的状态全走 ref：事件旁路是在 React 提交新快照**之前**同步送到的，
   * 那时读 state 拿到的是上一次渲染的旧值（同 MatchStage 里那批 ref 的理由）。
   */
  const stepIdRef = useRef<TutorialStepId>(TUTORIAL_FIRST_STEP)
  const readyRef = useRef(false)
  /** 这一步还差哪几个 readyOn 信号没到。拷一份，别拿步骤表里那个数组当可变状态用。 */
  const pendingReadyRef = useRef<TutorialSignal[]>([
    ...(tutorialStep(TUTORIAL_FIRST_STEP).readyOn ?? []),
  ])
  /**
   * 本轮已经出现过的舞台信号，每轮 ROUND_STARTED 清空一次。
   * 记着而不是只认"刚到的那条"的理由见 steps.ts 的 TutorialSignalContext.seenCues。
   */
  const seenCuesRef = useRef(new Set<MatchStageCue>())
  const enteredAtRef = useRef(Date.now())

  /** 进入某一步：只改状态和计时起点，具体的就绪/推进判定交给下面的 pump。 */
  const enterStep = useCallback((next: TutorialStepId) => {
    stepIdRef.current = next
    readyRef.current = false
    pendingReadyRef.current = [...(tutorialStep(next).readyOn ?? [])]
    enteredAtRef.current = Date.now()
    setStepId(next)
    setReady(false)
    setIdleHintOn(false)
  }, [])

  /**
   * 把当前这批输入喂给状态机，能推几步推几步。
   *
   * 循环是必要的：一批事件（或一条信号）可能同时满足"这一步就绪"和"这一步走完"，
   * 甚至连着满足下一步的就绪条件。上限取步骤表长度，防着数据写错时空转。
   */
  const pump = useCallback(
    (events: readonly GameEvent[]) => {
      for (let guard = 0; guard < TUTORIAL_STEPS.length; guard += 1) {
        const context = {
          seenCues: seenCuesRef.current,
          elapsedMs: Date.now() - enteredAtRef.current,
          events,
          playerSeat: TUTORIAL_PLAYER_SEAT,
        }
        if (!readyRef.current) {
          pendingReadyRef.current = pendingReadyRef.current.filter(
            (signal) => !signalSatisfied(signal, context),
          )
          if (pendingReadyRef.current.length === 0) {
            readyRef.current = true
            // 就绪那一刻重新起算：advance 的 delay 说的是"提示出来之后停多久"。
            enteredAtRef.current = Date.now()
            setReady(true)
          }
        }
        if (!readyRef.current) return

        const step = tutorialStep(stepIdRef.current)
        const advance = step.advance
        if (advance === undefined || step.next === null) return
        // delay 那一档由下面的定时器负责，这里只判"信号已经到了"的两种。
        if (advance.kind === 'delay') return
        if (!signalSatisfied(advance, { ...context, elapsedMs: 0 })) return
        enterStep(step.next)
      }
    },
    [enterStep],
  )

  /** 事件旁路：ROUND_STARTED 换一轮就把本轮的信号记录清空，然后照常推进。 */
  const handleEvents = useCallback(
    (events: GameEvent[]) => {
      if (events.some((event) => event.type === 'ROUND_STARTED')) {
        seenCuesRef.current = new Set()
      }
      // 玩家一动手就有事件产生，正好拿它当"没闲着"的判据（弱引导见 idleHint）。
      setIdleHintOn(false)
      pump(events)
    },
    [pump],
  )

  const handleEventsRef = useRef(handleEvents)
  handleEventsRef.current = handleEvents
  useEffect(() => driver.onEvents((events) => handleEventsRef.current(events)), [driver])

  /** 舞台信号。身份必须稳定：MatchStage 那边把它存进 ref，重建会白白多一次赋值。 */
  const onStageCue = useCallback(
    (name: MatchStageCue) => {
      seenCuesRef.current.add(name)
      pump([])
    },
    [pump],
  )

  // 挂载后先泵一次：第一步的 readyOn 要是空的（进入即就绪），没人喊它就永远起不来。
  useEffect(() => {
    pump([])
  }, [pump])

  /**
   * readyOn 的两条定时器：
   *
   * - delay 那几个到点了喊一次 pump，由它按 elapsedMs 判定；
   * - 另外挂一条兜底：等了 READY_TIMEOUT_MS 还没等到信号就强行就绪。
   *   readyOn 等的全是舞台演出信号，而演出可能因为各种边角情况没跑到收尾
   *  （比如技能命中那一段找不到目标格子，就不会有 'skill-hit'）。
   *   等不到信号最坏也只是提示晚出来、或者压在过场上，总好过整段教程冻死。
   */
  useEffect(() => {
    const signals = tutorialStep(stepId).readyOn ?? []
    if (signals.length === 0 || readyRef.current) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const ms = longestDelay(signals)
    if (ms !== null) timers.push(setTimeout(() => pump([]), ms))
    timers.push(
      setTimeout(() => {
        if (readyRef.current) return
        pendingReadyRef.current = []
        pump([])
      }, READY_TIMEOUT_MS),
    )
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [stepId, pump])

  // advance 是 delay 的那些步：提示出场之后停够时间就走下一步。
  useEffect(() => {
    if (!ready) return
    const step = tutorialStep(stepId)
    if (step.advance?.kind !== 'delay' || step.next === null) return
    const next = step.next
    const timer = setTimeout(() => {
      enterStep(next)
      // 进完新的一步必须再泵一次：不泵的话，readyOn 为空（进入即就绪）的下一步永远不会就绪，
      // 因为 enterStep 只改状态、就绪判定全在 pump 里。整条链会卡在这一步上。
      pump([])
    }, step.advance.ms)
    return () => clearTimeout(timer)
  }, [stepId, ready, enterStep, pump])

  // 弱引导（规格 §9）：第 3 轮长时间没操作才轻微高亮，不压暗也不弹规则说明。
  useEffect(() => {
    const hint = tutorialStep(stepId).idleHint
    if (hint === undefined || !ready || idleHintOn) return
    const timer = setTimeout(() => setIdleHintOn(true), hint.afterMs)
    return () => clearTimeout(timer)
  }, [stepId, ready, idleHintOn])

  // 对手脚本的闸门：只有明确要它动手的那几步才放行（见 steps.ts 的 releaseFoe）。
  useEffect(() => {
    driver.setFoeHold(tutorialStep(stepId).releaseFoe !== true)
  }, [driver, stepId])

  const step = tutorialStep(stepId)
  const player = view.state?.players[TUTORIAL_PLAYER_SEAT] ?? null
  const hand = player?.hand ?? EMPTY_HAND

  const handInstanceIdOf = useCallback(
    (cardId: CardId) => playableInstanceId(player, cardId),
    [player],
  )

  const allowance = allowanceOf(step)
  const blockedCards = useMemo(() => {
    const playable = allowance.playableCards
    if (playable === null) return null
    const tips = new Map<string, string>()
    for (const instance of hand) {
      if (!playable.includes(instance.cardId)) tips.set(instance.instanceId, allowance.blockTip)
    }
    return tips
  }, [hand, allowance])

  const highlightSelectors = useMemo(() => {
    if (!ready) return []
    const targets = [...(step.highlight ?? [])]
    if (idleHintOn && step.idleHint !== undefined) targets.push(...step.idleHint.highlight)
    const selectors: string[] = []
    for (const target of targets) {
      const selector = selectorOf(target, handInstanceIdOf)
      if (selector !== null && !selectors.includes(selector)) selectors.push(selector)
    }
    return selectors
  }, [ready, step, idleHintOn, handInstanceIdOf])

  const stage = useMemo<MatchStageTutorial>(
    () => ({ blockedCards, endPlayBlocked: !allowance.endPlay, onStageCue }),
    [blockedCards, allowance.endPlay, onStageCue],
  )

  return { step, ready, highlightSelectors, stage }
}
