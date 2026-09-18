import { clsx } from 'clsx'
import type { ReactNode } from 'react'

type Tone = 'accent' | 'emerald' | 'amber' | 'crimson' | 'neutral' | 'violet'

const toneClass: Record<Tone, string> = {
  accent: 'bg-accent/10 text-accent',
  emerald: 'bg-emerald/10 text-emerald',
  amber: 'bg-amber/10 text-amber',
  crimson: 'bg-crimson/10 text-crimson',
  neutral: 'bg-surface-secondary text-ink-muted',
  violet: 'bg-violet/10 text-violet',
}

export function Badge({
  tone = 'neutral',
  children,
  icon,
  className,
}: {
  tone?: Tone
  children: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium leading-none',
        toneClass[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
