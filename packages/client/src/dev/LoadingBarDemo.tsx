/**
 * 加载进度条测试页（访问 /loading-bar 进入）。
 *
 * 和 /loader 分工：那一页调的是 CardLoader 这只动画本身（size / speed / 颜色），
 * 这一页调的是它下面那条素材进度条——百分比的排版、条走到各档的样子，
 * 以及"真下一遍素材时它到底怎么走"。
 *
 * 三块内容，从假到真：
 * 1. 手动挡：拖滑块看任意百分比，或让它自动跑一遍模拟到货（步长随机，还原真实的一跳一跳）。
 * 2. 极端值对照：0 / 1 / 50 / 99 / 100 摆开，专盯两头——1% 那条细得还剩不剩圆角、
 *    99% 到 100% 收尾干不干净、百分比数字从一位变三位时整行会不会左右跳。
 * 3. 真跑一遍：拿真实清单调 preloadAssets，进度就是真的下载进度。
 *    默认给每个地址加一个时间戳参数绕开浏览器缓存，否则素材早在后台预加载时下完了，
 *    进度条会在一帧之内直接满格，什么都看不到。
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { DECK_ASSETS } from '../screens/DeckScreen'
import { HERO_ASSETS } from '../screens/HeroScreen'
import { HOME_ASSETS } from '../screens/HomeScreen'
import { ROOM_ASSETS } from '../screens/RoomScreen'
import { BATTLE_ASSETS } from '../ui/backgroundPreload'
import { LoadingScreen } from '../ui/LoadingScreen'
import { preloadAssets } from '../ui/preloadAssets'

/** 极端值对照那一排。挑的都是容易出问题的档位，理由见文件头。 */
const STOPS = [0, 1, 50, 99, 100]

/** 真跑一遍时可选的清单，名字后面标了张数，好对照进度条走的格数。 */
const LISTS: { label: string; urls: readonly string[] }[] = [
  { label: '首页', urls: HOME_ASSETS },
  { label: '房间页', urls: ROOM_ASSETS },
  { label: '组卡页', urls: DECK_ASSETS },
  { label: '选英雄', urls: HERO_ASSETS },
  { label: '对局（最大的一份）', urls: BATTLE_ASSETS },
]

/** 自动模拟的节奏：每 120ms 到货 1~3 张，凑够 60 张走完，跟真实加载的手感差不多。 */
const SIM_TICK_MS = 120
const SIM_TOTAL = 60

export function LoadingBarDemo() {
  const [, navigate] = useLocation()
  const [percent, setPercent] = useState(35)
  const [simulating, setSimulating] = useState(false)
  /** 整屏预览：直接把真的 <LoadingScreen> 盖上来，它是 position: fixed，不能和下面的内容并存。 */
  const [overlay, setOverlay] = useState(false)

  useSimulation(simulating, setPercent, () => setSimulating(false))

  const real = useRealPreload()

  // 整屏预览时只画这一层：省得下面那堆控件在 fixed 层背后透出来干扰判断。
  if (overlay) {
    return (
      <div
        className="loading-bar-demo__overlay"
        role="presentation"
        onClick={() => setOverlay(false)}
      >
        <LoadingScreen progress={percent / 100} />
        <p className="loading-bar-demo__overlay-hint">点一下退出整屏预览</p>
      </div>
    )
  }

  return (
    <div className="loading-bar-demo">
      <header>
        <h1 className="loader-demo__heading">加载进度条</h1>
        <p className="loader-demo__note">
          真实加载页（ui/LoadingScreen.tsx）里那条素材进度条。进度按"这批清单里到货了几张"算，
          所以走得不匀是正常的：一张 600 KB 的原画和一张 20 KB 的图标各占一格。
        </p>
      </header>

      {/* 1. 手动挡 */}
      <section className="loading-bar-demo__section">
        <h2 className="loader-demo__heading">手动挡</h2>
        <div className="loading-bar-demo__stage">
          <Preview percent={percent} />
        </div>
        <div className="loading-bar-demo__controls">
          <input
            type="range"
            min={0}
            max={100}
            value={percent}
            aria-label="进度百分比"
            onChange={(event) => {
              setSimulating(false)
              setPercent(Number(event.target.value))
            }}
          />
          <button
            type="button"
            className="loader-demo__back loading-bar-demo__button"
            onClick={() => {
              // 从头跑：停在 100% 时再点一次显然是想重看一遍，不是想从满格继续。
              setPercent(simulating ? percent : 0)
              setSimulating(!simulating)
            }}
          >
            {simulating ? '暂停模拟' : '自动模拟一遍'}
          </button>
          <button
            type="button"
            className="loader-demo__back loading-bar-demo__button"
            onClick={() => setOverlay(true)}
          >
            整屏预览
          </button>
        </div>
      </section>

      {/* 2. 极端值对照 */}
      <section className="loading-bar-demo__section">
        <h2 className="loader-demo__heading">极端值</h2>
        <div className="loading-bar-demo__stops">
          {STOPS.map((stop) => (
            <div className="loading-bar-demo__cell" key={stop}>
              <Preview percent={stop} />
              <span className="loader-demo__label">{stop}%</span>
            </div>
          ))}
        </div>
      </section>

      {/* 3. 真跑一遍 */}
      <section className="loading-bar-demo__section">
        <h2 className="loader-demo__heading">真跑一遍</h2>
        <p className="loader-demo__note">
          点一份清单就真去下那批图，进度条走的是真实到货节奏。默认给地址加时间戳绕开缓存
          （不绕的话素材早被后台预加载下完了，一帧就满格）。想看缓存命中的样子就把勾去掉。
        </p>
        <label className="loading-bar-demo__check">
          <input
            type="checkbox"
            checked={real.bustCache}
            onChange={(event) => real.setBustCache(event.target.checked)}
          />
          绕开浏览器缓存
        </label>
        <div className="loading-bar-demo__controls">
          {LISTS.map((list) => (
            <button
              type="button"
              className="loader-demo__back loading-bar-demo__button"
              key={list.label}
              disabled={real.running}
              onClick={() => real.start(list.urls, list.label)}
            >
              {list.label}
              <span className="loading-bar-demo__count"> · {list.urls.length} 张</span>
            </button>
          ))}
        </div>
        <div className="loading-bar-demo__stage">
          <Preview percent={Math.floor(real.progress * 100)} />
        </div>
        <p className="loader-demo__note">{real.status}</p>
      </section>

      <button type="button" className="loader-demo__back" onClick={() => navigate('/dev')}>
        回开发页
      </button>
    </div>
  )
}

/**
 * 进度条本体的预览。
 *
 * 结构和 class 照抄 ui/LoadingScreen.tsx，只是没有外面那层 position: fixed 的壳——
 * 真组件占满整屏，这一页要同时摆好几份对照，塞不下。**改了那边这里要跟着改**，
 * 不然这一页调出来的样子和真实加载页对不上。
 */
function Preview({ percent }: { percent: number }) {
  return (
    <div className="loading-bar-demo__preview">
      <p className="page-loader__text">加载中… {percent}%</p>
      <div
        className="page-loader__bar"
        role="progressbar"
        aria-label="素材加载进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="page-loader__bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** 自动模拟：一格一格往上跳，到顶就停下并回调。 */
function useSimulation(
  running: boolean,
  setPercent: (update: (prev: number) => number) => void,
  onDone: () => void,
): void {
  // 回调存进 ref，免得它每次渲染都是新函数、把下面的定时器一直重建。
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    if (!running) return
    const step = 100 / SIM_TOTAL
    const timer = window.setInterval(() => {
      setPercent((prev) => {
        // 1~3 张一跳：定速的话看不出真实加载那种忽快忽慢。
        const next = prev + step * (1 + Math.floor(Math.random() * 3))
        if (next >= 100) {
          doneRef.current()
          return 100
        }
        return next
      })
    }, SIM_TICK_MS)
    return () => window.clearInterval(timer)
  }, [running, setPercent])
}

/** 真跑一遍：调真正的 preloadAssets，把它报的进度接出来。 */
function useRealPreload() {
  const [bustCache, setBustCache] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('还没跑过。挑一份清单开始。')
  /** 每次点击自增，用来作废上一轮还在回调的进度（连点两份清单时不让旧的那份继续改数）。 */
  const runId = useRef(0)

  function start(urls: readonly string[], label: string): void {
    const id = (runId.current += 1)
    const stamp = Date.now()
    // 加的是查询参数，服务器照样返回同一张图，但浏览器当成新地址，会真的重新下载一遍。
    const targets = bustCache ? urls.map((url) => `${url}?loading-bar=${stamp}`) : urls

    setRunning(true)
    setProgress(0)
    setStatus(`正在加载「${label}」…`)

    const startedAt = performance.now()
    void preloadAssets(targets, {
      onProgress: ({ loaded, total }) => {
        if (runId.current !== id) return
        setProgress(total === 0 ? 1 : loaded / total)
        setStatus(`「${label}」：${loaded} / ${total} 张`)
      },
    }).then(() => {
      if (runId.current !== id) return
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1)
      setProgress(1)
      setRunning(false)
      setStatus(`「${label}」加载完毕，${targets.length} 张用了 ${seconds} 秒。`)
    })
  }

  return { bustCache, setBustCache, running, progress, status, start }
}
