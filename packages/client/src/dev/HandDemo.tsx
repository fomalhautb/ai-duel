/**
 * 手牌动画演示页（访问 ?demo=hand 进入）。
 *
 * 这页不接规则引擎，只用占位数据把 HandFan 的各种边界跑一遍：
 * 0 张、1 张、20 张、动画播到一半再加减牌。
 * 中间那块虚线区是"战场"的占位——之后接真对局时，它就是真正的战场容器。
 */

import { useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { HandCardFace, HandFan } from '../ui/HandFan'
import type { HandCardData } from '../ui/HandFan'

gsap.registerPlugin(useGSAP, Flip)

const MAX_HAND = 20
const INITIAL_HAND = 5

/** 自增序号，保证每张占位卡的 id 和名字都不重样。 */
let nextSeq = 0

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** 造一张随机占位卡。演示页在客户端跑，用 Math.random 没问题。 */
function createCard(): HandCardData {
  nextSeq += 1
  const seq = nextSeq
  const kind: HandCardData['kind'] = Math.random() < 0.5 ? 'model' : 'prompt'
  const rarity = randInt(1, 3)
  const base = {
    id: `demo-${seq}`,
    cost: randInt(0, 9),
    backText: `稀有度 ${'★'.repeat(rarity)}${'☆'.repeat(3 - rarity)} · 这是背面的占位说明文字，用来验证翻转之后的排版够不够放得下几行字。`,
  }
  if (kind === 'model') {
    return {
      ...base,
      kind,
      name: `占位模型 ${seq}号`,
      power: randInt(1, 9),
      integrity: randInt(1, 9),
      text: '占位描述：打出后留在场上，等着被对手的提示卡挑弱点。',
    }
  }
  return {
    ...base,
    kind,
    name: `占位提示 ${seq}号`,
    damage: randInt(1, 6),
    text: '占位描述：一次性结算，专挑目标最脆的那一维打。',
  }
}

function createCards(count: number): HandCardData[] {
  return Array.from({ length: count }, () => createCard())
}

export function HandDemo() {
  const [hand, setHand] = useState<HandCardData[]>(() => createCards(INITIAL_HAND))
  const [board, setBoard] = useState<HandCardData[]>([])
  /**
   * 点击那一刻记下的卡牌位置，等 React 把 DOM 换好之后再拿它补飞行动画。
   * 连 id 一起存：手牌那个节点马上就没了，之后只能靠 id 去战场里找新元素。
   */
  const flipStateRef = useRef<{ state: Flip.FlipState; id: string } | null>(null)

  const resizeHand = (count: number) => {
    const next = Math.max(0, Math.min(MAX_HAND, count))
    setHand((current) => {
      if (next === current.length) return current
      // 少了从末尾砍，多了往末尾补，这样已有的牌 id 不变，正在播的补间不会被打断。
      if (next < current.length) return current.slice(0, next)
      return [...current, ...createCards(next - current.length)]
    })
  }

  const handlePlay = (id: string) => {
    const card = hand.find((item) => item.id === id)
    if (!card) return
    // 此刻手牌那张卡还在 DOM 里、还是放大的样子，正好当飞行的起点。
    // 查询限定在 .hand-fan 里：战场上的小卡用的是同一套 data-flip-id，
    // 而且 .demo__board 在 DOM 里排在手牌前面，不限定的话将来"退回手牌"之类的
    // 复用场景会抓错元素。
    const slot = document.querySelector(`.hand-fan [data-flip-id="${CSS.escape(id)}"]`)
    flipStateRef.current = slot === null ? null : { state: Flip.getState(slot), id }
    setHand((current) => current.filter((item) => item.id !== id))
    setBoard((current) => [...current, card])
  }

  useGSAP(
    () => {
      const pending = flipStateRef.current
      if (pending === null) return
      flipStateRef.current = null
      // 必须显式把战场上的新元素交给 Flip。不传 targets 的话 Flip 会退回用
      // state.targets——也就是手牌里那个已经被 React 摘掉的旧节点，
      // 于是补间挂在一个脱离文档的 div 上，战场小卡一动不动，飞行等于没跑。
      // Flip 不会自己按 data-flip-id 去全文档找新元素。
      const target = document.querySelector(`.demo__board [data-flip-id="${CSS.escape(pending.id)}"]`)
      if (target === null) return
      // 新旧两个元素靠 data-flip-id 对上号，
      // Flip 负责把新元素从旧元素的位置和大小补间过来，中间不会跳一下。
      Flip.from(pending.state, {
        targets: target,
        duration: 0.65,
        ease: 'power2.inOut',
        // 用 scale 而不是 width/height，卡面里的字会跟着一起缩，看起来才像同一张卡在变小。
        scale: true,
        // 飞行途中盖住手牌；战场容器本身没有层叠上下文，所以这个层级是全局有效的。
        zIndex: 60,
      })
    },
    { dependencies: [board] },
  )

  return (
    <div className="demo">
      <div className="demo__bar">
        <span className="demo__title">手牌扇形动画演示</span>
        <button type="button" className="demo__btn" onClick={() => resizeHand(hand.length - 1)}>
          −1
        </button>
        <button type="button" className="demo__btn" onClick={() => resizeHand(hand.length + 1)}>
          +1
        </button>
        <input
          className="demo__slider"
          type="range"
          min={0}
          max={MAX_HAND}
          value={hand.length}
          onChange={(event) => resizeHand(Number(event.target.value))}
        />
        <span className="demo__count">手牌 {hand.length} 张</span>
        <button type="button" className="demo__btn" onClick={() => setBoard([])}>
          清空战场
        </button>
      </div>

      <div className="demo__board">
        {board.length === 0 && <span className="demo__board-hint">战场占位区（点手牌打出）</span>}
        {board.map((card) => (
          <div key={card.id} className="demo__tile" data-flip-id={card.id}>
            {/* 里面是整张 150×210 的卡面，靠缩放变成小卡，飞行途中和手牌里的卡长得一模一样。 */}
            <div className="demo__tile-inner">
              <HandCardFace card={card} />
            </div>
          </div>
        ))}
      </div>

      <HandFan cards={hand} onPlay={handlePlay} />
    </div>
  )
}
