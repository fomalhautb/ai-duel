/**
 * 16:9 舞台的缩放比：运行时用 JS 算好写进 CSS 变量。
 *
 * 缩放比本来纯 CSS 就能算——`tan(atan2(100cqi, 1672px))`，见 styles.css 的 .battle-scaler
 * 和 screens/deck.css 的 .deck-scaler。但 WebKit 的 atan2 处理"cqi 和 px 混着来"有 bug，
 * Safari 上整条表达式算不出值，scale 跟着塌掉，对局页 / 卡组页 / 结算测试页的舞台整块看不见。
 *
 * 所以这里量一次舞台宽度、除以设计宽，把结果以内联样式写回缩放层，盖掉 CSS 里那份。
 * 不做浏览器判断、无条件覆盖：JS 算出来的就是个纯数字，哪个浏览器上都正确，
 * 分支只会多一条没人走的路径。CSS 里的 atan2 保留，当 JS 生效前那一两帧的兜底
 * （Chrome 上正确，Safari 上本来就是坏的，兜不兜结果一样）。
 */

import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { BATTLE_STAGE_WIDTH } from './battleStage'

/**
 * 把 `stageRef` 的宽度换算成缩放比，写到 `scalerRef` 上的 `cssVar`。
 *
 * 两个 ref 由调用方给：卡组页的尺寸容器（.deck-page）本来就有 ref 在别处用着，
 * 钩子自己再造一个就得合并 ref，不如让调用方决定挂在哪个节点上。
 *
 * @param cssVar   要写的变量名，对局页是 `--battle-scale`，卡组页是 `--deck-scale`。
 * @param stageRef 尺寸容器：宽度定死 16:9 那块地方的那一层，也就是 CSS 里 cqi 的基准
 *                 （.battle-stage / .deck-page，都带 container-type: inline-size）。
 * @param scalerRef 缩放层：永远 1672×941、靠 transform: scale() 缩进舞台的那一层。
 */
export function useStageScale(
  cssVar: string,
  stageRef: RefObject<HTMLElement | null>,
  scalerRef: RefObject<HTMLElement | null>,
): void {
  // useLayoutEffect 而不是 useEffect：要赶在这一帧绘制之前写进去，
  // 否则 Safari 上会先闪一帧空白舞台（CSS 里的兜底值在 Safari 上是坏的）。
  useLayoutEffect(() => {
    const stage = stageRef.current
    const scaler = scalerRef.current
    if (stage === null || scaler === null) return

    const apply = () => {
      // 两个尺寸容器都没有 padding / border，边框盒宽度就等于 cqi 的基准（内容盒宽度）。
      // 用 getBoundingClientRect 而不是 clientWidth 是因为前者带小数，
      // 取整会让缩放层和舞台差出一条亚像素的缝。
      const width = stage.getBoundingClientRect().width
      // 宽度为 0 说明这一帧还没排版好，写下去会把整块画面缩没；等 observer 的下一次回调即可。
      if (width === 0) return
      scaler.style.setProperty(cssVar, String(width / BATTLE_STAGE_WIDTH))
    }

    // 先立即写一次：ResizeObserver 的首次回调要等到下一帧，中间那一帧不能让 Safari 露馅。
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [cssVar, stageRef, scalerRef])
}
