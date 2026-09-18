import { clsx } from 'clsx'
import type { ReactNode } from 'react'

type Tone = 'electric' | 'emerald' | 'amber' | 'crimson' | 'neutral' | 'violet'

const toneClass: Record<Tone, string> = {
  electric: 'bg-sky-400/10 text-electric border-sky-400/30',
  emerald: 'bg-emerald-400/10 text-emerald border-emerald-400/30',
  amber: 'bg-amber-400/10 text-amber border-amber-400/30',
  crimson: 'bg-red-400/10 text-crimson border-red-400/30',
  neutral: 'bg-white/5 text-ink-muted border-border-strong',
  violet: 'bg-indigo-400/10 text-violet border-indigo-400/30',
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none',
        toneClass[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
