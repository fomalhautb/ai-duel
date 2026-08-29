import { useEffect } from 'react'
import { subscribeBackgroundMusicReplay } from './backgroundMusic'

export const SOUND_EFFECT_SOURCE = {
  homeIntro: '/music/question-ai.m4a',
  buttonClick: '/music/mouse-click-sound.m4a',
  skillTargeting: '/music/skill-jiejie.m4a',
  urgeCanYouDoIt: '/music/urge-can-you-do-it.m4a',
  urgeHurryUp: '/music/urge-hurry-up.m4a',
  urgeComeOn: '/music/urge-come-on.m4a',
  urgeQuestionAi: '/music/question-ai.m4a',
} as const

type SoundEffect = keyof typeof SOUND_EFFECT_SOURCE

const URGE_EFFECTS = [
  'urgeCanYouDoIt',
  'urgeHurryUp',
  'urgeComeOn',
  'urgeQuestionAi',
] as const satisfies readonly SoundEffect[]

/** 点击音效要求 200% 音量；HTMLAudioElement.volume 上限是 1，所以用 Web Audio 做 2 倍增益。 */
const BUTTON_CLICK_GAIN = 2
/** 首页问候和「催一催」四段人声统一放大一倍。 */
const VOICE_GAIN = 2
const HOME_INTRO_DELAY_MS = 3620

const audioData = new Map<string, Promise<ArrayBuffer>>()
const decodedAudio = new Map<string, Promise<AudioBuffer>>()
const activeChannels = new Map<string, AudioBufferSourceNode>()
let context: AudioContext | null = null
let waitingForGesture = false

function loadAudioData(source: string): Promise<ArrayBuffer> {
  const cached = audioData.get(source)
  if (cached !== undefined) return cached

  const request = fetch(source).then((response) => {
    if (!response.ok) throw new Error(`音效加载失败：${source}`)
    return response.arrayBuffer()
  })
  audioData.set(source, request)
  void request.catch(() => audioData.delete(source))
  return request
}

function getAudioContext(): AudioContext | null {
  if (context !== null) return context
  if (typeof AudioContext === 'undefined') return null
  context = new AudioContext()
  return context
}

function removeGestureListeners(): void {
  if (!waitingForGesture) return
  waitingForGesture = false
  window.removeEventListener('pointerdown', resumeAfterGesture, true)
  window.removeEventListener('keydown', resumeAfterGesture, true)
}

function resumeAfterGesture(): void {
  const target = context
  if (target === null) return
  void target.resume().then(removeGestureListeners, () => {})
}

function addGestureListeners(): void {
  if (waitingForGesture) return
  waitingForGesture = true
  window.addEventListener('pointerdown', resumeAfterGesture, true)
  window.addEventListener('keydown', resumeAfterGesture, true)
}

function decodeAudio(target: AudioContext, source: string): Promise<AudioBuffer> {
  const cached = decodedAudio.get(source)
  if (cached !== undefined) return cached

  const request = loadAudioData(source).then((data) => target.decodeAudioData(data.slice(0)))
  decodedAudio.set(source, request)
  void request.catch(() => decodedAudio.delete(source))
  return request
}

async function playSoundEffect(
  effect: SoundEffect,
  options: { gain?: number; channel?: string } = {},
): Promise<void> {
  const target = getAudioContext()
  if (target === null) return

  if (target.state === 'suspended') {
    addGestureListeners()
    void target.resume().then(removeGestureListeners, () => {})
  }

  try {
    const buffer = await decodeAudio(target, SOUND_EFFECT_SOURCE[effect])
    const source = target.createBufferSource()
    const gain = target.createGain()
    source.buffer = buffer
    gain.gain.value = options.gain ?? 1
    source.connect(gain).connect(target.destination)

    const channel = options.channel
    if (channel !== undefined) {
      const previous = activeChannels.get(channel)
      if (previous !== undefined) {
        try {
          previous.stop()
        } catch {
          // 已自然播完的节点再 stop 会抛错；它本来就不需要额外处理。
        }
      }
      activeChannels.set(channel, source)
    }

    source.addEventListener('ended', () => {
      source.disconnect()
      gain.disconnect()
      if (channel !== undefined && activeChannels.get(channel) === source) {
        activeChannels.delete(channel)
      }
    })
    source.start()
  } catch {
    // 音效是反馈层，加载或解码失败不能挡住按钮自己的操作。
  }
}

/** 预取小体积音效，第一次点击不必再等网络；解码仍等到真正播放时进行。 */
export function preloadSoundEffects(): void {
  for (const source of new Set(Object.values(SOUND_EFFECT_SOURCE))) {
    void loadAudioData(source).catch(() => {})
  }
}

/** 给全站真实按钮补同一颗点击声；data-button-sound 用于看起来可点但暂未开放的入口。 */
export function useGlobalButtonSound(): void {
  useEffect(() => {
    preloadSoundEffects()

    const handleClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const control = target.closest('button, [data-button-sound]')
      if (control === null) return
      if (control instanceof HTMLButtonElement && control.disabled) return
      void playSoundEffect('buttonClick', { gain: BUTTON_CLICK_GAIN })
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])
}

/** 首页首次播放及 beginning 背景音乐每次循环后，都在新一轮音乐开始 4 秒时问候。 */
export function useHomeIntroSound(): void {
  useEffect(() => {
    let timer: number | null = null

    const scheduleIntro = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        void playSoundEffect('homeIntro', { gain: VOICE_GAIN, channel: 'voice' })
      }, HOME_INTRO_DELAY_MS)
    }

    scheduleIntro()
    const unsubscribe = subscribeBackgroundMusicReplay('beginning', scheduleIntro)
    return () => {
      unsubscribe()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])
}

/** 玩家点出一张必须指定对方 AI 的技能牌、进入选目标态时播放。 */
export function playSkillTargetingSound(): void {
  void playSoundEffect('skillTargeting', { channel: 'skill' })
}

/** 每次只随机抽一段；连点时用新一句替掉没播完的上一句，避免四个人声叠播。 */
export function playRandomUrgeSound(): void {
  const effect = URGE_EFFECTS[Math.floor(Math.random() * URGE_EFFECTS.length)]!
  void playSoundEffect(effect, { gain: VOICE_GAIN, channel: 'voice' })
}
