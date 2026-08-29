/**
 * 素材加载进度：preloadAssets 报的进度要和"到了几张图"对得上，LoadingScreen 要把它画成条。
 *
 * 测试跑在 node 环境下（没有 DOM），所以这里自己搭一个够用的 Image 和 document：
 * 加载哪张图、什么时候到货全由测试说了算，正好用来卡进度的时序。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoadingScreen } from '../src/ui/LoadingScreen'
import { preloadAssets } from '../src/ui/preloadAssets'
import type { PreloadProgress } from '../src/ui/preloadAssets'

/** 造出来的每个假 Image，按创建顺序排；测试用 finish(i) 让第 i 张到货。 */
let created: FakeImage[] = []

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''
  constructor() {
    created.push(this)
  }
}

const globals = globalThis as unknown as Record<string, unknown>
let savedImage: unknown
let savedDocument: unknown

beforeEach(() => {
  created = []
  savedImage = globals.Image
  savedDocument = globals.document
  globals.Image = FakeImage
  // fontsReady 会读 document.fonts，visibilityState 是 loadImage 里判断要不要等解码用的。
  globals.document = { fonts: undefined, visibilityState: 'visible', addEventListener: () => {} }
})

afterEach(() => {
  globals.Image = savedImage
  globals.document = savedDocument
})

/** 让第 index 张图加载完，并把微任务队列排空，好让 then 里的进度回调跑完。 */
async function finish(index: number): Promise<void> {
  created[index]?.onload?.()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('preloadAssets 的进度回调', () => {
  it('起手先报一次 0，每到一张加一格，全到齐正好是满格', async () => {
    const urls = ['/t/progress-a.webp', '/t/progress-b.webp', '/t/progress-c.webp']
    const reports: PreloadProgress[] = []
    const done = preloadAssets(urls, { onProgress: (p) => reports.push(p) })

    expect(reports).toEqual([{ loaded: 0, total: 3 }])

    await finish(0)
    await finish(1)
    await finish(2)
    await done

    expect(reports.map((p) => p.loaded)).toEqual([0, 1, 2, 3])
    expect(reports.every((p) => p.total === 3)).toBe(true)
  })

  it('清单里已经加载过的图直接算数，不会被数第二遍', async () => {
    const cached = '/t/cached.webp'
    const first = preloadAssets([cached])
    await finish(0)
    await first

    const reports: PreloadProgress[] = []
    const done = preloadAssets([cached, '/t/fresh.webp'], { onProgress: (p) => reports.push(p) })
    // 缓存那张一开始就算一格；剩下那张到货后是 2/2，不会因为重复计数变成 3/2。
    expect(reports[0]).toEqual({ loaded: 1, total: 2 })

    await finish(created.length - 1)
    await done

    expect(reports.at(-1)).toEqual({ loaded: 2, total: 2 })
  })
})

describe('LoadingScreen 的进度条', () => {
  it('传了进度就画出条和百分比', () => {
    const html = renderToStaticMarkup(<LoadingScreen progress={0.42} />)
    expect(html).toContain('加载中… 42%')
    expect(html).toContain('aria-valuenow="42"')
    expect(html).toContain('width:42%')
  })

  it('不传进度就只有加载动画，没有条', () => {
    const html = renderToStaticMarkup(<LoadingScreen />)
    expect(html).toContain('加载中…')
    expect(html).not.toContain('progressbar')
  })

  it('进度超出 0~1 也不会画出越界的条', () => {
    expect(renderToStaticMarkup(<LoadingScreen progress={1.5} />)).toContain('aria-valuenow="100"')
    expect(renderToStaticMarkup(<LoadingScreen progress={-1} />)).toContain('aria-valuenow="0"')
  })
})
