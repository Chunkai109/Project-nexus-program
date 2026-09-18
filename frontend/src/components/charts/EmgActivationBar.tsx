import { clsx } from 'clsx'

function statusFor(value: number, target: number): { label: string; tone: 'emerald' | 'amber' | 'crimson' } {
  if (value >= target * 0.85) return { label: 'Optimal', tone: 'emerald' }
  if (value >= target * 0.55) return { label: 'Moderate', tone: 'amber' }
  return { label: 'Weak', tone: 'crimson' }
}

const toneBar = {
  emerald: 'bg-emerald shadow-[0_0_10px_-1px_rgba(16,185,129,0.7)]',
  amber: 'bg-amber shadow-[0_0_10px_-1px_rgba(245,158,11,0.7)]',
  crimson: 'bg-crimson shadow-[0_0_10px_-1px_rgba(239,68,68,0.7)]',
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
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/5">
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
