import type { HTMLAttributes } from 'react'

export type OrnateFrameProps = HTMLAttributes<HTMLDivElement>

/** 一圈双线里的一条边。四条拼出一个矩形，顺序不重要，样式全在 styles.css 里按类名给。 */
const EDGES = ['top', 'right', 'bottom', 'left'] as const

/**
 * 双线里的一条线，由四条独立的边拼成。
 *
 * 为什么不是一个 `inset: Npx` 的空盒子加一圈 border（原来就是这么写的）：那个盒子和整块面板等大，
 * 而它挂着 feTurbulence + feDisplacementMap 的手绘滤镜——滤镜按**包围盒**算，
 * 于是为了让一圈 1px 的线看起来是手画的，浏览器要在 CPU 上算满整块面板的噪声。
 * 组卡页实测这两条线是 482×835 和 472×825，占了整页滤镜像素的 77%。
 * 拆成四条细边之后同一圈线只剩下四条 8px 宽的长条，滤镜面积掉到原来的三十分之一左右。
 *
 * 副作用是四条边各歪各的，四个角上两条线不再是同一笔连过去的。这在手绘风里不算破绽——
 * 位移本来就只有 ±1.5px，而且四个角上另有 .ornate-frame__corner 的折线压着。
 */
function FrameLine({ variant }: { variant: 'outer' | 'inner' }) {
  return EDGES.map((edge) => (
    <span
      key={edge}
      className={`ornate-frame__edge ornate-frame__edge--${variant} ornate-frame__edge--${edge}`}
      aria-hidden="true"
    />
  ))
}

/**
 * 纸面区域共用的双线雕花框。
 *
 * 边框和内容拆成独立层：内容层随便换（对局左侧栏里是两张英雄牌加卡堆，牌组页里是卡池），
 * 不用复制装饰节点，装饰线也不会挡住里面的点击。
 */
export function OrnateFrame({ className = '', children, ...props }: OrnateFrameProps) {
  return (
    <div className={`ornate-frame ${className}`.trim()} {...props}>
      <FrameLine variant="outer" />
      <FrameLine variant="inner" />
      <span className="ornate-frame__corner ornate-frame__corner--tl" aria-hidden="true" />
      <span className="ornate-frame__corner ornate-frame__corner--tr" aria-hidden="true" />
      <span className="ornate-frame__corner ornate-frame__corner--bl" aria-hidden="true" />
      <span className="ornate-frame__corner ornate-frame__corner--br" aria-hidden="true" />
      <div className="ornate-frame__content">{children}</div>
    </div>
  )
}
