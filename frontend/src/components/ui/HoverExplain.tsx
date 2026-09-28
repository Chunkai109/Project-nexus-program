import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const GAP = 8
const MARGIN = 12
const WIDTH = 280
const HOVER_DELAY = 3000

interface Position {
  top: number
  left: number
}

/**
 * Wraps any element (button, textbox, metric card, chart...) so hovering it
 * shows a short explanation floating directly below it. Portaled to
 * <body> and positioned from the trigger's live bounding rect, so it's
 * never clipped by the dashboard's scrollable <main> and always renders on
 * top. Re-measures on scroll so it tracks the trigger rather than going
 * stale if the page moves while still hovered.
 *
 * The wrapper is a plain block-level <div> (not display:contents) because
 * getBoundingClientRect() on a display:contents element returns an empty
 * rect in every browser — there's no box to measure. Pass `className` to
 * give the wrapper whatever layout role its child needs (e.g. "inline-flex"
 * for a button sitting in a flex row, or a grid "col-span-*" class for a
 * card that used to carry it directly).
 */
export function HoverExplain({
  explanation,
  className,
  children,
}: {
  explanation: string
  className?: string
  children: ReactNode
}) {
  const [position, setPosition] = useState<Position | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function measure() {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - WIDTH - MARGIN)
    setPosition({ top: rect.bottom + GAP, left })
  }

  function handleEnter() {
    timeoutRef.current = setTimeout(() => {
      measure()
      window.addEventListener('scroll', measure, true)
    }, HOVER_DELAY)
  }

  function handleLeave() {
    clearTimeout(timeoutRef.current)
    setPosition(null)
    window.removeEventListener('scroll', measure, true)
  }

  return (
    <div ref={ref} className={className} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {children}
      {position &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[100] rounded-lg border border-border-strong bg-surface px-3.5 py-2.5 text-[12px] leading-snug text-ink-muted shadow-[var(--shadow-ambient-lg)]"
            style={{ top: position.top, left: position.left, width: WIDTH }}
          >
            {explanation}
          </div>,
          document.body,
        )}
    </div>
  )
}
