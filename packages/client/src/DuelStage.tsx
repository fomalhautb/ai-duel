import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Text } from 'pixi.js'
import gsap from 'gsap'

/**
 * 对局画布的占位实现。
 *
 * 这里只负责证明 Pixi + GSAP 已经接好：画一张占位卡并让它上下浮动。
 * 真正的对局画面之后接进来的方式是消费 core 的事件流——
 * 每收到一个 GameEvent 就播一段动画，而不是自己去读 GameState 重算规则。
 */
export function DuelStage() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Pixi v8 的 init 是异步的，而 React 严格模式会立刻卸载再挂载一次。
    // 这个标记保证"初始化还没完成就被卸载"时不会把画布留在页面上。
    let disposed = false
    let app: Application | null = null
    let float: gsap.core.Tween | null = null

    void (async () => {
      const instance = new Application()
      await instance.init({
        background: '#0d1117',
        resizeTo: host,
        antialias: true,
        // 高分屏下不做这两项，Pixi 画出来的文字会糊。
        resolution: window.devicePixelRatio,
        autoDensity: true,
      })
      if (disposed) {
        instance.destroy(true, { children: true })
        return
      }
      app = instance
      host.appendChild(instance.canvas)
      float = mountPlaceholder(instance)
    })()

    return () => {
      disposed = true
      // destroy 会连带停掉渲染循环，但 GSAP 的补间不归 Pixi 管，得自己杀掉，
      // 否则它会继续去改一个已经销毁的对象。
      float?.kill()
      float = null
      app?.destroy(true, { children: true })
      app = null
    }
  }, [])

  return <div className="stage" ref={hostRef} />
}

/** 画一张浮动的占位卡，返回它的补间供卸载时清理。 */
function mountPlaceholder(app: Application): gsap.core.Tween {
  const card = new Container()
  card.addChild(
    new Graphics()
      .roundRect(-90, -125, 180, 250, 14)
      .fill(0x1f2937)
      .stroke({ width: 2, color: 0x38bdf8 }),
  )
  card.addChild(
    new Text({
      text: '对局画布占位',
      style: { fill: 0xe5e7eb, fontSize: 18, fontFamily: 'sans-serif' },
      anchor: 0.5,
    }),
  )
  app.stage.addChild(card)

  const place = () => {
    card.position.set(app.screen.width / 2, app.screen.height / 2)
  }
  place()
  app.renderer.on('resize', place)

  return gsap.to(card, {
    y: '+=12',
    duration: 1.6,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut',
  })
}
