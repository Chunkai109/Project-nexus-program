import { clsx } from 'clsx'
import { HoverExplain } from '@/components/ui/HoverExplain'

/** Marks a setting that's saved but not yet used by live sessions (fault angle threshold, muscle targets). */
export function NotUsedYetTag() {
  return (
    <HoverExplain className="inline-flex" explanation="Saved with this plan. The AI form check will use it in a future version.">
      <span
        className="inline-flex items-center whitespace-nowrap rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] font-medium text-ink-muted"
        aria-label="Not used in sessions yet. Saved with this plan. The AI form check will use it in a future version."
      >
        Not used in sessions yet
      </span>
    </HoverExplain>
  )
}

/**
 * "▲ 13 pts vs last session": the real change in good-form % between a
 * session and the previous session of the same exercise (latest minus previous).
 */
export function GoodFormChange({ change }: { change: number }) {
  const size = Math.abs(change)
  const words = change === 0 ? '● no change vs last session' : `${change > 0 ? '▲' : '▼'} ${size} ${size === 1 ? 'pt' : 'pts'} vs last session`
  return (
    <span className={clsx('font-medium', change > 0 ? 'text-emerald-ink' : change < 0 ? 'text-crimson-ink' : 'text-ink-muted')}>{words}</span>
  )
}
