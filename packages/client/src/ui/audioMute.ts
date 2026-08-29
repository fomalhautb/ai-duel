/**
 * 全站静音开关。
 *
 * 目前只有循环 BGM 一路声音（见 ui/backgroundMusic.ts），但开关放在这里而不是塞进那个模块：
 * 之后加音效时，它们照样读这一个开关就行，右上角那颗按钮不用跟着改。
 *
 * 状态写 localStorage：玩家关掉声音多半是"这台机器上一直别响"的意思，
 * 而全站每换一页都会重挂组件，存在内存里的话点一次「返回」就白关了。
 */

/** 静音状态的存档位。存 '1' 表示静音，没有这一项就是有声。 */
const MUTED_KEY = 'ai-duel.audioMuted'

/**
 * 读写都吞异常：隐私模式、站点数据被禁的浏览器上光是碰一下 localStorage 就抛，
 * 而这里存的只是一个开关，丢了最多是下次进来又有声音，不值得把整页带崩。
 */
function readStored(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

function writeStored(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTED_KEY, '1')
    else localStorage.removeItem(MUTED_KEY)
  } catch {
    // 存不下就算了，本次会话内仍然生效。
  }
}

/**
 * 当前值缓存在内存里，只在模块加载时读一次存档。
 *
 * useSyncExternalStore 要求 getSnapshot 每次返回同一个值（除非真的变了），
 * 现读 localStorage 虽然也返回布尔值不会引起循环，但每帧碰一次存储没必要。
 */
let muted = typeof window === 'undefined' ? false : readStored()

const listeners = new Set<() => void>()

export function isMuted(): boolean {
  return muted
}

export function setMuted(next: boolean): void {
  if (muted === next) return
  muted = next
  writeStored(next)
  for (const listener of listeners) listener()
}

export function toggleMuted(): void {
  setMuted(!muted)
}

/** 订阅静音状态变化，返回退订函数。播放器和按钮都靠它跟着变。 */
export function subscribeMuted(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
