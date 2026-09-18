import { clsx } from 'clsx'

export function ProgressBar({
  value,
  max = 100,
  tone = 'electric',
  className,
  trackClassName,
}: {
  value: number
  max?: number
  tone?: 'electric' | 'emerald' | 'amber' | 'crimson'
  className?: string
  trackClassName?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const toneClass = {
    electric: 'bg-electric',
    emerald: 'bg-emerald',
    amber: 'bg-amber',
    crimson: 'bg-crimson',
  }[tone]

  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-white/5', trackClassName)}>
      <div
        className={clsx('h-full rounded-full transition-all duration-500 ease-out', toneClass, className)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
