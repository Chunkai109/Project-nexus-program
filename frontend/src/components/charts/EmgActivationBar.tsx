import { clsx } from 'clsx'

function statusFor(value: number, target: number): { label: string; tone: 'emerald' | 'amber' | 'crimson' } {
  if (value >= target * 0.85) return { label: 'Optimal', tone: 'emerald' }
  if (value >= target * 0.55) return { label: 'Moderate', tone: 'amber' }
  return { label: 'Weak', tone: 'crimson' }
}

const toneBar = {
  emerald: 'bg-emerald',
  amber: 'bg-amber',
  crimson: 'bg-crimson',
}
const toneText = {
  emerald: 'text-emerald',
  amber: 'text-amber',
  crimson: 'text-crimson',
}

export function EmgActivationBar({
  label,
  value,
  target,
}: {
  label: string
  value: number
  target: number
}) {
  const { label: statusLabel, tone } = statusFor(value, target)

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className={clsx('text-xs font-semibold', toneText[tone])}>
          {value}% MVC · {statusLabel}
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-secondary">
        <div
          className="absolute top-0 h-full w-0.5 bg-ink-faint/60"
          style={{ left: `${Math.min(100, target)}%` }}
          title={`Target ${target}%`}
        />
        <div
          className={clsx('h-full rounded-full transition-all duration-300 ease-out', toneBar[tone])}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  )
}
