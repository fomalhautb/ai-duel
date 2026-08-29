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
 * 必须是技能真接进了引擎的那几位（七位里已实装 4 位，其余标着 comingSoon）：
 * 教程说"英雄自带独特技能"，引导玩家去选一位技能不存在的人就成了空话。
 * 挑格蕾丝·霍珀是因为教学对战里玩家用的也是她（见 content.ts），
 * 这一步等于把刚才那局的英雄正式定下来；而且她的 Debug 是被动，
 * 不像陈丹琦/珀金斯那样要玩家再学一套发动流程，这一步只教"选英雄"这件事。
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

/**
 * 点到其余六位时说的话。锁必须有话说，否则玩家只会以为卡片坏了。
 *
 * 只说"教学阶段"这一条，不提技能实装：这六位里三位是真没实装（comingSoon，卡面上有封条），
 * 另三位技能好好的、只是教程这一步暂时不放行，一句话没法同时说准两种情况。
 */
export const HERO_BLOCK_TIP = '教学阶段：先选高亮的这位英雄，其余几位等教程走完再挑'
