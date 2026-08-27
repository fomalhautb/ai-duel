import { useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, PointerEvent as ReactPointerEvent } from 'react'

export type PlaqueButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

/** 再快的点击也至少完整显示这么久的压入姿态，避免反馈强度取决于用户按键速度。 */
const MIN_PRESS_MS = 70

/** 视觉稿里的墨蓝八角匾额按钮。SVG 轮廓套手绘滤镜，切角处仍能保持连续描边。 */
export function PlaqueButton({
  className = '',
  children,
  onPointerEnter,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  ...props
}: PlaqueButtonProps) {
  const textFilterId = `plaque-text-${useId().replaceAll(':', '')}`
  const [textFilterSeed, setTextFilterSeed] = useState(5)
  const [isPressed, setIsPressed] = useState(false)
  const pressStartedAtRef = useRef<number | null>(null)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
    },
    [],
  )

  const refreshTextFilter = () => {
    setTextFilterSeed((current) => {
      let next = current
      while (next === current) next = Math.floor(Math.random() * 10_000) + 1
      return next
    })
  }

  const handlePointerEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    refreshTextFilter()
    onPointerEnter?.(event)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    refreshTextFilter()
    if (!props.disabled) {
      if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
      pressStartedAtRef.current = Date.now()
      setIsPressed(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    onPointerDown?.(event)
  }

  const finishPress = () => {
    const startedAt = pressStartedAtRef.current
    if (startedAt === null) return

    const remaining = Math.max(0, MIN_PRESS_MS - (Date.now() - startedAt))
    if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
    releaseTimerRef.current = setTimeout(() => {
      setIsPressed(false)
      pressStartedAtRef.current = null
      releaseTimerRef.current = null
    }, remaining)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    finishPress()
    onPointerUp?.(event)
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    finishPress()
    onPointerCancel?.(event)
  }

  const handlePointerLeave = (event: ReactPointerEvent<HTMLButtonElement>) => {
    finishPress()
    onPointerLeave?.(event)
  }

  return (
    <button
      className={`plaque-button ${className}`.trim()}
      type="button"
      onPointerEnter={handlePointerEnter}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
      data-pressed={isPressed ? 'true' : undefined}
      {...props}
    >
      <svg className="plaque-button__filter-defs" width="0" height="0" aria-hidden="true">
        <defs>
          <filter id={textFilterId} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.05"
              numOctaves="3"
              seed={textFilterSeed}
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="3.2"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <svg
        className="plaque-button__frame"
        viewBox="0 0 224 68"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          className="plaque-button__surface"
          d="M12 1.5h200c3 0 5 1 7 3l2 2c2 2 2.5 4 2.5 7v41c0 3-.5 5-2.5 7l-2 2c-2 2-4 3-7 3H12c-3 0-5-1-7-3l-2-2c-2-2-2.5-4-2.5-7v-41c0-3 .5-5 2.5-7l2-2c2-2 4-3 7-3Z"
        />
        <path
          className="plaque-button__rim"
          d="M12 4.5h199c3 0 4.5.75 6.5 2.75l1.25 1.25c1.75 1.75 2.25 3.5 2.25 6v39c0 2.5-.5 4.25-2.25 6l-1.25 1.25c-2 2-3.5 2.75-6.5 2.75H12c-3 0-4.5-.75-6.5-2.75L4.25 59.5C2.5 57.75 2 56 2 53.5v-39c0-2.5.5-4.25 2.25-6L5.5 7.25c2-2 3.5-2.75 6.5-2.75Z"
        />
        <path
          className="plaque-button__rim"
          d="M14 8h196c2.5 0 4 .75 5.5 2.25l.25.25c1.5 1.5 2 3 2 5.5v36c0 2.5-.5 4-2 5.5l-.25.25C214 59.25 212.5 60 210 60H14c-2.5 0-4-.75-5.5-2.25l-.25-.25c-1.5-1.5-2-3-2-5.5V16c0-2.5.5-4 2-5.5l.25-.25C10 8.75 11.5 8 14 8Z"
        />
        <path
          className="plaque-button__corner"
          d="M4 15V11l7-7h8M10 6v8H3m11-9v8M220 15v-4l-7-7h-8m9 2v8h7m-11-9v8M4 53v4l7 7h8m-9-2v-8H3m11 9v-8M220 53v4l-7 7h-8m9-2v-8h7m-11 9v-8"
        />
        <path
          className="plaque-button__spark"
          d="M14 25.5 16 31l5 3-5 3-2 5.5-2-5.5-5-3 5-3 2-5.5Zm196 0 2 5.5 5 3-5 3-2 5.5-2-5.5-5-3 5-3 2-5.5Z"
        />
      </svg>
      <span className="plaque-button__label" style={{ filter: `url(#${textFilterId})` }}>
        {children}
      </span>
    </button>
  )
}
