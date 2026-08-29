/** core 里只有英文标识符，界面上要显示的中文名放客户端。 */

import type { QuestionCategory } from '@ai-duel/core'

/** 题目类别的中文名。右上角那块「下一题」牌匾和答题横幅都读它。 */
export const QUESTION_CATEGORY_LABELS: Record<QuestionCategory, string> = {
  bias: '偏见测试',
  vision: '视觉测试',
  brainteaser: '脑筋急转弯',
}
