/**
 * 16:9 舞台的缩放系数：把「舞台容器宽 ÷ 设计稿宽」写成一个纯数字的 CSS 变量，
 * 供缩放层的 transform: scale() 使用。对局页（--battle-scale）和卡组页（--deck-scale）各用一次。
 *
 * 为什么不用纯 CSS 算：transform: scale() 只吃无单位数字，而 CSS 的 calc 不允许长度除以长度，
 * 于是常见写法是 tan(atan2(100cqi, 1672px))——用 atan2 求出两个长度之比再取 tan。
 * 但 WebKit 对 atan2() 的两个参数单位不一致（这里是 cqi 和 px）有 bug，会忽略第二个参数，
 * 算出来的是垃圾值：Safari 上整块画面被缩没，选卡页和对局页只剩背景。
 * 所以改成在运行时用 JS 量一次容器宽再写进变量，各浏览器行为一致。
 *
 * 量的是缩放层的父元素，也就是 CSS 里 container-type: inline-size 的那个舞台容器
 *（对局页 .battle-stage、卡组页 .deck-page），它的宽正是原来 100cqi 的取值。
 */

import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { BATTLE_STAGE_WIDTH } from './battleStage'

/**
 * 返回一个要挂到缩放层元素上的 ref，并持续把缩放系数写进它的行内样式变量 varName。
 *
 * @param varName 缩放层 CSS 里 transform: scale(var(...)) 引用的变量名，两页各叫各的。
 * @param designWidth 设计稿宽度，默认取 battleStage 里那份常量，两页共用同一个数。
 *
 * 写在缩放层自己的行内样式上（而不是某个祖先）：行内样式优先级高于样式表里的兜底值，
 * 变量的取值范围也刚好覆盖唯一的使用点。
 */
export function useStageScale<T extends HTMLElement = HTMLDivElement>(
  varName: string,
  designWidth: number = BATTLE_STAGE_WIDTH,
): RefObject<T | null> {
  const ref = useRef<T>(null)

  // 必须是 useLayoutEffect 且先同步算一次：等第一次 ResizeObserver 回调的话，
  // 首帧会按兜底值 1 画出来，也就是整块 1672×941 的画面按原尺寸闪一下。
  useLayoutEffect(() => {
    const scaler = ref.current
    const stage = scaler?.parentElement
    if (scaler == null || stage == null) return

    const apply = () => {
      // 舞台容器没有边框和内边距，所以外框宽就是内容宽，和原来 100cqi 的口径一致。
      const width = stage.getBoundingClientRect().width
      // 宽度为 0 说明这一帧还没排版，先不写：真写进去整页会被缩成看不见。
      if (width === 0) return
      scaler.style.setProperty(varName, String(width / designWidth))
    }

    apply()
    // 舞台容器的宽由视口和 aspect-ratio 定死，和里面这层缩多少无关，
    // 所以写变量不会反过来改容器尺寸，观察器不会陷进循环。
    const observer = new ResizeObserver(apply)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [varName, designWidth])

  return ref
}
