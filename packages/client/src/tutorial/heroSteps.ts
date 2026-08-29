/**
 * 选英雄教学的步骤表（规格 §13 的 Step 21）。
 *
 * 只有两步，所以没做成 deckSteps.ts 那样的通用表：
 * 「点她」和「确认」各一句话，推进条件就是技能详情开没开。
 */

import type { HeroId } from '@ai-duel/core'

/**
 * 教学指定的英雄。
 *
 * 只能是格蕾丝·霍珀：七位里只有她的技能真接进了引擎（其余六位的 skillText 写着「待实装」），
 * 教程说"英雄自带独特技能"，选一位技能不存在的人就成了空话。
 * 教学对战里玩家用的也是她（见 content.ts），这一步等于把刚才那局的英雄正式定下来。
 */
export const TUTORIAL_HERO: HeroId = 'grace-hopper'

/**
 * 两步：
 * - `HERO_PICK`：高亮霍珀那张卡，等玩家点开她的技能详情；
 * - `HERO_CONFIRM`：详情开着，高亮「确认英雄」，等玩家按下去。
 *
 * 玩家在详情里点「返回」或按 ESC 会退回 `HERO_PICK`，不会卡死（详情开关由界面回调驱动）。
 */
export type HeroStepId = 'HERO_PICK' | 'HERO_CONFIRM'

export interface HeroStep {
  id: HeroStepId
  instruction: string
  /** 要挖洞高亮的元素（CSS 选择器，对应界面上的 data-tutorial-anchor）。 */
  selector: string
  /**
   * 压暗无关区域。
   *
   * 确认那一步是 false：技能详情自己已经铺了一层压暗 + 模糊的遮罩，
   * 再叠一层引导层的压暗会黑得读不清卡面，那一步只留一圈描边和一句提示。
   */
  dim: boolean
}

export const HERO_STEPS: Record<HeroStepId, HeroStep> = {
  HERO_PICK: {
    id: 'HERO_PICK',
    instruction: '每局比赛还要选一位英雄，英雄自带独特技能。',
    selector: '[data-tutorial-anchor="heroCard"]',
    dim: true,
  },
  HERO_CONFIRM: {
    id: 'HERO_CONFIRM',
    instruction: '就选她。',
    selector: '[data-tutorial-anchor="heroConfirm"]',
    dim: false,
  },
}

/** 点到那六位「待实装」英雄时说的话。锁必须有话说，否则玩家只会以为卡片坏了。 */
export const HERO_BLOCK_TIP = '教学阶段：先选高亮的这位英雄，其余几位的技能还没实装'
