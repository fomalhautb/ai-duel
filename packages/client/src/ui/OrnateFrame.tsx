import type { HTMLAttributes } from 'react'

export type OrnateFrameProps = HTMLAttributes<HTMLDivElement>

/**
 * 纸面区域共用的双线雕花框。
 *
 * 边框和内容拆成独立层：内容层随便换（左侧栏里是两张英雄牌加卡堆，右侧栏是状态和按钮），
 * 不用复制装饰节点，装饰线也不会挡住里面的点击。
 */
export function OrnateFrame({ className = '', children, ...props }: OrnateFrameProps) {
  return (
    <div className={`ornate-frame ${className}`.trim()} {...props}>
      <span className="ornate-frame__line ornate-frame__line--outer" aria-hidden="true" />
      <span className="ornate-frame__line ornate-frame__line--inner" aria-hidden="true" />
      <span className="ornate-frame__corner ornate-frame__corner--tl" aria-hidden="true" />
      <span className="ornate-frame__corner ornate-frame__corner--tr" aria-hidden="true" />
      <span className="ornate-frame__corner ornate-frame__corner--bl" aria-hidden="true" />
      <span className="ornate-frame__corner ornate-frame__corner--br" aria-hidden="true" />
      <div className="ornate-frame__content">{children}</div>
    </div>
  )
}
