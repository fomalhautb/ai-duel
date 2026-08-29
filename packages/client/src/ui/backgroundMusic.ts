import { useEffect } from 'react'

export type BackgroundMusicTrack = 'beginning' | 'room' | 'cardsSelecting' | 'match'

const TRACK_SOURCE: Record<BackgroundMusicTrack, string> = {
  beginning: '/music/beginning.mp3',
  room: '/music/room.mp3',
  cardsSelecting: '/music/cards_selecting.mp3',
  match: '/music/match.mp3',
}

const BACKGROUND_MUSIC_VOLUME = 0.9

let player: HTMLAudioElement | null = null
let currentTrack: BackgroundMusicTrack | null = null
let waitingForGesture = false

function getPlayer(): HTMLAudioElement {
  if (player) return player

  player = new Audio()
  player.loop = true
  player.preload = 'auto'
  player.volume = BACKGROUND_MUSIC_VOLUME
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
  const target = player
  const track = currentTrack
  if (!target || !track) return
  requestPlayback(target, track)
}

function playBackgroundMusic(track: BackgroundMusicTrack): void {
  const target = getPlayer()

  if (currentTrack !== track) {
    target.pause()
    currentTrack = track
    target.src = TRACK_SOURCE[track]
    target.load()
  }

  requestPlayback(target, track)
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
