/**
 * 预生成答题结果对照页（/generation）。
 *
 * 对战里 AI 的回答是提前用 OpenRouter 跑好存成 JSON 的（见 scripts/pregen-answers.mjs）。
 * 这一页把那批结果摊成「模型 × 题目」的表，用来回答两个问题：哪张技能卡真的把模型带偏了，
 * 以及哪道题对哪个模型太简单——这两件事都得把答案原文摆在一起看才判断得出来。
 *
 * 数据来自 generationResults.json，由 scripts/build-generation-data.mjs 合并生成，
 * 手改没有意义（下次跑脚本就被覆盖）。对错来自 scripts/judge-answers.mjs 的 LLM 自动判卷
 * 结果（verdicts-run4.json），不是这一页算的；判卷看不出结论的一律算没答对，合并脚本会带上原因标签。
 *
 * 和 /dev 下那几页一样是纯开发页：只求信息全、找得快，不做美化。
 */

import { useState } from 'react'
import { useLocation } from 'wouter'
import rawData from './generationResults.json'
import './generation.css'

interface QuestionInfo {
  id: string
  text: string
  /** 人类认为的正确答案，用来对照那几个正确/失败徽章判得有没有道理。 */
  expected: string
}

interface ModelInfo {
  id: string
  name: string
}

/** 实际发给模型的两段 prompt，按题重建，所以每道题都有自己的一份。 */
interface PromptPair {
  system: string
  user: string
}

/** 没答对的原因，只在没答对时才有；答对的格子不带这个字段。 */
type Flaw = 'refused' | 'verbose' | 'offtopic'

interface Cell {
  answer: string
  /**
   * 只有答对 / 没答对两种，没有「待判定」：判卷模型看不出结论的一律算没答对
   *（见 scripts/build-generation-data.mjs），原因记在 flaw 里。
   */
  correct: boolean
  /**
   * 没答对的原因，用来在表里区分三种翻车方式：
   * - refused「拒答」：被内容审核拦下，一个字都没输出，所以这种格子的 answer 是空的。
   * - verbose「啰嗦」：铺垫太长，30 token 用完还没说到结论。
   * - offtopic「跑题」：话说完了但答非所问，典型是被复读机技能带偏只答「香蕉」。
   * 判卷判定明确答错（结论说了，但说错了）的格子不带 flaw，显示成普通的「失败」。
   */
  flaw?: Flaw
}

interface SkillInfo {
  id: string
  name: string
  /** 这批答案是哪个 prompt 变体跑出来的，排查对不对得上号时要用。 */
  variant: string
  prompts: Record<string, PromptPair>
  cells: Record<string, Record<string, Cell>>
}

interface GenerationData {
  generatedAt: string
  questions: QuestionInfo[]
  models: ModelInfo[]
  skills: SkillInfo[]
}

// JSON 模块的推断类型是照当前文件内容长出来的（比如某个字段现在恰好全是 false 就被推成 boolean），
// 换一批数据推断结果就会变。这里一次性钉死成上面的接口，页面代码只依赖这份声明。
const DATA = rawData as GenerationData

/** 题干太长塞不进列头，只留开头这么多字。 */
const LABEL_CHARS = 10

export function GenerationScreen() {
  const [, navigate] = useLocation()
  // 默认选第一档（无技能）：它是其余两档的对照基准，先看它最顺。
  const [skillId, setSkillId] = useState(DATA.skills[0]?.id ?? '')
  const skill = DATA.skills.find((s) => s.id === skillId)

  return (
    <div className="generation">
      <header className="generation__header">
        <h1 className="generation__title">预生成答题结果</h1>
        <p className="generation__lead">
          OpenRouter 离线跑出来的答案，共 {DATA.questions.length} 题 × {DATA.models.length} 个模型 ×{' '}
          {DATA.skills.length} 档技能。切换技能看同一批题在不同 prompt 下的表现，鼠标移到列头看这道题
          实际发出去的完整 prompt。
        </p>
        <div className="generation__controls">
          <label className="generation__picker">
            技能
            <select value={skillId} onChange={(event) => setSkillId(event.target.value)}>
              {DATA.skills.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {skill ? <span className="generation__variant">变体 id：{skill.variant}</span> : null}
          <span className="generation__variant">生成于 {DATA.generatedAt}</span>
          <button type="button" className="generation__back" onClick={() => navigate('/dev')}>
            回开发页
          </button>
        </div>
      </header>

      {skill ? <ResultTable skill={skill} /> : <p className="generation__empty">没有这一档技能的数据。</p>}
    </div>
  )
}

/** 选中技能的整张对照表：行是模型，列是题目。 */
function ResultTable({ skill }: { skill: SkillInfo }) {
  return (
    <table className="generation__table">
      <thead>
        <tr>
          <th className="generation__corner" scope="col">
            AI 模型
          </th>
          {DATA.questions.map((question, index) => (
            <QuestionHead key={question.id} skill={skill} question={question} index={index} />
          ))}
        </tr>
      </thead>
      <tbody>
        {DATA.models.map((model) => (
          <tr key={model.id}>
            <th className="generation__model" scope="row">
              <span className="generation__model-name">{model.name}</span>
              {/* 分母是题目总数：没生成的格子不算对，所以不从分母里扣。 */}
              <span className="generation__score">
                {countCorrect(DATA.questions.map((q) => cellOf(skill, q.id, model.id)))} / {DATA.questions.length}
              </span>
            </th>
            {DATA.questions.map((question) => (
              <AnswerCell key={question.id} cell={cellOf(skill, question.id, model.id)} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * 一个题目列头，外加 hover 时弹出的完整 prompt。
 *
 * 悬浮层挂在 th 里面而不是单独浮在页面上：鼠标从列头移进悬浮层时，:hover 仍然落在同一个 th 上，
 * 层不会先消失——prompt 两段加起来不短，必须让鼠标能进去滚。
 * 同理不能用 title 属性：原生提示既不能滚也不保留换行。
 */
function QuestionHead({ skill, question, index }: { skill: SkillInfo; question: QuestionInfo; index: number }) {
  const prompt = skill.prompts[question.id]
  const correct = countCorrect(DATA.models.map((model) => cellOf(skill, question.id, model.id)))

  return (
    // tabIndex 让键盘也能停在列头上：CSS 里 :focus-within 和 :hover 一起触发悬浮层。
    <th className="generation__question" scope="col" tabIndex={0}>
      <span className="generation__question-label">
        第 {index + 1} 题 · {question.text.slice(0, LABEL_CHARS)}…
      </span>
      <span className="generation__question-expected">参考答案：{question.expected}</span>
      <span className="generation__score">
        {correct} / {DATA.models.length}
      </span>

      <div className="generation__prompt" role="note">
        {prompt ? (
          <>
            <p className="generation__prompt-role">system</p>
            <pre className="generation__prompt-text">{prompt.system}</pre>
            <p className="generation__prompt-role">user</p>
            <pre className="generation__prompt-text">{prompt.user}</pre>
          </>
        ) : (
          <p className="generation__prompt-role">这道题没有记录 prompt</p>
        )}
      </div>
    </th>
  )
}

/** 徽章文案，按没答对的原因分。答对和「说了结论但说错了」不在这张表里。 */
const FLAW_LABEL: Record<Flaw, string> = {
  refused: '拒答',
  verbose: '啰嗦',
  offtopic: '跑题',
}

/** 一个格子：答案配一个判定徽章；未生成、以及三种没答对的原因各自整格标色。 */
function AnswerCell({ cell }: { cell: Cell | undefined }) {
  if (!cell) {
    return (
      <td className="generation__cell generation__cell--missing">
        <span className="generation__badge generation__badge--missing">未生成</span>
      </td>
    )
  }

  // 拒答单独走一支：这种格子没有 answer，得自己写一句话说明，不然整格只剩一个徽章。
  if (cell.flaw === 'refused') {
    return (
      <td className="generation__cell generation__cell--refused">
        <span className="generation__badge generation__badge--refused">拒答</span>
        <p className="generation__answer">
          <span className="generation__answer-label">结果：</span>
          模型被内容审核拦下，没有输出，计为答错。
        </p>
      </td>
    )
  }

  const tone = cell.flaw ?? (cell.correct ? 'ok' : 'bad')
  const label = cell.flaw ? FLAW_LABEL[cell.flaw] : cell.correct ? '正确' : '失败'

  return (
    <td className={`generation__cell${cell.flaw ? ` generation__cell--${cell.flaw}` : ''}`}>
      <span className={`generation__badge generation__badge--${tone}`}>{label}</span>
      {/* 答案最长有十几行，截到 3 行；title 留一份全文，不展开也读得到。 */}
      <p className="generation__answer" title={cell.answer}>
        <span className="generation__answer-label">结果：</span>
        {cell.answer}
      </p>
    </td>
  )
}

/** 取一格数据；这个组合没跑过（或跑失败被合并脚本省掉了，拒答除外）就是 undefined。 */
function cellOf(skill: SkillInfo, questionId: string, modelId: string): Cell | undefined {
  return skill.cells[questionId]?.[modelId]
}

/** 只数答对的格子：三种没答对的和未生成都不算。 */
function countCorrect(cells: (Cell | undefined)[]): number {
  return cells.filter((cell) => cell?.correct === true).length
}
