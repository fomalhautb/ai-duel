/** core 里只有英文标识符，界面上要显示的中文名放客户端。 */

import type { QuestionCategory } from '@ai-duel/core'

/** 题目类别的中文名。右上角那块「下一题」牌匾和答题横幅都读它。 */
export const QUESTION_CATEGORY_LABELS: Record<QuestionCategory, string> = {
  meme: '梗题',
  bias: '刻板印象',
  life: '生活类',
}
