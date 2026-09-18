import { clsx } from 'clsx'

export function ProgressBar({
  value,
  max = 100,
  tone = 'accent',
  className,
  trackClassName,
}: {
  value: number
  max?: number
  tone?: 'accent' | 'emerald' | 'amber' | 'crimson'
  className?: string
  trackClassName?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const toneClass = {
    accent: 'bg-accent',
    emerald: 'bg-emerald',
    amber: 'bg-amber',
    crimson: 'bg-crimson',
  }[tone]

  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary', trackClassName)}>
      <div
        className={clsx('h-full rounded-full transition-all duration-500 ease-out', toneClass, className)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
