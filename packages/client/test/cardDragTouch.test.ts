import { describe, expect, it } from 'vitest'
import {
  TOUCH_AXIS_RATIO,
  TOUCH_DRAG_THRESHOLD,
  TOUCH_HOLD_TOLERANCE,
  TOUCH_SCROLL_SLOP,
  touchGestureOf,
} from '../src/ui/useCardDrag'

/*
 * 卡组页那两块滚动区（卡池网格、牌组格子区）里，触屏起拖走的是方向锁：
 * 竖滑让给滚动、横滑才抓牌。这里验的就是那几条门限，
 * 手指真正划出来的轨迹在 DOM 里怎么跑不在这个测试的范围内。
 */
describe('触屏滚动区里的起拖判定', () => {
  it('竖着滑一律让给滚动', () => {
    expect(touchGestureOf(0, TOUCH_SCROLL_SLOP)).toBe('scroll')
    expect(touchGestureOf(0, -40)).toBe('scroll')
    // 带一点横向分量的竖滑也是滚动：手指划的竖线本来就不可能是垂直的。
    expect(touchGestureOf(6, 40)).toBe('scroll')
  })

  it('正好 45° 算滚动，不算拖拽', () => {
    expect(touchGestureOf(40, 40)).toBe('scroll')
    expect(touchGestureOf(-40, 40)).toBe('scroll')
  })

  it('横滑够长又够横才起拖', () => {
    expect(touchGestureOf(TOUCH_DRAG_THRESHOLD, 0)).toBe('drag')
    expect(touchGestureOf(-60, 4)).toBe('drag')
    // 长度够了但方向不够横（没压过 TOUCH_AXIS_RATIO 倍）不算。
    expect(touchGestureOf(40, 40 / TOUCH_AXIS_RATIO + 1)).not.toBe('drag')
  })

  it('还看不出方向的一点点位移是等待，不是起拖', () => {
    // 鼠标那 4px 阈值在触屏上会被按下时的接触点漂移直接冲掉，所以这一段什么都不做。
    expect(touchGestureOf(5, 3)).toBe('wait')
    expect(touchGestureOf(TOUCH_DRAG_THRESHOLD - 1, 0)).toBe('wait')
    // 长按容差之内的抖动全部落在这一档：按住不动那条路才走得通。
    expect(touchGestureOf(TOUCH_HOLD_TOLERANCE - 1, TOUCH_HOLD_TOLERANCE - 1)).toBe('wait')
  })
})
