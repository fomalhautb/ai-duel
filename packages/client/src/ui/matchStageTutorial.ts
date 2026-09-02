/**
 * MatchStage 对教程开出来的那几个口子。
 *
 * 单独一个文件是为了让教程那边（步骤表、控制器、测试）只 import 类型，
 * 不用把整个 MatchStage.tsx（连着 GSAP、React 组件树）拖进来。
 */

/**
 * 舞台演出信号：对局界面里那几段"演完了"的时刻。
 *
 * 只收步骤表真正要等的那几个——教程的提示必须让位给全屏过场（z-index 1100），
 * 所以每一句提示都得挂在某段演出的收尾上，否则会被遮罩糊住。
 * 加新信号之前先问一句"哪一步在等它"，没有答案就别加。
 */
export type MatchStageCue =
  /** 发牌动画全部落地（开局那 5 张，或者每轮结算后补的 2 张）。 */
  | 'deal-done'
  /** 中央横幅队列播空（「第 N 轮」「轮到你出牌」这一串）。 */
  | 'round-banner-done'
  /** 答题揭晓层立起来了，题面已经在屏幕上。 */
  | 'quiz-open'
  /** 揭晓层里的答题结果逐条亮完。 */
  | 'quiz-rows-done'
  /** 揭晓层里的本轮比分亮出来了。 */
  | 'quiz-score-shown'
  /** 揭晓层整层退场完毕，战场重新露出来。 */
  | 'quiz-closed'
  /** 我方技能牌飞到目标格、命中特效播完。 */
  | 'skill-hit'

/**
 * 教程挂在 MatchStage 上的那一组限制与回调。正式对局不传这个 prop，整套逻辑就不存在。
 */
export interface MatchStageTutorial {
  /**
   * 逐张手牌的额外锁：**手牌实例 id** → 点它时弹的那句提示。
   *
   * 挂进 HandFan 的 blocked 判据（和「Token 不够」同一套压暗 + 摇头），
   * 所以被锁的牌看得出来是关着的，点一下也有话说，不会点了没反应。
   */
  blockedCards?: ReadonlyMap<string, string> | null
  /** 「结束出牌」这一步还不许点（教程要求玩家先完成别的操作）。 */
  endPlayBlocked?: boolean
  /** 舞台演出信号，见 MatchStageCue。 */
  onStageCue?: (cue: MatchStageCue) => void
}
