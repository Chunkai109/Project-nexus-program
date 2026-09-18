import { clsx } from 'clsx'
import type { HTMLAttributes } from 'react'

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: 'none' | 'electric' | 'emerald' | 'crimson'
}

const glowClass: Record<NonNullable<GlassCardProps['glow']>, string> = {
  none: '',
  electric: 'shadow-[0_0_24px_-4px_rgba(56,189,248,0.35)]',
  emerald: 'shadow-[0_0_24px_-4px_rgba(16,185,129,0.35)]',
  crimson: 'shadow-[0_0_24px_-4px_rgba(239,68,68,0.35)]',
}

export function GlassCard({ className, glow = 'none', children, ...rest }: GlassCardProps) {
  return (
    <div className={clsx('glass-panel rounded-2xl', glowClass[glow], className)} {...rest}>
      {children}
    </div>
  )
}
