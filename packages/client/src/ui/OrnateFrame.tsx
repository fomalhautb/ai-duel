import type { HTMLAttributes } from 'react'

export type OrnateFrameProps = HTMLAttributes<HTMLDivElement>

/**
 * 纸面区域共用的双线雕花框。
 *
 * 边框和内容拆成独立层，侧栏以后填入头像、卡牌详情等内容时，不需要复制装饰节点，
 * 也不会让装饰线挡住里面的交互。
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
