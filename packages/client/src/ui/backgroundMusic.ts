import { useEffect } from 'react'
import { isMuted, subscribeMuted } from './audioMute'

export type BackgroundMusicTrack = 'beginning' | 'room' | 'cardsSelecting' | 'match'

/**
 * 四首循环 BGM。
 *
 * 是 .m4a（AAC 96 kbps）而不是 mp3：同样的听感能省掉一半体积，而 audio 元素设了
 * preload='auto'，进哪一页就整首往下拉，正好和那一页的图抢带宽。
 * 换/加曲目请跑 scripts/optimize-music.sh 转格式，别直接把 mp3 丢进 public/music/。
 *
 * 导出是给 test/assetManifest.test.ts 用的：它核对这四个地址和 public/music/ 里的文件对不对得上。
 */
export const TRACK_SOURCE: Record<BackgroundMusicTrack, string> = {
  beginning: '/music/beginning.m4a',
  room: '/music/room.m4a',
  cardsSelecting: '/music/cards_selecting.m4a',
  match: '/music/match.m4a',
}

const BACKGROUND_MUSIC_VOLUME = 0.9

let player: HTMLAudioElement | null = null
/** 当前界面想听的曲子；没有界面在放时是 null。静音期间也照记，解除静音就从这一首接上。 */
let currentTrack: BackgroundMusicTrack | null = null
/** audio 元素的 src 上已经装着的曲子。和 currentTrack 分开记，见 syncPlayback 里的解释。 */
let loadedTrack: BackgroundMusicTrack | null = null
let waitingForGesture = false

function getPlayer(): HTMLAudioElement {
  if (player) return player

  player = new Audio()
  player.loop = true
  player.preload = 'auto'
  player.volume = BACKGROUND_MUSIC_VOLUME
  // 玩家按右上角那颗按钮时，把播放状态跟着改过来。只订阅一次，播放器本身也只建一次。
  subscribeMuted(syncPlayback)
  return player
}

function addGestureListeners(): void {
  if (waitingForGesture) return
  waitingForGesture = true
  window.addEventListener('pointerdown', resumeAfterGesture, { capture: true })
  window.addEventListener('keydown', resumeAfterGesture, { capture: true })
}

function removeGestureListeners(): void {
  if (!waitingForGesture) return
  waitingForGesture = false
  window.removeEventListener('pointerdown', resumeAfterGesture, { capture: true })
  window.removeEventListener('keydown', resumeAfterGesture, { capture: true })
}

function requestPlayback(target: HTMLAudioElement, track: BackgroundMusicTrack): void {
  void target.play().then(
    () => {
      if (player === target && currentTrack === track) removeGestureListeners()
    },
    () => {
      // 有声自动播放常被浏览器拦截；保留当前曲目，在玩家首次操作时原地恢复。
      if (player === target && currentTrack === track) addGestureListeners()
    },
  )
}

function resumeAfterGesture(): void {
  syncPlayback()
}

/**
 * 把播放器调成「当前界面 + 静音开关」应有的样子。进出界面和拨动静音开关都走这一个入口。
 *
 * 静音用暂停 + 不装 src 实现，而不是 audio.muted = true：muted 的播放器照样会把整首歌拉下来，
 * 而 preload='auto' 下每换一页就是又一首（见文件头），关了声音的人不该再为此花流量。
 * 代价是 loadedTrack 要单独记一份——解除静音时 currentTrack 可能早就换过好几轮了，
 * 得靠它判断 src 上那首还算不算数。
 */
function syncPlayback(): void {
  const target = player
  if (!target) return

  const track = currentTrack
  if (track === null || isMuted()) {
    removeGestureListeners()
    target.pause()
    return
  }

  if (loadedTrack !== track) {
    target.pause()
    loadedTrack = track
    target.src = TRACK_SOURCE[track]
    target.load()
  }

  requestPlayback(target, track)
}

function playBackgroundMusic(track: BackgroundMusicTrack): void {
  getPlayer()
  currentTrack = track
  syncPlayback()
}

function stopBackgroundMusic(track: BackgroundMusicTrack): void {
  if (!player || currentTrack !== track) return
  currentTrack = null
  removeGestureListeners()
  player.pause()
  player.currentTime = 0
}

/**
 * 让当前界面独占一首循环背景音乐。同一个 audio 元素会跨界面复用，避免切歌时叠播，
 * 也能保留移动端浏览器在首次交互后授予这个元素的播放权限。
 */
export function useBackgroundMusic(track: BackgroundMusicTrack): void {
  useEffect(() => {
    playBackgroundMusic(track)
    return () => stopBackgroundMusic(track)
  }, [track])
}
