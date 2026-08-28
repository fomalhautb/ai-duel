/**
 * 卡牌落到战场上的"上场特效"，三样叠在一起放：震屏、烟尘扑腾、金色边缘追光。
 *
 * 我方（拖拽出牌）和对方（强制展示之后落场）走的是同一个函数，连配色也一样，
 * 所以两边的落地手感永远是一致的——分开写两份迟早会各自跑偏。
 *
 * 节奏（t0 = 落地那一刻）：
 * t0 震屏 + 烟尘 + 边缘追光同时起，追光在 t0+0.5 收，
 * 最后一样东西（烟尘）在 t0+0.8 前后收尾。全程不挡任何交互：
 * 动态生成的烟尘都挂在 pointer-events: none 的特效层里，其余动画只改 transform / opacity /
 * 一个自定义属性。
 *
 * 必须在 useGSAP 的 context 里调用（Flip 的 onComplete 要用 contextSafe 包一层），
 * 否则这里建的补间不归 context 管，组件卸载时 revert 不掉。
 *
 * 调用方是 MatchStage 里两段落场飞行的 onComplete：我方从手牌飞到战场那段，
 * 以及对方的牌强制展示完从展示位飞到战场那段。它依赖战场里的两个节点——
 * 每张小卡内的 .battle__tile-edge（追光）和战场容器里的 .battle__smoke-layer（烟尘），
 * 少了哪个就只是少播对应的一样，不会报错。
 */

import gsap from 'gsap'

/** 震屏里每一小段位移的时长。五段拼成一次抖动，末段翻倍收尾，全程约 0.3 秒。 */
const SHAKE_STEP = 0.05
/** 烟尘团数：太少不像扑起来的灰，太多在 110px 的小卡上就糊成一坨。 */
const SMOKE_COUNT = 5
/** 追光绕卡牌边缘跑满一圈的时长。淡入淡出都叠在这段里，所以它就是整条追光的总时长。 */
const EDGE_DUR = 0.5
/** 追光的淡入 / 淡出时长。淡入要快到几乎看不见过程，亮弧才像是"一下子亮起来就跑了"。 */
const EDGE_IN = 0.08
const EDGE_OUT = 0.16

/**
 * 播一次上场特效。
 *
 * tile 就是战场上那张小卡的最外层 .battle__tile，其余零件（追光层、特效层、页面根元素）
 * 都从它往上下找，调用方不用一个个传进来。
 */
export function playSummonFx(tile: HTMLElement) {
  const edge = tile.querySelector<HTMLElement>('.battle__tile-edge')
  const board = tile.closest<HTMLElement>('.battle__board')
  const fxLayer = board?.querySelector<HTMLElement>('.battle__smoke-layer') ?? null
  const root = tile.closest<HTMLElement>('.battle')

  if (root !== null) shakeScreen(root)

  if (fxLayer !== null) {
    // 烟尘以"卡牌底边中点"为落点：卡是砸下来的，灰是从脚下扑起来的。
    // 坐标要换算成相对特效层的，因为烟尘是 absolute 挂在特效层里的。
    const layerRect = fxLayer.getBoundingClientRect()
    const rect = tile.getBoundingClientRect()
    const cx = rect.left + rect.width / 2 - layerRect.left
    const cy = rect.bottom - layerRect.top
    spawnSmoke(fxLayer, cx, cy)
  }

  if (edge !== null) runEdgeLight(edge)
}

/**
 * 整屏抖 2~3px，约 0.3 秒。
 *
 * 抖的是 .battle 根元素，有两个副作用值得记一笔（都不影响观感，但改这里之前要知道）：
 * 一是 .battle 一旦有了 transform，就成了内部所有 fixed 元素（.hand-fan、.opponent-fan、
 * 强制展示的遮罩和卡）的 containing block——好在 .battle 本来就正好铺满视口，
 * 这些元素的 left / top / width: 100% 算出来还是同一个矩形，画面没有差别；
 * 二是这期间 .battle 临时变成一个层叠上下文，但页面上所有 z-index 都在 .battle 内部，
 * 相对关系原样保留，顶栏仍然压着手牌、遮罩仍然压着一切。
 *
 * 收尾必须 clearProps 把 transform 整个抹掉，只把 x / y 归零是不够的：
 * 留着一个 translate(0, 0) 的 transform，上面两条副作用就会一直生效。
 */
function shakeScreen(root: HTMLElement) {
  // 连着落两张牌时，旧的抖动要让位，不然两条补间抢同一个 transform 会把幅度叠出去。
  gsap.killTweensOf(root)
  gsap
    .timeline({ onComplete: () => gsap.set(root, { clearProps: 'transform' }) })
    .to(root, { x: 3, y: -2, duration: SHAKE_STEP, ease: 'power1.inOut' })
    .to(root, { x: -2.5, y: 2, duration: SHAKE_STEP, ease: 'power1.inOut' })
    .to(root, { x: 2, y: 1.5, duration: SHAKE_STEP, ease: 'power1.inOut' })
    .to(root, { x: -1.5, y: -1, duration: SHAKE_STEP, ease: 'power1.inOut' })
    .to(root, { x: 0, y: 0, duration: SHAKE_STEP * 2, ease: 'power2.out' })
}

/**
 * 沿卡牌圆角边缘跑一圈的金色亮弧：淡入 → 绕一圈 → 淡出。
 *
 * 亮弧本身是 conic-gradient 里的一小段（见 .battle__tile-edge-ring），
 * "跑起来"就是每帧改写这个锥形渐变的起始角 --edge-angle。
 * 角度补间挂在一个普通对象上、再由 onUpdate 拼出角度字符串，而不是让 GSAP 直接补间
 * 这个自定义属性：--edge-angle 没有用 @property 注册过，浏览器只把它当一串记号，
 * 交给 GSAP 猜单位不如自己拼来得确定。
 *
 * 匀速转（ease: none）：追光要像绕着边框"跑"，带缓动的话会在某一段莫名其妙地慢下来。
 */
function runEdgeLight(edge: HTMLElement) {
  const spin = { angle: 0 }
  const write = () => edge.style.setProperty('--edge-angle', `${spin.angle}deg`)
  gsap
    .timeline({
      // 跑完把动态状态收干净：opacity 由最后那段补间归零，起始角手动清回 0，
      // 免得这张卡下次再播时亮弧从上一轮停下的地方起跑。
      onComplete: () => edge.style.setProperty('--edge-angle', '0deg'),
    })
    .to(spin, { angle: 360, duration: EDGE_DUR, ease: 'none', onUpdate: write }, 0)
    .fromTo(edge, { opacity: 0 }, { opacity: 1, duration: EDGE_IN, ease: 'power2.out' }, 0)
    .to(edge, { opacity: 0, duration: EDGE_OUT, ease: 'power2.in' }, EDGE_DUR - EDGE_OUT)
}

/** 落点两侧扑起来的几团灰褐色烟尘。 */
function spawnSmoke(layer: HTMLElement, cx: number, cy: number) {
  for (let i = 0; i < SMOKE_COUNT; i += 1) {
    const size = 34 + Math.random() * 30
    const puff = document.createElement('div')
    puff.className = 'battle__smoke'
    puff.style.width = `${size}px`
    puff.style.height = `${size}px`
    puff.style.left = `${cx - size / 2}px`
    puff.style.top = `${cy - size / 2}px`
    layer.appendChild(puff)
    // 按奇偶分左右，保证两边都有。纯随机方向的话经常整把灰全扑到同一侧，看着像风吹的。
    const dir = i % 2 === 0 ? -1 : 1
    gsap.fromTo(
      puff,
      { scale: 0.45, opacity: 0.5 },
      {
        x: dir * (38 + Math.random() * 52),
        y: -(18 + Math.random() * 38),
        scale: 1.5 + Math.random() * 0.7,
        opacity: 0,
        duration: 0.62 + Math.random() * 0.18,
        ease: 'power2.out',
        // 一次性道具，散完就得从 DOM 里拿掉，否则连打几张牌就攒下一堆看不见的空 div。
        onComplete: () => puff.remove(),
      },
    )
  }
}
