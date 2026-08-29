import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isMuted, setMuted, subscribeMuted, toggleMuted } from '../src/ui/audioMute'
import { MuteButton } from '../src/ui/MuteButton'

describe('全站静音开关', () => {
  it('切换会通知订阅者，重复设成同一个值不通知', () => {
    let calls = 0
    const unsubscribe = subscribeMuted(() => calls++)

    expect(isMuted()).toBe(false)
    toggleMuted()
    expect(isMuted()).toBe(true)
    expect(calls).toBe(1)

    setMuted(true)
    expect(calls).toBe(1)

    setMuted(false)
    expect(isMuted()).toBe(false)
    expect(calls).toBe(2)

    unsubscribe()
    toggleMuted()
    expect(calls).toBe(2)
    setMuted(false)
  })

  it('按钮把当前状态读成朗读器能用的开关', () => {
    // 这里同时兜住"没有 window / localStorage 的环境不能炸"：整个测试跑在 node 下。
    expect(renderToStaticMarkup(<MuteButton />)).toContain('aria-label="关闭声音"')
    setMuted(true)
    const muted = renderToStaticMarkup(<MuteButton />)
    expect(muted).toContain('aria-label="打开声音"')
    expect(muted).toContain('aria-pressed="true"')
    setMuted(false)
  })
})
