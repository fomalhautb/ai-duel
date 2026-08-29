/**
 * 回合结算全屏层：题目 + 标准答案 + 双方 AI 的作答 + 本轮计分 + 确认按钮。
 *
 * 本层的数据是**两路口径**，别混着用：
 * - 内容（题面、谁答了什么、本轮计分）全部吃 MatchStage 按事件攒出来的 `RoundSettle`。
 *   不能改读局面快照：答错的 AI 在新快照里已经被罚下、从场上消失了，
 *   只有 `AI_ANSWERED` 事件里还留着它是哪张卡、答了什么。
 * - 确认态（按钮三态、比分、消耗）读局面快照，也就是 `phase` / `myConfirmed` / `foeConfirmed`。
 *   settle 本来就是引擎特意留出的一段"局面不再变"的阶段（见 core 的 GamePhase 注释），
 *   这几个值在整层立着的期间是稳的，比再攒一份事件可靠。
 *
 * 动画全部内聚在这个文件里（MatchStage 那边一条时间线都不加），分成四段 `useGSAP`：
 * 1. **入场**：整层淡入、顶栏下滑、题目升起，同时把后面几拍要用的元件全部压住（autoAlpha 0），
 *    并把退场动画包成 contextSafe 存进 ref。只在挂载时跑一次。
 * 2. **新结果卡**：`AI_ANSWERED` 是一条条到的，卡片也就一张张出现，
 *    所以"卡壳淡入 + 亮 loader + 挂 hover 倾斜"必须跟着 `results.length` 走，不能塞进入场那段。
 * 3. **主线**：`ROUND_SCORED` 到了才起跑，从挂载时刻算满 `QUESTION_READ_HOLD` 的读题时间，
 *    然后按 答案擦入 → 逐卡打字 → 逐卡盖章 → 底栏结论 → 比分跳动 → 解锁按钮 演一遍。
 *    顶栏步骤条、顶部比分、按钮可点与否都由这条线上的 `.call` 改本地 state 驱动，
 *    不再从 `score !== null` 直接推导——推导出来的话三样会在计分事件到达的同一帧全部跳完。
 * 4. **退场**：阶段离开 settle 时整层淡出缩小，`onComplete` 里才通知 MatchStage 收层。
 *
 * 凡是从这些动画的回调里往外调 props 的（收层、演出节点），一律经 `notifyOutside` 发，
 * 别直接调——gsap 的 context 会顺着这条路把外面那个组件收养进来，原委见那个函数的注释。
 *
 * 打字机用 GSAP 的 TextPlugin，它写的是元素的 innerHTML，会和 React 渲染的文本互相覆盖。
 * 解法是**让 React 完全不管这两个节点的文本**：`.settle-card__answer` / `__reasoning`
 * 在 JSX 里渲染成空元素，全文挂在 `data-text` 属性上（属性归 React 管，内容归 GSAP 管），
 * 时间线开打时现从 `dataset.text` 读。这样中途任何一次重渲染都不会把打了一半的字抹掉。
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { TextPlugin } from 'gsap/TextPlugin'
import { getCard } from '@ai-duel/core'
import type { CardId, GamePhase, InstanceId, Question, RoundVerdict } from '@ai-duel/core'
import { attachCardTilt } from './cardTilt'
import type { CardTiltHandle } from './cardTilt'
import { HandCardFace } from './HandFan'
import { toHandCardData } from './handCardData'
import { QUESTION_CATEGORY_LABELS } from './labels'
import { PlaqueButton } from './PlaqueButton'
import { prefersReducedMotion } from './reducedMotion'

gsap.registerPlugin(useGSAP, TextPlugin)

/**
 * 题目亮出来之后留给玩家读题的时间（秒），从整层挂载那一刻算起。
 *
 * 比 driver 自动驾驶交卷的 2.5 秒长：那批结果事件到得比这早，主线要在这里再等一会儿，
 * 玩家才来得及把题看完。等待长度是"还差多少"，不是"再等四秒"（见主线里的 holdLeft）。
 */
const QUESTION_READ_HOLD = 4
/** 开了减少动效时的读题时间（秒）：仍要留一拍看清题面，但不再等满四秒。 */
const REDUCED_READ_HOLD = 1
/** 标准答案面板从左往右擦出来的时长（秒）。 */
const ANSWER_REVEAL_DUR = 0.6
/** 大字答案每打一个字的秒数。 */
const TYPE_ANSWER_CHAR_SEC = 0.045
/** 小字推理每打一个字的秒数。 */
const TYPE_REASONING_CHAR_SEC = 0.02
/**
 * 推理整段最长打这么久（秒）。
 * 推理长度不受控（脚本里各写各的），不封顶的话一张长推理会把后面所有卡一起拖住。
 */
const TYPE_REASONING_MAX = 1.2
/** 「作答中」转圈淡出的时长（秒），淡完才开始打字。 */
const LOADER_FADE = 0.2
/** 相邻两张结果卡开始作答的间隔（秒）。 */
const CARD_STAGGER = 0.45
/** 判定章盖下来的时长（秒）。 */
const STAMP_DUR = 0.28
/** 相邻两张卡盖章的间隔（秒）。 */
const STAMP_STAGGER = 0.22
/** 整层退场的时长（秒）。 */
const EXIT_DUR = 0.45
/** 结果卡逐张淡入的间隔（秒）。 */
const CARD_IN_STAGGER = 0.08
/**
 * 开了减少动效时所有补间压到的时长（秒）。
 * 不写 0：零时长补间在时间线上和 `set` 等价，留 0.01 是为了这些补间仍然按原来的先后次序落地。
 */
const MIN_DUR = 0.01

/**
 * 判定章盖稳之后歪着的角度。
 *
 * 和 styles.css 里 `.settle-card__verdict` 的 `rotate: -6deg` 是同一个数，必须一起改。
 * 两处都要有：CSS 那份是时间线没跑起来时的静止形态，而 GSAP 一碰这个元素的 transform
 * 就会往内联样式里写死 `rotate: none` 把 CSS 那份压掉，所以补间的终点也得显式写回来。
 */
const VERDICT_TILT_DEG = -6
/** 答错的卡正文压到的不透明度。压暗是盖章那一刻才发生的，所以写在这里不写 CSS。 */
const WRONG_BODY_OPACITY = 0.72
/** 头像跟着指针倾斜的最大角度（度）。头像比战场小卡还小，幅度取和它一样的 12 度才看得出来。 */
const AVATAR_TILT_DEG = 12
/**
 * 头像 hover 时放大的倍数。
 *
 * 取 2 倍是为了看清卡面上的字（90×135 的头像放到 180×270，和手牌里那张差不多大）。
 * 这么大一定会溢出自己那个框、压到卡内文字和邻卡，靠两件事兜住：
 * 放大只作用在 `.settle-card__avatar-tilt` 上（avatar 那层仍占原位，排版不受影响），
 * 以及 CSS 里那两条抬层规则（`.settle-card:hover` 和 `.settle__squad:has(...)`）。
 */
const AVATAR_HOVER_SCALE = 2

/**
 * 结果卡最少排几列。
 *
 * 只上一个 AI 时不让那张卡横跨整块面板（一行小字会被拉得老长，和另一侧几张小卡完全不是一个量级），
 * 所以空位就空着。张数超过这个数时列数跟着涨，见渲染处 .settle__squads 上的注释。
 */
const MIN_CARD_COLUMNS = 3

/** 我方 / 对方两个数一组。事件里的数组按座位号排，进这一层之前先换算成"我"和"对面"。 */
export interface SettleSides {
  mine: number
  theirs: number
}

/** 一个 AI 的作答结果，由 `AI_ANSWERED` 当场攒出来。 */
export interface SettleAiResult {
  instanceId: InstanceId
  /** 这个 AI 是哪张卡。头像和卡名都照它画（答错的那个查快照已经查不到了）。 */
  cardId: CardId
  /** 这个 AI 是我方的还是对方的。收事件时按当时的座位算好，渲染时不用再查局面。 */
  mine: boolean
  correct: boolean
  /** 回答本身（短语），卡片上那行大字。 */
  answer: string
  /** 回答的理由，两行以内的小字。 */
  reasoning: string
  /**
   * 答错了但被「保送」留在场上（`AI_SAFE_PASSED`），卡上多盖一枚「保送」。
   *
   * 判定照旧算答错：这张卡仍然画成错的、也不进 `SettleScore.correct` 的计数
   *（保送只免罚下，不改计分，见 core 的 submitAnswers）。这枚章说的只是"它没下场"。
   */
  safePassed?: true
}

/** 我方 / 对方各算不算答对。团队口径：己方至少一个 AI 答对就算答对（见 core 的 submitAnswers）。 */
export interface SettleCorrect {
  mine: boolean
  theirs: boolean
}

/** 本轮计分。`ROUND_SCORED` 到了才有，在那之前整层按"还在作答"的样子画。 */
export interface SettleScore {
  /**
   * 各自算不算答对。注意是**布尔**不是个数：这一版规则先看"这一方有没有答对"，
   * 答对几个不影响判定（场上没 AI 的一方视为没答对）。
   * 面板上那行「正确 N / M」只是给玩家看的战况统计，不是判据，由结果卡自己数出来。
   */
  correct: SettleCorrect
  /** 各自本轮花掉的 Token，双方同对或同错时靠它分胜负。 */
  spent: SettleSides
  /** 本轮各自拿到的分，只可能是 0 或 1；打平是双方各 1。 */
  gains: SettleSides
  /** 加完之后的总分。 */
  totals: SettleSides
  /** 这一分是按哪条规则分出来的，底栏那句结论直接照它写（见 core 的 RoundVerdict）。 */
  verdict: RoundVerdict
}

/** 一次结算要显示的全部内容。 */
export interface RoundSettle {
  /** 每轮换一个新的 key：拿它当 React key，下一轮就是一套全新的 DOM，不会继承上一轮的内联样式。 */
  key: number
  question: Question
  /** 这是第几轮。取的是建层那一刻的快照值——settle 期间轮次不变，之后才会 +1。 */
  round: number
  /** 计分之前的总分，顶栏在结果出来之前显示的就是它。 */
  scoresBefore: SettleSides
  /** `AI_ANSWERED` 逐条追加。 */
  results: SettleAiResult[]
  score: SettleScore | null
}

/**
 * 主线演到的两个节点，只有新手教程听：它要等这一层演到某一步才说下一句话。
 *
 * 这两个名字说的是**这一层自己的演出结构**，不是教程的步骤名——
 * 教程那边把它们翻译成自己的舞台信号（见 MatchStage 里接这个回调的地方）。
 * 另外两个节点各有现成的出口：整层立起来是 MatchStage 收到 QUESTION_REVEALED 那一刻，
 * 整层退场完毕走 onExited。
 */
export type SettleStageName =
  /** 全部结果卡的判定章都盖完了，也就是"逐张揭晓"这段演完。 */
  | 'results-done'
  /** 顶栏比分已经跳到本轮加完之后的总分（那下脉冲也做完了）。 */
  | 'score-shown'

export interface RoundSettleLayerProps {
  settle: RoundSettle
  /** 本局总轮数。最后一轮的确认按钮换成「查看终局结算」。 */
  totalRounds: number
  phase: GamePhase
  myConfirmed: boolean
  foeConfirmed: boolean
  onConfirm: () => void
  /** 该收层了。退场动画播完才调，调完 MatchStage 会把整层卸掉。 */
  onExited: () => void
  /**
   * 主线演到关键节点时报一声，正式对局不传。
   *
   * 挂在主线时间线上的 `.call` 里，所以它和屏幕上看到的是同一个时刻——
   * 教程据此决定"这句话什么时候说"，早一拍会压在还在打字的卡片上。
   */
  onStage?: (name: SettleStageName) => void
}

/** 顶栏步骤条的三步，顺序固定。 */
const STEP_LABELS = ['题目揭晓', 'AI 作答', '裁判结算'] as const

export function RoundSettleLayer({
  settle,
  totalRounds,
  phase,
  myConfirmed,
  foeConfirmed,
  onConfirm,
  onExited,
  onStage,
}: RoundSettleLayerProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  /**
   * 本端刚点过确认、新快照还没回来的那一小会儿。
   *
   * 联机客人的确认要绕一圈房主才回得来，光看 myConfirmed 的话这中间按钮还是可点的，
   * 连点两下第二条会被引擎当成"已经确认过了"拒掉，界面上弹一条错误提示。
   * 整层按 settle.key 挂 React key，所以下一轮重新挂载时它天然回到 false。
   */
  const [clicked, setClicked] = useState(false)

  /**
   * 主线演到第几步了：0 = 还在读题，1 = AI 作答中，2 = 裁判结算中，3 = 全部结束。
   * 顶栏步骤条按它画。由主线时间线上的 `.call` 一格一格推，不从 `score !== null` 推导——
   * 推导的话计分事件一到三步就会同时亮完，玩家还没看到 AI 打字就被告知结算完了。
   */
  const [step, setStep] = useState(0)
  /** 顶栏比分是否已经跳到本轮加完之后的总分。同样由主线点名，配合那一下缩放脉冲。 */
  const [scoreSettled, setScoreSettled] = useState(false)
  /** 确认按钮是否解锁。主线放完最后一拍才置 true，在那之前点了也没用。 */
  const [ready, setReady] = useState(false)

  /** 整层挂载那一刻（performance.now 的毫秒数）。主线用它算还差多少读题时间。 */
  const mountedAtRef = useRef(0)
  /** 主线时间线。退场时要把它掐掉，免得它继续去改一个正在淡出的层。 */
  const mainRef = useRef<gsap.core.Timeline | null>(null)
  /** 退场动画，已经用 contextSafe 包过。由下面那条 effect 触发。 */
  const playExitRef = useRef<(() => void) | null>(null)
  /** 已经处理过（压住初值、挂过 hover）的结果卡。清空归 useGSAP 的清理函数管。 */
  const seenCardsRef = useRef(new Set<Element>())
  /** 每个头像上挂着的 hover 倾斜句柄，卸载时逐个 detach。 */
  const tiltsRef = useRef(new Map<HTMLElement, CardTiltHandle>())

  const { question, score, results } = settle
  const mine = results.filter((item) => item.mine)
  const theirs = results.filter((item) => !item.mine)
  /** 两侧结果卡共用的列数：至少三列，人多了就按人多的那一侧加列（见下面 .settle__squads 的注释）。 */
  const cols = Math.max(MIN_CARD_COLUMNS, mine.length, theirs.length)

  // 阶段 A：入场。依赖 settle.key，而这个 key 同时也是 React key，所以整段只在挂载时跑一次。
  useGSAP(
    (ctx, contextSafe) => {
      const root = rootRef.current
      if (root === null) return
      mountedAtRef.current = performance.now()
      const reduced = prefersReducedMotion()
      const dur = (value: number) => (reduced ? MIN_DUR : value)

      // 退场必须包 contextSafe：它是被 React 的 effect 触发的，
      // 那时候 useGSAP 的同步执行早就结束了，直接建补间的话不归 context 管、卸载时 revert 不掉。
      const playExit = () => {
        mainRef.current?.kill()
        gsap.to(root, {
          autoAlpha: 0,
          scale: 0.985,
          duration: dur(EXIT_DUR),
          ease: 'power2.in',
          overwrite: 'auto',
          // 收层这一下必须走 notifyOutside：MatchStage 的 onExited 里会调它自己的
          // contextSafe 函数，不隔开的话它整个 context 会被本层收养，跟着本层一起被 revert
          // （横幅永久卡死就是这么来的，原委见 notifyOutside 的注释）。
          onComplete: () => notifyOutside(ctx, () => onExitedRef.current()),
        })
      }
      playExitRef.current = contextSafe ? contextSafe(playExit) : playExit

      // 后面几拍才登场的元件先全部压住。标准答案面板是其中最要紧的一个：
      // 它要是跟着整层一起亮出来，读题这四秒就白留了。
      gsap.set(
        all(root, '.settle__answer-panel, .settle__spend, .settle__verdict-line, .settle__confirm-slot'),
        { autoAlpha: 0 },
      )

      gsap
        .timeline()
        .fromTo(
          root,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: dur(0.35), ease: 'power2.out', overwrite: 'auto' },
        )
        .fromTo(
          all(root, '.settle__topbar'),
          { autoAlpha: 0, y: -16 },
          { autoAlpha: 1, y: 0, duration: dur(0.3), ease: 'power2.out', overwrite: 'auto' },
          0.05,
        )
        .fromTo(
          // 分隔饰跟着题目面板一起升起：它俩在同一行，只有一边动的话中间那条线会像是钉住的。
          all(root, '.settle__question-panel, .settle__divider'),
          { autoAlpha: 0, y: 26 },
          { autoAlpha: 1, y: 0, duration: dur(0.45), ease: 'back.out(1.3)', overwrite: 'auto' },
          0.1,
        )
        .fromTo(
          all(root, '.settle__squad'),
          { autoAlpha: 0 },
          {
            autoAlpha: 1,
            duration: dur(0.3),
            stagger: reduced ? 0 : CARD_IN_STAGGER,
            ease: 'power2.out',
            overwrite: 'auto',
          },
          0.2,
        )
    },
    { scope: rootRef, dependencies: [settle.key] },
  )

  /*
   * 阶段 A 的后半段：结果卡。
   *
   * 单独一段是因为卡片不是和整层一起出现的——`AI_ANSWERED` 一条条到，React 也就一张张渲染。
   * 依赖数组非空时 useGSAP 只在**卸载**时 revert，所以这段每次重跑都是"往上加"，
   * 已经处理过的卡靠 seenCardsRef 认出来跳过，不然每来一张新卡就把在场的全部重新淡入一遍。
   */
  useGSAP(
    () => {
      const root = rootRef.current
      if (root === null) return
      const reduced = prefersReducedMotion()
      const fresh: HTMLElement[] = []
      for (const card of root.querySelectorAll<HTMLElement>('.settle-card')) {
        if (seenCardsRef.current.has(card)) continue
        seenCardsRef.current.add(card)
        fresh.push(card)
      }

      if (fresh.length > 0) {
        for (const card of fresh) {
          // 卡名跟着卡壳一起出——"这是谁"在读题阶段就该看得到；
          // 答案、推理、判定章要等主线点名，先压住。loader 则反过来立刻亮起来。
          gsap.set(all(card, '.settle-card__answer, .settle-card__reasoning, .settle-card__verdict'), {
            autoAlpha: 0,
          })
          gsap.set(all(card, '.settle-card__loader'), { autoAlpha: 1 })
        }
        gsap.fromTo(
          fresh,
          { autoAlpha: 0 },
          {
            autoAlpha: 1,
            duration: reduced ? MIN_DUR : 0.3,
            stagger: reduced ? 0 : CARD_IN_STAGGER,
            ease: 'power2.out',
            overwrite: 'auto',
          },
        )

        for (const card of fresh) {
          const avatar = card.querySelector<HTMLElement>('.settle-card__avatar')
          const tilt = card.querySelector<HTMLElement>('.settle-card__avatar-tilt')
          if (avatar === null || tilt === null) continue
          // 倾斜和放大写在 tilt 层，不写在 avatar 上：avatar 那一层要保持原尺寸占位，
          // 放大溢出的部分才不会把这一行卡的排版顶歪。
          // 溢出之后压谁在上由 CSS 的两条抬层规则决定：`.settle-card:hover` 管同一侧的邻卡，
          // `.settle__squad:has(.settle-card:hover)` 管另一侧那整块面板。
          tiltsRef.current.set(
            avatar,
            attachCardTilt(avatar, {
              tiltLayer: tilt,
              maxTilt: AVATAR_TILT_DEG,
              hoverScale: AVATAR_HOVER_SCALE,
            }),
          )
        }
      }

      // 只有卸载（含 StrictMode 那次假卸载）才会走到这里：监听和补间都得跟着收掉，
      // 顺带清空 seen 记录，重新挂回来时整批卡会被当成新卡再走一遍。
      return () => {
        for (const handle of tiltsRef.current.values()) handle.detach()
        tiltsRef.current.clear()
        seenCardsRef.current.clear()
      }
    },
    { scope: rootRef, dependencies: [results.length] },
  )

  // 阶段 B：主线。计分事件到了才起跑，整条线的节拍全写在这里。
  useGSAP(
    (ctx) => {
      const root = rootRef.current
      if (root === null || score === null) return
      const reduced = prefersReducedMotion()
      const dur = (value: number) => (reduced ? MIN_DUR : value)
      const gap = (value: number) => (reduced ? 0 : value)

      // 「正确 x / N」和「本轮领先」是计分到了这一帧才被 React 渲染出来的，
      // 这两句必须在本次提交绘制之前跑完（useGSAP 是布局 effect），否则它们会先闪一下再被藏起来。
      // 「保送」那枚章也在这里压住：它是 AI_SAFE_PASSED 到了才被渲染出来的，
      // 而那条事件和计分同一批，所以上面那段"新卡片"的初始化多半已经跑过、轮不到它。
      gsap.set(
        all(
          root,
          '.settle__squad-sep, .settle__squad-correct, .settle__lead-badge, .settle-card__safe',
        ),
        { autoAlpha: 0 },
      )

      // 读题时间从挂载算起，这里只补上"还差的那一段"：
      // 结果事件比读题时间早到（自动驾驶 2.5s < 4s）就等剩下的 1.5s，晚到就立刻开演。
      const elapsed = (performance.now() - mountedAtRef.current) / 1000
      const hold = reduced ? REDUCED_READ_HOLD : QUESTION_READ_HOLD
      const tl = gsap.timeline({ delay: Math.max(0, hold - elapsed) })
      mainRef.current = tl

      // 下面用绝对时刻（at）而不是相对位置串起来：逐卡打字那一段每张卡的长短都不一样，
      // 只有把结束时刻一路算出来，后面盖章、底栏那几拍才接得准。
      let at = 0

      // ① 标准答案擦入：面板从左往右揭开，大字同时从 0.8 弹到 1。
      const answerPanel = all(root, '.settle__answer-panel')
      if (answerPanel.length > 0) {
        tl.set(answerPanel, { autoAlpha: 1, clipPath: 'inset(0% 100% 0% 0%)' }, at)
        tl.to(
          answerPanel,
          {
            clipPath: 'inset(0% 0% 0% 0%)',
            duration: dur(ANSWER_REVEAL_DUR),
            ease: 'power2.inOut',
            overwrite: 'auto',
          },
          at,
        )
      }
      const answerMain = all(root, '.settle__answer-main')
      if (answerMain.length > 0) {
        tl.fromTo(
          answerMain,
          { scale: 0.8 },
          { scale: 1, duration: dur(ANSWER_REVEAL_DUR), ease: 'back.out(1.6)', overwrite: 'auto' },
          at,
        )
      }
      tl.call(() => setStep(1), undefined, at)
      at += dur(ANSWER_REVEAL_DUR)

      // ② 逐卡作答。DOM 里我方那块 squad 排在对方前面，所以按文档顺序取到的就是"我方在前"。
      const cards = all(root, '.settle-card')
      const answersStart = at
      let answersEnd = at
      cards.forEach((card, index) => {
        let cursor = answersStart + index * gap(CARD_STAGGER)
        const loader = all(card, '.settle-card__loader')
        if (loader.length > 0) {
          tl.to(loader, { autoAlpha: 0, duration: dur(LOADER_FADE), overwrite: 'auto' }, cursor)
        }
        cursor += dur(LOADER_FADE)
        cursor = typeInto(tl, card, '.settle-card__answer', TYPE_ANSWER_CHAR_SEC, null, cursor, reduced)
        cursor = typeInto(
          tl,
          card,
          '.settle-card__reasoning',
          TYPE_REASONING_CHAR_SEC,
          TYPE_REASONING_MAX,
          cursor,
          reduced,
        )
        answersEnd = Math.max(answersEnd, cursor)
      })
      at = answersEnd

      // ③ 判定章逐张盖下，卡片跟着抖一格；答错的那张在章落下的同时把正文压暗。
      tl.call(() => setStep(2), undefined, at)
      const stampStart = at
      cards.forEach((card, index) => {
        const stampAt = stampStart + index * gap(STAMP_STAGGER)
        const verdict = all(card, '.settle-card__verdict')
        if (verdict.length > 0) {
          tl.fromTo(
            verdict,
            { autoAlpha: 0, scale: 1.9, rotation: -14 },
            {
              autoAlpha: 1,
              scale: 1,
              rotation: VERDICT_TILT_DEG,
              duration: dur(STAMP_DUR),
              ease: 'back.out(2.5)',
              overwrite: 'auto',
            },
            stampAt,
          )
        }
        // 章砸下来那一下卡片横向弹一格。只有 2px，是"被盖了一下"的手感，不是位移。
        tl.fromTo(
          card,
          { x: 2 },
          { x: 0, duration: dur(0.18), ease: 'power2.out', overwrite: 'auto' },
          stampAt,
        )
        const body = all(card, '.settle-card__body')
        if (card.dataset.correct === 'false' && body.length > 0) {
          tl.to(body, { opacity: WRONG_BODY_OPACITY, duration: dur(0.25), overwrite: 'auto' }, stampAt)
        }
        // 被保送的那张：判定章盖完紧接着补上「保送留场」，顺序就是玩家读这张卡的顺序
        //（先看到答错，再看到它居然没下场）。
        const safe = all(card, '.settle-card__safe')
        if (safe.length > 0) {
          tl.fromTo(
            safe,
            { autoAlpha: 0, y: -6 },
            {
              autoAlpha: 1,
              y: 0,
              duration: dur(0.28),
              ease: 'back.out(2)',
              overwrite: 'auto',
            },
            stampAt + gap(STAMP_DUR),
          )
        }
      })
      at = stampStart + Math.max(0, cards.length - 1) * gap(STAMP_STAGGER) + dur(STAMP_DUR)
      // 逐张揭晓到此为止。教程等的就是这一拍——再早说话会压在还在打字的卡上。
      // 同退场那处，往外发信号一律隔开本层的 context（见 notifyOutside）。
      tl.call(() => notifyOutside(ctx, () => onStageRef.current?.('results-done')), undefined, at)

      // ④ 两侧标头的「正确 x / N」淡入，「本轮领先」徽章弹一下。
      const counts = all(root, '.settle__squad-sep, .settle__squad-correct')
      if (counts.length > 0) {
        tl.to(counts, { autoAlpha: 1, duration: dur(0.3), overwrite: 'auto' }, at)
      }
      const badges = all(root, '.settle__lead-badge')
      if (badges.length > 0) {
        tl.fromTo(
          badges,
          { autoAlpha: 0, scale: 0.7 },
          { autoAlpha: 1, scale: 1, duration: dur(0.3), ease: 'back.out(2)', overwrite: 'auto' },
          at + gap(0.1),
        )
      }
      at += dur(0.3) + gap(0.1)

      // ⑤ 底栏：先交代消耗，再落下结论，最后顶栏比分才跳。
      // 顺序是有讲究的——比分跳动是这一层的句号，它得排在"凭什么"讲完之后。
      const spend = all(root, '.settle__spend')
      if (spend.length > 0) {
        tl.to(spend, { autoAlpha: 1, duration: dur(0.3), overwrite: 'auto' }, at)
      }
      at += dur(0.3)
      const verdictLine = all(root, '.settle__verdict-line')
      if (verdictLine.length > 0) {
        tl.fromTo(
          verdictLine,
          { autoAlpha: 0, scale: 0.85 },
          { autoAlpha: 1, scale: 1, duration: dur(0.4), ease: 'back.out(1.7)', overwrite: 'auto' },
          at,
        )
      }
      at += dur(0.4)

      tl.call(() => setScoreSettled(true), undefined, at)
      const topscore = all(root, '.settle__topscore')
      // 减少动效时比分直接换数字，不做那下脉冲。
      if (topscore.length > 0 && !reduced) {
        tl.fromTo(
          topscore,
          { scale: 1 },
          {
            scale: 1.25,
            duration: 0.175,
            ease: 'power2.out',
            yoyo: true,
            repeat: 1,
            overwrite: 'auto',
          },
          at,
        )
        at += 0.35
      }
      tl.call(() => setStep(3), undefined, at)
      // 比分已经跳完（含那下脉冲），教程可以指着顶栏讲这一分为什么归谁了。
      tl.call(() => notifyOutside(ctx, () => onStageRef.current?.('score-shown')), undefined, at)

      // ⑥ 按钮淡入，落地那一刻才解锁。
      const slot = all(root, '.settle__confirm-slot')
      if (slot.length > 0) {
        tl.fromTo(
          slot,
          { autoAlpha: 0, y: 12 },
          { autoAlpha: 1, y: 0, duration: dur(0.35), ease: 'power2.out', overwrite: 'auto' },
          at,
        )
      }
      at += dur(0.35)
      tl.call(() => setReady(true), undefined, at)
    },
    { scope: rootRef, dependencies: [score] },
  )

  /**
   * 阶段 C：退场。阶段离开 quiz / settle 就说明这一轮翻篇了（双方都确认，进下一轮或终局）。
   *
   * 回调存在 ref 里，effect 只跟着 phase 跑：调用方传的是每次渲染都新建的箭头函数，
   * 进依赖数组会让这段每渲染一次就重跑一次。
   *
   * 中断（对方掉线）走的是另一条路：MatchStage 直接把 roundSettle 置空，整层被 React 卸掉，
   * useGSAP 的 context 自己 revert，不经过这里，所以退场动画播不完也没关系。
   */
  const onExitedRef = useRef(onExited)
  onExitedRef.current = onExited
  /**
   * 同 onExitedRef：主线时间线是在 useGSAP 里一次性排好的，闭包会把当时那个回调锁住。
   * 存进 ref 每次渲染刷新，时间线跑到那一拍时调到的才是现在这个。
   */
  const onStageRef = useRef(onStage)
  onStageRef.current = onStage
  const exitedRef = useRef(false)
  useEffect(() => {
    if (phase === 'quiz' || phase === 'settle') return
    if (exitedRef.current) return
    exitedRef.current = true
    const play = playExitRef.current
    // 入场那段还没跑（拿不到 root）就没有退场可播，直接收层，别把整层卡在屏幕上。
    if (play === null) {
      onExitedRef.current()
      return
    }
    play()
  }, [phase])

  /** 步骤条：演过的打勾，正在演的实心，还没到的压淡。 */
  const stepState = (index: number): 'done' | 'current' | 'todo' => {
    if (index < step) return 'done'
    return index === step ? 'current' : 'todo'
  }

  // 顶栏比分：主线点名之前一直显示计分前的总分，点名那一刻连同脉冲一起跳到新总分。
  const shownScore = score !== null && scoreSettled ? score.totals : settle.scoresBefore

  /**
   * 本轮领先的挂在哪一侧。gains 只可能是 0 或 1，双方各 1 就是打平——
   * 那种情况两边都挂，文案换成「平分秋色」。
   */
  const lead = score === null ? null : leadOf(score.gains)

  // 按钮三态：主线放完才可点 → 已确认（等对方）→ 阶段离开就整层退场（上面那条 effect）。
  const confirmed = myConfirmed || clicked
  const canConfirm = ready && phase === 'settle' && !confirmed
  const lastRound = settle.round >= totalRounds
  const confirmLabel = confirmed ? '等待对方确认' : lastRound ? '查看终局结算' : '进入下一轮'

  return (
    <div className="settle" ref={rootRef}>
      <header className="settle__topbar">
        <p className="settle__title">出牌吧, AI</p>

        <ol className="settle__steps">
          {STEP_LABELS.map((label, index) => (
            <li key={label} className="settle__step" data-state={stepState(index)}>
              {/* 圆圈里的勾、实心圆点、灰圈三种样子全由 CSS 按 data-state 画，这里只占个位。 */}
              <span className="settle__step-mark" aria-hidden="true" />
              <span className="settle__step-label">{label}</span>
            </li>
          ))}
        </ol>

        <div className="settle__meta">
          <span className="settle__round-pill">第 {settle.round} 轮</span>
          <span className="settle__topscore">
            <span className="settle__topscore-mine">{shownScore.mine}</span>
            <span className="settle__topscore-colon" aria-hidden="true">
              :
            </span>
            <span className="settle__topscore-foe">{shownScore.theirs}</span>
          </span>
        </div>
      </header>

      <div className="settle__question-row">
        <section className="settle__question-panel">
          <p className="settle__category">
            <CompassMark />
            {QUESTION_CATEGORY_LABELS[question.category]}
          </p>
          <p className="settle__question-text">{question.text}</p>
        </section>

        {/* 纯装饰的纵向分隔：一条两头淡出的细线，中间压一颗菱形（同侧栏的 .battle__player-divider）。 */}
        <div className="settle__divider" aria-hidden="true">
          <span className="settle__divider-line" />
          <span className="settle__divider-gem" />
        </div>

        <section className="settle__answer-panel">
          <span className="settle__answer-label">标准答案</span>
          <p className="settle__answer-main">{question.answer}</p>
          <p className="settle__answer-explain">{question.explanation}</p>
        </section>
      </div>

      {/*
        结果卡的列数由张数现算，写成 CSS 变量往下传（--settle-cols 是可继承的自定义属性，
        两块面板各自的 .settle__cards 都取得到）。

        为什么不写死三列：这一层的高度是死的（舞台 941px），一侧的卡分到的那一格只有约 170px，
        刚好一张卡的高度。列数固定的话第四张就换到第二行，而第二行根本没地方放——
        实测 5v4 时两块面板互相压 96px，最后一行整个掉出舞台被裁掉。
        所以张数多了就加列、不换行，宁可每张窄一点。

        两侧取同一个列数（而不是各按各的张数算），是为了保住"两侧的卡永远一样宽"：
        列宽不一样的话，横着比"谁答对得多"就得先在心里换算一次。少的那侧空位就空着。
      */}
      <div className="settle__squads" style={{ '--settle-cols': cols } as CSSProperties}>
        <SettleSquad
          side="mine"
          results={mine}
          scored={score !== null}
          lead={lead === null ? null : lead.mine}
        />
        <SettleSquad
          side="foe"
          results={theirs}
          scored={score !== null}
          lead={lead === null ? null : lead.theirs}
        />
      </div>

      <footer className="settle__bottom">
        <p className="settle__spend">
          本轮消耗:{' '}
          <span className="settle__spend-mine">我方 {score === null ? '—' : score.spent.mine}</span>
          <span className="settle__spend-sep" aria-hidden="true">
            ·
          </span>
          <span className="settle__spend-foe">对方 {score === null ? '—' : score.spent.theirs}</span>
        </p>

        <p className="settle__verdict-line">{score === null ? null : settleResultTextOf(score)}</p>

        <div className="settle__confirm-slot">
          {/* 对方先看完先点，这一句让本端知道"就差我了"。我方点过之后按钮自己会说话，不用再重复。 */}
          {foeConfirmed && !confirmed ? (
            <span className="settle__confirm-note">对方已确认</span>
          ) : null}
          {/* 和侧栏「结束出牌」同一块墨蓝八角匾额（PlaqueButton），只是这里放大一档，见 .settle__confirm。 */}
          <PlaqueButton
            className="settle__confirm"
            disabled={!canConfirm}
            onClick={() => {
              setClicked(true)
              onConfirm()
            }}
          >
            {confirmLabel}
          </PlaqueButton>
        </div>
      </footer>
    </div>
  )
}

/**
 * 一侧的结果面板：一条竖页签 + 标头 + 一行结果卡。
 *
 * scored 为 false（还没计分）时正确数和 lead 都不显示——
 * 在结果出来之前把「正确 0 / 3」摆出来，看着像所有 AI 都答错了。
 * 计分之后它们才被渲染出来，但仍然是隐着的：由主线在盖完章那一拍点名淡入。
 *
 * 正确数是从这一侧的结果卡现数的，不看 SettleScore：那边的 correct 是团队口径的布尔值
 *（这一方有没有答对），而标头这行要的是"几个里对了几个"的战况，两者不是一回事。
 */
function SettleSquad({
  side,
  results,
  scored,
  lead,
}: {
  side: 'mine' | 'foe'
  results: SettleAiResult[]
  scored: boolean
  lead: string | null
}) {
  const label = side === 'mine' ? '我方' : '对方'
  const correct = scored ? results.filter((item) => item.correct).length : null
  return (
    <section className={`settle__squad settle__squad--${side}`}>
      <span className="settle__squad-tab" aria-hidden="true" />
      <div className="settle__squad-head">
        <span className="settle__squad-title">
          {label} · {results.length} 个 AI
        </span>
        {correct === null ? null : (
          <>
            <span className="settle__squad-sep" aria-hidden="true">
              ◇
            </span>
            <span className="settle__squad-correct">
              正确 {correct} / {results.length}
            </span>
          </>
        )}
        {lead === null ? null : <span className="settle__lead-badge">{lead}</span>}
      </div>
      <div className="settle__cards">
        {results.map((result) => (
          <SettleCard key={result.instanceId} result={result} />
        ))}
      </div>
    </section>
  )
}

/**
 * 一张结果卡：迷你卡头像 + 卡名 + 大字答案 + 两行推理 + 右上角的判定章。
 *
 * 头像照战场小卡的三层分工来（见 MatchStage 的 BoardTile）：
 * __avatar 定尺寸并留透视，__avatar-tilt 承担 hover 的倾斜和放大（也是裁剪层），
 * __avatar-inner 把布局尺寸仍是 150×225 的整张卡面缩到头像大小。
 *
 * 卡面数据按 cardId 现拼，但 id 换成 instanceId：同一张卡两边各上一个的话，
 * 拿 cardId 当 React key / Flip 键就会撞车。
 */
function SettleCard({ result }: { result: SettleAiResult }) {
  const card = { ...toHandCardData(getCard(result.cardId)), id: result.instanceId }
  return (
    <article className="settle-card" data-correct={result.correct ? 'true' : 'false'}>
      <div className="settle-card__avatar">
        <div className="settle-card__avatar-tilt">
          <div className="settle-card__avatar-inner">
            <HandCardFace card={card} />
          </div>
        </div>
      </div>

      <div className="settle-card__body">
        <p className="settle-card__name">{card.name}</p>
        {/*
          答案和推理**故意渲染成空元素**，全文只挂在 data-text 上。
          打字机（TextPlugin）写的是 innerHTML，React 要是也管着这两个节点的文本，
          任何一次重渲染都会把打了一半的字冲成全文，看着就是"先闪出全文再重打一遍"。
          交给 data-text 之后属性归 React、内容归 GSAP，两边不再碰同一样东西。
        */}
        <p className="settle-card__answer" data-text={result.answer} />
        <p className="settle-card__reasoning" data-text={result.reasoning} />
        {/*
          「作答中」的占位：三个依次弹跳的小圆点。它盖在答案和推理上面（绝对定位，不占位），
          卡片一出现就亮着，等这张卡轮到打字时由主线淡掉。

          弹跳本身是 CSS animation（见 styles.css 的 .settle-card__loader-dot），
          和主线的分工是：CSS 只动圆点自己的 transform，GSAP 只改外层容器的 autoAlpha，
          两边碰的不是同一个元素，不会互相覆盖。外层这个 .settle-card__loader 节点
          是主线的选择器，别去掉也别改名。
        */}
        <div className="settle-card__loader" aria-hidden="true">
          <span className="settle-card__loader-dot" />
          <span className="settle-card__loader-dot" />
          <span className="settle-card__loader-dot" />
        </div>
      </div>

      <span className="settle-card__verdict">{result.correct ? '✓ 正确' : '✗ 错误'}</span>
      {/* 「保送」贴在判定章下面：判定照旧是错的，这枚只补一句"但它没被罚下"。
          答对的卡永远不会有它——保送只在答错那一步才起作用。 */}
      {result.safePassed === true ? <span className="settle-card__safe">保送留场</span> : null}
    </article>
  )
}

/**
 * 从本层的 gsap 动画回调里往外通知（调 props 传进来的回调）时，必须裹这一层。
 *
 * gsap 有个"context 收养"的坑，两条机制凑在一起才发作：
 * - 动画回调（onComplete / onStart / 时间线的 .call 等）执行期间，gsap 会把全局的
 *   "当前 context" 设成这条动画所属的 context（gsap-core 的 `_callback`）。
 * - useGSAP 的 `contextSafe` 包出来的函数一进来就检查全局有没有别的 context 活着，
 *   有的话就把**自己这个 context 挂成对方的子节点**（gsap-core 的 `Context.add`）。
 *
 * 于是：本层的退场动画在 onComplete 里调 MatchStage 的 onExited，而 onExited 里随手调了
 * 一个 MatchStage 的 contextSafe 函数（pumpBanner），MatchStage 那**整个** context 就被
 * 挂到了本层的 context 底下；同一个 onExited 又把本层卸掉，useGSAP 清理时 revert 会级联
 * revert 子 context，把 MatchStage 里正在飞的回合横幅、发牌兜底之类全部连坐杀掉。
 * 表现是横幅淡入到一半被 revert、内联样式还原成不透明，就那么钉在全屏上再也不退场。
 *
 * `ctx.ignore` 就是给这种边界准备的：它在执行期间把全局 context 清空，跑完再恢复，
 * 外部代码于是落不到本层名下。凡是从本层动画回调里发出去的外部回调都要走这里。
 *
 * 注意这不是教程专属的问题：正式对局同样会踩（onExited 那条路两边都走）。
 */
function notifyOutside(ctx: gsap.Context, notify: () => void): void {
  ctx.ignore(() => notify())
}

/**
 * 在 root 里按选择器取一批元素。
 *
 * GSAP 的补间目标是空数组时会往控制台丢一条"target not found"，
 * 而这一层里好几处元件是条件渲染的（计分之前根本不存在），所以取完统一判长度再用。
 */
function all(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector))
}

/**
 * 把一个节点上 data-text 里的全文打进去，返回打完的时刻。
 *
 * 中文按字符逐个出（TextPlugin 默认就是按字符切，不能传 delimiter: ' '，
 * 那是给英文按词出用的，中文一整句会被当成一个"词"、一下子全冒出来）。
 * maxDur 传 null 表示不封顶。
 */
function typeInto(
  tl: gsap.core.Timeline,
  card: HTMLElement,
  selector: string,
  charSec: number,
  maxDur: number | null,
  at: number,
  reduced: boolean,
): number {
  const el = card.querySelector<HTMLElement>(selector)
  if (el === null) return at
  const full = el.dataset.text ?? ''
  if (full === '') {
    tl.set(el, { autoAlpha: 1 }, at)
    return at
  }
  if (reduced) {
    tl.set(el, { autoAlpha: 1, text: full }, at)
    return at + MIN_DUR
  }
  const duration = maxDur === null ? full.length * charSec : Math.min(full.length * charSec, maxDur)
  tl.set(el, { autoAlpha: 1 }, at)
  tl.to(el, { text: { value: full }, duration, ease: 'none', overwrite: 'auto' }, at)
  return at + duration
}

/** 题目类别前面那枚小罗盘。画法和卡背上那枚同源（见 ui/paper/PaperCardBack.tsx）。 */
function CompassMark() {
  return (
    <svg
      className="settle__category-mark"
      viewBox="0 0 120 120"
      style={{ filter: 'url(#ai-duel-rough-compass)' }}
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <circle cx="60" cy="60" r="47" strokeWidth="3" />
        <circle cx="60" cy="60" r="38" strokeWidth="2" opacity="0.7" />
        <path d="M60 4 L60 18 M60 102 L60 116 M4 60 L18 60 M102 60 L116 60" strokeWidth="3" />
        <path
          d="M60 22 C63 51 69 57 98 60 C69 63 63 69 60 98 C57 69 51 63 22 60 C51 57 57 51 60 22 Z"
          strokeWidth="2"
          fill="currentColor"
          fillOpacity="0.18"
        />
      </g>
    </svg>
  )
}

/**
 * 本轮领先的徽章挂在哪一侧，null 表示这一侧不挂。
 *
 * gains 是引擎算好的结果（0 或 1），这里只负责翻译成一句话：
 * 一方 1 一方 0 就是那一方领先，双方各 1 是打平——两边都挂，但文案换掉。
 */
function leadOf(gains: SettleSides): { mine: string | null; theirs: string | null } {
  if (gains.mine === 1 && gains.theirs === 1) {
    return { mine: '平分秋色', theirs: '平分秋色' }
  }
  if (gains.mine === 1 && gains.theirs === 0) return { mine: '本轮领先', theirs: null }
  if (gains.theirs === 1 && gains.mine === 0) return { mine: null, theirs: '本轮领先' }
  return { mine: null, theirs: null }
}

/**
 * 底栏正中那句结果文案：把"凭什么这一分给了谁"讲清楚。
 *
 * 三档判定和引擎里的计分一一对应（见 core 的 RoundVerdict）：
 * 只有一方答对就那方拿分；双方同对或同错就比本轮消耗，少的一方拿分；消耗也一样就各拿 1 分。
 * 只有我方赢的那两句带「+1 分」——对方赢的时候写「+1 分」，玩家会以为加的是自己的分。
 *
 * 比 Token 那两档要把双方的消耗数字摆出来：玩家得看见数字，才明白"省 Token"是真能赢分的。
 * 返回的是节点不是字符串：消耗那两个数要分别染成我方绿和对方红。
 */
export function settleResultTextOf(score: SettleScore): ReactNode {
  const { correct, spent, verdict } = score

  if (verdict === 'sole-correct') {
    return correct.mine ? '只有我方答对 · 赢得本轮 · +1 分' : '只有对方答对 · 赢得本轮'
  }

  // 剩下两档双方同对或同错，先把"同对还是同错"说清楚，再摆消耗。
  const both = correct.mine ? '双方都答对' : '双方都答错'
  const spendPair = (
    <>
      <span className="settle__verdict-num--mine">{spent.mine}</span>
      <span className="settle__verdict-colon"> : </span>
      <span className="settle__verdict-num--foe">{spent.theirs}</span>
    </>
  )

  if (verdict === 'fewer-tokens') {
    return (
      <>
        {both} · 消耗 {spendPair}
        {spent.mine < spent.theirs ? ' · 我方更省 · +1 分' : ' · 对方更省'}
      </>
    )
  }

  return (
    <>
      {both} · 消耗同为 {spendPair} · 势均力敌 · 双方各 +1 分
    </>
  )
}
