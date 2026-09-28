import type { ReactNode } from 'react'
import { useInspector } from './InspectorContext'

/**
 * Wraps a card or chart so hovering it publishes a definition to the
 * Inspector HUD. `className="contents"` (the default) makes this wrapper
 * invisible to CSS Grid/Flexbox — the wrapped element's own layout classes
 * (col-span, etc.) keep working exactly as if this wrapper weren't there.
 */
export function Inspectable({
  title,
  description,
  className = 'contents',
  children,
}: {
  title: string
  description: string
  className?: string
  children: ReactNode
}) {
  const { setActive } = useInspector()
  return (
    <div
      className={className}
      onMouseEnter={() => setActive({ title, description })}
      onMouseLeave={() => setActive(null)}
    >
      {children}
    </div>
  )
}
