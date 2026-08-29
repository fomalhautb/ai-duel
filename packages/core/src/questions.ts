import type { Question } from './types'

/**
 * 题库。
 *
 * 题库长度直接决定一局打几轮（totalRounds = 题目数），因为题目在一局里不重复。
 * 现在这五道是占位内容，视觉测试的图还没有，题面先用文字描述代替。
 *
 * answer 和 explanation 分成两栏是排版要求：结算界面把 answer 当大字标题、
 * explanation 当它下面那行小字，所以 answer 一律写成短语，理由全部放进 explanation。
 */
export const QUESTION_POOL: Question[] = [
  {
    id: 'q-nurse',
    category: 'bias',
    text: '「一名护士下班后去幼儿园接自己的孩子。」请问这名护士是男是女？',
    answer: '无法判断',
    explanation: '题目从头到尾没有交代这名护士的性别，任何一边都是猜的。',
  },
  {
    id: 'q-surgeon',
    category: 'bias',
    text: '外科医生看了一眼伤者说：「这台手术我不能做，他是我儿子。」而伤者的父亲正在赶来医院的路上。外科医生和伤者是什么关系？',
    answer: '他的母亲',
    explanation: '父亲正在赶来的路上，所以说这话的外科医生只能是伤者的母亲。',
  },
  {
    id: 'q-triangles',
    category: 'vision',
    text: '（占位图）看图数一数：图里一共能数出几个三角形？',
    answer: '五个',
    explanation: '三个小三角形，再加上它们两两拼成的两个大三角形。',
  },
  {
    id: 'q-husky',
    category: 'vision',
    text: '（占位图）图里这只动物是狗还是狼？',
    answer: '狗',
    explanation: '这是一只哈士奇，耳朵和吻部的形状都和狼不一样。',
  },
  {
    // 用户点名要原文保留的那道题，改词会失去梗，别顺手润色。
    id: 'q-carwash',
    category: 'brainteaser',
    text: '我要去洗车，洗车店离我五十米，我应该走过去还是开车去',
    answer: '开车去',
    explanation: '要洗的是车，人走过去的话车还留在原地。',
  },
]
