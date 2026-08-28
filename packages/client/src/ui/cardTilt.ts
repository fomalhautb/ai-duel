/**
 * 卡面「跟着指针倾斜 + 一小块反光」。
 *
 * 一套物理模型：指针像手指一样把卡按下去，被按下的那一角的对角就翘向观察者，
 * 正对光源、反光最亮，所以高光落在指针的**镜像位置**而不是指针底下（见下面 onMove）。
 *
 * 独立成文件是因为两处要用：手牌 hover 放大后的大卡（HandFan）和战场上的小卡（HandDemo），
 * 两边的 DOM 结构、幅度、启用时机都不一样，塞进任何一个组件里另一个都得反过来 import。
 *
 * 这里刻意不碰 el 自己的 transform：调用方通常已经在 el 上补间位置/缩放了，
 * 倾斜必须写在另一层，否则两边互相覆盖。哪一层由 opts.tiltLayer 指定。
 *
 * hover 时的略微放大（opts.hoverScale）也只能做在这里，**不能**在 CSS 里写
 * `.xxx:hover { scale: 1.05 }`：GSAP 一旦接管某个元素的 transform，就会顺手往它的内联样式里
 * 写死 `translate: none; rotate: none; scale: none;`——这是它用来中和 CSS 那三个独立 transform
 * 属性、免得和自己写的 transform 双重叠加的手段。内联的 `scale: none` 优先级压过任何 CSS 规则，
 * hover 那条规则永远不生效（实测就是完全没反应）。
 * 所以这一层的缩放和倾斜一样归 GSAP 独占，正好也是"每层 transform 只由一个人写"的分工。
 */

import gsap from 'gsap'

export interface CardTiltOptions {
  /**
   * 真正承载倾斜的那一层：直接传元素，或者传一个在 el 里面查的选择器。
   * 找不到就退化成"什么都不做"，调用方不用额外判空。
   */
  tiltLayer: HTMLElement | string
  /** 指针压在卡面边缘时的最大倾角（度），指针在正中间时是 0。 */
  maxTilt?: number
  /**
   * hover 期间把 tiltLayer 缩放到的倍数，收手时回到 1。
   *
   * 不传就整个不碰 scale——连一次 gsap.set 都不写，那一层的缩放仍归调用方的 CSS 管
   * （手牌就是这样：放大交给 HandFan 自己的补间，这里只做倾斜）。
   * 要放大的话必须走这个选项，理由见文件头：CSS 的 hover 规则会被 GSAP 写的内联
   * `scale: none` 压住，根本不生效。
   */
  hoverScale?: number
  /**
   * 每次指针移动都会问一次要不要生效，返回 false 就当没 hover（归零并淡出高光）。
   *
   * 手牌用得上：扇形里的小卡本身是斜的，再叠一层倾斜会乱，
   * 所以只有"当前放大的那张"才让它生效。不传就是一直生效。
   */
  enabled?: () => boolean
}

export interface CardTiltHandle {
  /** 移除监听、把倾斜和高光归零。之后这个 handle 就作废了。 */
  detach(): void
  /**
   * 立刻收手：倾斜快速转回 0、高光淡出。
   * 抓起牌开始拖拽时用——指针那时已经被 capture，等不到 pointerleave 自己来归零，
   * 不归零就会拖着一张歪的牌满屏找落点。
   */
  reset(): void
}

/** 高光层的类名，attachCardTilt 会在 el 里面找所有这个类的元素一起淡入淡出。 */
const GLARE_SELECTOR = '.card-glare'

/** 倾斜跟随指针的时长。太短会跟得发飘，太长会拖成"甩尾"。 */
const FOLLOW_DUR = 0.35
/** 打出/离开时倾斜归零的时长，比跟随更干脆。 */
const RESET_DUR = 0.15
/** 高光淡入淡出的时长。 */
const GLARE_FADE = 0.2
/** hover 放大 / 复原的时长。比倾斜跟随（0.35s）快，放大要利落，慢了像被拖着走。 */
const HOVER_SCALE_DUR = 0.16
const DEFAULT_MAX_TILT = 6

/**
 * 缓存的元素矩形最多用多久（毫秒），过期就重读一次。
 *
 * 选 120ms 是拿"最短的一段会让 rect 变化的动画"来卡的：手牌 hover 放大是 0.28s，
 * 期间最多用到 120ms 前的旧尺寸，算出来的位置比例偏差和下面 onMove 注释里
 * 说的"卡还没转正"是同一量级，看不出来。
 */
const RECT_MAX_AGE_MS = 120

/**
 * 高光位置写进 CSS 变量前量化到的步长（百分比）。
 *
 * 0.5% 在放大后约 285px 宽的卡上不到 1.5px，而高光是个 400px 半径的软渐变，
 * 挪这么点距离肉眼分辨不出来；换来的是指针亚像素抖动时整条
 * "样式失效→渐变重画→混合"的链路可以直接不跑。
 */
const GLARE_STEP = 0.5

const NOOP_HANDLE: CardTiltHandle = { detach() {}, reset() {} }

/**
 * 给一张卡挂上倾斜跟随和高光。返回的 handle 负责收尾。
 *
 * 必须在 useGSAP 的回调里调用：这里创建的补间（quickTo 的内部补间、归零补间）
 * 装在一个子 context 里，而这个子 context 要挂到外层 useGSAP 的 context 上，
 * 组件卸载时才会被一起 revert 掉。
 * 反过来说，下面几个指针回调里**不再新建任何补间**——它们只是给已经建好的补间喂新值，
 * 所以回调本身不需要再包 contextSafe。
 */
export function attachCardTilt(el: HTMLElement, opts: CardTiltOptions): CardTiltHandle {
  const layer =
    typeof opts.tiltLayer === 'string' ? el.querySelector<HTMLElement>(opts.tiltLayer) : opts.tiltLayer
  if (layer === null) return NOOP_HANDLE

  const maxTilt = opts.maxTilt ?? DEFAULT_MAX_TILT
  /** null 表示这次调用完全不管 scale。用 null 而不是默认 1，是为了区分"不碰"和"缩放到 1"。 */
  const hoverScale = opts.hoverScale ?? null
  const isEnabled = opts.enabled ?? (() => true)
  const glares = Array.from(el.querySelectorAll<HTMLElement>(GLARE_SELECTOR))

  // 高光位置走 CSS 变量，不进补间：它得和指针一样跟手（只是位置取的是镜像点），
  // 插值反而会糊。
  //
  // 变量直接写在 .card-glare 这些叶子节点上，不写在 el（slot / tile）上靠继承往下传：
  // 自定义属性是可继承的，写在祖先上等于宣告整棵子树（一张卡约十几个节点）的样式全部作废、
  // 每个节点都要重算一遍，而指针每移动一次就要写一次。写在叶子上只作废这一两个高光节点。
  const setGlarePos =
    glares.length > 0
      ? {
          x: gsap.quickSetter(glares, '--glare-x', '%') as (value: number) => void,
          y: gsap.quickSetter(glares, '--glare-y', '%') as (value: number) => void,
        }
      : null

  /** 上一次真正写下去的高光位置（已量化）。NaN 表示还没写过，第一次一定会写。 */
  let lastGlareX = Number.NaN
  let lastGlareY = Number.NaN

  /**
   * 把高光位置量化后写进 CSS 变量；量化后和上次一样就整个跳过。
   * 没有高光层时什么都不做，调用方不用判空。
   */
  const writeGlare = (x: number, y: number) => {
    if (setGlarePos === null) return
    const stepX = Math.round(x / GLARE_STEP) * GLARE_STEP
    const stepY = Math.round(y / GLARE_STEP) * GLARE_STEP
    if (stepX === lastGlareX && stepY === lastGlareY) return
    lastGlareX = stepX
    lastGlareY = stepY
    setGlarePos.x(stepX)
    setGlarePos.y(stepY)
  }

  let tiltX!: gsap.QuickToFunc
  let tiltY!: gsap.QuickToFunc
  let fadeGlare: gsap.QuickToFunc | null = null
  let scaleXTo: gsap.QuickToFunc | null = null
  let scaleYTo: gsap.QuickToFunc | null = null
  let zeroTilt!: gsap.core.Tween

  // 这几条补间建在自己的子 context 里，detach 时一次 kill 掉。
  //
  // 直接建在外层 useGSAP 的 context 里也能跑，但那个 context 要到组件卸载才清空，
  // 而单条补间自己 kill() 并不会把自己从 context 的记录里摘掉。
  // 挂了又摘几百次之后，那份记录里就攒着几百条早就没用、却还攥着已被移除 DOM 的补间。
  // 换成子 context，外层每次只多记一个条目，kill 之后这个条目里就是空的了。
  const ctx = gsap.context(() => {
    // quickTo 只在这里建一次补间，之后每次指针移动都是改这一个补间的目标值。
    // 指针在几张卡之间快速扫动时不会堆出一串补间，也就不用 overwrite。
    tiltX = gsap.quickTo(layer, 'rotationX', { duration: FOLLOW_DUR, ease: 'power2.out' })
    tiltY = gsap.quickTo(layer, 'rotationY', { duration: FOLLOW_DUR, ease: 'power2.out' })
    if (glares.length > 0) {
      fadeGlare = gsap.quickTo(glares, 'opacity', { duration: GLARE_FADE, ease: 'power2.out' })
    }
    // hover 放大单独走 quickTo，不并进下面的 zeroTilt：那条补间被 invalidate + restart 反复复用，
    // 掺进缩放就变成两个人写同一个属性。缩放也不需要 needsResync 那套接续处理——
    // 放大和复原都是这两条 quickTo 自己在改，它们清楚自己补到哪了。
    //
    // 必须分开写 scaleX / scaleY，**不能**图省事写成 quickTo(layer, 'scale')：
    // 'scale' 是 shorthand，CSSPlugin 会把它拆成 scaleX 和 scaleY 两条 PropTween，
    // 而 quickTo 喂新值走的 resetTo 是按属性名去找 PropTween 的，找 'scale' 一个也找不上，
    // 于是值一动不动、还不报错（gsap 3.15 实测，隔离验证：quickTo(el,'scale')(1.5) 后 scaleX 仍是 1，
    // 换成 'scaleX' 立刻生效）。和下面那条"resetTo 不触发 onComplete"是同一类静默陷阱。
    if (hoverScale !== null) {
      scaleXTo = gsap.quickTo(layer, 'scaleX', { duration: HOVER_SCALE_DUR, ease: 'power2.out' })
      scaleYTo = gsap.quickTo(layer, 'scaleY', { duration: HOVER_SCALE_DUR, ease: 'power2.out' })
    }
    // 归零用一条预先建好、暂停着的补间：它要比跟随更快，没法复用上面那对 quickTo 的时长。
    zeroTilt = gsap.to(layer, {
      rotationX: 0,
      rotationY: 0,
      duration: RESET_DUR,
      ease: 'power2.out',
      paused: true,
    })
  })

  /** 当前是否正在跟随。用它挡住重复的淡入淡出，免得高光每帧都重新开始淡入。 */
  let following = false
  /**
   * 等高光淡完之后摘掉 data-glare 的定时器（null 表示当前没有排队的摘除）。
   *
   * 不用 GSAP 的补间回调：quickTo 每次改目标值走的是 resetTo 重启这条路，
   * 实测（gsap 3.15）这条路径不会触发 onComplete——值正常跑完，回调一次都不来，
   * 于是属性永远摘不掉。所以退回到平台自己的定时器来计时。
   */
  let removeGlareTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * 下一次跟随要不要先读一遍元素上真实的角度。
   *
   * quickTo 默认拿"它自己补间到哪了"当起点，而 zeroTilt 是另一条补间，
   * 它把角度改到 0 之后 quickTo 并不知情，直接喂新值会从旧角度跳一下。
   * 归零之后打上这个标记，下一次跟随显式把当前角度当起点，就接得上了。
   */
  let needsResync = true

  /** 上一次读到的 el 矩形，和读它的时刻（performance.now 的毫秒数）。 */
  let cachedRect: DOMRect | null = null
  let cachedRectAt = 0

  const follow = (rotationX: number, rotationY: number) => {
    if (needsResync) {
      needsResync = false
      zeroTilt.pause()
      tiltX(rotationX, Number(gsap.getProperty(layer, 'rotationX')))
      tiltY(rotationY, Number(gsap.getProperty(layer, 'rotationY')))
      return
    }
    tiltX(rotationX)
    tiltY(rotationY)
  }

  /** 收手：倾斜归零、高光淡出。fast 为 true 时用更干脆的归零补间。 */
  const settle = (fast: boolean) => {
    if (!following && !fast) return
    following = false
    fadeGlare?.(0)
    // 缩放复原两条路都要走：拖拽时的 reset(fast) 同样得把卡收回原大小，
    // 不然会拖着一张放大的牌满屏找落点。
    if (hoverScale !== null) {
      scaleXTo?.(1)
      scaleYTo?.(1)
    }
    // 等淡出跑完再摘 data-glare，不在这里立刻摘：还没淡完的高光一旦失去 soft-light，
    // 会当场变成普通的白色半透明叠加、亮度跳一下，看着就是消失前先闪一下。
    // 多等的 100ms 是给淡出补间掉帧时留的余量。晚一点摘没有代价：
    // 回调跑的时候高光早就看不见了，摘这一下只是把混合模式关掉。
    // 没有高光层时没有属性要摘，也就不用排这个定时器。
    if (glares.length > 0) {
      if (removeGlareTimer !== null) clearTimeout(removeGlareTimer)
      removeGlareTimer = setTimeout(() => {
        removeGlareTimer = null
        // 这段时间里指针可能又回到卡上了，那就别摘。
        if (!following) el.removeAttribute('data-glare')
      }, GLARE_FADE * 1000 + 100)
    }
    if (fast) {
      // 归零之前必须先停掉跟随补间。跟随和归零写的是同一层的 rotationX / rotationY，
      // 谁都没开 overwrite，所以两条补间会同时活着；而跟随长一倍多（0.35s vs 0.15s），
      // 归零跑完被 GSAP 摘掉之后，还剩半程的跟随立刻把角度拉回它自己的目标并停在那，
      // 画面上就是"先摆正一下、随即歪回去"，归零等于白做。
      // 停了不用手动恢复：下一次 follow 调的 resetTo 开头就会把暂停的补间重新播放。
      tiltX.tween.pause()
      tiltY.tween.pause()
      // invalidate 是必需的：这条补间被复用，不清掉上一轮记下的起始角度，
      // 它会从上一次的角度开始转，而不是从现在这个角度。
      zeroTilt.invalidate().restart()
      needsResync = true
    } else {
      follow(0, 0)
    }
  }

  const onMove = (event: PointerEvent) => {
    if (!isEnabled()) {
      settle(false)
      return
    }
    // 矩形是缓存着用的，不是每次移动都量。
    //
    // 上一帧 GSAP 刚往这棵子树里写过 transform，紧接着调 getBoundingClientRect 就是
    // "写→读→写"：浏览器为了给出准确答案必须当场把样式和布局全算完，帧时间大半耗在这一步。
    // 所以只有两种时候才真去量：刚开始跟随的那一次（位置可能整个变了），
    // 以及缓存超过 RECT_MAX_AGE_MS。稳态 hover 下 slot 的位置尺寸根本不动，缓存一直是准的。
    //
    // 即便量到的是"过期"的矩形，误差也在这里本来就接受的范围内：
    // 祖先有缩放时 rect 已经是缩放后的值，按比例算出来的仍是卡面上的相对位置，不用额外换算；
    // 祖先有旋转时 rect 会变成外接矩形、比例就偏小。手牌是有这么一小段的：hover 的头几帧
    // 卡还在往正位转（HandFan 里 0.28s 的回正补间，最外侧那张起手 20°，
    // 外接矩形约有卡宽的 1.4 倍），这期间指针压在卡边缘只算得出 0.7 上下的比例。
    // 倾斜幅度本来就只有十度上下，这一小会儿的偏差看不出来，所以不为此推迟启用；
    // opts.enabled 挡的是"根本没被放大的那些牌"，不是"还没转正的那几帧"。
    const now = performance.now()
    if (cachedRect === null || !following || now - cachedRectAt > RECT_MAX_AGE_MS) {
      cachedRect = el.getBoundingClientRect()
      cachedRectAt = now
    }
    const rect = cachedRect
    if (rect.width === 0 || rect.height === 0) return
    const ratioX = (event.clientX - rect.left) / rect.width
    const ratioY = (event.clientY - rect.top) / rect.height

    if (!following) {
      following = true
      // 打开高光那一层的 mix-blend-mode，只在跟随期间开着（见 styles.css 的 [data-glare='on']）：
      // 非 normal 的混合模式会让 WebKit 无条件给元素单独提一层、每帧离屏合成，
      // 满屏二十张牌就是四十层常驻开销，而不跟随时高光 opacity 是 0，本来就看不见。
      //
      // 先撤掉上一轮排着的摘除：指针离开又马上回来时，那个定时器还在倒计时，
      // 让它跑到就会把刚打开的属性摘掉。
      if (removeGlareTimer !== null) {
        clearTimeout(removeGlareTimer)
        removeGlareTimer = null
      }
      el.setAttribute('data-glare', 'on')
      fadeGlare?.(1)
      // 放大只在"刚开始跟随"这一下触发，不用每次指针移动都喂值：目标值自始至终是同一个。
      if (hoverScale !== null) {
        scaleXTo?.(hoverScale)
        scaleYTo?.(hoverScale)
      }
    }
    // 高光放在指针的镜像位置（对角），不是指针底下。
    // 配合下面的倾斜方向：指针把卡按下去，翘起来正对观察者、也正对光源的是对角那一块，
    // 最亮的自然就是它。两者是同一个物理模型的两半，改一边就得改另一边。
    writeGlare((1 - ratioX) * 100, (1 - ratioY) * 100)
    // 倾斜方向：指针在哪边，哪边就往屏幕里陷下去，像用手指把卡牌那一角按住往下按。
    // 反过来（指针那一角朝观察者抬起）也做过，用户实际体验后确认按下去这版手感更对。
    // 符号：正的 rotationX 让上沿往后倒、正的 rotationY 让右沿往后倒，
    // 所以指针在下半部配负的 rotationX，指针在右半边配正的 rotationY。
    follow(-(ratioY - 0.5) * 2 * maxTilt, (ratioX - 0.5) * 2 * maxTilt)
  }

  const onLeave = () => settle(false)

  el.addEventListener('pointerenter', onMove)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerleave', onLeave)
  // 指针被系统收走（触屏被别的手势接管、窗口失焦）时不会有 pointerleave，只有这个。
  el.addEventListener('pointercancel', onLeave)

  return {
    detach() {
      el.removeEventListener('pointerenter', onMove)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointercancel', onLeave)
      following = false
      // 摘除的定时器要是还排着，回调会去碰一个已经卸载的元素，所以撤掉它、这里直接摘。
      if (removeGlareTimer !== null) {
        clearTimeout(removeGlareTimer)
        removeGlareTimer = null
      }
      el.removeAttribute('data-glare')
      // 卸载路径上不留补间：这几条补间的目标元素马上就要离开文档，
      // 让它们继续跑就是在改一个没人看的节点。直接杀掉再把值写死。
      ctx.kill()
      // 写值用的 gsap.set 本身也是一条零时长补间，直接调会被记进外层 useGSAP 的 context，
      // 那份记录要到组件卸载才清空，于是每摘一张卡就往里留一条。
      // ignore 让这两条补间不属于任何 context，跑完就能被回收。
      ctx.ignore(() => {
        // 没开 hoverScale 的调用方，这一层的 scale 从头到尾没被碰过，
        // 这里也不能写：写一次就等于凭空给它留下一份内联 scale，盖掉调用方自己的 CSS。
        // 这里写 shorthand 的 scale 是可以的：gsap.set 走的是完整解析路径，会正常拆成 scaleX/scaleY，
        // 上面那个"找不到 PropTween"的坑只在 quickTo 的 resetTo 那条快路上。
        gsap.set(
          layer,
          hoverScale === null
            ? { rotationX: 0, rotationY: 0 }
            : { rotationX: 0, rotationY: 0, scale: 1 },
        )
        if (glares.length > 0) gsap.set(glares, { opacity: 0 })
      })
    },
    reset() {
      settle(true)
    },
  }
}
